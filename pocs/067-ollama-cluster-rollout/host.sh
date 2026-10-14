#!/bin/sh
# Remote root-owned, Ubuntu-specific cluster reconciliation. Invoked through rsudo.
set -u
LC_ALL=C
export LC_ALL

fail()
{
  printf 'CLUSTER ERROR: %s\n' "$1" >&2
  exit "$2"
}

[ "$#" -eq 5 ] || fail 'expected: mode runtime-sha artifact-manifest-sha role expected-head' 1
mode=$1 runtime_sha=$2 artifact_sha=$3 role=$4 expected_head=$5
case "$mode" in check|apply) ;; *) fail 'invalid mode' 2 ;; esac
case "$role" in gis|worker) ;; *) fail 'invalid host role' 3 ;; esac
case "$runtime_sha" in *[!0-9a-f]*|'') fail 'invalid runtime SHA pin' 4 ;; esac
[ "${#runtime_sha}" -eq 40 ] || fail 'invalid runtime SHA length' 5
case "$artifact_sha" in *[!0-9a-f]*|'') fail 'invalid artifact SHA pin' 49 ;; esac
[ "${#artifact_sha}" -eq 64 ] || fail 'invalid artifact SHA length' 46
[ "$(id -u)" -eq 0 ] || fail 'remote operation requires root' 6
root=/m/src/git/rumiai-os
[ -d "$root/.git" ] || fail 'missing managed runtime checkout' 7
old_head=$(git -C "$root" rev-parse HEAD) || fail 'cannot read installed runtime revision' 8
if [ "$mode" = apply ]
then
  case "$expected_head" in *[!0-9a-f]*|'') fail 'invalid expected HEAD' 9 ;; esac
  [ "${#expected_head}" -eq 40 ] || fail 'invalid expected HEAD length' 47
  [ "$expected_head" = "$old_head" ] || fail 'concurrent runtime revision change' 48
fi
changes=$(git -C "$root" status --porcelain --untracked-files=no) || fail 'cannot inspect tracked modifications' 10
# The three platform selectors are the only tolerated tracked mutations.
while IFS= read -r line
do
  case "$line" in
    ''|' M bin/sys-osarch'|' M bin/ext-osarch'|' M bin/ai-osarch') ;;
    *) fail "unmanaged tracked modification: $line" 11 ;;
  esac
done <<EOF_CHANGES
$changes
EOF_CHANGES

# Fetch only; no checkout, clean, reset, or service mutation during preflight.
git -C "$root" fetch --quiet origin main || fail 'runtime source fetch failed' 12
git -C "$root" cat-file -e "$runtime_sha^{commit}" 2>/dev/null || fail 'requested runtime revision unavailable' 13
git -C "$root" merge-base --is-ancestor "$runtime_sha" origin/main || fail 'pin not on fetched mainline' 14
git -C "$root" merge-base --is-ancestor "$old_head" "$runtime_sha" || fail 'pin is not a forward update' 15

pkg=ollama@v0.35.1\!linux-x86_64
pkgroot="$root/pkg/$pkg/root"
[ -d "$pkgroot" ] || fail 'expected installed concrete package root missing' 16
actual_default=$("$root/m" pkg default ollama) || fail 'cannot resolve Ollama facility default' 17
[ "$actual_default" = "$pkg" ] || fail 'unexpected Ollama concrete provider default' 18

if [ "$role" = worker ]
then
  # The installed immutable CPU payload is the pinned artifact, not a new pkg download.
  [ -f "$pkgroot/MANIFEST.sha256" ] || fail 'installed artifact manifest missing' 19
  actual_artifact_sha=$(sha256sum "$pkgroot/MANIFEST.sha256") || fail 'artifact-manifest digest unreadable' 20
  actual_artifact_sha=${actual_artifact_sha%% *}
  [ "$actual_artifact_sha" = "$artifact_sha" ] || fail 'installed artifact-manifest digest mismatch' 21
  (cd "$pkgroot" && sha256sum --status -c MANIFEST.sha256) || fail 'installed artifact content corrupted' 22
  awk '
    $2 == "/mnt/rumiai-ai/models" {
      count++
      if ($1 == "10.200.0.19:/m/ai/ollama/models" && $3 == "nfs4" &&
          $4 == "ro,vers=4.2,hard,proto=tcp,timeo=600,retrans=2,sec=sys,_netdev") matching++
    }
    END { exit !(count == 1 && matching == 1) }
  ' /etc/fstab || fail 'persistent model mount differs from validated configuration' 23
  mountpoint -q /mnt/rumiai-ai/models || fail 'model store not mounted' 24
  findmnt -n -o OPTIONS --target /mnt/rumiai-ai/models | grep -Eq '(^|,)ro(,|$)' || fail 'model mount is not read only' 25
  systemctl cat m-srv-ollama.service | grep -F 'RequiresMountsFor=/mnt/rumiai-ai/models' >/dev/null || fail 'missing persistent model mount dependency' 26
