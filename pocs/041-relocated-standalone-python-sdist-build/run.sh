#!/bin/sh
set -eu

PBS_URL=${PBS_URL:-}
PBS_SHA256=${PBS_SHA256:-}

[ -n "$PBS_URL" ] || { echo "ERROR PBS_URL is required" >&2; exit 2; }
[ -n "$PBS_SHA256" ] || { echo "ERROR PBS_SHA256 is required" >&2; exit 2; }

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in cc chmod cksum curl find grep head mkdir mktemp mv rm sed sort tar; do
    need "$tool"
done

physical_dir()
{
    (
        CDPATH= cd "$1" 2>/dev/null
        pwd -P
    )
}

sha256_file()
{
    if command -v sha256sum >/dev/null 2>&1
    then
        sha256sum "$1" | sed 's/[[:space:]].*$//'
    elif command -v shasum >/dev/null 2>&1
    then
        shasum -a 256 "$1" | sed 's/[[:space:]].*$//'
    else
        echo "ERROR no SHA-256 command available" >&2
        return 1
    fi
}

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
poc038_dir=${script_dir%/*}/038-python-environment-late-binding
[ -f "$poc038_dir/materialize-wheel.py" ] || {
    echo "ERROR PoC 038 wheel materializer missing" >&2
    exit 2
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-pbs-sdist-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

archive=$work/python.tar.gz
curl -L --fail --silent --show-error "$PBS_URL" -o "$archive"
actual_sha=$(sha256_file "$archive")
[ "$actual_sha" = "$PBS_SHA256" ] || {
    echo "ERROR upstream artifact digest mismatch: $actual_sha" >&2
    exit 1
}
printf 'artifact-sha256=%s\n' "$actual_sha"

runtime_a=$work/runtime-a
mkdir "$runtime_a"
tar -xzf "$archive" -C "$runtime_a"
[ -x "$runtime_a/python/bin/python3" ] || {
    echo "ERROR standalone Python executable missing" >&2
    exit 1
}

runtime_b=$work/runtime-b
mv "$runtime_a" "$runtime_b"
runtime_b_physical=$(physical_dir "$runtime_b")
python_b=$runtime_b/python/bin/python3
[ -x "$python_b" ] || {
    echo "ERROR standalone Python missing after first relocation" >&2
    exit 1
}

runtime_cache_snapshot()
{
    cache_root=$1
    (
        cd "$cache_root"
        find . -type f -path '*/__pycache__/*' -exec cksum {} \; |
            LC_ALL=C sort |
            cksum
    )
}

runtime_cache_count()
{
    cache_root=$1
    (
        cd "$cache_root"
        find . -type f -path '*/__pycache__/*' -print | wc -l | sed 's/[[:space:]]//g'
    )
}

runtime_cache_before=$(runtime_cache_snapshot "$runtime_b/python")
runtime_cache_count_before=$(runtime_cache_count "$runtime_b/python")
printf 'runtime-preexisting-bytecode-files=%s\n' "$runtime_cache_count_before"

PYTHONPYCACHEPREFIX="$work/build-pycache"
export PYTHONPYCACHEPREFIX

prefix_b=$("$python_b" -c 'import sys; print(sys.prefix)')
[ "$prefix_b" = "$runtime_b_physical/python" ] || {
    echo "ERROR first relocated sys.prefix is stale: $prefix_b" >&2
    exit 1
}
"$python_b" -m pip --version
printf 'relocated-runtime-pip=PASS\n'

src=$work/src
mkdir -p "$src/rumiai_sdist_pure-1.0/rumiai_sdist_pure"
cat > "$src/rumiai_sdist_pure-1.0/pyproject.toml" <<'EOF_PURE_PYPROJECT'
[build-system]
requires = ["setuptools==80.9.0", "wheel==0.45.1"]
build-backend = "setuptools.build_meta"
EOF_PURE_PYPROJECT
cat > "$src/rumiai_sdist_pure-1.0/setup.py" <<'EOF_PURE_SETUP'
from setuptools import setup

setup(
    name="rumiai-sdist-pure",
    version="1.0",
    packages=["rumiai_sdist_pure"],
    entry_points={"console_scripts": ["sdist-pure=rumiai_sdist_pure:main"]},
)
EOF_PURE_SETUP
cat > "$src/rumiai_sdist_pure-1.0/rumiai_sdist_pure/__init__.py" <<'EOF_PURE_INIT'
import os
import sys

def main():
    print("fixture=sdist-pure")
    print("provider=" + os.environ.get("RUMIAI_PYTHON_PROVIDER", ""))
    print(f"version={sys.version_info.major}.{sys.version_info.minor}")
    print("executable=" + sys.executable)
    print("module=" + __file__)
    return 0
EOF_PURE_INIT

mkdir -p "$src/rumiai_sdist_native-1.0/rumiai_sdist_native"
cat > "$src/rumiai_sdist_native-1.0/pyproject.toml" <<'EOF_NATIVE_PYPROJECT'
[build-system]
requires = ["setuptools==80.9.0", "wheel==0.45.1"]
build-backend = "setuptools.build_meta"
EOF_NATIVE_PYPROJECT
cat > "$src/rumiai_sdist_native-1.0/setup.py" <<'EOF_NATIVE_SETUP'
from setuptools import Extension, setup

setup(
    name="rumiai-sdist-native",
    version="1.0",
    packages=["rumiai_sdist_native"],
    ext_modules=[Extension("rumiai_sdist_native._nativeprobe", ["nativeprobe.c"])],
    entry_points={"console_scripts": ["sdist-native=rumiai_sdist_native:main"]},
)
EOF_NATIVE_SETUP
cat > "$src/rumiai_sdist_native-1.0/nativeprobe.c" <<'EOF_NATIVE_C'
#include <Python.h>

static PyObject *probe_value(PyObject *self, PyObject *args) {
    return PyUnicode_FromString("native-ok");
}

static PyMethodDef methods[] = {
    {"value", probe_value, METH_NOARGS, "Return native probe marker."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
    PyModuleDef_HEAD_INIT,
    "_nativeprobe",
    NULL,
    -1,
    methods
};

PyMODINIT_FUNC PyInit__nativeprobe(void) {
    return PyModule_Create(&module);
}
EOF_NATIVE_C
cat > "$src/rumiai_sdist_native-1.0/rumiai_sdist_native/__init__.py" <<'EOF_NATIVE_INIT'
import os
import sys
from . import _nativeprobe

def main():
    print("fixture=sdist-native")
    print("provider=" + os.environ.get("RUMIAI_PYTHON_PROVIDER", ""))
    print(f"version={sys.version_info.major}.{sys.version_info.minor}")
    print("executable=" + sys.executable)
    print("native=" + _nativeprobe.value())
    print("module=" + __file__)
    return 0
EOF_NATIVE_INIT

sdists=$work/sdists
mkdir "$sdists"
(
    cd "$src"
    tar -czf "$sdists/rumiai_sdist_pure-1.0.tar.gz" rumiai_sdist_pure-1.0
    tar -czf "$sdists/rumiai_sdist_native-1.0.tar.gz" rumiai_sdist_native-1.0
)

wheels=$work/wheels
mkdir "$wheels"
"$python_b" -m pip wheel --disable-pip-version-check --no-deps --wheel-dir "$wheels"     "$sdists/rumiai_sdist_pure-1.0.tar.gz"
"$python_b" -m pip wheel --disable-pip-version-check --no-deps --wheel-dir "$wheels"     "$sdists/rumiai_sdist_native-1.0.tar.gz"

pure_wheel=$(find "$wheels" -name 'rumiai_sdist_pure-1.0-*.whl' -print | head -n 1)
native_wheel=$(find "$wheels" -name 'rumiai_sdist_native-1.0-*.whl' -print | head -n 1)
[ -n "$pure_wheel" ] && [ -f "$pure_wheel" ] || {
    echo "ERROR pure wheel not produced" >&2
    exit 1
}
[ -n "$native_wheel" ] && [ -f "$native_wheel" ] || {
    echo "ERROR native wheel not produced" >&2
    exit 1
}
printf 'pure-wheel=%s\n' "${pure_wheel##*/}"
printf 'native-wheel=%s\n' "${native_wheel##*/}"
printf 'pip-pep517-sdist-build=PASS\n'

