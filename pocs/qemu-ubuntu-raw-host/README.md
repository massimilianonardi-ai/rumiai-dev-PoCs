# Ubuntu Minimal RAW QEMU host — m-boot experiment

Status: **IN PROGRESS / NOT A BOOTABLE m-boot FEATURE** (2026-11-05).

This experimental implementation follows the current operator requirement:
m-boot GRUB/EFI selects an ISO, boots a **file-backed RAW Ubuntu Minimal**
host, and that host starts a native-architecture QEMU guest with the unchanged
ISO attached as a **persistent optical drive**, accounting for all physical
disks. It is distinct from the previous K-03 synthetic direct QEMU guest.

## Files

- `build.sh`: fetch checksum-verified official Ubuntu 24.04 Minimal cloud
  image, enlarge/customize the **disposable GPT source**, identify its one
  ext4 root partition, and extract that **filesystem alone** as an unpartitioned
  RAW ext4 image. Export the **matching built** `vmlinuz` and `initrd.img`
  from the customized guest, verify Ubuntu's native `LOOP` support, and
  issue one checksum manifest
  covering RAW, kernel and initramfs. These artifacts must be deployed as
  **one indivisible per-architecture release** (not mixed across builds).
- `launch.py`: read exactly one `mboot.iso=` from Linux kernel cmdline,
  resolve the unchanged ISO through Ubuntu's preserved `/host` mount when
  necessary, inventory host disks using real `lsblk`, choose
  architecture-matched QEMU/firmware,
  and construct ISO and all-disks read-only backend attachments.
- `mboot-qemu-host.service`: systemd entrypoint in the minimal Ubuntu host;
  fails closed if no ISO was provided.
- Ubuntu's existing `initramfs-tools` `scripts/local` handles `loop=`:
  mount backing MBOOTDATA by `root=UUID`, mount the unpartitioned ext4 RAW
  root through a loop device, and preserve the backing filesystem under
  `/host`. The earlier custom GPT initramfs hooks were removed.
- `grub-example.cfg`: **not production-wired** proposed GRUB entry. It reads
  kernel/initramfs **directly from ext4 MBOOTDATA** and passes
  `root=UUID=<backing UUID>`, `loop=<RAW path>`,
  `loopfstype=ext4`, and the unchanged selected `mboot.iso=` path.
- `.github/workflows/m-boot-ubuntu-raw-host.yml`: Ubuntu 24.04 AMD64/ARM64
  native runners, checksums, disposable disk fixtures, RAW build evidence.

## One-release layout on MBOOTDATA

Install an architecture-matched bundle (after its build and actual GRUB boot
have passed) by copying the files from one generated build:

```
/m/boot/host/amd64/                  # native x86_64 UEFI host
  mboot-ubuntu-host.raw
  vmlinuz
  initrd.img
  kernel-release.txt
  release-SHA256SUMS

/m/boot/host/arm64/                  # native ARM64 UEFI host
  (same five files, independently built)
```

The compressed `mboot-ubuntu-host.raw.zst` is a transport artifact; decompress
it to the uncompressed `mboot-ubuntu-host.raw` before using this GRUB example.
Always verify `sha256sum -c release-SHA256SUMS` in the bundle directory before
deployment. A kernel upgrade requires rebuilding the image, regenerating its
initramfs, exporting both sidecars, and publishing a **new matching manifest**.
No automatic product update or rollback mechanism exists yet.

**Wubi research:** original Ubuntu Wubi/Lupin used a file-backed Ubuntu root,
`root=UUID=<backing_fs_uuid> loop=/ubuntu/disks/root.disk` and an
initramfs-tools loop-root path. Ubuntu 24.04 still documents `loop=`.
This prototype now also uses an **ext4 filesystem image**, rather than a GPT
disk image, so Ubuntu's own `scripts/local` can mount the image natively
without new boot hooks or an offset. The real Ubuntu 24.04 package
`initramfs-tools-core 0.142ubuntu25.8` was inspected in CI run
[42090302581](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42090302581):
it contains `LOOP` support and `mount -o move`. Historical references:
https://wiki.ubuntu.com/WubiGuide ;
https://mirror.math.princeton.edu/pub/ubuntu/ubuntu/pool/main/l/lupin/ ;
https://mail-archive.com/debian-bugs-dist%40lists.debian.org/msg461943.html .
Current runtime interface:
https://manpages.ubuntu.com/manpages/noble/man7/initramfs-tools.7.html .

**Gates still unproven:** whether customized Ubuntu can be successfully
exported as an ext4 filesystem image on both architectures, whether the
native `loop=` path preserves the backing mount through switch-root, and
whether the external kernel/initramfs actually boot Ubuntu via GRUB/UEFI.
A PASS on parser checks or synthetic ext4 images is not an end-to-end boot.

## Current validation boundary

Pinned run [42079576887](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42079576887)
demonstrated real AMD64/ARM64 **QMP inspection of paused QEMU** with a
synthetic ISO and two disposable disk-image fixtures: three inserted
read-only devices and no source change. This is *not* proof that a guest
kernel or the host Ubuntu RAW booted. RAW build is still being debugged:
run [42080535799](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42080535799)
observed a guest package-download/DNS failure on ARM64 after real image
expansion; the run has no overall PASS. Later external-sidecar changes are
not covered by those earlier source-pinned runtime results.
No genuine Proxmox/TrueNAS ISO, physical disk or operator machine was used.

The code currently **does not grant physical disk writes**. All discovered
physical disks are represented as read-only virtual block backends. The
source/boot disk cannot be made writable in the guest while hosting Ubuntu
RAW and ISO files writable on the host; other disks need an explicit
exclusive-ownership and per-target authorization design before writable
passthrough is added. No physical device has been attached by this PoC.

For genuine m-boot support, the next observable milestones are:
1. genuine release-pinned AMD64/ARM64 **ext4 filesystem RAW** images generated;
2. genuine Ubuntu host boot with the exported kernel/initramfs and
   `root=UUID=...` + `loop=...` through real GRUB/UEFI in disposable QEMU;
3. native `initramfs-tools` preserves backing `/host` mount and original
   ISO location throughout the boot, without private GPT/looproot hooks;
4. service invokes actual QEMU with ISO and multiple disposable raw disks,
   and guest independently observes the expected optical and disk inventory;
5. actual multi-architecture GPU/console, KVM/TCG and original vendor installer
   tests; only then independent physical/reference host execution.
These milestones are **pending**, not implicit PASS from file presence.

## Release inputs

- Canonical Ubuntu Minimal 24.04 released build 2026-11-03:
  https://cloud-images.ubuntu.com/minimal/releases/noble/release-20261103/
- SHA256SUMS from the **same pinned release directory**, checked against the
  downloaded .img; no unverified image or modified vendor installer.
- Official GRUB loopback docs:
  https://www.gnu.org/software/grub/manual/grub/html_node/Loopback-booting.html
- QEMU physical block backend caution:
  https://www.qemu.org/docs/master/system/qemu-block-drivers.html

Task authority, source pinned CI evidence and outstanding work are tracked in
`rumiai-dev/handoff/m-boot-ubuntu-qemu-host.md`. Do not mistake this README
for a promoted product compatibility or disk safety contract.
