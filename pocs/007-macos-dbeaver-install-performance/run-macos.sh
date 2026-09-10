#!/bin/sh

expected_rumiai_os= a2531626b68e81c9df4e76a007e7f963b3f26343

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

json_lib="$rumiai_os/lib/sh/json.lib.sh"
[ -f "$json_lib" ] && [ -r "$json_lib" ] || fail "json.lib.sh is unavailable"

tmp="${TMPDIR:-/tmp}/rumiai-poc-007-$$"
umask 077
mkdir "$tmp" || fail "cannot create temporary directory"
trap 'rm -rf "$tmp"' 0 HUP INT TERM

payload="$tmp/releases-page-1.json"
records="$tmp/records"
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

printf 'json-parser=START\n'
/usr/bin/time -p /bin/sh "$tmp/json-parse.sh" "$json_lib" "$payload" "$records" 2> "$tmp/json-parser.time"
status=$?
printf 'json-parser-status=%s\n' "$status"
[ "$status" -eq 0 ] || {
  cat "$tmp/json-parser.time" >&2
  fail "current json parser failed"
}
record_count="$(wc -l < "$records")" || fail "cannot count parsed records"
printf 'json-parser-records=%s\n' "$record_count"
sed 's/^/json-parser-/' "$tmp/json-parser.time"

printf 'probe=PASS\n'
