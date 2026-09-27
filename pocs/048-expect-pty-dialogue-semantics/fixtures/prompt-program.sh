#!/bin/sh

[ -t 0 ] || {
    printf '%s\n' 'fixture: stdin is not a TTY' >&2
    exit 20
}

printf 'first> '
IFS= read -r first || exit 21
[ "$first" = alpha ] || exit 21

printf 'second> '
IFS= read -r second || exit 22
[ "$second" = beta ] || exit 22

printf 'done:%s:%s\n' "$first" "$second"
exit 23
