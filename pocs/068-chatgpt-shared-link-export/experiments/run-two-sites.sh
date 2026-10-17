#!/bin/sh
# Interactive, isolated PWC launch for the two real-site observation trials.
# Run with: sh experiments/run-two-sites.sh <explicit-project-output-dir>
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]
then
  printf '%s\n' 'usage: sh experiments/run-two-sites.sh <explicit-project-output-dir>' >&2
  exit 2
fi

umask 077
case "$1" in
  /*) output=$1 ;;
  *) output=$(pwd -P)/$1 ;;
esac

if [ -e "$output" ]
then
  printf '%s\n' 'trial.output-already-exists: select a fresh evidence directory' >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
mkdir -p "$output"
runtime=$(mktemp -d "$output/.pwc-runtime.XXXXXXXX")
pwc_pid=
WEB_CONTROL_SOCKET="/tmp/rumiai-page-trial-$$.sock"

cleanup()
{
  if [ -n "$pwc_pid" ]
  then
    kill "$pwc_pid" 2>/dev/null || :
    wait "$pwc_pid" 2>/dev/null || :
  fi
  rm -rf "$runtime"
  rm -f "$WEB_CONTROL_SOCKET"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

WEB_CONTROL_BROWSER_EXECUTABLE=$(command -v chromium || command -v chromium-browser || :)
if [ -z "$WEB_CONTROL_BROWSER_EXECUTABLE" ]
then
  printf '%s\n' 'trial.chromium-not-found' >&2
  exit 3
fi

export WEB_CONTROL_BROWSER_EXECUTABLE
export WEB_CONTROL_SOCKET
export WEB_CONTROL_HOME="$runtime/browser-profile"
export WEB_CONTROL_HEADLESS=0
export npm_config_cache="$runtime/npm-cache"

printf '%s\n' '[SETUP] Isolated pwc-web-control v0.1.6'
git clone --quiet --depth 1 \
  https://github.com/massimilianonardi-ai/pwc-web-control.git \
  "$runtime/pwc"

# Exact reference revision confirmed at task preflight.
expected=403f4fa9bbea419715e9c834e847c6f2b60ae421
actual=$(git -C "$runtime/pwc" rev-parse HEAD)
if [ "$actual" != "$expected" ]
then
  printf '%s\n' 'trial.pwc-revision-changed: review current provider before executing' >&2
  exit 4
fi

(
  cd "$runtime/pwc"
  npm install --ignore-scripts --no-audit --no-fund --no-package-lock
) > "$output/pwc-install.log" 2>&1

WEB_CONTROL_CMD="$runtime/pwc/bin/web-control"
export WEB_CONTROL_CMD

"$runtime/pwc/bin/web-control-service" > "$output/pwc-service.log" 2>&1 &
pwc_pid=$!

"$WEB_CONTROL_CMD" status > "$output/pwc-status.json"

printf '%s\n' '[RUN] First Amazon Wishlist, then ChatGPT shared conversation'
printf '%s\n' '[RUN] Use the visible Chromium window; return to this terminal and press Enter after each demonstration.'
cd "$project_dir"
node experiments/two-site-observation.mjs "$output"
