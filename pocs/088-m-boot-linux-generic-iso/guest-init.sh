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
/bin/sh /bin/m02-iso-stage cleanup || failed CLEANUP
[ ! -e /dev/mapper/vt_iso_m02 ] || failed MAPPER_LEFT_BEHIND
echo M02_GUEST_CLEANUP_PASS

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

echo M02_GUEST_TEST_PASS
/bin/busybox poweroff -f
/bin/busybox sleep 3
exit 1
