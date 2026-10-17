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
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

# Every persistent artifact MUST be written inside this exact PoC checkout.
# Reject arbitrary or external paths instead of silently using caller CWD,
# a browser download portal, /run/user, or HOME.
case "$1" in
  "$script_dir/evidence/"*) run_name=${1##*/} ;;
  ./experiments/evidence/*|experiments/evidence/*) run_name=${1##*/} ;;
  */*) printf '%s\n' 'trial.output-outside-poc: use experiments/evidence/<new-name>' >&2; exit 2 ;;
  *) run_name=$1 ;;
esac
case "$run_name" in
  ''|.|..|*[!A-Za-z0-9._-]*)
    printf '%s\n' 'trial.invalid-evidence-directory-name' >&2
    exit 2
    ;;
esac
output="$script_dir/evidence/$run_name"
if [ -e "$output" ]
then
  printf '%s\n' 'trial.output-already-exists: select a fresh evidence directory' >&2
  exit 2
fi
mkdir -p "$output"
printf '[OUTPUT] All persistent evidence: %s\n' "$output"
runtime=$(mktemp -d "$output/.pwc-runtime.XXXXXXXX")
pwc_pid=
# All browser state, cache and temporary FILE CONTENTS stay inside the PoC.
# The checkout pathname is too deep to use directly as a Unix socket path.
# A short-lived /tmp symlink resolves to this PoC's runtime; only the alias,
# never any output files, is outside the PoC, and cleanup removes it.
socket_suffix=$(printf '%s\n' "$runtime" | cksum)
socket_suffix=${socket_suffix%% *}
runtime_alias="/tmp/rumiai-pwc-rt-$socket_suffix"
alias_created=0
WEB_CONTROL_SOCKET="/tmp/rumiai-page-trial-$socket_suffix.sock"

cleanup()
{
  if [ -n "$pwc_pid" ]
  then
    kill "$pwc_pid" 2>/dev/null || :
    wait "$pwc_pid" 2>/dev/null || :
  fi
  if [ "$alias_created" -eq 1 ]
  then
    rm -f "$runtime_alias"
  fi
  rm -rf "$runtime"
  rm -f "$WEB_CONTROL_SOCKET"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$runtime/tmp" "$runtime/cache" "$runtime/config" "$runtime/data"
ln -s "$runtime" "$runtime_alias"
alias_created=1
export TMPDIR="$runtime_alias/tmp"
export XDG_CACHE_HOME="$runtime_alias/cache"
export XDG_CONFIG_HOME="$runtime_alias/config"
export XDG_DATA_HOME="$runtime_alias/data"
# Preserve the host's XDG_RUNTIME_DIR: it is desktop-compositor IPC, not an
# artifact destination. All our temporary files still resolve into the PoC.

WEB_CONTROL_BROWSER_EXECUTABLE=$(command -v chromium || command -v chromium-browser || :)
if [ -z "$WEB_CONTROL_BROWSER_EXECUTABLE" ]
then
  printf '%s\n' 'trial.chromium-not-found' >&2
  exit 3
fi

export WEB_CONTROL_BROWSER_EXECUTABLE
export WEB_CONTROL_SOCKET
export WEB_CONTROL_HOME="$runtime_alias/browser-profile"
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

# PWC launches Chromium BEFORE opening its Unix socket. Calling the client
# immediately after forking the service races browser startup. A single client
# status command times out after 15 seconds; some physical VMs need longer.
# Poll with bounded short attempts and detect a dead service independently.
printf '%s\n' '[PWC] Waiting for Chromium and the PWC service socket'
ready=0
attempt=0
while [ "$attempt" -lt 45 ]
do
  if WEB_CONTROL_CONNECT_TIMEOUT_MS=1000 "$WEB_CONTROL_CMD" status \
    > "$output/pwc-status.json" 2> "$output/pwc-status-error.log"
  then
    ready=1
    break
  fi

  if ! kill -0 "$pwc_pid" 2>/dev/null
  then
    printf '%s\n' 'trial.pwc-service-exited-before-ready' >&2
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

if [ "$ready" -ne 1 ]
then
  if [ "$attempt" -ge 45 ]
  then
    printf '%s\n' 'trial.pwc-startup-timeout' >&2
  fi
  printf '[PWC] Startup log saved in %s\n' "$output/pwc-service.log" >&2
  printf '%s\n' '--- Last PWC startup diagnostics ---' >&2
  tail -n 35 "$output/pwc-service.log" >&2 || :
  printf '%s\n' '--- Client connection diagnostic ---' >&2
  tail -n 6 "$output/pwc-status-error.log" >&2 || :
  exit 5
fi

# A failed readiness probe is not a final error; keep only the successful
# status evidence. All files stay within this PoC's evidence directory.
rm -f "$output/pwc-status-error.log"
printf '%s\n' '[PWC_READY] Browser and controller are responding'
printf '%s\n' '[RUN] First Amazon Wishlist, then ChatGPT shared conversation'
printf '%s\n' '[RUN] Use the visible Chromium window; return to this terminal and press Enter after each demonstration.'
cd "$project_dir"

# Even an intentionally incomplete replay can produce usable immutable MHTML
# evidence. Always derive the static styled views after the acquisition
# process, preserving the original exit status and native captures.
trial_status=0
node experiments/two-site-observation.mjs "$output" || trial_status=$?
printf '%s\n' '[OFFLINE] Building PoC-local HTML/CSS/assets from existing MHTML'
if python3 experiments/prepare-offline-views.py "$output"
then
  printf '%s\n' '[OFFLINE] Derived views ready'
else
  printf '%s\n' 'trial.offline-view-preparation-failed: inspect PoC reports' >&2
  if [ "$trial_status" -eq 0 ]
  then
    trial_status=6
  fi
fi
printf '[VIEW] Start: node experiments/serve-evidence.mjs ./experiments/evidence/%s\n' "$run_name"
exit "$trial_status"
