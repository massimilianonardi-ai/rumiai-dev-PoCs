# F-05 — Firmware-to-Linux experimental interface handoff

Status: **F-05 PASS — bounded source-conformance and handoff gate (2026-11-05)**. Dedicated GitHub Actions [run `42055652148`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42055652148), job `127343203655`, completed **SUCCESS** using current experimental Ventoy commit `475db53dee122887fab3387db47fbb1f09ca71b7`. The compiled real Linux consumer passed **13/13** early variable cases and **21/21** disposable GPT/extent cases, and the source interface guard passed. This is not new QEMU/physical/vendor evidence.  
Date: 2026-11-05. Owner: firmware tasks in `rumiai-dev/handoff/m-boot-standalone.md`.

This is a **version-pinned experimental interface and evidence ledger for M-04 only**, not a production API, signed-off hardware capability, or installer-compatibility claim. Preserve the actual producer and consumer; do not introduce an alternative serialization, GUID or namespace.

## Fixed source identity and test evidence

The exact firmware source tree is **massimilianonardi-ai/Ventoy**, branch `m-boot-secondary-uefi`, commit **`475db53dee122887fab3387db47fbb1f09ca71b7`**.

| Current existing source | Exact Git blob SHA | Responsibility |
|---|---|---|
| `GRUB2/port/probe-handoff.c` | `3f05d10d2a293383db32b5973df23d292f492e79` | GRUB original Ventoy chain and actual EFI Runtime Services publisher |
| `GRUB2/port/probe-linux-efi-consumer.c` | `31f68c6a103bf1b73de31587f8fec95c87c4de1f` | Actual Linux map parser, source/GPT checks, fail-closed dm-table output |
| `GRUB2/MOD_SRC/grub-2.04/include/grub/ventoy.h` | `d15e26e026df1e2595e2cc22fff49b37be831025` | Original upstream packed Ventoy records |
| `GRUB2/port/probe-standalone-uefi.sh` | `a53c91db41ddc331331746ec21b3e46e3332d6b7` | Real QEMU/OVMF firmware/guest path and source-integrity oracle |
| `GRUB2/port/build-linux-handoff-initrd.sh` | `6f048dcda864f8c2d8c44921cbae7231be3ca764` | Compile real consumer and Linux module/initramfs closure |

**Current-source reconciliation:** F-02 hardened the actual C consumer at commit `f213b860982f540f43d51a296b05768d13587af2` and aligned the EFI publisher count ceiling at `01e0398315c42442cb358ee25f80c7c2fc2df68f`. The consumer Git blob `31f68c6a103bf1b73de31587f8fec95c87c4de1f` is **identical** at F-02, F-03 and F-04 revisions. The publisher Git blob `3f05d10d2a293383db32b5973df23d292f492e79` is **identical** at `01e0398` and `475db53`. Thus current F-03 and F-04 boot evidence actually exercises the hardened F-02 transport, **not** the older `ceff79ca` source inventory as if it were current code.

| Work unit | Genuine outcome, exact run and job | Boundaries |
|---|---|---|
| F-01 | [Source inventory](ABI-INVENTORY.md), originally `ceff79ca`. Old data documented original 659-versus-640 record mismatch. | Source inventory, not new boot or current security conformance; old mismatch is corrected in current code. |
| F-02 | [GitHub Actions `42033679188`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42033679188), job `127266196833`, **SUCCESS**. Real C compiled: **13/13** malformed variable refusals plus **21/21** disposable real-consumer GPT/extent cases (1 positive table-only, 20 negative). | Temporary regular-file I/O seam; no real guest/firmware/physical disk in these tests. |
| F-03 | [GitHub Actions `42035454641`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42035454641), job `127272300428`, **SUCCESS**. Original outer stock GRUB + existing Ventoy EDK2 virtual BlockIo → original ISO inner EFI GRUB → **unchanged** Ubuntu kernel → Linux real consumer → read-only dm-linear/ISO9660. **2 real FAT32 extents, 1 discontinuity**; non-sparse original ISO **42,010,624 bytes**. Source/raw reconstructed/full guest SHA-256: `f79e2587d6ddfd7feace7022c6985e8666b4cb5cf73e704d53e2ee18b06b9407`. Entire disposable GPT backing hash unchanged by QEMU `-snapshot`. | Synthetic x86_64 UEFI/OVMF/TCG, not original vendor init or physical boot. |
| F-04 | [GitHub Actions `42052152488`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42052152488), job `127330791666`, **SUCCESS**. Same firmware→Linux positive read-only mount, **2 real extents**, **42,014,720-byte** original non-sparse ISO; SHA-256 original/reconstructed/guest: `1b05a36566dd286df8768995de434d27471fe726d2c08a57b3f828ea2a661046`; **8/8 genuine Linux guest negative scenarios** and cleanup/restoration. | Negative scenarios simulate guest EFI-variable absence/mutation, source devtmpfs node disappearance, partition name disappearance and missing userspace dmsetup; not real firmware-service loss or hardware hot-unplug/EIO. |

