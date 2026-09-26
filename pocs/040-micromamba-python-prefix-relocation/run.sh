#!/bin/sh
set -eu

MICROMAMBA_URL=${MICROMAMBA_URL:-}
MICROMAMBA_SHA256=${MICROMAMBA_SHA256:-}

[ -n "$MICROMAMBA_URL" ] || { echo "ERROR MICROMAMBA_URL is required" >&2; exit 2; }
[ -n "$MICROMAMBA_SHA256" ] || { echo "ERROR MICROMAMBA_SHA256 is required" >&2; exit 2; }

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in chmod curl find grep head mktemp mv rm sed sort wc; do
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

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-micromamba-python-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

micromamba=$work/micromamba
curl -L --fail --silent --show-error "$MICROMAMBA_URL" -o "$micromamba"
chmod 700 "$micromamba"
actual_sha=$(sha256_file "$micromamba")
[ "$actual_sha" = "$MICROMAMBA_SHA256" ] || {
    echo "ERROR micromamba digest mismatch: $actual_sha" >&2
    exit 1
}
printf 'micromamba-sha256=%s\n' "$actual_sha"
"$micromamba" --version

export MAMBA_ROOT_PREFIX=$work/mamba-root
prefix_a=$work/env-a
"$micromamba" create -y -q -p "$prefix_a" -c conda-forge 'python=3.13' pip

prefix_a_physical=$(physical_dir "$prefix_a")
python_a=$prefix_a/bin/python
pip_a=$prefix_a/bin/pip
[ -x "$python_a" ] && [ -x "$pip_a" ] || {
    echo "ERROR Python/pip missing from created prefix" >&2
    exit 1
}

probe()
{
    interpreter=$1
    label=$2
    "$interpreter" - "$label" <<'PY'
import ctypes
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
print(f"{label}-openssl={ssl.OPENSSL_VERSION}")
print(f"{label}-sqlite={sqlite3.sqlite_version}")
print(f"{label}-ctypes={ctypes.sizeof(ctypes.c_void_p)}")
PY
}

probe "$python_a" before-move > "$work/before.out"
cat "$work/before.out"

before_prefix=$("$python_a" -c 'import sys; print(sys.prefix)')
before_prefix_physical=$(physical_dir "$before_prefix")
[ "$before_prefix_physical" = "$prefix_a_physical" ] || {
    echo "ERROR CPython prefix does not resolve to the environment directory: $before_prefix" >&2
    exit 1
}
printf 'before-prefix-lexical=%s\n' "$before_prefix"
printf 'before-prefix-physical=%s\n' "$before_prefix_physical"

pip_shebang=$(head -n 1 "$pip_a")
printf 'pip-shebang=%s\n' "$pip_shebang"

"$python_a" - "$MAMBA_ROOT_PREFIX/pkgs" <<'PY_META'
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
files = 0
entries = 0
placeholders = 0
python_placeholders = 0
examples = []
for path in root.rglob("info/paths.json"):
    files += 1
    try:
        data = json.loads(path.read_text())
    except Exception:
        continue
    package = path.parent.parent.name
    for entry in data.get("paths", []):
        entries += 1
        placeholder = entry.get("prefix_placeholder")
        if placeholder is not None:
            placeholders += 1
            if package.startswith("python-"):
                python_placeholders += 1
            if len(examples) < 20:
                examples.append((package, entry.get("_path", ""), placeholder, entry.get("file_mode", "")))
print(f"conda-paths-json-files={files}")
print(f"conda-path-entries={entries}")
print(f"conda-prefix-placeholder-entries={placeholders}")
print(f"conda-python-prefix-placeholder-entries={python_placeholders}")
for package, rel, placeholder, mode in examples:
    print(f"conda-prefix-placeholder={package}|{rel}|{mode}|{placeholder}")
PY_META

before_hits_lexical=$(grep -R -a -l -F "$before_prefix" "$prefix_a" 2>/dev/null | wc -l | sed 's/[[:space:]]//g')
printf 'old-prefix-hit-files-before-move-lexical=%s\n' "$before_hits_lexical"
if [ "$before_prefix" = "$before_prefix_physical" ]
then
    before_hits_physical=$before_hits_lexical
else
    before_hits_physical=$(grep -R -a -l -F "$before_prefix_physical" "$prefix_a" 2>/dev/null | wc -l | sed 's/[[:space:]]//g')
fi
printf 'old-prefix-hit-files-before-move-physical=%s\n' "$before_hits_physical"

prefix_b=$work/env-b
mv "$prefix_a" "$prefix_b"
prefix_b_physical=$(physical_dir "$prefix_b")
python_b=$prefix_b/bin/python
pip_b=$prefix_b/bin/pip

probe "$python_b" after-move > "$work/after.out"
cat "$work/after.out"
after_prefix=$("$python_b" -c 'import sys; print(sys.prefix)')
after_prefix_physical=$(physical_dir "$after_prefix")
[ "$after_prefix_physical" = "$prefix_b_physical" ] || {
    echo "ERROR moved CPython prefix does not resolve to moved environment: $after_prefix" >&2
    exit 1
}
printf 'after-prefix-lexical=%s\n' "$after_prefix"
printf 'after-prefix-physical=%s\n' "$after_prefix_physical"
printf 'conda-python-direct-relocation=PASS\n'

"$python_b" -m pip --version > "$work/python-m-pip.out"
cat "$work/python-m-pip.out"
printf 'moved-python-module-pip=PASS\n'

set +e
"$pip_b" --version > "$work/pip-direct.out" 2> "$work/pip-direct.err"
pip_status=$?
set -e
printf 'moved-pip-direct-status=%s\n' "$pip_status"
if [ "$pip_status" -eq 0 ]
then
    cat "$work/pip-direct.out"
    printf 'moved-pip-direct=WORKS\n'
else
    cat "$work/pip-direct.err" >&2 || :
    printf 'moved-pip-direct=BREAKS\n'
fi

"$micromamba" list -p "$prefix_b" > "$work/list-after-move.out"
grep -E '^(python|pip)[[:space:]]' "$work/list-after-move.out" || :
printf 'micromamba-recognizes-moved-prefix=PASS\n'

after_hits_lexical=$(grep -R -a -l -F "$before_prefix" "$prefix_b" 2>/dev/null | wc -l | sed 's/[[:space:]]//g')
printf 'old-prefix-hit-files-after-move-lexical=%s\n' "$after_hits_lexical"
if [ "$before_prefix" = "$before_prefix_physical" ]
then
    after_hits_physical=$after_hits_lexical
else
    after_hits_physical=$(grep -R -a -l -F "$before_prefix_physical" "$prefix_b" 2>/dev/null | wc -l | sed 's/[[:space:]]//g')
fi
printf 'old-prefix-hit-files-after-move-physical=%s\n' "$after_hits_physical"

printf 'old-prefix-hit-examples-after-move:\n'
grep -R -a -l -F "$before_prefix" "$prefix_b" 2>/dev/null | LC_ALL=C sort | head -n 20 || :

printf 'PASS micromamba Python prefix relocation experiment\n'
