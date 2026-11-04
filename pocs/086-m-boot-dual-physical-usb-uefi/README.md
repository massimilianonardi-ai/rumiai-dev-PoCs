# PoC 086 — Dual ISO diagnostic EFI boot image for real USB on Ubuntu ARM64

## Purpose

Build **one** experimental 96 MiB GPT + FAT32 ESP image that displays a
stock-GRUB UEFI menu with:

1. Inspect available ISO names without starting an installer (safe default)
2. Proxmox VE 9.2-1 experimental EFI boot from
   `/m/boot/iso/proxmox-ve_9.2-1.iso`
3. TrueNAS SCALE 25.10.7 experimental EFI boot from
   `/m/boot/iso/TrueNAS-SCALE-25.10.7.iso`

The ISO sources remain exclusively on the operator's physical
GPT3/ext4 `MBOOTDATA` USB. The optional Ventoy EFI engine reads file
extents and publishes a temporary EFI CD device. The **primary m-boot
product** and upstream Ventoy master are unchanged.

## Scope and evidence

The packaged boot executable and external GRUB probe module are retained from
a **previous, revision-pinned, synthetic EFI StartImage PASS** in the
`m-boot-secondary-uefi` experiment branch. The new image replaces only the
FAT32 `/grub/runtime.cfg` menu and retains the identical pinned binaries.
An independent CI test boots **both entries** against a disposable GPT3/ext4
disk containing two **synthetic UEFI-bootable ISO images** and requires both
the selected ISO marker and the marker from a genuine inner GRUB EFI
executable loaded by the original Ventoy EFI virtual-CD path.

Passing those two smoke tests does **not** validate the actual vendor
installers or their source-media recognition after `ExitBootServices()`.
Earlier PoC 081 validated the complete Linux-media remount only on a
synthetic image. PoC 085 separately verified real vendor kernel/initrd
append-only CPIO execution under direct QEMU kernel boot. The 40–56 MiB
vendor initrd EFI shadow + Linux-media recovery **is not yet integrated in
this boot bundle**. Installer boot may therefore stop when Linux searches
for the original optical media.

## On the operator's Ubuntu ARM64 VM

Download the successful workflow's `poc-086-dual-uefi-physical-usb`
artifact and extract it into a new directory on the VM's own disk.
Ensure **both genuine ISO files**, with the exact filenames above, are
already on the real USB, on its mounted GPT partition 3 (ext4,
`MBOOTDATA`). Do not copy ISOs into the boot-image artifact.

Install dependencies:

```sh
sudo apt-get install qemu-system-x86 qemu-utils ovmf gdisk acl
```

Prepare a new output directory **on the VM disk**, not on the USB:

```sh
mkdir -p "$HOME/mboot-dual-usb-test"
```

From the unpacked artifact directory (containing `boot-disk.raw.gz`,
`BUILD-INFO.txt`, hashes, `test-result.txt` and
`run-physical-usb-uefi.sh`), start the guarded test with one of the
real ISO files as the identity anchor:

```sh
bash ./run-physical-usb-uefi.sh \
  /media/YOUR_USER/MBOOTDATA/m/boot/iso/proxmox-ve_9.2-1.iso \
  "$PWD" "$HOME/mboot-dual-usb-test"
```

If the USB is mounted elsewhere, pass its real mounted ISO pathname.
The *same image* will show both Proxmox and TrueNAS menu entries, so it
is not necessary to build or flash a second boot disk.

The launcher validates the file's real USB block-device ancestry,
GPT3/ext4/MBOOTDATA identity, checks that it is not the system disk,
verifies both image checksums, and **asks for explicit device-specific
confirmation** before unmounting the source partition. It then creates
a temporary QCOW2 overlay over the USB block device (read-only backing
source) and also enables QEMU snapshot mode. Only the separate boot
image and ephemeral guest overlay can be modified; the USB is not
written or reflashed. The temporary USB ACL is revoked on exit.

QEMU runs **x86_64 under TCG emulation** on ARM64, not KVM x86_64.
The vendor installers may be slow or fail due to insufficient host RAM.
The artifact launcher defaults to 6 GiB guest RAM; override with
`MBOOT_TEST_RAM_MIB=8192` if the host has sufficient available memory.
The window displays the GRUB/installer graphics; the terminal displays
serial diagnostics. The console log remains in a private directory
under `$HOME/mboot-dual-usb-test`.

**Do not start an installation or select a real disk as an installation
target.** This is an observation-only test. Close QEMU after observing
the installer or media-lookup failure. Remount the USB partition in the
host after QEMU exits if desired; the runner leaves it unmounted.

If the USB is not an ext4 GPT3 `MBOOTDATA` USB device, or the ISO paths
do not match, the launcher refuses to run rather than guessing a disk.
No physical USB write is authorized here.

## Tests and provenance

- Workflow: `.github/workflows/poc-086-m-boot-dual-physical-usb.yml`.
- Builder: `build-dual-boot-image.sh` (new output only; verifies original
  binary digest, GPT partition start, FAT32 replacement round-trip).
- Firmware smoke: `test-dual-uefi.sh` (real OVMF/stock-GRUB/real Ventoy
  EFI boot of **synthetic** ISO bootloaders, both choices, no host device).
- The published artifact includes `SHA256SUMS` for compressed bytes,
  `RAW-SHA256SUMS` for the 96 MiB decompressed image, pinned source
  revisions, test-result.txt, launcher, and the actual generated image.

No real Proxmox or TrueNAS installer PASS should be reported without
operator screenshots/logs and later early-userspace media identification.
