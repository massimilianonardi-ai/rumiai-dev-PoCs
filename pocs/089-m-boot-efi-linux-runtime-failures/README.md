# PoC 089 — F-04 real EFI→Linux runtime and source-loss safety

**Owner:** `rumiai-dev/handoff/m-boot-standalone.md`, firmware task **F-04**.
**Status:** executable test prepared; actual CI result must be inspected before PASS.

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

## Execution

Run the `poc-089-m-boot-efi-linux-runtime-failures.yml` workflow on GitHub Actions Ubuntu 24.04. It compiles original EDK2/GRUB components, constructs a disposable GPT and ISO, boots QEMU/OVMF, then requires `F04_REAL_GUEST_SAFETY_PASS` plus eight negative case markers. Preserve the QEMU serial log, source map and full GPT before/after identity reports with their exact revisions and run URL.
