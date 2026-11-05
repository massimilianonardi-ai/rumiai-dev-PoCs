#!/usr/bin/env python3
"""Prepare an M-04-only runner from the exact, unchanged F-03 QEMU harness.

F-03's one-consumption assertion is correct for F-03, but M-03 prepares
the same valid map twice (baseline+cleanup, then final original-init handoff).
Copy into a private temporary directory and change ONLY that assertion and
its task-specific evidence name. Keep the original F-owned runner unchanged.
"""
from pathlib import Path
import hashlib
import shutil
import sys


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: prepare-m04-runner.py PINNED_F_RUNNER "
            "PINNED_EXTENT_ORACLE NEW_PRIVATE_DIRECTORY"
        )
    source, oracle, directory = map(Path, sys.argv[1:])
    if not source.is_file() or not oracle.is_file() or directory.exists():
        raise SystemExit("M04_RUNNER_FIXTURE_INPUT_ERROR")

    script = source.read_text()
    original = 'published != [str(count)] or consumed != [str(count)]'
    replacement = 'published != [str(count)] or consumed != [str(count), str(count)]'
    if script.count(original) != 1:
        raise SystemExit("M04_RUNNER_FIXTURE_UNEXPECTED_F03_ASSERTION")
    if script.count('f03_fragmented_efi_linux=passed') != 1:
        raise SystemExit("M04_RUNNER_FIXTURE_UNEXPECTED_F03_REPORT")
    if script.count('f03-runtime-verification.txt') != 1:
        raise SystemExit("M04_RUNNER_FIXTURE_UNEXPECTED_F03_OUTPUT")
    revised = script.replace(original, replacement)
    revised = revised.replace(
        'f03_fragmented_efi_linux=passed',
        'm04_fragmented_efi_linux_two_consumptions=passed',
    )
    revised = revised.replace(
        'f03-runtime-verification.txt', 'm04-runtime-verification.txt'
    )
    # Independent reference oracle and all original firmware QEMU behavior
    # remain copied without modification. No guest stdout is changed.
    directory.mkdir(parents=True)
    dest = directory / source.name
    dest.write_text(revised)
    dest.chmod(0o755)
    shutil.copy2(oracle, directory / oracle.name)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    print(f"M04_PINNED_ORIGINAL_F_RUNNER_SHA256={digest}")
    print("M04_PRIVATE_RUNNER_EXPECTS_TWO_REAL_CONSUMPTIONS")
    print("M04_PRIVATE_RUNNER_INDEPENDENT_ORACLE_PRESERVED")


if __name__ == "__main__":
    main()
