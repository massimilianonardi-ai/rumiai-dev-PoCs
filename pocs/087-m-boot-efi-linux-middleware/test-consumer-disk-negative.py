#!/usr/bin/env python3
"""F-02: exercise the real EFI Linux consumer against disposable regular-file GPTs.

Only environmental I/O is redirected in a TEMPORARY source copy: efivarfs
pathname, sysfs enumerator, block path, and the block-size ioctl (fstat of
a regular fixture file). Consumer GPT/CRC/map validation is unchanged.
No host /dev, /sys, loop device, device mapper or mount is touched.
"""
from __future__ import annotations

import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

DISK_BYTES = 8 * 1024 * 1024
DISK_SECTORS = DISK_BYTES // 512
START, END = 2048, 8191
GPT_GUID = bytes(range(16))
VENTOY_GUID = bytes.fromhex("20207777772e76656e746f792e6e6574")
ORIGINAL_VAR = (
    '#define VAR "/sys/firmware/efi/efivars/'
    'VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e"'
)
GOOD_CHUNKS = [(0, 0, START, START + 3), (1, 1, 4096, 4099)]


def put(fmt: str, blob: bytearray, offset: int, *values: int) -> None:
    struct.pack_into(fmt, blob, offset, *values)


def fix_header_crc(disk: bytearray) -> None:
    put("<I", disk, 512 + 16, 0)
    put("<I", disk, 512 + 16, zlib.crc32(disk[512:512 + 92]))


def fix_entry_crc(disk: bytearray) -> None:
    put("<I", disk, 512 + 88, zlib.crc32(disk[1024:1024 + 16384]))
    fix_header_crc(disk)


def disk_image() -> bytearray:
    disk = bytearray(DISK_BYTES)
    disk[510:512] = b"\x55\xaa"
    entry = 1024
    disk[entry:entry + 16] = b"\xaa" * 16  # nonempty GPT type
    disk[entry + 16:entry + 32] = b"\xbb" * 16
    put("<QQ", disk, entry + 32, START, END)
    header = 512
    disk[header:header + 8] = b"EFI PART"
    put("<I", disk, header + 8, 0x00010000)
    put("<I", disk, header + 12, 92)
    put("<Q", disk, header + 24, 1)
    put("<Q", disk, header + 32, DISK_SECTORS - 1)
    put("<Q", disk, header + 40, 34)
    put("<Q", disk, header + 48, DISK_SECTORS - 34)
    disk[header + 56:header + 72] = GPT_GUID
    put("<Q", disk, header + 72, 2)
    put("<II", disk, header + 80, 128, 128)
    fix_entry_crc(disk)
    return disk


def variable(chunks=GOOD_CHUNKS, iso_bytes=4096, disk_bytes=DISK_BYTES,
             part=1) -> bytes:
    header = bytearray(40)
    header[:8] = b"VTDMAP01"
    put("<IIQ", header, 8, len(chunks), 24, iso_bytes)
    header[24:40] = GPT_GUID
    os_param = bytearray(512)
    os_param[:16] = VENTOY_GUID
    put("<Q", os_param, 33, disk_bytes)
    put("<H", os_param, 41, part)
    put("<Q", os_param, 429, iso_bytes)
    os_param[511] = (-sum(os_param)) & 255
    return (struct.pack("<I", 6) + header + os_param
            + b"".join(struct.pack("<IIQQ", *chunk) for chunk in chunks))


def probe_source(source: str, sandbox: pathlib.Path) -> str:
    replacements = [
        (ORIGINAL_VAR, f'#define VAR "{sandbox}/efi-var"'),
        ('opendir("/sys/block")', f'opendir("{sandbox}/sys/block")'),
        ('"/dev/%s"', f'"{sandbox}/dev/%s"'),
        ('"/sys/class/block/%s/start"',
         f'"{sandbox}/sys/class/block/%s/start"'),
        ('"/sys/class/block/%s/size"',
         f'"{sandbox}/sys/class/block/%s/size"'),
        ("ioctl(fd, BLKGETSIZE64, &bytes)", "vt_test_regular_size(fd, &bytes)"),
    ]
    for original, replacement in replacements:
        if source.count(original) != 1:
            raise RuntimeError(f"unknown real source revision at: {original}")
        source = source.replace(original, replacement)
    helper = """
static int vt_test_regular_size(int fd, uint64_t *bytes)
{
    struct stat statbuf;
    if (fstat(fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode)
        || statbuf.st_size < 0)
        return -1;
    *bytes = (uint64_t)statbuf.st_size;
    return 0;
}

"""
    needle = "static int locate_disk("
    if source.count(needle) != 1:
        raise RuntimeError("real source disk enumerator changed")
    return source.replace(needle, helper + needle)


def prepare(sandbox: pathlib.Path, state: dict) -> None:
    shutil.rmtree(sandbox, ignore_errors=True)
    for subdir in ("dev", "sys/block", "sys/class/block/vda1"):
        (sandbox / subdir).mkdir(parents=True)
    for name, disk in state["disks"].items():
        if not name.startswith(("vd", "sd")) or "/" in name:
            raise RuntimeError("unexpected fixture device name")
        (sandbox / "sys/block" / name).mkdir()
        (sandbox / "dev" / name).write_bytes(disk)
    if state["efi"] is not None:
        (sandbox / "efi-var").write_bytes(state["efi"])
    for attr in ("start", "size"):
        value = state[attr]
        if value is not None:
            (sandbox / "sys/class/block/vda1" / attr).write_text(str(value) + "\n")


