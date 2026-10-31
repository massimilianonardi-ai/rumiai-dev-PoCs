# 072 — m-boot Ubuntu ISO on ext4 (disposable differential experiment)

## Question

Can existing m-boot / m-loader GRUB `loopback.cfg` boot the **identical**
`ubuntu-26.04.1-desktop-amd64.iso` if the ISO container changes from exFAT
to ext4, without replacing GRUB, Ventoy integration or modifying Ubuntu's
kernel/initramfs?

This is an experimental test, **not** a new m-boot product contract or a
successful boot claim. The operator's separate Ventoy 1.1.18 QEMU experiment
already reached the Ubuntu installer from exFAT, which shows that a more
complex early-userspace ISO handoff can work, but not that m-loader needs it.

## Prepare using current published m-boot image

Run on the Linux `vmdev` host, where the official Ubuntu ISO is available.
Provide the absolute path to an existing directory on a host filesystem
with adequate space (a 12 GiB sparse raw plus >6 GiB written ISO).

```sh
cd /m/src/git/m-boot
git pull --ff-only

# If the PoC repository is not cloned yet:
git clone https://github.com/massimilianonardi-ai/rumiai-dev-PoCs.git /m/src/git/rumiai-dev-PoCs

mkdir -p /m/src/git/m-boot-ext4-test

/m/src/git/rumiai-dev-PoCs/pocs/072-m-boot-ext4-iso/ext4-iso-test.sh prepare \
  --mboot /m/src/git/m-boot \
  --iso /run/media/admino/MBOOTDATA/m/boot/iso/ubuntu-26.04.1-desktop-amd64.iso \
  --output /m/src/git/m-boot-ext4-test
```

`prepare` verifies the published m-boot compressed and raw checksums plus
Ubuntu ISO hash, then creates a **new** 12 GiB sparse image. It verifies that
its `/dev/loopN` is attached to that specific image, extends only the virtual
GPT third partition, formats it as ext4 with label `MBOOTDATA`, copies and
re-hashes the ISO, and modifies only the **virtual ESP copy** of the menu
(`insmod exfat` → `insmod ext2`). The BIOS embed area and the original FAT32
ESP files are otherwise preserved from the exact published m-boot image.

**Never pass physical devices to this script. It has no such option.** It
never touches physical USB, existing `MBOOTDATA`, existing EFI partitions or
user files. The original `m-boot` checkout is read-only to the script.

## Run GUI boot and capture the actual outcome

Use the exact image path printed by `prepare`:

```sh
/m/src/git/rumiai-dev-PoCs/pocs/072-m-boot-ext4-iso/ext4-iso-test.sh boot \
  --disk /m/src/git/m-boot-ext4-test/mboot-ext4.XXXXXXXX/m-boot-ext4.raw \
  --ram 6144
```

Select **Bootable media → Live systems and installers → Ubuntu ISO
(loopback.cfg)**. Record the real Ubuntu installer/live desktop or exact
failure in GRUB/initramfs. `-snapshot` prevents QEMU guest disk changes from
persisting. `--ram 4096` is possible for hosts short on memory, but do not
infer a hang from slow x86_64 TCG on an ARM64 host. Remove `quiet splash`
interactively if needed to see kernel messages.

## Evidence and interpretation

- exFAT/m-boot previous run: Ubuntu splash then BusyBox `ash`; `mount -t
  exfat` reported `No such device` in initramfs.
- Ventoy/exFAT (separate operator 2026-10-31 run): Ubuntu installer started;
  its own ISO-boot mechanism is therefore a positive comparison.
- ext4/m-boot: **NOT EXECUTED** until the operator completes this new run.
- Ext4 **PASS** requires usable live root/installer, not GRUB/splash alone.
  On failure save `/proc/cmdline`, `/proc/filesystems`, `blkid`, `dmesg`,
  and the exact `casper` diagnostics.

Only one factor should explain the result: the m-boot ISO-bearing filesystem
(and its GRUB reader). No modified Ubuntu kernel or initramfs in this test.
Do not treat an ext4 success as compatibility proof for every other ISO.

## Next candidate only if useful: external initramfs on exFAT or ESP

GRUB may load an external matching kernel/initrd from the FAT32 ESP while the
ISO stays on exFAT; this alone does not help. The initramfs needs the kernel's
compatible exFAT driver (plus dependencies) and `casper`'s ISO-search logic
must accept and mount exFAT. Options include rebuilding the initramfs with
those changes or using an appropriately composed early-userspace addition.
Those are distinct follow-up experiments and must not mutate the original ISO,
physical USB, production m-loader or original kernel/initrd files. Evaluate
kernel-module ABI, initrd hooks, maintenance when Ubuntu versions change and
GRUB menu references. At present **none** has been run or certified.
