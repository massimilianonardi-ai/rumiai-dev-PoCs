#!/bin/sh
# One live trial of the two authorized pages; all persistent data inside PoC 069.
set -eu
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Uso: sh run-live.sh <nuovo-nome-esecuzione>' >&2
  exit 2
fi
case "$1" in
  ''|*[!A-Za-z0-9_-]*) printf '%s\n' 'run.invalid-name' >&2; exit 2 ;;
esac
self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
mkdir -p "$self/.runtime" "$self/evidence"
if [ -L "$self/.runtime" ] || [ -L "$self/evidence" ]; then
  printf '%s\n' 'run.poc-output-or-runtime-symlink-not-allowed' >&2
  exit 2
fi
if [ -e "$self/evidence/$1" ]; then
  printf '%s\n' 'run.evidence-already-exists' >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { printf '%s\n' 'run.node-missing' >&2; exit 3; }
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'run.npm-missing' >&2; exit 3; }
chromium=$(command -v chromium || command -v chromium-browser || :)
[ -n "$chromium" ] || { printf '%s\n' 'run.chromium-missing' >&2; exit 3; }

provider="$self/.runtime/pwc"
if [ ! -f "$provider/src/client.mjs" ]; then
  git clone --quiet --depth 1 \
    https://github.com/massimilianonardi-ai/pwc-web-control.git "$provider"
fi
expected=403f4fa9bbea419715e9c834e847c6f2b60ae421
current=$(git -C "$provider" rev-parse HEAD)
if [ "$expected" != "$current" ]; then
  printf '%s\n' 'run.provider-head-not-verified' >&2
  exit 4
fi
if [ ! -f "$provider/node_modules/playwright/package.json" ]; then
  (
    cd "$provider"
    npm_config_cache="$self/.runtime/npm-cache" \
      npm install --ignore-scripts --no-audit --no-fund --no-package-lock
  )
fi

session=$(mktemp -d "$self/.runtime/session.XXXXXXXX")
alias="/tmp/pwc069-$$"
socket="/tmp/pwc069-$$.sock"
service_pid=
alias_created=0
cleanup() {
  if [ -n "$service_pid" ]; then
    kill "$service_pid" 2>/dev/null || :
    wait "$service_pid" 2>/dev/null || :
  fi
  if [ "$alias_created" -eq 1 ]; then rm -f "$alias"; fi
  rm -f "$socket"
  rm -rf "$session"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$session/tmp" "$session/config" "$session/data" "$session/cache"
ln -s "$session" "$alias"
alias_created=1
export TMPDIR="$alias/tmp"
export XDG_CACHE_HOME="$alias/cache"
export XDG_CONFIG_HOME="$alias/config"
export XDG_DATA_HOME="$alias/data"
export WEB_CONTROL_HOME="$alias/profile"
export WEB_CONTROL_SOCKET="$socket"
export WEB_CONTROL_BROWSER_EXECUTABLE="$chromium"
export WEB_CONTROL_HEADLESS=0
export WEB_CONTROL_CMD="$provider/bin/web-control"
export WEB_CONTROL_CONNECT_TIMEOUT_MS=1000

service_log="$self/.runtime/service-$1.log"
"$provider/bin/web-control-service" > "$service_log" 2>&1 &
service_pid=$!
ready=0
count=0
printf '%s\n' '[PWC] Avvio del browser visibile'
while [ "$count" -lt 50 ]; do
  if "$WEB_CONTROL_CMD" status > "$session/status.json" 2> "$session/client-error"; then
    ready=1
    break
  fi
  if ! kill -0 "$service_pid" 2>/dev/null; then break; fi
  count=$((count+1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  printf '%s\n' 'run.pwc-not-ready' >&2
  tail -n 30 "$service_log" >&2 || :
  exit 5
fi
printf '%s\n' '[PWC_READY] Controller e Chromium disponibili'
cd "$self"
node --check live.mjs
node --test tests/*.test.mjs
printf '%s\n' '[LIVE] Amazon, poi ChatGPT. Segui i messaggi del terminale.'
result=0
node live.mjs "$1" || result=$?
printf '[VIEW] Per vedere i risultati senza il portale documenti: sh view.sh %s\n' "$1"
exit "$result"
