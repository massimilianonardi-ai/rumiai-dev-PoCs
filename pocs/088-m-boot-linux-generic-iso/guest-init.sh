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

echo M02_GUEST_TEST_PASS
/bin/busybox poweroff -f
/bin/busybox sleep 3
exit 1
