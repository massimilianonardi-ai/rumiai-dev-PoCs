#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf '%s\n' 'usage: sh tests/run.sh <rumiai-os-checkout>' >&2; exit 2; }
product=$1
self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.
poc_dir=$self_dir/..

work=${TMPDIR:-/tmp}/rumiai-mk-package-$$
cleanup()
{
  command -p -- rm -rf -- "$work"
}
trap cleanup 0
trap 'exit 130' HUP INT TERM

[ ! -e "$work" ] && [ ! -L "$work" ] || exit 3
command -p -- mkdir -p -- "$work/runtime"
root=$work/runtime
# A disposable copy, never the caller-owned checkout.
command -p -- cp -R -- "$product/." "$root/"
command -p -- rm -rf -- "$root/.git"

[ -x "$root/m" ] || { printf '%s\n' 'runtime bootstrap not executable' >&2; exit 4; }
[ -x "$root/bin/sys/pkg" ] || exit 5
[ -f "$root/lib/sys/js/mk.lib.js" ] || exit 6

# Model m-core: no system mk binary and no system mk library.
command -p -- rm -- "$root/bin/sys/mk" "$root/lib/sys/js/mk.lib.js"
[ ! -e "$root/bin/sys/mk" ] || exit 7
[ ! -e "$root/lib/sys/js/mk.lib.js" ] || exit 8
command -p -- mkdir -p -- "$root/pkg"

# m and pkg are usable without any Node.js installation in the copied root.
"$root/m" "$root/bin/sys/state-path" user sys mk cache > "$work/bootstrap.out"
[ -s "$work/bootstrap.out" ] || exit 9
printf '%s\n' 'bootstrap without mk PASS'

sh "$poc_dir/build.sh" "$product" "$work/distribution"
[ -s "$work/distribution/mk-v0.1.0.tar.gz" ] || exit 10
[ -f "$work/distribution/root/lib/mk.lib.js" ] || exit 11
[ ! -e "$work/distribution/root/lib/sys" ] || exit 12

command -p -- mkdir -- "$work/staging"
(
  CDPATH= cd -- "$work/staging"
  command -p -- tar -xzf "$work/distribution/mk-v0.1.0.tar.gz"
)
[ -x "$work/staging/bin/mk" ] || exit 13
[ -f "$work/staging/lib/mk.lib.js" ] || exit 14

# Invoke the genuine pkg materialization from within an initialized m context.
driver=$work/integrate
cat > "$driver" <<'EOF_DRIVER'
#!/bin/sh
[ -n "${m_ROOT:-}" ] || exit 1
. "$m_LIB_DIR/sys/sh/core.lib.sh" || exit 2
loadsyslib "osarch" || exit 3
loadsyslib "pkg/pkg-integration" || exit 4
pkg_integrate mk v0.1.0 "$1" "$2" || exit 5
pkg_default_apply mk v0.1.0 || exit 6
EOF_DRIVER
command -p -- chmod 700 -- "$driver"
"$root/m" "$driver" "$poc_dir/catalog/pkg/mk/all/n0001=v0.1.0" "$work/staging" || exit 15

[ -f "$root/pkg/mk@v0.1.0/root/lib/mk.lib.js" ] || exit 16
[ -x "$root/pkg/mk@v0.1.0/root/bin/mk" ] || exit 17
[ -L "$root/pkg/mk@v0.1.0/link/mk" ] || exit 18
[ -L "$root/bin/ext/mk" ] || exit 19
[ ! -e "$root/lib/sys/js/mk.lib.js" ] || exit 20
printf '%s\n' 'real pkg integration and package-local library PASS'

# Managed Node is acquired with pkg rather than from the host prerequisites.
"$root/m" "$root/bin/sys/pkg" install nodejs@v26.8.2
node_concrete=$("$root/m" "$root/bin/sys/pkg" default nodejs)
case "$node_concrete" in nodejs@*) :;; *) exit 21;; esac
[ -d "$root/pkg/$node_concrete/root" ] || exit 22

command -p -- mkdir -- "$work/project"
cat > "$work/project/mk.json" <<'EOF_PROJECT'
{
  "version": 1,
  "goals": {
    "check": ["identity"]
  },
  "operations": {
    "identity": {
      "action": {
        "type": "process",
        "command": "node",
        "args": [
          "-e",
          "const fs=require('node:fs'),path=require('node:path');const actual=fs.realpathSync(process.execPath),expected=fs.realpathSync(process.env.EXPECTED_NODE_ROOT);if(!actual.startsWith(expected+path.sep))process.exit(51);"
        ]
      }
    }
  }
}
EOF_PROJECT

EXPECTED_NODE_ROOT="$root/pkg/$node_concrete/root"
export EXPECTED_NODE_ROOT
"$root/m" mk --project "$work/project" --goals > "$work/goals"
[ "$(command -p -- cat -- "$work/goals")" = check ] || exit 23
"$root/m" mk --project "$work/project" --plan check > "$work/plan"
[ -s "$work/plan" ] || exit 24
"$root/m" mk --project "$work/project" check || exit 25
printf '%s\n' 'mk package launcher, plan, action and managed Node PASS'
