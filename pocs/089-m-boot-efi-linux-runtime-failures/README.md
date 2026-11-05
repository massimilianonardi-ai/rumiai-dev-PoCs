# PoC 089 — F-04 real EFI→Linux runtime and source-loss safety

**Owner:** `rumiai-dev/handoff/m-boot-standalone.md`, firmware task **F-04**.
**Status: F-04 PASS (2026-11-05), only for the bounded guest-local scenarios below.** Real GitHub Actions [run `42052152488`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42052152488), job `127330791666`, completed **SUCCESS** with final tested PoC PR head `23f656d3d501f4cd32d4c98dab2f1eda8e8fbc08` and pinned Ventoy consumer/producer `475db53dee122887fab3387db47fbb1f09ca71b7`. All eight negative guest markers, actual post-kernel positive-control marker, cleanup and EFI map restoration markers and final safety marker were observed; no `F04_GUEST_FAILURE_` or `F04_POST_HOOK_FAILURE` in the genuine QEMU serial output.

This is a **bounded safety test**, not new firmware ABI, general middleware, vendor support, or hardware verification. It uses the existing PoC 079/081 original ISO EFI loader, original EDK2 Ventoy virtual BlockIo, original stock GRUB external module, **unmodified Ubuntu kernel** and the real F-02-hardened C consumer from Ventoy `m-boot-secondary-uefi@475db53dee122887fab3387db47fbb1f09ca71b7`.

The dedicated workflow `.github/workflows/poc-089-m-boot-efi-linux-runtime-failures.yml` boots the same disposable **fragmented**, non-sparse FAT32-backed ISO under QEMU/OVMF (x86_64 TCG; `-snapshot`). The original Linux init mounts the mapped ISO9660 **read-only** and compares its full SHA256 to the original before invoking `post-handoff-tests.sh`; this guest-only script is additional test input, not replacement for the existing consumer or a new product init. The complete raw source GPT image is hashed before/after QEMU.

## Guest cases and failure oracles

| Scenario | Injection / observed boundary | Required oracle |
|---|---|---|
| Initial guest control | Actual published EFI map and physical GPT → unchanged kernel → read-only dm-linear ISO9660 | Existing full-source ISO SHA256, identity and `F04_REAL_EFI_LINUX_BASELINE_PASS` |
| Cleanup | Unmount then remove only owned read-only mapper | No dm kernel name, device node or ISO mount remains |
| EFI variable missing | Mask **guest** efivarfs with private tmpfs; does **not** disable OVMF Runtime Services | Real C consumer refuses, **no output table**, no mapper |
| EFI attributes unavailable | Change runtime bit only in **temporary** variable byte copy | Real consumer rejects attributes |
| Map mutation | Change magic in temporary variable copy after guest boot | Real consumer rejects incorrect magic |
| Oversized map | Change count to 641 in temporary copy (actual published/accepted limit: 640) | Real consumer refuses before GPT lookup |
| Truncation | Shorten temporary variable to 32 bytes | Real consumer refuses before GPT lookup |
| Variable restoration | Unmask efivarfs and consume original firmware variable | Actual C output table exactly equals initial table |
| Source path missing | Rename only the *guest devtmpfs block node* for the identified whole GPT disk | Unique GUID source lookup refuses; no wrong-disk fallback |
| Partition path missing | Hide only the guest devtmpfs partition node **after** a valid table exists | Actual `dmsetup create --readonly` refuses; no surviving mapper |
| Device Mapper helper missing | Hide only guest `dmsetup` executable (not kernel module) | No new dm device/mount; helper restored |
| Final restoration | Re-run the original C consumer with source and runtime map restored | Byte-identical map and no leaked resources |

The test does not touch real `/dev` devices, an operator USB, kernel modules on the host, or the original ISO. The only source visibility changes are guest `devtmpfs` path changes. The QEMU source GPT is a disposable regular file with read-only-equivalent `-snapshot` execution. No original firmware efivarfs value is modified; the malformed payloads are **tmpfs guest copies**.

## Supported versus explicitly unsupported failure semantics

