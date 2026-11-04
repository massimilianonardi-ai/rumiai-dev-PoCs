#!/usr/bin/env python3
"""Read-only grep/context extraction from unpacked genuine Proxmox initramfs.

Never evaluates or invokes any of the vendor scripts. Generated evidence is
revision-specific, never normative and not a proof of installer boot.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

if len(sys.argv) != 3:
    sys.exit("usage: inspect_installer_initrd.py EXTRACTED_DIR REPORT_JSON")
root=Path(sys.argv[1])
patterns=re.compile(
    r'pve.cd.id|pve-cd-id|proxmox|mountroot|cdrom|findiso|iso9660|ventoy|'
    r'rootfs|boot_media|bootdisk|mount_cd|/dev/disk|/dev/mapper|'
    r'initramfs|live-boot|systemd-udev', re.I
)
records=[]
scanned=0
for f in root.rglob('*'):
    if not f.is_file() or f.is_symlink():
        continue
    size=f.stat().st_size
    if size > 256*1024:
        continue
    raw=f.read_bytes()
    if b'\x00' in raw[:512]:
        continue
    scanned+=1
    relative=f.relative_to(root).as_posix()
    lines=raw.decode('utf-8','replace').splitlines()
    matches=[i for i,line in enumerate(lines) if patterns.search(line)]
    if not matches and not (relative.endswith('/init') or relative=='init'):
        continue
    snippets=[]
    for i in matches[:30]:
        snippets.append({
            'at':i+1,
            'lines':[(j+1,lines[j][:320]) for j in range(max(0,i-3),min(len(lines),i+4))]
        })
    records.append({
        'path':relative,
        'bytes':size,
        'sha256':hashlib.sha256(raw).hexdigest(),
        'match_lines':len(matches),
        'snippets':snippets,
        'initial_40_lines':lines[:40] if relative.endswith('/init') or relative=='init' else []
    })
records.sort(key=lambda x: (-x['match_lines'],x['path']))
report={
    'source':'exact Proxmox VE 9.2-1 /boot/initrd.img extracted read-only',
    'vendor_script_executed':False,
    'small_text_files_scanned':scanned,
    'matching_files':len(records),
    'scripts':records[:100],
}
Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
print('PROXMOX_EXACT_INITRD_INSPECTION_PASS')
print('text_files='+str(scanned),'matching_scripts='+str(len(records)))
for item in records[:25]:
    print('SCRIPT '+item['path']+' matches='+str(item['match_lines']))
    for match in item['snippets'][:6]:
        print(' '.join(str(n)+':'+line for n,line in match['lines']))
