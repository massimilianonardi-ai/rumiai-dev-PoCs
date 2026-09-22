#!/bin/sh

set -u

fail()
{
  printf -- '%s\n' "poc-015: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: $0 <rumiai-os-root>"

rumiai_os_root=$1
[ -x "$rumiai_os_root/m" ] || fail "invalid rumiai-os root: $rumiai_os_root"
command -v c++ >/dev/null 2>&1 || fail "host c++ compiler is unavailable"

self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.
poc_root="$(CDPATH= cd -- "$self_dir/.." && pwd -P)" || fail "cannot resolve PoC root"

tmp="${TMPDIR:-/tmp}/rumiai-poc-015-$$"
umask 077
mkdir "$tmp" || fail "cannot create temporary directory"
trap 'rm -rf "$tmp"' 0 HUP INT TERM

project="$tmp/project"
command -p -- cp -R "$poc_root/fixtures/project" "$project" || fail "cannot copy project fixture"

command -p -- cp "$project/mk.manual.json" "$project/mk.json" || fail "cannot activate manual graph"
command -p -- rm -rf "$project/build" "$project/dist" || fail "cannot reset baseline outputs"

plan="$tmp/manual.plan"
"$rumiai_os_root/m" mk --project "$project" --plan build > "$plan" || fail "manual fine-grained plan failed"

cat > "$tmp/manual.expected" <<'EOF_PLAN'
dir-dist
dir-build-obj
compile-main
dir-build-obj-math
compile-add
compile-multiply
link
EOF_PLAN
command -p -- cmp -s "$tmp/manual.expected" "$plan" || fail "manual fine-grained plan is unexpected"

"$rumiai_os_root/m" mk --project "$project" build || fail "manual fine-grained build failed"
baseline="$("$project/dist/native-cpp-poc")" || fail "baseline binary failed"
[ "$baseline" = "5:6" ] || fail "unexpected baseline output: $baseline"

command -p -- cp "$project/changes/add/subtract.cpp" "$project/src/math/subtract.cpp" || fail "cannot add source"
command -p -- cp "$project/changes/add/main.cpp" "$project/src/main.cpp" || fail "cannot activate added source"
command -p -- rm -rf "$project/build" "$project/dist" || fail "cannot reset outputs before stale-graph check"

if "$rumiai_os_root/m" mk --project "$project" build >/dev/null 2>&1
then
  fail "stale static mk.json unexpectedly handled a newly added source"
fi

"$rumiai_os_root/m" node "$poc_root/prototype/expand-native-cpp.js" "$project" || fail "experimental graph expansion failed after add"
command -p -- grep -F '"src/math/subtract.cpp"' "$project/mk.json" >/dev/null || fail "expanded graph omitted added source"
compile_count="$("$rumiai_os_root/m" mk --project "$project" --plan build | command -p -- grep -c '^compile-')" || :
[ "$compile_count" -eq 4 ] || fail "expanded add graph has $compile_count compile operations, expected 4"
"$rumiai_os_root/m" mk --project "$project" build || fail "expanded build failed after add"
added="$("$project/dist/native-cpp-poc")" || fail "binary failed after add"
[ "$added" = "5:6:-1" ] || fail "unexpected output after add: $added"

command -p -- mv "$project/src/math/multiply.cpp" "$project/src/math/product.cpp" || fail "cannot rename source"
command -p -- rm -rf "$project/build" "$project/dist" || fail "cannot reset outputs after rename"
"$rumiai_os_root/m" node "$poc_root/prototype/expand-native-cpp.js" "$project" || fail "experimental graph expansion failed after rename"
command -p -- grep -F '"src/math/product.cpp"' "$project/mk.json" >/dev/null || fail "expanded graph omitted renamed source"
if command -p -- grep -F '"src/math/multiply.cpp"' "$project/mk.json" >/dev/null
then
  fail "expanded graph retained removed source pathname after rename"
fi
"$rumiai_os_root/m" mk --project "$project" build || fail "expanded build failed after rename"
renamed="$("$project/dist/native-cpp-poc")" || fail "binary failed after rename"
[ "$renamed" = "5:6:-1" ] || fail "unexpected output after rename: $renamed"

command -p -- rm "$project/src/math/add.cpp" || fail "cannot remove source"
command -p -- cp "$project/changes/remove/main.cpp" "$project/src/main.cpp" || fail "cannot activate source removal"
command -p -- rm -rf "$project/build" "$project/dist" || fail "cannot reset outputs after removal"
"$rumiai_os_root/m" node "$poc_root/prototype/expand-native-cpp.js" "$project" || fail "experimental graph expansion failed after removal"
if command -p -- grep -F '"src/math/add.cpp"' "$project/mk.json" >/dev/null
then
  fail "expanded graph retained removed source"
fi
compile_count="$("$rumiai_os_root/m" mk --project "$project" --plan build | command -p -- grep -c '^compile-')" || :
[ "$compile_count" -eq 3 ] || fail "expanded removal graph has $compile_count compile operations, expected 3"
"$rumiai_os_root/m" mk --project "$project" build || fail "expanded build failed after removal"
removed="$("$project/dist/native-cpp-poc")" || fail "binary failed after removal"
[ "$removed" = "6:-1" ] || fail "unexpected output after removal: $removed"

printf -- '%s\n' "PASS poc-015 mk native C++ graph expansion"
