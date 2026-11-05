#!/bin/sh
# Test fixture only: expected ISO marker/hash and poweroff are NOT middleware.
set -u
export PATH=/bin:/usr/sbin
/bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec </dev/console >/dev/console 2>&1
echo M02_GUEST_INIT_STARTED
failed() {
    echo "M02_GUEST_FAILURE_$1"
    /bin/sh /bin/m02-iso-stage cleanup || :
    /bin/busybox poweroff -f
    exit 50
}
/bin/sh /bin/m02-iso-stage prepare || failed PREPARE
echo M02_GUEST_PREPARE_OK
[ -b /dev/mapper/vt_iso_m02 ] || failed NO_DEVICE
[ "$(/bin/busybox cat /mnt/iso/vt079-marker)" = vt079-uefi-isolated-source ] ||
    failed SOURCE_MARKER
/bin/busybox sha256sum /dev/mapper/vt_iso_m02 > /run/m02/mapped.sha ||
    failed DEVICE_READ
read -r digest rest < /run/m02/mapped.sha
echo "VT_LINUX_ISO_SHA256=$digest"
echo VT_LINUX_ISO_IDENTITY_PASS
echo VT_LINUX_HANDOFF_PASS
echo M02_GUEST_MOUNT_PASS
# Read the existing real C consumer table to locate this disposable guest's
# actual source partition; do not assume vdb/dm-0 or alter source bytes.
IFS=' ' read -r table_start table_length table_kind source_part source_sector < /run/m02/iso-table ||
    failed MISSING_MAP_TABLE
[ "$table_kind" = linear ] && [ -b "$source_part" ] ||
    failed UNEXPECTED_MAP_TABLE
case "$source_part" in
    /dev/vd*[0-9]) source_disk=${source_part%[0-9]} ;;
    *) failed UNSUPPORTED_TEST_SOURCE ;;
esac
[ -b "$source_disk" ] || failed MISSING_SOURCE_DEVICE
/bin/sh /bin/m02-iso-stage cleanup || failed CLEANUP
[ ! -e /dev/mapper/vt_iso_m02 ] || failed MAPPER_LEFT_BEHIND
echo M02_GUEST_CLEANUP_PASS

# Hide ONLY a devtmpfs node for the disposable virtual source (not the
# underlying disk). Other QEMU GPT disks remain visible: consumer must not
# select a different device or create a mapper in its place.
/bin/busybox mv "$source_disk" "$source_disk.m02-hidden" ||
    failed HIDE_WHOLE_SOURCE
if /bin/sh /bin/m02-iso-stage prepare; then
    failed WRONG_SOURCE_FALLBACK_ACCEPTED
fi
/bin/busybox mv "$source_disk.m02-hidden" "$source_disk" ||
    failed RESTORE_WHOLE_SOURCE
[ ! -e /dev/mapper/vt_iso_m02 ] || failed WRONG_SOURCE_MAPPER_LEAK
echo M02_NEGATIVE_MISSING_SOURCE_DEVICE_PASS

# With primary GPT still available, hide its real partition block node.
# C validation succeeds but the real dm-linear backend must refuse creation.
/bin/busybox mv "$source_part" "$source_part.m02-hidden" ||
    failed HIDE_SOURCE_PARTITION
if /bin/sh /bin/m02-iso-stage prepare; then
    failed MISSING_SOURCE_PARTITION_ACCEPTED
fi
/bin/busybox mv "$source_part.m02-hidden" "$source_part" ||
    failed RESTORE_SOURCE_PARTITION
[ ! -e /dev/mapper/vt_iso_m02 ] || failed SOURCE_PARTITION_MAPPER_LEAK
echo M02_NEGATIVE_MISSING_SOURCE_PARTITION_PASS

# Genuine guest negative cases: missing actual consumer and loader manifest.
/bin/busybox mv /bin/map-consumer /bin/map-consumer.saved ||
    failed NEGATIVE_FIXTURE_CONSUMER
if /bin/sh /bin/m02-iso-stage prepare; then
    failed MISSING_CONSUMER_ACCEPTED
fi
/bin/busybox mv /bin/map-consumer.saved /bin/map-consumer ||
    failed NEGATIVE_RESTORE_CONSUMER
