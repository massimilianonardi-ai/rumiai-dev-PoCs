#!/usr/bin/env python3
"""Exercise malformed EFI→Linux map rejection in the *real* Ventoy consumer.

Only one compile-time literal, the efivarfs variable file pathname, is
replaced in a TEMPORARY copy. The existing C parser and its checks are
compiled and executed unchanged. Every case must fail BEFORE locate_disk()
could probe host disks. This is an early rejection test, NOT a boot test.
"""
from __future__ import annotations

import pathlib
import re
import struct
import subprocess
import sys
import tempfile


VAR_DEFINE = (
    '#define VAR "/sys/firmware/efi/efivars/'
    'VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e"'
)
VENTOY_GUID = bytes.fromhex("20207777772e76656e746f792e6e6574")


def fixture() -> bytes:
    header = bytearray(40)
    header[:8] = b"VTDMAP01"
    struct.pack_into("<I", header, 8, 1)       # one original chunk
    struct.pack_into("<I", header, 12, 24)      # ventoy_img_chunk size
    struct.pack_into("<Q", header, 16, 2048)    # ISO size, bytes
    header[24:40] = bytes(range(16))            # unique test source GUID
    os_param = bytearray(512)
    os_param[:16] = VENTOY_GUID
    struct.pack_into("<Q", os_param, 33, 1048576)  # source disk bytes
    struct.pack_into("<H", os_param, 41, 1)        # GPT partition index
    struct.pack_into("<Q", os_param, 429, 2048)    # original ISO bytes
    os_param[-1] = (-sum(os_param)) & 255
    # One 2048-byte image extent = four 512-byte physical sectors.
    chunk = struct.pack("<IIQQ", 0, 0, 2048, 2051)
    return struct.pack("<I", 6) + header + os_param + chunk


def replace(payload: bytes, offset: int, value: bytes) -> bytes:
    return payload[:offset] + value + payload[offset + len(value):]


def replace_os_and_rechecksum(payload: bytes, offset: int, data: bytes) -> bytes:
    b = bytearray(replace(payload, offset, data))
    start = 4 + 40
    b[start + 511] = 0
    b[start + 511] = (-sum(b[start:start + 512])) & 255
    return bytes(b)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: test-consumer-negative.py PINNED_PROBE_CONSUMER_C", file=sys.stderr)
        return 2
    source = pathlib.Path(sys.argv[1])
    if not source.is_file():
        raise SystemExit(f"missing real source: {source}")
    original = source.read_text(encoding="utf-8")
    if original.count(VAR_DEFINE) != 1:
        raise SystemExit("unknown consumer revision / efivarfs literal; FAIL closed")

    with tempfile.TemporaryDirectory(prefix="mboot-efi-negative-") as td:
        root = pathlib.Path(td)
        var = root / "test-efi-variable"
        consumer = root / "probe-consumer.c"
        executable = root / "probe-consumer"
        table = root / "iso-table"
        consumer.write_text(original.replace(VAR_DEFINE, f'#define VAR "{var}"'))
        subprocess.run(
            ["gcc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
             "-o", str(executable), str(consumer)],
            check=True,
        )
        valid = fixture()
        # Each assertion stops within the same parser guards used at runtime.
        # Never execute the valid fixture: it would try to inspect /dev disks.
        cases: list[tuple[str, bytes | None, str]] = [
            ("efi-variable-absent", None,
             "efi runtime variable is not visible after ExitBootServices"),
            ("efi-attributes-missing", replace(valid, 0, b"\0\0\0\0"),
             "invalid EFI runtime variable"),
            ("truncated-header", valid[:70], "invalid EFI runtime variable"),
            ("wrong-uefi-map-magic", replace(valid, 4, b"BADMAP01"),
             "invalid UEFI map magic"),
            ("zero-extent-count", replace(valid, 12, struct.pack("<I", 0)),
             "invalid original chunk array bounds"),
            ("overflow-extent-count", replace(valid, 12, struct.pack("<I", 641)),
             "invalid original chunk array bounds"),
            ("wrong-extent-record-width", replace(valid, 16, struct.pack("<I", 32)),
             "invalid original chunk array bounds"),
            ("misaligned-iso-byte-size", replace(valid, 20, struct.pack("<Q", 2049)),
             "invalid original chunk array bounds"),
            ("truncated-extent-record", valid[:-1],
             "invalid original chunk array bounds"),
            ("incorrect-ventoy-os-param-guid", replace(valid, 4 + 40, b"X"),
             "original Ventoy GUID mismatch"),
            ("bad-ventoy-os-param-checksum", replace(valid, 4 + 40 + 100, b"\x01"),
             "original Ventoy os_param checksum mismatch"),
            ("wrong-source-partition", replace_os_and_rechecksum(
                valid, 4 + 40 + 41, struct.pack("<H", 0)),
             "Ventoy source partition/image size mismatch"),
            ("wrong-source-iso-size", replace_os_and_rechecksum(
                valid, 4 + 40 + 429, struct.pack("<Q", 4096)),
             "Ventoy source partition/image size mismatch"),
        ]
        for name, payload, expected in cases:
            if var.exists():
                var.unlink()
            if table.exists():
                table.unlink()
            if payload is not None:
                var.write_bytes(payload)
            proc = subprocess.run(
                [str(executable), str(table)], capture_output=True, text=True,
                check=False, timeout=5,
            )
            if (proc.returncode == 0 or expected not in proc.stderr
                    or "VT_LINUX_MAP_CONSUMED" in proc.stdout or table.exists()):
                raise SystemExit(
                    f"FAIL {name}: rc={proc.returncode} "
                    f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
                )
            print(f"PASS {name}: rejected before dm-table creation")
    print("VT087_EFI_VARIABLE_MALFORMED_REJECTION_PASS: 13 cases, real consumer")
    print("BOUNDARY: no valid-media, disk-identity, QEMU or installer test executed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
