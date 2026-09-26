#!/bin/sh
set -eu

[ "$#" -eq 1 ] || {
    echo "usage: $0 /path/to/rumiai-os" >&2
    exit 2
}

source_root=$1
PBS_URL=${PBS_URL:-}
PBS_SHA256=${PBS_SHA256:-}

[ -n "$PBS_URL" ] || { echo "ERROR PBS_URL is required" >&2; exit 2; }
[ -n "$PBS_SHA256" ] || { echo "ERROR PBS_SHA256 is required" >&2; exit 2; }
[ -x "$source_root/m" ] || { echo "ERROR rumiai-os checkout is missing m: $source_root" >&2; exit 2; }

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in cc cksum cp curl find grep head mktemp mv rm sed sha256sum tar; do
    need "$tool"
done

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
poc038_dir=${script_dir%/*}/038-python-environment-late-binding
[ -f "$poc038_dir/build-fixtures.py" ] && [ -f "$poc038_dir/materialize-wheel.py" ] || {
    echo "ERROR PoC 038 helper inputs are missing" >&2
    exit 2
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-pbs-provider-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

archive=$work/python.tar.gz
printf 'download=%s\n' "$PBS_URL"
curl -L --fail --silent --show-error "$PBS_URL" -o "$archive"
actual_sha=$(sha256sum "$archive" | sed 's/[[:space:]].*$//')
[ "$actual_sha" = "$PBS_SHA256" ] || {
    echo "ERROR upstream artifact digest mismatch: $actual_sha" >&2
    exit 1
}
printf 'artifact-sha256=%s\n' "$actual_sha"

runtime_a=$work/runtime-a
mkdir "$runtime_a"
tar -xzf "$archive" -C "$runtime_a"
python_a=$runtime_a/python/bin/python3
[ -x "$python_a" ] || {
    echo "ERROR standalone Python executable missing after extraction" >&2
    find "$runtime_a" -maxdepth 3 -type f -print >&2 || :
    exit 1
}

export PYTHONDONTWRITEBYTECODE=1

probe()
{
    interpreter=$1
    label=$2
    "$interpreter" - "$label" <<'PY'
import ctypes
import hashlib
import os
import sqlite3
import ssl
import sys
import sysconfig

label = sys.argv[1]
print(f"{label}-version={sys.version.split()[0]}")
print(f"{label}-executable={sys.executable}")
print(f"{label}-prefix={sys.prefix}")
print(f"{label}-base-prefix={sys.base_prefix}")
print(f"{label}-include={sysconfig.get_paths().get('include','')}")
print(f"{label}-platlib={sysconfig.get_paths().get('platlib','')}")
print(f"{label}-ext-suffix={sysconfig.get_config_var('EXT_SUFFIX')}")
print(f"{label}-openssl={ssl.OPENSSL_VERSION}")
print(f"{label}-sqlite={sqlite3.sqlite_version}")
print(f"{label}-ctypes={ctypes.sizeof(ctypes.c_void_p)}")
print(f"{label}-sha256={hashlib.sha256(b'rumiai').hexdigest()}")
PY
}

probe "$python_a" before-move > "$work/probe-before.out"
cat "$work/probe-before.out"

old_runtime=$runtime_a
runtime_b=$work/runtime-b
mv "$runtime_a" "$runtime_b"
python_b=$runtime_b/python/bin/python3
[ -x "$python_b" ] || { echo "ERROR moved standalone Python executable missing" >&2; exit 1; }

probe "$python_b" after-move > "$work/probe-after.out"
cat "$work/probe-after.out"

after_prefix=$("$python_b" -c 'import sys; print(sys.prefix)')
[ "$after_prefix" = "$runtime_b/python" ] || {
    echo "ERROR moved standalone sys.prefix is not the live runtime prefix: $after_prefix" >&2
    exit 1
}
after_include=$("$python_b" -c 'import sysconfig; print(sysconfig.get_paths()["include"])')
case "$after_include" in
    "$runtime_b/python"/*) : ;;
    *)
        echo "ERROR moved standalone sysconfig include is not live-prefix based: $after_include" >&2
        exit 1
        ;;
esac
printf 'standalone-runtime-direct-relocation=PASS\n'
printf 'standalone-sysconfig-live-prefix=PASS\n'

# Build both fixture wheels after relocation. The native build exercises the
# relocated interpreter's current headers/sysconfig through a real compiler.
wheels=$work/wheels
mkdir "$wheels"
"$python_b" "$poc038_dir/build-fixtures.py" --output "$wheels" > "$work/build-fixtures.out"
cat "$work/build-fixtures.out"
pure_wheel=$wheels/rumiai_poc_pure-1.0-py3-none-any.whl
native_wheel=$(find "$wheels" -name 'rumiai_poc_native-1.0-*.whl' -print | head -n 1)
[ -f "$pure_wheel" ] && [ -n "$native_wheel" ] && [ -f "$native_wheel" ] || {
    echo "ERROR relocated standalone Python did not build expected wheels" >&2
    exit 1
}
printf 'native-build-after-runtime-move=PASS\n'

pure_payload=$work/pure-payload
native_payload=$work/native-payload
"$python_b" "$poc038_dir/materialize-wheel.py" "$pure_wheel" "$pure_payload" > "$work/materialize-pure.out"
"$python_b" "$poc038_dir/materialize-wheel.py" "$native_wheel" "$native_payload" > "$work/materialize-native.out"
for command_path in "$pure_payload/bin/poc-pure" "$pure_payload/bin/poc-data" "$native_payload/bin/poc-native"
do
    [ "$(head -n 1 "$command_path")" = '#!/usr/bin/env python' ] || {
        echo "ERROR materialized Python command has non-env shebang: $command_path" >&2
        exit 1
    }
done
printf 'materialized-shebangs=PASS_ENV_PYTHON\n'

# Work only in a disposable copy of the exact product checkout.
target_a=$work/target-a
cp -R "$source_root" "$target_a"
root=$target_a
if [ ! -e "$root/pkg" ] && [ ! -L "$root/pkg" ]; then mkdir "$root/pkg"; fi
[ -d "$root/pkg" ] && [ ! -L "$root/pkg" ] || {
    echo "ERROR disposable package store invalid" >&2
    exit 1
}

host_path=$PATH

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

facility=poc39python
provider=poc39pbs
pure_consumer=poc39pure
native_consumer=poc39native

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

provider_range=$work/range-$provider
provider_payload=$work/payload-$provider
mkdir -p "$provider_range/facility-cmd/$facility" "$provider_range/facility-env" "$provider_payload"
printf '%s %s\n' "$facility" 1 > "$provider_range/facility"
printf '%s\n' python/bin/python3 > "$provider_range/facility-cmd/$facility/python"
tab=$(printf '\t')
{
    printf 'PYTHONDONTWRITEBYTECODE%sliteral 1\n' "$tab"
    printf 'RUMIAI_PYTHON_PROVIDER%sliteral standalone\n' "$tab"
} > "$provider_range/facility-env/$facility"
cp -R "$runtime_b/python" "$provider_payload/python"

"$root/m" "$integration_driver" integrate "$provider" 1 "$provider_range" "$provider_payload"
run_pkg default "$provider@1" >/dev/null
run_pkg provider default "$facility" "$provider" >/dev/null
printf 'standalone-provider-integration=PASS\n'

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
    for command_name in "$@"
    do
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

make_consumer "$pure_consumer" "$pure_payload" poc-pure poc-data
make_consumer "$native_consumer" "$native_payload" poc-native
printf 'standalone-consumers-integration=PASS\n'

run_managed poc-pure > "$work/pure-before-root-move.out"
assert_line "$work/pure-before-root-move.out" 'fixture=pure'
assert_line "$work/pure-before-root-move.out" 'provider=standalone'
assert_line "$work/pure-before-root-move.out" 'version=3.13'

run_managed poc-native > "$work/native-before-root-move.out"
assert_line "$work/native-before-root-move.out" 'fixture=native'
assert_line "$work/native-before-root-move.out" 'provider=standalone'
assert_line "$work/native-before-root-move.out" 'native=native-ok'
printf 'managed-standalone-pure-and-native=PASS\n'

# Exercise the provider directly through global facility command publication.
PATH="$root/bin/ext:$root/bin/sys:$host_path"
export PATH
managed_prefix=$(python -c 'import sys; print(sys.prefix)')
case "$managed_prefix" in
    "$root/pkg/$provider@1/root/python") : ;;
    *)
        echo "ERROR globally projected Python has unexpected prefix: $managed_prefix" >&2
        exit 1
        ;;
esac
managed_include=$(python -c 'import sysconfig; print(sysconfig.get_paths()["include"])')
case "$managed_include" in
    "$root/pkg/$provider@1/root/python"/*) : ;;
    *)
        echo "ERROR managed provider sysconfig include is not live-prefix based: $managed_include" >&2
        exit 1
        ;;
esac
printf 'managed-standalone-sysconfig=PASS\n'

old_root=$root
relocated=$work/target-b
mv "$old_root" "$relocated"
root=$relocated

run_managed poc-pure > "$work/pure-after-root-move.out"
assert_line "$work/pure-after-root-move.out" 'provider=standalone'
run_managed poc-data > "$work/data-after-root-move.out"
assert_line "$work/data-after-root-move.out" 'provider=standalone'
run_managed poc-native > "$work/native-after-root-move.out"
assert_line "$work/native-after-root-move.out" 'native=native-ok'

PATH="$root/bin/ext:$root/bin/sys:$host_path"
export PATH
relocated_prefix=$(python -c 'import sys; print(sys.prefix)')
[ "$relocated_prefix" = "$root/pkg/$provider@1/root/python" ] || {
    echo "ERROR relocated managed provider prefix is stale: $relocated_prefix" >&2
    exit 1
}
printf 'managed-root-relocation-with-provider=PASS\n'

"$python_b" - "$old_root" "$root/pkg/$provider@1" "$root/pkg/$pure_consumer@1" "$root/pkg/$native_consumer@1" <<'PY_SCAN'
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
    print("old-managed-prefix-hits:")
    print("\n".join(hits))
    raise SystemExit(1)
PY_SCAN
printf 'managed-old-prefix-scan=PASS\n'

# The original arbitrary extraction path should not become a durable dependency.
"$python_b" - "$old_runtime" "$root/pkg/$provider@1" <<'PY_SCAN2'
import pathlib
import sys
needle = sys.argv[1].encode()
hits = []
for path in pathlib.Path(sys.argv[2]).rglob('*'):
    if path.is_file() and not path.is_symlink():
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if needle in data:
            hits.append(str(path))
print(f"initial-extraction-prefix-hit-count={len(hits)}")
for hit in hits[:20]:
    print("initial-extraction-prefix-hit=" + hit)
if hits:
    raise SystemExit(1)
PY_SCAN2

if find "$root/pkg/$provider@1/root" "$root/pkg/$pure_consumer@1/root" "$root/pkg/$native_consumer@1/root" -type d -name __pycache__ -print | grep . >/dev/null 2>&1
then
    echo "ERROR Python wrote bytecode cache into immutable managed package roots" >&2
    exit 1
fi
printf 'package-root-bytecode-cache=PASS_NONE\n'
printf 'PASS python-build-standalone relocatable provider experiment\n'
