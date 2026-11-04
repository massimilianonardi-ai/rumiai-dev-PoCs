# 075 — m-boot Linux ISO device reconstruction (experimental)

## Question

Can the **existing original Ventoy `ventoy_img_chunk` ABI** represent a fragmented ISO on an arbitrary GPT partition, and can unmodified Linux reconstruct a *read-only real kernel block device* from it, preserving the ISO9660 bytes and an installer media-identification file?

This is a **PoC**, not m-boot product code, not proof of EFI → Linux transfer, and not a successful Proxmox/TrueNAS installer boot.

## Scope

- On a disposable 256 MiB raw disk image only, create GPT partition **number 3** with ext4; never open, repartition or write an operator disk.
- Generate a small genuine ISO9660 with `/.pve-cd-id.txt`; it is an **illustrative marker**, not the genuine Proxmox 9.2-1 ID.
- Copy this tiny *synthetic* ISO into ext4 with interleaved fillers and fsync to enforce fragmented allocation. The user's installation ISO is never read or copied.
- Use Linux FIEMAP as a **stand-in producer** for the binary `ventoy_img_chunk` array already produced and independently checked by the stock-GRUB module experiment. FIEMAP is not the eventual GRUB → Linux transport.
- Reparse the original packed 24-byte chunk format (`<IIQQ`), validate contiguous logical coverage, 2048/512-byte geometry, physical disk ranges, exact byte-by-byte contents and SHA256; reject a deliberately corrupted map.
- Translate the validated mapping to Linux `dm-linear` using the real **GPT3 partition start**, not Ventoy's hardcoded default part 1 / sector 2048 path. Use `dmsetup create --readonly`, read and hash the entire resulting block device, mount ISO9660 read-only and compare the media ID.

The currently inspected Ventoy experimental fork is `massimilianonardi-ai/Ventoy@m-boot-secondary-uefi` commit `1b95c55c370b8d00e62b459a23d78f58f37f9a9a`; relevant files: `GRUB2/port/probe-extents.c`, `GRUB2/port/verify-extent-map.py`, `VtoyTool/vtoydm.c`. Original `vtoydm -p` has a fixed first-partition assumption in its default path; do not copy it.

## Execute

On disposable x86_64 Linux with `sudo`, loop devices and kernel dm-linear support, install `gdisk`, `util-linux`, `e2fsprogs`, `dmsetup`, `xorriso` and Python 3, then:

```sh
sudo sh pocs/075-m-boot-linux-dm/run-linux.sh
```

The script has no input disk path and creates and later destroys a private temporary file-backed GPT disk. It refuses to proceed without real Linux device-mapper and loop support. The automated CI workflow exercises this on an Ubuntu GitHub-hosted runner.

## Evidence boundaries

`ISO_IMG_CHUNK_VALIDATED` demonstrates the actual packed binary map and raw source reads. `LINUX_DM_FULL_ISO_SHA256_PASS` demonstrates *kernel device-mapper reconstruction* rather than userspace imitation. `LINUX_DM_ISO9660_IDENTITY_PASS` demonstrates that the real ISO9660 mount exposes the original marker. All three require a genuinely completed run; authoring/syntax checks are not substitutes.

Still pending after a successful PoC: actual handoff of the GRUB-produced map/physical disk identity across `ExitBootServices` into an appropriate **unchanged Linux kernel** initramfs; genuine matching Proxmox VE 9.2-1 and TrueNAS SCALE 25.10.7 initrd inspection; unmodified-stock-GRUB-core boot path that delivers that initramfs component; true installer QEMU boot; BSD/Windows adapters. Do not assume the correct identity is only the ISO9660 volume label: Proxmox also reads `/.pve-cd-id.txt` from its mounted media.
