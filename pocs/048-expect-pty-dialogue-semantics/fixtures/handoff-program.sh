#!/bin/sh

[ -t 0 ] || {
    printf '%s\n' 'handoff fixture: stdin is not a TTY' >&2
    exit 30
}

printf 'auto> '
IFS= read -r automatic || exit 31
[ "$automatic" = automated ] || exit 31

printf '%s\n' 'handoff-ready'
printf 'human> '
IFS= read -r operator || exit 32
[ "$operator" = operator ] || exit 32
printf 'human-seen:%s\n' "$operator"

printf 'resume> '
IFS= read -r final || exit 33
[ "$final" = automated-finish ] || exit 33

printf '%s\n' 'handoff-done'
exit 37
