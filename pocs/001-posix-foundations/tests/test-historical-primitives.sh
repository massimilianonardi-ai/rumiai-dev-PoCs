#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P) || exit 1
POC_DIR=$(CDPATH= cd -P "$SCRIPT_DIR/.." && pwd -P) || exit 1
FIXTURES="$POC_DIR/fixtures"
PATH="$FIXTURES:$PATH"
export PATH

. "$FIXTURES/arg.lib.sh"
. "$FIXTURES/array.lib.sh"
. "$FIXTURES/enc.lib.sh"

pass=0
fail=0

ok()
{
  pass=$((pass + 1))
  printf 'PASS: %s\n' "$1"
}

bad()
{
  fail=$((fail + 1))
  printf 'FAIL: %s\n' "$1"
}

# Test 1: historical rand() depends on the non-POSIX RANDOM shell extension.
r1=$(rand)
r2=$(rand)
printf 'INFO: RANDOM=%s rand1=%s rand2=%s\n' "${RANDOM-<unset>}" "$r1" "$r2"
if [ -z "${RANDOM+x}" ] && [ "$r1" = "$r2" ]
then
  bad 'rand() is deterministic when RANDOM is unavailable'
else
  ok 'rand() did not reproduce deterministic no-RANDOM failure in this shell'
fi

# Test 2: literal printf conversion syntax must be treated as data by a2o().
actual=$(a2o '%s')
expected=$(printf '%s' '%s' | od -A n -b | tr -d '\t\r\n')
printf 'INFO: a2o literal %%s actual=[%s] expected=[%s]\n' "$actual" "$expected"
if [ "$actual" = "$expected" ]
then
  ok 'a2o preserves literal printf conversion text'
else
  bad 'a2o interprets input as printf format string'
fi

# Test 3: a value inserted in the historical array must remain data.
marker=${TMPDIR:-/tmp}/rumiai-array-eval-$$
rm -f "$marker"
array A
payload='$(printf injected > "'$marker'")'
array A add "$payload"
if [ -e "$marker" ]
then
  bad 'array add executes shell syntax embedded in a value'
else
  ok 'array add preserved shell-looking value as data'
fi
rm -f "$marker"

printf 'SUMMARY: pass=%s fail=%s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
