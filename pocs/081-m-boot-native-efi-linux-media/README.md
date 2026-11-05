# PoC 081 — Original EFI ISO boot to Linux physical ISO remount

**Status (2026-11-04): synthetic UEFI → Linux end-to-end PASS.**

**F-01 current source/ABI inventory (2026-11-05):** [experimental EFI→Linux map layout, enforced checks and limitations](ABI-INVENTORY.md). This is source inspection tied to pinned prior runs, not an additional QEMU, vendor, or physical PASS.

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

## F-03 genuine FAT fragmentation profile (2026-11-05)

The original PoC 081 evidence above remains pinned to its historical source and workflow revisions. F-03 exercises the **current F-02-hardened producer and consumer** on a real QEMU/OVMF Ubuntu kernel path. It does not borrow a historical one-extent PASS.

Runner `GRUB2/port/probe-standalone-uefi.sh` now accepts `VTOY_REQUIRE_FRAGMENTED_ISO=1` with `original-overlay-boot` on a disposable 192 MiB FAT32 GPT source. It populates four filler files and deletes an interior 16 MiB allocation, leaving less than the ISO's length contiguously available at the tail before writing the original approximately 40 MiB ISO. The input ISO copy is allocated **non-sparsely**. The existing independent `verify-extent-map.py` must reconstruct **every byte** from the raw GPT image, verify native original Ventoy structures, exact GPT identity and source path, require at least two actual extents and one physical discontinuity, and match complete SHA256. A second verifier checks firmware-published and post-kernel-consumed chunk counts and independent EFI/Linux markers and the Linux read-back SHA256. The entire GPT source disk must retain an identical SHA256 before and after QEMU's `-snapshot` boot.

GitHub Actions workflow `.github/workflows/poc-081-m-boot-native-efi-linux-media.yml` pins experimental Ventoy `475db53dee122887fab3387db47fbb1f09ca71b7`, compiles the authentic stock-GRUB external module, original rebuilt Ventoy EFI app and statically linked F-02 consumer, and boots the real ISO's inner GRUB and **unmodified Ubuntu kernel** via original EFI virtual BlockIo. It checks the read-only Linux `dm-linear`/ISO9660 mount and records `f03-runtime-verification.txt`, `iso-map-verification.txt`, `source-disk-integrity.txt` plus raw serial/QEMU trace. **F-03 PASS observed:** GitHub Actions [run 42035454641](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42035454641), job `127272300428`, SUCCESS. Exact workflow PR revision `dd59996b070579f3d46df425672998f208abe4b8` with Ventoy `475db53dee122887fab3387db47fbb1f09ca71b7`. Original ISO: **42,010,624 bytes** (non-sparse, **42,012,672 allocated filesystem bytes**); **2 independently verified actual FAT extents, 1 physical discontinuity**, original and reconstructed SHA256 both `f79e2587d6ddfd7feace7022c6985e8666b4cb5cf73e704d53e2ee18b06b9407`. Both EFI-published and Linux-consumed map counts match the real extent count; guest markers confirm the unchanged original kernel, the ISO's own EFI loader and read-only `dm-linear`/ISO9660 remount. The runner also compares the entire disposable GPT source-disk SHA256 before/after QEMU's `-snapshot` execution. Logs and reports are retained in [artifact 13417988762](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42035454641/artifacts/13417988762) (14-day retention, not a permanent signed evidence bundle).

**Boundaries:** synthetic x86_64 OVMF/TCG and disposable file-backed GPT only; no real vendor/physical media, Secure Boot, BIOS, ARM64, production API promotion, or independent Linux middleware/original vendor init acceptance.