def run(executable: pathlib.Path, sandbox: pathlib.Path, table: pathlib.Path,
        name: str, error: str | None, mutate) -> None:
    state = {"disks": {"vda": disk_image()}, "efi": variable(),
             "start": START, "size": END - START + 1}
    if mutate:
        mutate(state)
    prepare(sandbox, state)
    table.unlink(missing_ok=True)
    result = subprocess.run([str(executable), str(table)],
                            capture_output=True, text=True,
                            check=False, timeout=10)
    if error is None:
        expected = (
            f"0 4 linear {sandbox}/dev/vda1 0\n"
            f"4 4 linear {sandbox}/dev/vda1 {4096 - START}\n"
        )
        if (result.returncode != 0 or not table.is_file()
                or table.read_text() != expected
                or "VT_LINUX_MAP_CONSUMED" not in result.stdout):
            raise RuntimeError(f"FAIL {name}: {result!r} table="
                               f"{table.read_text() if table.exists() else None}")
    elif (result.returncode == 0 or table.exists()
          or error not in result.stderr or "VT_LINUX_MAP_CONSUMED" in result.stdout):
        raise RuntimeError(f"FAIL {name}: {result!r} table_exists={table.exists()}")
    print(f"PASS {name}")


def set_var(state, **kwargs):
    state["efi"] = variable(**kwargs)


def flip_disk(state, index):
    state["disks"]["vda"][index] ^= 1


def invalid_backup(state):
    put("<Q", state["disks"]["vda"], 512 + 32, DISK_SECTORS - 2)
    fix_header_crc(state["disks"]["vda"])


def invalid_entries_offset(state):
    put("<Q", state["disks"]["vda"], 512 + 72, DISK_SECTORS - 2)
    fix_header_crc(state["disks"]["vda"])


def outside_partition(state):
    put("<Q", state["disks"]["vda"], 1024 + 40, DISK_SECTORS - 1)
    fix_entry_crc(state["disks"]["vda"])


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: test-consumer-disk-negative.py REAL_CONSUMER_C", file=sys.stderr)
        return 2
    source = pathlib.Path(sys.argv[1]).read_text()
    with tempfile.TemporaryDirectory(prefix="mboot-f02-disposable-") as td:
        root = pathlib.Path(td)
        sandbox, table = root / "sandbox", root / "iso-table"
        modified = root / "consumer-io-isolated.c"
        modified.write_text(probe_source(source, sandbox))
        executable = root / "real-consumer"
        subprocess.run(["gcc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                        "-o", str(executable), str(modified)], check=True)
        cases = [
            ("valid-disposable-disk-control", None, None),
            ("source-missing", "source GPT identity missing or ambiguous",
             lambda s: s["disks"].clear()),
            ("source-guid-duplicated", "source GPT identity missing or ambiguous",
             lambda s: s["disks"].update(vdb=disk_image())),
            ("wrong-source-disk-size", "source GPT identity missing or ambiguous",
             lambda s: set_var(s, disk_bytes=DISK_BYTES + 512)),
            ("gpt-header-crc", "primary GPT header CRC mismatch",
             lambda s: flip_disk(s, 512 + 8)),
            ("gpt-backup-lba", "invalid primary GPT header identity or geometry",
             invalid_backup),
            ("gpt-entry-crc", "primary GPT partition entry CRC mismatch",
             lambda s: flip_disk(s, 1024 + 18)),
            ("gpt-entry-array-bounds", "GPT entry array extends outside reserved header area",
             invalid_entries_offset),
            ("gpt-partition-outside-usable-area", "selected GPT partition extends outside usable disk",
             outside_partition),
            ("wrong-partition-entry", "selected GPT partition entry is empty",
             lambda s: set_var(s, part=2)),
            ("missing-sysfs-start", "partition sysfs start missing or malformed",
             lambda s: s.update(start=None)),
            ("partition-start-conflict", "partition sysfs start disagrees with primary GPT",
             lambda s: s.update(start=START + 1)),
            ("partition-size-conflict", "partition sysfs size disagrees with primary GPT",
             lambda s: s.update(size=END - START)),
            ("logical-extent-gap", "gapped/overlapping image map",
             lambda s: set_var(s, chunks=[(0, 0, 2048, 2051),
                                          (2, 2, 4096, 4099)], iso_bytes=6144)),
            ("logical-extent-overlap", "gapped/overlapping image map",
             lambda s: set_var(s, chunks=[(0, 1, 2048, 2055),
                                          (1, 1, 4096, 4099)])),
            ("physical-extent-overlap", "overlapping physical source extents",
             lambda s: set_var(s, chunks=[(0, 0, 2048, 2051),
                                          (1, 1, 2050, 2053)])),
            ("mapped-sector-count-conflict",
             "mapped sectors outside the actual source GPT partition",
             lambda s: set_var(s, chunks=[(0, 0, 2048, 2050),
                                          (1, 1, 4096, 4099)])),
            ("mapped-sector-outside-partition",
             "mapped sectors outside the actual source GPT partition",
             lambda s: set_var(s, chunks=[(0, 0, 8190, 8193),
                                          (1, 1, 4096, 4099)])),
            ("mapped-sector-arithmetic-overflow",
             "mapped sectors outside the actual source GPT partition",
             lambda s: set_var(s, chunks=[(0, 0, 2**64 - 1, 2**64 - 1),
                                          (1, 1, 4096, 4099)])),
            ("incomplete-iso-coverage", "ISO extent coverage incomplete",
             lambda s: set_var(s, iso_bytes=6144)),
            ("extent-count-over-consumer-limit", "invalid original chunk array bounds",
             lambda s: set_var(s, chunks=[(0, 0, 2048, 2051)] * 641)),
        ]
        for name, error, mutate in cases:
            run(executable, sandbox, table, name, error, mutate)
    print(f"VT_F02_DISPOSABLE_GPT_MAP_PASS: {len(cases)} real-consumer cases")
    print("BOUNDARY: no real /dev, firmware boot, physical USB or dmsetup executed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
