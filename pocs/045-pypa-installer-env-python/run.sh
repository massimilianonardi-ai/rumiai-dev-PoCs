#!/bin/sh
set -eu

PYTHON=${PYTHON:-python3}
command -v "$PYTHON" >/dev/null 2>&1 || { echo "ERROR Python unavailable: $PYTHON" >&2; exit 2; }
"$PYTHON" -c 'import installer; assert installer.__version__ == "1.0.1"' || {
    echo "ERROR installer 1.0.1 unavailable" >&2
    exit 2
}

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
poc038_dir=${script_dir%/*}/038-python-environment-late-binding

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-installer-poc.XXXXXX")
cleanup() { rm -rf "$work" 2>/dev/null || :; }
trap cleanup 0 HUP INT TERM

export PYTHONDONTWRITEBYTECODE=1

wheels=$work/wheels
mkdir "$wheels"
"$PYTHON" "$poc038_dir/build-fixtures.py" --output "$wheels" >/dev/null
wheel=$wheels/rumiai_poc_pure-1.0-py3-none-any.whl
[ -f "$wheel" ] || { echo "ERROR fixture wheel missing" >&2; exit 1; }

stock=$work/stock
"$PYTHON" "$script_dir/install-wheel.py" stock "$wheel" "$stock" >/dev/null
stock_console=$(head -n 1 "$stock/bin/poc-pure")
stock_data=$(head -n 1 "$stock/bin/poc-data")
case "$stock_console" in
    "#!"/*) : ;;
    *) echo "ERROR stock console shebang is not a concrete path: $stock_console" >&2; exit 1 ;;
esac
case "$stock_data" in
    "#!"/*) : ;;
    *) echo "ERROR stock data-script shebang is not a concrete path: $stock_data" >&2; exit 1 ;;
esac
printf 'stock-console-shebang=%s\n' "$stock_console"
printf 'stock-data-shebang=%s\n' "$stock_data"
printf 'stock-installer-concrete-interpreter=PASS\n'

payload_a=$work/payload-a
"$PYTHON" "$script_dir/install-wheel.py" env "$wheel" "$payload_a" >/dev/null
for command_path in "$payload_a/bin/poc-pure" "$payload_a/bin/poc-data"
do
    [ "$(head -n 1 "$command_path")" = '#!/usr/bin/env python' ] || {
        echo "ERROR env adapter produced wrong shebang: $command_path" >&2
        exit 1
    }
done
printf 'env-adapter-shebangs=PASS\n'

host_path=$PATH
run_payload()
{
    root=$1
    command_name=$2
    out=$3
    PATH="$host_path"
    PYTHONPATH="$root/python/site-packages"
    export PATH PYTHONPATH
    "$root/bin/$command_name" > "$out"
}

run_payload "$payload_a" poc-pure "$work/pure-a.out"
grep -Fx 'fixture=pure' "$work/pure-a.out" >/dev/null
run_payload "$payload_a" poc-data "$work/data-a.out"
grep -Fx 'fixture=pure' "$work/data-a.out" >/dev/null
printf 'env-adapter-execution-before-move=PASS\n'

old_payload=$payload_a
payload_b=$work/payload-b
mv "$payload_a" "$payload_b"

run_payload "$payload_b" poc-pure "$work/pure-b.out"
grep -Fx 'fixture=pure' "$work/pure-b.out" >/dev/null
run_payload "$payload_b" poc-data "$work/data-b.out"
grep -Fx 'fixture=pure' "$work/data-b.out" >/dev/null
printf 'env-adapter-execution-after-move=PASS\n'

"$PYTHON" - "$old_payload" "$payload_b" <<'PY_SCAN'
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
print(f"old-prefix-hit-count={len(hits)}")
for hit in hits[:20]:
    print("old-prefix-hit=" + hit)
if hits:
    raise SystemExit(1)
PY_SCAN

printf 'env-adapter-old-prefix-scan=PASS\n'
printf 'PASS PyPA installer env-python destination experiment\n'
