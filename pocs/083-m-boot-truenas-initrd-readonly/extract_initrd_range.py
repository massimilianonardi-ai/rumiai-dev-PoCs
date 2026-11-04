#!/usr/bin/env python3
"""Extract ONLY the named initrd byte extent from an official ISO via HTTPS Range.

Never downloads the complete ISO and never claims full-ISO digest verification.
Unpacks nothing; subsequent CI extraction is data-only under a disposable dir.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

# Reuse the tested bounded ISO reader; no parallel HTTP implementation.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent /
                       "082-m-boot-vendor-iso-readonly"))
from iso_range_inspect import ByteRangeISO, iso_record, SECTOR  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", required=True)
    p.add_argument("--source-sha256", required=True)
    p.add_argument("--target", default="INITRD.IMG")
    p.add_argument("--expect-bytes", type=int, required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--manifest", required=True)
    args = p.parse_args()
    if not args.url.startswith("https://"):
        p.error("Requires HTTPS official endpoint")
    if not 0 < args.expect_bytes <= 64 * 1024 * 1024:
        p.error("Data-only extractor is bounded to a 64 MiB initrd")
    iso = ByteRangeISO(args.url, budget=65 * 1024 * 1024)
    desc = iso.read(16 * SECTOR, SECTOR, "primary ISO9660 descriptor")
    if desc[:7] != b"\x01CD001\x01":
        raise ValueError("Primary volume descriptor absent or invalid")
    root, _ = iso_record(desc, 156)
    parts = args.target.strip("/").split("/")
    if not parts or len(parts) > 5 or any(not p or p in (".", "..") for p in parts):
        raise ValueError("Unsafe or excessive vendor ISO target path")
    record = root
    for index, name in enumerate(parts):
        if not record["directory"] or record["bytes"] <= 0 or record["bytes"] > 512 * 1024:
            raise ValueError("Unsupported vendor ISO directory extent")
        data = iso.read(record["extent_lba"] * SECTOR, record["bytes"],
                        "ISO9660 directory " + "/".join(parts[:index]))
        offset = 0
        matches = []
        while offset < len(data):
            if not data[offset]:
                offset = (offset // SECTOR + 1) * SECTOR
                continue
            r, offset = iso_record(data, offset)
            if r and r["name"].casefold() == name.casefold():
                matches.append(r)
        if len(matches) != 1:
            raise ValueError("Expected one ISO directory entry: " + name)
        record = matches[0]
        if record["directory"] == (index == len(parts) - 1):
            raise ValueError("Vendor ISO path type mismatch: " + name)
    if record["bytes"] != args.expect_bytes:
        raise ValueError(f'Vendor initramfs size changed: {record["bytes"]}')
    hasher = hashlib.sha256()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as f:
        cursor = 0
        while cursor < record["bytes"]:
            amount = min(4 * 1024 * 1024, record["bytes"] - cursor)
            chunk = iso.read(record["extent_lba"] * SECTOR + cursor,
                             amount, f"exact file {args.target} segment")
            f.write(chunk)
            hasher.update(chunk)
            cursor += amount
    actual = output.stat().st_size
    if actual != args.expect_bytes:
        raise ValueError("Extracted file length not exact")
    magic = output.open("rb").read(16)
    result = {
        "inspection_status": "exact_initrd_file_observed",
        "source_url": args.url,
        "vendor_full_iso_sha256_NOT_VERIFIED": args.source_sha256,
        "remote_iso_bytes": iso.size,
        "initrd_file": args.target,
        "initrd_iso_lba": record["extent_lba"],
        "initrd_length": actual,
        "initrd_sha256_of_fetched_bytes": hasher.hexdigest(),
        "initrd_prefix_hex": magic.hex(),
        "range_requests": iso.request_count,
        "range_bytes_transferred": iso.used,
        "etag": iso.etag,
        "range_ledger": iso.slices,
    }
    Path(args.manifest).write_text(json.dumps(result, indent=2) + "\n")
    print("EXACT_VENDOR_INITRD_FETCH_PASS")
    print(f"initrd_sha256={hasher.hexdigest()}")
    print(f"initrd_size={actual}")
    print(f"initrd_magic={magic.hex()}")
    print(f"downloaded_bytes={iso.used}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as e:
        print("EXACT_VENDOR_INITRD_FETCH_FAILED " + str(e), file=sys.stderr)
        sys.exit(5)
