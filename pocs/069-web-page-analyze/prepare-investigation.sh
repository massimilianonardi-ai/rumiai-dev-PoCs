#!/bin/sh
# Prepare local AI-review artifacts without publishing sensitive website data.
set -eu
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Uso: sh prepare-investigation.sh <nome-indagine>' >&2
  exit 2
fi
case "$1" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' 'investigation.invalid-name' >&2
    exit 2 ;;
esac
self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
folder="$self/evidence/investigations/$1"
if [ ! -d "$folder" ] || [ -L "$folder" ] ||
   [ -L "$self/evidence" ] ||
   [ -L "$self/evidence/investigations" ]; then
  printf '%s\n' 'investigation.source-not-an-isolated-run' >&2
  exit 3
fi
for f in manifest.json scripts.json dom-samples.jsonl \
         dom-mutations.jsonl checkpoints.jsonl network.jsonl response-schema.jsonl \
         render-assets.jsonl
do
  if [ ! -f "$folder/$f" ] || [ -L "$folder/$f" ]; then
    printf '%s\n' "investigation.required-evidence-missing: $f" >&2
    exit 3
  fi
done
command -v tar >/dev/null 2>&1 ||
  { printf '%s\n' 'investigation.tar-unavailable' >&2; exit 3; }
node "$self/analyze-investigation.mjs" "$1" > "$folder/analysis-summary.json"
(
  cd "$folder"
  set -- analysis-summary.json manifest.json scripts.json scripts \
    dom-samples.jsonl dom-mutations.jsonl checkpoints.jsonl network.jsonl response-schema.jsonl \
    render-assets.jsonl
  # Include CSS rules for renderer investigation, never automatically
  # include binary image/font/attachment payloads or raw page HTML.
  for f in render-assets/*.css; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then set -- "$@" "$f"; fi
  done
  # Optional candidate SOURCE summary, never candidate-model-*.json
  # because those contain complete conversation messages.
  if [ -f snapshot-candidates.json ] && [ ! -L snapshot-candidates.json ]; then
    set -- "$@" snapshot-candidates.json
  fi
  for f in coverage-*.json; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then set -- "$@" "$f"; fi
  done
  if [ -e analysis-bundle.tar.gz ]; then
    printf '%s\n' 'investigation.bundle-already-exists' >&2
    exit 4
  fi
  tar -czf analysis-bundle.tar.gz -- "$@"
)
printf '%s\n' '[INDICE] analysis-summary.json' \
  '[PACCHETTO] analysis-bundle.tar.gz' \
  '[PRIVACY] Allegare il pacchetto in questa chat solo se autorizzato.' \
  '[PRIVACY] Contiene script JS e struttura DOM; non va pubblicato su GitHub.' \
  '[PRIVACY] Include i CSS caricati; immagini/font/allegati e DOM HTML privato sono esclusi.' \
  '[PRIVACY] Profili browser, risposte di rete integrali e PNG sono esclusi.'
