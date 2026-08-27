#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "${0%/*}" && pwd -P) || exit 1
POC_DIR=$(CDPATH= cd -P "$SCRIPT_DIR/.." && pwd -P) || exit 1
SUBJECT="$POC_DIR/subject"
ENTRY="$SUBJECT/rumiai-os"
WORK_DIR="$POC_DIR/.work/root-$$"
mkdir -p "$WORK_DIR" || exit 1
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

fail=0
expected=$(CDPATH= cd -P "$SUBJECT" && pwd -P) || exit 1

(
  cd "$SUBJECT" || exit 1
  [ "$(./rumiai-os)" = "$expected" ]
) && printf 'PASS: relative invocation\n' || { printf 'FAIL: relative invocation\n'; fail=$((fail + 1)); }

[ "$("$ENTRY")" = "$expected" ] \
  && printf 'PASS: absolute invocation\n' \
  || { printf 'FAIL: absolute invocation\n'; fail=$((fail + 1)); }

(
  cd "$WORK_DIR" || exit 1
  [ "$("$ENTRY")" = "$expected" ]
) && printf 'PASS: different cwd\n' || { printf 'FAIL: different cwd\n'; fail=$((fail + 1)); }

(
  cd "$WORK_DIR" || exit 1
  PATH="$SUBJECT:$PATH"
  export PATH
  [ "$(rumiai-os)" = "$expected" ]
) && printf 'PASS: PATH invocation\n' || { printf 'FAIL: PATH invocation\n'; fail=$((fail + 1)); }

link="$WORK_DIR/rumiai-os"
ln -s "$ENTRY" "$link" || exit 1
if "$link" >/dev/null 2>&1
then
  printf 'FAIL: symlink invocation unexpectedly accepted\n'
  fail=$((fail + 1))
else
  printf 'PASS: symlink invocation rejected explicitly\n'
fi

printf 'SUMMARY: fail=%s\n' "$fail"
[ "$fail" -eq 0 ]
