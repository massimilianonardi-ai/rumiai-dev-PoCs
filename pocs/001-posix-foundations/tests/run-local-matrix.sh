#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P) || exit 1
TEST="$SCRIPT_DIR/test-historical-primitives.sh"
ran=0

run_dash()
{
  if command -v dash >/dev/null 2>&1
  then
    ran=$((ran + 1))
    printf '\n===== dash =====\n'
    dash "$TEST"
    printf 'EXIT=%s\n' "$?"
  fi
}

run_bash()
{
  if command -v bash >/dev/null 2>&1
  then
    ran=$((ran + 1))
    printf '\n===== bash --posix =====\n'
    bash --posix "$TEST"
    printf 'EXIT=%s\n' "$?"
  fi
}

run_busybox()
{
  if command -v busybox >/dev/null 2>&1
  then
    ran=$((ran + 1))
    printf '\n===== busybox sh =====\n'
    busybox sh "$TEST"
    printf 'EXIT=%s\n' "$?"
  fi
}

run_dash
run_bash
run_busybox

if [ "$ran" -eq 0 ]
then
  printf 'No configured test shell is available.\n' >&2
  exit 2
fi

# The individual historical tests intentionally return non-zero when a defect is reproduced.
# This runner reports the matrix without treating those expected failures as a runner failure.
exit 0
