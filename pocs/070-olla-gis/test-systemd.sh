#!/bin/sh
# Real pinned Olla release + extracted GIS installer + real systemd on disposable GitHub Ubuntu VM.
# Refuses to run outside the isolated GitHub Actions runner.
set -eu
[ "$GITHUB_ACTIONS" = true ] && [ "$CI" = true ] || {
  echo 'ERROR: test-systemd.sh requires a disposable GitHub Actions runner' >&2
  exit 1
}
[ "$(id -u)" -ne 0 ] || {
  echo 'ERROR: run the test as the unprivileged GitHub runner' >&2
  exit 1
}
[ ! -e /m/ai ] && [ ! -e /etc/olla ] &&
[ ! -e /etc/systemd/system/olla-gis-poc.service ] &&
! id -u olla >/dev/null 2>&1 || {
  echo 'ERROR: disposable runner contains Olla target state; refusing alteration' >&2
  exit 1
}
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
dir=$(mktemp -d)
backend_pid=
cleanup()
{
  [ -z "$backend_pid" ] || kill "$backend_pid" 2>/dev/null || :
  sudo systemctl disable --now olla-gis-poc.service >/dev/null 2>&1 || :
  sudo rm -f /etc/systemd/system/olla-gis-poc.service
  sudo systemctl daemon-reload >/dev/null 2>&1 || :
  sudo rm -rf /etc/olla /m/ai/olla /m/ai/runtime/olla
  sudo rmdir /m/ai/runtime /m/ai /m 2>/dev/null || :
  sudo userdel olla 2>/dev/null || :
  rm -rf "$dir"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Exactly the operator-embedded POSIX program, no duplicate installer.
sed -n '/^set -eu$/,/^REMOTE_OLLA_GIS$/p' controller.lib.sh |
  sed '$d' > "$dir/remote.sh"
sh -n "$dir/remote.sh"

python3 -u - <<'PY' > "$dir/ollama-mock.log" 2>&1 &
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/": payload = b'Ollama is running'
        elif self.path == "/api/tags":
            payload = json.dumps({"models":[{"name":"qwen3:4b","model":"qwen3:4b","size":2450000000,
                "digest":"sha256:"+"a"*64,"modified_at":"2026-10-19T06:00:00Z",
                "details":{"format":"gguf","family":"qwen3","parameter_size":"4B"}}]}).encode()
        else:
            self.send_error(404); return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404); return
        if "chunked" in self.headers.get("Transfer-Encoding","").lower():
            chunks = []
            while True:
                chunk_header = self.rfile.readline().strip()
                length = int(chunk_header.split(b";",1)[0],16)
                if not length:
                    while self.rfile.readline().strip(): pass
                    break
                chunks.append(self.rfile.read(length))
                self.rfile.read(2)
            data = b"".join(chunks)
        else:
            data = self.rfile.read(int(self.headers.get("Content-Length","0")))
        request = json.loads(data)
        assert request["model"] == "qwen3:4b", request
        body = json.dumps({"model":"qwen3:4b","created_at":"2026-10-19T06:00:00Z",
            "message":{"role":"assistant","content":"OK"},"done":True,
            "eval_count":1,"total_duration":1000000},separators=(",",":")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args): pass
ThreadingHTTPServer(("127.0.0.1",11435),H).serve_forever()
PY
backend_pid=$!
i=0
while [ "$i" -lt 15 ]; do
  if curl -fsS --max-time 2 http://127.0.0.1:11435/api/tags >/dev/null 2>&1; then break; fi
  i=$((i+1))
  sleep 1
done
[ "$i" -lt 15 ] || { cat "$dir/ollama-mock.log" >&2; exit 1; }
sudo mkdir -p /m/ai

# Check mode should pass prior to installation.
sudo sh "$dir/remote.sh" check
sudo sh "$dir/remote.sh" install
sudo systemctl is-active --quiet olla-gis-poc.service
sudo systemctl is-enabled --quiet olla-gis-poc.service
curl -fsS --max-time 5 http://127.0.0.1:40114/internal/health >/dev/null
# Re-running the identical install may not conflict with itself.
sudo sh "$dir/remote.sh" install
sudo systemctl is-active --quiet olla-gis-poc.service
echo 'PASS: pinned real Olla installed/started by exact remote program on disposable systemd runner'
