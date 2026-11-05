#!/usr/bin/env python3
"""M-05: source-pinned virtual ISO9660 grub.cfg record, not firmware boot proof.

Reuse the tested strict ByteRangeISO, not a homegrown remote ISO reader.
Emits only three tiny patches in the exact already-existing F overlay layout:
PVD sector count (8 bytes), ISO9660 file record (16 bytes), and appended data.
No vendor ISO byte is changed or downloaded in full.
"""
import argparse
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] /
                       "082-m-boot-vendor-iso-readonly"))
from iso_range_inspect import ByteRangeISO, iso_record, SECTOR  # noqa: E402

OFFICIAL = "https://enterprise.proxmox.com/iso/proxmox-ve_9.2-1.iso"
ORIGINAL_BYTES = 1706178560
CONFIG_BYTES = 6479
MAX_OVERLAY = 65536
INSTALL_LINE = re.compile(r"^([ \t]*)initrd[ \t]+/boot/initrd\.img[ \t]*$")
# This marker/file must be independently available from a selected external FAT
# partition in a future end-to-end test; NOT an existing public ABI or product path.
SEARCH_LINE = (
    'search --file --set=m05sidecar /m05-probe.marker\n'
    'if [ -z "$m05sidecar" ]; then\n'
    '  echo M05_SIDECAR_NOT_FOUND\n'
    '  halt\n'
    'fi\n'
)
REPLACED_INITRD = 'initrd /boot/initrd.img ($m05sidecar)/m05-probe.cpio'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def both_endian(value):
    if not 0 <= value <= 0xffffffff:
        raise ValueError("M05_ISO9660_SECTOR_COUNT_UNREPRESENTABLE")
    return value.to_bytes(4, "little") + value.to_bytes(4, "big")


