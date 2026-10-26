#!/bin/sh
# Real, isolated standalone-m package integration for the independent jsc candidate.
set -eu

[ "$#" -eq 1 ] || { printf '%s\n' 'usage: sh tests/run.sh <standalone-m-checkout>' >&2; exit 2; }
source_root=$1
self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.
poc_dir=$self_dir/..
work=$(mktemp -d "${TMPDIR:-/tmp}/jsc-package-test.XXXXXXXX") || exit 3
trap 'command -p -- rm -rf -- "$work"' 0
trap 'exit 130' HUP INT TERM

command -p -- mkdir -- "$work/runtime"
root=$work/runtime
command -p -- cp -R -- "$source_root/." "$root/"
command -p -- rm -rf -- "$root/.git"
[ -x "$root/m" ] || exit 4
[ -x "$root/bin/sys/pkg" ] || exit 5
[ ! -e "$root/bin/sys/jsc" ] || exit 6
[ ! -e "$root/lib/sys/js/jsc.lib.js" ] || exit 7
"$root/m" osarch update

# Node and jsc are not bootstrap requirements.
"$root/m" state-path user sys jsc cache > "$work/state.txt"
[ -s "$work/state.txt" ] || exit 8

sh "$poc_dir/build.sh" "$work/distribution"
[ -s "$work/distribution/jsc-v0.1.0-all.tar.gz" ] || exit 9
[ -f "$work/distribution/root/res/manual/jsc" ] || exit 10
command -p -- mkdir -- "$work/staging"
(
  CDPATH= cd -- "$work/staging"
  command -p -- tar -xzf "$work/distribution/jsc-v0.1.0-all.tar.gz"
)
[ -x "$work/staging/bin/jsc" ] || exit 11
[ -f "$work/staging/lib/jsc.lib.js" ] || exit 12

cat > "$work/integrate" <<'EOF_DRIVER'
#!/bin/sh
[ -n "${m_ROOT:-}" ] || exit 1
. "$m_LIB_DIR/sys/sh/core.lib.sh" || exit 2
loadsyslib "pkg/pkg-integration" || exit 3
pkg_integrate jsc v0.1.0 "$1" "$2" || exit 4
pkg_default_apply jsc v0.1.0 || exit 5
EOF_DRIVER
command -p chmod 700 "$work/integrate"
"$root/m" "$work/integrate" "$poc_dir/catalog/pkg/jsc/all/n0001=v0.1.0" "$work/staging" || exit 13
[ -L "$root/bin/ext/jsc" ] || exit 14
[ -x "$root/pkg/jsc@v0.1.0/root/bin/jsc" ] || exit 15
[ -f "$root/pkg/jsc@v0.1.0/root/lib/jsc.lib.js" ] || exit 16
[ ! -e "$root/lib/sys/js/jsc.lib.js" ] || exit 17

"$root/m" pkg install nodejs@v26.8.2 || exit 18
node_concrete=$("$root/m" pkg default nodejs)
case "$node_concrete" in nodejs@v26*) :;; *) exit 19;; esac

command -p -- mkdir -- "$work/project"
printf 'const answer=42;\n' > "$work/project/value.js"
cat > "$work/project/modules-js.json" <<'EOF_JS'
{
  "modules": [
    {"name": "demo", "modules": [{"file": "value.js", "exports": "answer"}]}
  ]
}
EOF_JS
"$root/m" jsc "$work/project/modules-js.json" "$work/project/output.js" || exit 20
[ -s "$work/project/output.js" ] || exit 21
[ -s "$work/project/output.js.gz" ] || [ -s "$work/project/output.min.js.gz" ] || exit 22
"$root/m" node -e 'const x=require(process.argv[1]);if(x.demo.answer!==42)process.exit(43)' "$work/project/output.js" || exit 23

printf '.demo { color: red; }\n' > "$work/project/style.css"
cat > "$work/project/modules-css.json" <<'EOF_CSS'
{"modules": [{"file": "style.css"}]}
EOF_CSS
"$root/m" jsc "$work/project/modules-css.json" > "$work/project/compiled.css" || exit 24
[ -s "$work/project/compiled.css" ] || exit 25
"$root/m" jsc "$work/project/modules-css.json" "$work/project/output.css" || exit 26
[ -s "$work/project/output.css.gz" ] || [ -s "$work/project/output.min.css.gz" ] || exit 27

printf '%s\n' 'PASS: jsc package-local real integration, JS/CSS compilation and managed Node'
