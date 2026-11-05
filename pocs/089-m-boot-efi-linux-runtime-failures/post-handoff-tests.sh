#!/bin/sh
# Guest-only F-04 failure tests, appended after the actual firmware→Linux
# read-only dm-linear ISO mount and complete ISO SHA256 verification.
# Requires QEMU -snapshot; never touches host physical devices.
set -u
export PATH=/bin:/usr/sbin
fail() {
    echo "F04_GUEST_FAILURE_$1"
    /bin/busybox poweroff -f
    exit 50
}
no_mapper() {
    [ ! -e /dev/mapper/vt_iso_poc ] || fail "$1_OLD_MAPPER_NODE"
    [ ! -e /dev/mapper/vt_iso_f04 ] || fail "$1_TEST_MAPPER_NODE"
    if /bin/busybox grep -q ' /mnt/iso ' /proc/mounts; then
        fail "$1_ISO_STILL_MOUNTED"
    fi
    for name_file in /sys/block/dm-*/dm/name; do
        [ -f "$name_file" ] || continue
        name=$(/bin/busybox cat "$name_file")
        case "$name" in
            vt_iso_poc|vt_iso_f04) fail "$1_DM_KERNEL_LEAK" ;;
        esac
    done
}
refuse_consumer() {
    case_name=$1
    diagnostic=$2
    /bin/busybox rm -f /run/f04-table /run/f04-output
    if /bin/map-consumer /run/f04-table >/run/f04-output 2>&1; then
        fail "${case_name}_ACCEPTED"
    fi
    [ ! -e /run/f04-table ] || fail "${case_name}_PARTIAL_TABLE"
    /bin/busybox grep -F "$diagnostic" /run/f04-output >/dev/null ||
        fail "${case_name}_UNEXPECTED_DIAGNOSTIC"
    no_mapper "$case_name"
    echo "F04_NEGATIVE_${case_name}_PASS"
}
restore_var() {
    /bin/busybox cp /run/f04-original-efi-var "$var" ||
        fail EFI_VAR_RESTORE_BYTES
}
[ -b /dev/mapper/vt_iso_poc ] || fail BASELINE_DM_MISSING
[ -s /run/iso-table ] || fail BASELINE_TABLE_MISSING
found=0
for name_file in /sys/block/dm-*/dm/name; do
    [ -f "$name_file" ] || continue
    [ "$(/bin/busybox cat "$name_file")" = vt_iso_poc ] || continue
    [ "$(/bin/busybox cat "${name_file%/dm/name}/ro")" = 1 ] ||
        fail BASELINE_NOT_READONLY
    found=$((found + 1))
done
[ "$found" -eq 1 ] || fail BASELINE_DM_IDENTITY
echo F04_REAL_EFI_LINUX_BASELINE_PASS

# Release exclusively the mapper/mount created by the real positive boot.
IFS=' ' read -r table_start table_length table_kind source_part source_sector \
    </run/iso-table || fail TABLE_PARSE
case "$source_part" in
    /dev/vd*[0-9]|/dev/sd*[0-9]) ;;
    *) fail UNEXPECTED_DISPOSABLE_PARTITION ;;
esac
[ "$table_kind" = linear ] && [ -b "$source_part" ] ||
    fail SOURCE_PARTITION_MISSING
source_disk=${source_part%[0-9]}
[ -b "$source_disk" ] || fail SOURCE_DISK_MISSING
/bin/busybox umount /mnt/iso || fail BASELINE_UMOUNT
/usr/sbin/dmsetup remove vt_iso_poc || fail BASELINE_DM_REMOVE
/bin/busybox rm -f /dev/mapper/vt_iso_poc || fail BASELINE_NODE_REMOVE
no_mapper BASELINE
echo F04_BASELINE_CLEANUP_PASS

var=/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e
[ -r "$var" ] || fail EFI_VAR_NOT_PRESENT
/bin/busybox cp "$var" /run/f04-original-efi-var || fail EFI_VAR_SAVE
[ "$(/bin/busybox wc -c </run/f04-original-efi-var)" -gt 552 ] ||
    fail EFI_VAR_INVALID_CONTROL

# Only mask the guest efivarfs mount with a private tmpfs, NEVER mutate EFI
# firmware variable storage. This does not disable OVMF Runtime Services.
 /bin/busybox mount -t tmpfs -o size=64k tmpfs \
    /sys/firmware/efi/efivars || fail EFI_TMPFS