**Persistent evidence manifest:** The exact run/job outputs were inspected as successful, not inferred from documentation. GitHub artifact ZIP evidence is retained for **14 days**, not guaranteed forever. Their artifact identifiers and GitHub-reported archive SHA-256 values are:

| Work | Artifact ID | GitHub-reported artifact SHA-256 |
|---|---:|---|
| F-02 `poc-087-efi-invalid-map-result` | `13416733743` | `fe8e6b5aa23095e17251f82cb24a4d14959d18e5e7c471f893bc80a0e8da5774` |
| F-03 `poc-081-original-iso-efi-linux-media` | `13417988762` | `e4a35f9a1cdcf5a5aaad34cc592baa3384ef81632bcc60eecef8ae775eaa2c72` |
| F-04 `poc-089-f04-efi-runtime-loss-and-boundaries` | `13426687823` | `477d653b20e058e17424cc7b58b4c5fc4f764d9ca6bd27ed8d7bedb9046a6598` |

This committed manifest preserves fixed source hashes and observed claims but **does not archive the full guest serial logs or constitute cryptographic attestation**. Re-running the pinned source/scripts is possible; external runner packages can change.

## Exact existing experimental ABI for M-04

Publisher: existing `vt_publish_efi_map` in `probe-handoff.c` executes in stock GRUB **before** transient `vt_overlay_probe` and EFI `StartImage`. It publishes a volatile UEFI Runtime Services `SetVariable` called `VtDmMapProbe` with vendor GUID **`0e5e24d4-168b-4f9e-a397-0951f757111e`**, attributes **`BOOT_SERVICE (0x2) | RUNTIME (0x4) = 0x6`**, **without NON_VOLATILE**. Linux exposes the variable at `/sys/firmware/efi/efivars/VtDmMapProbe-0e5e24d4-168b-4f9e-a397-0951f757111e` and prepends **four attribute bytes**; all payload offsets below are therefore shifted by 4 in efivarfs. Consumer accepts `(attributes & 0x6) == 0x6`, not necessarily exactly `0x6`.

| Payload offsets | Bytes | Current structure |
|---|---:|---|
| 0–7 | 8 | Magic `VTDMAP01` |
| 8–11 | 4 | Little-endian count, **1 to 640** |
| 12–15 | 4 | Little-endian chunk width **24** |
| 16–23 | 8 | Little-endian original `iso_bytes`, positive, aligned to 2048 |
| 24–39 | 16 | Primary GPT whole-disk GUID bytes from LBA 1 header offset 56–71; **not** the MBR-related Ventoy os_param GUID |
| 40–551 | 512 | Original packed upstream `ventoy_os_param`; checksum over all 512 bytes modulo 256 = 0 |
| 552 onward | 24 × count | Original packed upstream `ventoy_img_chunk[]` |

Each unchanged upstream chunk is 24 bytes: `img_start_sector:u32` offset 0, `img_end_sector:u32` offset 4 (inclusive ISO **2048-byte** sectors), `disk_start_sector:u64` offset 8, `disk_end_sector:u64` offset 16 (inclusive **whole-disk 512-byte** sectors). Each logical ISO sector maps to 4 physical disk sectors. Physical extents must remain within the exact identified partition, nonoverlapping, and logical extents must cover **all** original ISO sectors with no gap or overlap.

Original `ventoy_os_param` fields used by Linux: physical disk size `u64` at offset **33**, 1-based GPT partition index `u16` at offset **41** (1..128), and original ISO byte size `u64` at offset **429**; upstream header remains authoritative for all other fields. Producer refuses `count > 640`, and enforces payload ≤16,384 bytes. Consumer also refuses `count > 640`, checks 16 KiB input and exact payload size. **Maximum at accepted count: 552 + 640 × 24 = 15,912 payload bytes**, plus efivarfs 4-byte prefix. This closes the earlier source-side 641..659 mismatch, **not** firmware quota/640-fragment boot interoperability.

