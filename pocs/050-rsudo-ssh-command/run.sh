#!/bin/sh
set -u

[ "$#" -eq 2 ] || {
    printf 'usage: %s <poc-047-run.sh> <rumiai-os-root>\n' "$0" >&2
    exit 2
}

scenario_driver=$1
target_root=$2

need()
{
    command -v "$1" >/dev/null 2>&1 || {
        printf 'ERROR missing prerequisite: %s\n' "$1" >&2
        exit 2
    }
}

for tool in awk grep expect mkdir cp chmod cat
do
    need "$tool"
done

[ -x "$scenario_driver" ] || {
    printf 'ERROR scenario driver unavailable: %s\n' "$scenario_driver" >&2
    exit 2
}
[ -x "$target_root/m" ] || {
    printf 'ERROR target bootstrap unavailable: %s\n' "$target_root/m" >&2
    exit 2
}

context_get()
{
    instance=$1
    key=$2
    awk -F '	' -v wanted="$key" '
        $1 == wanted { print $2; found=1; exit }
        END { if (!found) exit 1 }
    ' "$instance/context"
}

instance=$("$scenario_driver" prepare "$target_root") || exit 2

cleanup()
{
    "$scenario_driver" cleanup "$instance" >/dev/null 2>&1 || :
    [ -z "${space_instance-}" ] ||
        "$scenario_driver" cleanup "$space_instance" >/dev/null 2>&1 || :
}
trap cleanup EXIT HUP INT TERM

ssh_host=$(context_get "$instance" ssh-host) || exit 2
ssh_user=$(context_get "$instance" ssh-user) || exit 2
ssh_password=$(context_get "$instance" ssh-password) || exit 2
ssh_config=$(context_get "$instance" ssh-config) || exit 2
real_ssh=$(context_get "$instance" ssh-command-real) || exit 2

ssh_command="$real_ssh -F $ssh_config"

RSUDO_HOST=$ssh_host
RSUDO_USER=$ssh_user
RSUDO_PASSWORD=$ssh_password
export RSUDO_HOST RSUDO_USER RSUDO_PASSWORD

out=$(
    "$target_root/m" "$target_root/bin/sys/rsudo"         --ssh-command "$ssh_command" -- id -u
) || {
    printf 'ERROR --ssh-command non-interactive case failed\n' >&2
    exit 1
}
[ "$out" = 0 ] || {
    printf 'ERROR --ssh-command returned unexpected uid: %s\n' "$out" >&2
    exit 1
}
printf 'non-interactive=PASS\n'

RSUDO_SSH_COMMAND=$ssh_command
export RSUDO_SSH_COMMAND
out=$(
    "$target_root/m" "$target_root/bin/sys/rsudo" -- id -u
) || {
    printf 'ERROR ambient RSUDO_SSH_COMMAND case failed\n' >&2
    exit 1
}
[ "$out" = 0 ] || {
    printf 'ERROR ambient RSUDO_SSH_COMMAND returned unexpected uid: %s\n' "$out" >&2
    exit 1
}
printf 'ambient=PASS\n'
unset RSUDO_SSH_COMMAND

remote_path="/tmp/rsudo-ssh-command-recursive-$$"
"$target_root/m" "$target_root/bin/sys/rsudo"     --ssh-command "$ssh_command" -- sh -c 'mkdir -p -- "$1"; printf x > "$1/file"' sh "$remote_path" ||
    exit 1

"$target_root/m" "$target_root/bin/sys/rsudo"     --ssh-command "$ssh_command" fs delete "$remote_path" ||
    {
        printf 'ERROR recursive fs delete failed\n' >&2
        exit 1
    }

"$target_root/m" "$target_root/bin/sys/rsudo"     --ssh-command "$ssh_command" -- sh -c 'test ! -e "$1"' sh "$remote_path" ||
    {
        printf 'ERROR recursive fs delete did not remove remote path\n' >&2
        exit 1
    }
printf 'recursive=PASS\n'

wrapper="$instance/interactive-wrapper"
cat > "$wrapper" <<EOF_WRAPPER
#!/bin/sh
RSUDO_HOST=$(printf "'%s'" "$ssh_host")
RSUDO_USER=$(printf "'%s'" "$ssh_user")
RSUDO_PASSWORD=$(printf "'%s'" "$ssh_password")
export RSUDO_HOST RSUDO_USER RSUDO_PASSWORD
exec $(printf "'%s'" "$target_root/m") $(printf "'%s'" "$target_root/bin/sys/rsudo") \
    --ssh-command $(printf "'%s'" "$ssh_command") --interactive -- id -u
EOF_WRAPPER
chmod 700 "$wrapper" || exit 2

TESTLAB_POC_INTERACTIVE_WRAPPER=$wrapper
export TESTLAB_POC_INTERACTIVE_WRAPPER
expect <<'EOF_EXPECT'
set timeout 45
log_user 1
spawn -noecho $env(TESTLAB_POC_INTERACTIVE_WRAPPER)
expect eof
set result [wait]
set status [lindex $result 3]
exit $status
EOF_EXPECT
unset TESTLAB_POC_INTERACTIVE_WRAPPER
status=$?
[ "$status" -eq 0 ] || {
    printf 'ERROR interactive --ssh-command case returned %s\n' "$status" >&2
    exit 1
}
printf 'interactive=PASS\n'

space_root="${TMPDIR:-/tmp}/rumiai poc 050 state"
TESTLAB_POC_STATE_ROOT=$space_root
export TESTLAB_POC_STATE_ROOT
space_instance=$("$scenario_driver" prepare "$target_root") || exit 2
unset TESTLAB_POC_STATE_ROOT

space_host=$(context_get "$space_instance" ssh-host) || exit 2
space_user=$(context_get "$space_instance" ssh-user) || exit 2
space_password=$(context_get "$space_instance" ssh-password) || exit 2
space_config=$(context_get "$space_instance" ssh-config) || exit 2
space_real_ssh=$(context_get "$space_instance" ssh-command-real) || exit 2

RSUDO_HOST=$space_host
RSUDO_USER=$space_user
RSUDO_PASSWORD=$space_password
export RSUDO_HOST RSUDO_USER RSUDO_PASSWORD

space_command="$space_real_ssh -F $space_config"
"$target_root/m" "$target_root/bin/sys/rsudo"     --ssh-command "$space_command" -- id -u >/dev/null 2>"$space_instance/unquoted.stderr"
space_unquoted=$?

space_command_quoted="$space_real_ssh -F \"$space_config\""
"$target_root/m" "$target_root/bin/sys/rsudo"     --ssh-command "$space_command_quoted" -- id -u >/dev/null 2>"$space_instance/quoted.stderr"
space_quoted=$?

printf 'space-path-unquoted-status=%s\n' "$space_unquoted"
printf 'space-path-quoted-status=%s\n' "$space_quoted"

"$scenario_driver" cleanup "$space_instance" >/dev/null || exit 2
space_instance=

"$scenario_driver" cleanup "$instance" >/dev/null || exit 2
trap - EXIT HUP INT TERM

printf 'PASS core rsudo --ssh-command cases\n'
