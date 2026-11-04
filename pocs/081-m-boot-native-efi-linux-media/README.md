# PoC 081 — Original EFI ISO boot to Linux physical ISO remount

**Status (2026-11-04): synthetic UEFI → Linux end-to-end PASS.**
This is not an actual Proxmox/TrueNAS installer or a released m-boot path.

## Evidence

Workflow `.github/workflows/poc-081-m-boot-native-efi-linux-media.yml`
completed with **SUCCESS** on run
[41839593585](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/41839593585).
Exact workflow revision: `ea72985bcdb98583280921d6acc2d0e496eba276`.
Experimental Ventoy revision: `ceff79ca92d246928f86362a569f86c6d2ac130f`.
The unmodified Linux kernel from Ubuntu 24.04, module-matched kernel
drivers, stock GRUB 2.12 external module, original rebuilt EDK2 Ventoy
application and distributed ISO9660 EFI driver were compiled/installed
and exercised in real QEMU/OVMF, not simulated by host-side text checks.

The PoC 079 builder created a *new disposable* bootable x86_64 ISO of
**42,010,624 bytes**, incorporating the earlier PoC 076 early-userspace
module/runtime dependency closure in a compressed base archive. The
original 1,024-byte `/boot/initrd-hook.cpio` stays inside the ISO.
The alternative 3,072-byte hook is **outside** the ISO, contains
the source-identity/GPT/dm-table/mount sequence from the previously
tested PoC 076 consumer, and is the sole virtual replacement.

The workflow first boots the **original** ISO on a real read-only QEMU
CD and checks the original marker plus unchanged ISO SHA256. It then
boots the same ISO file from a disposable FAT32 GPT source through the
original Ventoy EDK2 virtual CD with a native `ventoy_override_chunk`
/ `ventoy_virt_chunk` overlay. Stock GRUB publishes the original
Ventoy extent map as a volatile EFI Runtime Services variable before
the overlay; the GRUB EFI executable from **inside** the ISO boots the
original Ubuntu kernel, which executes the **replacement** `/init`.
After `ExitBootServices()`, `/init` loads matching kernel modules,
reads the original EFI extent/GPT metadata, rejects ambiguous or
out-of-partition source mappings, creates a read-only Linux `dm-linear`
virtual disk, compares its SHA256 to the host's **unmodified original ISO**,
mounts ISO9660 and checks `/vt079-marker`. The test requires
`VT_EFI_MAP_PUBLISHED`, `VT_LINUX_MAP_CONSUMED`,
`VT_LINUX_ISO_SHA256=<original hash>`,
`VT_LINUX_ISO_IDENTITY_PASS`, `VT_LINUX_HANDOFF_PASS` and
`VT079_LINUX_INITRAMFS_OVERLAY` with **no original initrd marker**.
Host-side verification of the real source disk extent table also passes.

The QEMU test uses an ephemeral GPT/FAT source disk, not an operator USB.
The PoC's ISO is generated specifically for a disposable runtime and
has not been written back to any input ISO or host physical media.
There are no modifications to `Ventoy/master`, `m-boot/main` or GRUB core.

## What is still not validated

The specific Proxmox VE 9.2-1 / TrueNAS SCALE 25.10.7 ISO bootloaders,
initrds, signatures, media-check logic, Joliet/UDF behavior, Secure Boot,
BIOS/ARM64, large overlay payloads beyond the 64 KiB probe, or an
actual installer progressing through its own media-remount procedure.
This synthetic Linux handoff is the basis for those separate tests,
not evidence that real vendor installers currently boot.
