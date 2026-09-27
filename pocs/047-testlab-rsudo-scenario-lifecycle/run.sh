#!/bin/sh
set -u

IMAGE=${TESTLAB_POC_IMAGE:-docker.io/library/ubuntu:26.04}
STATE_ROOT=${TESTLAB_POC_STATE_ROOT:-${TMPDIR:-/tmp}/rumiai-testlab-poc-047}
LOGIN_USER=${TESTLAB_POC_USER:-testlab}

say()
{
    printf '%s\n' "$*"
}

die()
{
    printf 'ERROR %s\n' "$*" >&2
    exit 2
}

need()
{
    command -v "$1" >/dev/null 2>&1 || die "missing host prerequisite: $1"
}

status_set()
{
    instance=$1
    value=$2
    printf '%s\n' "$value" > "$instance/status" || die "cannot write instance status: $instance"
}

resource_add()
{
    instance=$1
    ownership=$2
    kind=$3
    value=$4

    case "$ownership" in
        owned|external) : ;;
        *) die "invalid experimental ownership: $ownership" ;;
    esac

    case "$value" in
        *'
'*|*'	'*) die "resource identity contains unsupported newline/TAB" ;;
    esac

    printf '%s\t%s\t%s\n' "$ownership" "$kind" "$value" >> "$instance/resources" ||
        die "cannot record resource: $kind"
}

context_add()
{
    instance=$1
    key=$2
    value=$3

    case "$key$value" in
        *'
'*|*'	'*) die "context record contains unsupported newline/TAB" ;;
    esac

    printf '%s\t%s\n' "$key" "$value" >> "$instance/context" ||
        die "cannot record context: $key"
}

context_get()
{
    instance=$1
    key=$2
    awk -F '	' -v wanted="$key" '
        $1 == wanted {
            print $2
            found = 1
            exit
        }
        END {
            if (!found) exit 1
        }
    ' "$instance/context"
}

instance_require()
{
    instance=$1
    [ -d "$instance" ] || die "scenario instance not found: $instance"
    [ -f "$instance/status" ] || die "scenario status missing: $instance"
    [ -f "$instance/resources" ] || die "scenario resource inventory missing: $instance"
}

instance_require_ready()
{
    instance_require "$1"
    state=$(cat "$1/status") || die "cannot read scenario status"
    [ "$state" = ready ] || die "scenario is not ready: $state"
    [ -f "$1/context" ] || die "scenario context missing: $1"
}

cleanup_resources()
{
    instance=$1
    command -v podman >/dev/null 2>&1 || return 1
    reverse="$instance/.resources.reverse.$$"
    result=0
    tab=$(printf '\tX')
    tab=${tab%X}

    awk '{ line[NR] = $0 } END { for (i = NR; i >= 1; i--) print line[i] }'         "$instance/resources" > "$reverse" || return 1

    while IFS="$tab" read -r ownership kind value extra
    do
        [ -z "$extra" ] || {
            printf 'ERROR malformed resource inventory record\n' >&2
            result=1
            continue
        }

        [ "$ownership" = owned ] || continue

        case "$kind" in
            podman-container)
                if podman container exists "$value" >/dev/null 2>&1
                then
                    podman rm -f "$value" >/dev/null 2>&1 || {
                        printf 'ERROR cannot remove owned container: %s\n' "$value" >&2
                        result=1
                    }
                fi
                ;;
            *)
                printf 'ERROR unknown owned resource kind: %s\n' "$kind" >&2
                result=1
                ;;
        esac
    done < "$reverse"

    rm -f "$reverse" 2>/dev/null || :
    return "$result"
}

prepare_failed()
{
    instance=$1
    message=$2

    printf 'ERROR %s\n' "$message" >&2
    if cleanup_resources "$instance"
    then
        status_set "$instance" failed-cleaned
    else
        status_set "$instance" cleanup-failed
    fi
    printf 'instance=%s\n' "$instance" >&2
    exit 2
}

