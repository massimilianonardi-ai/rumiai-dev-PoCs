#!/bin/sh

fail()
{
  printf '%s\n' "dmg-extraction-poc: $*" >&2
  exit 1
}

host_os="$(uname -s 2>/dev/null)" || fail "cannot detect host OS"
host_arch="$(uname -m 2>/dev/null)" || fail "cannot detect host architecture"

printf 'host=%s/%s\n' "$host_os" "$host_arch"
[ "$host_os" = Darwin ] || {
  printf '%s\n' 'dmg-extraction-poc: macOS host required' >&2
  exit 2
}

for required in curl hdiutil ditto shasum
 do
  command -v "$required" >/dev/null 2>&1 || fail "required command unavailable: $required"
  printf '%s=%s\n' "$required" "$(command -v "$required")"
done

sevenzip=
for candidate in 7zz 7z 7za
do
  if command -v "$candidate" >/dev/null 2>&1
  then
    sevenzip=$candidate
    break
  fi
done
if [ -n "$sevenzip" ]
then
  printf 'current-7z-backend=%s\n' "$(command -v "$sevenzip")"
else
  printf '%s\n' 'current-7z-backend=absent'
fi

url='https://github.com/dbeaver/dbeaver/releases/download/26.2.0/dbeaver-ce-26.2.0-macos-aarch64.dmg'
expected_size=123190051
expected_digest='62a03aa88429d4eef3576550397aae75d2576a012deda0c83d4b44f5fbcd4a3f'

tmp="$(mktemp -d "${TMPDIR:-/tmp}/rumiai-dmg-extraction-poc.XXXXXX")" || fail "cannot create temporary directory"
artifact="$tmp/dbeaver.dmg"
mountpoint="$tmp/mount"
destination="$tmp/destination"
mounted=0

cleanup()
{
  cleanup_status=$?
  trap - 0 HUP INT TERM
  if [ "$mounted" -eq 1 ]
  then
    hdiutil detach "$mountpoint" >/dev/null 2>&1 || printf '%s\n' 'dmg-extraction-poc: warning: detach failed during cleanup' >&2
  fi
  rm -rf "$tmp" 2>/dev/null || :
  exit "$cleanup_status"
}

trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$mountpoint" "$destination" || fail "cannot create PoC directories"

printf '%s\n' 'download=START'
curl -q \
  --fail \
  --location \
  --silent \
  --show-error \
  --connect-timeout 30 \
  --max-time 120 \
  --output "$artifact" \
  -- "$url" || fail "cannot download DBeaver DMG"
printf '%s\n' 'download=PASS'

artifact_size="$(wc -c < "$artifact" | tr -d ' ')" || fail "cannot determine artifact size"
printf 'artifact-size=%s\n' "$artifact_size"
[ "$artifact_size" = "$expected_size" ] || fail "unexpected artifact size"

artifact_digest="$(shasum -a 256 < "$artifact" | awk '{print $1}')" || fail "cannot calculate artifact digest"
printf 'artifact-sha256=%s\n' "$artifact_digest"
[ "$artifact_digest" = "$expected_digest" ] || fail "unexpected artifact digest"

printf '%s\n' 'attach=START'
hdiutil attach \
  -readonly \
  -nobrowse \
  -mountpoint "$mountpoint" \
  "$artifact" > "$tmp/attach.log" || {
    cat "$tmp/attach.log" >&2
    fail "hdiutil attach failed"
  }
mounted=1
printf '%s\n' 'attach=PASS'

printf '%s\n' 'mounted-top-level:'
for entry in "$mountpoint"/* "$mountpoint"/.[!.]* "$mountpoint"/..?*
do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  printf '  %s\n' "${entry##*/}"
done

source_app="$mountpoint/DBeaver.app"
source_target="$source_app/Contents/MacOS/dbeaver"
[ -d "$source_app" ] && [ ! -L "$source_app" ] || fail "mounted DBeaver.app is missing"
[ -f "$source_target" ] && [ -x "$source_target" ] || fail "mounted DBeaver executable is missing or not executable"
source_digest="$(shasum -a 256 < "$source_target" | awk '{print $1}')" || fail "cannot digest mounted executable"
printf 'source-target-sha256=%s\n' "$source_digest"

printf '%s\n' 'copy=START'
ditto "$mountpoint" "$destination" || fail "ditto copy failed"
printf '%s\n' 'copy=PASS'

hdiutil detach "$mountpoint" >/dev/null || fail "hdiutil detach failed"
mounted=0
printf '%s\n' 'detach=PASS'

destination_app="$destination/DBeaver.app"
destination_target="$destination_app/Contents/MacOS/dbeaver"
[ -d "$destination_app" ] && [ ! -L "$destination_app" ] || fail "copied DBeaver.app is missing"
[ -f "$destination_target" ] && [ -x "$destination_target" ] || fail "copied DBeaver executable is missing or not executable"
destination_digest="$(shasum -a 256 < "$destination_target" | awk '{print $1}')" || fail "cannot digest copied executable"
printf 'destination-target-sha256=%s\n' "$destination_digest"
[ "$destination_digest" = "$source_digest" ] || fail "copied executable differs from mounted source"

printf '%s\n' 'dmg-native-extraction=PASS'
