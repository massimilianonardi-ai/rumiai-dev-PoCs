#!/bin/sh
# Isolated transport/selection fixture for the operator's actual network-check source.
# Does not claim enterprise routing/ACL validation.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
sh -n network-check.lib.sh
sh -n network-check.job
[ "$(head -n 1 network-check.job)" = 'exec > "/m/src/git/rsudo-jobs.log" 2>&1' ]
[ "$(tail -n 1 network-check.job)" = 'olla_gis_network_check' ]

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Deliberately mock ONLY the external rsudo transport: the real controller
# builds/validates the endpoint set and invokes its embedded programs.
rsudo()
{
  [ "$1" = --load ] || { echo 'invalid rsudo mode' >&2; return 60; }
  target=$2
  shift 2
  [ "$1" = sh ] && [ "$2" = -s ] && [ "$3" = -- ] || {
    echo 'invalid remote sh invocation' >&2
    return 61
  }
  shift 3
  file="$scratch/$target"
  cat > "$file"
  sh -n "$file"
  case "$target" in
    :gis)
      [ "$#" -eq 8 ] || { echo "expected 8 endpoint candidates, got $#" >&2; return 62; }
      printf '%s\n' "$@" > "$scratch/endpoint-args"
      printf 'OLLA NETWORK GIS CHECK COMPLETE (fixture, no network requests)\n'
      ;;
    :apisix) number=1 ;;
    :apps) number=2 ;;
    :keycloak) number=3 ;;
    :apisix_psn) number=4 ;;
    :apps_psn) number=5 ;;
    :keycloak_psn) number=6 ;;
    :webgisrpr) number=7 ;;
    *) echo 'unexpected credential group' >&2; return 63 ;;
  esac
  if [ "$target" != ':gis' ]; then
    [ "$#" -eq 1 ] || { echo 'worker arg count' >&2; return 64; }
    group=$1
    printf 'OLLA NETWORK WORKER group=%s\n' "$group"
    printf 'OLLA_NETWORK_ADDR %s 10.100.0.%s\n' "$group" "$number"
    # The controller must not probe an unapproved or extraneous address.
    if [ "$group" = apps ]; then
      printf 'OLLA_NETWORK_ADDR %s 192.0.2.2\n' "$group"
    fi
  fi
}

. ./network-check.lib.sh
olla_gis_network_check > "$scratch/report"
[ -s "$scratch/endpoint-args" ]
[ "$(wc -l < "$scratch/endpoint-args" | tr -d ' ')" -eq 8 ] || exit 70
[ "$(ls "$scratch"/:* | wc -l | tr -d ' ')" -eq 8 ] || exit 71
[ "$(grep -c '^OLLA NETWORK SKIP ' "$scratch/report")" -eq 1 ] || exit 72
! grep -q '192.0.2' "$scratch/endpoint-args"
grep -q '^apps:10.100.0.2$' "$scratch/endpoint-args"
grep -q '^webgisrpr:10.100.0.7$' "$scratch/endpoint-args"
grep -q '^OLLA NETWORK GIS CHECK COMPLETE' "$scratch/report"

# The remote observer is pure observation: it may inspect but not mutate
# service state or listeners. Audit the exact source extracted above.
! grep -E -q 'systemctl (stop|start|restart|enable|disable)|ufw (allow|delete)|nft add|iptables -[AI]|curl .*--data|curl .* -d ' \
  "$scratch/:gis" "$scratch/:apps"
echo 'PASS: Olla seven-worker inventory job, rsudo sequencing and conservative endpoint filter'