Actual Linux C consumer scans whole disk prefixes `vd*`, `sd*`, `nvme*` and `mmcblk*` for **exactly one** physical disk matching both expected size and GPT disk GUID. It validates primary GPT signature/header geometry, header and entry-array CRC32, 128 × 128-byte entries, chosen GPT partition against GPT usable range and Linux sysfs partition **start and size**, plus all logical/physical extent bounds and physical nonoverlap **before opening any output dm table file**. The output is an ordinary `dm-linear` table: logical start `img_start × 4`, length `(img_end-img_start+1) × 4`, source **partition** device, partition-relative start `disk_start - GPT_partition_first`. An early-Linux caller must create the mapper **read-only**, verify it and mount ISO9660 read-only; C consumer alone does not mount or authenticate media.

**Security:** the original Ventoy checksum, GPT CRC32 and GUID provide integrity and identity checks, **not signed source authenticity**. Existing `os_param` path/type, MBR legacy identity and reserved bytes are not independently verified against the actual disk by this consumer. The full original ISO SHA-256 validation in F-03/F-04 uses a **test fixture's independent expected digest**, not a generic authenticated hash already provided by the firmware interface.

## Exact M-04 acceptance boundary

**F-05 is the source-conformance/integration-input gate, not M-04.** The already accepted M-01/M-02/M-03 evidence is a separate workstream. M-03 [run `42049546735`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42049546735) proves synthetic original-init PID-1 `exec` **within the same initramfs**, not a completed original vendor-init integration.

M-04, only after separately selected, must still prove through **real QEMU/OVMF** the combined **original inner ISO EFI loader → unchanged kernel → injected reusable Linux middleware → independently identifiable original next-stage init** with the entire unchanged-source ISO still accessible read-only and exact guest/original SHA-256 agreement. The test must reject incomplete source map, changed/wrong disk identity, unavailable backend and unknown resource/buffer bounds; no fallback to a wrong disk, no source writes, no silent EFI producer change. Preserve original ISO, kernel and original initrd prefix/contents. Any required change of producer, 640 limit, variable shape or GPT semantics must be explicitly coordinated with the F owner and retested; do not invent a new namespace or claim vendor compatibility.

**NOT TESTED, and not silently authorized as supported:** actual EFI Runtime Services disabled/unavailable, `SetVariable` refusal, true media hot-unplug or EIO, media swap/TOCTOU, kernel feature `dm_mod` absent, forged/hostile EFI variable authentication, Secure Boot and firmware signed policy, firmware variable quotas, actual 640-fragment ISO boot, BIOS, ARM64, non-512-byte sector media, unsupported GPT/partition geometries/device families, real physical USB, original Proxmox/TrueNAS media recognition, independent vendor `switch_root` or `pivot_root`. The 64 KiB synthetic sidecar ceiling is not proof for actual large vendor initrds.

**Stop rule:** If M-04 needs a different serializer/GUID, unbounded fragment count, authenticated source trust, or different kernel/media model, record a **separate F/M realignment**. Do not silently modify this pinned experimental input, rewrite old evidence, modify production branches, or advance to vendor M-05/M-06 based on synthetic success alone.

## F-05 source/compiled conformance gate

The adjacent `test-f05-interface.py` checks this pinned upstream producer, original Ventoy record shapes, consumer, strict count, EFI variable and source-validation-before-table ordering, and F-03/F-04 workflow pins. The dedicated `poc-081-f05-firmware-conformance.yml` checks out the **exact current firmware source** and re-runs both actual compiled C consumer safety suites (13 early + 21 GPT/extent cases) on it. It does **not** replace the existing real QEMU F-03/F-04 evidence or claim another firmware boot. **Observed F-05 gate PASS:** source contract marker `F05_SOURCE_INTERFACE_CONFORMANCE_PASS`, format assertion `F05_WIRE_HEADER_BYTES=40 OS_PARAM_BYTES=512 CHUNK_BYTES=24`, matching limit `F05_COUNT_LIMIT=640 EFI_PAYLOAD_MAX_BYTES=16384` and real compiled consumer marker `F05_CURRENT_CONSUMER_13_EARLY_21_GPT_MAP_CASES_PASS`. Test code at PoCs PR commit `7bc4f4e6fcad71490ccab01fe9372b96983dd02a`; original EFI code unchanged. Evidence archive [artifact `13429116360`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42055652148/artifacts/13429116360), GitHub-reported ZIP SHA-256 `bdc89fb7aec732611066cd9c46efaa5bb525130baa8870bd49441166bc59fc01`, 14-day retention. F-05 now gates **only** M-04 eligibility; M-04 itself is **not started**.
