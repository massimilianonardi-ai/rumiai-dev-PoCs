#!/bin/bash
# Real QEMU/UEFI GRUB -> Ubuntu loop= filesystem -> systemd/QEMU smoke.
# Only disposable regular-file disk/ISO fixtures. Never attach physical disks.
set -euo pipefail
umask 077

if [[ $# -ne 2 || ! -d $1 || -e $2 ]]; then
  echo 'usage: boot-loop-smoke.sh BUNDLE_DIRECTORY NEW_WORK_DIRECTORY' >&2
  exit 2
fi
case "$(uname -m)" in
  x86_64) arch=amd64; qemu=qemu-system-x86_64 ;;
  aarch64) arch=arm64; qemu=qemu-system-aarch64 ;;
  *) echo MBOOT_LOOP_UNSUPPORTED_ARCH >&2; exit 3 ;;
esac
for cmd in zstd sha256sum mkfs.ext4 blkid grub-mkrescue grub-script-check xorriso timeout "$qemu"; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "MBOOT_LOOP_MISSING_TOOL: $cmd" >&2; exit 4; }
done
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# Artifact layout can include one enclosing mboot-ubuntu-<arch> directory.
mapfile -t manifests < <(find "$1" -type f -name release-SHA256SUMS -print)
if [[ ${#manifests[@]} -ne 1 ]]; then
  echo "MBOOT_LOOP_MANIFEST_COUNT: ${#manifests[@]}" >&2
  exit 5
fi
bundle=$(dirname -- "${manifests[0]}")
for file in mboot-ubuntu-host.raw.zst vmlinuz initrd.img kernel-release.txt; do
  [[ -s "$bundle/$file" ]] || { echo "MBOOT_LOOP_BUNDLE_MEMBER_MISSING: $file" >&2; exit 6; }
done
mkdir -p "$2"
work=$(CDPATH= cd -- "$2" && pwd -P)
mkdir -p "$work/source/m/boot/host/$arch" "$work/source/m/boot/iso"
target="$work/source/m/boot/host/$arch"
zstd -d -q --force "$bundle/mboot-ubuntu-host.raw.zst" -o "$target/mboot-ubuntu-host.raw"
for file in vmlinuz initrd.img kernel-release.txt release-SHA256SUMS; do
  cp -- "$bundle/$file" "$target/$file"
done
( cd "$target" && sha256sum -c release-SHA256SUMS ) > "$work/bundle-sha256.log"
echo MBOOT_LOOP_BUNDLE_INTEGRITY_PASS

# Construct an actual bootable Linux ISO fixture and pass it unchanged through
# GRUB -> Ubuntu's preserved /host -> the inner QEMU read-only CD-ROM.
# This is not an original vendor ISO and proves only the guest fixture path.
bash "$here/make-bootable-guest-iso.sh" \
  "$target/vmlinuz" "$target/initrd.img" \
  "$work/source/m/boot/iso/fixture.iso" "$arch" \
  > "$work/source-iso.log" 2>&1
source_image="$work/mbootdata.raw"
truncate -s 6400M "$source_image"
mkfs.ext4 -q -F -L MBOOTDATA -d "$work/source" "$source_image" \
  > "$work/mkfs-source.log" 2>&1
source_uuid=$(blkid -p -s UUID -o value "$source_image")
[[ -n $source_uuid ]] || { echo MBOOT_LOOP_SOURCE_UUID_MISSING >&2; exit 7; }
echo "MBOOT_LOOP_SOURCE_UUID=$source_uuid"

# Generate a real UEFI GRUB ISO with the exact GRUB helper under test.
mkdir -p "$work/grub-iso/boot/grub"
cfg="$work/grub-iso/boot/grub/grub.cfg"
cat > "$cfg" <<EOF
set timeout=0
set default=0
insmod iso9660
insmod ext2
insmod probe
search --no-floppy --fs-uuid --set=boot_media_device $source_uuid
if [ "\$grub_cpu" = "x86_64" ]
then
  serial --unit=0 --speed=115200
  terminal_output serial
fi
echo MBOOT_GRUB_SOURCE_SELECTED
EOF
cat "$here/grub-example.cfg" >> "$cfg"
cat >> "$cfg" <<'EOF'
menuentry 'm-boot Ubuntu RAW host loop fixture' {
  echo MBOOT_GRUB_MENUENTRY_SELECTED
  boot_iso_with_ubuntu_qemu_host /m/boot/iso/fixture.iso
}
EOF
grub-script-check "$cfg"
grub-mkrescue -o "$work/grub-uefi.iso" "$work/grub-iso" \
  > "$work/grub-mkrescue.log" 2>&1 || {
    echo MBOOT_LOOP_GRUB_ISO_BUILD_FAILED >&2
    tail -n 70 "$work/grub-mkrescue.log" >&2
    exit 8
  }

# QEMU outer VM receives one disposable ext4 source disk; the inner QEMU
# service will represent the same disk read-only inside its guest.
cmd=("$qemu" -nodefaults -no-user-config -no-reboot -m 3584 -smp 2
     -display none -serial stdio -monitor none -nic none
     -drive "file=$source_image,if=none,format=raw,id=mboot_source"
     -device "virtio-blk-pci,drive=mboot_source,bootindex=2")
if [[ $arch == amd64 ]]; then
  code=/usr/share/OVMF/OVMF_CODE_4M.fd
  vars=/usr/share/OVMF/OVMF_VARS_4M.fd
  [[ -s $code && -s $vars ]] || { echo MBOOT_LOOP_OVMF_MISSING >&2; exit 9; }
  cp "$vars" "$work/ovmf-vars.fd"
  cmd+=(-machine q35,accel=tcg -cpu max
        -drive "if=pflash,format=raw,readonly=on,file=$code"
        -drive "if=pflash,format=raw,file=$work/ovmf-vars.fd"
        -device "ich9-ahci,id=boot-ahci"
        -drive "file=$work/grub-uefi.iso,if=none,media=cdrom,readonly=on,id=grubcd"
        -device "ide-cd,drive=grubcd,bus=boot-ahci.0,bootindex=1")
else
  firmware=/usr/share/qemu-efi-aarch64/QEMU_EFI.fd
  [[ -s $firmware ]] || { echo MBOOT_LOOP_AARCH64_FIRMWARE_MISSING >&2; exit 10; }
  cmd+=(-machine virt,accel=tcg -cpu cortex-a72 -bios "$firmware"
        -device "virtio-scsi-pci,id=boot-scsi"
        -drive "file=$work/grub-uefi.iso,if=none,media=cdrom,readonly=on,id=grubcd"
        -device "scsi-cd,drive=grubcd,bus=boot-scsi.0,bootindex=1")
fi

# TCG may be slow on hosted runners. Watch the *actual* serial output,
# terminate as soon as the running Ubuntu service proves the intended path,
# and fail early on definite kernel/loop-root failures. Merely reaching a
# timeout is never accepted as a PASS.
timeout --signal=TERM --kill-after=10s 480 \
  "${cmd[@]}" > "$work/outer-qemu-serial.log" 2>&1 &
outer_pid=$!
observed=none
for ((iteration = 0; iteration < 240; iteration++)); do
  if grep -Fq MBOOT_GRUB_MENUENTRY_SELECTED "$work/outer-qemu-serial.log" &&
     grep -Fq MBOOT_QEMU_GUEST_START "$work/outer-qemu-serial.log" &&
     grep -Fq MBOOT_QEMU_DISKS_READONLY "$work/outer-qemu-serial.log" &&
     grep -Fq MBOOT_INNER_GUEST_INSPECTION_PASS "$work/outer-qemu-serial.log"; then
    observed=inner-guest
    break
  fi
  if grep -Eq 'Kernel panic - not syncing|ALERT!.*does not exist|Gave up waiting for root file system device|MBOOT_INNER_GUEST_INSPECTION_FAILED' \
    "$work/outer-qemu-serial.log"; then
    observed=kernel-failure
    break
  fi
  if ! kill -0 "$outer_pid" 2>/dev/null; then
    observed=exited
    break
  fi
  sleep 2
done
if kill -0 "$outer_pid" 2>/dev/null; then
  kill -TERM "$outer_pid" 2>/dev/null || :
fi
set +e
wait "$outer_pid"
status=$?
set -e
echo "MBOOT_LOOP_OUTER_QEMU_EXIT=$status phase=$observed"
if ! grep -Fq MBOOT_GRUB_MENUENTRY_SELECTED "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_GRUB_MENUENTRY_NOT_OBSERVED >&2
  tail -n 100 "$work/outer-qemu-serial.log" >&2
  exit 11
fi
echo MBOOT_LOOP_GRUB_MENUENTRY_PASS
if ! grep -Fq MBOOT_QEMU_GUEST_START "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_UBUNTU_SERVICE_NOT_OBSERVED >&2
  tail -n 120 "$work/outer-qemu-serial.log" >&2
  exit 12
fi
if ! grep -Fq MBOOT_QEMU_DISKS_READONLY "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_DISK_INVENTORY_NOT_OBSERVED >&2
  tail -n 120 "$work/outer-qemu-serial.log" >&2
  exit 13
fi
echo MBOOT_LOOP_GRUB_UBUNTU_ROOT_SYSTEMD_QEMU_START_PASS
if ! grep -Fq MBOOT_INNER_GUEST_OPTICAL_PRESENT "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_INNER_OPTICAL_NOT_OBSERVED >&2
  tail -n 120 "$work/outer-qemu-serial.log" >&2
  exit 14
fi
if ! grep -Fq MBOOT_INNER_GUEST_DISK_PRESENT "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_INNER_DISK_NOT_OBSERVED >&2
  tail -n 120 "$work/outer-qemu-serial.log" >&2
  exit 15
fi
if ! grep -Fq MBOOT_INNER_GUEST_INSPECTION_PASS "$work/outer-qemu-serial.log"; then
  echo MBOOT_LOOP_INNER_BOOT_NOT_OBSERVED >&2
  tail -n 120 "$work/outer-qemu-serial.log" >&2
  exit 16
fi
echo MBOOT_LOOP_GUEST_LINUX_OPTICAL_AND_DISK_PASS
