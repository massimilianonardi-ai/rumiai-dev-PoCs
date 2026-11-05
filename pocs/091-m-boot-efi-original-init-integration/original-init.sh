#!/bin/sh
# Independently authored synthetic original ISO /init for M-04.
# This very same source is embedded as the original ISO initrd hook before
# the EFI sidecar exists, and retained byte-for-byte for later exec handoff.
# No C consumer or middleware invocation; NOT a vendor installer init.
set -u
export PATH=/bin:/usr/sbin
# Real original ISO boot has no preceding middleware. Bootstrap its own
# process, sysfs and devtmpfs mounts; if already mounted, preserve them.
[ -r /proc/self/stat ] || /bin/busybox mount -t proc proc /proc || :
[ -d /sys/class/block ] || /bin/busybox mount -t sysfs sysfs /sys || :
[ -c /dev/console ] || /bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec </dev/console >/dev/console 2>&1
echo M04_ORIGINAL_ISO_INIT_ENTERED
echo M03_ORIGINAL_INIT_ENTERED

failure() {
    echo "M03_ORIGINAL_ERROR_$1"
    /bin/sh /bin/m02-iso-stage cleanup || :
    /bin/busybox poweroff -f
    exit 60
}

[ -r /proc/self/stat ] || failure PROC_MISSING
read -r pid remainder < /proc/self/stat || failure PROC_PID_READ
[ "$pid" = 1 ] || failure NOT_PID_ONE
echo M03_ORIGINAL_PID_ONE_PASS
[ -r /sys/class/block ] || failure SYSFS_UNAVAILABLE
[ -c /dev/null ] && [ -c /dev/console ] ||
    failure DEVTMPFS_CONSOLE_UNAVAILABLE
/bin/busybox grep -q ' /dev devtmpfs ' /proc/mounts ||
    failure DEVTMPFS_MOUNT_MISSING

# Inspect the inherited mount namespace independently. Do NOT assume dm-0,
# a device-mapper numeric major, or a table path from the middleware.
mounted=0
source_device=
for entry in /proc/mounts; do
    [ -r "$entry" ] || failure MOUNT_TABLE_MISSING
    while read -r device where fs opts rest; do
        [ "$where" = /mnt/iso ] || continue
        [ "$fs" = iso9660 ] || failure WRONG_FS_TYPE
        case ",$opts," in
            *,ro,* ) ;;
            *) failure ISO_NOT_READONLY ;;
        esac
        source_device=$device
        mounted=$((mounted + 1))
    done < "$entry"
done
[ "$mounted" -eq 1 ] || failure ISO_MOUNT_NOT_UNIQUE
[ -b "$source_device" ] || failure SOURCE_NOT_BLOCK
case "$source_device" in
    /dev/mapper/*) ;;
    *) failure SOURCE_NOT_NAMED_MAPPER ;;
esac
mapper_name=${source_device##*/}
found=0
for named in /sys/block/dm-*/dm/name; do
    [ -f "$named" ] || continue
    [ "$(/bin/busybox cat "$named")" = "$mapper_name" ] || continue
    [ "$(/bin/busybox cat "${named%/dm/name}/ro")" = 1 ] ||
        failure MAPPER_KERNEL_NOT_READONLY
    found=$((found + 1))
done
[ "$found" -eq 1 ] || failure MAPPER_KERNEL_NAME_NOT_UNIQUE
echo "M03_ORIGINAL_MOUNT_SOURCE=$source_device"
echo M03_ORIGINAL_MOUNT_NAMESPACE_PASS

# This original next-stage init reads BOTH the mounted ISO file and all ISO
# bytes through the inherited read-only block device, independently of the
# middleware. The CI oracle compares this digest with the untouched host ISO.
[ "$(/bin/busybox cat /mnt/iso/vt079-marker)" = \
    vt079-uefi-isolated-source ] || failure ISO_MARKER_MISMATCH
/bin/busybox sha256sum "$source_device" \
    > /run/m03-original-mapped.sha || failure ORIGINAL_BLOCK_READ
read -r digest unused < /run/m03-original-mapped.sha ||
    failure ORIGINAL_DIGEST_READ
case "$digest" in
    ????????* ) ;;
    *) failure ORIGINAL_DIGEST_EMPTY ;;
esac
echo "M03_ORIGINAL_ISO_SHA256=$digest"
# Legacy PoC 081 oracle requires these values. They are emitted ONLY by
# this independent original next-stage init after its own successful read.
echo "VT_LINUX_ISO_SHA256=$digest"
echo VT_LINUX_ISO_IDENTITY_PASS
echo VT_LINUX_HANDOFF_PASS
echo M03_ORIGINAL_MEDIA_READ_PASS

# The original init owns post-read cleanup; it happens AFTER the handoff
# and full independent read, never prematurely in the middleware.
/bin/sh /bin/m02-iso-stage cleanup || failure STAGE_CLEANUP
[ ! -e "$source_device" ] || failure MAPPER_NODE_NOT_REMOVED
if /bin/busybox grep -q ' /mnt/iso ' /proc/mounts; then
    failure ISO_STILL_MOUNTED
fi
echo M03_ORIGINAL_CLEANUP_PASS
echo M03_ORIGINAL_NEXT_STAGE_PASS
/bin/busybox poweroff -f
/bin/busybox sleep 3
exit 61
