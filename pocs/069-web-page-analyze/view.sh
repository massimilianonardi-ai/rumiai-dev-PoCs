#!/bin/sh
# Open the existing PoC run through local HTTP, not the desktop file portal.
set -eu
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Uso: sh view.sh <nome-esecuzione>' >&2
  exit 2
fi
case "$1" in
  ''|*[!A-Za-z0-9_-]*) printf '%s\n' 'view.invalid-run-name' >&2; exit 2 ;;
esac
self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
run="$self/evidence/$1"
if [ ! -d "$run" ] || [ -L "$run" ] || [ -L "$self/evidence" ]; then
  printf '%s\n' 'view.run-must-be-a-real-poc-directory' >&2
  exit 3
fi
cd "$self"
node generate-collage.mjs "$1"
printf '%s\n' '[VIEW] Chromium o un altro browser:'
printf '%s\n' '  http://127.0.0.1:8765/'
printf '%s\n' '  http://127.0.0.1:8765/amazon-wishlist/comparison.html'
printf '%s\n' '  http://127.0.0.1:8765/amazon-wishlist/collage.html'
printf '%s\n' '  http://127.0.0.1:8765/chatgpt-share/comparison.html'
printf '%s\n' '  http://127.0.0.1:8765/chatgpt-share/collage.html'
printf '%s\n' '[VIEW] Il server resta in primo piano. Ctrl+C lo chiude.'
exec python3 -m http.server 8765 --bind 127.0.0.1 --directory "$run"
