#!/bin/sh
# Isolated actual upstream Olla binary and local mock Ollama HTTP backend.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
sh -n controller.lib.sh
sh -n install.job
[ "$(command -p head -n 1 install.job)" = 'exec > "/m/src/git/rsudo-jobs.log" 2>&1' ]
[ "$(command -p tail -n 1 install.job)" = 'olla_gis_deploy install' ]

root=$(command -p mktemp -d)
cleanup()
{
  [ -z "$root" ] || {
    [ -z "$olla_pid" ] || kill "$olla_pid" 2>/dev/null || :
    [ -z "$backend_pid" ] || kill "$backend_pid" 2>/dev/null || :
    command -p rm -rf "$root"
  }
}
olla_pid=
backend_pid=
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Extract and parse the ACTUAL remote program, not a reimplemented mock.
command -p sed -n '/^set -eu$/,/^REMOTE_OLLA_GIS$/p' controller.lib.sh |
  command -p sed '$d' > "$root/remote.sh"
sh -n "$root/remote.sh"
command -p sed -n '/^server:$/,/^OLLA_YAML$/p' controller.lib.sh |
  command -p sed '$d' > "$root/config.yaml"
[ -s "$root/config.yaml" ] || { echo 'could not extract operator config' >&2; exit 1; }
grep -q 'host: "127.0.0.1"' "$root/config.yaml"
grep -q 'url: "http://127.0.0.1:11435"' "$root/config.yaml"
grep -q 'enabled: false' "$root/config.yaml"

# Download only the pinned official artifact; verify its exact digest.
asset=olla_v0.0.29_linux_amd64.tar.gz
curl -fLsS --retry 2 --max-time 150 \
  "https://github.com/thushan/olla/releases/download/v0.0.29/$asset" \
  -o "$root/$asset"
printf '%s  %s\n' \
  fafb482e50def1f56f210ef28b46c67021bb6e25b0ff0a595682e2aac214fcc4 \
  "$root/$asset" | sha256sum -c -
command -p mkdir "$root/extracted"
command -p tar -xzf "$root/$asset" -C "$root/extracted"
olla_bin=$(command -p find "$root/extracted" -type f -name olla -print |
  command -p head -n 1)
[ -n "$olla_bin" ] || exit 1
command -p chmod 0755 "$olla_bin"
"$olla_bin" --version
"$olla_bin" --config "$root/config.yaml" --validate-config

# An actual non-Ollama HTTP fixture on the same loopback API contract.
python3 -u - "$root/mock.log" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            body = b"Ollama is running"
        elif self.path == "/api/version":
            body = b'{"version":"0.35.1"}'
        elif self.path == "/api/tags":
            body = json.dumps({"models":[{"name":"qwen3:4b","model":"qwen3:4b","size":2450000000,
                "digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "modified_at":"2026-10-19T06:00:00Z",
                "details":{"format":"gguf","family":"qwen3","parameter_size":"4B",
                           "quantization_level":"Q4_K_M"}}]}).encode()
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        if self.path not in ("/api/chat","/v1/chat/completions"):
            self.send_error(404)
            return
        if "chunked" in self.headers.get("Transfer-Encoding","").lower():
            chunks = []
            while True:
                size_line = self.rfile.readline().strip()
                size = int(size_line.split(b";",1)[0],16)
                if size == 0:
                    while self.rfile.readline().strip(): pass
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            body = b"".join(chunks)
        else:
            length = int(self.headers.get("Content-Length","0"))
            body = self.rfile.read(length)
        request = json.loads(body)
        content = {"model":"qwen3:4b","message":{"role":"assistant","content":"backend-gis"},
                   "done":True,"eval_count":3,"total_duration":1000000}
        if request.get("stream",True):
            body = (json.dumps(content)+"\n").encode()
        else:
            body = json.dumps(content).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args): pass
ThreadingHTTPServer(("127.0.0.1",11435),Handler).serve_forever()
PY
backend_pid=$!

"$olla_bin" --config "$root/config.yaml" > "$root/olla.log" 2>&1 &
olla_pid=$!

status=1
i=0
while [ "$i" -lt 50 ]; do
  if curl -fsS --max-time 2 http://127.0.0.1:40114/internal/health >/dev/null 2>&1; then
    status=0
    break
  fi
  i=$((i+1))
  sleep 1
done
if [ "$status" -ne 0 ]; then
  command -p cat "$root/olla.log" >&2
  exit 1
fi

# Strict routing waits until the mock model is discovered.
i=0
while [ "$i" -lt 35 ]; do
  if curl -fsS --max-time 4 http://127.0.0.1:40114/olla/models |
    grep -q 'qwen3:4b'; then
    break
  fi
  i=$((i+1))
  sleep 1
done
[ "$i" -lt 35 ] || { command -p cat "$root/olla.log" >&2; exit 1; }

result=$(curl -fsS --max-time 15 -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:4b","messages":[{"role":"user","content":"test"}],"stream":false}' \
  http://127.0.0.1:40114/olla/ollama/api/chat) || {
  command -p cat "$root/olla.log" >&2
  exit 1
}
printf '%s\n' "$result" | grep -q 'backend-gis' || {
  printf '%s\n' "$result" >&2
  exit 1
}
echo 'PASS: pinned real Olla binary, config and mocked Ollama chat routed'
