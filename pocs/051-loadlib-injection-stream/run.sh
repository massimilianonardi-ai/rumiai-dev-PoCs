#!/bin/sh
set -u

[ "$#" -eq 1 ] || {
    printf 'usage: %s <rumiai-os-root>\n' "$0" >&2
    exit 2
}

target_root=$1

for tool in cat expect mktemp sh
do
    command -v "$tool" >/dev/null 2>&1 || {
        printf 'ERROR missing prerequisite: %s\n' "$tool" >&2
        exit 2
    }
done

backend=$target_root/lib/sys/sh/loadlib-inject.lib.sh
command_source=$target_root/bin/sys/menu

[ -r "$backend" ] || {
    printf 'ERROR injection backend unavailable: %s\n' "$backend" >&2
    exit 2
}
[ -r "$command_source" ] || {
    printf 'ERROR menu command unavailable: %s\n' "$command_source" >&2
    exit 2
}

tmp=${TMPDIR:-/tmp}/rumiai-poc-051-$$
mkdir "$tmp" || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

stream=$tmp/menu.inject.sh
result=$tmp/result
transcript=$tmp/transcript

refs='core array map term menu'

{
    cat <<'EOF_LOADER'
loadsyslib()
{
  [ "$#" -eq 1 ] || return 1
  loadlib "sys/sh/$1"
}
EOF_LOADER

    cat "$backend" || exit 2

    index=0
    for ref in $refs
    do
        path=$target_root/lib/sys/sh/$ref.lib.sh
        [ -r "$path" ] || {
            printf 'ERROR requested library unavailable: %s\n' "$ref" >&2
            exit 2
        }

        index=$((index + 1))
        printf '\n_loadlib_inject_%s()\n{\n' "$index"
        cat "$path" || exit 2
        printf '\n}\n'
    done

    printf '\n_loadlib_inject_dispatch()\n{\n'
    printf '  [ "$#" -eq 1 ] || return 1\n'
    printf '  case "$1" in\n'

    index=0
    for ref in $refs
    do
        index=$((index + 1))
        printf "    'sys/sh/%s') _loadlib_inject_%s ;;\n" "$ref" "$index"
    done

    printf '    *) return 2 ;;\n'
    printf '  esac\n'
    printf '}\n\n'

    printf 'loadsyslib "core" || exit "$?"\n\n'
    cat "$command_source" || exit 2
} > "$stream" || exit 2

sh -n "$stream" || {
    printf 'ERROR generated stream is not valid POSIX-sh syntax\n' >&2
    exit 1
}

POC051_STREAM=$stream
POC051_RESULT=$result
export POC051_STREAM POC051_RESULT

expect >"$transcript" 2>&1 <<'EOF_EXPECT'
set timeout 15
spawn -noecho sh $env(POC051_STREAM) one two > $env(POC051_RESULT)
stty rows 24 columns 80
after 300
send "\r"
expect eof
set outcome [wait]
exit [lindex $outcome 3]
EOF_EXPECT
status=$?

[ "$status" -eq 0 ] || {
    cat "$transcript" >&2
    printf 'ERROR injected menu returned status %s\n' "$status" >&2
    exit 1
}

serialized=$(cat "$result") || exit 2
eval "set -- $serialized"

[ "$#" -eq 2 ] && [ "$1" = enter ] && [ "$2" = one ] || {
    printf 'ERROR unexpected menu result: %s\n' "$serialized" >&2
    exit 1
}

printf 'stream-syntax=PASS\n'
printf 'menu-result=PASS\n'
printf 'embedded-libraries=%s\n' "$refs"
printf 'PASS explicit loadlib injection stream\n'