refuse_consumer MISSING_EFI_VARIABLE \
    'efi runtime variable is not visible after ExitBootServices'
restore_var
/bin/busybox printf '\002\000\000\000' |
    /bin/busybox dd of="$var" bs=1 count=4 conv=notrunc \
    >/dev/null 2>&1 || fail EFI_ATTRIBUTES_FIXTURE
refuse_consumer EFI_RUNTIME_ATTRIBUTE 'invalid EFI runtime variable'
restore_var
/bin/busybox printf 'BADMAP01' |
    /bin/busybox dd of="$var" bs=1 seek=4 count=8 conv=notrunc \
    >/dev/null 2>&1 || fail EFI_MAP_MUTATION_FIXTURE
refuse_consumer MUTATED_EFI_MAP 'invalid UEFI map magic'
restore_var
# The real publisher/consumer pair rejects count 641 (>640 limit).
/bin/busybox printf '\201\002\000\000' |
    /bin/busybox dd of="$var" bs=1 seek=12 count=4 conv=notrunc \
    >/dev/null 2>&1 || fail EFI_OVERSIZED_COUNT_FIXTURE
refuse_consumer OVERSIZE_EFI_MAP 'invalid original chunk array bounds'
/bin/busybox dd if=/run/f04-original-efi-var of="$var" \
    bs=1 count=32 >/dev/null 2>&1 || fail EFI_TRUNCATED_FIXTURE
refuse_consumer TRUNCATED_EFI_MAP 'invalid EFI runtime variable'
/bin/busybox umount /sys/firmware/efi/efivars || fail EFI_UNMASK
[ -r "$var" ] || fail EFI_NOT_RESTORED
/bin/map-consumer /run/f04-restored-table >/run/f04-restored-output 2>&1 ||
    fail RESTORED_VAR_CONSUMER
/bin/busybox cmp /run/iso-table /run/f04-restored-table ||
    fail RESTORED_VAR_DIFFERENT_TABLE
echo F04_GUEST_EFI_RUNTIME_RESTORED_PASS

# Removing a guest devtmpfs *name* models source-path loss, NOT hot-unplug.
/bin/busybox mv "$source_disk" "$source_disk.f04-hidden" || fail HIDE_DISK
refuse_consumer MISSING_SOURCE_NODE \
    'source GPT identity missing or ambiguous'
/bin/busybox mv "$source_disk.f04-hidden" "$source_disk" ||
    fail RESTORE_DISK
[ -b "$source_disk" ] || fail DISK_NOT_RESTORED

# With source GPT still readable, hide only the specific partition node
# after map parsing. Real dmsetup must not substitute some other disk.
/bin/busybox mv "$source_part" "$source_part.f04-hidden" ||
    fail HIDE_PARTITION
if /usr/sbin/dmsetup create vt_iso_f04 --readonly \
    --table "$(/bin/busybox cat /run/f04-restored-table)" \
    > /run/f04-dm-output 2>&1; then
    /usr/sbin/dmsetup remove vt_iso_f04 || :
    fail MISSING_PARTITION_DM_ACCEPTED
fi
/bin/busybox mv "$source_part.f04-hidden" "$source_part" ||
    fail RESTORE_PARTITION
no_mapper MISSING_PARTITION_NODE
echo F04_NEGATIVE_MISSING_PARTITION_NODE_PASS

# Missing userspace dmsetup is *not* the same as missing kernel dm_mod.
/bin/busybox mv /usr/sbin/dmsetup /usr/sbin/dmsetup.f04-hidden ||
    fail HIDE_BACKEND
if /usr/sbin/dmsetup create vt_iso_f04 --readonly \
    --table "$(/bin/busybox cat /run/f04-restored-table)" \
    > /run/f04-backend-output 2>&1; then
    fail MISSING_BACKEND_ACCEPTED
fi
/bin/busybox mv /usr/sbin/dmsetup.f04-hidden /usr/sbin/dmsetup ||
    fail RESTORE_BACKEND
no_mapper MISSING_BACKEND
echo F04_NEGATIVE_MISSING_BACKEND_PASS

/bin/map-consumer /run/f04-final-table >/run/f04-final-output 2>&1 ||
    fail FINAL_SOURCE_CONSUMER
/bin/busybox cmp /run/iso-table /run/f04-final-table ||
    fail FINAL_SOURCE_TABLE_CHANGED
no_mapper FINAL_STATE
echo F04_REAL_GUEST_SAFETY_PASS
exit 0
