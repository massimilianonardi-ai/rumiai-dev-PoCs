#!/usr/bin/env python3
"""Experimental Linux consumer of original Ventoy img_chunk extent ABI.

FIEMAP is used here only to emulate the already verified GRUB chunk producer
on a disposable ext4 fixture. This does NOT test an EFI -> Linux transport.
"""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import struct
import sys

FIEMAP = 0xC020660B
FIEMAP_HDR = struct.Struct('<QQIIII')
FIEMAP_EXT = struct.Struct('<QQQQQIIII')
CHUNK = struct.Struct('<IIQQ')
SECTOR = 512
ISO_SECTOR = 2048
MAX_EXTENTS = 16384


def checked(ok, reason):
    if not ok:
        raise ValueError(reason)


def partition_start(device):
    name = Path(device).name
    checked(name.startswith('loop') and 'p' in name,
            'PoC only accepts a loop-backed partition device')
    sysdir = Path('/sys/class/block') / name
    checked(sysdir.exists(), 'partition not found in sysfs')
    value = int((sysdir / 'start').read_text().strip())
    checked(value > 0, 'invalid partition start')
    return value


def fiemap_extents(image):
    image_size = os.stat(image).st_size
    checked(image_size >= 19 * ISO_SECTOR and image_size % ISO_SECTOR == 0,
            'ISO must have a 2048-byte-aligned size')
    count = MAX_EXTENTS
    buf = bytearray(FIEMAP_HDR.size + count * FIEMAP_EXT.size)
    FIEMAP_HDR.pack_into(buf, 0, 0, image_size, 1, 0, count, 0)
    with open(image, 'rb', buffering=0) as fp:
        fcntl.ioctl(fp.fileno(), FIEMAP, buf, True)
    _, _, _, n, _, _ = FIEMAP_HDR.unpack_from(buf)
    checked(0 < n < MAX_EXTENTS, 'empty or truncated FIEMAP')
    spans = []
    expected = 0
    for ix in range(n):
        logical, physical, length, _, _, flags, _, _, _ = FIEMAP_EXT.unpack_from(buf, FIEMAP_HDR.size + ix * FIEMAP_EXT.size)
        checked(logical == expected and length > 0, 'sparse/overlapping image extent')
        checked((logical | physical | length) % ISO_SECTOR == 0,
                'extent cannot be represented in Ventoy ISO sector ABI')
        checked(flags & ~1 == 0, 'FIEMAP extent is not ordinary allocated data')
        end = min(logical + length, image_size)
        checked(end > logical, 'FIEMAP extent past file end')
        spans.append((logical, physical, end - logical))
        expected = end
    checked(expected == image_size and (flags & 1),
            'FIEMAP map does not cover complete image')
    checked(len(spans) >= 2, 'fixture is not physically fragmented')
    return spans


def chunks_from_spans(spans, start_sector):
    return [(logical // ISO_SECTOR,
             (logical + length) // ISO_SECTOR - 1,
             start_sector + physical // SECTOR,
             start_sector + (physical + length) // SECTOR - 1)
            for logical, physical, length in spans]


def write_chunks(path, chunks):
    Path(path).write_bytes(b''.join(CHUNK.pack(*c) for c in chunks))


def parse_chunks(path):
    raw = Path(path).read_bytes()
    checked(raw and len(raw) % CHUNK.size == 0 and
            len(raw) // CHUNK.size <= MAX_EXTENTS, 'malformed Ventoy chunk array')
    return [CHUNK.unpack_from(raw, pos) for pos in range(0, len(raw), CHUNK.size)]


def validate(chunks, iso, disk, part_start):
    size = os.stat(iso).st_size
    # st_size is normally 0 for Linux block special files.
    with open(disk, "rb", buffering=0) as size_probe:
        disk_size = size_probe.seek(0, os.SEEK_END)
    checked(size > 0 and size % ISO_SECTOR == 0, 'invalid ISO size')
    expected = 0
    sha_src = hashlib.sha256()
    sha_dst = hashlib.sha256()
    with open(iso, 'rb', buffering=0) as source, open(disk, 'rb', buffering=0) as backing:
        source.seek(16 * ISO_SECTOR + 1)
        checked(source.read(5) == b'CD001', 'not an ISO9660 image')
        for ix, (image_start, image_end, disk_start, disk_end) in enumerate(chunks):
            checked(image_start == expected and image_end >= image_start,
                    f'ISO logical extent gap/overlap at index {ix}')
            sectors = (image_end - image_start + 1) * 4
            checked(disk_end >= disk_start and
                    disk_end - disk_start + 1 == sectors,
                    f'inconsistent sector geometry at index {ix}')
            checked(disk_start >= part_start and (disk_end + 1) * SECTOR <= disk_size,
                    f'physical range outside backing disk at index {ix}')
            remaining = sectors * SECTOR
            source.seek(image_start * ISO_SECTOR)
            backing.seek(disk_start * SECTOR)
            while remaining:
                n = min(remaining, 1024 * 1024)
                data, raw = source.read(n), backing.read(n)
                checked(len(data) == n and len(raw) == n and data == raw,
                        f'raw disk differs from ISO at extent {ix}')
                sha_src.update(data)
                sha_dst.update(raw)
                remaining -= n
            expected = image_end + 1
    checked(expected == size // ISO_SECTOR, 'chunk map does not cover entire ISO')
    checked(sha_src.digest() == sha_dst.digest(), 'ISO SHA256 mismatch')
    return sha_src.hexdigest()


def dm_table(chunks, part, part_start):
    # Logical and physical 512B sector arithmetic matches Ventoy's original vtoydm.
    return ''.join(f'{start * 4} {(end - start + 1) * 4} linear {part} {physical - part_start}\n'
                   for start, end, physical, _ in chunks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('emit', 'check'))
    parser.add_argument('--iso', required=True)
    parser.add_argument('--disk', required=True)
    parser.add_argument('--partition', required=True)
    parser.add_argument('--map', required=True)
    parser.add_argument('--table', required=True)
    args = parser.parse_args()
    start = partition_start(args.partition)
    if args.mode == 'emit':
        spans = fiemap_extents(args.iso)
        chunks = chunks_from_spans(spans, start)
        write_chunks(args.map, chunks)
    else:
        chunks = parse_chunks(args.map)
    checksum = validate(chunks, args.iso, args.disk, start)
    Path(args.table).write_text(dm_table(chunks, args.partition, start))
    print(f'ISO_IMG_CHUNK_VALIDATED extent_count={len(chunks)} source_sha256={checksum}')
    print(f'LINUX_DM_TABLE_READY partition={args.partition} start_sector={start}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, OverflowError, struct.error) as exc:
        print(f'ISO_HANDOFF_REJECTED: {exc}', file=sys.stderr)
        sys.exit(1)
