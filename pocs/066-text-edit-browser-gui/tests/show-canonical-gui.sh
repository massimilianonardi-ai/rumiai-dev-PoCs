#!/bin/sh
# Open the actual PoC 066 canonical Document2D browser GUI for manual use.
# Does not run browser tests or modify the operator's source checkouts.
set -eu

fail()
{
  printf 'TextEdit GUI BLOCKED: %s\n' "$1" >&2
  exit 1
}

for program in git node python3
do
  command -v "$program" >/dev/null 2>&1 ||
    fail "missing required program: $program"
done

poc_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd -P)" ||
  fail 'cannot locate the PoC checkout'
[ -f "$poc_root/pocs/066-text-edit-browser-gui/canonical-gui.html" ] ||
  fail 'canonical GUI page was not found in the current PoC checkout'

port="${RUMIAI_TEXTEDIT_DEMO_PORT:-8765}"
case "$port" in
  ''|*[!0-9]*) fail 'RUMIAI_TEXTEDIT_DEMO_PORT must be an integer' ;;
esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] ||
  fail 'RUMIAI_TEXTEDIT_DEMO_PORT must be between 1024 and 65535'

work="$(mktemp -d "${TMPDIR:-/tmp}/rumiai-textedit-demo.XXXXXXXX")" ||
  fail 'cannot create a temporary workspace'
server=''
finish()
{
  status=$?
  trap - 0 HUP INT TERM
  if [ -n "$server" ]
  then
    kill "$server" 2>/dev/null || :
    wait "$server" 2>/dev/null || :
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap finish 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

core='c453b5764fec8403571125ea62107ae072a823a1'
product="$work/rumiai-os"
printf 'Preparazione GUI TextEdit: core canonico fissato a %s\n' "$core"
git clone -q --filter=blob:none \
  https://github.com/massimilianonardi-ai/rumiai-os.git "$product" ||
  fail 'cannot clone the actual RumiAI product core'
git -C "$product" checkout -q --detach "$core" ||
  fail 'cannot check out the pinned product revision'
mkdir -p "$product/src"
ln -s "$poc_root" "$product/src/rumiai-dev-PoCs" ||
  fail 'cannot link the existing PoC checkout into the temporary product tree'

(
  cd "$product"
  node lib/sys/js/jsc.lib.js lib/sys/js/core/modules-js.json \
    lib/sys/js/core/document2d-browser.generated.js
) > "$work/compile.log" 2>&1 ||
{
  cat "$work/compile.log" >&2
  fail 'the real Document2D browser core did not compile'
}
[ -s "$product/lib/sys/js/core/document2d-browser.generated.js" ] ||
  fail 'compiled browser core is empty'

url="http://127.0.0.1:$port/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html"
python3 -m http.server "$port" --bind 127.0.0.1 \
  --directory "$product" > "$work/http.log" 2>&1 &
server=$!
sleep 1
if ! kill -0 "$server" 2>/dev/null
then
  cat "$work/http.log" >&2
  fail "HTTP server failed; localhost port $port might be occupied"
fi
if ! python3 - "$url" <<'PY'
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1], timeout=5) as response:
        content = response.read()
        assert response.status == 200
        assert b'canonical-gui.js' in content
except Exception as error:
    print(f'GUI HTTP check failed: {error}', file=sys.stderr)
    sys.exit(1)
PY
then
  cat "$work/http.log" >&2
  fail 'the real GUI page is not accessible through the local HTTP server'
fi

printf '\nGUI interattiva TextEdit pronta: %s\n' "$url"
printf 'PoC checkout: %s\n' "$poc_root"
printf 'PoC revision: %s\n' "$(git -C "$poc_root" rev-parse HEAD)"
printf 'Apri la pagina nel browser e fai clic sul testo prima di digitare.\n'
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]
then
  if command -v xdg-open >/dev/null 2>&1
  then
    xdg-open "$url" >/dev/null 2>&1 ||
      printf 'Apertura automatica non riuscita: apri il link manualmente.\n'
  else
    printf 'xdg-open non presente: apri il link manualmente.\n'
  fi
else
  printf 'Nessuna sessione grafica: usa un browser sulla VM o un tunnel SSH locale.\n'
fi
printf '\nServer attivo; usa Ctrl+C in questo terminale per fermarlo.\n'
wait "$server"
