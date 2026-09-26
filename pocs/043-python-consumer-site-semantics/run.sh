#!/bin/sh
set -eu

PYTHON=${PYTHON:-python3}
command -v "$PYTHON" >/dev/null 2>&1 || {
    echo "ERROR Python unavailable: $PYTHON" >&2
    exit 2
}

for tool in cp grep mkdir mktemp mv rm; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "ERROR missing tool: $tool" >&2
        exit 2
    }
done

physical_dir()
{
    (
        CDPATH= cd "$1" 2>/dev/null
        pwd -P
    )
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-python-site-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

tree_a=$work/tree-a
mkdir -p "$tree_a/site-packages/extras"
site_a=$(physical_dir "$tree_a/site-packages")

cat > "$site_a/poc43.pth" <<'EOF_PTH'
extras
import builtins; builtins.POC43_PTH_SIDE_EFFECT = "executed"
EOF_PTH

cat > "$site_a/extras/pthprobe.py" <<'EOF_PROBE'
VALUE = "pth-extra-visible"
EOF_PROBE

probe_code='import builtins, pthprobe; print("probe=" + pthprobe.VALUE); print("side-effect=" + getattr(builtins, "POC43_PTH_SIDE_EFFECT", "missing"))'

# Control: ordinary venv site-packages processes .pth files.
venv=$work/venv
"$PYTHON" -m venv "$venv"
venv_python=$venv/bin/python
[ -x "$venv_python" ] || {
    echo "ERROR venv Python missing" >&2
    exit 1
}
venv_site=$("$venv_python" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
cp -R "$site_a/." "$venv_site/"
"$venv_python" -c "$probe_code" > "$work/venv.out"
grep -Fx 'probe=pth-extra-visible' "$work/venv.out" >/dev/null
grep -Fx 'side-effect=executed' "$work/venv.out" >/dev/null
printf 'ordinary-site-pth-processing=PASS\n'

# Bare PYTHONPATH exposes the directory itself but does not process its .pth.
PYTHONPATH="$site_a" "$PYTHON" - "$site_a" > "$work/pythonpath.out" <<'PY_PYTHONPATH'
import builtins
import importlib.util
import sys

site = sys.argv[1]
print("site-on-sys-path=" + ("yes" if site in sys.path else "no"))
print("pth-extra-spec=" + ("yes" if importlib.util.find_spec("pthprobe") else "no"))
print("side-effect=" + getattr(builtins, "POC43_PTH_SIDE_EFFECT", "missing"))
PY_PYTHONPATH

grep -Fx 'site-on-sys-path=yes' "$work/pythonpath.out" >/dev/null
grep -Fx 'pth-extra-spec=no' "$work/pythonpath.out" >/dev/null
grep -Fx 'side-effect=missing' "$work/pythonpath.out" >/dev/null
printf 'bare-pythonpath-pth-processing=PASS_EXPECTED_MISSING\n'

# Python-native site processing restores ordinary .pth semantics.
PYTHONPATH="$site_a" "$PYTHON" - "$site_a" > "$work/addsitedir.out" <<'PY_ADDSITEDIR'
import builtins
import site
import sys

site_dir = sys.argv[1]
site.addsitedir(site_dir)
import pthprobe
print("probe=" + pthprobe.VALUE)
print("side-effect=" + getattr(builtins, "POC43_PTH_SIDE_EFFECT", "missing"))
print("site-dir=" + site_dir)
PY_ADDSITEDIR

grep -Fx 'probe=pth-extra-visible' "$work/addsitedir.out" >/dev/null
grep -Fx 'side-effect=executed' "$work/addsitedir.out" >/dev/null
printf 'explicit-addsitedir-pth-processing=PASS\n'

# Move the complete consumer-style tree and repeat without rewriting it.
tree_b=$work/tree-b
mv "$tree_a" "$tree_b"
site_b=$(physical_dir "$tree_b/site-packages")

PYTHONPATH="$site_b" "$PYTHON" - "$site_b" > "$work/relocated.out" <<'PY_RELOCATED'
import builtins
import site
import sys

site_dir = sys.argv[1]
site.addsitedir(site_dir)
import pthprobe
print("probe=" + pthprobe.VALUE)
print("side-effect=" + getattr(builtins, "POC43_PTH_SIDE_EFFECT", "missing"))
print("module=" + pthprobe.__file__)
PY_RELOCATED

grep -Fx 'probe=pth-extra-visible' "$work/relocated.out" >/dev/null
grep -Fx 'side-effect=executed' "$work/relocated.out" >/dev/null
module=$(sed -n 's/^module=//p' "$work/relocated.out")
case "$module" in
    "$site_b"/extras/pthprobe.py) : ;;
    *)
        echo "ERROR relocated .pth path did not follow moved site tree: $module" >&2
        exit 1
        ;;
esac
printf 'relocated-explicit-site-processing=PASS\n'
printf 'PASS Python consumer site semantics experiment\n'
