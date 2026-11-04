#!/usr/bin/env bash
# CI-only: two genuine QEMU/OVMF boots against NEW GPT3/ext4 synthetic ISO media.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo 'usage: test-dual-uefi.sh BUILT_IMAGE_DIR NEW_TEST_DIR' >&2
  exit 2
fi
bundle=$1
out=$2
[[ -s "$bundle/boot-disk.raw" && -s "$bundle/runtime.cfg" && ! -e "$out" ]] || exit 3
for bin in grub-mkstandalone mkfs.vfat mmd mcopy mtype xorriso mkfs.ext4 sgdisk qemu-system-x86_64 timeout grep dd sha256sum awk cmp python3; do
  command -v "$bin" >/dev/null || { echo "Missing CI tool $bin" >&2; exit 4; }
done
code=; vars=
for dir in /usr/share/OVMF /usr/share/edk2/ovmf; do
  for suffix in _4M ''; do
    if [[ -s "$dir/OVMF_CODE$suffix.fd" && -s "$dir/OVMF_VARS$suffix.fd" ]]; then
      code="$dir/OVMF_CODE$suffix.fd"
      vars="$dir/OVMF_VARS$suffix.fd"
      break 2
    fi
  done
done
[[ -n "$code" && -n "$vars" ]] || { echo 'OVMF CODE/VARS absent' >&2; exit 5; }
mkdir -p "$out/root/m/boot/iso" "$out/efi/iso/EFI/BOOT"
out=$(cd "$out" && pwd -P)
bundle=$(cd "$bundle" && pwd -P)
echo 'VT086_FIXTURE_SYNTHETIC_NOT_REAL_VENDOR_INSTALLER' > "$out/TEST-BOUNDARY.txt"

# The ISO's own stock GRUB EFI executes and prints its marker, not the outer
# test's GRUB. Ventoy's genuine EFI virtual-CD boot mechanism is in the path.
cat > "$out/efi/grub.cfg" <<'GRUB'
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
echo VT086_NESTED_ORIGINAL_ISO_GRUB_STARTED
echo VT086_NESTED_ISO_EFI_CHAIN_SUCCESS
halt
GRUB
grub-mkstandalone -O x86_64-efi -o "$out/efi/BOOTX64.EFI" \
  --modules='normal iso9660 part_gpt serial terminal' \
  "boot/grub/grub.cfg=$out/efi/grub.cfg" > "$out/grub-build.log" 2>&1
test -s "$out/efi/BOOTX64.EFI"
cp "$out/efi/BOOTX64.EFI" "$out/efi/iso/EFI/BOOT/BOOTX64.EFI"
truncate -s 16M "$out/efi/iso/efiboot.img"
mkfs.vfat -F 16 "$out/efi/iso/efiboot.img" > "$out/efi-fat.log" 2>&1
mmd -i "$out/efi/iso/efiboot.img" ::/EFI ::/EFI/BOOT
mcopy -i "$out/efi/iso/efiboot.img" "$out/efi/BOOTX64.EFI" ::/EFI/BOOT/BOOTX64.EFI
for name in proxmox-ve_9.2-1.iso TrueNAS-SCALE-25.10.7.iso; do
  printf 'VT086_SYNTHETIC_IMAGE=%s\n' "$name" > "$out/efi/iso/id.txt"
  xorriso -as mkisofs -quiet -no-pad -R -J -V VT086_EFI_TEST \
    -eltorito-alt-boot -e efiboot.img -no-emul-boot \
    -o "$out/root/m/boot/iso/$name" "$out/efi/iso" > "$out/xorriso-$name.log" 2>&1
  xorriso -indev "$out/root/m/boot/iso/$name" -report_el_torito plain \
    >> "$out/xorriso-$name.log" 2>&1
done

