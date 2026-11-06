#!/bin/sh
# Experimental POSIX filesystem probe; this is not a test of m or pkg.
set -eu

fail()
{
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

work=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-context-profile-XXXXXX") || exit 2
trap 'rm -rf "$work"' 0
trap 'exit 1' 1 2 3 15

# Reproduce the installed package's existing root -> var -> system/current
# link chain with two distinct persistent system profile data roots.
mkdir -p "$work/pkg/demo@1/root/config" "$work/pkg/demo@1/var" \
  "$work/state/system/profile/a/pkg/demo/data" \
  "$work/state/system/profile/b/pkg/demo/data"
printf '%s\n' A > "$work/state/system/profile/a/pkg/demo/data/value"
printf '%s\n' B > "$work/state/system/profile/b/pkg/demo/data/value"
ln -s profile/a "$work/state/system/current"
ln -s ../../../state/system/current/pkg/demo/data "$work/pkg/demo@1/var/data"
ln -s ../../var/data/value "$work/pkg/demo@1/root/config/value"

fixed="$work/pkg/demo@1/root/config/value"
observed_a=$(POC_PROFILE=a sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") || fail 'read A context'
observed_b=$(POC_PROFILE=b sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") || fail 'read B context'
[ "$observed_a" = 'a:A' ] && [ "$observed_b" = 'b:A' ] || fail 'fixed link should follow only global current'

rm "$work/state/system/current"
ln -s profile/b "$work/state/system/current"
observed_a_after=$(POC_PROFILE=a sh -c 'printf "%s:%s" "$POC_PROFILE" "$(cat "$1")"' sh "$fixed") || fail 'read A context after global switch'
[ "$observed_a_after" = 'a:B' ] || fail 'global selector change did not affect both contexts'
printf '%s\n' 'PASS: fixed package var chain ignores independent shell labels and follows shared system/current'

# Candidate only: pre-materialized profile-specific launch paths referencing
# exactly one shared immutable shell payload and data file. It works only
# when the launched program resolves its data relative to the INVOKED view.
mkdir -p "$work/shared/demo@1/root/bin" "$work/shared/demo@1/root/lib"
printf '%s\n' shared > "$work/shared/demo@1/root/lib/common.txt"
cat > "$work/shared/demo@1/root/bin/tool" <<'EOF_TOOL'
#!/bin/sh
set -eu
[ "$#" -eq 0 ] || exit 2
runtime_root=${0%/*}/..
common=$(cat "$runtime_root/lib/common.txt") || exit 3
value=$(cat "$runtime_root/var/data/value") || exit 4
printf '%s:%s\n' "$common" "$value"
EOF_TOOL
chmod +x "$work/shared/demo@1/root/bin/tool"

for profile in a b
do
  view="$work/views/$profile/demo@1/root"
  mkdir -p "$view/bin" "$view/lib" "$view/var"
  ln -s "$work/shared/demo@1/root/bin/tool" "$view/bin/tool"
  ln -s "$work/shared/demo@1/root/lib/common.txt" "$view/lib/common.txt"
  ln -s "$work/state/system/profile/$profile/pkg/demo/data" "$view/var/data"
done

view_a=$($work/views/a/demo@1/root/bin/tool) || fail 'adapted A view'
view_b=$($work/views/b/demo@1/root/bin/tool) || fail 'adapted B view'
[ "$view_a" = shared:A ] && [ "$view_b" = shared:B ] || fail 'candidate per-profile views do not select different state'
[ "$(readlink "$work/state/system/current")" = profile/b ] || fail 'candidate rewrote system/current'
[ -L "$work/views/a/demo@1/root/bin/tool" ] && [ -L "$work/views/b/demo@1/root/bin/tool" ] || fail 'candidate copied executable instead of linking immutable payload'

# A non-adapted launch through the canonical payload pathname lacks the
# profile view and therefore cannot assume the same relative var access.
if "$work/shared/demo@1/root/bin/tool" >/dev/null 2>&1
then
  fail 'physical payload invocation unexpectedly used a profile view'
fi
printf '%s\n' 'PASS: pre-prepared profile-specific launch views isolate A/B for a path-aware tool without modifying shared current'
printf '%s\n' 'PASS: direct immutable-root launch is NOT compatible with the view-relative state contract'
