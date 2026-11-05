# PoC 090 — M-03 independent synthetic next-stage original init

**Task:** M-03 only, after M-02 PASS. This PoC proves that real Linux early userspace can reconstruct an unchanged synthetic ISO read-only, preserve the mounted ISO and device mapper across a **PID-1 process `exec`**, and allow a separately authored original next-stage `/init` to inspect and read the ISO independently.

## Boundaries

- `middleware-init.sh` is the *early* `/init` fixture. It uses **the unchanged** M-02 private stage `pocs/088-m-boot-linux-generic-iso/iso-stage.sh` and the actual compiled C consumer pinned to Ventoy `f213b860982f540f43d51a296b05768d13587af2`.
- `original-init.sh` is a **separate, independently authored synthetic original next-stage**. It is installed at `/original-root/init` before the ISO fixture is constructed. The middleware does not calculate the ISO digest, emit its original-init success markers or call any helper to fake the original init. On real handoff the middleware executes `exec /bin/sh /original-root/init`; the independently authored script checks it is now PID 1.
- The original next-stage discovers the mounted device through `/proc/mounts`, resolves the kernel read-only `dm-*` name through sysfs (not a hardcoded `dm-0`), reads the ISO marker and independently hashes the entire mapped block device. CI compares its digest to the host's unchanged original ISO and an independent extent-map oracle. **Cleanup happens after the next-stage read**.
- The middleware exercises real guest negatives **before** handoff: missing source disk identity in guest devtmpfs and corrupted EFI map through a temporary guest-only tmpfs overlay. Both refuse a mapper/mount and return without running the original next stage. The workflow checks the exact serial ordering and a single original-init entry.
- Reuse the existing PoC 079 synthetic ISO, unchanged Ubuntu generic kernel, M-02 stage and PoC 081 authentic UEFI/GPT/QEMU/OVMF pipeline; do not edit F-owned firmware or shared runner code. All media are disposable and run with QEMU `-snapshot`. The ISO's original internal initrd hook remains an unmodified fixture; this PoC installs its own next-stage script in the temporary base initrd, **not** in a real vendor initrd.

## Evidence and nonclaims

The `poc-090-m-boot-linux-original-init.yml` workflow requires independent guest markers for PID 1, inherited ISO9660 ro mount, real full block read, negative no-handoff paths, cleanup, and SHA-256 equality, then publishes `m03-evidence.txt` plus serial and map-provenance logs. A green firmware or overlay-boot marker alone is insufficient. The original-init digest is deliberately emitted by `original-init.sh` only after its own successful full device read.

This **does not** demonstrate a vendor Proxmox/TrueNAS installer, a new root filesystem pivot/`switch_root` or mount-namespace transfer, a boot into an untouched vendor `/init`, QMP or physical USB media removal, Secure Boot, BIOS/ARM64, or the M-04 original ISO EFI boot integration. Those require their own tasks and evidence. If the independent init fails, no M-03 PASS may be claimed; a fixture or GitHub Actions setup failure is reported separately.
