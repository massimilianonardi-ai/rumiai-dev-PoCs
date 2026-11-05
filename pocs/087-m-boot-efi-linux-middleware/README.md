# PoC 087 — Existing EFI-to-Linux consumer malformed-map rejection

**Scope:** Original malformed-variable refusals and the F-02 isolated source/GPT/extent checks on the **real** Linux consumer. This is not an alternative boot implementation or generic middleware. See `rumiai-dev/handoff/m-boot-standalone.md`.

The original 13-case suite was first validated at Ventoy revision `ceff79ca92d246928f86362a569f86c6d2ac130f`; current CI pins the hardened revision `01e0398315c42442cb358ee25f80c7c2fc2df68f`. The real C consumer is `massimilianonardi-ai/Ventoy@m-boot-secondary-uefi:GRUB2/port/probe-linux-efi-consumer.c`. Its runtime uses `VtDmMapProbe` from Linux efivarfs. The test compiles an otherwise untouched temporary copy of that **same C parser**, changing only the hard-coded efivarfs file pathname to a regular file under a private temporary directory. It provides 13 malformed runtime-variable fixtures and requires specific error diagnostics **before** any device-mapper table is produced.

The **original 13-case script** does not run a valid map through the source-disk scanner: that would inspect host `/dev` without the F-02 isolated I/O seam. The script does not touch any USB or block device, download an ISO, run a hypervisor, alter the Ventoy branch, or claim that a firmware→Linux positive boot passed during this run. That original script proves 13 early fail-closed parser refusals only. The F-02 suite below separately covers GUID ambiguity, GPT and extent boundaries with disposable regular-file inputs; actual device-mapper creation and QEMU handoff remain outside this test. The complete positive synthetic QEMU path was already demonstrated by PoC 081.

Run on a standard Linux development host with `gcc` and Python 3:

```sh
python3 pocs/087-m-boot-efi-linux-middleware/test-consumer-negative.py \
  fork/GRUB2/port/probe-linux-efi-consumer.c
```

CI workflow: `.github/workflows/poc-087-efi-linux-map-negative.yml` checks out and verifies the pinned Ventoy revision, then compiles and executes this test. The script prints one PASS per refused fixture and a final `VT087_EFI_VARIABLE_MALFORMED_REJECTION_PASS` only if all 13 fail safely.

**Responsibility boundary:** F-02 safety tests are recorded below; generic early Linux middleware and original-init handoff remain independently owned by the M track. GPT CRC and source GUID are integrity/identity checks, **not authenticated source trust**.

## F-02 extension — real consumer with disposable GPT sources (2026-11-05)

This extends, but does not relabel, the previous 13/13 early-variable refusals on the originally pinned Ventoy source.

The additional test `test-consumer-disk-negative.py` compiles the real C consumer at experimental Ventoy branch `01e0398315c42442cb358ee25f80c7c2fc2df68f`. A temporary source copy redirects only external I/O: efivarfs path, sysfs block paths, `/dev` pathname, and the block-size ioctl (to `fstat` for a regular-file disk). The GPT CRC, source-selection, partition-geometry and extent validators are the real C implementation, not a fake parser. No host `/dev`, mount, loop device, device mapper or ISO is touched.

The executable suite exercises one valid 8 MiB CRC-correct GPT/map control that generates a table, and 20 deterministic negative cases requiring failure **without an output table**: missing/ambiguous source GUID, incorrect physical disk size, malformed GPT header/entry CRC and bounds, missing/wrong partition, sysfs start/size disagreement, logical and physical extent overlap or gaps, missing coverage, sector count/boundary/unsigned-size errors and over-limit map count.

The source changes also align the experimental EFI publisher and Linux consumer at **640 chunks**. The consumer checks header and entry CRC, primary GPT geometry, selected partition source and size, all extent boundaries/overlap and complete coverage before opening the dm table. These identity/integrity checks are not signature-level authentication.

Run from a checkout with the exact pinned Ventoy source:

```sh
python3 pocs/087-m-boot-efi-linux-middleware/test-consumer-negative.py \
  fork/GRUB2/port/probe-linux-efi-consumer.c
python3 pocs/087-m-boot-efi-linux-middleware/test-consumer-disk-negative.py \
  fork/GRUB2/port/probe-linux-efi-consumer.c
```

CI workflow `.github/workflows/poc-087-efi-linux-map-negative.yml` checks both suites. **Observed GitHub Actions PR run [42033679188](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42033679188), job 127266196833, completed SUCCESS**: 13/13 malformed-variable refusals and 21/21 compiled-consumer cases (one positive table-only control and twenty negatives). Test scope excludes real device-mapper creation, QEMU/firmware, physical USB, Secure Boot and vendor media acceptance.