runtime_cache_after_build=$(runtime_cache_snapshot "$runtime_b/python")
runtime_cache_count_after_build=$(runtime_cache_count "$runtime_b/python")
[ "$runtime_cache_after_build" = "$runtime_cache_before" ] || {
    echo "ERROR source build mutated standalone runtime bytecode cache" >&2
    exit 1
}
[ "$runtime_cache_count_after_build" = "$runtime_cache_count_before" ] || {
    echo "ERROR source build changed standalone runtime bytecode cache file count" >&2
    exit 1
}
printf 'build-bytecode-externalized=PASS runtime-cache-count=%s\n' "$runtime_cache_count_after_build"

pure_payload=$work/pure-payload
native_payload=$work/native-payload
"$python_b" "$poc038_dir/materialize-wheel.py" "$pure_wheel" "$pure_payload"
"$python_b" "$poc038_dir/materialize-wheel.py" "$native_wheel" "$native_payload"

for command_path in "$pure_payload/bin/sdist-pure" "$native_payload/bin/sdist-native"
do
    [ "$(head -n 1 "$command_path")" = '#!/usr/bin/env python' ] || {
        echo "ERROR materialized command has non-env shebang: $command_path" >&2
        exit 1
    }
done
printf 'materialized-shebangs=PASS_ENV_PYTHON\n'

