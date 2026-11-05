#!/bin/sh
# K-03 only: synthetic Linux initramfs observer for a real QEMU optical CD.
# Runs in the guest after the original ISO EFI GRUB boots its Linux kernel.
set -u
b=/bin/busybox
$b mount -t devtmpfs devtmpfs /dev || :
exec </dev/console >/dev/console 2>&1
echo K03_GUEST_INIT_STARTED
fail() {
  echo "K03_GUEST_FAIL_$1"
  $b poweroff -f
  $b sleep 3
  exit 1
}
$b mount -t proc proc /proc || fail PROC
$b mount -t sysfs sysfs /sys || fail SYSFS
$b mkdir -p /mnt/iso || fail MOUNTPOINT
echo "K03_GUEST_KERNEL=$($b uname -r)"
# Genuine kernel module dependency closure from the same installed kernel
# build; the host fixture only packages files, it does not emulate Linux IO.
/bin/sh /modules.load || fail MODULES
$b mdev -s || fail DEVICE_NODES
[ -b /dev/sr0 ] || fail NO_SR0
[ -r /sys/class/block/sr0/ro ] || fail SYSFS_CD
[ "$($b cat /sys/class/block/sr0/ro)" = 1 ] || fail CD_NOT_READONLY
echo K03_GUEST_CD_READONLY_PASS
if [ -r /sys/class/block/sr0/device/model ]; then
  echo "K03_GUEST_CD_MODEL=$($b cat /sys/class/block/sr0/device/model)"
fi
echo K03_GUEST_DEVICE=/dev/sr0
$b mount -t iso9660 -o ro /dev/sr0 /mnt/iso || fail CD_ISO9660_MOUNT
[ "$($b cat /mnt/iso/vt079-marker)" = vt079-uefi-isolated-source ] ||
  fail WRONG_ISO_MARKER
echo K03_GUEST_ISO_MARKER_PASS
# The optical block device's whole contents must match the host ISO.
digest=$($b sha256sum /dev/sr0 | $b awk '{print $1}') || fail DEVICE_HASH
case "$digest" in
  *[!0123456789abcdef]*|'') fail INVALID_HASH ;;
esac
[ "$(printf '%s' "$digest" | $b wc -c)" -eq 64 ] || fail INVALID_HASH_LENGTH
echo "K03_GUEST_CD_SHA256=$digest"
echo K03_GUEST_POST_KERNEL_CD_PASS
$b umount /mnt/iso || fail UMOUNT
echo K03_GUEST_TEST_PASS
$b poweroff -f
$b sleep 3
exit 1
