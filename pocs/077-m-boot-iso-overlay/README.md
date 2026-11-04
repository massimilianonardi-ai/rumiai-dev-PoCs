# PoC 077 — Read-only ISO9660 boot-file overlay using the existing sector-map ABI

**Status:** experimental, not an m-boot production feature or a verified EFI/installer boot.

## Question

Can the original ISO bytes remain unchanged while a **different** `/boot/initrd.img` appears under the **same ISO9660 path** on a kernel-visible virtual disk, and every unmodified sibling file still reads correctly?

This experiment builds on `pocs/075-m-boot-linux-dm/extent_handoff.py`. The ISO sector ranges come from the original packed 24-byte Ventoy `ventoy_img_chunk` records checked against a **real, disposable GPT3/ext4** backing disk. The only new data are:

- one virtual copy of the ISO9660 primary volume descriptor (volume-sector count);
- one virtual copy of the **existing directory sector** that holds the `initrd.img` entry (new extent and size in both ISO9660 endian orders);
- a small **replacement initramfs** made by concatenating an original test `newc` archive with a second archive containing an illustrative marker.

Linux's **real** read-only `dm-linear` interface combines the original physical sectors and these sidecar sectors; then a genuine Linux ISO9660 mount must resolve `/boot/initrd.img` to the replacement bytes while the original ISO SHA256 and a sibling file remain unchanged. No full copy of any real ISO is required, no real user disk is accepted, and the original kernel/device-mapper are unmodified.

## Run on a disposable Linux CI/VM host

Requires root and available loop devices, device-mapper `linear`, `xorriso`, `cpio`, `sgdisk`, ext4 tools, Python 3, and util-linux:

```sh
sudo sh pocs/077-m-boot-iso-overlay/run-linux.sh
```

The script has **no external device-path arguments**, creates its own temporary GPT image and loop-backed sidecar and deletes them afterward. The GitHub Actions workflow `.github/workflows/poc-077-m-boot-iso-overlay.yml` executes the genuine kernel path. A PASS requires all four markers: `ISO_OVERLAY_ORIGINAL_UNCHANGED_PASS`, `ISO_OVERLAY_BOOT_FILE_REPLACED_PASS`, `ISO_OVERLAY_SIBLING_UNCHANGED_PASS`, and `ISO_OVERLAY_DM_ISO9660_MOUNT_PASS`.

## Validation checkpoint — 2026-11-04

**PASS on a real Ubuntu 24.04 GitHub-hosted Linux kernel**, workflow run [41814132178](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/41814132178), revision `f188134ccbefcd5ced08ab3a124a21924f6b18ae`. Nine real ext4 file extents were recovered and checked against the backing disk, a 14-row read-only `dm-linear` table was installed, Linux mounted the resulting virtual ISO9660 device, and all four required markers were emitted. The original 512-byte synthetic initrd file was shadowed by a 1024-byte concatenated replacement; an unrelated file stayed unchanged, as did the physical source ISO hash. The measurement applies exclusively to the synthetic Linux fixture.

**EFI follow-up not validated:** probe-only GRUB/EDK2 changes were committed on `massimilianonardi-ai/Ventoy@m-boot-secondary-uefi` through `8edc1b92ce89314b79b7230015a1b1b6dd679865`, but no matching EFI firmware/ISO file-open CI passed. An attempt to publish an independent EFI verifier was blocked by tool security controls. Do not promote those EFI changes or infer successful EFI file shadowing from the Linux test.

## Evidence boundary and next step

This is an independent Linux-level validation of an **ISO9660 virtual namespace overlay**, not an EFI file-open or El Torito boot demonstration. Its sidecar sectors and `dm-linear` table are experiment-local: they do **not** claim to be a Ventoy `ventoy_override_chunk` / `ventoy_virt_chunk` runtime implementation, even though their purpose is the same. The next separate EFI experiment must implement the actual original Ventoy overlay ABI in the experimental GRUB chain and show that **Ventoy's original EFI BlockIo + ISO9660 filesystem driver** sees the overridden file; testing an EFI loader and injecting the minimal initramfs hook into real Proxmox VE 9.2-1 / TrueNAS 25.10.7 is a further step. Linux runtime hooks cannot be assumed to persist solely from an EFI file replacement, and secure-boot/verifier implications require their own explicit validation.
