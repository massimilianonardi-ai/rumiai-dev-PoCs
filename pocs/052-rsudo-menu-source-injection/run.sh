#!/bin/sh
set -u

[ "$#" -eq 2 ] || {
    printf 'usage: %s <poc-047-run.sh> <rumiai-os-root>\n' "$0" >&2
    exit 2
}

scenario_driver=$1
target_root=$2

for tool in awk cat chmod grep mkdir rm script sh
do
    command -v "$tool" >/dev/null 2>&1 || {
        printf 'ERROR missing prerequisite: %s\n' "$tool" >&2
        exit 2
    }
done

[ -x "$scenario_driver" ] || {
    printf 'ERROR scenario driver unavailable: %s\n' "$scenario_driver" >&2
    exit 2
}

context_get()
{
    instance=$1
    key=$2
    awk -F '\t' -v wanted="$key" '
        $1 == wanted { print $2; found=1; exit }
        END { if (!found) exit 1 }
    ' "$instance/context"
}

instance=$("$scenario_driver" prepare "$target_root") || exit 2
cleanup()
{
    "$scenario_driver" cleanup "$instance" >/dev/null 2>&1 || :
}
trap cleanup EXIT HUP INT TERM

ssh_host=$(context_get "$instance" ssh-host) || exit 2
ssh_user=$(context_get "$instance" ssh-user) || exit 2
ssh_password=$(context_get "$instance" ssh-password) || exit 2
ssh_config=$(context_get "$instance" ssh-config) || exit 2
real_ssh=$(context_get "$instance" ssh-command-real) || exit 2

backend=$target_root/lib/sys/sh/loadlib-inject.lib.sh
command_source=$target_root/bin/sys/menu
stream=$instance/menu.inject.sh
wrapper=$instance/run-menu-injection
status_file=$instance/menu.status
transcript=$instance/menu.transcript
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
        [ -r "$path" ] || exit 2
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
    printf 'loadsyslib "core" || exit "$?"\n'
    printf 'set -- -H POC052_MENU -- one two\n\n'
    cat "$command_source" || exit 2
} > "$stream" || exit 2

sh -n "$stream" || {
    printf 'ERROR generated source is not valid shell syntax\n' >&2
    exit 1
}

cat > "$wrapper" <<'EOF_WRAPPER'
#!/bin/sh
cat "$POC052_STREAM" |
    "$POC052_M" "$POC052_RSUDO" \
        --ssh-command "$POC052_SSH_COMMAND" --interactive --
status=$?
printf '%s\n' "$status" > "$POC052_STATUS_FILE"
exit 0
EOF_WRAPPER
chmod 700 "$wrapper" || exit 2

RSUDO_HOST=$ssh_host
RSUDO_USER=$ssh_user
RSUDO_PASSWORD=$ssh_password
m_LOG_LEVEL=fatal
POC052_STREAM=$stream
POC052_M=$target_root/m
POC052_RSUDO=$target_root/bin/sys/rsudo
POC052_SSH_COMMAND="$real_ssh -F $ssh_config"
POC052_STATUS_FILE=$status_file
POC052_WRAPPER=$wrapper
export RSUDO_HOST RSUDO_USER RSUDO_PASSWORD m_LOG_LEVEL
export POC052_STREAM POC052_M POC052_RSUDO POC052_SSH_COMMAND POC052_STATUS_FILE POC052_WRAPPER

printf '\n' | script -q -c "$wrapper" /dev/null >"$transcript" 2>&1
driver_status=$?

[ "$driver_status" -eq 0 ] || {
    cat "$transcript" >&2
    printf 'ERROR interactive injection driver returned %s\n' "$driver_status" >&2
    exit 1
}

[ -s "$status_file" ] || {
    cat "$transcript" >&2
    printf 'ERROR rsudo status was not recorded\n' >&2
    exit 1
}

status=$(cat "$status_file") || exit 2
[ "$status" -eq 0 ] || {
    cat "$transcript" >&2
    printf 'ERROR rsudo source injection returned %s\n' "$status" >&2
    exit 1
}

grep -F "'enter' 'one'" "$transcript" >/dev/null 2>&1 || {
    cat "$transcript" >&2
    printf 'ERROR remote menu result was not observed\n' >&2
    exit 1
}

printf 'remote-menu=PASS\n'
printf 'embedded-libraries=%s\n' "$refs"
printf 'PASS rsudo menu source injection\n'

"$scenario_driver" cleanup "$instance" >/dev/null || exit 2
trap - EXIT HUP INT TERM
