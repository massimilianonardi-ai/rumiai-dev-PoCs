# PoC 088 — M-02 generic Linux read-only ISO stage

**Scope:** isolated M-02 implementation and QEMU/OVMF test only. This does not implement M-03 original-init handoff or claim vendor installer support.

The guest-private `iso-stage.sh` reuses the **unchanged** C EFI Runtime Services/GPT map consumer from Ventoy branch `m-boot-secondary-uefi`, pinned to `ceff79ca92d246928f86362a569f86c6d2ac130f`. It loads kernel modules, requires completed map validation before dmsetup, creates a read-only mapper, checks read-only kernel state, discovers its actual device from sysfs, and mounts ISO9660 read-only. Distinct error paths clean owned mapper and mount resources.

`guest-init.sh` is **only a test fixture**: it verifies the ISO marker and independently expected SHA256, tests fail-closed behavior on missing map consumer and module manifest, then powers off. It does not pass control to any original OS init.

The dedicated workflow `poc-088-m-boot-linux-generic-iso.yml` reuses real PoC 081 EFI/QEMU execution and PoC 079's unchanged synthetic ISO/kernel with a disposable out-of-ISO initrd overlay. No operator USB, real disk, vendor install, GRUB core or Ventoy production branch is altered.

**Evidence:** genuine QEMU/OVMF guest mount PASS requires a completed successful workflow with kernel-side block-device read and independent hash. The two dependency fault cases do **not** cover corrupt EFI maps, missing efivarfs, ambiguous physical source, unavailable kernel features, dm/ISO read errors or media removal. These remain separate exact validation requirements; prior PoC 087 parser tests do not substitute for real guest tests.

The task finishes at generic M-02 read-only media exposure. M-03 and later work remain out of scope.