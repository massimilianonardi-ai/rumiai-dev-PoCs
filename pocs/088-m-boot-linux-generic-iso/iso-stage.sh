#!/bin/sh
# Guest-private M-02 ISO reconstruction stage; original C consumer unchanged.
set -u
name=vt_iso_m02
target=/mnt/iso
table=/run/m02/iso-table

cleanup() {
    /bin/busybox umount "$target" 2>/dev/null || :
    /usr/sbin/dmsetup remove "$name" >/dev/null 2>&1 || :
    /bin/busybox rm -f "/dev/mapper/$name" "$table"
}
fail() {
    printf 'M02_ERROR_%s\n' "$1" >&2
    cleanup
    exit "$2"
}
if [ "$#" -ne 1 ]; then
    echo M02_ERROR_USAGE >&2
    exit 2
fi
case "$1" in
    cleanup)
        cleanup
        echo M02_GENERIC_CLEANUP_DONE
        exit 0
        ;;
    prepare) ;;
    *)
        echo M02_ERROR_USAGE >&2
        exit 2
        ;;
esac

# Refuse pre-existing device instead of deleting another owner's mapper.
for candidate in /sys/block/dm-*/dm/name; do
    [ -f "$candidate" ] || continue
    if [ "$(/bin/busybox cat "$candidate")" = "$name" ]; then
        echo M02_ERROR_EXISTING_MAPPER >&2
        exit 3
    fi
done
/bin/busybox mkdir -p /proc /sys /dev /run/m02 /dev/mapper \
    /sys/firmware/efi/efivars "$target" || fail DIRECTORIES 4
[ -r /proc/self/stat ] ||
    /bin/busybox mount -t proc proc /proc || fail PROC 5
[ -d /sys/class/block ] ||
    /bin/busybox mount -t sysfs sysfs /sys || fail SYSFS 6
[ -c /dev/null ] ||
    /bin/busybox mount -t devtmpfs devtmpfs /dev || fail DEVTMPFS 7
# Sysfs/devtmpfs may have hidden the early initramfs directory entries.
/bin/busybox mkdir -p /sys/firmware/efi/efivars /dev/mapper ||
    fail RUNTIME_DIRECTORIES 20
# Subsequent fixture attempts share the same kernel; do not insmod twice.
if [ ! -f /run/m02/modules-loaded ]; then
    /bin/sh /modules.load || fail MODULES 8
    /bin/busybox touch /run/m02/modules-loaded || fail MODULE_STATE 19
fi
/bin/busybox grep -q ' /sys/firmware/efi/efivars ' /proc/mounts ||
    /bin/busybox mount -t efivarfs efivarfs /sys/firmware/efi/efivars ||
    fail EFIVARFS 9

# Never consume the partial table a failed C parser may have produced.
/bin/busybox rm -f "$table"
/bin/map-consumer "$table" || fail CONSUMER 10
[ -s "$table" ] || fail EMPTY_TABLE 11
echo M02_GENERIC_MAP_OK
/usr/sbin/dmsetup create "$name" --readonly \
    --table "$(/bin/busybox cat "$table")" || fail DM_CREATE 12
echo M02_GENERIC_DM_CREATED

found=0
device=
for candidate in /sys/block/dm-*/dm/name; do
    [ -f "$candidate" ] || continue
    [ "$(/bin/busybox cat "$candidate")" = "$name" ] || continue
    found=$((found + 1))
    device=${candidate%/dm/name}
done
[ "$found" -eq 1 ] && [ -n "$device" ] || fail DM_IDENTITY 13
[ "$(/bin/busybox cat "$device/ro")" = 1 ] || fail DM_NOT_READONLY 14
if [ ! -b "/dev/mapper/$name" ]; then
    IFS=: read -r major minor < "$device/dev" || fail DM_NUMBERS 15
    /bin/busybox mknod -m 0444 "/dev/mapper/$name" b "$major" "$minor" ||
        fail DM_MKNOD 16
fi
[ -b "/dev/mapper/$name" ] || fail DM_DEVICE 17
echo M02_GENERIC_DEVICE_READY
/bin/busybox mount -t iso9660 -o ro "/dev/mapper/$name" "$target" ||
    fail ISO9660_MOUNT 18
echo "M02_GENERIC_MOUNT_PASS mapper=/dev/mapper/$name mount=$target"
