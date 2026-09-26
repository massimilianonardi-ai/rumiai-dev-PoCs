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

for tool in curl grep head mktemp mv rm sed tar; do
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

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-python-site-hook-poc.XXXXXX")
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

provider_a=$work/provider-a
mkdir "$provider_a"
tar -xzf "$archive" -C "$provider_a"
python_a=$provider_a/python/bin/python3
[ -x "$python_a" ] || { echo "ERROR standalone Python missing" >&2; exit 1; }

provider_site=$("$python_a" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
case "$provider_site" in
    "$provider_a"/python/* | "$(physical_dir "$provider_a")"/python/*) : ;;
    *)
        echo "ERROR provider purelib is outside provider: $provider_site" >&2
        exit 1
        ;;
esac
mkdir -p "$provider_site"

hook=$provider_site/rumiai_poc046_consumer_site.pth
cat > "$hook" <<'EOF_HOOK'
import os,site; p=os.environ.get("POC46_CONSUMER_SITE"); p and site.addsitedir(p)
EOF_HOOK

if grep -F "$provider_a" "$hook" >/dev/null 2>&1; then
    echo "ERROR provider hook embeds provider path" >&2
    exit 1
fi

consumer_a=$work/consumer-a
consumer_site=$consumer_a/python/site-packages
mkdir -p "$consumer_site/poc46pkg" "$consumer_site/extras" "$consumer_a/bin"

cat > "$consumer_site/poc46.pth" <<'EOF_PTH'
extras
import builtins; builtins.POC46_PTH_SIDE_EFFECT = "executed"
EOF_PTH

cat > "$consumer_site/extras/pthprobe.py" <<'EOF_EXTRA'
VALUE = "pth-extra-visible"
EOF_EXTRA

cat > "$consumer_site/poc46pkg/__init__.py" <<'EOF_PACKAGE'
import builtins
import os
import subprocess
import sys

def main():
    import pthprobe

    print("fixture=consumer-site-hook")
    print("extra=" + pthprobe.VALUE)
    print("side-effect=" + getattr(builtins, "POC46_PTH_SIDE_EFFECT", "missing"))
    print("executable=" + sys.executable)
    print("module=" + __file__)

    child = subprocess.check_output(
        [
            "python",
            "-c",
            (
                "import builtins,pthprobe;"
                "print('child-extra=' + pthprobe.VALUE);"
                "print('child-side-effect=' + "
                "getattr(builtins,'POC46_PTH_SIDE_EFFECT','missing'))"
            ),
        ],
        env=os.environ,
        text=True,
    )
    print(child, end="")
    return 0
EOF_PACKAGE

command=$consumer_a/bin/poc46
cat > "$command" <<'EOF_COMMAND'
#!/usr/bin/env python
from poc46pkg import main
raise SystemExit(main())
EOF_COMMAND
chmod 700 "$command"

export PYTHONDONTWRITEBYTECODE=1
host_path=$PATH

run_direct_probe()
{
    python=$1
    site_dir=$2
    output=$3

    POC46_CONSUMER_SITE=$site_dir     PATH="${python%/*}:$host_path"     "$python" - <<'PY_PROBE' > "$output"
import builtins
import pthprobe
import poc46pkg
print("direct-extra=" + pthprobe.VALUE)
print("direct-side-effect=" + getattr(builtins, "POC46_PTH_SIDE_EFFECT", "missing"))
print("direct-module=" + poc46pkg.__file__)
PY_PROBE
}

run_command()
{
    provider_python=$1
    site_dir=$2
    command_path=$3
    output=$4

    POC46_CONSUMER_SITE=$site_dir     PATH="${provider_python%/*}:$host_path"     "$command_path" > "$output"
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

consumer_site_physical=$(physical_dir "$consumer_site")

run_direct_probe "$python_a" "$consumer_site_physical" "$work/direct-a.out"
assert_line "$work/direct-a.out" 'direct-extra=pth-extra-visible'
assert_line "$work/direct-a.out" 'direct-side-effect=executed'
printf 'direct-provider-python-consumer-site=PASS\n'

run_command "$python_a" "$consumer_site_physical" "$command" "$work/command-a.out"
assert_line "$work/command-a.out" 'fixture=consumer-site-hook'
assert_line "$work/command-a.out" 'extra=pth-extra-visible'
assert_line "$work/command-a.out" 'side-effect=executed'
assert_line "$work/command-a.out" 'child-extra=pth-extra-visible'
assert_line "$work/command-a.out" 'child-side-effect=executed'
printf 'env-python-command-consumer-site=PASS\n'
printf 'child-python-inherits-consumer-site=PASS\n'

old_provider=$(physical_dir "$provider_a")
old_consumer=$(physical_dir "$consumer_a")

provider_b=$work/provider-b
consumer_b=$work/consumer-b
mv "$provider_a" "$provider_b"
mv "$consumer_a" "$consumer_b"

provider_b_physical=$(physical_dir "$provider_b")
consumer_b_physical=$(physical_dir "$consumer_b")
python_b=$provider_b/python/bin/python3
consumer_site_b=$consumer_b_physical/python/site-packages
command_b=$consumer_b/bin/poc46

[ -x "$python_b" ] && [ -x "$command_b" ] || {
    echo "ERROR moved provider or consumer command missing" >&2
    exit 1
}

run_direct_probe "$python_b" "$consumer_site_b" "$work/direct-b.out"
assert_line "$work/direct-b.out" 'direct-extra=pth-extra-visible'
assert_line "$work/direct-b.out" 'direct-side-effect=executed'

run_command "$python_b" "$consumer_site_b" "$command_b" "$work/command-b.out"
assert_line "$work/command-b.out" 'fixture=consumer-site-hook'
assert_line "$work/command-b.out" 'child-extra=pth-extra-visible'
assert_line "$work/command-b.out" 'child-side-effect=executed'

module_b=$(sed -n 's/^module=//p' "$work/command-b.out" | head -n 1)
case "$module_b" in
    "$consumer_site_b"/poc46pkg/__init__.py) : ;;
    *)
        echo "ERROR consumer module did not follow relocation: $module_b" >&2
        exit 1
        ;;
esac

printf 'provider-and-consumer-relocation=PASS\n'

moved_hook=$provider_b/python/lib/python3.13/site-packages/rumiai_poc046_consumer_site.pth
[ -f "$moved_hook" ] || {
    moved_hook=$(find "$provider_b/python" -path '*/site-packages/rumiai_poc046_consumer_site.pth' -print | head -n 1)
}
[ -n "$moved_hook" ] && [ -f "$moved_hook" ] || {
    echo "ERROR moved provider hook missing" >&2
    exit 1
}

for needle in "$old_provider" "$old_consumer"
do
    if grep -a -F "$needle" "$moved_hook" "$command_b" >/dev/null 2>&1
    then
        echo "ERROR static hook/command retained old path: $needle" >&2
        exit 1
    fi
done

printf 'static-hook-command-old-prefix-scan=PASS\n'
printf 'PASS Python provider consumer-site hook experiment\n'
