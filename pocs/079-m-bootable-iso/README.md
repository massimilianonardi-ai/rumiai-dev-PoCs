# PoC 079 — Small bootable ISO with original GRUB UEFI + Linux

This is a **generated**, self-contained UEFI/El Torito Linux ISO experiment,
not a downloaded third-party distribution and not an installer.
It reuses the existing m-boot experimental concept of an EFI-side ISO file
shadow, but keeps firmware boot and Linux initramfs validation distinct.

## Inputs and outputs

GitHub Actions workflow: `.github/workflows/poc-079-m-bootable-iso.yml`.

The Ubuntu 24.04 runner installs the genuine distribution `grub-mkstandalone`
and `linux-image-generic`; the resulting `vmlinuz` is **unmodified**.
`build-bootable-iso.sh` creates a **new** temporary directory containing:

- `bootable.iso`: standard UEFI El Torito boot catalog and a FAT EFI boot
  image containing a GRUB EFI executable, plus the genuine Linux kernel;
- `/boot/initrd-base.cpio`: fixed base cpio archive holding real
  `busybox-static`, tools and minimal early-userspace directories;
- `/boot/initrd-hook.cpio`: a tiny second cpio archive with an `/init`
  program emitting `VT079_LINUX_INITRAMFS_ORIGINAL`;
- `initrd-hook-overlay.cpio` **outside the ISO**: a similarly small
  replacement archive with an `/init` emitting
  `VT079_LINUX_INITRAMFS_OVERLAY`.

Splitting immutable base and tiny hook makes the next native Ventoy
`ventoy_override_chunk` + `ventoy_virt_chunk` integration possible
without immediately lifting the current **64 KiB experimental limit**.
It is an intentional test fixture, not an assertion that real installer
initrds can be split or changed this way.

`smoke-boot.sh` starts QEMU/OVMF with the generated ISO as a **read-only
CD-ROM**. Success requires serial evidence from GRUB, handoff to the
unmodified kernel, execution of the ORIGINAL initramfs `/init`, a
successful guest shutdown, and unchanged ISO SHA256. It must **not**
show the overlay initramfs marker before the overlay experiment.

## Boundaries

The first run proves only **bootability of the original test ISO**.
It does **not** yet prove that the original ISO’s own EFI GRUB reads the
overlaid `initrd-hook.cpio` from a Ventoy virtual CD, nor that a real
Proxmox VE or TrueNAS image boots. That is the separate next QEMU step,
requiring a real `m-boot-secondary-uefi` chain + original Ventoy EFI
bootloader path. The fixture and QEMU tests are disposable/rootless;
there are no writes to a USB or host disk, no patched GRUB core,
and no production-mode changes.
