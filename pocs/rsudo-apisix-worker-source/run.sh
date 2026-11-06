#!/bin/sh
# EXPERIMENT ONLY: a custom worker plugin supplies a loopback Control API.
# NEVER install or expose this unauthenticated test endpoint on production.
set -eu
tmp=
cid=
cleanup()
{
  [ -z "$cid" ] || docker rm -f "$cid" >/dev/null 2>&1 || :
  [ -z "$tmp" ] || rm -rf -- "$tmp"
}
trap cleanup 0
fail()
{
  printf 'rsudo APISIX worker-source PoC: %s\n' "$*" >&2
  [ -z "$cid" ] || docker logs "$cid" >&2 || :
  exit 1
}
[ "$(uname -s)" = Linux ] || fail 'Linux required'
command -v docker >/dev/null 2>&1 || fail 'Docker required'
command -v python3 >/dev/null 2>&1 || fail 'Python 3 required'
tmp=$(mktemp -d /tmp/rsudo-apisix-source-poc.XXXXXXXX) || fail 'mktemp failed'
mkdir -p "$tmp/ext/apisix/plugins" || fail 'plugin directory failed'
cat > "$tmp/ext/apisix/plugins/rsudo-source-poc.lua" <<'LUA'
-- Test-only. Allowlist the response; never return config or secrets.
local core = require("apisix.core")
local profile = require("apisix.core.profile")
local _M = {version=0.1, priority=0, name="rsudo-source-poc",
            schema={type="object", properties={}}}
function _M.check_schema(conf)
    return core.schema.check(_M.schema, conf)
end
local function probe()
    local c = core.config.local_conf()
    local d = c and c.deployment or {}
    local role = d.role
    local selected = role and d["role_" .. role] or {}
    return 200, {role=role, provider=selected.config_provider,
                 profile=profile.profile, worker_pid=ngx.worker.pid()}
end
function _M.control_api()
    return {{methods={"GET"},
             uris={"/v1/plugin/rsudo-source-poc/effective"}, handler=probe}}
end
return _M
LUA
cat > "$tmp/apisix.yaml" <<'YAML'
routes:
  - id: rsudo-source-poc-route
    uri: /rsudo-source-poc
    plugins:
      uri-blocker:
        block_rules:
          - /rsudo-source-poc
    upstream:
      type: roundrobin
      nodes:
        "127.0.0.1:19877": 1
#END
YAML
write_config()
{
cat > "$tmp/config.yaml" <<'CONFIG'
apisix:
  enable_admin: false
  enable_control: true
  extra_lua_path: "/tmp/rsudo-source-poc/?.lua"
  control:
    ip: 127.0.0.1
    port: 9090
deployment:
  role: data_plane
  role_data_plane:
    config_provider: yaml
plugins:
  - uri-blocker
  - rsudo-source-poc
CONFIG
}
http()
{
  docker exec -i "$cid" /bin/bash -s -- "$1" "$2" 2>/dev/null <<'HTTP'
path=$1
port=$2
exec 3<>/dev/tcp/127.0.0.1/"$port" || exit 70
printf 'GET %s HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' "$path" >&3
cat <&3
HTTP
}
check_http()
{
  first=$(printf '%s\n' "$1" | sed -n '1p')
  case "$first" in
    "HTTP/1.0 $2 "*|"HTTP/1.1 $2 "*) : ;;
    *) fail "HTTP $2 expected, got: $first" ;;
  esac
}
check_worker()
{
  printf '%s\n' "$1" | awk '/^\r?$/ {body=1;next} body {print}' |
    python3 -c 'import json,sys
x=json.load(sys.stdin)
assert x["role"]=="data_plane"
assert x["provider"]=="yaml"
assert x["profile"]==""
assert type(x["worker_pid"]) is int and x["worker_pid"]>0
' || fail 'worker-local provider/role/profile probe was unexpected'
}
images='apache/apisix@sha256:b921bdef3cfb2ca72e483d643f40e7843683ff8e188984489c2020f17654ee88
apache/apisix@sha256:9a7e45dc943fbf10ec916d1232bae4cda9302ae28a4696cfb83c2da01d261141'
for image in $images
do
  case "$image" in *b921bdef*) release=3.16 ;; *) release=3.19 ;; esac
  docker image inspect "$image" >/dev/null 2>&1 ||
    docker pull "$image" >/dev/null || fail "$release pinned image unavailable"
  write_config
  chmod 644 "$tmp/config.yaml" "$tmp/apisix.yaml" ||
    fail 'cannot expose disposable configuration'
  cid=$(docker run -d --network none --cap-drop ALL \
    --security-opt no-new-privileges=true \
    --mount "type=bind,src=$tmp/config.yaml,dst=/usr/local/apisix/conf/config.yaml,readonly" \
    --mount "type=bind,src=$tmp/apisix.yaml,dst=/usr/local/apisix/conf/apisix.yaml,readonly" \
    --mount "type=bind,src=$tmp/ext,dst=/tmp/rsudo-source-poc,readonly" \
    "$image") || fail "$release gateway launch failed"
  [ -n "$cid" ] || fail 'no container ID returned'
  tries=0
  response=
  while [ "$tries" -lt 30 ]
  do
    response=$(http /v1/plugin/rsudo-source-poc/effective 9090) && break
    [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" = true ] ||
      fail "$release gateway exited"
    tries=$((tries+1))
    sleep 1
  done
  [ "$tries" -lt 30 ] || fail "$release Control API unavailable"
  check_http "$response" 200
  check_worker "$response"
  data=$(http /rsudo-source-poc 9080) || fail "$release route unavailable"
  check_http "$data" 403
  master_before=$(docker exec "$cid" cat /usr/local/apisix/logs/nginx.pid) ||
    fail "$release master unavailable"
  # Deliberately rewrite disposable source IN PLACE; not a publish method.
  cat > "$tmp/config.yaml" <<'DRIFT'
apisix:
  enable_admin: false
  enable_control: false
deployment:
  role: data_plane
  role_data_plane:
    config_provider: json
DRIFT
  docker exec "$cid" cat /usr/local/apisix/conf/config.yaml > "$tmp/visible" ||
    fail "$release cannot read disk drift in container"
  cmp -s "$tmp/config.yaml" "$tmp/visible" ||
    fail "$release disk drift not visible"
  response=$(http /v1/plugin/rsudo-source-poc/effective 9090) ||
    fail "$release worker Control API disappeared after disk drift"
  check_http "$response" 200
  check_worker "$response"
  data=$(http /rsudo-source-poc 9080) || fail "$release route lost"
  check_http "$data" 403
  master_after=$(docker exec "$cid" cat /usr/local/apisix/logs/nginx.pid) ||
    fail "$release post-drift master unavailable"
  [ "$master_before" = "$master_after" ] ||
    fail "$release master changed during disk-only drift"
  printf 'PoC %s: disk provider=json, worker cached provider=yaml, master stable, route=403\n' "$release"
  docker rm -f "$cid" >/dev/null 2>&1 || fail "$release cleanup failed"
  cid=
done
printf '%s\n' 'PoC only: worker provider observable with explicitly installed plugin. Loaded source pathname/hash still NOT attested.'
