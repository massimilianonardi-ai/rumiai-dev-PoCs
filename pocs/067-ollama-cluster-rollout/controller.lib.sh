# Source this in a credential-bearing rsudo-admin jobs shell, never as a separate process.
# This is a site-specific operator job, not a general m library.
cluster_rollout()
(
  set +x
  [ "$#" -eq 3 ] || { printf '%s\n' 'expected runtime, catalog and manifest SHA pins' >&2; return 1; }
  cluster_runtime=$1 cluster_catalog=$2 cluster_artifact=$3
  for value in "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
  do
    case "$value" in *[!0-9a-f]*|'') printf '%s\n' 'invalid pin' >&2; return 2 ;; esac
    case ${#value} in 40|64) ;; *) printf '%s\n' 'invalid pin length' >&2; return 3 ;; esac
  done
  [ "${#cluster_runtime}" -eq 40 ] && [ "${#cluster_catalog}" -eq 40 ] && [ "${#cluster_artifact}" -eq 64 ] || return 4
  cluster_dir=${rsudo_admin_job_library%/*}
  [ -f "$cluster_dir/host.sh" ] || { printf '%s\n' 'missing host.sh' >&2; return 5; }

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
    check=$(rsudo --load ":$group" -- /bin/sh -s -- check "$cluster_runtime" "$cluster_artifact" "$role" - \
      < "$cluster_dir/host.sh") || { printf 'CLUSTER PREFLIGHT FAILED %s\n' "$group" >&2; return 11; }
    printf '%s\n' "$check"
    head=$(printf '%s\n' "$check" | sed -n 's/^CLUSTER CHECK OK role=[a-z]* old=\([0-9a-f]\{40\}\) target=.*$/\1/p')
    case "$head" in *[!0-9a-f]*|'') printf 'CLUSTER INVALID PREFLIGHT RESPONSE %s\n' "$group" >&2; return 12 ;; esac
    [ "${#head}" -eq 40 ] || return 13
    eval "cluster_head_$group=\$head"
  done

  # Central host and one local 8GiB worker are distinct canaries.
  # The rest are strictly sequential; the first failed host stops promotion.
  for group in gis apps apisix keycloak apisix_psn apps_psn keycloak_psn webgisrpr
  do
    role=worker
    [ "$group" = gis ] && role=gis
    eval "expected=${cluster_head_$group}"
    printf 'CLUSTER APPLY %s expected=%s\n' "$group" "$expected"
    rsudo --load ":$group" -- /bin/sh -s -- apply "$cluster_runtime" "$cluster_artifact" "$role" "$expected" \
      < "$cluster_dir/host.sh" || {
        printf 'CLUSTER ROLLOUT STOPPED group=%s; no later nodes mutated\n' "$group" >&2
        return 14
      }
    printf 'CLUSTER NODE OK %s\n' "$group"
  done
  printf 'CLUSTER ROLLOUT OK runtime=%s catalog=%s artifact=%s\n' \
    "$cluster_runtime" "$cluster_catalog" "$cluster_artifact"
)
