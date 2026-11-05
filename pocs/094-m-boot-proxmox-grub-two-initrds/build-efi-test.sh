#!/bin/sh
# Disposable stock-GRUB EFI boot proving two separate original-vendor/initrd files.
# No original vendor ISO replica, no physical disk, no product/firmware changes.
set -eu
if [ "$#" -ne 4 ] || [ -e "$1" ] || [ ! -s "$2" ] ||
   [ ! -s "$3" ] || [ ! -s "$4" ] || [ ! -s "$5" ]; then
  echo 'M05_EFI_FIXTURE_ARGS: usage NEW_DIRECTORY VENDOR_KERNEL VENDOR_INITRD SMALL_CPIO' >&2
  exit 2
fi
out=$1
kernel=$2
initrd=$3
sidecar=$4
for tool in grub-mkstandalone grub-script-check mkfs.vfat mmd mcopy xorriso sha256sum cmp; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "M05_EFI_FIXTURE_MISSING_TOOL: $tool" >&2
    exit 3
  }
done
[ "$(wc -c < "$sidecar")" -le 65536 ] || {
  echo 'M05_EFI_FIXTURE_SIDECAR_OVERSIZE' >&2
  exit 4
}
mkdir -p "$out/iso/boot" "$out/iso/EFI/BOOT"
out=$(CDPATH= cd "$out" && pwd -P)
cp "$kernel" "$out/iso/boot/vmlinuz"
cp "$initrd" "$out/iso/boot/vendor-initrd.img"
cp "$sidecar" "$out/iso/boot/sidecar.cpio"
cmp "$initrd" "$out/iso/boot/vendor-initrd.img"
cmp "$sidecar" "$out/iso/boot/sidecar.cpio"
printf 'm05-stock-grub-efi-two-separate-files\n' > "$out/iso/m05-fixture-identity"
cat > "$out/grub.cfg" <<'EOF'
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
echo M05_EFI_STOCK_GRUB_STARTED
search --file --set=isodisk /m05-fixture-identity
if [ -z "$isodisk" ]; then
  echo M05_EFI_FIXTURE_SOURCE_MISSING
  halt
fi
echo M05_EFI_STOCK_GRUB_FOUND_SOURCE
linux ($isodisk)/boot/vmlinuz ro ramdisk_size=16777216 rw splash=verbose proxtui console=ttyS0,115200 rdinit=/init
echo M05_EFI_LOADING_UNMODIFIED_VENDOR_INITRD_AND_EXTERNAL_CPIO
initrd ($isodisk)/boot/vendor-initrd.img ($isodisk)/boot/sidecar.cpio
echo M05_EFI_INITRD_TWO_FILES_LOADED
boot
EOF
grub-script-check "$out/grub.cfg" > "$out/script-check.log" 2>&1 || {
  echo 'M05_EFI_GRUB_SCRIPT_INVALID' >&2
  cat "$out/script-check.log" >&2
  exit 5
}
grub-mkstandalone -O x86_64-efi -o "$out/BOOTX64.EFI" \
  --modules='normal iso9660 part_gpt search search_fs_file linux serial terminal' \
  "boot/grub/grub.cfg=$out/grub.cfg" > "$out/grub-build.log" 2>&1 || {
  echo 'M05_EFI_STOCK_GRUB_BUILD_FAILED' >&2
  cat "$out/grub-build.log" >&2
  exit 6
}
test -s "$out/BOOTX64.EFI" || exit 7
truncate -s 16M "$out/iso/efiboot.img"
mkfs.vfat -F 16 "$out/iso/efiboot.img" > "$out/fat.log" 2>&1
mmd -i "$out/iso/efiboot.img" ::/EFI ::/EFI/BOOT
mcopy -i "$out/iso/efiboot.img" "$out/BOOTX64.EFI" ::/EFI/BOOT/BOOTX64.EFI
cp "$out/BOOTX64.EFI" "$out/iso/EFI/BOOT/BOOTX64.EFI"
xorriso -as mkisofs -quiet -no-pad -R -J -V M05_EFI_STAGE_TEST \
  -eltorito-alt-boot -e efiboot.img -no-emul-boot \
  -o "$out/disposable-efi-test.iso" "$out/iso" > "$out/xorriso.log" 2>&1 || {
  echo 'M05_EFI_FIXTURE_XORRISO_FAILED' >&2
  tail -n 35 "$out/xorriso.log" >&2
  exit 8
}
xorriso -indev "$out/disposable-efi-test.iso" -report_el_torito plain \
  >> "$out/xorriso.log" 2>&1
sha256sum "$kernel" "$initrd" "$sidecar" > "$out/source-sha256.txt"
sha256sum "$out/iso/boot/vmlinuz" "$out/iso/boot/vendor-initrd.img" \
  "$out/iso/boot/sidecar.cpio" "$out/disposable-efi-test.iso" \
  > "$out/fixture-sha256.txt"
cmp "$initrd" "$out/iso/boot/vendor-initrd.img"
printf 'M05_EFI_STOCK_GRUB_FIXTURE_READY original_initrd_bytes=%s sidecar_bytes=%s\n' \
  "$(wc -c < "$initrd")" "$(wc -c < "$sidecar")"
