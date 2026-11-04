#!/usr/bin/env python3
"""Read (never execute) exact TrueNAS 25.10.7 live-boot script excerpts."""
import json
import re
from pathlib import Path
import sys

if len(sys.argv) != 3:
    sys.exit("usage: inspect_mount_flow.py EXTRACTED_INITRD OUTPUT_JSON")
root = Path(sys.argv[1])
targets = [
    "init",
    "scripts/live",
    "usr/lib/live/boot/9990-cmdline-old",
    "usr/lib/live/boot/9990-main.sh",
    "usr/lib/live/boot/9990-misc-helpers.sh",
    "usr/lib/live/boot/9990-toram-todisk.sh",
]
terms = re.compile(
    r"mountroot|LIVEMEDIA|LIVE_MEDIA|FROMISO|live-media|fromiso|"
    r"filesystem\.squashfs|/run/live|/root/cdrom|toram|boot=live|"
    r"find_live|find.*media|find.*squashfs|mount.*iso|mount.*root", re.I
)
results = []
for relative in targets:
    item = root / relative
    if not item.is_file() or item.is_symlink():
        results.append({"path": relative, "status": "missing"})
        continue
    raw = item.read_bytes()
    if b"\x00" in raw[:256] or len(raw) > 256 * 1024:
        results.append({"path": relative, "status": "non-small-text"})
        continue
    lines = raw.decode("utf-8", "replace").splitlines()
    ranges = []
    for index, line in enumerate(lines):
        if terms.search(line):
            ranges.append((max(0, index - 4), min(len(lines), index + 5)))
    merged = []
    for a, b in ranges:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    excerpts = [
        [{"line": j + 1, "text": lines[j]} for j in range(a, b)]
        for a, b in merged
    ]
    results.append({
        "path": relative,
        "status": "read-only-shipped-code",
        "total_lines": len(lines),
        "excerpts": excerpts[:30],
    })
Path(sys.argv[2]).write_text(json.dumps({
    "origin": "exact upstream TrueNAS 25.10.7 initrd.img, bounded ranged fetch",
    "vendor_file_execution": False,
    "entries": results,
}, indent=2) + "\n")
print("TRUENAS_EXACT_LIVE_BOOT_FLOW_READ_ONLY")
for entry in results:
    print("SOURCE", entry["path"], entry["status"])
    for group in entry.get("excerpts", [])[:7]:
        for item in group[:24]:
            print(f'  {item["line"]:4d} {item["text"][:250]}')
if not any(e["path"] == "scripts/live" and
           e["status"] == "read-only-shipped-code" for e in results):
    sys.exit("Required scripts/live not present in vendor initrd")
