#!/usr/bin/env python3
"""Read-only, bounded HTTP Range ISO9660/El-Torito inventory.

Never download a complete image. Fail closed on non-206 replies, inconsistent
Content-Range or unsupported ISO directory topology. This is not an installer
boot test and cannot certify full-image SHA256 without complete ISO bytes.
"""
import argparse
import json
import re
import struct
import sys
import urllib.error
import urllib.request
from pathlib import PurePosixPath

SECTOR = 2048
READ_BUDGET = 12 * 1024 * 1024
MAX_REQUEST = 256 * 1024
MAX_ENTRIES = 1200
MAX_DEPTH = 5
MAX_FILE_PREVIEW = 32 * 1024
PREVIEW_SUFFIXES = (".cfg", ".conf", ".txt", ".md", ".lst", ".cmdline", ".grub")
BOOT_WORDS = ("initrd", "initramfs", "vmlinuz", "linux", "boot", "grub",
              "efi", "isolinux", "live", "pxelinux", "casper", "truenas",
              "proxmox", "pve", "squashfs", "img")


class RemoteISO:
    def __init__(self, url):
        if not url.startswith("https://"):
            raise ValueError("HTTPS URL required")
        self.url = url
        self.total = None
        self.transferred = 0
        self.calls = 0

    def read(self, offset, length):
        if offset < 0 or length <= 0 or length > MAX_REQUEST:
            raise ValueError("out-of-bounds range")
        if self.transferred + length > READ_BUDGET:
            raise ValueError("12 MiB aggregate read budget exceeded")
        end = offset + length - 1
        headers = {"Range": f"bytes={offset}-{end}",
                   "User-Agent": "RumiAI-PoC082-read-only-ISO-inspector/1"}
        request = urllib.request.Request(self.url, headers=headers)
        with urllib.request.urlopen(request, timeout=35) as response:
            if response.status != 206:
                raise ValueError(f"server did not honor HTTP Range: {response.status}")
            match = re.fullmatch(
                r"bytes\s+(\d+)-(\d+)/(\d+)",
                response.headers.get("Content-Range", "").strip())
            if not match:
                raise ValueError("missing/malformed Content-Range")
            start, last, total = map(int, match.groups())
            if start != offset or last != end or total <= end:
                raise ValueError("Content-Range does not match requested bytes")
            if self.total is not None and total != self.total:
                raise ValueError("remote ISO size changed during inspection")
            self.total = total
            data = response.read(length + 1)
        if len(data) != length:
            raise ValueError("incorrect byte count for range response")
        self.transferred += length
        self.calls += 1
        return data


def le32(b):
    return struct.unpack("<I", b)[0]


def record(buf, pos):
    if pos + 34 > len(buf):
        return None
    size = buf[pos]
    if size == 0:
        return None
    if size < 34 or pos + size > len(buf):
        raise ValueError("invalid ISO9660 directory entry length")
    data = buf[pos:pos + size]
    namelen = data[32]
    if 33 + namelen > len(data):
        raise ValueError("invalid ISO9660 filename length")
    name = data[33:33 + namelen]
    if name in (b"\0", b"\1"):
        return {"special": True, "record_length": size}
    label = name.decode("ascii", "replace").split(";")[0]
    return {"name": label, "extent": le32(data[2:6]),
            "size": le32(data[10:14]), "directory": bool(data[25] & 2),
            "record_length": size, "flags": data[25]}


