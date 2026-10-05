#!/usr/bin/env bash
set -euo pipefail

ROOT=${ROOT:?}
ARTIFACT=${ARTIFACT:?}
OUT=${OUT:?}

mkdir -p "$OUT"

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
        else
          printf '%s\tO\t-\n' "$rel"
        fi
      done
  ) > "$output"
}

classify_delta() {
  local before=$1
  local after=$2
  local output=$3
  awk -F '\t' '
    NR==FNR { before[$1]=$0; next }
    {
      after[$1]=$0
      if (!($1 in before)) {
        print "added\t" $1
      } else if (before[$1] != $0) {
        print "modified\t" $1
      }
    }
    END {
      for (p in before)
        if (!(p in after))
          print "removed\t" p
    }
  ' "$before" "$after" | LC_ALL=C sort > "$output"
}

extract_fresh() {
  local target=$1
  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$ARTIFACT" -C "$target" --strip-components=1
  test -x "$target/bin/kc.sh"
}

write_wrapper() {
  local target=$1
  local case_name=$2
  local port=$3
  local external=$4
  local wrapper="$target/.poc-keycloak-$case_name"

  case "$case_name" in
    baseline)
      cat > "$wrapper" <<EOF
#!/bin/sh
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port
EOF
      ;;
    dev-mem)
      cat > "$wrapper" <<EOF
#!/bin/sh
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port --db=dev-mem
EOF
      ;;
    external-db-cli)
      mkdir -p "$external/db"
      cat > "$wrapper" <<EOF
#!/bin/sh
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port --db=dev-file --db-url='jdbc:h2:file:$external/db/keycloakdb;NON_KEYWORDS=VALUE'
EOF
      ;;
    external-db-env)
      mkdir -p "$external/db"
      cat > "$wrapper" <<EOF
#!/bin/sh
KC_DB=dev-file
KC_DB_URL='jdbc:h2:file:$external/db/keycloakdb;NON_KEYWORDS=VALUE'
export KC_DB KC_DB_URL
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port
EOF
      ;;
    external-log-cli)
      mkdir -p "$external/log"
      cat > "$wrapper" <<EOF
#!/bin/sh
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port --db=dev-mem --log=console,file --log-file='$external/log/keycloak.log'
EOF
      ;;
    external-log-env)
      mkdir -p "$external/log"
      cat > "$wrapper" <<EOF
#!/bin/sh
KC_DB=dev-mem
KC_LOG=console,file
KC_LOG_FILE='$external/log/keycloak.log'
export KC_DB KC_LOG KC_LOG_FILE
exec timeout --signal=TERM 30s ./bin/kc.sh start-dev --http-port=$port
EOF
      ;;
    *)
      echo "unknown case: $case_name" >&2
      return 2
      ;;
  esac
  chmod 700 "$wrapper"
}

run_case() {
  local case_name=$1
  local port=$2
  local case_dir="$OUT/$case_name"
  local tree="$case_dir/root"
  local external="$case_dir/external"

  mkdir -p "$case_dir" "$external"
  extract_fresh "$tree"
  write_wrapper "$tree" "$case_name" "$port" "$external"

  export PATH="$ROOT:$ROOT/bin/sys:$PATH"

  printf '\n' | "$ROOT/bin/sys/pkg-analyze" "$tree"     > "$case_dir/discovery.txt"     2> "$case_dir/discovery.stderr"

  candidate_id=$(awk -F '\t' -v wanted=".poc-keycloak-$case_name"     '$2 == "executable" && $3 == wanted { print $1; exit }'     "$case_dir/discovery.txt")
  test -n "$candidate_id"
  printf '%s\n' "$candidate_id" > "$case_dir/candidate-id.txt"

  snapshot_tree "$tree" "$case_dir/root.before"
  snapshot_tree "$external" "$case_dir/external.before"

  set +e
  printf '%s\ny\n\n' "$candidate_id" |
    timeout 55s "$ROOT/bin/sys/pkg-analyze" "$tree"       > "$case_dir/probe.txt"       2> "$case_dir/probe.stderr"
  probe_status=$?
  set -e
  printf '%s\n' "$probe_status" > "$case_dir/probe-status.txt"

  snapshot_tree "$tree" "$case_dir/root.after"
  snapshot_tree "$external" "$case_dir/external.after"
  classify_delta "$case_dir/root.before" "$case_dir/root.after" "$case_dir/root.delta"
  classify_delta "$case_dir/external.before" "$case_dir/external.after" "$case_dir/external.delta"

  echo "===== $case_name ====="
  echo "pkg-analyze status: $probe_status"
  echo "--- root delta ---"
  cat "$case_dir/root.delta"
  echo "--- external delta ---"
  cat "$case_dir/external.delta"
  echo "--- pkg-analyze report ---"
  cat "$case_dir/probe.txt"
  echo "--- diagnostics (tail) ---"
  tail -n 80 "$case_dir/probe.stderr" || true

  test "$probe_status" -eq 0
}

help_root="$OUT/help-root"
extract_fresh "$help_root"
set +e
"$help_root/bin/kc.sh" start-dev --help > "$OUT/start-dev-help.txt" 2>&1
"$help_root/bin/kc.sh" build --help > "$OUT/build-help.txt" 2>&1
"$help_root/bin/kc.sh" import --help > "$OUT/import-help.txt" 2>&1
"$help_root/bin/kc.sh" export --help > "$OUT/export-help.txt" 2>&1
set -e
rm -rf "$help_root"

run_case baseline 18100
run_case dev-mem 18101
run_case external-db-cli 18102
run_case external-db-env 18103
run_case external-log-cli 18104
run_case external-log-env 18105
