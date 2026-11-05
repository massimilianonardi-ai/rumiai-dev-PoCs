#!/bin/sh
# Build Ubuntu 24.04 Minimal directly into a partitionless ext4 RAW filesystem.
# Only a NEW output directory is accepted; never formats a physical disk.
set -eu
umask 077

if [ "$#" -ne 1 ] || [ -e "$1" ]; then
  echo 'usage: build.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo MBOOT_RAW_BUILD_REQUIRES_ROOT >&2
  exit 3
fi
for tool in debootstrap chroot apt-get mount umount mkfs.ext4 \
            truncate e2fsck blkid sha256sum zstd lsinitramfs awk du getent; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "MBOOT_RAW_MISSING_TOOL: $tool" >&2
    exit 4
  fi
done

case "$(uname -m)" in
  x86_64)
    architecture=amd64
    mirror=https://archive.ubuntu.com/ubuntu
    security_mirror=https://security.ubuntu.com/ubuntu
    apt_hosts='archive.ubuntu.com security.ubuntu.com'
    guest_packages='qemu-system-x86 ovmf'
    ;;
  aarch64)
    architecture=arm64
    mirror=https://ports.ubuntu.com/ubuntu-ports
    security_mirror=$mirror
    apt_hosts='ports.ubuntu.com'
    guest_packages='qemu-system-arm qemu-efi-aarch64'
    ;;
  *)
    echo MBOOT_RAW_UNSUPPORTED_HOST_ARCH >&2
    exit 5
    ;;
esac

here=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
mkdir -p "$1"
output=$(CDPATH= cd "$1" && pwd -P)
rootfs=$output/rootfs
mkdir -m 0755 "$rootfs"

# A build chroot shares the runner's networking. The former libguestfs
# appliance (and its separate DNS/network stack) is not used.
debootstrap --arch="$architecture" --variant=minbase \
  --include=ubuntu-keyring,ca-certificates \
  noble "$rootfs" "$mirror" > "$output/debootstrap.log" 2>&1 || {
    echo MBOOT_RAW_DEBOOTSTRAP_FAILED >&2
    tail -n 80 "$output/debootstrap.log" >&2
    exit 6
  }

cat > "$rootfs/etc/apt/sources.list" <<EOF
deb $mirror noble main universe
deb $mirror noble-updates main universe
deb $security_mirror noble-security main universe
EOF
# Use the actual runner resolver for build-time APT, not a hardcoded DNS IP.
rm -f "$rootfs/etc/resolv.conf"
cp /etc/resolv.conf "$rootfs/etc/resolv.conf"

# Refuse to accidentally start target services while installing packages.
cat > "$rootfs/usr/sbin/policy-rc.d" <<'EOF'
#!/bin/sh
exit 101
EOF
chmod 0755 "$rootfs/usr/sbin/policy-rc.d"

# Bind mounts exist only during package configuration and initramfs creation.
# On any failure, unmount before leaving; never remove a live bind tree.
mounted_dev=0
mounted_proc=0
mounted_sys=0
cleanup() {
  result=$?
  trap - 0 1 2 3 15
  if [ "$mounted_dev" -eq 1 ]; then
    umount -R "$rootfs/dev" || result=30
  fi
  if [ "$mounted_sys" -eq 1 ]; then
    umount "$rootfs/sys" || result=31
  fi
  if [ "$mounted_proc" -eq 1 ]; then
    umount "$rootfs/proc" || result=32
  fi
  exit "$result"
}
trap cleanup 0
trap 'exit 130' 1 2 3 15

mount -t proc proc "$rootfs/proc"
mounted_proc=1
mount --bind /sys "$rootfs/sys"
mounted_sys=1
mount --make-rslave "$rootfs/sys"
mount --rbind /dev "$rootfs/dev"
mounted_dev=1
mount --make-rslave "$rootfs/dev"

