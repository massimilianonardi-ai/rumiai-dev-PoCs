#!/bin/sh

[ -t 0 ] || {
    printf '%s\n' 'handoff fixture: stdin is not a TTY' >&2
    exit 30
}

printf 'auto> '
IFS= read -r automatic || exit 31
[ "$automatic" = automated ] || exit 31

printf '%s\n' 'handoff-ready'

IFS= read -r handoff_start || exit 34
[ "$handoff_start" = handoff-start ] || exit 35

printf 'human> '
IFS= read -r operator || exit 36
[ "$operator" = operator ] || exit 38
printf 'human-seen:%s\n' "$operator"

printf 'resume> '
IFS= read -r final || exit 39
[ "$final" = automated-finish ] || exit 40

printf '%s\n' 'handoff-done'
exit 37