prepare()
{
    [ "$#" -eq 1 ] || die "usage: $0 prepare <rumiai-os-root>"

    for tool in podman ssh ssh-keyscan openssl awk sed grep date sleep cat chmod mkdir mv rm
    do
        need "$tool"
    done

    target_root=$(CDPATH= cd -- "$1" 2>/dev/null && pwd -P) ||
        die "cannot resolve rumiai-os root: $1"
    [ -x "$target_root/m" ] || die "rumiai-os bootstrap is unavailable: $target_root/m"
    [ -x "$target_root/bin/sys/rsudo" ] || die "rsudo command is unavailable in target: $target_root"

    podman info >/dev/null 2>&1 || die "Podman host prerequisite is not operational"

    real_ssh=$(command -v ssh) || die "cannot resolve host ssh"
    case "$real_ssh" in
        /*) : ;;
        *) die "host ssh did not resolve to an absolute command path: $real_ssh" ;;
    esac

    password=$(openssl rand -hex 16) || die "cannot generate synthetic scenario password"
    [ -n "$password" ] || die "generated scenario password is empty"

    timestamp=$(date '+%Y%m%dT%H%M%S') || die "cannot create scenario timestamp"
    instance_id="$timestamp-$$"
    instance="$STATE_ROOT/$instance_id"
    container="testlab-rsudo-$instance_id"
    ssh_alias="testlab-rsudo-$instance_id"

    umask 077
    mkdir -p "$STATE_ROOT" || die "cannot create PoC state root: $STATE_ROOT"
    mkdir "$instance" || die "cannot create scenario instance: $instance"
    : > "$instance/resources" || die "cannot create resource inventory"
    : > "$instance/context" || die "cannot create scenario context"
    status_set "$instance" preparing

    resource_add "$instance" external target-root "$target_root"

    podman pull "$IMAGE" >/dev/null ||
        prepare_failed "$instance" "cannot resolve/pull base image: $IMAGE"
    resource_add "$instance" external podman-image "$IMAGE"

    podman run -d         --name "$container"         -p 127.0.0.1::22         "$IMAGE" sleep infinity >/dev/null ||
        prepare_failed "$instance" "cannot create SSH scenario container"

    # Record ownership immediately after creation, before any later setup step.
    resource_add "$instance" owned podman-container "$container"

    podman exec -e DEBIAN_FRONTEND=noninteractive "$container"         sh -c 'apt-get update && apt-get install -y --no-install-recommends openssh-server sudo && rm -rf /var/lib/apt/lists/*'         >/dev/null ||
        prepare_failed "$instance" "cannot install sshd/sudo in scenario container"

    printf '%s\n' "$password" |
        podman exec -i "$container" sh -c '
            user=$1
            IFS= read -r password || exit 1
            useradd -m -s /bin/sh "$user" || exit 1
            printf "%s:%s\n" "$user" "$password" | chpasswd || exit 1
            printf "%s ALL=(ALL:ALL) ALL\n" "$user" > "/etc/sudoers.d/$user" || exit 1
            chmod 440 "/etc/sudoers.d/$user" || exit 1
            mkdir -p /run/sshd || exit 1
            ssh-keygen -A >/dev/null 2>&1 || exit 1
        ' sh "$LOGIN_USER" ||
        prepare_failed "$instance" "cannot configure SSH/sudo account"

    podman exec "$container" /usr/sbin/sshd         -o PasswordAuthentication=yes         -o KbdInteractiveAuthentication=no         -o PermitRootLogin=no         -o "AllowUsers=$LOGIN_USER" ||
        prepare_failed "$instance" "cannot start sshd"

    mapping=$(podman port "$container" 22/tcp 2>/dev/null | sed -n '1p') ||
        prepare_failed "$instance" "cannot read published SSH port"
    port=${mapping##*:}
    case "$port" in
        ''|*[!0-9]*) prepare_failed "$instance" "invalid published SSH port: $mapping" ;;
    esac

    known_hosts_tmp="$instance/known_hosts.tmp"
    known_hosts="$instance/known_hosts"
    ready=false
    attempt=0
    while [ "$attempt" -lt 30 ]
    do
        attempt=$((attempt + 1))
        if ssh-keyscan -T 2 -p "$port" 127.0.0.1 > "$known_hosts_tmp" 2>/dev/null &&
           [ -s "$known_hosts_tmp" ]
        then
            mv "$known_hosts_tmp" "$known_hosts" ||
                prepare_failed "$instance" "cannot publish known_hosts"
            ready=true
            break
        fi
        sleep 1
    done
    rm -f "$known_hosts_tmp" 2>/dev/null || :
    [ "$ready" = true ] ||
        prepare_failed "$instance" "sshd did not become ready"

    ssh_config="$instance/ssh_config"
    cat > "$ssh_config" <<EOF_CONFIG
Host $ssh_alias
    HostName 127.0.0.1
    Port $port
    UserKnownHostsFile $known_hosts
    StrictHostKeyChecking yes
    PubkeyAuthentication no
    PreferredAuthentications password
    PasswordAuthentication yes
    KbdInteractiveAuthentication no
    IdentitiesOnly yes
EOF_CONFIG

    mkdir "$instance/bin" || prepare_failed "$instance" "cannot create scenario activity bin"
    cat > "$instance/bin/ssh" <<'EOF_ADAPTER'
#!/bin/sh

[ -n "${TESTLAB_POC_REAL_SSH-}" ] || {
    printf '%s\n' 'scenario ssh adapter: TESTLAB_POC_REAL_SSH is missing' >&2
    exit 127
}
[ -n "${TESTLAB_POC_SSH_CONFIG-}" ] || {
    printf '%s\n' 'scenario ssh adapter: TESTLAB_POC_SSH_CONFIG is missing' >&2
    exit 127
}

exec "$TESTLAB_POC_REAL_SSH" -F "$TESTLAB_POC_SSH_CONFIG" "$@"
EOF_ADAPTER
    chmod 700 "$instance/bin/ssh" ||
        prepare_failed "$instance" "cannot make scenario ssh adapter executable"

    context_add "$instance" instance-id "$instance_id"
    context_add "$instance" instance-dir "$instance"
    context_add "$instance" target-root "$target_root"
    context_add "$instance" podman-container "$container"
    context_add "$instance" ssh-host "$ssh_alias"
    context_add "$instance" ssh-port "$port"
    context_add "$instance" ssh-user "$LOGIN_USER"
    context_add "$instance" ssh-password "$password"
    context_add "$instance" ssh-config "$ssh_config"
    context_add "$instance" ssh-command-real "$real_ssh"
    context_add "$instance" path-prefix "$instance/bin"

    status_set "$instance" ready
    say "$instance"
}

activity_environment()
{
    instance=$1
    instance_require_ready "$instance"

    target_root=$(context_get "$instance" target-root) ||
        die "target-root missing from scenario context"
    ssh_host=$(context_get "$instance" ssh-host) ||
        die "ssh-host missing from scenario context"
    ssh_user=$(context_get "$instance" ssh-user) ||
        die "ssh-user missing from scenario context"
    ssh_password=$(context_get "$instance" ssh-password) ||
        die "ssh-password missing from scenario context"
    ssh_config=$(context_get "$instance" ssh-config) ||
        die "ssh-config missing from scenario context"
    real_ssh=$(context_get "$instance" ssh-command-real) ||
        die "ssh-command-real missing from scenario context"
    path_prefix=$(context_get "$instance" path-prefix) ||
        die "path-prefix missing from scenario context"

    PATH="$path_prefix:$PATH"
    TESTLAB_POC_REAL_SSH=$real_ssh
    TESTLAB_POC_SSH_CONFIG=$ssh_config
    RSUDO_HOST=$ssh_host
    RSUDO_USER=$ssh_user
    RSUDO_PASSWORD=$ssh_password

    export PATH TESTLAB_POC_REAL_SSH TESTLAB_POC_SSH_CONFIG
    export RSUDO_HOST RSUDO_USER RSUDO_PASSWORD
}

probe()
{
    [ "$#" -eq 1 ] || die "usage: $0 probe <instance-dir>"
    instance=$1
    activity_environment "$instance"

    stdout="$instance/probe.stdout"
    stderr="$instance/probe.stderr"

    "$target_root/m" "$target_root/bin/sys/rsudo" -- id -u > "$stdout" 2> "$stderr"
    rsudo_status=$?

    cat "$stdout"
    cat "$stderr" >&2

    [ "$rsudo_status" -eq 0 ] ||
        die "real rsudo probe returned status $rsudo_status"

    grep -x '0' "$stdout" >/dev/null 2>&1 ||
        die "real rsudo probe did not observe privileged uid 0"

    say "PASS real rsudo -> real ssh -> real sshd -> real sudo"
}

interactive()
{
    [ "$#" -eq 1 ] || die "usage: $0 interactive <instance-dir>"
    [ -t 0 ] && [ -t 1 ] || die "interactive activity requires a terminal"

    instance=$1
    activity_environment "$instance"

    exec "$target_root/m" "$target_root/bin/sys/rsudo" --interactive -- sh
}

cleanup()
{
    [ "$#" -eq 1 ] || die "usage: $0 cleanup <instance-dir>"
    instance=$1
    instance_require "$instance"
    need podman
    need awk
    need rm
    need cat

    state=$(cat "$instance/status") || die "cannot read scenario status"
    case "$state" in
        closed)
            say "$instance"
            return 0
            ;;
        *) : ;;
    esac

    status_set "$instance" closing
    if cleanup_resources "$instance"
    then
        status_set "$instance" closed
        say "$instance"
        return 0
    fi

    status_set "$instance" cleanup-failed
    die "scenario cleanup incomplete: $instance"
}

show_status()
{
    [ "$#" -eq 1 ] || die "usage: $0 status <instance-dir>"
    instance_require "$1"
    cat "$1/status"
}

show_context()
{
    [ "$#" -eq 1 ] || die "usage: $0 context <instance-dir>"
    instance_require_ready "$1"
    cat "$1/context"
}

usage()
{
    cat <<EOF_USAGE
usage:
  $0 prepare <rumiai-os-root>
  $0 status <instance-dir>
  $0 context <instance-dir>
  $0 probe <instance-dir>
  $0 interactive <instance-dir>
  $0 cleanup <instance-dir>
EOF_USAGE
}

[ "$#" -ge 1 ] || {
    usage >&2
    exit 2
}

action=$1
shift

case "$action" in
    prepare) prepare "$@" ;;
    status) show_status "$@" ;;
    context) show_context "$@" ;;
    probe) probe "$@" ;;
    interactive) interactive "$@" ;;
    cleanup) cleanup "$@" ;;
    *)
        usage >&2
        exit 2
        ;;
esac
