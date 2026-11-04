#!/usr/bin/env bash
# Build a fresh two-entry diagnostic x86_64 UEFI GPT boot image from the
# independently CI-verified historical Ventoy/stock-GRUB probe binary.
# ALL writes go to a NEW output directory. No block device is opened.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo 'usage: build-dual-boot-image.sh VERIFIED_BASE_BUNDLE NEW_OUTPUT_DIR' >&2
  exit 2
fi
base=$1
out=$2
[[ -d "$base" && ! -L "$base" &&
   -s "$base/boot-disk.raw.gz" &&
   -s "$base/SHA256SUMS" &&
   -s "$base/RAW-SHA256SUMS" &&
   -s "$base/test-result.txt" ]] || {
  echo 'Base bundle is incomplete' >&2; exit 3;
}
[[ ! -e "$out" && ! -L "$out" ]] || {
  echo 'Refusing to overwrite output directory' >&2; exit 4;
}
for command in gzip sgdisk mcopy mtype sha256sum cmp grep awk stat; do
  command -v "$command" >/dev/null || {
    echo "Missing dependency: $command" >&2
    exit 5
  }
done
grep -Fx 'synthetic_ext4_gpt_source_efi_startimage=passed' \
  "$base/test-result.txt" >/dev/null || {
  echo 'Base EFI fixture was not independently tested' >&2; exit 6;
}
(cd "$base" && sha256sum -c SHA256SUMS)
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
gzip -dc "$base/boot-disk.raw.gz" > "$out/boot-disk.raw"
[[ "$(sha256sum "$out/boot-disk.raw" | awk '{print $1}')" == \
   "$(awk '$2=="boot-disk.raw" {print $1}' "$base/RAW-SHA256SUMS")" ]] || {
  echo 'Base RAW boot image digest mismatch' >&2
  exit 7
}
sgdisk --verify "$out/boot-disk.raw" > "$out/gpt-check.log" 2>&1
[[ "$(stat -c %s "$out/boot-disk.raw")" == "100663296" ]] || {
  echo 'Unknown boot GPT baseline; no fixed FAT32 offset assumption permitted' >&2
  exit 8
}
# Match validated baseline's GPT p1 start, never infer a new offset.
sgdisk -i 1 "$out/boot-disk.raw" > "$out/partition-info.txt"
grep -q '^First sector: 2048 ' "$out/partition-info.txt" || {
  echo 'Expected 1 MiB GPT ESP start absent' >&2; exit 9;
}

cat > "$out/runtime.cfg" <<'GRUB'
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
echo VT_USB_DUAL_RUNTIME_START
search --file --set=bootpart /vt-usb-boot.marker
if [ -z "$bootpart" ]; then
  echo VT_USB_BOOT_DISK_MISSING
  halt
fi
echo VT_USB_BOOT_DEVICE=$bootpart
set prefix=($bootpart)/grub

function vt_launch {
  set vt_selected_path=$1
  echo VT_USB_SELECTED_ISO=$vt_selected_path
  search --file --set=isopart $vt_selected_path
  echo VT_USB_ISO_DEVICE=$isopart
  if [ -z "$isopart" ]; then
    echo VT_USB_ISO_MISSING
    return
  fi
  insmod ($bootpart)/grub/x86_64-efi/ventoy_source_probe.mod
  if [ "$?" != "0" ]; then
    echo VT_USB_MODULE_FAILED
    return
  fi
  echo VT_USB_MAP_BEGIN
  vt_extent_probe ($isopart)$vt_selected_path
  echo VT_USB_MAP_DONE
  if [ -z "$vt_probe_chain_addr" ]; then
    echo VT_USB_MAP_UNSUPPORTED
    return
  fi
  set VTOY_MBOOT_SECONDARY=1
  echo VT_USB_VENTOY_START
  chainloader ($bootpart)/EFI/BOOT/VTOYDIAG.EFI mem:$vt_probe_chain_addr:size:$vt_probe_chain_size gptguid:$vt_probe_gpt_guid env_param=$vt_probe_env_addr mboot_boot_probe=1
  if boot; then
    echo VT_USB_VENTOY_RETURNED
  else
    echo VT_USB_VENTOY_FAILED
  fi
  echo VT_USB_SOURCE_STATUS=$vt_original_source_probe
  echo VT_USB_DRIVER_STATUS=$vt_original_iso_driver
  echo VT_USB_MEDIA_STATUS=$vt_original_media_probe
  echo VT_USB_CRC32=$vt_original_virtual_crc32
  echo VT_USB_PVD_STATUS=$vt_original_virtual_pvd
  echo VT_USB_BOOT_STATUS=$vt_original_boot_probe
  echo VT_USB_TEARDOWN_STATUS=$vt_original_virtual_uninstalled
}

