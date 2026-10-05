#!/usr/bin/env bash
set -euo pipefail

ROOT=${ROOT:?}
OUT=${OUT:?}
mkdir -p "$OUT"

run_pkg() {
  "$ROOT/m" "$ROOT/bin/sys/pkg" "$@"
}

export PATH="$ROOT/bin/sys:$PATH"

"$ROOT/m" "$ROOT/bin/sys/osarch" update >"$OUT/osarch.out" 2>"$OUT/osarch.err"

run_pkg install temurin >"$OUT/install-temurin.out" 2>"$OUT/install-temurin.err"
run_pkg install keycloak >"$OUT/install-keycloak.out" 2>"$OUT/install-keycloak.err"

identity=$(run_pkg default keycloak)
printf '%s\n' "$identity" >"$OUT/identity.txt"
case "$identity" in
  *'!'*) echo "platform-independent Keycloak concrete unexpectedly carries osarch: $identity" >&2; exit 1 ;;
esac
concrete="$ROOT/pkg/$identity"
package_root="$concrete/root"

test -L "$package_root/conf"
test -L "$package_root/data"
test -L "$package_root/lib/quarkus"

conf_state=$("$ROOT/m" "$ROOT/bin/sys/state-path" system pkg keycloak conf)
data_state=$("$ROOT/m" "$ROOT/bin/sys/state-path" system pkg keycloak data)
cache_state=$("$ROOT/m" "$ROOT/bin/sys/state-path" system pkg keycloak cache)

printf '%s\n' "$conf_state" >"$OUT/conf-state.txt"
printf '%s\n' "$data_state" >"$OUT/data-state.txt"
printf '%s\n' "$cache_state" >"$OUT/cache-state.txt"
readlink "$package_root/conf" >"$OUT/conf-link.txt"
readlink "$package_root/data" >"$OUT/data-link.txt"
readlink "$package_root/lib/quarkus" >"$OUT/cache-link.txt"

test -d "$conf_state/conf"
test -d "$data_state/data"
test -d "$cache_state/lib/quarkus"

hash_quarkus() {
  local output=$1
  (
    cd "$cache_state/lib/quarkus"
    find . -type f -print0 | sort -z |
      while IFS= read -r -d '' f; do
        sha256sum "$f"
      done
  ) >"$output"
}

hash_quarkus "$OUT/cache.before"

set +e
timeout --signal=TERM 30s "$ROOT/m" keycloak start-dev --http-port=18200 --db=dev-mem   >"$OUT/start-dev.out" 2>"$OUT/start-dev.err"
status=$?
set -e
printf '%s\n' "$status" >"$OUT/start-dev.status"
test "$status" -eq 124

hash_quarkus "$OUT/cache.after"
diff -u "$OUT/cache.before" "$OUT/cache.after" >"$OUT/cache.diff" || true

test -s "$OUT/cache.diff"
test -d "$data_state/data/transaction-logs"
test -L "$package_root/lib/quarkus"

printf 'identity=%s\n' "$identity"
printf 'conf-link=%s\n' "$(cat "$OUT/conf-link.txt")"
printf 'data-link=%s\n' "$(cat "$OUT/data-link.txt")"
printf 'cache-link=%s\n' "$(cat "$OUT/cache-link.txt")"
printf '%s\n' '--- cache diff ---'
cat "$OUT/cache.diff"
printf '%s\n' '--- start-dev tail ---'
tail -n 40 "$OUT/start-dev.out" "$OUT/start-dev.err" || true
