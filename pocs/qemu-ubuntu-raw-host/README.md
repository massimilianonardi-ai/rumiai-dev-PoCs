# Ubuntu Minimal RAW QEMU host — m-boot experiment

Status: **IN PROGRESS / NOT A BOOTABLE m-boot FEATURE** (2026-11-05).

This experimental implementation follows the current operator requirement:
m-boot GRUB/EFI selects an ISO, boots a **file-backed RAW Ubuntu Minimal**
host, and that host starts a native-architecture QEMU guest with the unchanged
ISO attached as a **persistent optical drive**, accounting for all physical
disks. It is distinct from the previous K-03 synthetic direct QEMU guest.

## Files

- `build.sh`: fetch checksum-verified official Ubuntu 24.04 Minimal cloud
  image, enlarge/customize the **disposable** copy, convert it to a true RAW
  GPT disk and compress it without changing its byte-level image format.
- `launch.py`: read exactly one `mboot.iso=` from Linux kernel cmdline,
  resolve a `mboot.media_uuid=` host filesystem where necessary, inventory
  host disks using real `lsblk`, choose architecture-matched QEMU/firmware,
  and construct ISO and all-disks read-only backend attachments.
- `mboot-qemu-host.service`: systemd entrypoint in the minimal Ubuntu host;
  fails closed if no ISO was provided.
- `mboot-raw-root`, `mboot-raw-initramfs-hook`: intended initramfs-tools
  handoff from a GRUB-opened disk image to loop-mounted real root.
- `grub-example.cfg`: **not production-wired** GRUB loopback proposal for
  a GPT RAW image on MBOOTDATA. Reads kernel/initrd from the image and
  passes the selected ISO, RAW path and backing filesystem UUID.
- `.github/workflows/m-boot-ubuntu-raw-host.yml`: Ubuntu 24.04 AMD64/ARM64
  native runners, checksums, disposable disk fixtures, RAW build evidence.

## Current validation boundary

The first full GitHub Actions runs have established a real AMD64 and ARM64
launcher **read-only plan** using a selected synthetic ISO and two disposable
disk-image fixtures. This is only a static QEMU command plan, **not** proof
that QEMU accepted the command or that the host Ubuntu RAW booted. Raw image
creation is still being debugged against the CI libguestfs appliance.
No genuine Proxmox/TrueNAS ISO, physical disk or operator machine was used.

The code currently **does not grant physical disk writes**. All discovered
physical disks are represented as read-only virtual block backends. The
source/boot disk cannot be made writable in the guest while hosting Ubuntu
RAW and ISO files writable on the host; other disks need an explicit
exclusive-ownership and per-target authorization design before writable
passthrough is added. No physical device has been attached by this PoC.

For genuine m-boot support, the next observable milestones are:
1. real release-pinned AMD64/ARM64 Ubuntu RAW image generated;
2. genuine Ubuntu host boot from that RAW as a disk in stock QEMU/UEFI;
3. GRUB loopback RAW kernel/initramfs and initramfs image root handoff
   exercised end-to-end in nested QEMU;
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
