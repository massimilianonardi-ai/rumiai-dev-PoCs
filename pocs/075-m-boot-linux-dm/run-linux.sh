#!/bin/sh
# Disposable, genuine Linux block-device PoC. Never touches real disks.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'run as root (sudo)' >&2; exit 2; }
for bin in sgdisk losetup mkfs.ext4 mount umount dmsetup xorriso python3 dd sha256sum findmnt truncate cmp cp sync; do
    command -v "$bin" >/dev/null 2>&1 || { echo "missing prerequisite: $bin" >&2; exit 3; }
done
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TEMP=$(mktemp -d)
LOOP=
NAME="mboot_poc_$$"
cleanup() {
    set +e
    umount "$TEMP/iso-mount" 2>/dev/null || :
    dmsetup remove "$NAME" 2>/dev/null || :
    if [ -n "$LOOP" ]; then
        if findmnt --mountpoint "$TEMP/fs" >/dev/null 2>&1; then umount "$TEMP/fs" || :; fi
        losetup -d "$LOOP" || :
    fi
    rm -rf -- "$TEMP"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$TEMP/source" "$TEMP/fs" "$TEMP/iso-mount"
printf 'pve-poc-test-media-id-2026-11-04\n' > "$TEMP/source/.pve-cd-id.txt"
# Real ISO9660 with real file content; 8 MiB forces multiple write extents.
dd if=/dev/urandom of="$TEMP/source/payload.bin" bs=1M count=8 status=none
xorriso -as mkisofs -R -J -o "$TEMP/source.iso" "$TEMP/source" >/dev/null 2>&1
truncate -s 256M "$TEMP/disk.raw"
# One real GPT partition, deliberately numbered 3: no Ventoy p1 assumption.
sgdisk --clear --new=3:2048:+192M --typecode=3:8300 "$TEMP/disk.raw" >/dev/null
LOOP=$(losetup --find --show --partscan "$TEMP/disk.raw")
[ -b "${LOOP}p3" ] || { echo "partition not visible: ${LOOP}p3" >&2; exit 4; }
ACTUAL=$(losetup -n -O BACK-FILE "$LOOP")
[ "$ACTUAL" = "$TEMP/disk.raw" ] || { echo 'loop backing mismatch' >&2; exit 5; }
mkfs.ext4 -F -q "${LOOP}p3"
mount "${LOOP}p3" "$TEMP/fs"
# Force allocation between actual ISO extents via fsync with alternating fillers.
python3 - "$TEMP/source.iso" "$TEMP/fs/fixture.iso" "$TEMP/fs" <<'PY'
import os, sys
src, target, directory = sys.argv[1:]
# Preallocate logical chunks in reverse order. This avoids ext4's delayed
# allocation merging sequential writes back into a single physical extent.
step = 1024 * 1024
length = os.path.getsize(src)
with open(target, 'wb+') as out:
    out.truncate(length)
    for n in reversed(range((length + step - 1) // step)):
        offset = n * step
        os.posix_fallocate(out.fileno(), offset, min(step, length - offset))
        filler = f'{directory}/filler-{n:03d}.bin'
        with open(filler, 'wb') as waste:
            waste.write(os.urandom(8 * 1024 * 1024))
            waste.flush()
            os.fsync(waste.fileno())
    with open(src, 'rb') as inp:
        while True:
            data = inp.read(step)
            if not data:
                break
            out.write(data)
    out.flush()
    os.fsync(out.fileno())
PY
sync
python3 "$HERE/extent_handoff.py" emit \
    --iso "$TEMP/fs/fixture.iso" --disk "$LOOP" --partition "${LOOP}p3" \
    --map "$TEMP/ventoy_image_map" --table "$TEMP/table"
# Reparse the binary map independently and compare ALL ISO bytes to the actual disk.
python3 "$HERE/extent_handoff.py" check \
    --iso "$TEMP/fs/fixture.iso" --disk "$LOOP" --partition "${LOOP}p3" \
    --map "$TEMP/ventoy_image_map" --table "$TEMP/table"
# Negative test: corrupted source map must be rejected before device creation.
cp "$TEMP/ventoy_image_map" "$TEMP/tampered_map"
python3 - "$TEMP/tampered_map" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); b=bytearray(p.read_bytes()); b[8] ^= 1; p.write_bytes(b)
PY
if python3 "$HERE/extent_handoff.py" check \
    --iso "$TEMP/fs/fixture.iso" --disk "$LOOP" --partition "${LOOP}p3" \
    --map "$TEMP/tampered_map" --table "$TEMP/tampered_table"; then
    echo 'ERROR corrupted extent was accepted' >&2; exit 6
fi
# Kernel mapping, not a FUSE simulation or a userspace ISO copy.
dmsetup create "$NAME" --readonly --table "$(cat "$TEMP/table")"
python3 - "$TEMP/fs/fixture.iso" "/dev/mapper/$NAME" <<'PY'
import hashlib, sys
def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb', buffering=0) as f:
        while True:
            b = f.read(1024*1024)
            if not b: break
            h.update(b)
    return h.hexdigest()
assert sha(sys.argv[1]) == sha(sys.argv[2]), 'device mapper bytes differ from original ISO'
print('LINUX_DM_FULL_ISO_SHA256_PASS')
PY
mount -t iso9660 -o ro "/dev/mapper/$NAME" "$TEMP/iso-mount"
cmp "$TEMP/source/.pve-cd-id.txt" "$TEMP/iso-mount/.pve-cd-id.txt"
echo 'LINUX_DM_ISO9660_IDENTITY_PASS'
