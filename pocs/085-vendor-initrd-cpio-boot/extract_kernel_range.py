#!/usr/bin/env python3
"""Read-only extraction of one exact vendor kernel file via strict HTTP Range.

Reuses canonical PoC 082's bound/identity-checking ISO reader. Never fetches
the complete ISO; never claims its digest was independently checked.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent /
                       "082-m-boot-vendor-iso-readonly"))
from iso_range_inspect import ByteRangeISO, iso_record, SECTOR


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--source-sha256", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--manifest", required=True)
    args = p.parse_args()
    if not args.url.startswith("https://"):
        p.error("HTTPS official vendor origin required")
    iso = ByteRangeISO(args.url, budget=32 * 1024 * 1024)
    pvd = iso.read(16 * SECTOR, SECTOR, "ISO9660 primary descriptor")
    if pvd[:7] != b"\x01CD001\x01":
        raise ValueError("Invalid ISO9660 primary descriptor")
    root, _ = iso_record(pvd, 156)
    parts = args.target.strip("/").split("/")
    if not 1 <= len(parts) <= 4 or any(x in ("", ".", "..") for x in parts):
        raise ValueError("Invalid kernel ISO path")
    entry = root
    for pos, component in enumerate(parts):
        if not entry["directory"] or entry["bytes"] > 512 * 1024:
            raise ValueError("Unsupported vendor directory")
        buf = iso.read(entry["extent_lba"] * SECTOR,
                       entry["bytes"], "kernel parent directory")
        cur = 0
        candidates = []
        while cur < len(buf):
            if buf[cur] == 0:
                cur = (cur // SECTOR + 1) * SECTOR
                continue
            found, cur = iso_record(buf, cur)
            if found and found["name"].casefold() == component.casefold():
                candidates.append(found)
        if len(candidates) != 1:
            raise ValueError("Missing or ambiguous exact ISO kernel path")
        entry = candidates[0]
        if entry["directory"] == (pos == len(parts) - 1):
            raise ValueError("Incorrect kernel path type")
    if not 1_000_000 <= entry["bytes"] <= 24 * 1024 * 1024:
        raise ValueError(f"Unexpected vendor kernel file length {entry['bytes']}")
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with target.open("xb") as fp:
        for pos in range(0, entry["bytes"], 4 * 1024 * 1024):
            amount = min(4 * 1024 * 1024, entry["bytes"] - pos)
            b = iso.read(entry["extent_lba"] * SECTOR + pos,
                         amount, "exact vendor kernel bytes")
            fp.write(b)
            hasher.update(b)
    result = {
        "source_url": args.url,
        "source_full_iso_vendor_sha256_NOT_verified": args.source_sha256,
        "target": args.target,
        "kernel_size": entry["bytes"],
        "kernel_sha256_of_fetched_bytes": hasher.hexdigest(),
        "kernel_iso_extent_lba": entry["extent_lba"],
        "range_requests": iso.request_count,
        "range_bytes_transferred": iso.used,
        "range_ledger": iso.slices,
    }
    Path(args.manifest).write_text(json.dumps(result, indent=2) + "\n")
    print(f"VT085_REAL_KERNEL_RANGE_FETCH_PASS bytes={entry['bytes']} sha256={hasher.hexdigest()}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        sys.exit(f"VT085_REAL_KERNEL_RANGE_FETCH_FAILED: {exc}")