set default=inspect
set timeout=30
set timeout_style=menu

menuentry 'Inspect USB ISO visibility (no installer)' --id=inspect {
  echo VT_USB_DUAL_INSPECT_START
  search --file --set=proxdevice /m/boot/iso/proxmox-ve_9.2-1.iso
  search --file --set=truedevice /m/boot/iso/TrueNAS-SCALE-25.10.7.iso
  echo VT_USB_PROXMOX_DEVICE=$proxdevice
  echo VT_USB_TRUENAS_DEVICE=$truedevice
  echo VT_USB_DUAL_INSPECT_FINISHED
  sleep 5
}

menuentry 'Proxmox VE 9.2-1 (experimental UEFI ISO boot)' --id=proxmox {
  vt_launch /m/boot/iso/proxmox-ve_9.2-1.iso
}

menuentry 'TrueNAS SCALE 25.10.7 (experimental UEFI ISO boot)' --id=truenas {
  vt_launch /m/boot/iso/TrueNAS-SCALE-25.10.7.iso
}
GRUB
# The same already-tested stock GRUB EFI executable loads runtime.cfg from
# the FAT32 ESP; the only changed boot logic is this plain-text menu.
mcopy -o -i "$out/boot-disk.raw@@1M" \
  "$out/runtime.cfg" ::/grub/runtime.cfg
mtype -i "$out/boot-disk.raw@@1M" ::/grub/runtime.cfg \
  > "$out/runtime-extracted.cfg"
cmp "$out/runtime.cfg" "$out/runtime-extracted.cfg"
sgdisk --verify "$out/boot-disk.raw" >> "$out/gpt-check.log" 2>&1

gzip -n -9 -c "$out/boot-disk.raw" > "$out/boot-disk.raw.gz"
(
  cd "$out"
  sha256sum boot-disk.raw.gz > SHA256SUMS
  sha256sum boot-disk.raw > RAW-SHA256SUMS
)
cat > "$out/BUILD-INFO.txt" <<'INFO'
fixture=m-boot-experimental-x86_64-uefi-usb-iso
architecture=x86_64-efi
boot_menu=dual-proxmox-truenas-uefi
source_iso_guest_path=/m/boot/iso/proxmox-ve_9.2-1.iso
source_iso_guest_path=/m/boot/iso/TrueNAS-SCALE-25.10.7.iso
source_iso=external-GPT-disk-read-only
native_arm64_efi_tested=no
physical_usb_writes=not-permitted-by-test
grub_core_patched=no
original_ventoy_source=experimental-branch
vendor_installer_media_recognition=not-tested
boot_iso_overlay_vendor_support=not-proven
INFO
# The CI acceptance gate writes test-result.txt only after two real OVMF
# synthetic boots. Never copy the base bundle's success claim to a new image.
printf 'dual_menu_firmware_validation=pending\n' \
  > "$out/test-result.txt"
echo "VT086_DUAL_BOOT_IMAGE_PREPARED=$out/boot-disk.raw.gz"