[ ! -e /dev/mapper/vt_iso_m02 ] || failed NEGATIVE_CONSUMER_LEAK
echo M02_NEGATIVE_MISSING_CONSUMER_PASS
/bin/busybox rm -f /run/m02/modules-loaded
/bin/busybox mv /modules.load /modules.load.saved ||
    failed NEGATIVE_FIXTURE_MODULES
if /bin/sh /bin/m02-iso-stage prepare; then
    failed MISSING_MODULES_ACCEPTED
fi
/bin/busybox mv /modules.load.saved /modules.load ||
    failed NEGATIVE_RESTORE_MODULES
[ ! -e /dev/mapper/vt_iso_m02 ] || failed NEGATIVE_MODULES_LEAK
echo M02_NEGATIVE_MISSING_MODULES_PASS

# Modules really remain loaded in this guest; avoid re-inserting them during
# later unrelated missing-variable and missing-backend negative paths.
/bin/busybox touch /run/m02/modules-loaded || failed NEGATIVE_MODULE_STATE

# A private tmpfs masks ONLY this guest's efivarfs; no firmware variable,
# host disk or original ISO source is written.
/bin/busybox mount -t tmpfs -o size=64k tmpfs \
    /sys/firmware/efi/efivars || failed EFI_MASK_MOUNT
if /bin/sh /bin/m02-iso-stage prepare; then
    failed ABSENT_EFI_VARIABLE_ACCEPTED
fi
[ ! -e /dev/mapper/vt_iso_m02 ] || failed ABSENT_EFI_MAPPER_LEAK
echo M02_NEGATIVE_MISSING_EFI_VARIABLE_PASS

var=/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e
/bin/busybox printf '\006\000\000\000invalid-map' > "$var" ||
    failed EFI_CORRUPT_FIXTURE
if /bin/sh /bin/m02-iso-stage prepare; then
    failed CORRUPT_EFI_VARIABLE_ACCEPTED
fi
[ ! -e /dev/mapper/vt_iso_m02 ] || failed CORRUPT_EFI_MAPPER_LEAK
echo M02_NEGATIVE_CORRUPT_EFI_VARIABLE_PASS
/bin/busybox umount /sys/firmware/efi/efivars ||
    failed EFI_MASK_UMOUNT
[ -r "$var" ] || failed ORIGINAL_EFI_VARIABLE_NOT_RESTORED

# Real compiled consumer still runs, but missing dmsetup must never mount.
/bin/busybox mv /usr/sbin/dmsetup /usr/sbin/dmsetup.saved ||
    failed DMSETUP_FIXTURE
if /bin/sh /bin/m02-iso-stage prepare; then
    failed MISSING_DMSETUP_ACCEPTED
fi
/bin/busybox mv /usr/sbin/dmsetup.saved /usr/sbin/dmsetup ||
    failed DMSETUP_RESTORE
[ ! -e /dev/mapper/vt_iso_m02 ] || failed DMSETUP_MAPPER_LEAK
echo M02_NEGATIVE_MISSING_DMSETUP_PASS

