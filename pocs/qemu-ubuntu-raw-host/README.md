# m-boot Ubuntu Minimal ext4 RAW host PoC

Status: **EXPERIMENTAL — not yet an operational m-boot boot entry**.
Build architecture changed 2026-11-05 at operator request.

## What this tests

The existing m-boot GRUB/EFI menu selects an unchanged ISO file on ext4
MBOOTDATA. GRUB loads a matching external Ubuntu kernel/initramfs and passes
`root=UUID=<MBOOTDATA filesystem UUID> loop=<RAW filesystem-image pathname>
loopfstype=ext4 mboot.iso=<selected ISO pathname>`. Ubuntu's **native**
`initramfs-tools` loop-root handling mounts the RAW as the system root and
keeps the backing MBOOTDATA partition available at `/host`. A systemd unit
starts architecture-matched QEMU with the ISO as a persistent read-only
virtual CD-ROM and all discovered physical disks as **read-only** guest disks.

The RAW is a **single ext4 filesystem image, without a partition table**.
External kernel and initramfs come from the same build and must never be mixed
with files from another bundle revision. No source ISO or physical disk is
modified by the PoC. This is still a host-assisted VM path, not native
bare-metal execution of the selected ISO.

## Builder: debootstrap, not Cloud Image or libguestfs

`build.sh NEW_OUTPUT_DIRECTORY` must run as root on a **disposable Ubuntu
24.04 build environment** with normal network access. It deliberately rejects
existing output directories and unsupported host architectures. On the native
AMD64/ARM64 build runner it:

1. Uses `debootstrap --variant=minbase` with official Ubuntu 24.04
   repositories for the matching architecture.
2. Performs APT installation only **during image creation** inside the chroot:
   Linux generic kernel, `initramfs-tools`, systemd/udev, Python, utilities,
   architecture-matched QEMU and its UEFI firmware.
3. Verifies the installed Ubuntu `scripts/local` loop-root support, includes
   the ext4 and loop modules, installs `launch.py` and enables the systemd
   unit; regenerates the initramfs.
4. Exports same-build `vmlinuz` and `initrd.img`, verifies the embedded
   `scripts/local` and records installed package versions.
5. Unmounts the temporary build chroot filesystems, then uses
   `mkfs.ext4 -d` to populate a **sparse file** from the prepared root tree
   directly; no loopback block device, partition table, QCOW2, `guestfish`,
   `virt-customize` or nested libguestfs appliance is needed.
6. Checks the RAW via `blkid` and read-only `e2fsck`, creates a single
   SHA256 manifest and compresses the unmodified ext4 RAW with zstd.

The builder requires root for `debootstrap`, package installation, chroot
and temporary build mounts; cleanup unmounts these filesystems on failure.
No permission to write a real target block device is required. Do not run
this as an unattended destructive installation script.

Ubuntu apt repositories are accessed from the build host and build chroot,
**never from the m-boot runtime**. Versions of the installed packages appear
in `packages.txt`; a successful build, especially on both architectures,
must be source-pinned in CI before it can be accepted.

## Bundle layout on ext4 MBOOTDATA

Deploy **exactly one verified same-build bundle** per architecture (the
compressed image is only a transport artifact):

```
/m/boot/host/amd64/
  mboot-ubuntu-host.raw
  vmlinuz
  initrd.img
  kernel-release.txt
  release-SHA256SUMS

/m/boot/host/arm64/
  (equivalent files from a separate ARM64 build)
```

Before deployment decompress `mboot-ubuntu-host.raw.zst` to
`mboot-ubuntu-host.raw` and verify `sha256sum -c release-SHA256SUMS` in
the bundle directory. A kernel upgrade requires rebuilding the entire
bundle, not copying a lone boot file. The current prototype has no atomic
on-device upgrade/rollback implementation.

## Key files

- `build.sh`: direct minbase/chroot/rootfs → ext4 RAW builder.
- `grub-example.cfg`: **not installed in the production m-boot menu**;
  loads external kernel/initramfs, passes native Ubuntu `loop=` and ISO.
- `launch.py`: resolves selected ISO under Ubuntu-preserved `/host`,
  inventories block disks, creates read-only QEMU backends.
- `mboot-qemu-host.service`: launches the guest from systemd.
- `smoke.py`: actually runs paused native QEMU and inspects QMP block
  backends with disposable synthetic ISO/disks, not a guest boot.
- `.github/workflows/m-boot-ubuntu-raw-host.yml`: native AMD64/ARM64
  GitHub-hosted builders and limited isolated tests.

## Validation boundary

The earlier source-pinned [42079576887](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42079576887)
proved only paused native QEMU with read-only synthetic backing files and
no fixture writes. Ubuntu 24.04 `initramfs-tools-core` loop-root support
was inspected on an actual runner in [42090302581](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42090302581).

**Direct Ubuntu minbase builder validated on both architectures.**
The source-pinned [GitHub Actions run 42114121474](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42114121474),
revision `b872aeb93578080e9b636aa239e5c7020a030e96`, completed **PASS**
for its native AMD64/ARM64 build jobs and static boot-contract job. It
actually ran `debootstrap`, build-time APT, Ubuntu initramfs generation,
`mkfs.ext4 -d`, `qemu-img info -f raw`, `blkid`, read-only `e2fsck`,
`sha256sum -c release-SHA256SUMS`, and verified matching external
`vmlinuz`/`initrd.img`, publishing two compressed RAW bundle artifacts.
The builder emitted `6.8.0-147-generic` for both native architectures.

**This is a build PASS only.** A workflow's static GRUB parser PASS is not
a genuine GRUB/UEFI boot. Still untested: Ubuntu reaching systemd from
RAW with `loop=`, preserved `/host` source-ISO access, guest-side CD-ROM
and physical-disk inventory, native KVM, graphics, genuine vendor ISO
boot, and final operator reference-host validation.

All disks remain **read-only in the guest**. A subsequent design must give
writable target disks exclusive ownership without allowing concurrent writes
to the m-boot source disk. Do not run destructive tests on physical drives.

Current state and execution evidence are owned by
`rumiai-dev/handoff/m-boot-ubuntu-qemu-host.md`. Do not promote this PoC
README to a current product contract.
