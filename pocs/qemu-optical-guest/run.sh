#!/bin/sh
# K-03 QEMU/OVMF end-to-end synthetic optical guest, no installer or host disks.
set -eu
[ "$#" -eq 1 ] && [ -s "$1/bootable.iso" ] || {
  echo 'usage: run.sh BUILT_K03_FIXTURE_DIRECTORY' >&2
  exit 2
}
out=$(CDPATH= cd "$1" && pwd -P)
iso="$out/bootable.iso"
for cmd in qemu-system-x86_64 timeout sha256sum grep awk sed tr tail cmp; do
  command -v "$cmd" >/dev/null 2>&1 || exit 3
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
[ -n "$code" ] && [ -n "$vars" ] || exit 4
sha256sum -c "$out/k03-source-sha256.txt"
before=$(awk '{print $1}' "$out/k03-source-sha256.txt")
cp "$vars" "$out/k03-private-vars.fd"
{
  printf 'task=K-03\nqemu=%s\n' "$(qemu-system-x86_64 --version | sed -n '1p')"
  printf 'host_arch=%s\n' "$(uname -m)"
  printf 'firmware=%s\naccelerator=tcg\n' "$code"
  printf 'controller=ich9-ahci\ndevice=ide-cd\n'
  printf 'source_iso_sha256=%s\n' "$before"
  printf 'source_iso_bytes=%s\n' "$(wc -c < "$iso")"
  printf 'read_only_backing=yes\nvirtual_writable_disks=none\nnetwork=none\n'
} > "$out/k03-result.txt"
set +e
timeout --signal=TERM --kill-after=5 150 qemu-system-x86_64 \
  -machine q35,accel=tcg -m 2048 -smp 2 \
  -no-reboot -display none -monitor none -serial stdio -nic none \
  -drive "if=pflash,format=raw,readonly=on,file=$code" \
  -drive "if=pflash,format=raw,file=$out/k03-private-vars.fd" \
  -device ich9-ahci,id=ahci \
  -drive "if=none,id=cd,format=raw,media=cdrom,readonly=on,file=$iso" \
  -device ide-cd,drive=cd,bus=ahci.0,bootindex=1 \
  > "$out/k03-positive.log" 2>&1
positive_rc=$?
set -e
printf 'qemu_positive_exit=%s\n' "$positive_rc" >> "$out/k03-result.txt"
if [ "$positive_rc" -ne 0 ]; then
  printf 'K03_ERROR_QEMU_EXIT=%s\n' "$positive_rc" >&2
  tail -n 90 "$out/k03-positive.log" >&2
  exit 5
fi
for marker in VT079_UEFI_GRUB_STARTED VT079_UEFI_ISO_FOUND \
  VT079_UEFI_KERNEL_STARTING K03_GUEST_INIT_STARTED \
  K03_GUEST_CD_READONLY_PASS K03_GUEST_DEVICE=/dev/sr0 \
  K03_GUEST_ISO_MARKER_PASS K03_GUEST_POST_KERNEL_CD_PASS \
  K03_GUEST_TEST_PASS; do
  if ! grep -F "$marker" "$out/k03-positive.log" >/dev/null; then
    printf 'K03_ERROR_MISSING_MARKER=%s\n' "$marker" >&2
    tail -n 90 "$out/k03-positive.log" >&2
    exit 6
  fi
done
if grep -F 'K03_GUEST_FAIL_' "$out/k03-positive.log" >/dev/null; then
  echo K03_ERROR_GUEST_FAILURE >&2
  exit 7
fi
guest=$(sed -n 's/^K03_GUEST_CD_SHA256=//p' "$out/k03-positive.log" |
  tr -d '\r' | tail -n 1)
if [ "$before" != "$guest" ]; then
  printf 'K03_ERROR_CD_HASH host=%s guest=%s\n' "$before" "$guest" >&2
  exit 8
fi
sha256sum -c "$out/k03-source-sha256.txt"
echo 'guest_cd_sha256_matches_source=yes' >> "$out/k03-result.txt"
# Real negative path: QEMU must refuse to attach an absent regular file.
missing="$out/k03-absent-optical.iso"
[ ! -e "$missing" ] || exit 9
set +e
timeout --signal=TERM --kill-after=5 15 qemu-system-x86_64 \
  -machine q35,accel=tcg -m 256 -display none -monitor none -serial none \
  -device ich9-ahci,id=ahci \
  -drive "if=none,id=missing,media=cdrom,format=raw,readonly=on,file=$missing" \
  -device ide-cd,drive=missing,bus=ahci.0 \
  > "$out/k03-negative.log" 2>&1
negative_rc=$?
set -e
[ "$negative_rc" -ne 0 ] && [ "$negative_rc" -ne 124 ] &&
  grep -F "$missing" "$out/k03-negative.log" >/dev/null &&
  grep -E 'Could not open|No such file or directory' \
    "$out/k03-negative.log" >/dev/null || {
    printf 'K03_ERROR_MISSING_SOURCE_NEGATIVE=%s\n' "$negative_rc" >&2
    cat "$out/k03-negative.log" >&2
    exit 10
  }
sha256sum -c "$out/k03-source-sha256.txt"
printf 'negative_source_rejected=yes\nqemu_negative_exit=%s\n' \
  "$negative_rc" >> "$out/k03-result.txt"
echo K03_QEMU_POST_KERNEL_CD_PASS
echo K03_QEMU_ISO_SHA256_IDENTITY_PASS
echo K03_QEMU_MISSING_SOURCE_NEGATIVE_PASS
