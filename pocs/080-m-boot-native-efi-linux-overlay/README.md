# PoC 080 — Original ISO EFI bootloader executes virtual initrd

**Status (2026-11-04): synthetic end-to-end UEFI boot PASS.** The source
ISO and its kernel are not modified and no product installation is tested.

## Real test

Workflow: `.github/workflows/poc-080-m-boot-native-efi-linux-overlay.yml`.
GitHub Actions run **41838046494 SUCCESS**, PoCs source commit
`2270418616b112986430892f463a15968f8025ba`, pinned Ventoy experimental
fork commit `3d94d63a40d5c68a7dcf507bc4ee6b983c5d0f2d`.

QEMU/OVMF first boots the original PoC 079 generated ISO as a read-only CD
and observes the **original** Linux `/init`. The separate second QEMU
instance boots stock GRUB with the external original-Ventoy-ABI module,
loads the **real** Ventoy EDK2 EFI application and distributed ISO9660 EFI
driver from the isolated boot ESP, and makes the original PoC 079 ISO
available from a disposable FAT32 GPT source disk. The new
`vt_overlay_probe ... boot-hook` identifies the actual ISO9660 primary
directory record for `boot/initrd-hook.cpio` through bounded original
Rock Ridge metadata and fills native Ventoy override/virtual chunks.
The original Ventoy EFI boot path loads the GRUB EFI executable **from the
ISO**. That GRUB loads the unmodified Ubuntu Linux kernel and the overridden
initrd. The Linux `/init` prints `VT079_LINUX_INITRAMFS_OVERLAY`.
The test rejects `VT079_LINUX_INITRAMFS_ORIGINAL` and verifies the
original ISO SHA256 still matches, as well as the original source map
against actual physical sectors on the disposable GPT image.

**This validates bootloader → original kernel → replacement early userspace,
not recovery of physical ISO media after ExitBootServices**; the latter
is independently checked by PoC 081. No GRUB core rebuild, host disk/USB
writes, real ISO modification or change to Ventoy/master or m-boot/main.
