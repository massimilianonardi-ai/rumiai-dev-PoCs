#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "${0%/*}" && pwd -P) || exit 1
fail=0
ran=0

run_one()
{
  name=$1
  shift
  ran=$((ran + 1))
  printf '\n===== %s =====\n' "$name"
  "$@" "$SCRIPT_DIR/test-data.sh" || fail=$((fail + 1))
  "$@" "$SCRIPT_DIR/test-root.sh" || fail=$((fail + 1))
  "$@" "$SCRIPT_DIR/test-lint.sh" || fail=$((fail + 1))
}

command -v dash >/dev/null 2>&1 && run_one dash dash
command -v bash >/dev/null 2>&1 && run_one 'bash --posix' bash --posix
command -v busybox >/dev/null 2>&1 && run_one 'busybox sh' busybox sh

[ "$ran" -gt 0 ] || { printf 'No configured shell available.\n' >&2; exit 2; }
printf '\nMATRIX SUMMARY: shells=%s fail=%s\n' "$ran" "$fail"
[ "$fail" -eq 0 ]
