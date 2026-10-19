# rsudo-admin source library. No shebang and no executable bit required.
olla_gis_deploy()
{
  [ "$#" -eq 1 ] || return 2
  case "$1" in
    check|install) ;;
    *) printf '%s\n' 'OLLA GIS ERROR: mode must be check or install' >&2; return 2 ;;
  esac

  rsudo --load ':gis' sh -s -- "$1" <<'REMOTE_OLLA_GIS'
set -eu
mode=$1
case "$mode" in check|install) ;; *) echo 'OLLA GIS ERROR: bad mode' >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo 'OLLA GIS ERROR: require sudo root' >&2; exit 3; }
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || {
  echo 'OLLA GIS ERROR: unsupported host' >&2; exit 4;
}
root=/m/ai/runtime/olla/v0.0.29
binary=$root/olla
config=/etc/olla/config.yaml
unit=/etc/systemd/system/olla-gis-poc.service
state=/m/ai/olla/state
asset=olla_v0.0.29_linux_amd64.tar.gz
digest=fafb482e50def1f56f210ef28b46c67021bb6e25b0ff0a595682e2aac214fcc4
url=https://github.com/thushan/olla/releases/download/v0.0.29/olla_v0.0.29_linux_amd64.tar.gz
[ -d /m/ai ] || { echo 'OLLA GIS ERROR: /m/ai absent' >&2; exit 5; }
command -v curl >/dev/null 2>&1 || exit 6
command -v systemctl >/dev/null 2>&1 || exit 7
curl -fsS --max-time 5 http://127.0.0.1:11435/api/tags >/dev/null || {
  echo 'OLLA GIS ERROR: local Ollama unavailable' >&2; exit 8;
}

if [ "$mode" = check ]; then
  echo 'OLLA GIS CHECK: local Ollama healthy'
  if [ -x "$binary" ]; then "$binary" --version; else echo 'OLLA GIS CHECK: Olla not staged'; fi
  if [ -e "$unit" ]; then systemctl is-active olla-gis-poc.service || :; fi
  echo 'OLLA GIS CHECK OK'
  exit 0
fi

command -p mkdir -p /m/ai/runtime
stage=$(command -p mktemp -d /m/ai/runtime/.olla-stage.XXXXXXXX) || exit 9
trap 'command -p rm -rf "$stage"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
command -p mkdir "$stage/x"
curl -fLsS --max-time 180 "$url" -o "$stage/$asset" || {
  echo 'OLLA GIS ERROR: download failed' >&2; exit 10;
}
printf '%s  %s\n' "$digest" "$stage/$asset" | sha256sum -c - || {
  echo 'OLLA GIS ERROR: digest mismatch' >&2; exit 11;
}
command -p tar -xzf "$stage/$asset" -C "$stage/x" || exit 12
candidate=$(command -p find "$stage/x" -type f -name olla -print | command -p head -n 1)
[ -n "$candidate" ] && [ -f "$candidate" ] || exit 13
command -p chmod 0755 "$candidate"
"$candidate" --version || exit 14

command -p cat > "$stage/config.yaml" <<'OLLA_YAML'
server:
  host: "127.0.0.1"
  port: 40114
  request_logging: false
proxy:
  load_balancer: "least-connections"
  retry:
    enabled: false
discovery:
  type: "static"
  static:
    endpoints:
      - url: "http://127.0.0.1:11435"
        name: "gis"
        type: "ollama"
        priority: 100
        model_url: "/api/tags"
        health_check_url: "/"
  model_discovery:
    enabled: true
    interval: 30s
model_registry:
  type: "memory"
  enable_unifier: true
dashboard:
  enabled: false
logging:
  level: "info"
  format: "json"
  output: "stdout"
OLLA_YAML
"$candidate" --config "$stage/config.yaml" --validate-config || exit 15
command -p cat > "$stage/unit" <<'OLLA_UNIT'
[Unit]
Description=GIS-local Olla canary for RumiAI
After=network-online.target m-srv-ollama.service
Wants=network-online.target

[Service]
Type=simple
User=olla
Group=olla
WorkingDirectory=/m/ai/olla/state
ExecStart=/m/ai/runtime/olla/v0.0.29/olla --config /etc/olla/config.yaml
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/m/ai/olla/state

[Install]
WantedBy=multi-user.target
OLLA_UNIT

# Do not overwrite unmanaged or concurrently modified existing installations.
if [ -e "$binary" ] && ! command -p cmp -s "$candidate" "$binary"; then
  echo 'OLLA GIS ERROR: binary conflict' >&2; exit 16;
fi
if [ -e "$config" ] && ! command -p cmp -s "$stage/config.yaml" "$config"; then
  echo 'OLLA GIS ERROR: config conflict' >&2; exit 17;
fi
if [ -e "$unit" ] && ! command -p cmp -s "$stage/unit" "$unit"; then
  echo 'OLLA GIS ERROR: unit conflict' >&2; exit 18;
fi
if ! id -u olla >/dev/null 2>&1; then
  /usr/sbin/useradd --system --home-dir "$state" --shell /usr/sbin/nologin olla || exit 19
fi
command -p mkdir -p "$root" /etc/olla "$state"
command -p chmod 0755 "$root" /etc/olla
command -p chown olla:olla "$state"
command -p chmod 0700 "$state"
if [ ! -e "$binary" ]; then command -p cp "$candidate" "$binary"; command -p chmod 0755 "$binary"; fi
if [ ! -e "$config" ]; then command -p cp "$stage/config.yaml" "$config"; command -p chmod 0644 "$config"; fi
if [ ! -e "$unit" ]; then command -p cp "$stage/unit" "$unit"; command -p chmod 0644 "$unit"; fi
systemctl daemon-reload
systemctl enable --now olla-gis-poc.service || {
  echo 'OLLA GIS ERROR: unit could not start' >&2; exit 20;
}
count=0
while [ "$count" -lt 30 ]; do
  if curl -fsS --max-time 3 http://127.0.0.1:40114/internal/health >/dev/null 2>&1; then
    echo 'OLLA GIS INSTALL OK: local Olla health passed; remote workers NOT configured'
    exit 0
  fi
  count=$((count+1))
  sleep 1
done
echo 'OLLA GIS ERROR: Olla health timeout' >&2
exit 21
REMOTE_OLLA_GIS
}
