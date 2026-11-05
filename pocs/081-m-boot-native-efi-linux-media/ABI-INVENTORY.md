# F-01 — Experimental UEFI-to-Linux ISO source-map inventory

Status: source inventory complete (F-01); **not** a released interface, production contract, new boot run, or F-02 safety PASS.  
Date: 2026-11-05

## Revisions and evidence boundaries

- Producer and consumer: `massimilianonardi-ai/Ventoy` branch `m-boot-secondary-uefi` at `ceff79ca92d246928f86362a569f86c6d2ac130f`.
- Current PoC source context: `rumiai-dev-PoCs` at `cbd5906b5af50c989764dabc9acba48dd5d43dc2` before this inventory.
- Positive **synthetic** UEFI/OVMF → original ISO EFI GRUB → unchanged Ubuntu kernel → early Linux ISO remount: PoC 081, [run 41839593585](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/41839593585), pinned PoC code `ea72985bcdb98583280921d6acc2d0e496eba276`, original ISO 42,010,624 bytes. The previous run is not being rerun or relabeled.
- Negative **early parser only**: PoC 087, [run 42015054609](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42015054609), 13/13 malformed EFI-variable inputs refused before device scanning/table creation. No source-disk/GPT/fragmented-boot negative PASS.
- Source anchors below refer to the exact Ventoy commit above; they describe observed current implementation, not an independently standardized wire ABI.

## Producer, transport, consumer and lifetime

1. The disposable QEMU fixture executes a version-matched external, stock-GRUB-compatible `ventoy_source_probe.mod`. `vt_extent_probe` reads the actual ISO on a GRUB disk partition via a file read hook, coalesces physically contiguous extents, verifies ISO9660 PVD, 2048-byte logical-sector alignment and complete source-byte coverage, and converts them to **original** `ventoy_img_chunk` records. Its read hook reports whole-disk sectors in the tested GRUB 2.12 fixture, **not** partition-relative sectors. Sources: [probe-extents.c](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/probe-extents.c) and [original Ventoy declarations](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/MOD_SRC/grub-2.04/include/grub/ventoy.h).
2. `vt_probe_handoff` constructs an original Ventoy `ventoy_chain_head` / `ventoy_os_param` with source path, whole-disk size, partition index, MBR-resident identity fields, checksum, unmodified original image size and physical chunks. It separately reads the **primary GPT disk GUID** from bytes 56–71 of LBA 1; that GUID becomes the experimental variable header's physical-source identifier. The `os_param.vtoy_disk_guid` copied from MBR offset `0x180` must **not** be mistaken for that header GPT GUID. `ventoy_chain_head` and `ventoy_grub_param` stay in GRUB memory until the EFI `StartImage` path returns/module unload; they are **not** the Linux handoff itself. Source: [probe-handoff.c](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/probe-handoff.c).
3. In the PoC 081 `original-overlay-boot` script, `vt_publish_efi_map` runs **before** `vt_overlay_probe` and the original Ventoy EFI `chainloader`. It calls UEFI Runtime Services `SetVariable` for `VtDmMapProbe`, vendor GUID `0e5e24d4-168b-4f9e-a397-0951f757111e`, with `BOOTSERVICE_ACCESS | RUNTIME_ACCESS` (attributes value `0x00000006`, no `NON_VOLATILE` flag). Publication is explicit, not automatic for arbitrary ISO boots. The original EDK2 Ventoy application/virtual BlockIo and inner original ISO GRUB then reach the unchanged Linux kernel. The EFI variable stores the **physical original ISO extents**, not virtual replacement ISO9660 overlay contents. Sources: [publisher in probe-handoff.c](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/probe-handoff.c), [QEMU script](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/probe-standalone-uefi.sh), [PoC 081 workflow](../../.github/workflows/poc-081-m-boot-native-efi-linux-media.yml).
4. After `ExitBootServices`, the synthetic initramfs mounts `efivarfs`, reads the Linux kernel's view of the variable via `/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e`, resolves a **unique** physical disk, writes a `dm-linear` table, then invokes `dmsetup create ... --readonly`. The guest separately hashes the resulting block device, compares the original-source ISO digest, mounts ISO9660 read-only, and verifies the marker. Sources: [consumer C](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/probe-linux-efi-consumer.c) and [early initramfs fixture](https://github.com/massimilianonardi-ai/Ventoy/blob/ceff79ca92d246928f86362a569f86c6d2ac130f/GRUB2/port/build-linux-handoff-initrd.sh).
5. The PoC proves **one** successful Linux read of this variable after boot on QEMU/OVMF. It does **not** prove variable deletion, uniqueness across warm boots, lifespan across every firmware, EFI runtime support on real hardware, Secure Boot compatibility or a generic original-init handoff.

