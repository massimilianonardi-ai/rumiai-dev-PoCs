#!/bin/sh
# PoC 098: real m pkg_integrate code with an official catalog var descriptor.
# Synthetic useful-root payload: NOT an installed upstream GeoServer release.
set -eu

fail()
{
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

[ "$#" -eq 1 ] && [ -f "$1" ] || fail 'expected one catalog var/data descriptor'
[ -n "${m_ROOT-}" ] && [ -n "${m_PKG_DIR-}" ] && [ -n "${m_LIB_DIR-}" ] ||
  fail 'real m bootstrap unavailable'
. "$m_LIB_DIR/sys/sh/core.lib.sh" || fail 'cannot load real m shell runtime'
loadsyslib "pkg/pkg-integration" || fail 'cannot load real package integration'

pkg=poc098state
version=1.0
concrete="$m_PKG_DIR/$pkg@$version"
current="$m_ROOT/state/system/current"
alt="$m_ROOT/state/system/profile/poc098-alt"
main="$m_ROOT/state/system/profile/main"
[ -L "$current" ] && [ "$(readlink "$current")" = profile/main ] ||
  fail 'fresh source checkout must have the known system profile'
[ ! -e "$concrete" ] && [ ! -L "$concrete" ] ||
  fail 'fixture concrete already present'
[ ! -e "$main/pkg/$pkg" ] && [ ! -e "$alt/pkg/$pkg" ] ||
  fail 'fixture state already present'

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-c2-integrated-XXXXXX") ||
  fail 'cannot prepare disposable staging'
orig=$(readlink "$current") || fail 'cannot read initial system selector'
cleanup()
{
  rm -f "$current"
  ln -s "$orig" "$current" || :
  rm -rf "$work" "$concrete" "$main/pkg/$pkg" "$alt/pkg/$pkg"
}
trap cleanup 0

mkdir -p "$m_PKG_DIR" "$work/range/var" "$work/root/data_dir" ||
  fail 'cannot prepare fixture dirs'
cp "$1" "$work/range/var/data" || fail 'cannot copy official descriptor'
[ "$(cat "$work/range/var/data")" = data_dir ] ||
  fail 'official catalog GeoServer descriptor changed'
printf '%s\n' tar.gz > "$work/range/format"
printf '%s\n' MAIN > "$work/root/data_dir/observed"

# This is the real implementation entrypoint, not a mocked symlink fixture.
pkg_integrate "$pkg" "$version" "$work/range" "$work/root" ||
  fail 'real pkg_integrate with catalog state descriptor failed'

[ -L "$concrete/var/data" ] && [ -L "$concrete/root/data_dir" ] ||
  fail 'real package integration failed to publish var/root links'
[ "$(readlink "$concrete/var/data")" = "../../../state/system/current/pkg/$pkg/data" ] ||
  fail 'real integrated var target differed from canonical fixed system current'
fixed="$concrete/root/data_dir/observed"
[ "$(cat "$fixed")" = MAIN ] || fail 'real main profile factory state unavailable'

mkdir -p "$alt/pkg/$pkg/data/data_dir" ||
  fail 'cannot create alternate profile state'
printf '%s\n' ALTERNATE > "$alt/pkg/$pkg/data/data_dir/observed"

# A process-level label does not affect the shared physical symlink chain.
observed_a=$(POC_PROFILE=main sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") ||
  fail 'main process read failed'
observed_b=$(POC_PROFILE=alternate sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") ||
  fail 'alternate process read failed'
[ "$observed_a" = main:MAIN ] && [ "$observed_b" = alternate:MAIN ] ||
  fail 'expected both labelled processes to use one physical main state'
printf '%s\n' 'PASS: real pkg_integrate of official GeoServer var/data descriptor materializes one global current routing'

# The resolver remains a semantic current pathname even in a distinct process.
resolved=$("$m_ROOT/m" "$m_BIN_DIR/sys/state-path" system pkg "$pkg" data) ||
  fail 'real state-path process unavailable'
[ "$resolved" = "$m_ROOT/state/system/current/pkg/$pkg/data" ] ||
  fail 'state-path did not return canonical semantic current pathname'

rm "$current" || fail 'cannot switch disposable system current selector'
ln -s profile/poc098-alt "$current" ||
  fail 'cannot link disposable alternate profile'
observed_after=$(POC_PROFILE=main sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") ||
  fail 'main process read failed after switch'
[ "$observed_after" = main:ALTERNATE ] ||
  fail 'real integrated package var path did not follow global selector'
printf '%s\n' 'PASS: real m state-path and integrated immutable package var path follow global system selector, not process label'
printf '%s\n' 'PASS: no actual GeoServer download, execution, or multi-profile context functionality claimed'
