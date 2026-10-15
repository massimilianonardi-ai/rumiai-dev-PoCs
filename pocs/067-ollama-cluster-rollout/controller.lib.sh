# Source this library in rsudo-admin jobs; it does not install a remote file.
# The remote program is the same text for global check and ordered apply.
cluster_remote_source()
{
  cat <<'REMOTE_SH'
# Remote root-owned, Ubuntu-specific cluster reconciliation. Invoked through rsudo.
set -u
LC_ALL=C
export LC_ALL
PATH=/usr/bin:/bin
export PATH

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
case "$artifact_sha" in *[!0-9a-f]*|'') fail 'invalid artifact SHA pin' 46 ;; esac
[ "${#artifact_sha}" -eq 64 ] || fail 'invalid artifact SHA length' 47
[ "$(id -u)" -eq 0 ] || fail 'remote operation requires root' 6
root=/m/src/git/rumiai-os
[ -d "$root/.git" ] || fail 'missing managed runtime checkout' 7
old_head=$(git -C "$root" rev-parse HEAD) || fail 'cannot read installed runtime revision' 8
if [ "$mode" = apply ]
then
  case "$expected_head" in *[!0-9a-f]*|'') fail 'invalid expected HEAD' 9 ;; esac
  [ "${#expected_head}" -eq 40 ] || fail 'invalid expected HEAD length' 48
  [ "$expected_head" = "$old_head" ] || fail 'concurrent runtime revision change' 49
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
  # pkg integration stores the CPU payload, not necessarily its source manifest.
  # Retain digest proof by hashing an external immutable manifest and checking
  # each corresponding file in the actual installed concrete package root.
  manifest=
  for candidate in \
    "$pkgroot/MANIFEST.sha256" \
    /var/lib/ollama-worker/runtime/0.35.1-cpu/MANIFEST.sha256 \
    /mnt/rumiai-ai/runtime/MANIFEST.sha256
  do
    [ -f "$candidate" ] || continue
    manifest_sha=$(sha256sum "$candidate") || fail 'cannot hash worker artifact manifest' 20
    manifest_sha=${manifest_sha%% *}
    [ "$manifest_sha" = "$artifact_sha" ] || fail 'worker artifact manifest digest mismatch' 21
    manifest=$candidate
    break
  done
  [ -n "$manifest" ] || fail 'CPU artifact manifest absent from known worker sources' 19
  (cd "$pkgroot" && sha256sum --status -c "$manifest") || fail 'installed CPU payload integrity mismatch' 22
  printf 'CLUSTER ARTIFACT OK role=worker manifest=%s verified-root=%s\n' "$manifest" "$pkgroot"
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
  printf 'CLUSTER ARTIFACT OK role=gis manifest=%s verified-root=%s\n' /m/ai/runtime/ollama/0.35.1-cpu/MANIFEST.sha256 /m/ai/runtime/ollama/0.35.1-cpu
fi

[ "$(systemctl is-enabled m-srv-ollama.service)" = enabled ] || fail 'system service not enabled' 30
[ "$(systemctl is-active m-srv-ollama.service)" = active ] || fail 'system service not active' 31
printf 'CLUSTER CHECK OK role=%s old=%s target=%s artifact=%s\n' "$role" "$old_head" "$runtime_sha" "$artifact_sha"
[ "$mode" = apply ] || exit 0

updated=no
if [ "$old_head" != "$runtime_sha" ]
then
  # Revert only the managed platform selectors before a fast-forward merge.
  git -C "$root" restore -- bin/sys-osarch bin/ext-osarch bin/ai-osarch || fail 'platform selector restore failed' 32
  if ! git -C "$root" merge --ff-only "$runtime_sha"
  then
    "$root/m" osarch set linux-x86_64 || :
    fail 'fast-forward failed; original untracked material preserved' 33
  fi
  updated=yes
fi
"$root/m" osarch set linux-x86_64 || fail 'platform activation failed' 34
[ "$(git -C "$root" rev-parse HEAD)" = "$runtime_sha" ] || fail 'runtime revision differs after merge' 35
# Preserve a healthy unchanged service on repeat runs. A real revision change
# or an unhealthy API/service always triggers normal srv reconciliation.
need_restart=$updated
if ! systemctl is-active --quiet m-srv-ollama.service
then
  need_restart=yes
elif ! curl -fsS --max-time 3 http://127.0.0.1:11435/api/version 2>/dev/null | grep -q '0.35.1'
then
  need_restart=yes
fi
if [ "$need_restart" = yes ]
then
  "$root/m" srv host system install ollama ollama || fail 'system service reconciliation failed' 36
  "$root/m" srv host system restart ollama || fail 'system service restart failed' 37
fi
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
REMOTE_SH
}

cluster_remote_call()
{
  [ "$#" -eq 4 ] || return 2
  group=$1 mode=$2 role=$3 expected=$4
  case "$group" in
    gis|apps|apisix|keycloak|apisix_psn|apps_psn|keycloak_psn|webgisrpr) ;;
    *) printf 'CLUSTER INVALID GROUP %s\n' "$group" >&2; return 2 ;;
  esac
  printf '%s\n' "$cluster_remote_program" |
    rsudo --load ":$group" -- /bin/sh -s -- "$mode" "$cluster_runtime" "$cluster_artifact" "$role" "$expected"
}