## Exact experimental byte layout

Integers below are **little-endian** in the tested x86_64 UEFI/GRUB/C consumer. The 4-byte Linux efivarfs attribute prefix is **not** part of the `SetVariable` payload.

| Payload offset | Bytes | Field / meaning |
|---|---:|---|
| 0–7 | 8 | ASCII magic `VTDMAP01` |
| 8–11 | 4 | `count`: number of physical source chunk records |
| 12–15 | 4 | `chunk_bytes` = 24 |
| 16–23 | 8 | `iso_bytes`: **original** ISO byte length |
| 24–39 | 16 | raw GPT disk GUID copied from primary header LBA 1, offsets 56–71 |
| 40–551 | 512 | original packed `ventoy_os_param`, checksum over all 512 bytes modulo 256 = 0 |
| 552 onward | `24 × count` | original packed `ventoy_img_chunk[]` |

Efivarfs file offsets are payload offsets **plus 4**: `0–3` attributes, `4–11` magic, `12–15` count, `16–19` record width, `20–27` ISO bytes, `28–43` GPT GUID, `44–555` `os_param`, and chunks from byte `556`. Full payload size is `552 + 24 × count` bytes; efivarfs file adds four bytes.

Each original `ventoy_img_chunk` is packed as:

| Relative offset | Bytes | Meaning |
|---|---:|---|
| 0–3 | 4 | `img_start_sector`: ISO 2048-byte sector index, inclusive |
| 4–7 | 4 | `img_end_sector`: ISO 2048-byte sector index, inclusive |
| 8–15 | 8 | `disk_start_sector`: physical whole-disk **512-byte** LBA, inclusive |
| 16–23 | 8 | `disk_end_sector`: physical whole-disk **512-byte** LBA, inclusive |

One ISO sector maps to four physical sectors. The consumer emits `(img_start × 4, (img_end - img_start + 1) × 4, linear, source-partition-path, disk_start - GPT-partition-start)`, where dm offsets are 512-byte sectors and the input source is the identified **partition**, not the whole-disk path. Chunk order must cover ISO sector interval `[0, iso_bytes / 2048)` without holes or overlap.

Relevant `ventoy_os_param` offsets **relative to its 512-byte start** (not the outer payload): `0–15` Ventoy signature GUID; `16` checksum; `17–32` original MBR disk identity bytes; `33–40` whole-disk size in bytes; `41–42` 1-based partition ID; `43–44` source filesystem type; `45–428` UTF-8 path (384 bytes); `429–436` original ISO byte length; `437–444` location address; `445–448` location length; `449–480` reserved; `481–484` MBR disk signature; `485–511` reserved. Only a subset is interpreted by this Linux consumer; a matching `os_param` checksum is **not** cryptographic authentication.

## Currently enforced vs unproven safety