- **Exercised when CI succeeds:** real post-kernel C rejection and diagnostics for missing/mutated/oversized/truncated EFI-variable bytes, no partial table, source or backend pathname loss, read-only positive control, cleanup, restored source identity and full GPT backing immutability. Positive control is genuine QEMU/OVMF boot, not host-only parser simulation.
- **Simulated, not the stronger hardware event:** masking efivarfs models variable absence/expiration but is **not** disabling firmware Runtime Services. Renaming a block node models pathname loss but **not** kernel hot-unplug, block I/O error, media swap, DMA race or physical USB detach. Temporarily hiding `dmsetup` is **not** unloading `dm_mod` or testing a missing compiled kernel feature. Changed count to 641 checks consumer refusal but not a real 641-fragment ISO publish attempt.
- **Not tested / cannot claim support:** EFI `SetVariable` failure or Runtime Services loss across `ExitBootServices`; true disk hot-unplug/media reattach between firmware and Linux; kernel/device mapper unavailable at kernel configuration level; actual read EIO/time-of-check/time-of-use source substitution; multiple device GUIDs colliding after source migration; cryptographic authenticity of EFI variable, signatures, Secure Boot policy, firmware memory-capacity variance, valid 640-fragment ISO end-to-end, BIOS, ARM64 UEFI, non-512-byte sector disks, Proxmox/TrueNAS media or actual bare metal.

**Stop rule:** any refusal must not create a dm table/mount to a different device. A test failing to observe its real guest marker is not a PASS. F-05 will decide integration readiness from the exact remaining unsupported boundary; an F-04 safety PASS is not proof of those unsupported conditions.


### Exact observed result

- **ISO bytes:** 42,014,720 (non-sparse, 42,016,768 allocated host bytes); two independent true physical FAT32 extents and one discontinuity. Original and raw-GPT-reconstructed SHA256 both `1b05a36566dd286df8768995de434d27471fe726d2c08a57b3f828ea2a661046`.
- **Positive control:** original synthetic ISO inner EFI GRUB, unchanged Ubuntu 6.8.0-147-generic kernel, original compiled EFI variable consumer, real read-only `dm-linear`/ISO9660 mount and Linux source SHA256. `F04_REAL_EFI_LINUX_BASELINE_PASS` and `F04_BASELINE_CLEANUP_PASS` observed in guest log.
- **Eight negatives, all PASS in the guest:** `MISSING_EFI_VARIABLE`, `EFI_RUNTIME_ATTRIBUTE`, `MUTATED_EFI_MAP`, `OVERSIZE_EFI_MAP`, `TRUNCATED_EFI_MAP`, `MISSING_SOURCE_NODE`, `MISSING_PARTITION_NODE`, `MISSING_BACKEND`. Every failure is checked against its expected refusal and resource cleanup; no silent source-device fallback.
- **Restoration:** `F04_GUEST_EFI_RUNTIME_RESTORED_PASS`, `F04_REAL_GUEST_SAFETY_PASS` and `F04_GENUINE_UEFI_LINUX_GUEST_NEGATIVE_PASS` observed. Source GPT SHA256 before/after QEMU `-snapshot` is verified by the workflow. Logs, provenance and full source verification reports in [artifact `13426687823`](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42052152488/artifacts/13426687823), retained 14 days.
- **Validation boundary:** this proves source path/variable copy refusal in a real Linux guest, **not** actual firmware Runtime Services removal, hot-unplug/EIO, absent `dm_mod` kernel support, changed medium after verification, Secure Boot, or physical/vendor compatibility. These remain explicitly unsupported/untested as described above.

## Execution

Run the `poc-089-m-boot-efi-linux-runtime-failures.yml` workflow on GitHub Actions Ubuntu 24.04. It compiles original EDK2/GRUB components, constructs a disposable GPT and ISO, boots QEMU/OVMF, then requires `F04_REAL_GUEST_SAFETY_PASS` plus eight negative case markers. Preserve the QEMU serial log, source map and full GPT before/after identity reports with their exact revisions and run URL.
