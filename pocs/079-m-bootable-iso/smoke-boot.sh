#!/bin/sh
# Boot a disposable ISO CD-ROM in OVMF; assert genuine Linux /init.
set -eu
[ "$#" -eq 1 ] || { echo 'usage: smoke-boot.sh BUILDER_OUTPUT_DIR' >&2; exit 2; }
out=$1
[ -s "$out/bootable.iso" ] && [ -s "$out/sha256sums.txt" ] || {
  echo 'Missing generated bootable ISO' >&2; exit 3;
}
for cmd in timeout qemu-system-x86_64 sha256sum grep cmp python3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing dependency: $cmd" >&2; exit 4;
  }
done
code=
vars=
for dir in /usr/share/OVMF /usr/share/edk2/ovmf; do
  for suffix in _4M ''; do
    if [ -s "$dir/OVMF_CODE$suffix.fd" ] &&
       [ -s "$dir/OVMF_VARS$suffix.fd" ]; then
      code="$dir/OVMF_CODE$suffix.fd"
      vars="$dir/OVMF_VARS$suffix.fd"
      break 2
    fi
  done
done
[ -n "$code" ] && [ -n "$vars" ] || {
  echo 'OVMF files absent' >&2; exit 5;
}
out=$(CDPATH= cd "$out" && pwd -P)
(cd "$out" && sha256sum --check --status sha256sums.txt) || {
  echo 'Generated ISO/kernel/initrd SHA256 mismatch' >&2; exit 6;
}
cp "$vars" "$out/ovmf-vars-test.fd"
set +e
timeout 120 qemu-system-x86_64 -machine q35,accel=tcg \
  -m 1024 -smp 2 -no-reboot -display none -serial mon:stdio \
  -drive "if=pflash,format=raw,readonly=on,file=$code" \
  -drive "if=pflash,format=raw,file=$out/ovmf-vars-test.fd" \
  -device ich9-ahci,id=ahci \
  -drive "if=none,id=cd,format=raw,media=cdrom,readonly=on,file=$out/bootable.iso" \
  -device ide-cd,drive=cd,bus=ahci.0,bootindex=1 \
  > "$out/qemu-iso-boot.log" 2>&1
status=$?
set -e
if [ "$status" -ne 0 ] ||
   ! grep -q 'VT079_UEFI_GRUB_STARTED' "$out/qemu-iso-boot.log" ||
   ! grep -q 'VT079_UEFI_ISO_FOUND' "$out/qemu-iso-boot.log" ||
   ! grep -q 'VT079_UEFI_KERNEL_STARTING' "$out/qemu-iso-boot.log" ||
   ! grep -q 'VT079_LINUX_INITRAMFS_ORIGINAL' "$out/qemu-iso-boot.log" ||
   grep -q 'VT079_LINUX_INITRAMFS_OVERLAY' "$out/qemu-iso-boot.log"; then
  echo "VT079_BOOTABLE_ISO_FAILED qemu_status=$status" >&2
  tail -n 100 "$out/qemu-iso-boot.log" >&2
  exit 7
fi
(cd "$out" && sha256sum --check --status sha256sums.txt) || {
  echo 'Original ISO modified by boot' >&2; exit 8;
}
echo 'VT079_STOCK_GRUB_EL_TORITO_BOOT_PASS'
echo 'VT079_UNMODIFIED_KERNEL_INITRAMFS_ORIGINAL_PASS'
echo 'VT079_ORIGINAL_ISO_SHA256_UNCHANGED_PASS'
