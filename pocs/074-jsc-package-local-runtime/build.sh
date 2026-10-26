#!/bin/sh
# Source-only package assembly; no node, mk or application build required.
set -eu

[ "$#" -eq 1 ] || { printf '%s\n' 'usage: sh build.sh <new-output-dir>' >&2; exit 2; }
output=$1
self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.

[ -f "$self_dir/bin/jsc" ] || exit 3
[ -f "$self_dir/lib/jsc.lib.js" ] || exit 4
[ -f "$self_dir/res/manual/jsc" ] || exit 5
[ -f "$self_dir/res/manual/jsc.lib.js" ] || exit 6
[ ! -e "$output" ] && [ ! -L "$output" ] || exit 7

command -p -- mkdir -p -- "$output/root/bin" "$output/root/lib" "$output/root/res/manual"
command -p -- cp -- "$self_dir/bin/jsc" "$output/root/bin/jsc"
command -p -- cp -- "$self_dir/lib/jsc.lib.js" "$output/root/lib/jsc.lib.js"
command -p -- cp -- "$self_dir/res/manual/jsc" "$output/root/res/manual/jsc"
command -p -- cp -- "$self_dir/res/manual/jsc.lib.js" "$output/root/res/manual/jsc.lib.js"
command -p chmod 755 "$output/root/bin/jsc"
command -p chmod 644 "$output/root/lib/jsc.lib.js"
(
  CDPATH= cd -- "$output/root"
  command -p -- tar -czf ../jsc-v0.1.0-all.tar.gz bin lib res
)
