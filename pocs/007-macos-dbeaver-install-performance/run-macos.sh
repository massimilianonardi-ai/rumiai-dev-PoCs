#!/bin/sh

expected_rumiai_os=a2531626b68e81c9df4e76a007e7f963b3f26343

fail()
{
  printf '%s\n' "PoC 007: $*" >&2
  exit 1
}

[ "$(uname -s 2>/dev/null)" = Darwin ] || fail "this probe is intended for the reference macOS host"
[ "$#" -le 1 ] || fail "usage: sh run-macos.sh [rumiai-os-root]"

command -v git >/dev/null 2>&1 || fail "git is unavailable"
command -v curl >/dev/null 2>&1 || fail "curl is unavailable"
command -v awk >/dev/null 2>&1 || fail "awk is unavailable"
command -v cmp >/dev/null 2>&1 || fail "cmp is unavailable"
[ -x /usr/bin/time ] || fail "/usr/bin/time is unavailable"

self=$0
case "$self" in
  */*) : ;;
  *) self="$(command -v "$self" 2>/dev/null)" || fail "cannot resolve script pathname" ;;
esac
self_dir=${self%/*}
[ "$self_dir" != "$self" ] || self_dir=.
self_dir="$(CDPATH= cd "$self_dir" 2>/dev/null && pwd -P)" || fail "cannot resolve script directory"

if [ "$#" -eq 1 ]
then
  rumiai_os="$(CDPATH= cd "$1" 2>/dev/null && pwd -P)" || fail "cannot resolve rumiai-os root"
else
  rumiai_os="$(CDPATH= cd "$self_dir/../../../.." 2>/dev/null && pwd -P)" || fail "cannot derive rumiai-os root"
fi

[ -f "$rumiai_os/rumiai-os" ] || fail "rumiai-os root is invalid"
actual_rumiai_os="$(git -C "$rumiai_os" rev-parse --verify HEAD 2>/dev/null)" || fail "cannot read rumiai-os HEAD"
[ "$actual_rumiai_os" = "$expected_rumiai_os" ] || fail "expected rumiai-os@$expected_rumiai_os, found $actual_rumiai_os"

current_lib="$rumiai_os/lib/sh/json.lib.sh"
candidate_lib="$self_dir/json-windowed.lib.sh"
[ -f "$current_lib" ] && [ -r "$current_lib" ] || fail "current json.lib.sh is unavailable"
[ -f "$candidate_lib" ] && [ -r "$candidate_lib" ] || fail "windowed JSON candidate is unavailable"

tmp="${TMPDIR:-/tmp}/rumiai-poc-007-$$"
umask 077
mkdir "$tmp" || fail "cannot create temporary directory"
trap 'rm -rf "$tmp"' 0 HUP INT TERM

cat > "$tmp/compare.sh" <<'EOF_COMPARE'
#!/bin/sh
library=$1
mode=$2
input=$3
. "$library" || exit 1
case "$mode" in
  object)
    json_object_fields name enabled < "$input"
    ;;
  array)
    json_array_object_fields name enabled < "$input"
    ;;
  object-array)
    json_object_array_object_fields items name size < "$input"
    ;;
  *)
    exit 2
    ;;
esac
EOF_COMPARE
chmod 700 "$tmp/compare.sh" || fail "cannot prepare comparison wrapper"

cat > "$tmp/object.json" <<'EOF_OBJECT'
{"name":"kept","ignored":{"nested":[1,2,{"text":"line\n\u0041\tend"}]},"enabled":true}
EOF_OBJECT
cat > "$tmp/array.json" <<'EOF_ARRAY'
[{"name":"first","enabled":false,"ignored":"x"},{"name":"second","enabled":true}]
EOF_ARRAY
cat > "$tmp/object-array.json" <<'EOF_OBJECT_ARRAY'
{"ignored":"x","items":[{"name":"one","size":1},{"name":"two","size":2}]}
EOF_OBJECT_ARRAY

for mode in object array object-array
do
  /bin/sh "$tmp/compare.sh" "$current_lib" "$mode" "$tmp/$mode.json" > "$tmp/current-$mode" || fail "current parser rejected deterministic $mode fixture"
  /bin/sh "$tmp/compare.sh" "$candidate_lib" "$mode" "$tmp/$mode.json" > "$tmp/candidate-$mode" || fail "candidate parser rejected deterministic $mode fixture"
  cmp "$tmp/current-$mode" "$tmp/candidate-$mode" >/dev/null 2>&1 || fail "candidate output differs for deterministic $mode fixture"
done
printf 'semantic-smoke=PASS\n'

payload="$tmp/releases-page-1.json"
records="$tmp/records-windowed"
url='https://api.github.com/repos/dbeaver/dbeaver/releases?per_page=100&page=1'

printf 'host=%s/%s\n' "$(uname -s)" "$(uname -m)"
printf 'rumiai-os=%s\n' "$actual_rumiai_os"
printf 'awk=%s\n' "$(command -v awk)"
printf 'fetch=START\n'

curl \
  -q \
  --fail \
  --location \
  --silent \
  --show-error \
  --connect-timeout 30 \
  --speed-limit 1 \
  --speed-time 30 \
  --proto '=https' \
  --proto-redir '=https' \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2026-03-10' \
  --output "$payload" \
  --write-out 'fetch-seconds=%{time_total}\nfetch-bytes=%{size_download}\n' \
  -- "$url" || fail "GitHub releases fetch failed"

payload_bytes="$(wc -c < "$payload")" || fail "cannot measure payload"
printf 'payload-bytes=%s\n' "$payload_bytes"

printf 'awk-linear=START\n'
/usr/bin/time -p awk '
{ bytes += length($0) + 1 }
END { print bytes }
' "$payload" > "$tmp/awk-linear.out" 2> "$tmp/awk-linear.time" || fail "linear awk control failed"
printf 'awk-linear-bytes=%s\n' "$(cat "$tmp/awk-linear.out")"
sed 's/^/awk-linear-/' "$tmp/awk-linear.time"

cat > "$tmp/json-parse.sh" <<'EOF_PARSE'
#!/bin/sh
. "$1" || exit 1
json_array_object_fields tag_name draft prerelease created_at published_at < "$2" > "$3"
EOF_PARSE
chmod 700 "$tmp/json-parse.sh" || fail "cannot prepare parser wrapper"

printf 'json-windowed=START\n'
/usr/bin/time -p /bin/sh "$tmp/json-parse.sh" "$candidate_lib" "$payload" "$records" 2> "$tmp/json-windowed.time"
status=$?
printf 'json-windowed-status=%s\n' "$status"
[ "$status" -eq 0 ] || {
  cat "$tmp/json-windowed.time" >&2
  fail "windowed JSON parser candidate failed"
}
record_count="$(wc -l < "$records")" || fail "cannot count parsed records"
printf 'json-windowed-records=%s\n' "$record_count"
[ "$record_count" -eq 100 ] || fail "windowed parser returned unexpected record count"
sed 's/^/json-windowed-/' "$tmp/json-windowed.time"

printf 'baseline-current-json-real-seconds=100.02\n'
printf 'baseline-current-json-payload-bytes=2355841\n'
printf 'probe=PASS\n'
