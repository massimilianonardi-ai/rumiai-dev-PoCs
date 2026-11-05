#!/usr/bin/env python3
"""Independently check actual qemu-io remote-backed COW bytes against exact patches.

Reuse PoC 093's accepted real QEMU hexdump decoder and PoC 082 strict ranges.
"""
import argparse
import hashlib
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "082-m-boot-vendor-iso-readonly"))
from iso_range_inspect import ByteRangeISO, SECTOR  # noqa: E402

read_qemu = runpy.run_path(
    str(ROOT / "093-m-boot-proxmox-range-backed-source" / "verify-qemu-source.py")
)["read_qemu_hexdump"]


def check_equal(data, expected, name):
    if data != expected:
        raise ValueError("M05_QEMU_COW_BYTES_MISMATCH_" + name)


def hash256(data):
    return hashlib.sha256(data).hexdigest()


def run(args):
    c = args.config
    q = args.qemu
    meta = json.loads((c / "report.json").read_text())
    info = json.loads((q / "qemu-info.json").read_text())
    if info.get("format") != "qcow2" or info.get("backing-filename") != meta["official_source"]:
        raise ValueError("M05_QEMU_BACKING_NOT_PINNED_OFFICIAL")
    if info.get("virtual-size") != meta["virtual_iso_sectors"] * SECTOR:
        raise ValueError("M05_QEMU_VIRTUAL_SIZE_MISMATCH")
    pvd = read_qemu(q / "read-pvd.hex", 16 * SECTOR)
    direc = read_qemu(q / "read-dirent.hex", meta["original_dirent_sector_start"])
    check_equal(pvd, (c / "pvd-sector-patched.bin").read_bytes(), "PVD_SECTOR")
    check_equal(direc, (c / "dirent-sector-patched.bin").read_bytes(), "CONFIG_RECORD_SECTOR")
    padded = (c / "virtual-data-padded.bin").read_bytes()
    if not padded or len(padded) % SECTOR or len(padded) > 65536:
        raise ValueError("M05_QEMU_COW_APPENDED_REGION_INVALID")
    actual_chunks = [
        read_qemu(q / ("read-virtual-" + str(i) + ".hex"),
                  meta["virtual_sector_data_start"] + i * SECTOR)
        for i in range(len(padded) // SECTOR)
    ]
    check_equal(b"".join(actual_chunks), padded, "APPENDED_CONFIG_PAYLOAD")

    # Fresh official byte ranges independently prove we didn't accidentally
    # write back to the remote source (at the only modified original sectors).
    iso = ByteRangeISO(meta["official_source"], budget=8192)
    original_pvd = iso.read(16 * SECTOR, SECTOR, "verify unchanged original remote PVD")
    original_dir = iso.read(meta["original_dirent_sector_start"], SECTOR,
                            "verify unchanged original remote config dirent sector")
    if original_pvd[80:88] == pvd[80:88]:
        raise ValueError("M05_REMOTE_SOURCE_UNEXPECTEDLY_ALREADY_PATCHED")
    check_equal(pvd[:80] + pvd[88:],
                original_pvd[:80] + original_pvd[88:],
                "UNMODIFIED_ORIGINAL_PVD_BYTES")
    rel = meta["original_config_record_override_start"] - meta["original_dirent_sector_start"]
    check_equal(direc[:rel] + direc[rel + 16:],
                original_dir[:rel] + original_dir[rel + 16:],
                "UNMODIFIED_ORIGINAL_DIRECTORY_BYTES")
    if meta["http_etag"] and iso.etag and meta["http_etag"] != iso.etag:
        raise ValueError("M05_OFFICIAL_SOURCE_CHANGED_ETAG")
    guest_modified_source = meta["original_vendor_config_on_disk_modified"]
    if guest_modified_source:
        raise ValueError("M05_ORIGINAL_SOURCE_MUTATION_CLAIM")

    report = {
        "scope": "qemu_remote_official_iso_qcow2_readonly_guest_virtual_sector_view",
        "original_source": meta["official_source"],
        "source_remote_size_bytes": meta["original_iso_size"],
        "original_source_http_etag": iso.etag,
        "original_iso_sha256_vendor_published_NOT_INDEPENDENTLY_VERIFIED":
            meta["original_full_iso_sha256_vendor_published_NOT_VERIFIED"],
        "qemu_overlay_virtual_size": info["virtual-size"],
        "qemu_overlay_local_bytes": (q / "official-iso-readonly-guest-shadow.qcow2").stat().st_size,
        "sector_modification_scope": [
            "PVD only ISO9660 volume-size 8 bytes",
            "real GRUB ISO9660 dirent only extent+size 16 bytes",
            "append replacement config bytes at end of original virtual size",
        ],
        "qemu_pvd_sector_sha256": hash256(pvd),
        "qemu_directory_sector_sha256": hash256(direc),
        "qemu_appended_config_sha256": hash256(padded),
        "source_original_byte_ranges_revalidated_bytes": iso.used,
        "qemu_guest_uses_read_only_cd": False,
        "original_vendor_EFI_boot_and_media_acceptance_tested": False,
        "F_owner_source_and_firmware_code_unchanged": True,
    }
    if args.out.exists():
        raise ValueError("M05_COW_VERIFICATION_REPORT_ALREADY_EXISTS")
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print("M05_REMOTE_ORIGINAL_PVE_ISO_COW_VIRTUAL_CONFIG_SECTORS_PASS")
    print("M05_ORIGINAL_VENDOR_EFI_BOOT_NOT_YET_PROVEN_BY_SECTOR_CHECK")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--qemu", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    try:
        run(args)
    except (OSError, ValueError, UnicodeError, KeyError) as error:
        raise SystemExit("M05_QEMU_COW_SHADOW_FAILED: " + str(error))


if __name__ == "__main__":
    main()
