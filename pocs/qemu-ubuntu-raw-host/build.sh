#!/bin/sh
# Build a disposable Ubuntu Minimal host RAW disk; never writes a real disk.
set -eu
umask 077
[ "$#" -eq 1 ] && [ ! -e "$1" ] || {
  echo 'usage: build.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 2
}
for cmd in curl qemu-img virt-resize virt-customize virt-copy-out sha256sum grep awk zstd lsinitramfs; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "MBOOT_RAW_MISSING_TOOL: $cmd" >&2
    exit 3
  }
done
case "$(uname -m)" in
  x86_64) architecture=amd64; packages=qemu-system-x86,ovmf,python3,util-linux,initramfs-tools,kmod,linux-image-generic ;;
  aarch64) architecture=arm64; packages=qemu-system-arm,qemu-efi-aarch64,python3,util-linux,initramfs-tools,kmod,linux-image-generic ;;
  *) echo 'MBOOT_RAW_UNSUPPORTED_HOST_ARCH' >&2; exit 4 ;;
esac
here=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
mkdir -p "$1"
output=$(CDPATH= cd "$1" && pwd -P)
base=https://cloud-images.ubuntu.com/minimal/releases/noble/release-20261103
name=ubuntu-24.04-minimal-cloudimg-$architecture.img
curl -fL --retry 3 --silent --show-error "$base/SHA256SUMS" \
  -o "$output/SHA256SUMS"
curl -fL --retry 3 --silent --show-error "$base/$name" \
  -o "$output/$name"