# Some hosted build runners resolve Ubuntu mirrors on the host but not from
# a newly debootstrapped chroot. Verify the real resolver before proceeding.
# If the chroot cannot resolve a known mirror, use the host's *current*
# resolution for this build only, preserving HTTPS hostnames and APT signing.
# These temporary /etc/hosts entries are removed from the released rootfs.
# debootstrap minbase may not create /etc/hosts at all.
if [ ! -f "$rootfs/etc/hosts" ]; then
  printf '127.0.0.1 localhost\n::1 localhost\n' > "$rootfs/etc/hosts"
fi
cp "$rootfs/etc/hosts" "$output/hosts-before-build.txt"
for apt_host in $apt_hosts; do
  # Even a successful DNS probe can fail later during package downloads on
  # some hosted runners. Keep a temporary per-build mapping throughout APT.
  host_ip=$(getent ahostsv4 "$apt_host" | awk 'NR == 1 { print $1 }')
  if [ -z "$host_ip" ]; then
    echo "MBOOT_RAW_HOST_DNS_FAILED: $apt_host" >&2
    exit 17
  fi
  printf '%s %s\n' "$host_ip" "$apt_host" >> "$rootfs/etc/hosts"
  echo "MBOOT_RAW_BUILD_MIRROR_RESOLVED: $apt_host"
  if ! chroot "$rootfs" getent ahostsv4 "$apt_host" > /dev/null; then
    echo "MBOOT_RAW_CHROOT_DNS_FAILED: $apt_host" >&2
    exit 18
  fi
done

chroot "$rootfs" /usr/bin/env DEBIAN_FRONTEND=noninteractive \
  apt-get -q update > "$output/apt-update.log" 2>&1 || {
    echo MBOOT_RAW_APT_UPDATE_FAILED >&2
    tail -n 70 "$output/apt-update.log" >&2
    exit 7
  }
# Use the actual Ubuntu package manager on the real build host/chroot.
# No APT networking is needed at boot or for selecting an ISO in m-boot.
chroot "$rootfs" /usr/bin/env DEBIAN_FRONTEND=noninteractive \
  apt-get -q -y --no-install-recommends install \
  systemd-sysv udev linux-image-generic initramfs-tools \
  python3 util-linux kmod e2fsprogs $guest_packages \
  > "$output/apt-install.log" 2>&1 || {
    echo MBOOT_RAW_APT_INSTALL_FAILED >&2
    tail -n 90 "$output/apt-install.log" >&2
    exit 8
  }

# Validate the *installed* Ubuntu initramfs-tools loop= root path.
local_script=$rootfs/usr/share/initramfs-tools/scripts/local
if [ ! -f "$local_script" ] ||
   ! grep -Fq 'LOOP' "$local_script" ||
   ! grep -Fq 'mount -o move' "$local_script"; then
  echo MBOOT_RAW_UBUNTU_NATIVE_LOOP_MISSING >&2
  exit 9
fi
printf 'loop\next4\n' >> "$rootfs/etc/initramfs-tools/modules"
install -m 0755 "$here/launch.py" "$rootfs/usr/local/sbin/mboot-qemu-boot"
install -m 0644 "$here/mboot-qemu-host.service" \
  "$rootfs/etc/systemd/system/mboot-qemu-host.service"
mkdir -p "$rootfs/etc/systemd/system/multi-user.target.wants"
ln -s /etc/systemd/system/mboot-qemu-host.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/mboot-qemu-host.service"
printf '%s\n' mboot-qemu > "$rootfs/etc/hostname"
: > "$rootfs/etc/machine-id"
# The host root is provided by Ubuntu's initramfs loop=; no guest disk in fstab.
printf '# root provided by initramfs-tools loop=\n' > "$rootfs/etc/fstab"

kernel=$(find "$rootfs/boot" -maxdepth 1 -name 'vmlinuz-*-generic' | sort -V | tail -n 1)
if [ -z "$kernel" ] || [ ! -s "$kernel" ]; then
  echo MBOOT_RAW_GUEST_KERNEL_NOT_FOUND >&2
  exit 10
