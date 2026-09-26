#!/bin/sh
set -eu

[ "$#" -eq 1 ] || {
    echo "usage: $0 /path/to/rumiai-os" >&2
    exit 2
}

source_root=$1
PYTHON_A=${PYTHON_A:-}
PYTHON_B=${PYTHON_B:-}

[ -n "$PYTHON_A" ] && [ -x "$PYTHON_A" ] || {
    echo "ERROR PYTHON_A must name an executable CPython interpreter" >&2
    exit 2
}
[ -n "$PYTHON_B" ] && [ -x "$PYTHON_B" ] || {
    echo "ERROR PYTHON_B must name an executable CPython interpreter" >&2
    exit 2
}
[ -x "$source_root/m" ] || {
    echo "ERROR rumiai-os checkout is missing m: $source_root" >&2
    exit 2
}

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in cc cksum cp find grep head mktemp mv rm sed; do
    need "$tool"
done

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-python-env-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

version_a=$("$PYTHON_A" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
version_b=$("$PYTHON_B" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
[ "$version_a" != "$version_b" ] || {
    echo "ERROR PYTHON_A and PYTHON_B must have different major.minor versions" >&2
    exit 2
}

printf 'python-a=%s\n' "$version_a"
printf 'python-b=%s\n' "$version_b"
printf 'python-a-executable=%s\n' "$PYTHON_A"
printf 'python-b-executable=%s\n' "$PYTHON_B"

wheels=$work/wheels
mkdir -p "$wheels"
"$PYTHON_A" "$script_dir/build-fixtures.py" --output "$wheels" > "$work/build-fixtures.out"
cat "$work/build-fixtures.out"
pure_wheel=$wheels/rumiai_poc_pure-1.0-py3-none-any.whl
native_wheel=$(find "$wheels" -name 'rumiai_poc_native-1.0-*.whl' -print | head -n 1)
[ -f "$pure_wheel" ] && [ -n "$native_wheel" ] && [ -f "$native_wheel" ] || {
    echo "ERROR fixture wheel build did not produce expected artifacts" >&2
    exit 1
}

# Control: ordinary venv + pip binds generated scripts to the installation path.
venv_a=$work/venv-a
"$PYTHON_A" -m venv "$venv_a"
"$venv_a/bin/python" -m pip install --disable-pip-version-check --no-deps --no-index "$pure_wheel" >/dev/null
pip_shebang=$(head -n 1 "$venv_a/bin/poc-pure")
pip_data_shebang=$(head -n 1 "$venv_a/bin/poc-data")
case "$pip_shebang" in
    "#!$venv_a"/*) : ;;
    *) echo "ERROR pip console-script control did not embed the venv path: $pip_shebang" >&2; exit 1 ;;
esac
case "$pip_data_shebang" in
    "#!$venv_a"/*) : ;;
    *) echo "ERROR pip wheel-script control did not embed the venv path: $pip_data_shebang" >&2; exit 1 ;;
esac
printf 'pip-console-shebang=%s\n' "$pip_shebang"
printf 'pip-data-shebang=%s\n' "$pip_data_shebang"
"$venv_a/bin/poc-pure" > "$work/pip-before-move.out"

grep -Fx "fixture=pure" "$work/pip-before-move.out" >/dev/null
mv "$venv_a" "$work/venv-moved"
set +e
"$work/venv-moved/bin/poc-pure" > "$work/pip-after-move.out" 2> "$work/pip-after-move.err"
pip_moved_status=$?
set -e
[ "$pip_moved_status" -ne 0 ] || {
    echo "ERROR moved pip/venv command unexpectedly remained executable" >&2
    exit 1
}
printf 'pip-moved-command-status=%s\n' "$pip_moved_status"
printf 'pip-venv-relocation-control=PASS_EXPECTED_BREAKAGE\n'

# Materialize the same wheel without embedding an interpreter location.
pure_payload=$work/pure-payload
native_payload=$work/native-payload
"$PYTHON_A" "$script_dir/materialize-wheel.py" "$pure_wheel" "$pure_payload" > "$work/materialize-pure.out"
"$PYTHON_A" "$script_dir/materialize-wheel.py" "$native_wheel" "$native_payload" > "$work/materialize-native.out"
cat "$work/materialize-pure.out"
cat "$work/materialize-native.out"

for command in "$pure_payload/bin/poc-pure" "$pure_payload/bin/poc-data" "$native_payload/bin/poc-native"; do
    [ "$(head -n 1 "$command")" = '#!/usr/bin/env python' ] || {
        echo "ERROR non-relocatable generated shebang: $command" >&2
        exit 1
    }
done
printf 'materialized-shebangs=PASS_ENV_PYTHON\n'

# Work only in a disposable copy of the exact product checkout.
target_a=$work/target-a
cp -R "$source_root" "$target_a"
root=$target_a
[ -x "$root/m" ] && [ -x "$root/bin/sys/pkg" ] || {
    echo "ERROR disposable rumiai-os copy is incomplete" >&2
    exit 1
}

host_path=$PATH
export POC38_PYTHON_A=$PYTHON_A
export POC38_PYTHON_B=$PYTHON_B

run_pkg()
{
    "$root/m" "$root/bin/sys/pkg" "$@"
}

run_managed()
{
    command_name=$1
    shift
    PATH="$root/bin/ext:$root/bin/sys:$host_path"
    export PATH
    "$command_name" "$@"
}

assert_line()
{
    file=$1
    line=$2
    grep -Fx "$line" "$file" >/dev/null 2>&1 || {
        echo "ERROR missing '$line' in $file" >&2
        cat "$file" >&2
        exit 1
    }
}

facility=poc38python
provider_a=poc38pya
provider_b=poc38pyb
pure_consumer=poc38pure
native_consumer=poc38native

integration_driver=$work/integration-driver
cat > "$integration_driver" <<'EOF_DRIVER'
#!/usr/bin/env m
. "$m_LIB_DIR/sys/sh/pkg/pkg-integration.lib.sh" || exit 3
action=$1
shift
case $action in
    integrate)
        [ -f "$3/format" ] || printf '%s\n' tar.gz > "$3/format" || exit 3
        pkg_integrate "$@"
        ;;
    *) exit 2 ;;
esac
EOF_DRIVER
chmod 700 "$integration_driver"

make_provider()
{
    package=$1
    marker=$2
    variable=$3
    range=$work/range-$package
    payload=$work/payload-$package
    mkdir -p "$range/facility-cmd/$facility" "$payload/bin"
    printf '%s %s\n' "$facility" 1 > "$range/facility"
    printf '%s\n' bin/python > "$range/facility-cmd/$facility/python"
    cat > "$payload/bin/python" <<EOF_PROVIDER
#!/bin/sh
RUMIAI_PYTHON_PROVIDER=$marker
export RUMIAI_PYTHON_PROVIDER
exec "\${$variable}" "\$@"
EOF_PROVIDER
    chmod 700 "$payload/bin/python"
    "$root/m" "$integration_driver" integrate "$package" 1 "$range" "$payload"
    run_pkg default "$package@1" >/dev/null
}

make_consumer()
{
    package=$1
    payload=$2
    shift 2
    range=$work/range-$package
    mkdir -p "$range/cmd" "$range/link"
    printf '%s\n' "$facility =1" > "$range/dependency"
    cat > "$range/env" <<'EOF_ENV'
PYTHONPATH="$pkg_launch_root/python/site-packages"
export PYTHONPATH
EOF_ENV
    chmod 600 "$range/env"
    for command_name in "$@"; do
        cat > "$range/cmd/$command_name" <<EOF_COMMAND
#!/usr/bin/env m
. "\$m_LIB_DIR/sys/sh/pkg/pkg-launch.lib.sh"
launcher "$package" "\$@"
EOF_COMMAND
        chmod 600 "$range/cmd/$command_name"
        printf '%s\n' "bin/$command_name" > "$range/link/$command_name"
    done
    "$root/m" "$integration_driver" integrate "$package" 1 "$range" "$payload"
    run_pkg default "$package@1" >/dev/null
}

printf 'rumiai-disposable-root=%s\n' "$root"
make_provider "$provider_a" A POC38_PYTHON_A
printf 'provider-a-integration=PASS\n'
make_provider "$provider_b" B POC38_PYTHON_B
printf 'provider-b-integration=PASS\n'
run_pkg provider default "$facility" "$provider_a"
printf 'facility-default-a-selection=PASS\n'

make_consumer "$pure_consumer" "$pure_payload" poc-pure poc-data
printf 'pure-consumer-integration=PASS\n'
make_consumer "$native_consumer" "$native_payload" poc-native
printf 'native-consumer-integration=PASS\n'

pure_target=$root/pkg/$pure_consumer@1/root/bin/poc-pure
pure_data_target=$root/pkg/$pure_consumer@1/root/bin/poc-data
native_target=$root/pkg/$native_consumer@1/root/bin/poc-native
pure_hash_before=$(cksum "$pure_target")
pure_data_hash_before=$(cksum "$pure_data_target")
native_hash_before=$(cksum "$native_target")

run_managed poc-pure > "$work/pure-default-a.out"
assert_line "$work/pure-default-a.out" 'fixture=pure'
assert_line "$work/pure-default-a.out" 'provider=A'
assert_line "$work/pure-default-a.out" "version=$version_a"
run_managed poc-data > "$work/data-default-a.out"
assert_line "$work/data-default-a.out" 'provider=A'
assert_line "$work/data-default-a.out" "version=$version_a"
printf 'pure-facility-default-a=PASS\n'
printf 'wheel-data-script-default-a=PASS\n'

run_pkg provider bind "$pure_consumer" "$facility" "$provider_b" >/dev/null
run_managed poc-pure > "$work/pure-bound-b.out"
assert_line "$work/pure-bound-b.out" 'provider=B'
assert_line "$work/pure-bound-b.out" "version=$version_b"
[ "$(cksum "$pure_target")" = "$pure_hash_before" ] || {
    echo "ERROR provider binding rewrote the pure console script" >&2
    exit 1
}
printf 'pure-consumer-binding-b=PASS_NO_REWRITE\n'

run_pkg provider bind -u -- "$pure_consumer" "$facility" >/dev/null
run_managed poc-pure > "$work/pure-inherited-a.out"
assert_line "$work/pure-inherited-a.out" 'provider=A'
run_pkg provider default "$facility" "$provider_b" >/dev/null
run_managed poc-pure > "$work/pure-default-b.out"
assert_line "$work/pure-default-b.out" 'provider=B'
assert_line "$work/pure-default-b.out" "version=$version_b"
[ "$(cksum "$pure_target")" = "$pure_hash_before" ] || {
    echo "ERROR facility-default change rewrote the pure console script" >&2
    exit 1
}
printf 'pure-facility-default-b=PASS_NO_REWRITE\n'

# The native extension was built by Python A. It works with A, then fails under B.
run_pkg provider default "$facility" "$provider_a" >/dev/null
run_managed poc-native > "$work/native-a.out"
assert_line "$work/native-a.out" 'native-import-provider=A'
assert_line "$work/native-a.out" "native-import-version=$version_a"
assert_line "$work/native-a.out" 'native=native-ok'
printf 'native-provider-a=PASS\n'

run_pkg provider bind "$native_consumer" "$facility" "$provider_b" >/dev/null
set +e
run_managed poc-native > "$work/native-b.out" 2> "$work/native-b.err"
native_b_status=$?
set -e
[ "$native_b_status" -ne 0 ] || {
    echo "ERROR native extension built for Python A unexpectedly loaded under Python B" >&2
    exit 1
}
assert_line "$work/native-b.out" 'native-import-provider=B'
assert_line "$work/native-b.out" "native-import-version=$version_b"
[ "$(cksum "$native_target")" = "$native_hash_before" ] || {
    echo "ERROR native provider binding rewrote the native console script" >&2
    exit 1
}
printf 'native-provider-b-status=%s\n' "$native_b_status"
printf 'native-abi-mismatch=PASS_EXPECTED_REJECTION\n'
run_pkg provider bind -u -- "$native_consumer" "$facility" >/dev/null

# Physical relocation of the whole managed root must not require consumer rewrites.
run_pkg provider default "$facility" "$provider_a" >/dev/null
old_root=$root
relocated=$work/target-b
mv "$old_root" "$relocated"
root=$relocated
pure_target=$root/pkg/$pure_consumer@1/root/bin/poc-pure
pure_data_target=$root/pkg/$pure_consumer@1/root/bin/poc-data
native_target=$root/pkg/$native_consumer@1/root/bin/poc-native

run_managed poc-pure > "$work/pure-relocated.out"
assert_line "$work/pure-relocated.out" 'provider=A'
assert_line "$work/pure-relocated.out" "version=$version_a"
run_managed poc-data > "$work/data-relocated.out"
assert_line "$work/data-relocated.out" 'provider=A'
run_managed poc-native > "$work/native-relocated.out"
assert_line "$work/native-relocated.out" 'native=native-ok'

[ "$(cksum "$pure_target")" = "$pure_hash_before" ] || {
    echo "ERROR physical relocation changed the pure console script" >&2
    exit 1
}
[ "$(cksum "$pure_data_target")" = "$pure_data_hash_before" ] || {
    echo "ERROR physical relocation changed the wheel data script" >&2
    exit 1
}
[ "$(cksum "$native_target")" = "$native_hash_before" ] || {
    echo "ERROR physical relocation changed the native console script" >&2
    exit 1
}

"$PYTHON_A" - "$old_root" "$root/pkg/$pure_consumer@1" "$root/pkg/$native_consumer@1" <<'PY_SCAN'
import pathlib
import sys
needle = sys.argv[1].encode()
hits = []
for root in map(pathlib.Path, sys.argv[2:]):
    for path in root.rglob('*'):
        if path.is_file() and not path.is_symlink():
            try:
                data = path.read_bytes()
            except OSError:
                continue
            if needle in data:
                hits.append(str(path))
if hits:
    print('old-prefix-hits:')
    print('\n'.join(hits))
    raise SystemExit(1)
PY_SCAN

printf 'managed-root-relocation=PASS\n'
printf 'old-prefix-scan=PASS\n'
printf 'consumer-environment-separate-from-interpreter=PASS\n'
printf 'PASS python environment late-binding experiment\n'
