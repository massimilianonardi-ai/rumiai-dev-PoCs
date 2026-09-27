#!/bin/sh
set -u

die()
{
    printf 'ERROR %s\n' "$*" >&2
    exit 2
}

need()
{
    command -v "$1" >/dev/null 2>&1 || die "missing host prerequisite: $1"
}

resolve_dir()
{
    self=$0
    case "$self" in
        */*) : ;;
        *) self=$(command -v "$self" 2>/dev/null) || return 1 ;;
    esac
    dir=${self%/*}
    [ "$dir" != "$self" ] || dir=.
    CDPATH= cd -- "$dir" 2>/dev/null && pwd -P
}

need expect
need awk
need grep
need mktemp
need rm
need cat

root=$(resolve_dir) || die "cannot resolve PoC directory"
driver="$root/driver.exp"
fixture="$root/fixtures/prompt-program.sh"

[ -x "$driver" ] || die "Expect driver is unavailable"
[ -x "$fixture" ] || die "fixture program is unavailable"

work=$(mktemp -d "${TMPDIR:-/tmp}/expect-pty-poc.XXXXXX") || die "cannot create temporary directory"
cleanup()
{
    rm -rf "$work" 2>/dev/null || :
}
trap cleanup EXIT HUP INT TERM

tab=$(printf '\tX')
tab=${tab%X}

dialogue="$work/dialogue"
printf 'first> %salpha\nsecond> %sbeta\n' "$tab" "$tab" > "$dialogue" ||
    die "cannot write dialogue"

transcript="$work/transcript"

"$driver" "$dialogue" "$transcript" -- "$fixture"
status=$?

[ "$status" -eq 23 ] ||
    die "driver returned $status instead of child status 23"

grep -F 'first> ' "$transcript" >/dev/null 2>&1 ||
    die "first prompt missing from transcript"
grep -F 'second> ' "$transcript" >/dev/null 2>&1 ||
    die "second prompt missing from transcript"
grep -F 'done:alpha:beta' "$transcript" >/dev/null 2>&1 ||
    die "completion record missing from transcript"

bad_dialogue="$work/bad-dialogue"
printf 'never-produced> %svalue\n' "$tab" > "$bad_dialogue" ||
    die "cannot write negative dialogue"

bad_transcript="$work/bad-transcript"

TESTLAB_EXPECT_POC_TIMEOUT=1
export TESTLAB_EXPECT_POC_TIMEOUT

"$driver" "$bad_dialogue" "$bad_transcript" -- "$fixture"
bad_status=$?

unset TESTLAB_EXPECT_POC_TIMEOUT

[ "$bad_status" -eq 124 ] ||
    die "dialogue timeout returned $bad_status instead of 124"

printf '%s\n' "PASS expect PTY dialogue semantics"