| Stage | Implemented checks | Explicit gap or boundary |
|---|---|---|
| GRUB source mapper | real readable partition/file; ISO9660 PVD; 2048-byte image and extent alignment; logical continuity/coverage; 512-byte backing sector; 32-bit image-sector ceiling; merged physical extents | Only tested GRUB 2.12 read-hook semantics and fixture filesystem; not arbitrary filesystems/firmware |
| GRUB map construction | MBR `55aa`, primary GPT signature and plausible header size, nonzero original chunk count, GRUB memory chain, original `os_param` checksum | No demonstrated primary GPT header/entry CRC verification; GUID and MBR identity do not authenticate disk contents |
| EFI publisher | live original chain; GUID text 32 hex; identical real/virtual size at export; 512-byte source sector; 16 KiB payload cap; Runtime Services/SetVariable success; runtime-visible attributes | No explicit consumer-compatible 640-record limit; no variable deletion/lifetime guarantee; no signed/authenticated EFI variable |
| Linux parser | attributes bits `0x6`; magic; exact payload length; 24-byte records; `count` 1–640; ISO bytes positive/2048-aligned; original Ventoy GUID and checksum; `os_param` partition 1–128 and original size match | EFI attribute predicate accepts additional bits; source path/type and MBR identity fields are not independently compared |
| Linux source selection | scans only `sd*`, `vd*`, `nvme*`, `mmcblk*`; checks block size, primary GPT signature and disk GUID; requires **one** match | No primary GPT CRC validation, no full GPT bounds/entry-array integrity verification, no cryptographic source trust; other device-name families unsupported |
| Linux dm table | GPT entry width 128, nonzero partition start, last ≥ start, sysfs partition **start** equality, ISO chunk logical continuity, mapped physical sector bounds within GPT partition, complete ISO coverage | Table file is opened and can be partially written **before** all extents/coverage pass; GPT partition end is not independently checked against sysfs size/disk bounds before output |
| Guest post-parser | `dmsetup --readonly`, full source ISO SHA256 equality (against immutable fixture), read-only ISO9660 mount and marker | Hash equality is a **test oracle** supplied by fixture, not a generic authenticated source trust mechanism or vendor media-ID acceptance |

**Concrete producer/consumer capacity mismatch:** `vt_publish_efi_map` uses a 16,384-byte payload limit, allowing mathematically up to **659** 24-byte records (`552 + 659×24 = 16,368`), while the Linux consumer hard-rejects `count > 640`. Producer source also allows `img_chunk_num` up to 16,384 before applying the payload size check. Thus counts **641–659** can publish successfully but are refused by Linux. F-01 documents this; changing source, format or limit belongs to **F-02/F-05 coordination**, not this inventory.

Other negative/unverified cases for the following F tasks: duplicated GPT identity, missing/removed media, bad header CRC, unsupported GPT entry sizes/counts and malicious LBA offsets, GPT/sysfs end mismatch, >640 extents, partial table on malformed last extent, variable absent after phase transition, unavailable runtime service, invalid attributes, failure to load modules/Device Mapper, image mutation between firmware and Linux (TOCTOU), Secure Boot policy and different UEFI implementations. PoC 087 supports **only** the 13 early parser refusals described above.

## Explicit supported assumptions and handoff use

- **Demonstrated** only on synthetic x86_64 UEFI QEMU/OVMF, stock Ubuntu 24.04 kernel and tested external GRUB module/EDK2 virtual optical path. No BIOS, ARM64, physical flash, Proxmox or TrueNAS media acceptance is established by this inventory.
- The synthetic tested source was a disposable FAT32 GPT disk and original ISO; the map is always of original *physical* sectors, while the EFI virtual optical view may show transient initramfs/ISO9660 overlays. On Linux the original file content is reconstructed read-only; the overlay is not itself exported as physical media.
- Consumers of this inventory (M tasks) may **pin its recorded experimental layout and limits only to the exact source revisions above**. The 640-record accepted bound and unproven GPT/identity/security edges must be treated as constraints or blockers; do not upgrade them into a general m-boot public ABI or assume they survive future source revisions.
- F-01 is a **source-and-prior-evidence inventory**, not a new execution test. Continue F-02 (device/GPT/extent negatives), F-03 (genuinely fragmented ISO full boot), F-04 (runtime/media loss) and F-05 (integration gate) only as separately selected tasks.
