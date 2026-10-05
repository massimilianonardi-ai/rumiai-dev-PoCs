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
      if (!($1 in before)) print "added\t" $1
      else if (before[$1] != $0) print "modified\t" $1
    }
    END {
      for (p in before)
        if (!(p in after)) print "removed\t" p
    }
  ' "$before" "$after" | LC_ALL=C sort > "$output"
}

extract_fresh() {
  local target=$1
  rm -rf "$target"
  mkdir -p "$target"
  unzip -q "$ARTIFACT" -d "$target.unpack"
  local top
  top=$(find "$target.unpack" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  test -n "$top"
  mv "$top" "$target"
  rm -rf "$target.unpack"
  test -f "$target/bin/startup.sh"
  chmod +x "$target/bin/startup.sh" "$target/bin/shutdown.sh" || true
}

write_wrapper() {
  local target=$1
  local case_name=$2
  local port=$3
  local external=$4
  local wrapper="$target/.poc-geoserver-$case_name"

  mkdir -p "$external"

  case "$case_name" in
    baseline)
      cat > "$wrapper" <<EOF
#!/bin/sh
GEOSERVER_HOME='$target'
JETTY_OPTS='jetty.http.port=$port'
export GEOSERVER_HOME JETTY_OPTS
exec timeout --signal=TERM 35s ./bin/startup.sh
EOF
      ;;
    external-data)
      mkdir -p "$external/data"
      cp -R "$target/data_dir/." "$external/data/"
      cat > "$wrapper" <<EOF
#!/bin/sh
GEOSERVER_HOME='$target'
GEOSERVER_DATA_DIR='$external/data'
JETTY_OPTS='jetty.http.port=$port'
export GEOSERVER_HOME GEOSERVER_DATA_DIR JETTY_OPTS
exec timeout --signal=TERM 35s ./bin/startup.sh
EOF
      ;;
    external-data-log)
      mkdir -p "$external/data" "$external/log"
      cp -R "$target/data_dir/." "$external/data/"
      cat > "$wrapper" <<EOF
#!/bin/sh
GEOSERVER_HOME='$target'
GEOSERVER_DATA_DIR='$external/data'
GEOSERVER_LOG_LOCATION='$external/log/geoserver.log'
JETTY_OPTS='jetty.http.port=$port'
export GEOSERVER_HOME GEOSERVER_DATA_DIR GEOSERVER_LOG_LOCATION JETTY_OPTS
exec timeout --signal=TERM 35s ./bin/startup.sh
EOF
      ;;
    external-data-log-tmp)
      mkdir -p "$external/data" "$external/log" "$external/tmp"
      cp -R "$target/data_dir/." "$external/data/"
      cat > "$wrapper" <<EOF
#!/bin/sh
GEOSERVER_HOME='$target'
GEOSERVER_DATA_DIR='$external/data'
GEOSERVER_LOG_LOCATION='$external/log/geoserver.log'
JETTY_OPTS='jetty.http.port=$port'
JAVA_OPTS='-Djava.io.tmpdir=$external/tmp'
export GEOSERVER_HOME GEOSERVER_DATA_DIR GEOSERVER_LOG_LOCATION JETTY_OPTS JAVA_OPTS
exec timeout --signal=TERM 35s ./bin/startup.sh
EOF
      ;;
    *)
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
  local analyzer_home="$case_dir/analyzer-home"

  mkdir -p "$case_dir" "$external" "$analyzer_home"
  extract_fresh "$tree"
  write_wrapper "$tree" "$case_name" "$port" "$external"

  export PATH="$ROOT:$ROOT/bin/sys:$PATH"
  export HOME="$analyzer_home"
  unset XDG_RUNTIME_DIR

  printf '\n' | "$ROOT/bin/sys/pkg-analyze" "$tree"     > "$case_dir/discovery.txt"     2> "$case_dir/discovery.stderr"

  candidate_id=$(awk -F '\t' -v wanted=".poc-geoserver-$case_name"     '$2 == "executable" && $3 == wanted { print $1; exit }'     "$case_dir/discovery.txt")
  test -n "$candidate_id"
  printf '%s\n' "$candidate_id" > "$case_dir/candidate-id.txt"

  snapshot_tree "$tree" "$case_dir/root.before"
  snapshot_tree "$external" "$case_dir/external.before"

  set +e
  printf '%s\ny\n\n' "$candidate_id" |
    timeout 60s "$ROOT/bin/sys/pkg-analyze" "$tree"       > "$case_dir/probe.txt"       2> "$case_dir/probe.stderr"
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
  tail -n 100 "$case_dir/probe.stderr" || true

  test "$probe_status" -eq 0
}

inspect="$OUT/inspect-root"
extract_fresh "$inspect"
cp "$inspect/bin/startup.sh" "$OUT/startup.sh"
cp "$inspect/bin/shutdown.sh" "$OUT/shutdown.sh"
grep -R -n -E 'GEOSERVER_|JETTY_|JAVA_OPTS|java.io.tmpdir|temp|work|log'   "$inspect/bin" "$inspect/start.ini" "$inspect/start.d" 2>/dev/null   > "$OUT/config-references.txt" || true
rm -rf "$inspect"

run_case baseline 18300
run_case external-data 18301
run_case external-data-log 18302
run_case external-data-log-tmp 18303