(
  cd "$output"
  awk -v name="$name" '
    {
      if ($2==name || $2=="*" name || $2=="./" name || $2=="*./" name) {
        print $1 "  " name
        found=1
      }
    }
    END { if (!found) exit 1 }
  ' SHA256SUMS > source-verify.txt || {
    echo 'MBOOT_RAW_SOURCE_NOT_IN_OFFICIAL_SHA256SUMS' >&2
    grep "$architecture" SHA256SUMS >&2 || :
    exit 5
  }
  sha256sum -c source-verify.txt
)
qemu-img info -f qcow2 "$output/$name" > "$output/source-qcow2-info.txt"
qemu-img create -f qcow2 "$output/expanded.qcow2" 8G
# Published Ubuntu Minimal UEFI/GPT images use sda1 as the root filesystem.
# Verify this separately before depending on it for GRUB looproot boot.
# GitHub Actions' running Azure kernel may be unreadable to the unprivileged
# libguestfs builder. Use the installed Ubuntu generic kernel/modules explicitly.
generic_kernel=$(find /boot -maxdepth 1 -name 'vmlinuz-*-generic' | sort -V | tail -n 1)
[ -n "$generic_kernel" ] && [ -s "$generic_kernel" ] || {
  echo MBOOT_RAW_SUPERMIN_GENERIC_KERNEL_MISSING >&2
  exit 8
}
generic_release=${generic_kernel##*/vmlinuz-}
# The CI owner-protected vmlinuz may exist without being readable by supermin.
if [ ! -r "$generic_kernel" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo MBOOT_RAW_SUPERMIN_KERNEL_UNREADABLE >&2
    exit 11
  fi
  sudo -n install -m 0644 "$generic_kernel" "$output/supermin-vmlinuz"
  generic_kernel="$output/supermin-vmlinuz"
fi
[ -r "$generic_kernel" ] || exit 11
[ -d "/lib/modules/$generic_release" ] || {
  echo MBOOT_RAW_SUPERMIN_GENERIC_MODULES_MISSING >&2
  exit 9
}
export SUPERMIN_KERNEL="$generic_kernel"
export SUPERMIN_MODULES="/lib/modules/$generic_release"
export SUPERMIN_KERNEL_VERSION="$generic_release"
LIBGUESTFS_DEBUG=1 LIBGUESTFS_TRACE=1 LIBGUESTFS_BACKEND=direct virt-resize --expand /dev/sda1 "$output/$name" \
  "$output/expanded.qcow2" > "$output/virt-resize.log" 2>&1 || {
    echo MBOOT_RAW_RESIZE_FAILED >&2
    tail -n 100 "$output/virt-resize.log" >&2
    exit 7
  }
# Customize only the NEW disposable guest image, never the Canonical original.
LIBGUESTFS_BACKEND=direct virt-customize \
  --format qcow2 -a "$output/expanded.qcow2" \
  --install "$packages" \
  --mkdir /etc/initramfs-tools/scripts/local-top \
  --mkdir /etc/initramfs-tools/scripts/local-bottom \
  --mkdir /etc/initramfs-tools/hooks \
  --mkdir /host \
  --upload "$here/mboot-raw-root:/etc/initramfs-tools/scripts/local-top/mboot-raw-root" \
  --upload "$here/mboot-raw-keep-host:/etc/initramfs-tools/scripts/local-bottom/mboot-raw-keep-host" \
  --upload "$here/mboot-raw-initramfs-hook:/etc/initramfs-tools/hooks/mboot-raw-root" \
  --upload "$here/launch.py:/usr/local/sbin/mboot-qemu-boot" \
  --upload "$here/mboot-qemu-host.service:/etc/systemd/system/mboot-qemu-host.service" \
  --run-command 'chmod 0755 /usr/local/sbin/mboot-qemu-boot' \
  --run-command 'chmod 0755 /etc/initramfs-tools/scripts/local-top/mboot-raw-root /etc/initramfs-tools/scripts/local-bottom/mboot-raw-keep-host /etc/initramfs-tools/hooks/mboot-raw-root' \
  --run-command 'update-initramfs -u -k all' \
  --run-command 'mkdir -p /etc/systemd/system/multi-user.target.wants' \
  --run-command 'ln -sfn /etc/systemd/system/mboot-qemu-host.service /etc/systemd/system/multi-user.target.wants/mboot-qemu-host.service' \
  --run-command 'touch /etc/cloud/cloud-init.disabled' \
  > "$output/virt-customize.log" 2>&1 || {
    tail -n 80 "$output/virt-customize.log" >&2
    exit 6
  }
qemu-img convert -p -f qcow2 -O raw \
  "$output/expanded.qcow2" "$output/mboot-ubuntu-host.raw" \
  > "$output/convert.log" 2>&1
qemu-img info -f raw "$output/mboot-ubuntu-host.raw" \
  > "$output/raw-info.txt"
sha256sum "$output/mboot-ubuntu-host.raw" > "$output/raw-sha256.txt"
# Export a matching kernel/initramfs from the *customized* Ubuntu guest.
# GRUB reads these sidecars from MBOOTDATA directly: it does not parse GPT RAW.
# The release must be handled as a single atomic, architecture-specific bundle.
mkdir -p "$output/boot-export"
LIBGUESTFS_BACKEND=direct virt-copy-out -a "$output/expanded.qcow2" \
  /boot "$output/boot-export" > "$output/boot-export.log" 2>&1 || {
    echo MBOOT_RAW_BOOT_EXPORT_FAILED >&2
    tail -n 60 "$output/boot-export.log" >&2
    exit 12
  }
kernel=$(find "$output/boot-export/boot" -maxdepth 1 \
  -type f -name 'vmlinuz-*-generic' | sort -V | tail -n 1)
[ -n "$kernel" ] && [ -s "$kernel" ] || {
  echo MBOOT_RAW_GUEST_KERNEL_NOT_FOUND >&2
  exit 13
}
release=${kernel##*/vmlinuz-}
initrd="$output/boot-export/boot/initrd.img-$release"
[ -s "$initrd" ] || {
  echo "MBOOT_RAW_MATCHING_INITRD_NOT_FOUND: $release" >&2
  exit 14
}
cp "$kernel" "$output/vmlinuz"
cp "$initrd" "$output/initrd.img"
lsinitramfs "$output/initrd.img" > "$output/initramfs-contents.txt"
for required in scripts/local-top/mboot-raw-root \
                scripts/local-bottom/mboot-raw-keep-host; do
  grep -Fq "$required" "$output/initramfs-contents.txt" || {
    echo "MBOOT_RAW_INITRD_MISSING: $required" >&2
    exit 15
  }
done
printf '%s\n' "$release" > "$output/kernel-release.txt"
(
  cd "$output"
  sha256sum mboot-ubuntu-host.raw vmlinuz initrd.img > release-SHA256SUMS
)
echo "MBOOT_RAW_EXTERNAL_BOOT_MATCH=$release"

printf 'source_release=Ubuntu Minimal 24.04 20261103\narchitecture=%s\nformat=raw\n' \
  "$architecture" > "$output/provenance.txt"
# The uncompressed artifact remains a genuinely raw full disk image.
zstd -T0 -4 -f "$output/mboot-ubuntu-host.raw" \
  -o "$output/mboot-ubuntu-host.raw.zst"
echo "MBOOT_UBUNTU_RAW_BUILT arch=$architecture"
