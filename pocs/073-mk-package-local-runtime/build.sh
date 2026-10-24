#!/bin/sh
# Packaging only: use the original checked-out mk engine; do not compile it.
set -eu

[ "$#" -eq 1 ] || { printf '%s\n' 'usage: sh build.sh <output-dir>' >&2; exit 2; }

output_root=$1
self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.

[ -f "$self_dir/lib/mk.lib.js" ] || exit 3
[ -f "$self_dir/bin/mk" ] || exit 4
[ ! -e "$output_root" ] && [ ! -L "$output_root" ] || exit 5

command -p -- mkdir -p -- "$output_root/root/bin" "$output_root/root/lib"
command -p -- cp -- "$self_dir/bin/mk" "$output_root/root/bin/mk"
command -p -- cp -- "$self_dir/lib/mk.lib.js" "$output_root/root/lib/mk.lib.js"
command -p -- chmod 755 -- "$output_root/root/bin/mk"
command -p -- chmod 644 -- "$output_root/root/lib/mk.lib.js"
(
  CDPATH= cd -- "$output_root/root"
  command -p -- tar -czf ../mk-v0.1.0.tar.gz bin lib
)