def parse_directory(remote, start_lba, byte_count, parent, depth, output, seen):
    if depth > MAX_DEPTH or byte_count > 2 * 1024 * 1024:
        raise ValueError("directory exceeds inspection limits")
    if start_lba in seen:
        return
    seen.add(start_lba)
    rounded = (byte_count + SECTOR - 1) // SECTOR * SECTOR
    raw = bytearray()
    for offset in range(0, rounded, MAX_REQUEST):
        length = min(MAX_REQUEST, rounded - offset)
        raw.extend(remote.read(start_lba * SECTOR + offset, length))
    cursor = 0
    while cursor < byte_count:
        if len(output) >= MAX_ENTRIES:
            raise ValueError("ISO directory-entry budget exceeded")
        r = record(raw, cursor)
        if r is None:
            cursor = (cursor // SECTOR + 1) * SECTOR
            continue
        cursor += r["record_length"]
        if r.get("special"):
            continue
        path = f"{parent}/{r['name']}"
        entry = {"path": path, "size": r["size"], "extent": r["extent"],
                 "type": "dir" if r["directory"] else "file"}
        output.append(entry)
        if r["directory"]:
            if depth < MAX_DEPTH:
                parse_directory(remote, r["extent"], r["size"], path,
                                depth + 1, output, seen)


def inspect(url, label):
    image = RemoteISO(url)
    pvd = image.read(16 * SECTOR, SECTOR)
    if pvd[:7] != b"\x01CD001\x01":
        raise ValueError("no ISO9660 primary volume descriptor at LBA16")
    root = record(pvd, 156)
    # Root is a special entry and has no printable filename.
    if root is None or pvd[156] < 34:
        raise ValueError("invalid root directory record")
    root_lba = le32(pvd[158:162])
    root_size = le32(pvd[166:170])
    volume_space = le32(pvd[80:84])
    volume = pvd[40:72].decode("ascii", "replace").strip()
    if image.total and volume_space * SECTOR > image.total:
        raise ValueError("ISO9660 volume exceeds HTTP remote object")
    if not root_lba or not root_size:
        raise ValueError("invalid root extent/size")
    descriptors = []
    for lba in range(16, 32):
        desc = pvd if lba == 16 else image.read(lba * SECTOR, SECTOR)
        if desc[1:6] != b"CD001":
            raise ValueError("ISO9660 volume descriptor signature mismatch")
        dtype = desc[0]
        entry = {"sector": lba, "type": dtype}
        if dtype == 0 and b"EL TORITO SPECIFICATION" in desc[:48]:
            catalog_lba = le32(desc[71:75])
            catalog = image.read(catalog_lba * SECTOR, SECTOR)
            entry["el_torito"] = {"catalog_lba": catalog_lba,
                                  "validation_header": catalog[:2].hex(),
                                  "boot_signature": catalog[30:32].hex(),
                                  "initial_boot": catalog[32:48].hex()}
        descriptors.append(entry)
        if dtype == 255:
            break
    if descriptors[-1]["type"] != 255:
        raise ValueError("volume descriptors did not terminate")
    entries = []
    parse_directory(image, root_lba, root_size, "", 0, entries, set())
    candidates = []
    for entry in entries:
        if entry["type"] != "file":
            continue
        path = entry["path"]
        name = path.lower()
        if not any(word in name for word in BOOT_WORDS):
            continue
        item = dict(entry)
        if entry["size"] > 0 and any(name.endswith(x) for x in PREVIEW_SUFFIXES):
            length = min(entry["size"], MAX_FILE_PREVIEW)
            try:
                raw = image.read(entry["extent"] * SECTOR, length)
                text = raw.decode("utf-8", "replace")
                if sum(ch.isprintable() or ch in "\n\r\t" for ch in text) * 10 >= len(text) * 9:
                    item["text_preview"] = text[:MAX_FILE_PREVIEW]
            except ValueError as exc:
                item["preview_error"] = str(exc)
        elif entry["size"] > 0:
            head = image.read(entry["extent"] * SECTOR, min(entry["size"], 32))
            item["first_32_bytes_hex"] = head.hex()
            if head.startswith(b"\x1f\x8b"):
                item["signature"] = "gzip"
            elif head.startswith(b"\xfd7zXZ\x00"):
                item["signature"] = "xz"
            elif head.startswith(b"\x28\xb5\x2f\xfd"):
                item["signature"] = "zstd"
            elif head.startswith(b"070701"):
                item["signature"] = "cpio-newc"
            elif head.startswith(b"hsqs"):
                item["signature"] = "squashfs"
        candidates.append(item)
    return {"label": label, "url": url, "content_length": image.total,
            "volume": volume, "iso9660_sectors": volume_space,
            "descriptors": descriptors, "entries_seen": len(entries),
            "relevant_entries": candidates,
            "http_range_requests": image.calls,
            "remote_bytes_read": image.transferred,
            "verification_boundary": ("No full ISO download, no full SHA256 verification, "
                                      "no boot execution; ISO9660 primary tree only.")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        result = inspect(args.url, args.label)
    except Exception as exc:
        result = {"label": args.label, "url": args.url, "status": "blocked",
                  "reason": f"{type(exc).__name__}: {exc}",
                  "verification_boundary": "No installer claims permitted."}
        exit_code = 2
    else:
        result["status"] = "inspected"
        exit_code = 0
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps({k: v for k, v in result.items() if k != "relevant_entries"}))
    if exit_code == 0:
        print("BOOT_CANDIDATES")
        for x in result["relevant_entries"]:
            print(f"  {x['path']} bytes={x['size']} signature={x.get('signature','-')}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
