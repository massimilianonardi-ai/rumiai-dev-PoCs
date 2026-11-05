#!/usr/bin/env python3
"""M-05 source availability: compare real QEMU HTTPS block reads to strict Range.

Does not create a full ISO file, boot a vendor installer, or verify full hash.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] /
                       "082-m-boot-vendor-iso-readonly"))
from iso_range_inspect import ByteRangeISO, SECTOR  # existing verified reader


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", required=True)
    p.add_argument("--qemu-info", type=Path, required=True)
    p.add_argument("--qemu-pvd", type=Path, required=True)
    p.add_argument("--qemu-tail", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()

    if args.url != "https://enterprise.proxmox.com/iso/proxmox-ve_9.2-1.iso":
        raise ValueError("M05_REMOTE_SOURCE_UNPINNED")
    info = json.loads(args.qemu_info.read_text())
    expected_size = 1706178560
    if (info.get("format") != "raw" or
            info.get("virtual-size") != expected_size or
            not expected_size % SECTOR == 0):
        raise ValueError("M05_QEMU_REMOTE_LENGTH_OR_FORMAT_MISMATCH")

    source = ByteRangeISO(args.url, budget=8192)
    offsets = {
        "pvd": 16 * SECTOR,
        "tail": expected_size - 17 * SECTOR,
    }
    samples = {}
    for name, at in offsets.items():
        path = args.qemu_pvd if name == "pvd" else args.qemu_tail
        if path.stat().st_size != SECTOR:
            raise ValueError(f"M05_QEMU_{name.upper()}_READ_LENGTH_MISMATCH")
        raw = path.read_bytes()
        independent = source.read(at, SECTOR, f"independent strict Range {name}")
        if raw != independent:
            raise ValueError(f"M05_QEMU_{name.upper()}_RANGE_BYTES_DIFFER")
        samples[name] = {
            "offset": at,
            "length": SECTOR,
            "sha256": digest(raw),
            "qemu_equals_strict_http_range": True,
        }

    pvd = args.qemu_pvd.read_bytes()
    if pvd[:7] != b"\x01CD001\x01" or pvd[40:72].decode("ascii").strip() != "PVE":
        raise ValueError("M05_REMOTE_ISO9660_IDENTITY_UNEXPECTED")
    count = int.from_bytes(pvd[80:84], "little")
    if (count <= 0 or count * SECTOR > expected_size or
            int.from_bytes(pvd[84:88], "big") != count):
        raise ValueError("M05_REMOTE_ISO9660_SIZE_INVALID")

    if args.out.exists():
        raise ValueError("M05_REMOTE_REPORT_ALREADY_EXISTS")
    report = {
        "task": "M-05",
        "scope": "qemu_native_https_readonly_logical_original_iso_source_only",
        "qemu_source_url": args.url,
        "logical_iso_size": expected_size,
        "qemu_image_format": "raw",
        "iso9660_primary_volume_id": "PVE",
        "iso9660_volume_sectors": count,
        "sampled_qemu_block_reads": samples,
        "independent_strict_range_bytes": source.used,
        "independent_strict_range_requests": source.request_count,
        "independent_range_ledger": source.slices,
        "remote_etag": source.etag,
        "remote_last_modified": source.modified,
        "vendor_published_full_iso_sha256_NOT_INDEPENDENTLY_VERIFIED":
            "4e88fe416df9b527624a175f24c9aa07c714d3332afb1ee3dbf3879573ef2c6c",
        "full_iso_download_or_copy_performed": False,
        "complete_iso_sha256_recomputed": False,
        "qemu_guest_efi_boot_tested": False,
        "firmware_virtual_file_injection_tested": False,
        "proxmox_media_id_accepted": False,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print("M05_QEMU_HTTPS_ORIGINAL_ISO_LOGICAL_SOURCE_READ_PASS")
    print("M05_FULL_VENDOR_MEDIA_ACCEPTANCE_NOT_TESTED")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError, KeyError) as exc:
        raise SystemExit(f"M05_SOURCE_ONLY_FAILED: {exc}")
