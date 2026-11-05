# PoC G07 Ubuntu 26.04 ARM64 reference-VM launcher. Run with "sh FILE".
# Not a distributed command. No sudo and no user-checkout modification.
set -e
fail()
{
  printf 'G07 BLOCKED [%s]: %s\n' "$1" "$2" >&2
  exit "$1"
}
[ "$(uname -m)" = aarch64 ] ||
  fail 11 'the actual aarch64 kernel is required'
[ -r /etc/os-release ] || fail 12 'missing OS metadata'
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 26.04 ] ||
  fail 12 'requires Ubuntu 26.04'
# The operator's designated ARM64 reference environment is Ubuntu in a VM.
# GUI availability determines browser mode; virtualization is recorded.
browser_headless=0
browser_mode='headful'
if [ -z "$DISPLAY$WAYLAND_DISPLAY" ]
then
  browser_headless=1
  browser_mode='headless'
fi
for tool in git node npm python3
do
  command -v "$tool" >/dev/null 2>&1 ||
    fail 15 "missing tool: $tool"
done
[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 22 && process.arch === "arm64"')" = true ] ||
  fail 15 'native ARM64 Node.js 22+ required'
browser="$RUMIAI_G07_CHROMIUM"
[ -n "$browser" ] || browser="$(command -v chromium 2>/dev/null || true)"
[ -n "$browser" ] || browser="$(command -v chromium-browser 2>/dev/null || true)"
[ -n "$browser" ] && [ -x "$browser" ] ||
  fail 16 'system Chromium is required'
# Preserve the original browser diagnostic: version-probe failures can
# indicate missing shared libraries, sandbox issues or wrapper errors.
# Never silently replace them with only a generic launcher status.
if browser_version="$("$browser" --version 2>&1)"
then
  :
else
  browser_status=$?
  printf 'G07 Chromium version probe failed: executable=%s exit=%s\n' "$browser" "$browser_status" >&2
  printf '%s\n' "$browser_version" >&2
  fail 16 'installed Chromium --version failed; see original diagnostic above'
fi

report="$RUMIAI_G07_REPORT_DIR"
[ -n "$report" ] || report="$HOME/rumiai-g07-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$report" || fail 17 'cannot create evidence directory'
report="$(CDPATH= cd -- "$report" && pwd -P)"
temp="$(mktemp -d /tmp/rumiai-g07.XXXXXXXX)" ||
  fail 18 'cannot create isolated workspace'
server=''
passed=0
finish()
{
  status=$?
  trap - 0
  if [ -n "$server" ]
  then
    kill "$server" 2>/dev/null || :
    wait "$server" 2>/dev/null || :
  fi
  if [ "$passed" -eq 1 ] && [ "$status" -eq 0 ]
  then
    printf 'PASS\n' > "$report/status.txt"
  else
    printf 'NOT_VALIDATED exit=%s\n' "$status" > "$report/status.txt"
  fi
  rm -rf "$temp"
  printf 'G07 evidence directory: %s\n' "$report" >&2
  exit "$status"
}
trap finish 0
printf 'utc=%s\nkernel=%s\nos=%s\nbrowser=%s\nnode=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(uname -srm)" \
  "$ID $VERSION_ID" "$browser_version" "$(node --version)" \
  > "$report/host.txt"
printf 'session=%s\ndisplay=%s\nwayland=%s\n' \
  "$XDG_SESSION_TYPE" "$DISPLAY" "$WAYLAND_DISPLAY" >> "$report/host.txt"
printf 'browser_mode=%s\n' "$browser_mode" >> "$report/host.txt"
if command -v systemd-detect-virt >/dev/null 2>&1
then
  virtualization="$(systemd-detect-virt 2>/dev/null || :)"
  [ -n "$virtualization" ] || virtualization='none'
  printf 'virtualization=%s\n' "$virtualization" >> "$report/host.txt"
else
  printf 'virtualization=unknown\n' >> "$report/host.txt"
fi
command -v lscpu >/dev/null 2>&1 && lscpu >> "$report/host.txt" || :

core='c453b5764fec8403571125ea62107ae072a823a1'
git clone -q --filter=blob:none https://github.com/massimilianonardi-ai/rumiai-os.git "$temp/rumiai-os" ||
  fail 19 'unable to clone real product'
git -C "$temp/rumiai-os" checkout -q --detach "$core" ||
  fail 20 'unable to resolve pinned product'
mkdir -p "$temp/rumiai-os/src"
git clone -q --filter=blob:none https://github.com/massimilianonardi-ai/rumiai-dev-PoCs.git "$temp/rumiai-os/src/rumiai-dev-PoCs" ||
  fail 21 'unable to clone PoC'
poc="$temp/rumiai-os/src/rumiai-dev-PoCs"
poc_sha="$RUMIAI_G07_POC_SHA"
[ -n "$poc_sha" ] || poc_sha="$(git -C "$poc" rev-parse HEAD)"
git -C "$poc" checkout -q --detach "$poc_sha" ||
  fail 22 'unable to pin PoC revision'
printf 'product_revision=%s\npoc_revision=%s\n' "$core" "$poc_sha" >> "$report/host.txt"
product="$temp/rumiai-os"
tests="$poc/pocs/066-text-edit-browser-gui/tests"
[ -f "$tests/g07-physical-browser.mjs" ] ||
  fail 23 'selected PoC does not contain the G07 physical test'
(
  cd "$product"
  node lib/sys/js/jsc.lib.js lib/sys/js/core/modules-js.json lib/sys/js/core/document2d-browser.generated.js
) > "$report/compile.log" 2>&1 ||
  fail 24 'real Document2D compile failed'
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix "$product" install --no-save --no-package-lock --ignore-scripts playwright@1.56.1 > "$report/dependencies.log" 2>&1 ||
  fail 25 'temporary Playwright setup failed'
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$product" > "$report/http.log" 2>&1 &
server=$!
sleep 2
kill -0 "$server" 2>/dev/null ||
  fail 26 'HTTP fixture failed; port 8765 may be occupied'
export RUMIAI_G07_REFERENCE=1
export RUMIAI_G07_HEADLESS="$browser_headless"
export RUMIAI_G07_CHROMIUM="$browser"
export RUMIAI_G07_ARTIFACTS="$report"
for suite in canonical-gui-browser.mjs canonical-interaction-browser.mjs canonical-protected-browser.mjs canonical-viewport-browser.mjs canonical-parity-browser.mjs g07-physical-browser.mjs
do
  printf 'G07 reference VM ($browser_mode): %s\n' "$suite"
  if ! node "$tests/$suite" > "$report/$suite.log" 2>&1
  then
    tail -n 30 "$report/$suite.log" >&2 || :
    fail 27 "browser suite failed: $suite"
  fi
  tail -n 1 "$report/$suite.log"
done
passed=1
printf 'G07 PASS on the recorded Ubuntu ARM64 reference VM and exact revisions.\n'
