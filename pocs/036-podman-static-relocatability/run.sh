#!/bin/sh
set -eu

VERSION=${PODMAN_STATIC_VERSION:-v6.1.2}
IMAGE=${PODMAN_TEST_IMAGE:-docker.io/library/alpine:3.22}
SERVER_IMAGE=${PODMAN_SERVER_IMAGE:-docker.io/library/nginx:alpine}

case "$(uname -m)" in
    x86_64|amd64)
        ASSET_ARCH=amd64
        ASSET_SHA256=481b6f5a57919aea837b54df1eaa6a5b968df505eedbdd78356e80306af676f1
        ;;
    aarch64|arm64)
        ASSET_ARCH=arm64
        ASSET_SHA256=0782f7e6934745cb24be81ebaf17fd0d3dc08040edfe0c25afe67a5fe2fcd0cf
        ;;
    *)
        echo "ERROR unsupported experiment architecture: $(uname -m)" >&2
        exit 2
        ;;
esac

need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR missing experiment tool: $1" >&2
        exit 2
    }
}

for tool in curl tar sha256sum file grep sed find sort strings; do
    need "$tool"
done

work=$(mktemp -d "${TMPDIR:-/tmp}/podman-static-poc.XXXXXX")
cleanup() {
    if [ -n "${PODMAN_BIN:-}" ] && [ -x "${PODMAN_BIN:-}" ]; then
        "$PODMAN_BIN" pod rm -af >/dev/null 2>&1 || true
        "$PODMAN_BIN" rm -af >/dev/null 2>&1 || true
        "$PODMAN_BIN" system reset -f >/dev/null 2>&1 || true
    fi
    rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

asset="podman-linux-${ASSET_ARCH}.tar.gz"
url="https://github.com/mgoltzsche/podman-static/releases/download/${VERSION}/${asset}"
archive="$work/$asset"

echo "release=$VERSION"
echo "asset=$asset"
echo "asset-url=$url"
echo "host-kernel=$(uname -sr)"
echo "host-arch=$(uname -m)"
echo "host-user=$(id -un)"
echo "host-uid=$(id -u)"

curl -fsSL --retry 3 --retry-delay 2 -o "$archive" "$url"
printf '%s  %s\n' "$ASSET_SHA256" "$archive" | sha256sum -c -

tar -xzf "$archive" -C "$work"
source_root="$work/podman-linux-$ASSET_ARCH"
[ -d "$source_root" ] || {
    echo "ERROR expected archive root missing: $source_root" >&2
    exit 1
}

relocated="$work/relocated-bundle"
mv "$source_root" "$relocated"
[ ! -e "$source_root" ]

echo "relocated-root=$relocated"
echo "archive-files-begin"
find "$relocated" -type f -o -type l | sed "s|$relocated/||" | sort
echo "archive-files-end"

echo "executable-linkage-begin"
find "$relocated/usr/local" -type f -perm -111 2>/dev/null | sort | while IFS= read -r exe; do
    rel=${exe#"$relocated/"}
    kind=$(file -b "$exe")
    printf '%s :: %s\n' "$rel" "$kind"
    if command -v ldd >/dev/null 2>&1; then
        ldd "$exe" 2>&1 | sed 's/^/  ldd: /' || true
    fi
    if command -v readelf >/dev/null 2>&1; then
        if readelf -l "$exe" 2>/dev/null | grep -q 'INTERP'; then
            echo "  elf-interpreter=yes"
        else
            echo "  elf-interpreter=no"
        fi
    fi
done
echo "executable-linkage-end"

PODMAN_BIN="$relocated/usr/local/bin/podman"
CONMON_BIN="$relocated/usr/local/lib/podman/conmon"
CRUN_BIN="$relocated/usr/local/bin/crun"

for exe in "$PODMAN_BIN" "$CONMON_BIN" "$CRUN_BIN"; do
    [ -x "$exe" ] || {
        echo "ERROR required bundled executable missing: $exe" >&2
        exit 1
    }
done

systemd_run_strings=$(strings "$PODMAN_BIN" | grep -c 'systemd-run' || true)
echo "podman-systemd-run-string-count=$systemd_run_strings"

state="$work/state"
config="$state/config"
data="$state/data"
runtime="$state/runtime"
tmp="$state/tmp"
mkdir -p "$config/containers" "$data" "$runtime" "$tmp"
chmod 700 "$runtime"

if [ -d "$relocated/etc/containers" ]; then
    cp -R "$relocated/etc/containers/." "$config/containers/"
fi

cat > "$config/containers/containers.conf" <<EOF_CONF
[containers]
seccomp_profile = "$relocated/etc/containers/seccomp.json"

[engine]
cgroup_manager = "cgroupfs"
events_logger = "file"
conmon_path = ["$CONMON_BIN"]
helper_binaries_dir = ["$relocated/usr/local/lib/podman", "$relocated/usr/local/bin"]
runtime = "crun"

[engine.runtimes]
crun = ["$CRUN_BIN"]
EOF_CONF

cat > "$config/containers/storage.conf" <<EOF_STORAGE
[storage]
driver = "vfs"
graphroot = "$data/storage"
runroot = "$runtime/storage"
EOF_STORAGE

export HOME="$state/home"
export XDG_CONFIG_HOME="$config"
export XDG_DATA_HOME="$data"
export XDG_RUNTIME_DIR="$runtime"
export CONTAINERS_CONF="$config/containers/containers.conf"
export CONTAINERS_STORAGE_CONF="$config/containers/storage.conf"
if [ -f "$relocated/etc/containers/registries.conf" ]; then
    export CONTAINERS_REGISTRIES_CONF="$relocated/etc/containers/registries.conf"
fi
export TMPDIR="$tmp"
export PATH="$relocated/usr/local/bin:$PATH"
mkdir -p "$HOME"

host_user=$(id -un)
rootless_ready=yes
for tool in newuidmap newgidmap; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "host-requirement-missing=$tool"
        rootless_ready=no
    else
        echo "host-requirement-present=$tool:$(command -v "$tool")"
    fi
done
for mapfile in /etc/subuid /etc/subgid; do
    if [ ! -r "$mapfile" ] || ! grep -q "^$host_user:" "$mapfile"; then
        echo "host-requirement-missing=${mapfile}:${host_user}"
        rootless_ready=no
    else
        echo "host-requirement-present=${mapfile}:${host_user}"
    fi
done
if [ -e /dev/fuse ]; then
    echo "host-fuse=present"
else
    echo "host-fuse=absent"
fi

"$PODMAN_BIN" --version
"$CRUN_BIN" --version | head -n 1
"$CONMON_BIN" --version | head -n 1

echo "podman-info-begin"
info_log="$work/podman-info.log"
if "$PODMAN_BIN" --log-level=debug info >"$info_log" 2>&1; then
    cat "$info_log"
    echo "podman-info-result=PASS"
else
    info_status=$?
    cat "$info_log"
    echo "podman-info-result=FAIL:$info_status"
    if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] &&
       [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1 ] &&
       grep -q 'failed to reexec: Permission denied' "$info_log"; then
        echo "rootless-execution=SKIP_HOST_APPARMOR_PATH_POLICY"
        exit 0
    fi
    if [ "$rootless_ready" = yes ]; then
        exit "$info_status"
    fi
    echo "rootless-execution=SKIP_HOST_REQUIREMENTS"
    exit 0
fi
echo "podman-info-end"

"$PODMAN_BIN" pull "$IMAGE"
"$PODMAN_BIN" pull "$SERVER_IMAGE"
"$PODMAN_BIN" run --rm --network=host "$IMAGE" sh -c 'printf "basic-container-ok\\n"'
echo "basic-container=PASS"

"$PODMAN_BIN" run --rm "$IMAGE" sh -c 'wget -qO- https://example.com >/dev/null'
echo "rootless-network=PASS"

"$PODMAN_BIN" pod create --name rumi-poc-pod >/dev/null
"$PODMAN_BIN" run -d --pod rumi-poc-pod --name rumi-poc-server "$SERVER_IMAGE" >/dev/null
out=
for attempt in 1 2 3 4 5; do
    if "$PODMAN_BIN" run --rm --pod rumi-poc-pod "$IMAGE" wget -qO- http://127.0.0.1 >/dev/null 2>&1; then
        out=pod-ok
        break
    fi
    sleep 1
done
[ "${out:-}" = "pod-ok" ] || {
    echo "ERROR pod interaction failed" >&2
    echo "pod-diagnostics-begin" >&2
    "$PODMAN_BIN" pod ps >&2 || true
    "$PODMAN_BIN" ps -a --pod >&2 || true
    "$PODMAN_BIN" pod inspect rumi-poc-pod >&2 || true
    "$PODMAN_BIN" logs rumi-poc-server >&2 || true
    echo "pod-diagnostics-end" >&2
    exit 1
}
echo "pod-interaction=PASS"
"$PODMAN_BIN" pod rm -f rumi-poc-pod >/dev/null

port=18080
"$PODMAN_BIN" run -d --name rumi-poc-port -p "127.0.0.1:${port}:80" "$SERVER_IMAGE" >/dev/null
port_out=
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "http://127.0.0.1:${port}" >/dev/null 2>&1; then
        port_out=port-ok
        break
    fi
    sleep 1
done
[ "${port_out:-}" = "port-ok" ] || {
    echo "ERROR port forwarding failed" >&2
    "$PODMAN_BIN" ps -a >&2 || true
    "$PODMAN_BIN" logs rumi-poc-port >&2 || true
    exit 1
}
echo "port-forwarding=PASS"
"$PODMAN_BIN" rm -f rumi-poc-port >/dev/null

kube="$work/pod.yaml"
cat > "$kube" <<EOF_KUBE
apiVersion: v1
kind: Pod
metadata:
  name: rumi-poc-kube
spec:
  containers:
    - name: sleeper
      image: $IMAGE
      command: ["sh", "-c", "sleep 30"]
EOF_KUBE
"$PODMAN_BIN" kube play "$kube"
"$PODMAN_BIN" pod exists rumi-poc-kube
"$PODMAN_BIN" kube down "$kube"
echo "kube-play-down=PASS"

"$PODMAN_BIN" run -d --name rumi-poc-health \
    --health-cmd 'true' --health-interval 1s --health-retries 1 "$IMAGE" sleep 20 >/dev/null
sleep 3
health_status=$("$PODMAN_BIN" inspect --format '{{.State.Health.Status}}' rumi-poc-health 2>/dev/null || true)
echo "healthcheck-status-after-3s=${health_status:-unavailable}"
"$PODMAN_BIN" rm -f rumi-poc-health >/dev/null

case "$health_status" in
    healthy|unhealthy)
        echo "healthcheck-scheduling=ACTIVE"
        ;;
    starting)
        echo "healthcheck-scheduling=INACTIVE_OR_NOT_TRIGGERED"
        ;;
    *)
        echo "healthcheck-scheduling=UNDETERMINED"
        ;;
esac

echo "PASS podman-static relocatability experiment"
