#!/bin/bash
# Build a small bootable ISO only for nested QEMU optical recognition tests.
# The Linux kernel/initramfs come from the *same* previously validated Ubuntu
# bundle. Unpack/repack a disposable copy; never mutate the source bundle.
set -euo pipefail
umask 077
if [[ $# -ne 4 || ! -s $1 || ! -s $2 || -e $3 ]]; then
  echo 'usage: make-bootable-guest-iso.sh KERNEL INITRD NEW_ISO ARCH' >&2
  exit 2
fi
case "$4" in
  amd64) serial=ttyS0 ;;
  arm64) serial=ttyAMA0 ;;
  *) echo MBOOT_GUEST_UNSUPPORTED_ARCH >&2; exit 3 ;;
esac
for tool in unmkinitramfs grub-mkrescue gzip cpio find; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "MBOOT_GUEST_MISSING_TOOL: $tool" >&2
    exit 4
  }
done

outdir=$(dirname -- "$3")
mkdir -p "$outdir"
work=$(mktemp -d "$outdir/.inner-guest.XXXXXXXX")
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

unmkinitramfs "$2" "$work/initramfs-unpack"
main="$work/initramfs-unpack/main"
if [[ ! -f "$main/init" ]]; then
  echo MBOOT_GUEST_UBUNTU_INITRD_NOT_UNPACKED >&2
  exit 5
fi

# Use the real Ubuntu initramfs modules and utilities but a tiny fixture
# /init which observes the guest's kernel and actual virtual block devices.
cat > "$main/init" <<'EOF'
#!/bin/sh
PATH=/sbin:/bin:/usr/sbin:/usr/bin
export PATH
mkdir -p /dev /proc /sys
if ! mount -t devtmpfs devtmpfs /dev; then
  echo MBOOT_INNER_GUEST_DEVTMPFS_MOUNT_FAILED
  exit 30
fi
exec >/dev/console 2>&1
echo MBOOT_INNER_GUEST_KERNEL_BOOTED
if ! mount -t proc proc /proc; then
  echo MBOOT_INNER_GUEST_PROC_MOUNT_FAILED
  exit 31
fi
if ! mount -t sysfs sysfs /sys; then
  echo MBOOT_INNER_GUEST_SYSFS_MOUNT_FAILED
  ls -ld /sys
  exit 32
fi
echo MBOOT_INNER_GUEST_SYSFS_MOUNTED
for driver in virtio_pci virtio_blk virtio_scsi scsi_mod sd_mod \
              sr_mod cdrom ahci ata_piix; do
  echo "MBOOT_INNER_GUEST_MODPROBE_BEGIN driver=$driver"
  modprobe "$driver" >/dev/null 2>&1 || :
  echo "MBOOT_INNER_GUEST_MODPROBE_END driver=$driver"
done

echo MBOOT_INNER_GUEST_BLOCK_SCAN_BEGIN
ls -la /sys/class/block 2>/dev/null || :
echo MBOOT_INNER_GUEST_BLOCK_SCAN_END

found_cd=no
found_disk=no
n=0
while [ "$n" -lt 15 ]; do
  for dev in /sys/class/block/sr*; do
    if [ -e "$dev" ]; then found_cd=yes; fi
  done
  for dev in /sys/class/block/vd*; do
    if [ -e "$dev" ]; then found_disk=yes; fi
  done
  if [ "$found_cd" = yes ] && [ "$found_disk" = yes ]; then
    echo MBOOT_INNER_GUEST_OPTICAL_PRESENT
    echo MBOOT_INNER_GUEST_DISK_PRESENT
    echo MBOOT_INNER_GUEST_INSPECTION_PASS
    while :; do sleep 3600; done
  fi
  sleep 1
  n=$((n + 1))
done
echo "MBOOT_INNER_GUEST_INSPECTION_FAILED cd=$found_cd disk=$found_disk"
echo MBOOT_INNER_GUEST_BLOCK_CLASS_BEGIN
ls -la /sys/class/block 2>/dev/null || :
echo MBOOT_INNER_GUEST_BLOCK_CLASS_END
while :; do sleep 3600; done
EOF
chmod 0755 "$main/init"

mkdir -p "$work/guest-iso/boot/grub"
cp -- "$1" "$work/guest-iso/boot/vmlinuz"
(
  cd "$main"
  find . -print0 | cpio --null --quiet -o -H newc | gzip -1
) > "$work/guest-iso/boot/initrd.img"

cat > "$work/guest-iso/boot/grub/grub.cfg" <<EOF
set default=0
set timeout=0
if [ "\$grub_cpu" = "x86_64" ]; then
  serial --unit=0 --speed=115200
  terminal_output serial
fi
menuentry 'm-boot actual guest Linux optical fixture' {
  linux /boot/vmlinuz console=tty0 console=$serial rdinit=/init
  initrd /boot/initrd.img
}
EOF
grub-mkrescue -o "$3" "$work/guest-iso" \
  > "$outdir/guest-grub-mkrescue.log" 2>&1 || {
    echo MBOOT_GUEST_ISO_BUILD_FAILED >&2
    tail -n 80 "$outdir/guest-grub-mkrescue.log" >&2
    exit 6
  }
echo MBOOT_GUEST_BOOTABLE_ISO_BUILT
