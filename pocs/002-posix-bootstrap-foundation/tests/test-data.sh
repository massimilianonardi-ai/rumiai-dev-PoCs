#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "${0%/*}" && pwd -P) || exit 1
POC_DIR=$(CDPATH= cd -P "$SCRIPT_DIR/.." && pwd -P) || exit 1
WORK_DIR="$POC_DIR/.work/data-$$"
mkdir -p "$WORK_DIR" || exit 1
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

. "$POC_DIR/subject/lib/data.sh"

fail=0

check()
{
  label=$1
  value=$2
  out_file="$WORK_DIR/out"
  exp_file="$WORK_DIR/expected"

  rumiai_print "$value" > "$out_file" || return 1
  printf '%s' "$value" > "$exp_file"

  if cmp "$out_file" "$exp_file" >/dev/null 2>&1
  then
    printf 'PASS: %s\n' "$label"
  else
    printf 'FAIL: %s\n' "$label"
    fail=$((fail + 1))
  fi
}

marker="$WORK_DIR/must-not-exist"

check empty ''
check percent '%s'
check command-substitution '$(touch marker)'
check spaces '  a  b  '
check quotes "a'b\"c"
check backslash 'a\b\c'
check leading-dash '-n'
check newline "a
b"
check trailing-newline "a
"
check utf8 'àèìòù 漢字'

if [ -e "$marker" ]
then
  printf 'FAIL: data executed\n'
  fail=$((fail + 1))
else
  printf 'PASS: shell-looking data remained data\n'
fi

printf 'SUMMARY: fail=%s\n' "$fail"
[ "$fail" -eq 0 ]