host_path=$PATH
unset PYTHONPYCACHEPREFIX
export PYTHONDONTWRITEBYTECODE=1
export RUMIAI_PYTHON_PROVIDER=standalone-sdist

run_payload()
{
    payload=$1
    command_name=$2
    output=$3
    PATH="$runtime_b/python/bin:$host_path"
    PYTHONPATH="$payload/python/site-packages"
    export PATH PYTHONPATH
    "$payload/bin/$command_name" > "$output"
}

run_payload "$pure_payload" sdist-pure "$work/pure-before-second-move.out"
grep -Fx 'fixture=sdist-pure' "$work/pure-before-second-move.out" >/dev/null
grep -Fx 'provider=standalone-sdist' "$work/pure-before-second-move.out" >/dev/null

run_payload "$native_payload" sdist-native "$work/native-before-second-move.out"
grep -Fx 'fixture=sdist-native' "$work/native-before-second-move.out" >/dev/null
grep -Fx 'native=native-ok' "$work/native-before-second-move.out" >/dev/null
printf 'built-wheels-run-before-second-move=PASS\n'

"$python_b" - "$runtime_b_physical" "$pure_wheel" "$native_wheel" "$pure_payload" "$native_payload" <<'PY_SCAN'
import pathlib
import sys

needle = sys.argv[1].encode()
hits = []
for value in sys.argv[2:]:
    root = pathlib.Path(value)
    paths = [root] if root.is_file() else root.rglob("*")
    for path in paths:
        if not path.is_file() or path.is_symlink():
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if needle in data:
            hits.append(str(path))
if hits:
    print("build-prefix-hits:")
    print("\n".join(hits))
    raise SystemExit(1)
PY_SCAN
printf 'build-output-old-runtime-prefix-scan=PASS\n'

runtime_c=$work/runtime-c
mv "$runtime_b" "$runtime_c"
runtime_c_physical=$(physical_dir "$runtime_c")
runtime_b=$runtime_c
python_c=$runtime_c/python/bin/python3

prefix_c=$("$python_c" -c 'import sys; print(sys.prefix)')
[ "$prefix_c" = "$runtime_c_physical/python" ] || {
    echo "ERROR second relocated sys.prefix is stale: $prefix_c" >&2
    exit 1
}

run_payload "$pure_payload" sdist-pure "$work/pure-after-second-move.out"
grep -Fx 'fixture=sdist-pure' "$work/pure-after-second-move.out" >/dev/null
run_payload "$native_payload" sdist-native "$work/native-after-second-move.out"
grep -Fx 'native=native-ok' "$work/native-after-second-move.out" >/dev/null
printf 'built-wheels-run-after-second-runtime-move=PASS\n'

"$python_c" - "$runtime_b_physical" "$runtime_c" <<'PY_RUNTIME_SCAN'
import pathlib
import sys
needle = sys.argv[1].encode()
hits = []
for path in pathlib.Path(sys.argv[2]).rglob("*"):
    if path.is_file() and not path.is_symlink():
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if needle in data:
            hits.append(str(path))
print(f"second-move-old-prefix-hit-count={len(hits)}")
for hit in hits[:20]:
    print("second-move-old-prefix-hit=" + hit)
if hits:
    raise SystemExit(1)
PY_RUNTIME_SCAN

printf 'standalone-runtime-second-relocation=PASS\n'
printf 'PASS relocated standalone Python sdist build experiment\n'
