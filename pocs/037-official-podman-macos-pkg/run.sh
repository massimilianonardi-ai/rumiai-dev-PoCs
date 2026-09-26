#!/bin/sh
set -eu

VERSION=${PODMAN_VERSION:-v6.1.2}
ASSET=podman-installer-macos-arm64.pkg
SHA256=88def43af7fbe7baf40fc2f12d69267f6d845768020709900fb1b8c3bfe015b3
URL="https://github.com/podman-container-tools/podman/releases/download/${VERSION}/${ASSET}"

[ "$(uname -s)" = Darwin ] || {
  echo "ERROR this experiment requires macOS" >&2
  exit 2
}
[ "$(uname -m)" = arm64 ] || {
  echo "ERROR this experiment requires arm64" >&2
  exit 2
}

for tool in curl shasum pkgutil codesign spctl find sed grep strings; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ERROR missing experiment tool: $tool" >&2
    exit 2
  }
done

work=$(mktemp -d "${TMPDIR:-/tmp}/podman-official-pkg-poc.XXXXXX")
cleanup()
{
  if [ -n "${PODMAN_BIN:-}" ] && [ -x "${PODMAN_BIN:-}" ]; then
    "$PODMAN_BIN" machine rm -f rumi-poc-machine >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

archive="$work/$ASSET"
expanded="$work/expanded"
relocated="$work/relocated-podman"

echo "release=$VERSION"
echo "asset=$ASSET"
echo "url=$URL"
echo "host=$(sw_vers -productVersion)"
echo "arch=$(uname -m)"

curl -fsSL --retry 3 --retry-delay 2 -o "$archive" "$URL"
actual=$(shasum -a 256 "$archive" | sed 's/[[:space:]].*$//')
[ "$actual" = "$SHA256" ] || {
  echo "ERROR sha256 mismatch: $actual" >&2
  exit 1
}
echo "sha256=PASS"

echo "package-signature-begin"
pkgutil --check-signature "$archive"
echo "package-signature-end"

echo "gatekeeper-begin"
spctl -a -vv -t install "$archive" || true
echo "gatekeeper-end"

pkgutil --expand-full "$archive" "$expanded"

echo "installer-scripts-begin"
find "$expanded" -type f \( -name preinstall -o -name postinstall \) -print | sort
echo "installer-scripts-end"

payload_podman=$(find "$expanded" -type d -path '*/Payload/podman' -print | sed -n '1p')
[ -n "$payload_podman" ] && [ -d "$payload_podman" ] || {
  echo "ERROR official podman payload not found" >&2
  find "$expanded" -maxdepth 5 -print >&2
  exit 1
}

cp -R "$payload_podman" "$relocated"
PODMAN_BIN="$relocated/bin/podman"
[ -x "$PODMAN_BIN" ] || {
  echo "ERROR relocated podman binary missing" >&2
  exit 1
}

echo "relocated-root=$relocated"
echo "payload-binaries-begin"
find "$relocated/bin" -type f -maxdepth 1 -print | sed "s|$relocated/||" | sort
echo "payload-binaries-end"

for binary in podman gvproxy vfkit krunkit podman-mac-helper; do
  path="$relocated/bin/$binary"
  [ -x "$path" ] || {
    echo "ERROR expected official binary missing: $binary" >&2
    exit 1
  }
  codesign --verify --deep --strict "$path"
  echo "codesign-$binary=PASS"
done

hardcoded_helpers=$(strings "$PODMAN_BIN" | grep -c '/opt/podman/bin' || true)
echo "hardcoded-opt-podman-bin-string-count=$hardcoded_helpers"

state="$work/state"
export HOME="$state/home"
export XDG_CONFIG_HOME="$state/config"
mkdir -p "$HOME" "$XDG_CONFIG_HOME/containers"
cat > "$XDG_CONFIG_HOME/containers/containers.conf" <<EOF_CONF
[engine]
helper_binaries_dir = ["$relocated/bin"]
EOF_CONF
export PATH="$relocated/bin:$PATH"

"$PODMAN_BIN" --version
"$PODMAN_BIN" machine info
"$PODMAN_BIN" machine list
"$PODMAN_BIN" system connection list

init_log="$work/machine-init.log"
if "$PODMAN_BIN" --log-level=debug machine init --cpus 1 --memory 2048 --disk-size 10 rumi-poc-machine >"$init_log" 2>&1; then
  cat "$init_log"
  echo "machine-init=PASS"
  "$PODMAN_BIN" machine inspect rumi-poc-machine
else
  status=$?
  cat "$init_log"
  echo "machine-init=FAIL:$status"
  exit "$status"
fi

echo "NOTE machine start is intentionally not claimed: GitHub hosted macOS runners do not support nested virtualization"
echo "PASS official Podman macOS pkg relocated-payload experiment"
