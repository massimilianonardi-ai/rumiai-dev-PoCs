# Source-only rsudo-admin operator library.
# Read-only inventory of the seven Ollama workers and GIS-to-worker HTTP probes.

olla_gis_network_check()
{
  # Gather actual network addresses rather than inferring IPs from credential names.
  # Keep diagnostic output, including the rsudo path, on errors.
  set --
  for group in apisix apps keycloak apisix_psn apps_psn keycloak_psn webgisrpr
  do
    if report=$(rsudo --load ":$group" sh -s -- "$group" <<'OLLA_REMOTE_WORKER'
set -eu
group=$1
printf 'OLLA NETWORK WORKER group=%s\n' "$group"
if [ "$(uname -s)" != Linux ]; then
  printf 'OLLA NETWORK ERROR group=%s unsupported-os\n' "$group" >&2
  exit 1
fi
for tool in ip systemctl curl ss awk
do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'OLLA NETWORK ERROR group=%s missing-tool=%s\n' "$group" "$tool" >&2
    exit 2
  fi
done
if systemctl is-active --quiet m-srv-ollama.service; then
  printf 'OLLA NETWORK SERVICE group=%s active\n' "$group"
else
  printf 'OLLA NETWORK SERVICE group=%s inactive\n' "$group"
fi
if systemctl is-enabled --quiet m-srv-ollama.service; then
  printf 'OLLA NETWORK ENABLED group=%s yes\n' "$group"
else
  printf 'OLLA NETWORK ENABLED group=%s no\n' "$group"
fi
if curl --fail --silent --show-error --max-time 5 \
     http://127.0.0.1:11435/api/tags >/dev/null; then
  printf 'OLLA NETWORK LOOPBACK group=%s ready\n' "$group"
else
  printf 'OLLA NETWORK LOOPBACK group=%s unavailable\n' "$group"
fi
ss -H -ltn | awk -v group="$group" \
  '$4 ~ /:11435$/ {print "OLLA NETWORK LISTEN", "group=" group, $4}'
ip -4 -o addr show scope global |
  awk -v group="$group" \
    '$3=="inet" {split($4,a,"/"); print "OLLA_NETWORK_ADDR",group,a[1]}'
ip -4 route get 10.200.0.19 |
  awk -v group="$group" \
    '{for(i=1;i<=NF;i++) if($i=="src" && i<NF) {print "OLLA NETWORK ROUTE_SOURCE", "group=" group, $(i+1); break}}'
OLLA_REMOTE_WORKER
); then
      printf '%s\n' "$report"
    else
      result=$?
      printf '%s\n' "$report" >&2
      printf 'OLLA NETWORK ERROR inventory-failed group=%s exit=%s\n' "$group" "$result" >&2
      return 1
    fi
    addresses=$(printf '%s\n' "$report" | awk -v group="$group" \
      '$1=="OLLA_NETWORK_ADDR" && $2==group {print $3}')
    if [ -z "$addresses" ]; then
      printf 'OLLA NETWORK ERROR no-global-ipv4 group=%s\n' "$group" >&2
      return 2
    fi
    for address in $addresses
    do
      case "$address" in
        *[!0-9.]* | '' | .* | *..* | *.)
          printf 'OLLA NETWORK ERROR invalid-ipv4 group=%s value=%s\n' "$group" "$address" >&2
          return 3 ;;
      esac
      set -- "$@" "$group:$address"
    done
  done

  # One GIS rsudo operation performs bounded read-only probes to those IPs.
  rsudo --load ':gis' sh -s -- "$@" <<'OLLA_REMOTE_GIS'
set -eu
for tool in ip curl systemctl
do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'OLLA NETWORK ERROR gis-missing-tool=%s\n' "$tool" >&2
    exit 1
  fi
done
if systemctl is-active --quiet olla-gis-poc.service; then
  printf 'OLLA NETWORK GIS olla-service=active\n'
else
  printf 'OLLA NETWORK GIS olla-service=inactive\n'
fi
if curl --fail --silent --show-error --max-time 5 \
   http://127.0.0.1:40114/internal/health >/dev/null; then
  printf 'OLLA NETWORK GIS olla-health=ready\n'
else
  printf 'OLLA NETWORK GIS olla-health=unavailable\n'
fi
for endpoint
do
  group=${endpoint%%:*}
  address=${endpoint#*:}
  # Route observation alone does not prove the security perimeter is safe.
  if route=$(ip -4 route get "$address" 2>&1); then
    printf 'OLLA NETWORK GIS_ROUTE group=%s ip=%s %s\n' "$group" "$address" "$route"
  else
    printf 'OLLA NETWORK GIS_ROUTE group=%s ip=%s failed=%s\n' "$group" "$address" "$route"
  fi
  if curl --fail --silent --show-error --connect-timeout 3 --max-time 7 \
     "http://$address:11435/api/tags" >/dev/null 2>&1; then
    printf 'OLLA NETWORK GIS_HTTP group=%s ip=%s result=reachable\n' "$group" "$address"
  else
    printf 'OLLA NETWORK GIS_HTTP group=%s ip=%s result=unreachable\n' "$group" "$address"
  fi
done
printf 'OLLA NETWORK GIS CHECK COMPLETE (read-only; no workers configured)\n'
OLLA_REMOTE_GIS
}
