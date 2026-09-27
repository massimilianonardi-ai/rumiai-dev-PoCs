#!/bin/sh

[ "$#" -ge 3 ] && [ "$2" = -- ] || {
    printf '%s\n' 'status-wrapper.sh: usage: <status-file> -- <command> [args...]' >&2
    exit 2
}

status_file=$1
shift 2

"$@"
status=$?

umask 077
tmp="$status_file.$$"

printf '%s\n' "$status" > "$tmp" || exit 126
mv "$tmp" "$status_file" || {
    rm -f "$tmp" 2>/dev/null || :
    exit 126
}

exit "$status"
