#!/bin/sh
# K-03: extend only the generated PoC 079 ISO with actual guest CD drivers.
set -eu
[ "$#" -eq 2 ] && [ ! -e "$1" ] && [ -s "$2" ] || {
  echo 'usage: build.sh NEW_OUTPUT_DIR ORIGINAL_VMLINUZ' >&2
  exit 2
}
out=$1
kernel=$2
here=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
repo=$(CDPATH= cd "$here/../.." && pwd -P)
release=$(basename "$kernel" | sed 's/^vmlinuz-//')
[ -d "/lib/modules/$release" ] || exit 3
for cmd in modprobe awk xorriso cpio zstd gzip xz cmp; do
  command -v "$cmd" >/dev/null 2>&1 || exit 4
done
sh "$repo/pocs/079-m-bootable-iso/build-bootable-iso.sh" "$out" "$kernel"
out=$(CDPATH= cd "$out" && pwd -P)
cp "$here/guest-init.sh" "$out/root-original/init"
chmod 755 "$out/root-original/init"
mkdir -p "$out/root-base/modules"
printf '#!/bin/sh\nset -e\n' > "$out/root-base/modules.load"
for module in ahci sr_mod iso9660; do
  modprobe -S "$release" --show-depends "$module"
done | awk '$1=="insmod" && !seen[$2]++ {print $2}' > "$out/module-paths.txt"
[ -s "$out/module-paths.txt" ] || exit 5
count=0
while IFS= read -r src; do
  [ -s "$src" ] || exit 6
  case "$src" in
    "/lib/modules/$release/"*) ;;
    *) exit 7 ;;
  esac
  count=$((count + 1))
  target="$out/root-base/modules/$count.ko"
  case "$src" in
    *.ko.zst) zstd -dc "$src" > "$target" ;;
    *.ko.xz) xz -dc "$src" > "$target" ;;
    *.ko.gz) gzip -dc "$src" > "$target" ;;
    *.ko) cp "$src" "$target" ;;
    *) exit 8 ;;
  esac
  printf '/bin/busybox insmod /modules/%s.ko || exit 1\n' "$count" \
    >> "$out/root-base/modules.load"
  printf '%s %s\n' "$count" "$src" >> "$out/module-manifest.txt"
done < "$out/module-paths.txt"
(cd "$out/root-base" && find . -print | cpio -o -H newc 2>/dev/null) \
  > "$out/iso/boot/initrd-base.cpio"
(cd "$out/root-original" && find . -print | cpio -o -H newc 2>/dev/null) \
  > "$out/iso/boot/initrd-hook.cpio"
# This is an owned disposable fixture, not an original vendor ISO.
rm "$out/bootable.iso"
xorriso -as mkisofs -quiet -no-pad -R -J -V VT079_LINUX_TEST \
  -eltorito-alt-boot -e efiboot.img -no-emul-boot \
  -o "$out/bootable.iso" "$out/iso" > "$out/k03-xorriso.log" 2>&1
xorriso -osirrox on -indev "$out/bootable.iso" \
  -extract /boot/initrd-hook.cpio "$out/k03-hook-extracted.cpio" \
  >> "$out/k03-xorriso.log" 2>&1
cmp "$out/k03-hook-extracted.cpio" "$out/iso/boot/initrd-hook.cpio"
sha256sum "$out/bootable.iso" > "$out/k03-source-sha256.txt"
printf 'K03_BUILD_OK modules=%s kernel=%s\n' "$count" "$release"
