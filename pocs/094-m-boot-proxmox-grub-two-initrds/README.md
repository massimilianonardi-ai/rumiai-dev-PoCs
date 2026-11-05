# PoC 094 — M-05: real Proxmox initrd plus external CPIO via stock EFI GRUB

**Objective:** exercise an existing GRUB capability, not replace or alter firmware. The official Proxmox VE **9.2-1** ISO's real `/boot/grub/grub.cfg` (6,479 bytes, observed by exact official ISO9660 HTTP ranges in PoC 082) already invokes `initrd /boot/initrd.img`. Before asking the F-owned original Ventoy overlay to target a different file, test whether **stock x86_64 EFI GRUB** can load the real unchanged vendor initrd and a separate small CPIO as **two arguments** to its standard `initrd` command.

This PoC reuses the actual kernel/initrd from PoC 085's strict bounded official HTTPS Range readers and the **same known existing** PoC 085 small CPIO with an independent original-vendor-init wrapper. The original files are checked against pinned actual per-file SHA256, copied into a **disposable synthetic El Torito EFI ISO** with stock generated GRUB EFI, and checked byte-for-byte before/after testing. The test's real `grub.cfg` loads:

```grub
linux ($isodisk)/boot/vmlinuz ro ramdisk_size=16777216 rw splash=verbose proxtui console=ttyS0,115200 rdinit=/init
initrd ($isodisk)/boot/vendor-initrd.img ($isodisk)/boot/sidecar.cpio
```

Real QEMU/OVMF boots **stock GRUB EFI** (not the vendor's inner ISO EFI loader), the original Proxmox kernel, the **unchanged 55,878,409-byte original Zstd initrd**, and a **separate** bounded extra CPIO. A positive guest result requires EFI/GRUB and actual original vendor initrd handoff markers, not merely source-grep or a postulated GRUB feature. The resulting fixture ISO is **not the original 1.7 GiB Proxmox ISO** and the test does not attempt vendor media-ID acceptance.

**Hard boundaries:** The current F-owned `vt_overlay_probe` in Ventoy `m-boot-secondary-uefi@475db53` selects only synthetic fixture `PAYLOAD.BIN;1` or `boot-hook` at `/boot/initrd-hook.cpio`. It **cannot yet select** the actual Proxmox `/boot/grub/grub.cfg` for a virtual file replacement. A successful stock GRUB two-argument initrd boot therefore solves **only** the kernel/initrd preservation mechanics, **not** the original nested Proxmox ISO EFI chain, 64 KiB config-file shadow target, physical FAT32 extent map, or installer media ID. The vendor-sourced GRUB config is left untouched; testing a *future* virtual config override is an F/M coordination requirement, not a silently accepted new firmware target. No full original ISO copies, physical disks, USB passthrough, product code, firmware modification, installer installation or actual hardware-validation claims.

Original official-vendor ISO complete SHA256 cannot be inferred from per-file range hashes. A stock GRUB EFI test on a disposable synthetic ISO is not vendor original-ISO EFI integration. M-05 remains BLOCKED until real vendor media discovery and progression beyond retry.
