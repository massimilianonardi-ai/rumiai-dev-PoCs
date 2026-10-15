#!/bin/sh
# Isolated Git safety fixture. External systemd/API/pkg paths are deliberately simulated.
set -eu

[ "$(id -u)" -eq 0 ] || { echo 'requires disposable root container' >&2; exit 77; }
[ ! -e /m ] || { echo '/m exists: refusing to overwrite runtime content' >&2; exit 77; }
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
. "$script_dir/controller.lib.sh"
base=$(mktemp -d)
cleanup() { rm -rf -- "$base"; rm -rf -- /m; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$base/bin" /m/src/git /m/ai/runtime/ollama/0.35.1-cpu
cluster_remote_source > "$base/host.sh"
cat > "$base/bin/systemctl" <<'SYSTEMCTL'
#!/bin/sh
case "$1" in is-enabled) echo enabled;; is-active) echo active;; *) exit 1;; esac
SYSTEMCTL
cat > "$base/bin/curl" <<'CURL'
#!/bin/sh
case " $* " in
  *'/api/version'*) echo '{"version":"0.35.1"}' ;;
  *'/api/tags'*) echo '{"models":[{"name":"qwen3:4b"}]}' ;;
  *'/api/chat'*) echo '{"done":true}' ;;
  *) exit 1 ;;
esac
CURL
chmod +x "$base/bin/systemctl" "$base/bin/curl"
export PATH="$base/bin:$PATH"
echo CPU > /m/ai/runtime/ollama/0.35.1-cpu/payload
( cd /m/ai/runtime/ollama/0.35.1-cpu && sha256sum payload > MANIFEST.sha256 )
artifact_sha=$(sha256sum /m/ai/runtime/ollama/0.35.1-cpu/MANIFEST.sha256)
artifact_sha=${artifact_sha%% *}
mkdir -p "$base/source/bin/sys-linux-arm64" "$base/source/bin/ext-linux-arm64" "$base/source/bin/ai-linux-arm64" "$base/source/bin/sys-linux-x86_64" "$base/source/bin/ext-linux-x86_64" "$base/source/bin/ai-linux-x86_64"
for n in sys ext ai
do
  ln -s "$n-linux-arm64" "$base/source/bin/$n-osarch"
done
cat > "$base/source/m" <<'M'
#!/bin/sh
case "$1 $2 $3" in
  'pkg default ollama') echo 'ollama@v0.35.1!linux-x86_64' ;;
  'osarch set linux-x86_64')
    for n in sys ext ai
    do
      rm -f "${0%/*}/bin/$n-osarch"
      ln -s "$n-linux-x86_64" "${0%/*}/bin/$n-osarch"
    done ;;
  'srv host system') exit 0 ;;
  *) exit 1 ;;
esac
M
chmod +x "$base/source/m"
echo baseline > "$base/source/marker"
git -C "$base/source" init -q
git -C "$base/source" branch -m main
git -C "$base/source" -c user.name=Test -c user.email=test@example.org add -A
git -C "$base/source" -c user.name=Test -c user.email=test@example.org commit -qm baseline
old=$(git -C "$base/source" rev-parse HEAD)
echo update > "$base/source/marker"
git -C "$base/source" add marker
git -C "$base/source" -c user.name=Test -c user.email=test@example.org commit -qm update
pin=$(git -C "$base/source" rev-parse HEAD)
git -C "$base/source" clone -q --bare . "$base/origin.git"
git clone -q "$base/origin.git" /m/src/git/rumiai-os
root=/m/src/git/rumiai-os
git -C "$root" checkout -q -B deployed "$old"
mkdir -p "$root/pkg/ollama@v0.35.1!linux-x86_64/root"
# This is an identity-only fixture; never presented as a real package test.
rm "$root/bin/sys-osarch" "$root/bin/ext-osarch" "$root/bin/ai-osarch"
for n in sys ext ai; do ln -s "$n-linux-x86_64" "$root/bin/$n-osarch"; done
echo 'must-survive' > "$root/operational-state"
# Any unrelated tracked modification must fail preflight.
echo unauthorized > "$root/marker"
if sh "$base/host.sh" check "$pin" "$artifact_sha" gis - > "$base/rejected.log" 2>&1
then echo 'FAIL: unrelated edit passed' >&2; exit 1; fi
grep -q 'unmanaged tracked modification' "$base/rejected.log"
git -C "$root" restore -- marker
# Expected head must be preserved, exact target applied, untracked state retained.
sh "$base/host.sh" check "$pin" "$artifact_sha" gis - > "$base/check.log"
grep -q "old=$old target=$pin" "$base/check.log"
sh "$base/host.sh" apply "$pin" "$artifact_sha" gis "$old" > "$base/apply.log"
[ "$(git -C "$root" rev-parse HEAD)" = "$pin" ]
[ "$(cat "$root/operational-state")" = 'must-survive' ]
grep -q 'CLUSTER APPLY OK' "$base/apply.log"
# Reapply the exact pin. The normal path must not recreate or restart an
# already healthy, unchanged service; all existing operational state remains.
sh "$base/host.sh" apply "$pin" "$artifact_sha" gis "$pin" > "$base/idempotent.log"
grep -q 'CLUSTER APPLY OK' "$base/idempotent.log"
# A moving expected HEAD must be rejected instead of merging.
if sh "$base/host.sh" apply "$pin" "$artifact_sha" gis "$old" > "$base/stale.log" 2>&1
then echo 'FAIL: stale expected HEAD passed' >&2; exit 1; fi
grep -q 'concurrent runtime revision change' "$base/stale.log"
echo 'PASS: isolated git safety, pin, idempotent forward update, untracked preservation'
