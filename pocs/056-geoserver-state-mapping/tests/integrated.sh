#!/usr/bin/env bash
set -euo pipefail

ROOT=${ROOT:?}
OUT=${OUT:?}
mkdir -p "$OUT"

run_pkg() {
  "$ROOT/m" "$ROOT/bin/sys/pkg" "$@"
}

snapshot_tree() {
  local tree=$1
  local output=$2
  (
    cd "$tree"
    find . -mindepth 1 -print0 |
      sort -z |
      while IFS= read -r -d '' path; do
        rel=${path#./}
        if [ -L "$path" ]; then
          printf '%s\tL\t%s\n' "$rel" "$(readlink "$path")"
        elif [ -d "$path" ]; then
          printf '%s\tD\t-\n' "$rel"
        elif [ -f "$path" ]; then
          digest=$(sha256sum "$path" | awk '{print $1}')
          size=$(stat -c '%s' "$path")
          printf '%s\tF\t%s:%s\n' "$rel" "$size" "$digest"
        fi
      done
  ) > "$output"
}

classify_delta() {
  awk -F '\t' '
    NR==FNR { before[$1]=$0; next }
    {
      after[$1]=$0
      if (!($1 in before)) print "added\t" $1
      else if (before[$1] != $0) print "modified\t" $1
    }
    END {
      for (p in before)
        if (!(p in after)) print "removed\t" p
    }
  ' "$1" "$2" | LC_ALL=C sort > "$3"
}

export PATH="$ROOT/bin/sys:$PATH"
"$ROOT/m" "$ROOT/bin/sys/osarch" update >"$OUT/osarch.out" 2>"$OUT/osarch.err"

run_pkg install geoserver@3.0.1 >"$OUT/install.out" 2>"$OUT/install.err"

identity=$(run_pkg default geoserver)
printf '%s\n' "$identity" >"$OUT/identity.txt"
case "$identity" in
  *'!'*) echo "platform-independent GeoServer concrete unexpectedly carries osarch: $identity" >&2; exit 1 ;;
esac

concrete="$ROOT/pkg/$identity"
package_root="$concrete/root"
test -d "$package_root"
snapshot_tree "$package_root" "$OUT/root.before"

set +e
JETTY_OPTS='jetty.http.port=18310'   timeout --signal=TERM 35s "$ROOT/m" geoserver-start   >"$OUT/start.out" 2>"$OUT/start.err"
status=$?
set -e
printf '%s\n' "$status" >"$OUT/start.status"
test "$status" -eq 124

snapshot_tree "$package_root" "$OUT/root.after"
classify_delta "$OUT/root.before" "$OUT/root.after" "$OUT/root.delta"

printf 'identity=%s\n' "$identity"
printf '%s\n' '--- root delta ---'
cat "$OUT/root.delta"
printf '%s\n' '--- start tail ---'
tail -n 80 "$OUT/start.out" "$OUT/start.err" || true
