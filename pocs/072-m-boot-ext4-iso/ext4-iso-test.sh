#!/bin/sh
# Experimental m-boot ISO-on-ext4 comparison. Never accepts a physical device.
set -eu

ISO_NAME=ubuntu-26.04.1-desktop-amd64.iso
ISO_SHA256=601e30fbf5d97759367c632e2c33630665039b7e2158fd068403da3ccf1bda1f
RAW_NAME=m-boot-combined.raw
IMAGE_NAME=m-boot-combined.raw.gz

usage()
{
  cat <<'HELP'
Usage:
  ext4-iso-test.sh prepare --mboot REPO --iso ISO --output EXISTING_DIR
  ext4-iso-test.sh boot --disk VERIFIED_RAW [--ram MIB]

prepare makes an entirely NEW disposable 12 GiB GPT image from the published
m-boot BIOS/ESP/exFAT base. It preserves its BIOS embedding and ESP contents,
changes ONLY the new image's partition 3 to ext4, and switches its copied ESP
boot-media menu to load the GRUB ext2 module (ext2/3/4).
It copies and SHA256-verifies the original Ubuntu ISO inside /m/boot/iso/.
Never select a physical USB, loop/block device or existing output image.

boot uses QEMU x86_64 legacy BIOS, TCG, IDE and -snapshot; it needs a graphical
session. Select Bootable media > Live systems and installers > Ubuntu ISO.
Usable Ubuntu live desktop/installer is PASS; BusyBox or splash is NOT PASS.
HELP
}
fail()
{
  printf 'm-boot-ext4-iso: %s\n' "$1" >&2
  exit "$2"
}
need()
{
  command -v "$1" >/dev/null 2>&1 || fail "missing executable: $1" 2
}
hash_file()
{
  observed=$(sha256sum "$1" | awk '{print $1}') || fail "cannot hash: $1" 3
  [ "$observed" = "$2" ] || fail "SHA256 mismatch: $1 ($observed)" 4
}

