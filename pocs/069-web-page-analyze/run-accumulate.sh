#!/bin/sh
# A new source+replica experiment; never modifies existing investigations.
set -eu
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf '%s\n' 'Uso: sh run-accumulate.sh <nuovo-nome> [https://chatgpt.com/share/...]' >&2
  exit 2
fi
case "$1" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' 'accumulate.invalid-name' >&2; exit 2 ;;
esac
self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ -L "$self/evidence" ] || [ -L "$self/.runtime" ] ||
   [ -L "$self/evidence/accumulations" ]; then
  printf '%s\n' 'accumulate.poc-path-symlink-not-allowed' >&2; exit 2
fi
mkdir -p "$self/evidence/accumulations" "$self/.runtime"
if [ -e "$self/evidence/accumulations/$1" ]; then
  printf '%s\n' 'accumulate.evidence-already-exists' >&2; exit 2
fi
command -v node >/dev/null 2>&1 ||
  { printf '%s\n' 'accumulate.node-missing' >&2; exit 3; }
command -v npm >/dev/null 2>&1 ||
  { printf '%s\n' 'accumulate.npm-missing' >&2; exit 3; }
chromium=$(command -v chromium || command -v chromium-browser || :)
[ -n "$chromium" ] ||
  { printf '%s\n' 'accumulate.chromium-missing' >&2; exit 3; }
provider="$self/.runtime/pwc"
expected=2e1759e994f52000975c6383b8cc7b229cd1b425
if [ ! -f "$provider/package.json" ]; then
  git clone --quiet --depth 1 \
    https://github.com/massimilianonardi-ai/pwc-web-control.git "$provider"
fi
actual=$(git -C "$provider" rev-parse HEAD)
if [ "$actual" != "$expected" ]; then
  printf '%s\n' 'accumulate.provider-revision-mismatch' >&2; exit 4
fi
if [ ! -f "$provider/node_modules/playwright/package.json" ]; then
  (
    cd "$provider"
    NODE_USE_SYSTEM_CA="${NODE_USE_SYSTEM_CA-1}" \
      npm_config_cache="$self/.runtime/npm-cache" \
      npm install --ignore-scripts --no-audit --no-fund --no-package-lock
  ) || {
    printf '%s\n' 'accumulate.playwright-install-failed' >&2
    exit 4
  }
fi
node --check "$self/accumulate.mjs"
node --check "$self/accumulate-core.mjs"
node --check "$self/accumulate-observer.js"
node --test "$self/tests/accumulate-"*.test.mjs
export PWC069_BROWSER_EXECUTABLE="$chromium"
printf '%s\n' '[ACCUMULA] Chromium originale e replica DOM vuota; wheel automatico.' \
  '[ACCUMULA] ignoreHTTPSErrors attivo solo per questo PoC isolato.' \
  '[ACCUMULA] Non effettuare login; controlla visivamente la pagina originale.'
exec node "$self/accumulate.mjs" "$@"
