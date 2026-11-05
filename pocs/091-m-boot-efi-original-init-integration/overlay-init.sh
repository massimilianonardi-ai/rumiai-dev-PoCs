#!/bin/sh
# M-04 EFI-sidecar /init: the original synthetic ISO and its initrd hook are
# built and hashed BEFORE this out-of-ISO loader overlay is introduced.
# The actual M-02 stage and the independent original /init stay unchanged.
set -u
export PATH=/bin:/usr/sbin
/bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec </dev/console >/dev/console 2>&1
echo M04_EFI_SIDECAR_INIT_ENTERED
# Existing PoC 079/080 genuine EFI loader checks this overlay marker.
echo VT079_LINUX_INITRAMFS_OVERLAY
[ -r /original-root/init ] || {
    echo M04_ERROR_ORIGINAL_INIT_MISSING
    /bin/busybox poweroff -f
    exit 1
}
[ -r /bin/m03-middleware-init ] || {
    echo M04_ERROR_MIDDLEWARE_MISSING
    /bin/busybox poweroff -f
    exit 2
}
echo M04_EFI_SIDECAR_HANDOFF_TO_MIDDLEWARE
exec /bin/sh /bin/m03-middleware-init
echo M04_ERROR_MIDDLEWARE_EXEC_RETURNED
/bin/busybox poweroff -f
exit 3
