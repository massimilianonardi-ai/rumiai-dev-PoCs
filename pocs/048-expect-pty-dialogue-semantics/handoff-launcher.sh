#!/bin/sh

[ "$#" -ge 6 ] || {
    printf '%s\n' 'handoff-launcher.sh: usage: <driver> <transcript> <status-file> <status-wrapper> -- <command> [args...]' >&2
    exit 2
}

driver=$1
transcript=$2
status_file=$3
status_wrapper=$4
shift 4

[ "$1" = -- ] || {
    printf '%s\n' 'handoff-launcher.sh: missing -- before child command' >&2
    exit 2
}
shift

rm -f "$status_file" 2>/dev/null || :
"$driver" "$transcript" "$status_file" "$status_wrapper" -- "$@"
driver_status=$?

[ "$driver_status" -eq 0 ] || exit "$driver_status"

[ -f "$status_file" ] || {
    printf '%s\n' 'handoff-launcher.sh: child status record is unavailable' >&2
    exit 126
}

IFS= read -r child_status < "$status_file" || {
    printf '%s\n' 'handoff-launcher.sh: cannot read child status record' >&2
    exit 126
}

case $child_status in
    ''|*[!0-9]*)
        printf '%s\n' 'handoff-launcher.sh: invalid child status record' >&2
        exit 126
        ;;
esac

[ "$child_status" -le 255 ] || {
    printf '%s\n' 'handoff-launcher.sh: child status is out of range' >&2
    exit 126
}

exit "$child_status"
