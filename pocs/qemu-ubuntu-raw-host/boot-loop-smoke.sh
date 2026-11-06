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
for cmd in zstd sha256sum mkfs.ext4 blkid debugfs grub-mkrescue grub-script-check xorriso timeout "$qemu"; do
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

# The pinned RAW bundle predates the QMP instrumentation in this source tree.
# Replace only the launcher inside this disposable extracted RAW copy so the
# nested run logs the actual QEMU command and guest block/status observations.
debugfs -w -R 'rm /usr/local/sbin/mboot-qemu-boot' "$target/mboot-ubuntu-host.raw" \
  > "$work/debugfs-remove-launcher.log" 2>&1
debugfs -w -R "write $here/launch.py /usr/local/sbin/mboot-qemu-boot" \
  "$target/mboot-ubuntu-host.raw" > "$work/debugfs-install-launcher.log" 2>&1
debugfs -w -R 'set_inode_field /usr/local/sbin/mboot-qemu-boot mode 0100755' \
  "$target/mboot-ubuntu-host.raw" > "$work/debugfs-launcher-mode.log" 2>&1
debugfs -w -R 'mkdir /etc/systemd/system/mboot-qemu-host.service.d' \
  "$target/mboot-ubuntu-host.raw" > "$work/debugfs-dropin-dir.log" 2>&1
cat > "$work/force-tcg.conf" <<'EOF'
[Service]
Environment=MBOOT_FORCE_TCG=1
EOF
debugfs -w -R "write $work/force-tcg.conf /etc/systemd/system/mboot-qemu-host.service.d/force-tcg.conf" \
  "$target/mboot-ubuntu-host.raw" > "$work/debugfs-dropin.log" 2>&1
debugfs -R 'stat /usr/local/sbin/mboot-qemu-boot' "$target/mboot-ubuntu-host.raw" \
  > "$work/debugfs-launcher-stat.log" 2>&1
if ! grep -Eq 'Mode: +0755' "$work/debugfs-launcher-stat.log"; then
  echo MBOOT_LOOP_LAUNCHER_INJECTION_FAILED >&2
  cat "$work/debugfs-launcher-stat.log" >&2
  exit 22
fi
echo MBOOT_LOOP_INSTRUMENTED_LAUNCHER_AND_TCG_OVERRIDE_INJECTED

# Construct an actual bootable Linux ISO fixture and pass it unchanged through
# GRUB -> Ubuntu's preserved /host -> the inner QEMU read-only CD-ROM.
# This is not an original vendor ISO and proves only the guest fixture path.
bash "$here/make-bootable-guest-iso.sh" \
  "$target/vmlinuz" "$target/initrd.img" \
  "$work/source/m/boot/iso/fixture.iso" "$arch" \
  > "$work/source-iso.log" 2>&1

# Isolate the exact generated guest ISO before adding the second QEMU layer.
# This uses only a disposable empty disk and proves the fixture's own GRUB,
# kernel, initramfs, serial console and virtual device drivers.
direct_dir="$work/direct-guest"
mkdir -p "$direct_dir"
truncate -s 64M "$direct_dir/disk.raw"
direct_cmd=("$qemu" -nodefaults -no-user-config -no-reboot -m 2048 -smp 2
            -display none -serial stdio -monitor none -nic none)
if [[ $arch == amd64 ]]; then
  direct_code=/usr/share/OVMF/OVMF_CODE_4M.fd
  direct_vars=/usr/share/OVMF/OVMF_VARS_4M.fd
  [[ -s $direct_code && -s $direct_vars ]] || { echo MBOOT_DIRECT_OVMF_MISSING >&2; exit 17; }
  cp "$direct_vars" "$direct_dir/ovmf-vars.fd"
  direct_cmd+=(-machine q35,accel=tcg -cpu max
    -drive "if=pflash,format=raw,readonly=on,file=$direct_code"
    -drive "if=pflash,format=raw,file=$direct_dir/ovmf-vars.fd"
    -device virtio-scsi-pci,id=direct-scsi
    -drive "file=$work/source/m/boot/iso/fixture.iso,if=none,format=raw,media=cdrom,readonly=on,id=direct-cd"
    -device scsi-cd,drive=direct-cd,bus=direct-scsi.0,bootindex=1)
else
  direct_firmware=/usr/share/qemu-efi-aarch64/QEMU_EFI.fd
  [[ -s $direct_firmware ]] || { echo MBOOT_DIRECT_AARCH64_FIRMWARE_MISSING >&2; exit 18; }
  direct_cmd+=(-machine virt,accel=tcg -cpu cortex-a72 -bios "$direct_firmware"
    -device virtio-scsi-pci,id=direct-scsi
    -drive "file=$work/source/m/boot/iso/fixture.iso,if=none,format=raw,media=cdrom,readonly=on,id=direct-cd"
    -device scsi-cd,drive=direct-cd,bus=direct-scsi.0,bootindex=1)
fi
direct_cmd+=(-drive "file=$direct_dir/disk.raw,if=none,format=raw,id=direct-disk"
  -device virtio-blk-pci,drive=direct-disk,bootindex=2)
"${direct_cmd[@]}" > "$direct_dir/qemu-serial.log" 2>&1 &
direct_pid=$!
direct_observed=no
for ((iteration = 0; iteration < 180; iteration++)); do
  if grep -Fq MBOOT_INNER_GUEST_INSPECTION_PASS "$direct_dir/qemu-serial.log"; then
    direct_observed=pass
    break
  fi
  if ! jobs -pr | grep -Fxq "$direct_pid"; then
    direct_observed=exited
    break
  fi
  sleep 1
done
if kill -0 "$direct_pid" 2>/dev/null; then
  kill -TERM "$direct_pid" 2>/dev/null || :
fi
set +e
wait "$direct_pid"
direct_status=$?
set -e
echo "MBOOT_DIRECT_GUEST_QEMU_EXIT=$direct_status"
for marker in MBOOT_INNER_GUEST_KERNEL_BOOTED \
              MBOOT_INNER_GUEST_OPTICAL_PRESENT \
              MBOOT_INNER_GUEST_DISK_PRESENT \
              MBOOT_INNER_GUEST_INSPECTION_PASS; do
  if ! grep -Fq "$marker" "$direct_dir/qemu-serial.log"; then
    echo "MBOOT_DIRECT_GUEST_MARKER_MISSING: $marker" >&2
    tail -n 100 "$direct_dir/qemu-serial.log" >&2
    exit 19
  fi
done
if [[ $direct_observed != pass ]]; then
  echo "MBOOT_DIRECT_GUEST_NOT_REACHED: phase=$direct_observed" >&2
  tail -n 100 "$direct_dir/qemu-serial.log" >&2
  exit 20
fi
if [[ $direct_status -ne 0 && $direct_status -ne 143 ]]; then
  echo MBOOT_DIRECT_GUEST_QEMU_UNEXPECTED_EXIT >&2
  tail -n 100 "$direct_dir/qemu-serial.log" >&2
  exit 21
fi
echo MBOOT_DIRECT_GUEST_ISO_KERNEL_AND_DEVICES_PASS

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
timeout --signal=TERM --kill-after=10s 2400 \
  "${cmd[@]}" > "$work/outer-qemu-serial.log" 2>&1 &
outer_pid=$!
observed=none
for ((iteration = 0; iteration < 600; iteration++)); do
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
