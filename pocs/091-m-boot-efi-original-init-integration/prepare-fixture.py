#!/usr/bin/env python3
"""Test-only PoC 079 fixture customization, confined to a disposable builder.

The original PoC 079 builder and F-owned firmware/runner are never edited.
Replace only the synthetic ISO's *original initrd hook authoring* before the
ISO exists; retain all other unmodified upstream builder logic and obtain an
independent synthetic original /init supplied by the existing M-03 source.
The generated ISO and both of its original initrd inputs stay byte-identical
after this one-time construction, even while EFI shadows the hook at boot.
"""
from pathlib import Path
import os
import sys


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: prepare-fixture.py ORIGINAL_BUILDER NEW_PRIVATE_BUILDER "
            "INDEPENDENT_ORIGINAL_INIT"
        )
    src, dst, original = map(Path, sys.argv[1:])
    if not src.is_file() or not original.is_file() or dst.exists():
        raise SystemExit("M04_FIXTURE_ERROR_SOURCE_OR_DESTINATION")
    if not original.read_bytes().startswith(b"#!/bin/sh\n"):
        raise SystemExit("M04_FIXTURE_ERROR_ORIGINAL_SHELL_SOURCE")
    data = src.read_text()
    begin = 'cat > "$out/root-original/init" <<\'EOF\'\n'
    finish = 'cat > "$out/root-overlay/init" <<\'EOF\'\n'
    if data.count(begin) != 1 or data.count(finish) != 1:
        raise SystemExit("M04_FIXTURE_ERROR_BUILDER_ANCHORS")
    start = data.index(begin)
    end = data.index(finish)
    if start >= end or data[start:end].count("\nEOF\n") != 1:
        raise SystemExit("M04_FIXTURE_ERROR_ORIGINAL_HOOK_STRUCTURE")
    changed = data[:start] + (
        'test -s "$M04_ORIGINAL_INIT" || exit 21\n'
        'cp "$M04_ORIGINAL_INIT" "$out/root-original/init"\n'
    ) + data[end:]
    if changed.count('cp "$M04_ORIGINAL_INIT" "$out/root-original/init"') != 1:
        raise SystemExit("M04_FIXTURE_ERROR_HOOK_REPLACEMENT")
    # PoC 079 is built with sudo because of its source/runtime closure.
    # Restore ownership of ONLY the newly generated synthetic ISO fixture
    # after the private builder completes, so unprivileged QEMU can copy
    # OVMF vars into the same directory. Never operate on a host device.
    changed += (
        '\nif [ -n "${SUDO_UID:-}" ] && [ -n "${SUDO_GID:-}" ]; then\n'
        '  chown -R "$SUDO_UID:$SUDO_GID" "$out"\n'
        'fi\n'
    )
    dst.write_text(changed)
    os.chmod(dst, 0o755)
    print("M04_FIXTURE_ORIGINAL_HOOK_SELECTED_FROM_INDEPENDENT_SOURCE")


if __name__ == "__main__":
    main()