# All host media are temporary regular files. The original USB is never opened.
truncate -s 256M "$out/source-disk.raw"
sgdisk --clear --new=1:2048:+8M --typecode=1:ef00 \
  --new=2:0:+8M --typecode=2:ef00 \
  --new=3:0:+192M --typecode=3:8300 \
  "$out/source-disk.raw" > "$out/source-gpt.log" 2>&1
sgdisk -i 3 "$out/source-disk.raw" > "$out/source-part3.txt"
start=$(awk '/^First sector: / {print $3}' "$out/source-part3.txt")
[[ "$start" =~ ^[0-9]+$ ]] && (( start % 2048 == 0 )) || {
  echo 'GPT3 not MiB aligned' >&2; exit 6;
}
truncate -s 192M "$out/source-ext4.img"
mkfs.ext4 -q -F -L MBOOTDATA -d "$out/root" "$out/source-ext4.img" \
  > "$out/ext4.log" 2>&1
dd if="$out/source-ext4.img" of="$out/source-disk.raw" bs=1M \
  seek=$((start / 2048)) conv=notrunc status=none
sgdisk --verify "$out/source-disk.raw" >> "$out/source-gpt.log" 2>&1

for selected in proxmox truenas; do
  cp "$bundle/boot-disk.raw" "$out/boot-$selected.raw"
  sed -e "s/^set default=inspect$/set default=$selected/" \
      -e 's/^set timeout=30$/set timeout=0/' \
      "$bundle/runtime.cfg" > "$out/runtime-$selected.cfg"
  mcopy -o -i "$out/boot-$selected.raw@@1M" \
    "$out/runtime-$selected.cfg" ::/grub/runtime.cfg
  mtype -i "$out/boot-$selected.raw@@1M" ::/grub/runtime.cfg > "$out/extracted-$selected.cfg"
  cmp "$out/runtime-$selected.cfg" "$out/extracted-$selected.cfg"
  cp "$vars" "$out/vars-$selected.fd"
  set +e
  timeout --signal=TERM --kill-after=5 80 qemu-system-x86_64 \
    -machine q35,accel=tcg -m 2048 -smp 2 -no-reboot -monitor none \
    -drive "if=pflash,format=raw,readonly=on,file=$code" \
    -drive "if=pflash,format=raw,file=$out/vars-$selected.fd" \
    -drive "if=none,format=raw,readonly=on,file=$out/boot-$selected.raw,id=boot" \
    -device virtio-blk-pci,drive=boot,bootindex=1 \
    -drive "if=none,format=raw,readonly=on,file=$out/source-disk.raw,id=usb" \
    -device virtio-blk-pci,drive=usb,bootindex=2 \
    -snapshot -display none -serial mon:stdio > "$out/qemu-$selected.log" 2>&1
  status=$?
  set -e
  printf 'VT086_QEMU_%s_EXIT=%s\n' "$selected" "$status"
  case "$selected" in
    proxmox) expected=/m/boot/iso/proxmox-ve_9.2-1.iso ;;
    truenas) expected=/m/boot/iso/TrueNAS-SCALE-25.10.7.iso ;;
  esac
  if ! grep -Fq "VT_USB_SELECTED_ISO=$expected" "$out/qemu-$selected.log" ||
     ! grep -Fq 'VT_USB_MAP_DONE' "$out/qemu-$selected.log" ||
     ! grep -Fq 'VT086_NESTED_ISO_EFI_CHAIN_SUCCESS' "$out/qemu-$selected.log"; then
    printf 'VT086_%s_UEFI_TEST_FAILED\n' "$selected" >&2
    tail -n 120 "$out/qemu-$selected.log" >&2
    exit 7
  fi
  printf 'VT086_%s_UEFI_SYNTHETIC_PASS\n' "$selected"
done
(cd "$bundle" && sha256sum -c SHA256SUMS && sha256sum -c RAW-SHA256SUMS)
echo 'VT086_DUAL_MENU_FIRMWARE_SMOKE_PASS'
