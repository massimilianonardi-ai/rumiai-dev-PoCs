#!/bin/sh
# M-03 synthetic early-Linux middleware. The original next-stage /init is
# independently authored in original-init.sh; this process must exec it.
set -u
export PATH=/bin:/usr/sbin
/bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec </dev/console >/dev/console 2>&1
echo M03_MIDDLEWARE_INIT_ENTERED
# Backward-compatible PoC 079 fixture marker: the overlay /init really ran.
echo VT079_LINUX_INITRAMFS_OVERLAY

fail() {
    echo "M03_MIDDLEWARE_ERROR_$1"
    /bin/sh /bin/m02-iso-stage cleanup || :
    /bin/busybox poweroff -f
    exit 50
}
no_stage_mapper() {
    [ ! -e /dev/mapper/vt_iso_m02 ] || fail "$1_MAPPER_NODE_LEAK"
    if /bin/busybox grep -q ' /mnt/iso ' /proc/mounts; then
        fail "$1_ISO_MOUNT_LEAK"
    fi
    for named in /sys/block/dm-*/dm/name; do
        [ -f "$named" ] || continue
        [ "$(/bin/busybox cat "$named")" = vt_iso_m02 ] ||
            continue
        fail "$1_KERNEL_MAPPER_LEAK"
    done
}
[ -r /original-root/init ] || fail ORIGINAL_INIT_MISSING
[ -x /original-root/init ] || fail ORIGINAL_INIT_NOT_EXECUTABLE

# Establish source identity through the actual M-02 stage, not test-side GPT
# guesses. Teardown before independently testing source disappearance.
echo M03_MIDDLEWARE_PREPARE_INITIAL
/bin/sh /bin/m02-iso-stage prepare || fail INITIAL_PREPARE
[ -s /run/m02/iso-table ] || fail INITIAL_TABLE_MISSING
IFS=' ' read -r map_start map_len map_kind source_part source_offset \
    < /run/m02/iso-table || fail TABLE_READ
[ "$map_kind" = linear ] && [ -b "$source_part" ] ||
    fail TABLE_SOURCE_NOT_BLOCK
case "$source_part" in
    /dev/vd*[0-9]) source_disk=${source_part%[0-9]} ;;
    *) fail UNSUPPORTED_DISPOSABLE_SOURCE ;;
esac
[ -b "$source_disk" ] || fail SOURCE_WHOLE_DISK_MISSING
/bin/sh /bin/m02-iso-stage cleanup || fail INITIAL_CLEANUP
no_stage_mapper INITIAL_CLEANUP
echo M03_MIDDLEWARE_BASELINE_STAGE_PASS

# Negative 1: no next-stage /init on genuine source identity loss. Only
# hide a guest devtmpfs name; preserve the disposable QEMU disk unchanged.
/bin/busybox mv "$source_disk" "$source_disk.m03-hidden" ||
    fail HIDE_SOURCE_NODE
if /bin/sh /bin/m02-iso-stage prepare; then
    fail MISSING_SOURCE_ACCEPTED
fi
/bin/busybox mv "$source_disk.m03-hidden" "$source_disk" ||
    fail RESTORE_SOURCE_NODE
no_stage_mapper MISSING_SOURCE
echo M03_NEGATIVE_MISSING_SOURCE_NO_HANDOFF_PASS

# Negative 2: bad C-consumer EFI map data in a guest-only tmpfs overlay.
# Original OVMF efivarfs is not written and is restored before handoff.
/bin/busybox mount -t tmpfs -o size=64k tmpfs \
    /sys/firmware/efi/efivars || fail EFI_MASK_MOUNT
var=/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e
/bin/busybox printf '\006\000\000\000invalid-map' > "$var" ||
    fail BAD_MAP_FIXTURE_WRITE
if /bin/sh /bin/m02-iso-stage prepare; then
    fail BAD_MAP_ACCEPTED
fi
no_stage_mapper BAD_MAP
/bin/busybox umount /sys/firmware/efi/efivars || fail EFI_MASK_UMOUNT
[ -r "$var" ] || fail ORIGINAL_EFI_MAP_NOT_RESTORED
echo M03_NEGATIVE_CORRUPT_MAP_NO_HANDOFF_PASS

# Successful stage remains mounted; this script MUST NOT hash the mapped
# ISO or emit the next-stage marker. Independent original /init owns that.
echo M03_MIDDLEWARE_PREPARE_FOR_HANDOFF
/bin/sh /bin/m02-iso-stage prepare || fail FINAL_PREPARE
[ -b /dev/mapper/vt_iso_m02 ] || fail FINAL_MAPPED_DEVICE_MISSING
/bin/busybox grep -q ' /mnt/iso iso9660 ' /proc/mounts ||
    fail FINAL_ISO_MOUNT_MISSING
echo M03_MIDDLEWARE_HANDOFF_READY
echo M03_MIDDLEWARE_EXEC_ORIGINAL_INIT
exec /bin/sh /original-root/init
echo M03_MIDDLEWARE_ERROR_EXEC_RETURNED
/bin/busybox poweroff -f
exit 51
