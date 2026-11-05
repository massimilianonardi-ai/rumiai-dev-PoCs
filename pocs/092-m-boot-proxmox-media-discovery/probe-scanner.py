#!/usr/bin/env python3
"""PoC M-05: inspect exact Proxmox 9.2-1 /init and existing Ventoy adapter.

Data-only source compatibility proof, NOT a vendor ISO boot, media acceptance,
or a full ISO checksum verification. Never executes or rewrites vendor /init.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def refuse(kind, context):
    raise ValueError(f"M05_{kind}: {context}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--vendor-init", required=True, type=Path)
    p.add_argument("--cd-info", required=True, type=Path)
    p.add_argument("--upstream-hook", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    for label, path, limit in (
        ("INIT", args.vendor_init, 256 * 1024),
        ("CDINFO", args.cd_info, 16 * 1024),
        ("HOOK", args.upstream_hook, 128 * 1024),
    ):
        if not path.is_file() or not 0 < path.stat().st_size <= limit:
            refuse(label + "_INPUT_INVALID", str(path))
    init_bytes = args.vendor_init.read_bytes()
    info_bytes = args.cd_info.read_bytes()
    hook_bytes = args.upstream_hook.read_bytes()
    if b"\0" in init_bytes or not init_bytes.startswith(b"#!/bin/sh\n"):
        refuse("VENDOR_INIT_UNEXPECTED", "binary or unexpected vendor init")
    init = init_bytes.decode("utf-8")
    info = info_bytes.decode("utf-8")
    hook = hook_bytes.decode("utf-8")

    # Parse actual .cd-info as data. Never source vendor code on the host.
    fields = {}
    for line in info.splitlines():
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)='([A-Za-z0-9 ._-]{1,100})'",
                             line.strip())
        if match:
            if match[1] in fields:
                refuse("DUPLICATE_CDINFO", match[1])
            fields[match[1]] = match[2]
    identity = {"PRODUCT": "pve", "RELEASE": "9.2",
                "ISORELEASE": "1", "ISONAME": "proxmox-ve"}
    if any(fields.get(key) != value for key, value in identity.items()):
        refuse("RELEASE_IDENTITY_MISMATCH", repr(fields))

    # Exact real installer scanning branch, not a substitute scanner.
    scan = re.compile(r"(?m)^([ \t]*for i in )(/sys/block/hd\*[^;\n]+)(; do[ \t]*)$")
    matches = list(scan.finditer(init))
    if len(matches) != 1:
        refuse("ORIGINAL_SCAN_AMBIGUOUS", str(len(matches)))
    scan_text = matches[0].group(2)
    if ("/sys/block/dm*" in scan_text or
            "/sys/block/sr*" not in scan_text or
            "/sys/block/nvme*" not in scan_text):
        refuse("ORIGINAL_SCAN_UNEXPECTED", scan_text)
    expected_tokens = ("/mnt/$CDID_FN", "X$reqid",
                       "mount -t iso9660 -o ro", "blkid", "CDID_FN")
    if any(token not in init for token in expected_tokens):
        refuse("MEDIA_ID_CHECK_CHANGED", "missing original identity/ISO test")

    # The extant upstream Ventoy PVE hook adds dm* to the same scanner.
    # Check how its one sed expression applies to data; do NOT execute it.
    original = "/sys/block/hd*"
    extended = "/sys/block/dm* /sys/block/hd*"
    upstream_expr = r"s#/sys/block/hd\*#/sys/block/dm* /sys/block/hd*#"
    if hook.count(upstream_expr) != 1:
        refuse("UPSTREAM_HOOK_CHANGED", "exact existing adapter missing")
    if scan_text.count(original) != 1:
        refuse("VENDOR_SCAN_ANCHOR_CHANGED", scan_text)
    changed = (init[:matches[0].start(2)] +
               scan_text.replace(original, extended, 1) +
               init[matches[0].end(2):])
    if changed.replace(extended, original, 1) != init:
        refuse("ADAPTER_NONLOCAL_CHANGE", "unexpected vendor script delta")

    record = {
        "task": "M-05",
        "scope": "original_proxmox_9_2_1_initrd_scan_adapter_source_proof",
        "vendor_init_sha256": sha(init_bytes),
        "vendor_cd_info_sha256": sha(info_bytes),
        "original_ventoy_pve_hook_sha256": sha(hook_bytes),
        "verified_original_vendor_release": identity,
        "original_sysblock_scan": scan_text,
        "adapted_sysblock_scan": scan_text.replace(original, extended, 1),
        "original_scan_excludes_dm": True,
        "original_init_uses_readonly_iso9660_and_cd_id_match": True,
        "existing_ventoy_adapter_adds_dm_to_scan": True,
        "original_initrd_untouched": args.vendor_init.read_bytes() == init_bytes,
        "entire_vendor_iso_sha256_verified": False,
        "original_vendor_efi_boot_tested": False,
        "vendor_media_accepted_in_guest": False,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        refuse("OUTPUT_EXISTS", str(args.out))
    args.out.write_text(json.dumps(record, indent=2) + "\n")
    print("M05_ORIGINAL_PVE_DM_SCAN_EXISTING_ADAPTER_SOURCE_PASS")
    print("M05_VENDOR_MEDIA_ACCEPTANCE_NOT_TESTED")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(str(exc))
