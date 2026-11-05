#!/bin/sh
# QEMU read-only *guest* view of unmodified official ISO + THREE bounded
# source-verified logical-sector changes, stored only in tiny local qcow2 COW.
# This is not F's physical GPT/FAT32 extent producer.
set -eu
if [ "$#" -ne 2 ] || [ ! -d "$1" ] || [ -e "$2" ]; then
  echo 'M05_COW_ARGS: usage: VENDOR_CONFIG_EVIDENCE_DIR NEW_OUTPUT_DIR' >&2
  exit 2
fi
config=$(realpath "$1")
out=$2
for f in report.json pvd-sector-patched.bin dirent-sector-patched.bin virtual-data-padded.bin; do
  if [ ! -s "$config/$f" ]; then
    echo "M05_COW_REQUIRED_SOURCE_PATCH_MISSING $f" >&2
    exit 3
  fi
done
for tool in qemu-img qemu-io python3; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "M05_COW_QEMU_TOOL_MISSING $tool" >&2
    exit 4
  }
done
mkdir -p "$out"
out=$(CDPATH= cd "$out" && pwd -P)
overlay="$out/official-iso-readonly-guest-shadow.qcow2"
url=https://enterprise.proxmox.com/iso/proxmox-ve_9.2-1.iso
python3 - "$config/report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["official_source"] == "https://enterprise.proxmox.com/iso/proxmox-ve_9.2-1.iso"
assert r["original_iso_size"] == 1706178560
assert r["virtual_config_bytes"] <= 65536
assert r["installer_only_initrd_edits"] == 10
assert r["pvd_record_override_start"] == 32848
assert r["config_record_patch_bytes"] == 16
assert r["virtual_sector_data_start"] == 1706178560
assert r["verified_pvd_sector_writes_only_bytes_80_to_87"]
assert r["verified_dirent_sector_writes_only_original_extent_size_16_bytes"]
PY
# The remote official ISO is OPENED read-only as a backing image: QEMU writes
# never target this URL. Only metadata and the three patch sectors are local.
timeout 90 qemu-img create -f qcow2 -F raw -b "$url" "$overlay" \
  > "$out/create.log" 2>&1 || {
  echo M05_COW_REMOTE_BACKING_OPEN_FAILED >&2
  cat "$out/create.log" >&2
  exit 5
}
size=$(python3 - "$config/report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
print(r["virtual_iso_sectors"] * 2048)
PY
)
timeout 90 qemu-img resize -f qcow2 "$overlay" "$size" \
  > "$out/resize.log" 2>&1 || {
  echo M05_COW_VIRTUAL_GROW_FAILED >&2
  cat "$out/resize.log" >&2
  exit 6
}
dirsector=$(python3 - "$config/report.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["original_dirent_sector_start"])
PY
)
padded=$(wc -c < "$config/virtual-data-padded.bin")
[ "$padded" -le 65536 ] || {
  echo M05_COW_CONFIG_LARGER_THAN_F_OVERLAY >&2
  exit 7
}
# Real QEMU 8.x block backend; -s reads the exact source patch bytes.
# Writes are aligned to whole ISO9660 sectors, keeping all other bytes intact.
timeout 90 qemu-io -f qcow2 -c "write -s $config/pvd-sector-patched.bin 32768 2048" "$overlay" \
  > "$out/write-pvd.log" 2>&1 || {
  echo M05_COW_PVD_WRITE_FAILED >&2
  cat "$out/write-pvd.log" >&2
  exit 8
}
timeout 90 qemu-io -f qcow2 -c "write -s $config/dirent-sector-patched.bin $dirsector 2048" "$overlay" \
  > "$out/write-dirent.log" 2>&1 || {
  echo M05_COW_DIRENT_WRITE_FAILED >&2
  cat "$out/write-dirent.log" >&2
  exit 9
}
timeout 90 qemu-io -f qcow2 \
  -c "write -s $config/virtual-data-padded.bin 1706178560 $padded" "$overlay" \
  > "$out/write-virtual-config.log" 2>&1 || {
  echo M05_COW_APPENDED_CONFIG_WRITE_FAILED >&2
  cat "$out/write-virtual-config.log" >&2
  exit 10
}
timeout 90 qemu-img info -f qcow2 --output=json "$overlay" > "$out/qemu-info.json"
timeout 90 qemu-io -r -f qcow2 -c 'read -v 32768 2048' "$overlay" > "$out/read-pvd.hex"
timeout 90 qemu-io -r -f qcow2 -c "read -v $dirsector 2048" "$overlay" > "$out/read-dirent.hex"
i=0
while [ $((i * 2048)) -lt "$padded" ]; do
  offset=$((1706178560 + i * 2048))
  timeout 90 qemu-io -r -f qcow2 -c "read -v $offset 2048" "$overlay" \
    > "$out/read-virtual-$i.hex"
  i=$((i + 1))
done
test "$(wc -c < "$overlay")" -lt 16777216 || {
  echo M05_COW_LOCAL_IMAGE_UNEXPECTEDLY_LARGE >&2
  exit 11
}
echo M05_QEMU_REMOTE_ORIGINAL_ISO_THREE_PATCH_SECTORS_EMITTED
