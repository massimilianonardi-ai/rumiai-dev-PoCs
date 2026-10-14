#!/bin/sh
# Test only the operator sequencing boundary; rsudo/GitHub are intentionally mocked.
set -eu
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
base=$(mktemp -d)
trap 'rm -rf -- "$base"' 0 HUP INT TERM
rsudo_admin_job_library="$script_dir/controller.lib.sh"
. "$rsudo_admin_job_library"
rev=9f4524d9af44cc031ba039b88cfda8d2df0e1c65
catalog=5f3edca59cdc2dd721c50856d99736392f0fff0b
artifact=f181030a940abc79aa98797c6ac13bd149d6d1cba545f1111886eea8c3445cfd
head=6a964ba3f5c8acf462737e3b92daaf1af32de57e
# Catalog Git operations are out of scope for this sequencing test.
git() { return 0; }
rsudo()
{
  group=${2#:}
  mode=$7
  printf '%s:%s\n' "$mode" "$group" >> "$base/sequence"
  if [ "$mode" = check ]
  then
    printf 'CLUSTER CHECK OK role=%s old=%s target=%s artifact=%s\n' "${10}" "$head" "$rev" "$artifact"
  else
    [ "${11}" = "$head" ] || return 31
    if [ "${CLUSTER_TEST_FAIL_GROUP-}" = "$group" ]; then return 32; fi
    printf 'CLUSTER APPLY OK role=%s revision=%s artifact=%s\n' "${10}" "$rev" "$artifact"
  fi
}
: > "$base/sequence"
cluster_rollout "$rev" "$catalog" "$artifact" > "$base/result"
[ "$(grep -c '^check:' "$base/sequence")" -eq 8 ]
[ "$(grep -c '^apply:' "$base/sequence")" -eq 8 ]
[ "$(sed -n '9p' "$base/sequence")" = apply:gis ]
[ "$(sed -n '10p' "$base/sequence")" = apply:apps ]
grep -q '^CLUSTER ROLLOUT OK' "$base/result"
: > "$base/sequence"
CLUSTER_TEST_FAIL_GROUP=apps
export CLUSTER_TEST_FAIL_GROUP
if cluster_rollout "$rev" "$catalog" "$artifact" > "$base/failure.out" 2> "$base/failure.err"
then echo 'FAIL: apps canary failure did not halt' >&2; exit 1; fi
[ "$(grep -c '^check:' "$base/sequence")" -eq 8 ]
[ "$(grep -c '^apply:' "$base/sequence")" -eq 2 ]
grep -q 'CLUSTER ROLLOUT STOPPED group=apps' "$base/failure.err"
unset CLUSTER_TEST_FAIL_GROUP
: > "$base/sequence"
cluster_rollout "$rev" "$catalog" "$artifact" check > "$base/check.out"
[ "$(grep -c '^check:' "$base/sequence")" -eq 8 ]
! grep -q '^apply:' "$base/sequence"
grep -q '^CLUSTER PREFLIGHT OK' "$base/check.out"
: > "$base/sequence"
cluster_rollout "$rev" "$catalog" "$artifact" canary > "$base/canary.out"
[ "$(grep -c '^check:' "$base/sequence")" -eq 8 ]
[ "$(grep -c '^apply:' "$base/sequence")" -eq 2 ]
grep -q '^CLUSTER CANARY OK' "$base/canary.out"
echo 'PASS: controller preflights fleet, separates check/canary modes and stops promotion on canary failure'
