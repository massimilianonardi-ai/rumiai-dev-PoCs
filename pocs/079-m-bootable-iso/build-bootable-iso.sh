#!/bin/sh
# Rootless disposable x86_64 UEFI Linux ISO fixture. Never touches a disk.
set -eu
[ "$#" -eq 2 ] && [ ! -e "$1" ] && [ -s "$2" ] || {
  echo 'usage: build-bootable-iso.sh NEW_OUTPUT_DIR ORIGINAL_VMLINUZ' >&2
  exit 2
}
for cmd in grub-mkstandalone mkfs.vfat mmd mcopy xorriso cpio find sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing fixture dependency: $cmd" >&2; exit 3;
  }
done
out=$1
kernel=$2
busybox=$(command -v busybox || :)
[ -n "$busybox" ] && [ -s "$busybox" ] || {
  echo 'Requires busybox-static' >&2; exit 4;
}
mkdir -p "$out"
out=$(CDPATH= cd "$out" && pwd -P)
mkdir -p "$out/iso/boot" "$out/iso/EFI/BOOT" \
  "$out/root-base/bin" "$out/root-base/dev" "$out/root-base/proc" \
  "$out/root-base/sys" "$out/root-original" "$out/root-overlay"
cp "$kernel" "$out/iso/boot/vmlinuz"
cp "$busybox" "$out/root-base/bin/busybox"
chmod 755 "$out/root-base/bin/busybox"
ln -s busybox "$out/root-base/bin/sh"

cat > "$out/root-original/init" <<'EOF'
#!/bin/sh
/bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec >/dev/console 2>&1
echo VT079_LINUX_INITRAMFS_ORIGINAL
/bin/busybox poweroff -f
/bin/busybox sleep 10
exit 1
EOF
cat > "$out/root-overlay/init" <<'EOF'
#!/bin/sh
/bin/busybox mount -t devtmpfs devtmpfs /dev || :
exec >/dev/console 2>&1
echo VT079_LINUX_INITRAMFS_OVERLAY
/bin/busybox poweroff -f
/bin/busybox sleep 10
exit 1
EOF
chmod 755 "$out/root-original/init" "$out/root-overlay/init"
(cd "$out/root-base" && find . -print | cpio -o -H newc 2>/dev/null) \
  > "$out/iso/boot/initrd-base.cpio"
(cd "$out/root-original" && find . -print | cpio -o -H newc 2>/dev/null) \
  > "$out/iso/boot/initrd-hook.cpio"
(cd "$out/root-overlay" && find . -print | cpio -o -H newc 2>/dev/null) \
  > "$out/initrd-hook-overlay.cpio"
# The overridable hook remains very small. The stock kernel and BusyBox
# cpio remain byte-identical in both boot scenarios.
[ "$(wc -c < "$out/initrd-hook-overlay.cpio")" -le 65536 ] || {
  echo 'Small overlay exceeds existing experimental 64 KiB limit' >&2
  exit 5
}
printf 'vt079-uefi-isolated-source\n' > "$out/iso/vt079-marker"
cat > "$out/grub.cfg" <<'EOF'
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
echo VT079_UEFI_GRUB_STARTED
search --file --set=isodisk /vt079-marker
if [ -n "$isodisk" ]; then
  echo VT079_UEFI_ISO_FOUND
  linux ($isodisk)/boot/vmlinuz console=ttyS0,115200n8 rdinit=/init
  initrd ($isodisk)/boot/initrd-base.cpio ($isodisk)/boot/initrd-hook.cpio
  echo VT079_UEFI_KERNEL_STARTING
  boot
fi
echo VT079_UEFI_ISO_NOT_FOUND
halt
EOF
grub-mkstandalone -O x86_64-efi -o "$out/BOOTX64.EFI" \
  --modules='normal iso9660 part_gpt search search_fs_file linux serial terminal' \
  "boot/grub/grub.cfg=$out/grub.cfg" > "$out/grub-build.log" 2>&1
test -s "$out/BOOTX64.EFI"
# El Torito UEFI system partition is an image INSIDE the ISO.
truncate -s 16M "$out/iso/efiboot.img"
mkfs.vfat -F 16 "$out/iso/efiboot.img" > "$out/fat.log" 2>&1
mmd -i "$out/iso/efiboot.img" ::/EFI ::/EFI/BOOT
mcopy -i "$out/iso/efiboot.img" "$out/BOOTX64.EFI" \
  ::/EFI/BOOT/BOOTX64.EFI
cp "$out/BOOTX64.EFI" "$out/iso/EFI/BOOT/BOOTX64.EFI"
xorriso -as mkisofs -quiet -no-pad -R -J -V VT079_LINUX_TEST \
  -eltorito-alt-boot -e efiboot.img -no-emul-boot \
  -o "$out/bootable.iso" "$out/iso" > "$out/xorriso.log" 2>&1
xorriso -indev "$out/bootable.iso" -report_el_torito plain \
  >> "$out/xorriso.log" 2>&1
xorriso -osirrox on -indev "$out/bootable.iso" \
  -extract /boot/initrd-hook.cpio "$out/extracted-hook.cpio" \
  >> "$out/xorriso.log" 2>&1
cmp "$out/iso/boot/initrd-hook.cpio" "$out/extracted-hook.cpio"
sha256sum "$out/bootable.iso" "$out/iso/boot/vmlinuz" \
  "$out/iso/boot/initrd-hook.cpio" "$out/initrd-hook-overlay.cpio" \
  > "$out/sha256sums.txt"
printf 'VT079_BOOTABLE_ISO_CREATED bytes=%s hook_bytes=%s overlay_bytes=%s\n' \
  "$(wc -c < "$out/bootable.iso")" \
  "$(wc -c < "$out/iso/boot/initrd-hook.cpio")" \
  "$(wc -c < "$out/initrd-hook-overlay.cpio")"