[ "$(uname -s)" = Linux ] || fail 'Linux host required' 1
[ "$#" -ge 1 ] || { usage; exit 1; }
mode=$1
shift
case "$mode" in
  prepare)
    mboot=
    iso=
    output=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --mboot|--iso|--output)
          [ "$#" -ge 2 ] && [ -n "$2" ] || fail "missing value for $1" 5
          case "$1" in
            --mboot) mboot=$2 ;;
            --iso) iso=$2 ;;
            --output) output=$2 ;;
          esac
          shift 2 ;;
        *) fail "unexpected prepare option: $1" 6 ;;
      esac
    done
    [ -n "$mboot" ] && [ -n "$iso" ] && [ -n "$output" ] ||
      fail 'prepare needs --mboot, --iso and --output' 7
    [ -d "$mboot" ] && [ ! -L "$mboot" ] || fail 'mboot must be a directory' 8
    [ -f "$iso" ] && [ ! -L "$iso" ] && [ "$(basename -- "$iso")" = "$ISO_NAME" ] ||
      fail "ISO must be a regular file named $ISO_NAME" 9
    [ -d "$output" ] && [ ! -L "$output" ] || fail 'output must exist as a directory' 10
    for cmd in sha256sum awk gzip dd truncate mktemp sudo losetup lsblk sgdisk \
      partprobe blkid mkfs.ext4 mount umount cp sync sed grep stat; do need "$cmd"; done
    mboot=$(CDPATH= cd -- "$mboot" && pwd -P)
    iso=$(CDPATH= cd -- "$(dirname -- "$iso")" && pwd -P)/$(basename -- "$iso")
    output=$(CDPATH= cd -- "$output" && pwd -P)
    compressed="$mboot/images/$IMAGE_NAME"
    [ -f "$compressed" ] && [ ! -L "$compressed" ] || fail 'published m-boot image missing' 11
    for manifest in SHA256SUMS RAW-SHA256SUMS; do
      [ -f "$mboot/images/$manifest" ] || fail "missing $manifest" 12
    done
    compressed_sha=$(awk -v name="$IMAGE_NAME" '$2 == name {print $1}' "$mboot/images/SHA256SUMS")
    raw_sha=$(awk -v name="$RAW_NAME" '$2 == name {print $1}' "$mboot/images/RAW-SHA256SUMS")
    [ -n "$compressed_sha" ] && [ -n "$raw_sha" ] || fail 'missing published hashes' 13
    hash_file "$compressed" "$compressed_sha"
    hash_file "$iso" "$ISO_SHA256"
    gzip -t "$compressed" || fail 'compressed image corrupted' 14
    sudo -v || fail 'sudo authorization required for loop image only' 15
    umask 077
    work=$(mktemp -d "$output/mboot-ext4.XXXXXXXX") || fail 'cannot create private output directory' 16
    disk="$work/m-boot-ext4.raw"
    esp="$work/esp"
    data="$work/ext4"
    mkdir -p -- "$esp" "$data"
    loop=
    esp_mounted=no
    data_mounted=no
    cleanup()
    {
      if [ "$esp_mounted" = yes ]; then sudo -n umount "$esp" || :; fi
      if [ "$data_mounted" = yes ]; then sudo -n umount "$data" || :; fi
      if [ -n "$loop" ]; then sudo -n losetup -d "$loop" || :; fi
    }
    trap cleanup 0
    trap 'exit 130' 1 2 3 15
    # GNU dd sparse output conserves host space; independent raw SHA verifies
    # both the image's decompression and every byte of the published 2 GiB base.
    gzip -cd "$compressed" | dd of="$disk" bs=4M conv=sparse status=progress ||
      fail 'could not stage the m-boot source image' 17
    hash_file "$disk" "$raw_sha"
    truncate -s 12G -- "$disk" || fail 'cannot expand experiment image' 18
    disk=$(CDPATH= cd -- "$work" && pwd -P)/m-boot-ext4.raw
    loop=$(sudo -n losetup --find --show --partscan "$disk") ||
      fail 'could not attach disposable loop' 19
    case "$loop" in
      /dev/loop*)
        number=${loop#/dev/loop}
        case "$number" in ''|*[!0-9]*) fail 'invalid loop device identity' 20 ;; esac ;;
      *) fail 'not a loop device; refusing writes' 21 ;;
    esac
    backing=$(sudo -n cat "/sys/class/block/loop$number/loop/backing_file") ||
      fail 'cannot verify loop backing file' 22
    [ "$backing" = "$disk" ] || fail 'loop backing file mismatch; refusing writes' 23
    [ "$(lsblk -dn -o TYPE "$loop" | tr -d '[:space:]')" = loop ] ||
      fail 'unexpected block-device type' 24
    # BIOS sectors, 10 MiB BIOS embedding and the FAT32 ESP remain untouched.
    sudo -n sgdisk -e "$loop" || fail 'cannot relocate GPT backup' 25
    sudo -n sgdisk -d 3 -n 3:1071104:0 -t 3:8300 -c 3:MBOOTDATA "$loop" ||
      fail 'cannot resize disposable GPT data partition' 26
    sudo -n sgdisk -v "$loop" || fail 'invalid disposable GPT' 27
    sudo -n partprobe "$loop" || fail 'cannot reread disposable partitions' 28
    partition="${loop}p3"
    esppart="${loop}p2"
    [ -b "$partition" ] && [ -b "$esppart" ] || fail 'disposable GPT partitions absent' 29
    sudo -n mkfs.ext4 -F -L MBOOTDATA "$partition" || fail 'cannot format disposable ext4' 30
    [ "$(sudo -n blkid -s TYPE -o value "$partition")" = ext4 ] ||
      fail 'disposable partition is not ext4' 31
    sudo -n mount -t ext4 "$partition" "$data" || fail 'cannot mount ext4' 32
    data_mounted=yes
    sudo -n mkdir -p "$data/m/boot/iso" || fail 'cannot create ISO folder' 33
    sudo -n cp "$iso" "$data/m/boot/iso/$ISO_NAME" || fail 'cannot copy ISO to ext4' 34
    sudo -n sync || fail 'cannot flush copied ISO' 35
    copied=$(sudo -n sha256sum "$data/m/boot/iso/$ISO_NAME" | awk '{print $1}') ||
      fail 'cannot verify copied ISO' 36
    [ "$copied" = "$ISO_SHA256" ] || fail 'copied ISO differs' 37
    sudo -n umount "$data" || fail 'cannot unmount ext4' 38
    data_mounted=no
    sudo -n mount -t vfat "$esppart" "$esp" || fail 'cannot mount disposable ESP' 39
    esp_mounted=yes
    menu="$esp/m/boot/loader/menu/boot-media"
    [ -f "$menu" ] || fail 'ESP does not contain m-loader boot-media' 40
    [ "$(sudo -n grep -xc 'insmod exfat' "$menu")" = 1 ] ||
      fail 'unexpected m-loader menu: no unique exfat line' 41
    for target in i386-pc x86_64-efi arm64-efi; do
      [ -f "$esp/m/boot/loader/$target/ext2.mod" ] ||
        fail "missing ext2.mod in disposable ESP for $target" 42
    done
    sudo -n sed -i 's/^insmod exfat$/insmod ext2/' "$menu" ||
      fail 'cannot activate GRUB ext2 in disposable ESP' 43
    [ "$(sudo -n grep -xc 'insmod ext2' "$menu")" = 1 ] ||
      fail 'GRUB ext2 menu change not verified' 44
    sudo -n umount "$esp" || fail 'cannot unmount disposable ESP' 45
    esp_mounted=no
    sudo -n losetup -d "$loop" || fail 'cannot detach disposable loop' 46
    loop=
    {
      printf 'experiment=m-boot-ubuntu-ext4\n'
      printf 'mboot_source=%s\n' "$mboot"
      printf 'original_image_sha256=%s\n' "$raw_sha"
      printf 'iso_source=%s\n' "$iso"
      printf 'iso_sha256=%s\n' "$ISO_SHA256"
      printf 'filesystem=ext4\nfirmware=bios\n'
      printf 'mloader_change=disposable_ESP_boot_media_insmod_ext2_only\n'
    } > "$work/experiment.txt"
    printf '\nPREPARED: %s\n' "$disk"
    printf 'Boot: %s boot --disk "%s"\n' "$0" "$disk"
    ;;
  boot)
    disk=
    ram=6144
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --disk|--ram)
          [ "$#" -ge 2 ] && [ -n "$2" ] || fail "missing $1 value" 47
          case "$1" in --disk) disk=$2 ;; --ram) ram=$2 ;; esac
          shift 2 ;;
        *) fail "unexpected boot argument: $1" 48 ;;
      esac
    done
    [ -n "$disk" ] || fail 'boot needs --disk' 49
    case "$ram" in ''|*[!0-9]*) fail 'RAM must be a positive integer MiB value' 50 ;; esac
    [ "$ram" -ge 2048 ] && [ "$ram" -le 32768 ] || fail 'RAM must be 2048..32768 MiB' 51
    [ -f "$disk" ] && [ ! -L "$disk" ] || fail 'not a regular image file' 52
    [ "$(basename -- "$disk")" = m-boot-ext4.raw ] || fail 'unexpected disk image name' 53
    [ -f "$(dirname -- "$disk")/experiment.txt" ] &&
      grep -Fx 'experiment=m-boot-ubuntu-ext4' "$(dirname -- "$disk")/experiment.txt" >/dev/null ||
      fail 'experiment identity is missing' 54
    need qemu-system-x86_64
    disk=$(CDPATH= cd -- "$(dirname -- "$disk")" && pwd -P)/m-boot-ext4.raw
    printf 'Starting original m-boot loader on disposable ext4 ISO disk (QEMU snapshot).\n'
    printf 'Select Bootable media > Live systems and installers > Ubuntu ISO.\n'
    printf 'A usable Ubuntu desktop/installer is PASS, not the splash animation.\n'
    qemu-system-x86_64 -machine pc -accel tcg -m "$ram" -smp 2 \
      -drive "if=none,id=mboot,format=raw,file=$disk" -device ide-hd,drive=mboot \
      -boot c -snapshot -serial mon:stdio
    ;;
  --help|-h) usage ;;
  *) usage; fail "unknown subcommand: $mode" 55 ;;
esac