fi
kernel_name=$(basename "$kernel")
release=$(printf '%s\n' "$kernel_name" | sed 's/^vmlinuz-//')
chroot "$rootfs" update-initramfs -u -k "$release" \
  > "$output/update-initramfs.log" 2>&1 || {
    echo MBOOT_RAW_INITRAMFS_FAILED >&2
    tail -n 80 "$output/update-initramfs.log" >&2
    exit 11
  }
initrd=$rootfs/boot/initrd.img-$release
if [ ! -s "$initrd" ]; then
  echo MBOOT_RAW_GUEST_INITRD_NOT_FOUND >&2
  exit 12
fi

cp "$kernel" "$output/vmlinuz"
cp "$initrd" "$output/initrd.img"
printf '%s\n' "$release" > "$output/kernel-release.txt"
lsinitramfs "$output/initrd.img" > "$output/initramfs-contents.txt"
if ! grep -Fq 'scripts/local' "$output/initramfs-contents.txt"; then
  echo MBOOT_RAW_INITRD_LOCAL_MISSING >&2
  exit 13
fi
chroot "$rootfs" dpkg-query -W > "$output/packages.txt"
chroot "$rootfs" apt-get clean
rm -f "$rootfs/usr/sbin/policy-rc.d"
cp "$output/hosts-before-build.txt" "$rootfs/etc/hosts"
# Build-time resolver information must not leak into the deployed filesystem.
rm -f "$rootfs/etc/resolv.conf"
ln -s ../run/systemd/resolve/stub-resolv.conf "$rootfs/etc/resolv.conf"

# The root tree must be free of live mounts before copying into ext4.
umount -R "$rootfs/dev"
mounted_dev=0
umount "$rootfs/sys"
mounted_sys=0
umount "$rootfs/proc"
mounted_proc=0

# mke2fs can populate a new file-backed filesystem directly from a directory:
# no loop block device, GPT, root-partition offset or libguestfs required.
used_mb=$(du -sm "$rootfs" | awk '{print $1}')
raw_mb=$((used_mb + used_mb / 2 + 512))
if [ "$raw_mb" -lt 2048 ]; then
  raw_mb=2048
fi
# Round up to 256 MiB and allocate sparsely.
raw_mb=$(( (raw_mb + 255) / 256 * 256 ))
truncate -s "$(printf '%sM' "$raw_mb")" "$output/mboot-ubuntu-host.raw"
mkfs.ext4 -F -q -d "$rootfs" -L MBOOT_UBUNTU \
  "$output/mboot-ubuntu-host.raw" > "$output/mkfs-ext4.log" 2>&1 || {
    echo MBOOT_RAW_MKFS_FAILED >&2
    tail -n 80 "$output/mkfs-ext4.log" >&2
    exit 14
  }
if [ "$(blkid -p -o value -s TYPE "$output/mboot-ubuntu-host.raw")" != ext4 ]; then
  echo MBOOT_RAW_NOT_EXT4 >&2
  exit 15
fi
e2fsck -fn "$output/mboot-ubuntu-host.raw" > "$output/e2fsck.log" 2>&1 || {
  echo MBOOT_RAW_E2FSCK_FAILED >&2
  tail -n 50 "$output/e2fsck.log" >&2
  exit 16
}
(
  cd "$output"
  sha256sum mboot-ubuntu-host.raw vmlinuz initrd.img > release-SHA256SUMS
)
printf 'source=Ubuntu 24.04 noble debootstrap minbase\narchitecture=%s\nformat=raw-ext4-filesystem\nkernel_release=%s\nraw_size_mib=%s\n' \
  "$architecture" "$release" "$raw_mb" > "$output/provenance.txt"
zstd -T0 -6 -f "$output/mboot-ubuntu-host.raw" \
  -o "$output/mboot-ubuntu-host.raw.zst"
echo "MBOOT_UBUNTU_RAW_BUILT arch=$architecture kernel=$release"
