#!/bin/sh
set -eu

PYTHON_A=${PYTHON_A:-}
PYTHON_B=${PYTHON_B:-}
[ -n "$PYTHON_A" ] && [ -x "$PYTHON_A" ] || { echo "ERROR PYTHON_A required" >&2; exit 2; }
[ -n "$PYTHON_B" ] && [ -x "$PYTHON_B" ] || { echo "ERROR PYTHON_B required" >&2; exit 2; }

script_dir=$(CDPATH= cd "${0%/*}" 2>/dev/null && pwd -P)
poc038_dir=${script_dir%/*}/038-python-environment-late-binding
[ -f "$poc038_dir/materialize-wheel.py" ] || { echo "ERROR PoC 038 materializer missing" >&2; exit 2; }

version_a=$("$PYTHON_A" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
version_b=$("$PYTHON_B" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
[ "$version_a" = 3.12 ] || { echo "ERROR PYTHON_A must be 3.12: $version_a" >&2; exit 2; }
[ "$version_b" = 3.13 ] || { echo "ERROR PYTHON_B must be 3.13: $version_b" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-wheel-tags-poc.XXXXXX")
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup 0 HUP INT TERM

wheels=$work/wheels
mkdir "$wheels"
"$PYTHON_A" "$script_dir/build-wheels.py" --output "$wheels" | tee "$work/build.out"

pure=$(find "$wheels" -name 'rumiai_poc_tag_pure-*.whl' -print | head -n 1)
abi3=$(find "$wheels" -name 'rumiai_poc_tag_abi3-*.whl' -print | head -n 1)
exact=$(find "$wheels" -name 'rumiai_poc_tag_exact-*.whl' -print | head -n 1)
[ -f "$pure" ] && [ -f "$abi3" ] && [ -f "$exact" ] || {
    echo "ERROR expected wheels missing" >&2
    exit 1
}

printf 'pure-wheel=%s\n' "${pure##*/}"
printf 'abi3-wheel=%s\n' "${abi3##*/}"
printf 'exact-wheel=%s\n' "${exact##*/}"

install_and_probe()
{
    python=$1
    wheel=$2
    target=$3
    probe=$4
    rm -rf "$target"
    mkdir "$target"
    "$python" -m pip install --disable-pip-version-check --no-deps --no-index --target "$target" "$wheel" >/dev/null
    PYTHONPATH="$target" "$python" -c "$probe"
}

install_and_probe "$PYTHON_A" "$pure" "$work/pure-a" 'import poc_tag_pure; assert poc_tag_pure.VALUE == "pure-ok"'
install_and_probe "$PYTHON_B" "$pure" "$work/pure-b" 'import poc_tag_pure; assert poc_tag_pure.VALUE == "pure-ok"'
printf 'pure-py3-none-any=PASS_312_313\n'

install_and_probe "$PYTHON_A" "$abi3" "$work/abi3-a" 'import poc_tag_abi3; assert poc_tag_abi3.value() == "abi3-ok"'
install_and_probe "$PYTHON_B" "$abi3" "$work/abi3-b" 'import poc_tag_abi3; assert poc_tag_abi3.value() == "abi3-ok"'
printf 'native-cp38-abi3=PASS_312_313\n'

install_and_probe "$PYTHON_A" "$exact" "$work/exact-a" 'import poc_tag_exact; assert poc_tag_exact.value() == "cp312-ok"'
printf 'native-cp312-cp312=PASS_312\n'

mkdir "$work/exact-b"
set +e
"$PYTHON_B" -m pip install --disable-pip-version-check --no-deps --no-index --target "$work/exact-b" "$exact" >"$work/exact-b.out" 2>"$work/exact-b.err"
exact_b_status=$?
set -e
[ "$exact_b_status" -ne 0 ] || {
    echo "ERROR CPython 3.13 pip accepted cp312-cp312 wheel" >&2
    exit 1
}
printf 'native-cp312-cp312-under-313-status=%s\n' "$exact_b_status"
printf 'native-cp312-cp312=PASS_EXPECTED_313_REJECTION\n'

abi3_payload=$work/abi3-payload
exact_payload=$work/exact-payload
"$PYTHON_A" "$poc038_dir/materialize-wheel.py" "$abi3" "$abi3_payload" >/dev/null
"$PYTHON_A" "$poc038_dir/materialize-wheel.py" "$exact" "$exact_payload" >/dev/null

PYTHONPATH="$abi3_payload/python/site-packages" "$PYTHON_B" -c 'import poc_tag_abi3; assert poc_tag_abi3.value() == "abi3-ok"'
printf 'abi3-minimal-materializer-under-313=PASS\n'

set +e
PYTHONPATH="$exact_payload/python/site-packages" "$PYTHON_B" -c 'import poc_tag_exact; print(poc_tag_exact.value())' >"$work/exact-materialized-b.out" 2>"$work/exact-materialized-b.err"
materialized_exact_status=$?
set -e
[ "$materialized_exact_status" -ne 0 ] || {
    echo "ERROR incompatible cp312 materialization unexpectedly imported under 3.13" >&2
    exit 1
}
printf 'exact-minimal-materializer-under-313-status=%s\n' "$materialized_exact_status"
printf 'materializer-needs-trusted-tag-boundary=PASS\n'

printf 'PASS Python wheel compatibility dimensions experiment\n'
