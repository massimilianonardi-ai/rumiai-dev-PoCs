# PoC 087 — Existing EFI-to-Linux consumer malformed-map rejection

**Scope:** First executable F3 work unit of the current ordered m-boot handoff execution plan. This is an error-path check on the **existing** consumer, not an alternative boot implementation and not the finished middleware. See `rumiai-dev/handoff/m-boot-standalone.md`.

The real C consumer is `massimilianonardi-ai/Ventoy@m-boot-secondary-uefi:GRUB2/port/probe-linux-efi-consumer.c`, pinned to revision `ceff79ca92d246928f86362a569f86c6d2ac130f`. Its original runtime uses `VtDmMapProbe` from Linux efivarfs. The test compiles an otherwise untouched temporary copy of that **same C parser**, changing only the hard-coded efivarfs file pathname to a regular file under a private temporary directory. It provides 13 malformed runtime-variable fixtures and requires specific error diagnostics **before** any device-mapper table is produced.

No test runs a valid map through the source-disk scanner: a valid payload would progress to inspecting `/dev`, which is outside this isolated negative-fixture unit. The script does not touch any USB or block device, download an ISO, run a hypervisor, alter the Ventoy branch, or claim that a firmware→Linux positive boot passed during this run. Success is 13 fail-closed parser refusals; **disk GUID ambiguity, GPT extent bounds, runtime fragment maps, Linux device-mapper creation and actual QEMU handoff remain untested by PoC 087** and require their own gates. The complete positive synthetic QEMU path was already demonstrated by PoC 081.

Run on a standard Linux development host with `gcc` and Python 3:

```sh
python3 pocs/087-m-boot-efi-linux-middleware/test-consumer-negative.py \
  fork/GRUB2/port/probe-linux-efi-consumer.c
```

CI workflow: `.github/workflows/poc-087-efi-linux-map-negative.yml` checks out and verifies the pinned Ventoy revision, then compiles and executes this test. The script prints one PASS per refused fixture and a final `VT087_EFI_VARIABLE_MALFORMED_REJECTION_PASS` only if all 13 fail safely.

**Next responsibility:** extend independent negative tests to authenticated source GPT and partition boundaries without inspecting any host device, then extract the **existing** early-userspace logic into a reusable Linux middleware that can hand over to the original OS init, initially on a small synthetic ISO.
