#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf '%s\n' 'usage: sh tests/run.sh /absolute/path/mk.lib.js' >&2; exit 2; }
engine=$1
[ -f "$engine" ] || { printf '%s\n' 'real mk engine not found' >&2; exit 2; }
poc_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)

work_root=$(mktemp -d "${TMPDIR:-/tmp}/rumiai-composition.XXXXXXXX") || exit 2
trap 'rm -rf "$work_root"' 0
trap 'exit 1' 1 2 3 15
WORK=$work_root/work
mkdir -p "$WORK" "$work_root/repositories"
export WORK

for component in m pkg lang
do
  repository="$work_root/repositories/$component"
  mkdir -p "$repository"
  cp -R "$poc_root/fixtures/$component/." "$repository/"
  git -C "$repository" init -q
  git -C "$repository" add -A
  git -C "$repository" -c user.name=PoC -c user.email=poc@example.invalid commit -qm snapshot
  sha=$(git -C "$repository" rev-parse HEAD)
  case "$component" in
    m) M_REPO=$repository; M_SHA=$sha ;;
    pkg) PKG_REPO=$repository; PKG_SHA=$sha ;;
    lang) LANG_REPO=$repository; LANG_SHA=$sha ;;
  esac
done
export M_REPO M_SHA PKG_REPO PKG_SHA LANG_REPO LANG_SHA

node -e 'Promise.resolve(require(process.argv[1]).mkMain(process.argv.slice(2))).then(s => { process.exitCode = s; }, e => { console.error(e); process.exitCode = 1; });' -- "$engine" --project "$poc_root" --plan build > "$work_root/mk-plan"
[ ! -e "$WORK/mk" ] || { printf '%s\n' 'mk plan mutated the work tree' >&2; exit 1; }
[ -s "$work_root/mk-plan" ] || { printf '%s\n' 'mk plan was empty' >&2; exit 1; }

sh "$poc_root/build-posix.sh"
node -e 'Promise.resolve(require(process.argv[1]).mkMain(process.argv.slice(2))).then(s => { process.exitCode = s; }, e => { console.error(e); process.exitCode = 1; });' -- "$engine" --project "$poc_root" build

git diff --no-index -- "$WORK/out-posix" "$WORK/out-mk" || { printf '%s\n' 'outputs differ' >&2; exit 1; }

for name in out-posix out-mk
do
  output="$WORK/$name"
  [ -x "$output/m" ] && [ -x "$output/bin/sys/pkg-root" ] && [ -x "$output/bin/sys/lang-root" ]
  [ -L "$output/res/sys/lang/current" ] || exit 1
  [ "$(readlink "$output/res/sys/lang/current")" = en_US ] || exit 1
  [ "$(cat "$output/res/sys/lang/current/demo/message")" = hello ] || exit 1
  physical_output=$(CDPATH= cd -- "$output" && pwd -P)
  actual_root=$("$output/m")
  [ "$actual_root" = "$physical_output" ] || { printf 'wrong canonical root: %s != %s\\n' "$actual_root" "$physical_output" >&2; exit 1; }
  [ "$("$output/m" pkg-root)" = "$physical_output/pkg" ] || { printf '%s\\n' 'wrong pkg root' >&2; exit 1; }
  [ "$("$output/m" lang-root)" = "$physical_output/res/sys/lang" ] || { printf '%s\\n' 'wrong lang root' >&2; exit 1; }
done

printf '%s\n' 'PASS: two pinned Git builds, byte-equivalent trees, independent bootstrap execution'
