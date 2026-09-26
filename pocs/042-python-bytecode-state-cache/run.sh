#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { echo "usage: $0 /path/to/rumiai-os" >&2; exit 2; }
source_root=$1
PYTHON=${PYTHON:-python3}

[ -x "$source_root/m" ] || { echo "ERROR rumiai-os checkout missing m" >&2; exit 2; }
command -v "$PYTHON" >/dev/null 2>&1 || { echo "ERROR Python unavailable: $PYTHON" >&2; exit 2; }

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
poc038_dir=${script_dir%/*}/038-python-environment-late-binding
[ -f "$poc038_dir/build-fixtures.py" ] && [ -f "$poc038_dir/materialize-wheel.py" ] || {
    echo "ERROR PoC 038 helpers missing" >&2
    exit 2
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-pycache-state-poc.XXXXXX")
consumer_state=
cleanup()
{
    [ -z "${consumer_state-}" ] || rm -rf "$consumer_state" 2>/dev/null || :
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

wheels=$work/wheels
mkdir "$wheels"
"$PYTHON" "$poc038_dir/build-fixtures.py" --output "$wheels" >/dev/null
pure_wheel=$wheels/rumiai_poc_pure-1.0-py3-none-any.whl
[ -f "$pure_wheel" ] || { echo "ERROR pure wheel missing" >&2; exit 1; }

payload=$work/payload
"$PYTHON" "$poc038_dir/materialize-wheel.py" "$pure_wheel" "$payload" >/dev/null
[ "$(head -n 1 "$payload/bin/poc-pure")" = '#!/usr/bin/env python' ] || {
    echo "ERROR materialized command shebang mismatch" >&2
    exit 1
}

root=$work/target-a
cp -R "$source_root" "$root"
[ -d "$root/pkg" ] || mkdir "$root/pkg"

run_pkg() { "$root/m" "$root/bin/sys/pkg" "$@"; }

facility=poc42python
provider=poc42provider
consumer=poc42consumer$$
command_name=poc42run$$

integration_driver=$work/integration-driver
cat > "$integration_driver" <<'EOF_DRIVER'
#!/usr/bin/env m
. "$m_LIB_DIR/sys/sh/pkg/pkg-integration.lib.sh" || exit 3
[ "$1" = integrate ] || exit 2
shift
[ -f "$3/format" ] || printf '%s\n' tar.gz > "$3/format" || exit 3
pkg_integrate "$@"
EOF_DRIVER
chmod 700 "$integration_driver"

export POC42_PYTHON=$(command -v "$PYTHON")

provider_range=$work/provider-range
provider_payload=$work/provider-payload
mkdir -p "$provider_range/facility-cmd/$facility" "$provider_payload/bin"
printf '%s %s\n' "$facility" 1 > "$provider_range/facility"
printf '%s\n' bin/python > "$provider_range/facility-cmd/$facility/python"
cat > "$provider_payload/bin/python" <<'EOF_PROVIDER'
#!/bin/sh
exec "$POC42_PYTHON" "$@"
EOF_PROVIDER
chmod 700 "$provider_payload/bin/python"

"$root/m" "$integration_driver" integrate "$provider" 1 "$provider_range" "$provider_payload"
run_pkg default "$provider@1" >/dev/null
run_pkg provider default "$facility" "$provider" >/dev/null

consumer_range=$work/consumer-range
mkdir -p "$consumer_range/cmd" "$consumer_range/link"
printf '%s\n' "$facility =1" > "$consumer_range/dependency"
cat > "$consumer_range/env" <<'EOF_ENV'
PYTHONPATH="$pkg_launch_root/python/site-packages"
PYTHONPYCACHEPREFIX="$HOME/.cache/python"
export PYTHONPATH PYTHONPYCACHEPREFIX
EOF_ENV
chmod 600 "$consumer_range/env"

cat > "$consumer_range/cmd/$command_name" <<EOF_COMMAND
#!/usr/bin/env m
. "\$m_LIB_DIR/sys/sh/pkg/pkg-launch.lib.sh"
launcher "$consumer" "\$@"
EOF_COMMAND
chmod 600 "$consumer_range/cmd/$command_name"
printf '%s\n' bin/poc-pure > "$consumer_range/link/$command_name"

"$root/m" "$integration_driver" integrate "$consumer" 1 "$consumer_range" "$payload"
run_pkg default "$consumer@1" >/dev/null

consumer_home=$("$root/m" "$root/bin/sys/state-path" user pkg "$consumer" home)
consumer_state=${consumer_home%/home}
cache=$consumer_home/.cache/python
package_root=$root/pkg/$consumer@1/root

run_managed()
{
    out=$1
    PATH="$root/bin/ext:$root/bin/sys:$PATH"
    export PATH
    "$command_name" > "$out"
}

run_managed "$work/first.out"
grep -Fx 'fixture=pure' "$work/first.out" >/dev/null

if find "$package_root" -type d -name __pycache__ -print | grep . >/dev/null 2>&1; then
    echo "ERROR package root contains __pycache__" >&2
    exit 1
fi
find "$cache" -type f -name '*.pyc' -print | grep . >/dev/null 2>&1 || {
    echo "ERROR no bytecode written to consumer state" >&2
    exit 1
}
module_before=$(sed -n 's/^module=//p' "$work/first.out" | head -n 1)
grep -R -a -l -F "$module_before" "$cache" >/dev/null 2>&1 || {
    echo "ERROR state bytecode does not record first source location" >&2
    exit 1
}
count_before=$(find "$cache" -type f -name '*.pyc' | wc -l | sed 's/[[:space:]]//g')
printf 'package-root-bytecode=PASS_NONE\n'
printf 'state-bytecode-files-before-move=%s\n' "$count_before"

old_root=$root
root=$work/target-b
mv "$old_root" "$root"
package_root=$root/pkg/$consumer@1/root

run_managed "$work/second.out"
grep -Fx 'fixture=pure' "$work/second.out" >/dev/null
module_after=$(sed -n 's/^module=//p' "$work/second.out" | head -n 1)
[ "$module_after" != "$module_before" ] || {
    echo "ERROR module pathname did not follow relocation" >&2
    exit 1
}
if find "$package_root" -type d -name __pycache__ -print | grep . >/dev/null 2>&1; then
    echo "ERROR relocated package root contains __pycache__" >&2
    exit 1
fi
grep -R -a -l -F "$module_after" "$cache" >/dev/null 2>&1 || {
    echo "ERROR no cache entry for relocated source" >&2
    exit 1
}
grep -R -a -l -F "$module_before" "$cache" >/dev/null 2>&1 || {
    echo "ERROR old cache evidence unexpectedly disappeared" >&2
    exit 1
}
printf 'old-state-cache-harmless-after-relocation=PASS\n'

rm -rf "$cache"
run_managed "$work/third.out"
grep -Fx 'fixture=pure' "$work/third.out" >/dev/null
find "$cache" -type f -name '*.pyc' -print | grep . >/dev/null 2>&1 || {
    echo "ERROR bytecode cache did not regenerate" >&2
    exit 1
}
if grep -R -a -l -F "$module_before" "$cache" >/dev/null 2>&1; then
    echo "ERROR regenerated cache still references old source path" >&2
    exit 1
fi
grep -R -a -l -F "$module_after" "$cache" >/dev/null 2>&1 || {
    echo "ERROR regenerated cache lacks relocated source path" >&2
    exit 1
}
printf 'discard-and-regenerate-state-cache=PASS\n'
printf 'PASS Python bytecode state cache experiment\n'
