#!/usr/bin/env python3
"""PoC-only ISO9660 sector overlay backed by the original Ventoy img_chunk ABI.

Generates a small sidecar plus a real Linux dm-linear table. No EFI boot claim.
"""
import argparse
import hashlib
from pathlib import Path
import struct
import sys

BLOCK = 2048
CHUNK = struct.Struct("<IIQQ")
MAX_ISO = 128 * 1024 * 1024
MAX_REPLACE = 4 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def both32(x):
    require(0 <= x <= 0xffffffff, "ISO9660 sector/length overflow")
    return x.to_bytes(4, "little") + x.to_bytes(4, "big")


def extent(rec):
    require(len(rec) >= 34, "short ISO9660 directory record")
    lba = int.from_bytes(rec[2:6], "little")
    length = int.from_bytes(rec[10:14], "little")
    require(rec[2:10] == both32(lba) and rec[10:18] == both32(length),
            "inconsistent ISO9660 record endianness")
    return lba, length


def target_record(iso, path):
    parts = path.strip("/").split("/")
    require(parts and all(p and p not in (".", "..") and p.isascii() for p in parts),
            "invalid ISO9660 target path")
    pvd = iso[16 * BLOCK:17 * BLOCK]
    require(len(pvd) == BLOCK and pvd[:7] == b"\x01CD001\x01",
            "not a genuine ISO9660 PVD")
    current = pvd[156:190]
    start, size = extent(current)
    for index, component in enumerate(parts):
        require(size and start * BLOCK + size <= len(iso),
                "directory extent outside source ISO")
        cursor = 0
        found = None
        while cursor < size:
            absolute = start * BLOCK + cursor
            record_size = iso[absolute]
            if record_size == 0:
                cursor = (cursor // BLOCK + 1) * BLOCK
                continue
            require(34 <= record_size <= BLOCK - cursor % BLOCK and
                    absolute + record_size <= len(iso),
                    "corrupt ISO9660 directory record")
            name_length = iso[absolute + 32]
            require(0 < name_length <= record_size - 33,
                    "invalid ISO9660 name length")
            name = iso[absolute + 33:absolute + 33 + name_length].decode("ascii")
            if name.split(";")[0].upper() == component.upper():
                rec = iso[absolute:absolute + record_size]
                is_directory = bool(rec[25] & 2)
                require(is_directory == (index < len(parts) - 1),
                        "ISO9660 target is wrong file type")
                found = (absolute, rec)
                break
            cursor += record_size
        require(found is not None, "ISO9660 file not found: " + component)
        record_pos, current = found
        start, size = extent(current)
    require(start * BLOCK + size <= len(iso),
            "source ISO file extent outside volume")
    return record_pos, start, size


def checked_map(raw, size, part_start, part_length):
    require(raw and len(raw) % CHUNK.size == 0 and
            len(raw) // CHUNK.size <= 16384,
            "malformed original Ventoy chunk array")
    chunks = [CHUNK.unpack_from(raw, pos)
              for pos in range(0, len(raw), CHUNK.size)]
    logical = 0
    for start, end, physical, physical_end in chunks:
        require(start == logical and end >= start, "gapped Ventoy logical map")
        require(physical <= physical_end and
                physical_end - physical + 1 == (end - start + 1) * 4,
                "Ventoy map sector-size mismatch")
        require(part_start <= physical and
                physical_end < part_start + part_length,
                "Ventoy physical extent escapes source partition")
        logical = end + 1
    require(logical == size // BLOCK, "Ventoy map does not cover entire ISO")
    return chunks


def dm_table(chunks, partition, part_start, replacements,
             overlay_device, original_sectors, payload_sectors):
    rows = []
    for first, last, raw, _ in chunks:
        pos = first
        while pos <= last:
            if pos in replacements:
                rows.append((pos * 4, 4, overlay_device,
                             replacements[pos] * 4))
                pos += 1
            else:
                boundary = min((x for x in replacements
                                if pos < x <= last), default=last + 1)
                span = boundary - pos
                rows.append((pos * 4, span * 4, partition,
                             raw - part_start + (pos - first) * 4))
                pos += span
    rows.append((original_sectors * 4, payload_sectors * 4,
                 overlay_device, 8))
    expected = 0
    for offset, span, _, _ in rows:
        require(offset == expected and span > 0,
                "virtual mapping has gap/overlap")
        expected += span
    require(expected == (original_sectors + payload_sectors) * 4,
            "virtual volume not covered")
    return "".join(f"{a} {b} linear {device} {c}\n"
                   for a, b, device, c in rows), len(rows)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ("iso", "map", "partition", "overlay-device", "replacement",
                "overlay-image", "table", "target"):
        p.add_argument("--" + arg, required=True)
    p.add_argument("--partition-start", type=int, required=True)
    p.add_argument("--partition-size", type=int, required=True)
    a = p.parse_args()

    iso = Path(a.iso).read_bytes()
    replacement = Path(a.replacement).read_bytes()
    require(0 < len(iso) <= MAX_ISO and len(iso) % BLOCK == 0,
            "only aligned, bounded synthetic ISO is accepted")
    require(0 < len(replacement) <= MAX_REPLACE,
            "invalid replacement initrd size")
    require(a.partition.startswith("/dev/loop") and "p" in a.partition,
            "PoC requires a disposable loop partition")
    require(a.overlay_device.startswith("/dev/loop"),
            "PoC requires a separate file-backed loop")
    chunks = checked_map(Path(a.map).read_bytes(), len(iso),
                         a.partition_start, a.partition_size)
    record_pos, old_lba, old_size = target_record(iso, a.target)
    require(old_size > 0, "cannot replace an empty original file")
    total = len(iso) // BLOCK
    add_sectors = (len(replacement) + BLOCK - 1) // BLOCK
    virtual_total = total + add_sectors
    pvd = bytearray(iso[16*BLOCK:17*BLOCK])
    require(int.from_bytes(pvd[80:84], "little") <= total,
            "original PVD volume exceeds image")
    pvd[80:88] = both32(virtual_total)
    dir_sector = record_pos // BLOCK
    require(dir_sector != 16, "target directory aliases PVD")
    directory = bytearray(iso[dir_sector*BLOCK:(dir_sector+1)*BLOCK])
    offset = record_pos % BLOCK
    require(offset + 18 <= BLOCK, "ISO9660 entry crosses a sector")
    directory[offset + 2:offset + 18] = both32(total) + both32(len(replacement))
    padded = replacement.ljust(add_sectors * BLOCK, b"\x00")
    Path(a.overlay_image).write_bytes(bytes(pvd) + bytes(directory) + padded)
    table, rows = dm_table(chunks, a.partition, a.partition_start,
                           {16: 0, dir_sector: 1}, a.overlay_device,
                           total, add_sectors)
    Path(a.table).write_text(table)
    print(f"ISO_OVERLAY_TABLE_READY extent_count={len(chunks)} rows={rows}"
          f" original_file_lba={old_lba} old_size={old_size}"
          f" new_file_lba={total} new_size={len(replacement)}"
          f" original_sha256={hashlib.sha256(iso).hexdigest()}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, UnicodeError, struct.error) as exc:
        print(f"ISO_OVERLAY_REJECTED: {exc}", file=sys.stderr)
        sys.exit(1)
