#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "${0%/*}" && pwd -P) || exit 1
POC_DIR=$(CDPATH= cd -P "$SCRIPT_DIR/.." && pwd -P) || exit 1
LINT="$SCRIPT_DIR/lint-portable-shell.sh"
fail=0

if "$LINT" "$POC_DIR/subject"
then
  printf 'PASS: valid subject accepted\n'
else
  printf 'FAIL: valid subject rejected\n'
  fail=$((fail + 1))
fi

if "$LINT" "$POC_DIR/fixtures/lint-invalid" >/dev/null 2>&1
then
  printf 'FAIL: invalid fixtures accepted\n'
  fail=$((fail + 1))
else
  printf 'PASS: invalid fixtures rejected\n'
fi

printf 'SUMMARY: fail=%s\n' "$fail"
[ "$fail" -eq 0 ]
