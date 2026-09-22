#!/bin/sh

set -u

fail()
{
  printf -- '%s\n' "poc-014: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: $0 <rumiai-os-root>"

rumiai_os_root=$1
[ -x "$rumiai_os_root/m" ] || fail "invalid rumiai-os root: $rumiai_os_root"

self_dir=${0%/*}
[ "$self_dir" != "$0" ] || self_dir=.
poc_root="$(CDPATH= cd -- "$self_dir/.." && pwd -P)" || fail "cannot resolve PoC root"
project="$poc_root/fixtures/project"

command -p -- rm -rf "$project/target" || fail "cannot reset Maven target"

plan="$("$rumiai_os_root/m" mk --project "$project" --plan build)" || fail "mk plan failed"
[ "$plan" = "maven-package" ] || fail "unexpected mk plan: $plan"

"$rumiai_os_root/m" mk --project "$project" build || fail "mk delegated Maven build failed"

jar="$project/target/mk-maven-poc-1.0.0.jar"
[ -f "$jar" ] || fail "Maven did not produce expected jar"

output="$("$rumiai_os_root/m" java -cp "$jar" org.rumiai.poc.App)" || fail "built Java program failed"
[ "$output" = "mk-maven-ok" ] || fail "unexpected program output: $output"

printf -- '%s\n' "PASS poc-014 mk -> Maven delegation"