def find_file(iso, root, components):
    entry = root
    record_at = None
    for level, name in enumerate(components):
        if not entry["directory"] or not 0 < entry["bytes"] <= 512 * 1024:
            raise ValueError("M05_VENDOR_DIRECTORY_UNSUPPORTED " + "/".join(components))
        data = iso.read(entry["extent_lba"] * SECTOR, entry["bytes"],
                        "original ISO9660 directory " + "/".join(components[:level]))
        at = 0
        matches = []
        while at < len(data):
            if not data[at]:
                at = (at // SECTOR + 1) * SECTOR
                continue
            start = at
            obj, at = iso_record(data, at)
            if obj and obj["name"].casefold() == name.casefold():
                matches.append((obj, entry["extent_lba"] * SECTOR + start + 2))
        if len(matches) != 1:
            raise ValueError("M05_ORIGINAL_VENDOR_ISO_PATH_AMBIGUOUS " + name)
        entry, record_at = matches[0]
        if entry["directory"] != (level < len(components) - 1):
            raise ValueError("M05_ORIGINAL_VENDOR_ISO_PATH_TYPE_BAD " + name)
    if entry["bytes"] > MAX_OVERLAY:
        raise ValueError("M05_ORIGINAL_CONFIG_OVERSIZE")
    return entry, record_at


def config_transform(original):
    # Preserve EVERY noninstaller line/byte, including rescue entries and EOLs.
    text = original.decode("utf-8")
    if "\r" in text or "\x00" in text:
        raise ValueError("M05_VENDOR_CONFIG_ENCODING_UNEXPECTED")
    output = []
    changes = 0
    for line in text.splitlines(keepends=True):
        stripped = line[:-1] if line.endswith("\n") else line
        match = INSTALL_LINE.fullmatch(stripped)
        if not match:
            output.append(line)
            continue
        prefix = match[1]
        output.append("".join(prefix + x + "\n" for x in SEARCH_LINE.rstrip("\n").split("\n")))
        output.append(prefix + REPLACED_INITRD + ("\n" if line.endswith("\n") else ""))
        changes += 1
    if changes != 10:
        raise ValueError("M05_VENDOR_INSTALL_INITRD_COUNT_CHANGED " + str(changes))
    updated = "".join(output).encode("utf-8")
    if len(updated) > MAX_OVERLAY:
        raise ValueError("M05_VENDOR_CONFIG_VIRTUAL_SIZE_EXCEEDS_F_64K")
    if updated.count(b"($m05sidecar)/m05-probe.cpio") != 10:
        raise ValueError("M05_VENDOR_CONFIG_SIDE_CPIO_COUNT_BAD")
    # Ensure the only actual source changes are precisely the per-install line
    # replacements. This checks the entire original sequence, not only counts.
    orig_lines = original.decode().splitlines(keepends=True)
    updated_lines = updated.decode().splitlines(keepends=True)
    edits = [op for op in difflib.SequenceMatcher(
        None, orig_lines, updated_lines, autojunk=False).get_opcodes()
             if op[0] != "equal"]
    if len(edits) != 10 or any(op[0] != "replace" or
                               op[2] - op[1] != 1 or
                               op[4] - op[3] != 6 for op in edits):
        raise ValueError("M05_VENDOR_CONFIG_NONINSTALL_EDIT_DETECTED")
    return updated, changes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", default=OFFICIAL)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    if a.url != OFFICIAL or a.out.exists():
        raise ValueError("M05_SOURCE_OR_NEW_OUTPUT_INVALID")
    iso = ByteRangeISO(a.url, budget=192 * 1024)
    pvd = iso.read(16 * SECTOR, SECTOR, "official ISO9660 PVD")
    if pvd[:7] != b"\x01CD001\x01":
        raise ValueError("M05_OFFICIAL_ISO9660_PVD_INVALID")
    root, _ = iso_record(pvd, 156)
    conf, config_record_at = find_file(iso, root, ["boot", "grub", "grub.cfg"])
    if conf["bytes"] != CONFIG_BYTES or iso.size != ORIGINAL_BYTES:
        raise ValueError("M05_ORIGINAL_GRUB_CONFIG_SIZE_OR_SOURCE_ISO_CHANGED")
    original = iso.read(conf["extent_lba"] * SECTOR,
                        conf["bytes"], "original vendor grub.cfg payload")
    # Additional original first stage; source-only topology information.
    first, first_at = find_file(iso, root, ["efi", "boot", "grub.cfg"])
    first_stage = iso.read(first["extent_lba"] * SECTOR,
                           first["bytes"], "original outer EFI GRUB handoff cfg")
    updated, changes = config_transform(original)
    size_padded = ((len(updated) + SECTOR - 1) // SECTOR) * SECTOR
    virtual_start_lba = ORIGINAL_BYTES // SECTOR
    virtual_count = virtual_start_lba + size_padded // SECTOR
    original_iso_sectors = int.from_bytes(pvd[80:84], "little")
    if (original_iso_sectors != ORIGINAL_BYTES // SECTOR or
            pvd[80:88] != both_endian(original_iso_sectors) or
            conf["extent_lba"] * SECTOR + conf["bytes"] > ORIGINAL_BYTES):
        raise ValueError("M05_ORIGINAL_VENDOR_ISO9660_GEOMETRY_CHANGED")
    pvd_patch = both_endian(virtual_count)
    record_patch = both_endian(virtual_start_lba) + both_endian(len(updated))
    if len(pvd_patch) != 8 or len(record_patch) != 16:
        raise ValueError("M05_F_OVERLAY_RECORD_PATCH_SIZE_ERROR")
    a.out.mkdir(parents=True)
    (a.out / "original-grub.cfg").write_bytes(original)
    (a.out / "first-stage-grub.cfg").write_bytes(first_stage)
    (a.out / "virtual-grub.cfg").write_bytes(updated)
    (a.out / "virtual-data-padded.bin").write_bytes(
        updated + b"\x00" * (size_padded - len(updated)))
    (a.out / "pvd-override.bin").write_bytes(pvd_patch)
    (a.out / "dirent-override.bin").write_bytes(record_patch)
    # QEMU qcow2 backing-image test needs whole aligned sectors for writes:
    # emit the strict original sector with only the same F-owned fields patched.
    dir_sector_start = config_record_at // SECTOR * SECTOR
    dir_sector_intra = config_record_at % SECTOR
    if dir_sector_intra + len(record_patch) > SECTOR:
        raise ValueError("M05_ORIGINAL_DIRENT_OVERRIDE_CROSSES_SECTOR")
    dir_sector_original = iso.read(dir_sector_start, SECTOR,
                                   "exact original grub cfg dirent sector")
    if (dir_sector_original[dir_sector_intra:dir_sector_intra + 16] !=
            both_endian(conf["extent_lba"]) + both_endian(conf["bytes"])):
        raise ValueError("M05_ORIGINAL_RECORD_CONTENT_MISMATCH")
    pvd_sector = bytearray(pvd)
    dir_sector = bytearray(dir_sector_original)
    pvd_sector[80:88] = pvd_patch
    dir_sector[dir_sector_intra:dir_sector_intra + 16] = record_patch
    (a.out / "pvd-sector-patched.bin").write_bytes(pvd_sector)
    (a.out / "dirent-sector-patched.bin").write_bytes(dir_sector)

    report = {
        "scope": "authentic_vendor_grub_cfg_iso9660_record_virtualization_data_only",
        "official_source": a.url,
        "original_iso_size": ORIGINAL_BYTES,
        "original_full_iso_sha256_vendor_published_NOT_VERIFIED":
            "4e88fe416df9b527624a175f24c9aa07c714d3332afb1ee3dbf3879573ef2c6c",
        "original_config_lba": conf["extent_lba"],
        "original_config_length": conf["bytes"],
        "original_config_record_override_start": config_record_at,
        "original_config_sha256": digest(original),
        "original_first_stage_lba": first["extent_lba"],
        "original_first_stage_record_override_start": first_at,
        "original_first_stage_length": first["bytes"],
        "original_first_stage_sha256": digest(first_stage),
        "virtual_config_bytes": len(updated),
        "virtual_config_sha256": digest(updated),
        "virtual_sector_data_start": ORIGINAL_BYTES,
        "virtual_iso_sectors": virtual_count,
        "pvd_record_override_start": 16 * SECTOR + 80,
        "pvd_patch_bytes": len(pvd_patch),
        "original_dirent_sector_start": dir_sector_start,
        "original_dirent_sector_sha256": digest(dir_sector_original),
        "virtual_pvd_sector_sha256": digest(pvd_sector),
        "virtual_dirent_sector_sha256": digest(dir_sector),
        "verified_pvd_sector_writes_only_bytes_80_to_87": True,
        "verified_dirent_sector_writes_only_original_extent_size_16_bytes": True,
        "config_record_patch_bytes": len(record_patch),
        "virtual_data_padding_bytes": size_padded - len(updated),
        "installer_only_initrd_edits": changes,
        "recovery_entries_byte_preserved": True,
        "original_vendor_config_on_disk_modified": False,
        "F_owned_probe_overlay_c_modified": False,
        "source_range_requests": iso.request_count,
        "source_range_bytes": iso.used,
        "http_etag": iso.etag,
        "http_last_modified": iso.modified,
        "serial_guest_loader_or_vendor_media_accepted": False,
    }
    (a.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("M05_OFFICIAL_PVE_GRUB_CFG_RECORD_AND_F_VIRTUAL_LAYOUT_PASS")
    print("M05_F_VENDOR_SELECTOR_AND_EFI_BOOT_NOT_TESTED")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError) as error:
        raise SystemExit("M05_ORIGINAL_VENDOR_CONFIG_SOURCE_FAIL: " + str(error))
