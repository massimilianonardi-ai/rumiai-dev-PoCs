#!/bin/sh
# Isolated real-SHA256 regression for the worker artifact-to-pkg boundary.
# Only the local artifact location is redirected into a disposable fixture.
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
. "$script_dir/controller.lib.sh"

base=$(mktemp -d)
trap 'rm -rf -- "$base"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$base/artifact/bin" "$base/installed/bin"
printf 'cpu-runtime-bytes\n' > "$base/artifact/bin/ollama"
cp "$base/artifact/bin/ollama" "$base/installed/bin/ollama"
(cd "$base/artifact" && sha256sum bin/ollama > MANIFEST.sha256)
manifest_sha=$(sha256sum "$base/artifact/MANIFEST.sha256")
manifest_sha=${manifest_sha%% *}

# Exercise the live library's worker-manifest algorithm, not a separate copy.
# A full remote-host test cannot run in an unprivileged local fixture.
cat > "$base/probe.sh" <<'PROBE'
#!/bin/sh
set -eu
pkgroot=$1
artifact_sha=$2
role=worker
fail()
{
  printf 'FIXTURE REMOTE ERROR [%s]: %s\n' "$2" "$1" >&2
  exit "$2"
}
PROBE

cluster_remote_source |
  sed -n '/^if \[ "\$role" = worker \]$/,/^  awk /p' |
  sed '$d' |
  sed "s#/var/lib/ollama-worker/runtime/0.35.1-cpu/MANIFEST.sha256#$base/artifact/MANIFEST.sha256#g"   >> "$base/probe.sh"
printf 'fi\n' >> "$base/probe.sh"
sh -n "$base/probe.sh"

sh "$base/probe.sh" "$base/installed" "$manifest_sha" > "$base/ok.log"
grep -q '^CLUSTER ARTIFACT OK role=worker' "$base/ok.log"

printf 'corrupt\n' > "$base/installed/bin/ollama"
if sh "$base/probe.sh" "$base/installed" "$manifest_sha" > "$base/bad-payload.log" 2>&1
then
  echo 'FAIL: corrupted installed CPU payload was accepted' >&2
  exit 1
fi
grep -q 'integrity mismatch' "$base/bad-payload.log"

cp "$base/artifact/bin/ollama" "$base/installed/bin/ollama"
printf 'different manifest\n' > "$base/artifact/MANIFEST.sha256"
if sh "$base/probe.sh" "$base/installed" "$manifest_sha" > "$base/bad-manifest.log" 2>&1
then
  echo 'FAIL: altered artifact manifest was accepted' >&2
  exit 1
fi
grep -q 'manifest digest mismatch' "$base/bad-manifest.log"

rm "$base/artifact/MANIFEST.sha256"
if sh "$base/probe.sh" "$base/installed" "$manifest_sha" > "$base/missing.log" 2>&1
then
  echo 'FAIL: missing artifact manifest was accepted' >&2
  exit 1
fi
grep -q 'manifest absent' "$base/missing.log"

echo 'PASS: external pinned manifest authenticates installed CPU root and rejects corruption'
