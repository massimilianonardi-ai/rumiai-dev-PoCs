#!/bin/sh
# K-02: inspect QEMU/OVMF optical device configuration, never boot a guest.
set -eu
umask 077
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'usage: probe.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 2
fi
output=$1
if [ -e "$output" ]; then
  printf 'Output path already exists: %s\n' "$output" >&2
  exit 3
fi
for command_name in qemu-system-x86_64 timeout cp cmp dd sha256sum grep uname df awk sed; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command missing: %s\n' "$command_name" >&2
    exit 4
  fi
done
code=
vars=
for firmware_dir in /usr/share/OVMF /usr/share/edk2/ovmf; do
  for suffix in _4M ''; do
    if [ -s "$firmware_dir/OVMF_CODE$suffix.fd" ] &&
       [ -s "$firmware_dir/OVMF_VARS$suffix.fd" ]; then
      code=$firmware_dir/OVMF_CODE$suffix.fd
      vars=$firmware_dir/OVMF_VARS$suffix.fd
      break 2
    fi
  done
done
if [ -z "$code" ] || [ -z "$vars" ]; then
  printf '%s\n' 'Matching OVMF CODE/VARS not found' >&2
  exit 5
fi
mkdir -p "$output"
output=$(CDPATH= cd "$output" && pwd -P)
manifest=$output/manifest.txt
{
  printf 'task=K-02\nscope=host_preflight_no_guest_boot\n'
  printf 'host_system=%s\nhost_arch=%s\nhost_kernel=%s\n' "$(uname -s)" "$(uname -m)" "$(uname -r)"
  if [ -r /etc/os-release ]; then
    awk -F= '/^PRETTY_NAME=/ { print "host_os=" $2 }' /etc/os-release
  fi
  printf 'qemu_version=%s\n' "$(qemu-system-x86_64 --version | sed -n '1p')"
  printf 'ovmf_code=%s\novmf_vars_template=%s\n' "$code" "$vars"
  if [ -e /dev/kvm ]; then
    printf 'dev_kvm_present=yes\n'
    if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
      printf 'dev_kvm_accessible=yes\n'
    else
      printf 'dev_kvm_accessible=no\n'
    fi
  else
    printf 'dev_kvm_present=no\ndev_kvm_accessible=no\n'
  fi
  printf 'guest_arch_requested=x86_64\naccelerator_used=tcg\n'
  printf 'guest_firmware=OVMF_UEFI\nguest_boot_attempted=no\n'
  printf 'real_iso_used=no\nphysical_device_used=no\nphysical_disk_writes=no\n'
  printf 'controller=ich9-ahci\noptical_device=ide-cd\n'
  printf 'cd_backend=raw_readonly_regular_file\n'
  printf 'guest_memory_candidate_mib=2048\n'
  printf 'display_tested=none_headless\ngraphics_onscreen_tested=no\n'
  printf 'network_configured=no\nserial_guest_output_tested=no\n'
  printf 'host_disk_space_kib=%s\n' "$(df -Pk "$output" | awk 'NR==2 {print $4}')"
  if [ -r /proc/meminfo ]; then
    awk '/^MemAvailable:/ {print "host_mem_available_kib=" $2}' /proc/meminfo
  fi
} > "$manifest"
qemu-system-x86_64 -accel help > "$output/qemu-accelerators.txt" 2>&1
qemu-system-x86_64 -device ich9-ahci,help > "$output/qemu-ahci-device.txt" 2>&1
qemu-system-x86_64 -device ide-cd,help > "$output/qemu-ide-cd-device.txt" 2>&1
qemu-system-x86_64 -display help > "$output/qemu-displays.txt" 2>&1
# Tiny disposable regular-file probe, NOT an ISO filesystem or operator disk.
dd if=/dev/zero of="$output/optical-probe.raw" bs=2048 count=32 2> "$output/fixture-create.txt"
sha256sum "$output/optical-probe.raw" > "$output/fixture-sha256-before.txt"
cp "$vars" "$output/ovmf-vars-private.fd"
# -S stops the guest CPU; the QEMU monitor inspects actual instantiated devices.
printf 'info block\ninfo qtree\nquit\n' |
  timeout 30 qemu-system-x86_64 \
    -nodefaults -no-user-config -machine q35,accel=tcg \
    -m 256 -smp 1 -S -no-reboot \
    -display none -monitor stdio \
    -drive "if=pflash,format=raw,readonly=on,file=$code" \
    -drive "if=pflash,format=raw,file=$output/ovmf-vars-private.fd" \
    -device ich9-ahci,id=ahci \
    -drive "if=none,id=cd,media=cdrom,format=raw,readonly=on,file=$output/optical-probe.raw" \
    -device ide-cd,drive=cd,bus=ahci.0,bootindex=1 \
    > "$output/qemu-monitor.txt" 2>&1
if ! grep -F 'ide-cd' "$output/qemu-monitor.txt" >/dev/null ||
   ! grep -F 'ahci' "$output/qemu-monitor.txt" >/dev/null ||
   ! grep -F 'optical-probe.raw' "$output/qemu-monitor.txt" >/dev/null; then
  printf '%s\n' 'QEMU did not report AHCI, IDE-CD and backing file' >&2
  exit 6
fi
sha256sum "$output/optical-probe.raw" > "$output/fixture-sha256-after.txt"
if ! cmp "$output/fixture-sha256-before.txt" "$output/fixture-sha256-after.txt"; then
  printf '%s\n' 'Read-only probe unexpectedly changed' >&2
  exit 7
fi
printf 'qemu_halted_device_tree=passed\noptical_probe_sha256_unchanged=yes\n' >> "$manifest"
printf 'K02_PREFLIGHT_PASS output=%s\n' "$output"
