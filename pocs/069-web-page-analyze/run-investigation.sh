#!/bin/sh
# Separate interactive JS/DOM research run. Existing live-* runs stay intact.
set -eu
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Uso: sh run-investigation.sh <nuovo-nome>' >&2
  exit 2
fi
case "$1" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' 'investigation.invalid-name' >&2; exit 2 ;;
esac
self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ -L "$self/evidence" ] || [ -L "$self/.runtime" ] ||
   [ -L "$self/evidence/investigations" ]; then
  printf '%s\n' 'investigation.poc-path-symlink-not-allowed' >&2
  exit 2
fi
mkdir -p "$self/evidence/investigations" "$self/.runtime"
if [ -e "$self/evidence/investigations/$1" ]; then
  printf '%s\n' 'investigation.evidence-already-exists' >&2
  exit 2
fi
command -v node >/dev/null 2>&1 ||
  { printf '%s\n' 'investigation.node-missing' >&2; exit 3; }
command -v npm >/dev/null 2>&1 ||
  { printf '%s\n' 'investigation.npm-missing' >&2; exit 3; }
chromium=$(command -v chromium || command -v chromium-browser || :)
[ -n "$chromium" ] ||
  { printf '%s\n' 'investigation.chromium-missing' >&2; exit 3; }

provider="$self/.runtime/pwc"
# The exact same previously approved PoC-private Playwright dependency,
# never a browser provider installed for other workloads.
expected=2e1759e994f52000975c6383b8cc7b229cd1b425
if [ ! -f "$provider/package.json" ]; then
  git clone --quiet --depth 1 \
    https://github.com/massimilianonardi-ai/pwc-web-control.git "$provider"
fi
actual=$(git -C "$provider" rev-parse HEAD)
if [ "$actual" != "$expected" ]; then
  printf '%s\n' 'investigation.provider-revision-mismatch' >&2
  exit 4
fi
if [ ! -f "$provider/node_modules/playwright/package.json" ]; then
  (
    cd "$provider"
    NODE_USE_SYSTEM_CA="${NODE_USE_SYSTEM_CA-1}" \
      npm_config_cache="$self/.runtime/npm-cache" \
      npm install --ignore-scripts --no-audit --no-fund --no-package-lock
  ) || { printf '%s\n' 'investigation.playwright-install-failed' >&2; exit 4; }
fi
export PWC069_BROWSER_EXECUTABLE="$chromium"
node --check "$self/investigate.mjs"
node --check "$self/investigate-observer.js"
printf '%s\n' '[INVESTIGA] Il Chromium sperimentale usa ignoreHTTPSErrors' \
  'solo per questa esecuzione; evita login e navigazione non pertinenti.' \
  '[INVESTIGA] Guida il browser manualmente seguendo le richieste.'
exec node "$self/investigate.mjs" "$1"
