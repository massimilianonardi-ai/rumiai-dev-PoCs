#!/bin/sh
# Disposable file-backed source GPT3 plus read-only ISO sidecar. No host disks.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'root required'; exit 2; }
for cmd in sgdisk losetup mkfs.ext4 mount umount dmsetup xorriso cpio \
           python3 sha256sum dd truncate cmp mktemp awk; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 3; }
done
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
verifier="$here/../075-m-boot-linux-dm/extent_handoff.py"
[ -f "$verifier" ] || { echo 'PoC 075 verifier missing'; exit 4; }
work=$(mktemp -d)
source_loop=
overlay_loop=
source_mounted=no
virtual_mounted=no
name="poc_iso_overlay_$$"
cleanup() {
  set +e
  [ "$virtual_mounted" != yes ] || umount "$work/mount"
  dmsetup remove "$name" 2>/dev/null || :
  [ "$source_mounted" != yes ] || umount "$work/ext4"
  [ -z "$overlay_loop" ] || losetup -d "$overlay_loop"
  [ -z "$source_loop" ] || losetup -d "$source_loop"
  rm -rf -- "$work"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$work/iso/boot" "$work/base/etc" "$work/extra/etc" \
         "$work/ext4" "$work/mount"
printf 'original\n' > "$work/base/etc/original.txt"
printf 'overlay-added\n' > "$work/extra/etc/overlay.txt"
(cd "$work/base" && find . | cpio -o -H newc 2>/dev/null) > "$work/iso/boot/initrd.img"
(cd "$work/extra" && find . | cpio -o -H newc 2>/dev/null) > "$work/extra.cpio"
cat "$work/iso/boot/initrd.img" "$work/extra.cpio" > "$work/replacement.img"
printf 'unchanged sibling\n' > "$work/iso/recovery-note.txt"
dd if=/dev/urandom of="$work/iso/noise.bin" bs=1M count=8 status=none
xorriso -as mkisofs -quiet -no-pad -R -J -V VTOY_OVERLAY_TEST \
  -o "$work/original.iso" "$work/iso" > "$work/xorriso.log" 2>&1
before=$(sha256sum "$work/original.iso" | awk '{print $1}')
truncate -s 256M "$work/source.raw"
sgdisk --clear --new=3:2048:+192M --typecode=3:8300 "$work/source.raw" >/dev/null
source_loop=$(losetup --find --show --partscan "$work/source.raw")
[ -b "${source_loop}p3" ] || { echo 'GPT3 device absent'; exit 5; }
[ "$(losetup -n -O BACK-FILE "$source_loop")" = "$work/source.raw" ] ||
  { echo 'unexpected source loop'; exit 6; }
mkfs.ext4 -q -F "${source_loop}p3"
mount "${source_loop}p3" "$work/ext4"
source_mounted=yes
python3 - "$work/original.iso" "$work/ext4/fixture.iso" "$work/ext4" <<'PY'
import os,sys
src,dest,folder=sys.argv[1:]
length=os.stat(src).st_size
step=1024*1024
with open(dest,'wb+') as out:
    out.truncate(length)
    for i in reversed(range((length+step-1)//step)):
        os.posix_fallocate(out.fileno(), i*step, min(step,length-i*step))
        with open(f'{folder}/filler-{i}.bin','wb') as filler:
            filler.write(os.urandom(step*2))
            filler.flush(); os.fsync(filler.fileno())
    with open(src,'rb') as inp:
        while b:=inp.read(step):
            out.write(b)
    out.flush(); os.fsync(out.fileno())
PY
sync
[ "$(sha256sum "$work/ext4/fixture.iso" | awk '{print $1}')" = "$before" ] ||
  { echo 'fixture ISO copy differs'; exit 7; }
for mode in emit check; do
  python3 "$verifier" "$mode" --iso "$work/ext4/fixture.iso" \
    --disk "$source_loop" --partition "${source_loop}p3" \
    --map "$work/chunks.bin" --table "$work/original.table"
done
start=$(cat "/sys/class/block/${source_loop##*/}p3/start")
length=$(cat "/sys/class/block/${source_loop##*/}p3/size")
python3 "$here/overlay_iso.py" \
  --iso "$work/ext4/fixture.iso" --map "$work/chunks.bin" \
  --partition "${source_loop}p3" --partition-start "$start" \
  --partition-size "$length" --overlay-device /dev/loopOVERLAY \
  --replacement "$work/replacement.img" --target /boot/initrd.img \
  --overlay-image "$work/sidecar.raw" --table "$work/virtual.table"
overlay_loop=$(losetup --find --show --read-only "$work/sidecar.raw")
[ "$(losetup -n -O BACK-FILE "$overlay_loop")" = "$work/sidecar.raw" ] ||
  { echo 'unexpected overlay loop'; exit 8; }
python3 - "$work/virtual.table" "$overlay_loop" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); t=p.read_text()
assert t.count('/dev/loopOVERLAY')==3
p.write_text(t.replace('/dev/loopOVERLAY',sys.argv[2]))
PY
umount "$work/ext4"
source_mounted=no
dmsetup create "$name" --readonly --table "$(cat "$work/virtual.table")"
mount -t iso9660 -o ro "/dev/mapper/$name" "$work/mount"
virtual_mounted=yes
cmp "$work/replacement.img" "$work/mount/boot/initrd.img"
cmp "$work/iso/recovery-note.txt" "$work/mount/recovery-note.txt"
[ "$(sha256sum "$work/original.iso" | awk '{print $1}')" = "$before" ] ||
  { echo 'original ISO modified'; exit 9; }
if cmp -s "$work/iso/boot/initrd.img" "$work/mount/boot/initrd.img"; then
  echo 'original boot file unexpectedly still visible'; exit 10
fi
echo 'ISO_OVERLAY_ORIGINAL_UNCHANGED_PASS'
echo 'ISO_OVERLAY_BOOT_FILE_REPLACED_PASS'
echo 'ISO_OVERLAY_SIBLING_UNCHANGED_PASS'
echo 'ISO_OVERLAY_DM_ISO9660_MOUNT_PASS'