else
  [ -f /m/ai/runtime/ollama/0.35.1-cpu/MANIFEST.sha256 ] || fail 'central artifact manifest missing' 27
  actual_artifact_sha=$(sha256sum /m/ai/runtime/ollama/0.35.1-cpu/MANIFEST.sha256) || fail 'central artifact-manifest digest unreadable' 28
  actual_artifact_sha=${actual_artifact_sha%% *}
  [ "$actual_artifact_sha" = "$artifact_sha" ] || fail 'central artifact-manifest digest mismatch' 29
  (cd /m/ai/runtime/ollama/0.35.1-cpu && sha256sum --status -c MANIFEST.sha256) || fail 'central artifact content corrupted' 45
fi

[ "$(systemctl is-enabled m-srv-ollama.service)" = enabled ] || fail 'system service not enabled' 30
[ "$(systemctl is-active m-srv-ollama.service)" = active ] || fail 'system service not active' 31
printf 'CLUSTER CHECK OK role=%s old=%s target=%s artifact=%s\n' "$role" "$old_head" "$runtime_sha" "$artifact_sha"
[ "$mode" = apply ] || exit 0

if [ "$old_head" != "$runtime_sha" ]
then
  # Revert only the managed platform selectors before a fast-forward merge.
  git -C "$root" restore -- bin/sys-osarch bin/ext-osarch bin/ai-osarch || fail 'platform selector restore failed' 32
  if ! git -C "$root" merge --ff-only "$runtime_sha"
  then
    "$root/m" osarch set linux-x86_64 || :
    fail 'fast-forward failed; original untracked material preserved' 33
  fi
fi
"$root/m" osarch set linux-x86_64 || fail 'platform activation failed' 34
[ "$(git -C "$root" rev-parse HEAD)" = "$runtime_sha" ] || fail 'runtime revision differs after merge' 35
# Reconcile the exact provider under the already-provisioned non-login account.
"$root/m" srv host system install ollama ollama || fail 'system service reconciliation failed' 36
"$root/m" srv host system restart ollama || fail 'system service restart failed' 37
[ "$(systemctl is-enabled m-srv-ollama.service)" = enabled ] || fail 'system service no longer enabled' 38
[ "$(systemctl is-active m-srv-ollama.service)" = active ] || fail 'system service no longer active' 39
# The provider has its own startup readiness. Do not treat systemctl active as API ready.
ready=no
attempt=0
while [ "$attempt" -lt 30 ]
do
  version=$(curl -fsS --max-time 3 http://127.0.0.1:11435/api/version 2>/dev/null) && {
    case "$version" in *'0.35.1'*) ready=yes; break ;; esac
  }
  attempt=$((attempt + 1))
  sleep 2
done
[ "$ready" = yes ] || fail 'Ollama API version/readiness failed' 40
tags=$(curl -fsS --max-time 10 http://127.0.0.1:11435/api/tags) || fail 'Ollama model list failed' 41
case "$tags" in *'qwen3:4b'*) ;; *) fail 'expected shared model missing' 42 ;; esac
response=$(curl -fsS --max-time 240 \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:4b","messages":[{"role":"user","content":"Reply briefly with a greeting."}],"think":false,"stream":false,"options":{"num_predict":32}}' \
  http://127.0.0.1:11435/api/chat) || fail 'CPU inference probe failed' 43
printf '%s\n' "$response" | grep -Eq '"done"[[:space:]]*:[[:space:]]*true' || fail 'inference did not complete' 44
printf 'CLUSTER APPLY OK role=%s revision=%s artifact=%s\n' "$role" "$runtime_sha" "$artifact_sha"
