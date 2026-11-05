#!/usr/bin/env python3
"""F-05 fail-closed source conformance guard for the existing experimental ABI.

This is NOT a firmware or guest-boot simulation. QEMU proof comes exclusively
from the separately pinned F-03/F-04 real GitHub Actions runs. The guard
detects drift in the F-owned producer, upstream Ventoy records and unchanged
real Linux consumer at the exact checked-out source revision.
"""
from __future__ import annotations

import pathlib
import re
import struct
import sys


def source(path: pathlib.Path) -> str:
    if not path.is_file():
        raise SystemExit(f"F05_CONFORMANCE_FAIL missing source: {path}")
    return path.read_text(encoding="utf-8")


def required(content: str, token: str, context: str) -> None:
    if token not in content:
        raise SystemExit(f"F05_CONFORMANCE_FAIL {context}: missing {token!r}")


def unique(content: str, token: str, context: str) -> None:
    if content.count(token) != 1:
        raise SystemExit(f"F05_CONFORMANCE_FAIL {context}: expected one {token!r}")


def ordered(content: str, tokens: list[str], context: str) -> None:
    positions = []
    for token in tokens:
        required(content, token, context)
        positions.append(content.index(token))
    if positions != sorted(positions) or len(set(positions)) != len(positions):
        raise SystemExit(f"F05_CONFORMANCE_FAIL {context}: unexpected order")


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: test-f05-interface.py PINNED_VENTOY_TREE POC_TREE")
    ventoy, poc = map(pathlib.Path, sys.argv[1:])
    prefix = ventoy / "GRUB2/port"
    producer = source(prefix / "probe-handoff.c")
    consumer = source(prefix / "probe-linux-efi-consumer.c")
    upstream = source(ventoy / "GRUB2/MOD_SRC/grub-2.04/include/grub/ventoy.h")
    boot = source(prefix / "probe-standalone-uefi.sh")
    f03_workflow = source(poc / ".github/workflows/poc-081-m-boot-native-efi-linux-media.yml")
    f04_workflow = source(poc / ".github/workflows/poc-089-m-boot-efi-linux-runtime-failures.yml")

    # Packed upstream structs are preserved, not replaced by a new ABI.
    required(upstream, "#pragma pack(1)", "upstream Ventoy param")
    required(upstream, "COMPILE_ASSERT(1,sizeof(ventoy_os_param) == 512);", "upstream param width")
    required(upstream, "typedef struct ventoy_img_chunk", "upstream physical chunk")
    ordered(upstream, [
        "grub_uint32_t img_start_sector;",
        "grub_uint32_t img_end_sector;",
        "grub_uint64_t disk_start_sector;",
        "grub_uint64_t disk_end_sector;",
    ], "upstream physical chunk fields")
    required(producer, "struct __attribute__ ((packed)) vt_efi_map_payload", "producer packed payload")
    match = re.search(r"struct __attribute__ \(\(packed\)\) vt_efi_map_payload\s*\{(.*?)\};",
                      producer, flags=re.S)
    if not match:
        raise SystemExit("F05_CONFORMANCE_FAIL payload structure not found")
    ordered(match.group(1), [
        "grub_uint8_t magic[8];",
        "grub_uint32_t count;",
        "grub_uint32_t chunk_bytes;",
        "grub_uint64_t iso_bytes;",
        "grub_uint8_t gpt_guid[16];",
        "ventoy_os_param os_param;",
        "ventoy_img_chunk chunks[1];",
    ], "producer wire fields")

    header = struct.calcsize("<8sIIQ16s")
    chunk = struct.calcsize("<IIQQ")
    if (header, chunk, header + 512 + chunk * 640) != (40, 24, 15912):
        raise SystemExit("F05_CONFORMANCE_FAIL independent length arithmetic")
    for token in ('#define HEADER_BYTES 40', '#define CHUNK_BYTES 24',
                  '#define OS_PARAM_BYTES 512', '#define MAX_MAP 16384',
                  '#define VAR "/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e"',
                  'memcmp(p, "VTDMAP01", 8)', 'count > 640',
                  'rd32(p + 12) != CHUNK_BYTES',
                  'rd64(os + 429) != iso_bytes',
                  'disk_size = rd64(os + 33)', 'part = rd16(os + 41)',
                  'locate_disk(p + 24, disk_size, whole, sizeof(whole))',
                  'crc32_gpt(gpt, header_bytes)',
                  'crc32_gpt(entries, sizeof(entries))',
                  'verify_source_partition(whole, part, first, last,',
                  'verify_extents(chunks, count, iso_bytes, first, last)'):
        required(consumer, token, "current C consumer")

    for token in ('chain->img_chunk_num > 640', 'data_bytes > 16384',
                  'static const grub_uint8_t magic[] = "VTDMAP01"',
                  "GRUB_EFI_VARIABLE_BOOTSERVICE_ACCESS",
                  "GRUB_EFI_VARIABLE_RUNTIME_ACCESS",
                  'grub_uint8_t gpt_guid[16];',
                  "sizeof (*payload) - sizeof (payload->chunks)",
                  "chain->real_img_size_in_bytes != chain->virt_img_size_in_bytes"):
        required(producer, token, "current GRUB publisher")
    for group in ("0xd4, 0x24, 0x5e, 0x0e, 0x8b, 0x16, 0x9e, 0x4f",
                  "0xa3, 0x97, 0x09, 0x51, 0xf7, 0x57, 0x11, 0x1e",
                  "{ 'V', 't', 'D', 'm', 'M', 'a', 'p', 'P', 'r', 'o', 'b', 'e', 0 }"):
        required(producer, group, "UEFI variable identity")
    if "GRUB_EFI_VARIABLE_NON_VOLATILE" in producer:
        raise SystemExit("F05_CONFORMANCE_FAIL unexpected nonvolatile EFI publication")

    # Fail closed before producing *any* source-dependent dm table.
    ordered(consumer, [
        'count = rd32(p + 8);',
        'locate_disk(p + 24, disk_size, whole, sizeof(whole))',
        'verify_gpt(whole, p + 24, disk_size, part, &first, &last)',
        'verify_source_partition(whole, part, first, last,',
        'verify_extents(chunks, count, iso_bytes, first, last)',
        'table = fopen(argv[1], "w");',
    ], "validated source before dm table")
    required(consumer, "if (matches != 1) die", "unique source disk")
    required(consumer, 'fprintf(table, "%" PRIu64 " %" PRIu64 " linear %s %" PRIu64',
             "original dm-linear target")
    required(consumer, '(rd32(buffer) & 6) != 6', "EFI runtime-visible attributes")
    required(consumer, '(size_t)n != 4 + HEADER_BYTES + OS_PARAM_BYTES', "efivarfs prefix")
    ordered(boot, ["echo VT081_EFI_MAP_EXPORT_BEGIN",
                   "vt_publish_efi_map",
                   "echo VT081_EFI_MAP_EXPORT_DONE",
                   "echo VT080_ORIGINAL_VENTOY_OVERLAY_BOOT_BEGIN",
                   "vt_overlay_probe ($isopart)/vt-map-image.iso"],
            "EFI map published before transient overlay")
    for label, workflow in (("F03", f03_workflow), ("F04", f04_workflow)):
        required(workflow, "ref: 475db53dee122887fab3387db47fbb1f09ca71b7",
                 f"{label} pinned source")
        required(workflow, "VTOY_REQUIRE_EFI_MAP=1", f"{label} real EFI map")
        required(workflow, "VTOY_REQUIRE_FRAGMENTED_ISO=1",
                 f"{label} real fragmentation")
        required(workflow, "original-overlay-boot", f"{label} original EFI path")
        required(workflow, "f03_fragmented_efi_linux=passed",
                 f"{label} independent guest/map oracle")
    required(f04_workflow, "F04_REAL_GUEST_SAFETY_PASS", "F04 guest negative gate")
    required(f04_workflow, "F04_NEGATIVE_MISSING_SOURCE_NODE_PASS",
             "F04 no wrong source fallback")
    unique(f03_workflow, "ref: 475db53dee122887fab3387db47fbb1f09ca71b7",
           "F03 checkout pin")
    unique(f04_workflow, "ref: 475db53dee122887fab3387db47fbb1f09ca71b7",
           "F04 checkout pin")
    print("F05_SOURCE_INTERFACE_CONFORMANCE_PASS")
    print("F05_WIRE_HEADER_BYTES=40 OS_PARAM_BYTES=512 CHUNK_BYTES=24")
    print("F05_COUNT_LIMIT=640 EFI_PAYLOAD_MAX_BYTES=16384")
    print("F05_F03_F04_PINNED_CONSUMER_PRODUCER=475db53dee122887fab3387db47fbb1f09ca71b7")
    print("F05_SCOPE=source_conformance_only_not_new_QEMU_or_vendor_boot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