# The disposable QEMU fixture has a same-size rival GPT disk with a
# distinct GUID. Duplicate its primary header (including its correct CRC)
# only in QEMU -snapshot and require the real consumer to reject ambiguity.
source_leaf=${source_disk#/dev/}
[ -r "/sys/block/$source_leaf/size" ] || failed SOURCE_SIZE_MISSING
source_size=$(/bin/busybox cat "/sys/block/$source_leaf/size")
rival_disk=
rival_count=0
for candidate in /sys/block/vd*/size; do
    [ -f "$candidate" ] || continue
    candidate_leaf=${candidate#/sys/block/}
    candidate_leaf=${candidate_leaf%/size}
    [ "$candidate_leaf" = "$source_leaf" ] && continue
    [ "$(/bin/busybox cat "$candidate")" = "$source_size" ] || continue
    rival_count=$((rival_count + 1))
    rival_disk=/dev/$candidate_leaf
done
[ "$rival_count" -eq 1 ] && [ -b "$rival_disk" ] ||
    failed GPT_RIVAL_NOT_UNIQUE
/bin/busybox dd if="$source_disk" of=/run/m02/source-gpt-header \
    bs=512 skip=1 count=1 >/dev/console 2>&1 ||
    failed GPT_SOURCE_HEADER_READ
/bin/busybox dd if="$rival_disk" of=/run/m02/rival-gpt-header \
    bs=512 skip=1 count=1 >/dev/console 2>&1 ||
    failed GPT_RIVAL_HEADER_READ
/bin/busybox dd if=/run/m02/source-gpt-header of="$rival_disk" \
    bs=512 seek=1 count=1 conv=notrunc >/dev/console 2>&1 ||
    failed GPT_SNAPSHOT_COLLISION_WRITE
if /bin/sh /bin/m02-iso-stage prepare; then
    failed AMBIGUOUS_GPT_DISK_ACCEPTED
fi
/bin/busybox dd if=/run/m02/rival-gpt-header of="$rival_disk" \
    bs=512 seek=1 count=1 conv=notrunc >/dev/console 2>&1 ||
    failed GPT_SNAPSHOT_COLLISION_RESTORE
[ ! -e /dev/mapper/vt_iso_m02 ] || failed AMBIGUOUS_GPT_MAPPER_LEAK
echo M02_NEGATIVE_DUPLICATE_GPT_GUID_PASS

# Deny the actual kernel device-mapper control character node (not simply
# the dmsetup binary). Preserve and restore its original guest device node.
# This proves control ioctl denial, not that dm_mod was unloaded.
[ -c /dev/mapper/control ] || failed MISSING_DM_CONTROL_PREREQUISITE
/bin/busybox mv /dev/mapper/control /dev/mapper/control.m02-saved ||
    failed HIDE_DM_CONTROL
/bin/busybox mkdir /dev/mapper/control || failed BLOCK_DM_CONTROL
if /bin/sh /bin/m02-iso-stage prepare; then
    failed DM_CONTROL_DENIAL_ACCEPTED
fi
/bin/busybox rmdir /dev/mapper/control || failed RESTORE_DM_CONTROL_DIRECTORY
/bin/busybox mv /dev/mapper/control.m02-saved /dev/mapper/control ||
    failed RESTORE_DM_CONTROL
[ ! -e /dev/mapper/vt_iso_m02 ] || failed DM_CONTROL_MAPPER_LEAK
echo M02_NEGATIVE_DM_CONTROL_UNAVAILABLE_PASS

# Map real Linux dm "error" target under the original C consumer's linear
# source path. This makes real guest kernel block I/O return EIO without
# replacing the consumer or touching any backing image/physical disk.
fault_name=m02_fault_source
source_part_leaf=${source_part#/dev/}
[ -r "/sys/class/block/$source_part_leaf/size" ] ||
    failed FAULT_PARTITION_GEOMETRY_MISSING
fault_sectors=$(/bin/busybox cat "/sys/class/block/$source_part_leaf/size")
case "$fault_sectors" in ''|*[!0-9]*) failed FAULT_SECTORS_INVALID ;; esac
[ "$fault_sectors" -gt 0 ] || failed FAULT_SECTORS_EMPTY
/usr/sbin/dmsetup create "$fault_name" --readonly \
    --table "0 $fault_sectors error" || failed DM_ERROR_TARGET_UNAVAILABLE
fault_found=0
fault_sys=
for candidate in /sys/block/dm-*/dm/name; do
    [ -f "$candidate" ] || continue
    [ "$(/bin/busybox cat "$candidate")" = "$fault_name" ] || continue
    fault_found=$((fault_found + 1))
    fault_sys=${candidate%/dm/name}
done
[ "$fault_found" -eq 1 ] && [ -r "$fault_sys/dev" ] ||
    failed FAULT_DM_SYSFS_ID
IFS=: read -r fault_major fault_minor < "$fault_sys/dev" ||
    failed FAULT_DM_NUMBERS
/bin/busybox mv "$source_part" "$source_part.m02-physical" ||
    failed FAULT_SAVE_PARTITION_NODE
/bin/busybox mknod -m 0444 "$source_part" b "$fault_major" "$fault_minor" ||
    failed FAULT_BACKING_NODE
# Direct kernel block read must fail, establishing EIO rather than zero data.
if /bin/busybox dd if="$source_part" of=/dev/null bs=512 count=1 \
    > /run/m02/error-target-read.log 2>&1; then
    failed DM_ERROR_TARGET_READ_ACCEPTED
fi
echo M02_KERNEL_DM_ERROR_READ_REJECTED
# C parser still sees the real GPT; stage must refuse this bad backend.
if /bin/sh /bin/m02-iso-stage prepare; then
    failed DM_ERROR_TARGET_ISO_MOUNT_ACCEPTED
fi
/bin/busybox rm -f "$source_part" || failed FAULT_REMOVE_TARGET_NODE
/bin/busybox mv "$source_part.m02-physical" "$source_part" ||
    failed FAULT_RESTORE_PARTITION_NODE
/usr/sbin/dmsetup remove "$fault_name" || failed FAULT_REMOVE_BACKEND
[ ! -e /dev/mapper/vt_iso_m02 ] || failed DM_ERROR_TARGET_MAPPER_LEAK
echo M02_NEGATIVE_DM_ERROR_EIO_PASS

# Corrupt ONLY the temporary QEMU -snapshot view of the disposable ISO
# partition, at the mapped ISO9660 primary-volume-descriptor offset.
# Original host ISO and GPT backing images remain byte-identical.
case "$source_sector" in
    ''|*[!0-9]*) failed INVALID_SOURCE_SECTOR ;;
esac
pvd_offset=$((source_sector + 64))
magic_offset=$((pvd_offset * 512 + 1))
/bin/busybox dd if="$source_part" of=/run/m02/pvd-magic \
    bs=1 skip="$magic_offset" count=5 >/dev/console 2>&1 ||
    failed NEGATIVE_PVD_OFFSET_READ
[ "$(/bin/busybox cat /run/m02/pvd-magic)" = CD001 ] ||
    failed NEGATIVE_PVD_OFFSET_WRONG
# Invalidate the PVD and all subsequent supplementary/terminator
# descriptors; one corrupt PVD alone can leave a mountable ISO descriptor.
/bin/busybox dd if=/dev/zero of="$source_part" bs=512 count=64 \
    seek="$pvd_offset" conv=notrunc >/dev/console 2>&1 ||
    failed NEGATIVE_SNAPSHOT_WRITE
/bin/busybox dd if="$source_part" of=/run/m02/pvd-after \
    bs=1 skip="$magic_offset" count=5 >/dev/console 2>&1 ||
    failed NEGATIVE_SNAPSHOT_VERIFY
[ "$(/bin/busybox cat /run/m02/pvd-after)" != CD001 ] ||
    failed NEGATIVE_SNAPSHOT_UNCHANGED
if /bin/sh /bin/m02-iso-stage prepare; then
    failed INVALID_ISO9660_MOUNT_ACCEPTED
fi
[ ! -e /dev/mapper/vt_iso_m02 ] || failed INVALID_ISO9660_MAPPER_LEAK
echo M02_NEGATIVE_ISO9660_MOUNT_ERROR_PASS

# Genuine guest-kernel source loss: unbind ONLY the selected disposable
# virtio-blk disk from its running driver, then re-run the actual consumer.
# Not physical USB/media removal or QMP device_del. No rebinding is needed:
# this test runs LAST and QEMU uses -snapshot for all disks.
source_driver_path=$(/bin/busybox readlink -f "/sys/block/$source_leaf/device") ||
    failed SOURCE_DRIVER_PATH
source_virtio=${source_driver_path##*/}
case "$source_virtio" in
    virtio[0-9]*) ;;
    *) failed SOURCE_DRIVER_IDENTITY ;;
esac
[ -w /sys/bus/virtio/drivers/virtio_blk/unbind ] ||
    failed SOURCE_VIRTIO_UNBIND_UNSUPPORTED
[ -b "$source_disk" ] || failed SOURCE_PRE_UNBIND_MISSING
/bin/busybox printf '%s\n' "$source_virtio" \
    > /sys/bus/virtio/drivers/virtio_blk/unbind ||
    failed SOURCE_VIRTIO_UNBIND
[ ! -e "/sys/block/$source_leaf" ] ||
    failed SOURCE_SYSFS_STILL_PRESENT
if /bin/sh /bin/m02-iso-stage prepare; then
    failed SOURCE_KERNEL_UNBIND_ACCEPTED
fi
[ ! -e /dev/mapper/vt_iso_m02 ] ||
    failed SOURCE_KERNEL_UNBIND_MAPPER_LEAK
echo M02_NEGATIVE_KERNEL_SOURCE_UNBIND_PASS

echo M02_GUEST_TEST_PASS
/bin/busybox poweroff -f
/bin/busybox sleep 3
exit 1
