#!/usr/bin/env python3
"""Strict read-only HTTP-Range ISO9660 boot metadata explorer.

Intended for independent public *vendor* ISO objects without materializing a
multi-GB ISO. This deliberately does not claim full-image SHA256 verification.
No root, mount, block device, or installer execution is involved.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

SECTOR = 2048
RANGE_HEADER = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
BOOT_NAMES = re.compile(
    r"(^|/)(linux26|[^/]*cd-id[^/]*|grub\.cfg|grub\.conf|isolinux\.cfg|syslinux\.cfg|"
    r"menu\.cfg|txt\.cfg|linux\.cfg|initrd[^/]*|initramfs[^/]*|"
    r"vmlinuz[^/]*|kernel[^/]*|bootx64\.efi|"
    r"[^/]*\.pve-cd-id[^/]*|[^/]*\.squashfs)$", re.I
)
TEXT_NAMES = re.compile(
    r"(\.cfg|\.conf|\.lst|\.txt|\.cmdline|\.ipxe)$", re.I
)


def le32(data):
    return int.from_bytes(data, "little")


class ByteRangeISO:
    """Each request must honor Range. An accidental HTTP 200 is rejected."""

    def __init__(self, url, budget):
        self.url = url
        self.budget = budget
        self.used = 0
        self.request_count = 0
        self.size = None
        self.etag = None
        self.modified = None
        self.slices = []

    def read(self, start, length, why):
        if start < 0 or not 0 < length <= 4 * 1024 * 1024:
            raise ValueError("Out-of-bounds or oversized range request")
        if self.size is not None and start + length > self.size:
            raise ValueError(f"Range exceeds remote ISO size: {why}")
        if self.used + length > self.budget:
            raise ValueError("Strict transferred-byte budget exceeded")
        req = urllib.request.Request(
            self.url,
            headers={
                "Range": f"bytes={start}-{start + length - 1}",
                "Accept-Encoding": "identity",
                "User-Agent": "RumiAI-readonly-ISO9660-probe/1",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                code = response.status
                content_range = response.headers.get("Content-Range", "")
                match = RANGE_HEADER.fullmatch(content_range.strip())
                if code != 206 or not match:
                    raise ValueError(
                        f"HTTP Range unsupported: status={code}, "
                        f"Content-Range={content_range!r}; refusal to fetch ISO"
                    )
                a, b, n = map(int, match.groups())
                if (a, b) != (start, start + length - 1):
                    raise ValueError("Server returned a different byte range")
                if self.size is not None and self.size != n:
                    raise ValueError("ISO byte length changed during inspection")
                self.size = n
                etag = response.headers.get("ETag")
                modified = response.headers.get("Last-Modified")
                if self.etag and etag and self.etag != etag:
                    raise ValueError("ISO ETag changed during inspection")
                if self.modified and modified and self.modified != modified:
                    raise ValueError("ISO Last-Modified changed")
                self.etag = self.etag or etag
                self.modified = self.modified or modified
                payload = response.read(length + 1)
                if len(payload) != length:
                    raise ValueError("Truncated or oversized ranged response")
                self.used += len(payload)
                self.request_count += 1
                self.slices.append({
                    "reason": why,
                    "start": start,
                    "length": length,
                    "sha256_of_fetched_slice": hashlib.sha256(payload).hexdigest(),
                })
                return payload
        except urllib.error.HTTPError as error:
            raise ValueError(
                f"HTTP {error.code}: {error.reason}; URL may not allow range access"
            ) from error


def iso_record(buf, at, joliet=False):
    length = buf[at]
    if not length:
        return None, at + 1
    if length < 34 or at + length > len(buf):
        raise ValueError("Malformed ISO9660 directory record")
    record = buf[at:at + length]
    extent = le32(record[2:6])
    size = le32(record[10:14])
    if extent == 0 and size > 0:
        raise ValueError("ISO9660 extent zero with nonempty file")
    if int.from_bytes(record[6:10], "big") != extent:
        raise ValueError("ISO9660 extent endian mismatch")
    if int.from_bytes(record[14:18], "big") != size:
        raise ValueError("ISO9660 size endian mismatch")
    length_name = record[32]
    if length_name > length - 33:
        raise ValueError("Malformed ISO9660 name length")
    raw_name = record[33:33 + length_name]
    if length_name == 1 and raw_name in (b"\x00", b"\x01"):
        name = "." if raw_name == b"\x00" else ".."
    else:
        name = raw_name.decode("utf-16-be" if joliet else "ascii", "replace")
        name = name.split(";")[0].rstrip(".")
    return {
        "name": name,
        "extent_lba": extent,
        "bytes": size,
        "directory": bool(record[25] & 0x02),
        "iso9660_flags": record[25],
    }, at + length


def traverse(iso, root, joliet, label):
    queue = deque([(label, root, 0)])
    visited = set()
    files = []
    errors = []
    while queue and len(visited) < 150:
        path, obj, depth = queue.popleft()
        ident = (obj["extent_lba"], obj["bytes"])
        if ident in visited:
            continue
        visited.add(ident)
        size = obj["bytes"]
        if size == 0 or size > 512 * 1024:
            errors.append(f"directory skipped: {path} has {size} bytes")
            continue
        data = iso.read(obj["extent_lba"] * SECTOR, size, f"directory {path}")
        offset = 0
        while offset < len(data):
            if data[offset] == 0:
                offset = (offset // SECTOR + 1) * SECTOR
                continue
            record, offset = iso_record(data, offset, joliet)
            if record is None or record["name"] in (".", ".."):
                continue
            child = path + "/" + record["name"]
            record["path"] = child
            files.append(record)
            if record["directory"] and depth < 5:
                queue.append((child, record, depth + 1))
    if queue:
        errors.append("directory traversal stopped at 150 entries")
    return files, errors


def inspect(args):
    iso = ByteRangeISO(args.url, budget=args.max_bytes)
    descriptors = iso.read(16 * SECTOR, 64 * SECTOR, "ISO volume descriptors")
    pvd = None
    joliet_svd = None
    boot = None
    for offset in range(0, len(descriptors), SECTOR):
        block = descriptors[offset:offset + SECTOR]
        if block[1:6] != b"CD001":
            if offset == 0:
                raise ValueError("No ISO9660 volume descriptor at sector 16")
            break
        if block[0] == 1:
            pvd = block
        if block[0] == 2 and block[88:91] in (b"%/@", b"%/C", b"%/E"):
            joliet_svd = block
        if block[0] == 0 and block[7:30].startswith(b"EL TORITO SPECIFICATION"):
            boot = block
        if block[0] == 255:
            break
    if pvd is None:
        raise ValueError("No ISO9660 primary volume descriptor")
    sector_count = le32(pvd[80:84])
    root, _ = iso_record(pvd, 156)
    if sector_count * SECTOR > iso.size:
        raise ValueError("ISO9660 volume size exceeds remote object")
    report = {
        "name": args.name,
        "source": args.url,
        "expected_full_iso_sha256_from_vendor_NOT_VERIFIED": args.sha256,
        "metadata_level": "RANGED_BYTES_ONLY_NOT_FULL_ISO_INTEGRITY",
        "remote_size": iso.size,
        "iso9660_sectors": sector_count,
        "pvd_volume_identifier": pvd[40:72].decode("ascii", "replace").strip(),
        "joliet_present": bool(joliet_svd),
        "el_torito_present": bool(boot),
    }
    if boot:
        catalog_lba = le32(boot[71:75])
        catalog = iso.read(catalog_lba * SECTOR, SECTOR, "El Torito boot catalog")
        report["el_torito_catalog"] = {
            "lba": catalog_lba,
            "validation_signature": catalog[30:32].hex(),
            "default_platform": catalog[1],
            "initial_entry_bootable": catalog[32] == 0x88,
            "initial_entry_lba": le32(catalog[40:44]),
        }
    files, errors = traverse(iso, root, False, "PVD")
    if joliet_svd is not None:
        jroot, _ = iso_record(joliet_svd, 156)
        jfiles, jerrors = traverse(iso, jroot, True, "JOLIET")
        files.extend(jfiles)
        errors.extend(jerrors)
    files = sorted(files, key=lambda f: (f["path"].lower(), f["extent_lba"]))
    report["directory_file_count"] = len(files)
    report["traversal_warnings"] = errors
    report["boot_relevant_files"] = [
        f for f in files if BOOT_NAMES.search(f["path"])
        and not f["directory"]
    ][:250]
    text_files = []
    for f in files:
        if not f["directory"] and TEXT_NAMES.search(f["path"]) and (
            "/boot/" in f["path"].lower()
            or "/efi/" in f["path"].lower()
            or "/isolinux/" in f["path"].lower()
        ) and f["bytes"] <= 64 * 1024:
            text_files.append(f)
    for f in text_files[:24]:
        try:
            data = iso.read(f["extent_lba"] * SECTOR, f["bytes"],
                            "text boot configuration " + f["path"])
            f["utf8_excerpt"] = data.decode("utf-8", "replace")[:12000]
        except ValueError as error:
            f["read_error"] = str(error)
    report["boot_configuration_files"] = text_files[:24]
    identities = []
    for f in files:
        if f["directory"] or f["bytes"] <= 0 or f["bytes"] > 4096:
            continue
        if "cd-id" not in f["path"].casefold() and not f["path"].casefold().endswith(".cd-info"):
            continue
        raw = iso.read(f["extent_lba"] * SECTOR, f["bytes"],
                       "original ISO media identity file " + f["path"])
        identities.append({"path": f["path"], "bytes": f["bytes"],
                           "utf8_excerpt": raw.decode("utf-8", "replace")[:1500],
                           "sha256_of_whole_small_file": hashlib.sha256(raw).hexdigest()})
    report["media_identity_files"] = identities[:15]
    small_samples = []
    for f in report["boot_relevant_files"]:
        if re.search(r"(initrd|initramfs|vmlinuz|kernel)", f["path"], re.I):
            amount = min(4096, f["bytes"])
            if amount:
                data = iso.read(f["extent_lba"] * SECTOR, amount,
                                "boot binary signature " + f["path"])
                small_samples.append({
                    "path": f["path"],
                    "byte_length": f["bytes"],
                    "prefix_hex": data[:32].hex(),
                    "sample_length": amount,
                    "sha256_of_prefix_NOT_FULL_FILE": hashlib.sha256(data).hexdigest(),
                })
    report["boot_file_prefixes"] = small_samples[:80]
    report["bytes_actually_transferred"] = iso.used
    report["range_request_count"] = iso.request_count
    report["range_ledger"] = iso.slices
    report["remote_etag"] = iso.etag
    report["remote_last_modified"] = iso.modified
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-bytes", type=int, default=32 * 1024 * 1024)
    args = parser.parse_args()
    if not args.url.startswith("https://"):
        parser.error("Only HTTPS vendor URLs are accepted")
    if not re.fullmatch("[0-9a-f]{64}", args.sha256):
        parser.error("Expected vendor digest must be 64 hex chars")
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        report = inspect(args)
        report["inspection_status"] = "metadata_observed"
    except (ValueError, UnicodeError, OSError) as error:
        report = {
            "name": args.name, "source": args.url,
            "inspection_status": "inconclusive",
            "failure": str(error),
            "full_iso_sha256_verified": False,
        }
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("ISO_INSPECTION_STATUS=" + report["inspection_status"])
    print("vendor=" + args.name)
    if report["inspection_status"] == "metadata_observed":
        print("volume=" + report["pvd_volume_identifier"])
        print("boot_entries=" + str(len(report["boot_relevant_files"])))
        print("transferred_bytes=" + str(report["bytes_actually_transferred"]))
        for item in report["boot_relevant_files"][:35]:
            print(f'BOOT_FILE {item["path"]} {item["bytes"]}')
        return 0
    print("reason=" + report["failure"])
    return 5


if __name__ == "__main__":
    sys.exit(main())