repair_ollama_nfs_worker()
{
  [ "$#" -eq 2 ] || return 2
  case "$1" in
    apps|apisix|keycloak|apisix_psn|apps_psn|keycloak_psn|webgisrpr) ;;
    *) printf 'CLUSTER INVALID WORKER %s\n' "$1" >&2; return 2 ;;
  esac
  cluster_remote_call "$1" apply worker "$2"
}
# Source this in a credential-bearing rsudo-admin jobs shell, never as a separate process.
# This is a site-specific operator job, not a general m library.
cluster_rollout()
(
  set +x
  [ "$#" -ge 3 ] && [ "$#" -le 4 ] || { printf '%s\n' 'expected runtime, catalog, manifest pins and optional check|canary|rollout mode' >&2; return 1; }
  cluster_runtime=$1 cluster_catalog=$2 cluster_artifact=$3 cluster_mode=${4:-rollout}
  case "$cluster_mode" in check|canary|rollout) ;; *) printf '%s\n' 'invalid rollout mode' >&2; return 15 ;; esac
  for value in "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
  do
    case "$value" in *[!0-9a-f]*|'') printf '%s\n' 'invalid pin' >&2; return 2 ;; esac
    case ${#value} in 40|64) ;; *) printf '%s\n' 'invalid pin length' >&2; return 3 ;; esac
  done
  [ "${#cluster_runtime}" -eq 40 ] && [ "${#cluster_catalog}" -eq 40 ] && [ "${#cluster_artifact}" -eq 64 ] || return 4
  cluster_remote_program=$(cluster_remote_source) || return 5
  [ -n "$cluster_remote_program" ] || return 5

  # Catalog is frozen and verified once on the caller before any privileged remote work.
  cluster_catalog_tmp=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-cluster-catalog.XXXXXXXX") || return 6
  trap 'command -p rm -rf -- "$cluster_catalog_tmp"' 0
  git -C "$cluster_catalog_tmp" init -q || return 7
  git -C "$cluster_catalog_tmp" fetch --quiet --depth=1 https://github.com/massimilianonardi-ai/pkg-catalog.git "$cluster_catalog" || {
    printf '%s\n' 'cannot fetch pinned catalog commit' >&2; return 8;
  }
  git -C "$cluster_catalog_tmp" cat-file -e "$cluster_catalog^{commit}" || return 9
  git -C "$cluster_catalog_tmp" cat-file -e "$cluster_catalog:pkg/ollama/linux-x86_64/n0001=v0.35.1" 2>/dev/null || {
    # The catalog anchor is a directory tree, not a single file.
    git -C "$cluster_catalog_tmp" ls-tree "$cluster_catalog" pkg/ollama/linux-x86_64/n0001=v0.35.1 | grep -q . || return 10
  }
  printf 'CLUSTER PIN runtime=%s catalog=%s artifact=%s\n' "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"

  # Preflight every host before any service or checkout mutation.
  for group in gis apps apisix keycloak apisix_psn apps_psn keycloak_psn webgisrpr
  do
    role=worker
    [ "$group" = gis ] && role=gis
    printf 'CLUSTER PREFLIGHT %s\n' "$group"
    if check=$(cluster_remote_call "$group" check "$role" -)
    then
      printf '%s\n' "$check"
    else
      status=$?
      [ -z "$check" ] || printf '%s\n' "$check"
      printf 'CLUSTER PREFLIGHT FAILED %s status=%s\n' "$group" "$status" >&2
      return 11
    fi
    head=$(printf '%s\n' "$check" | sed -n 's/^CLUSTER CHECK OK role=[a-z]* old=\([0-9a-f]\{40\}\) target=.*$/\1/p')
    case "$head" in *[!0-9a-f]*|'') printf 'CLUSTER INVALID PREFLIGHT RESPONSE %s\n' "$group" >&2; return 12 ;; esac
    [ "${#head}" -eq 40 ] || return 13
    eval "cluster_head_$group=\$head"
  done

  if [ "$cluster_mode" = check ]
  then
    printf 'CLUSTER PREFLIGHT OK runtime=%s catalog=%s artifact=%s\n' \
      "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
    return 0
  fi

  # Central host and one local 8GiB worker are distinct canaries.
  # The rest are strictly sequential; the first failed host stops promotion.
  for group in gis apps apisix keycloak apisix_psn apps_psn keycloak_psn webgisrpr
  do
    role=worker
    [ "$group" = gis ] && role=gis
    eval "expected=\${cluster_head_$group}"
    printf 'CLUSTER APPLY %s expected=%s\n' "$group" "$expected"
    if [ "$group" = gis ]
    then
      cluster_remote_call "$group" apply "$role" "$expected"
    else
      repair_ollama_nfs_worker "$group" "$expected"
    fi || {
        printf 'CLUSTER ROLLOUT STOPPED group=%s; no later nodes mutated\n' "$group" >&2
        return 14
      }
    printf 'CLUSTER NODE OK %s\n' "$group"
    if [ "$cluster_mode" = canary ] && [ "$group" = apps ]
    then
      printf 'CLUSTER CANARY OK runtime=%s catalog=%s artifact=%s\n' \
        "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
      return 0
    fi
  done
  printf 'CLUSTER ROLLOUT OK runtime=%s catalog=%s artifact=%s\n' \
    "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
)
