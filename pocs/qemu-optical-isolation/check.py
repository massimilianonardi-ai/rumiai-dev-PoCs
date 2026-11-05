#!/usr/bin/env python3
"""K-07: isolated real-QEMU optical failure/teardown checks on K-03 synthetic media."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import time


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


class Monitor:
    def __init__(self, pathname):
        self.conn = socket.socket(socket.AF_UNIX)
        self.conn.settimeout(10)
        self.conn.connect(str(pathname))
        self.channel = self.conn.makefile("rwb", buffering=0)
        self.read_reply()
        self.command("qmp_capabilities")

    def read_reply(self):
        while True:
            line = self.channel.readline()
            if not line:
                raise RuntimeError("QMP closed unexpectedly")
            payload = json.loads(line)
            if "event" in payload:
                continue
            return payload

    def command(self, name, arguments=None):
        request = {"execute": name}
        if arguments is not None:
            request["arguments"] = arguments
        self.channel.write(json.dumps(request).encode("ascii") + b"\n")
        reply = self.read_reply()
        if "error" in reply:
            raise RuntimeError(f"QMP {name}: {reply['error']}")
        return reply["return"]

    def close(self):
        self.channel.close()
        self.conn.close()


def firmware_pair():
    for directory in (Path("/usr/share/OVMF"), Path("/usr/share/edk2/ovmf")):
        for suffix in ("_4M", ""):
            code = directory / f"OVMF_CODE{suffix}.fd"
            variables = directory / f"OVMF_VARS{suffix}.fd"
            if code.is_file() and variables.is_file():
                return code, variables
    raise RuntimeError("Matching OVMF firmware CODE/VARS not available")


def run_guest(output, source, firmware, vars_template, case, guest_start):
    transient = output / f"private-{case}.fd"
    address = output / f"monitor-{case}.sock"
    serial = output / f"serial-{case}.log"
    shutil.copyfile(vars_template, transient)
    args = [
        "qemu-system-x86_64", "-nodefaults", "-no-user-config",
        "-machine", "q35,accel=tcg", "-m", "2048" if guest_start else "256",
        "-smp", "2" if guest_start else "1", "-S", "-no-reboot",
        "-display", "none", "-monitor", "none", "-nic", "none",
        "-serial", f"file:{serial}",
        "-qmp", f"unix:{address},server=on,wait=off",
        "-drive", f"if=pflash,format=raw,readonly=on,file={firmware}",
        "-drive", f"if=pflash,format=raw,file={transient}",
        "-device", "ich9-ahci,id=ahci",
        "-drive", f"if=none,id=cd,format=raw,media=cdrom,readonly=on,file={source}",
        "-device", "ide-cd,drive=cd,bus=ahci.0,bootindex=1",
    ]
    monitor = None
    process = None
    started = time.monotonic()
    try:
        with (output / f"qemu-{case}.log").open("wb") as logfile:
            process = subprocess.Popen(args, stdout=logfile, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 15
            while not address.exists() and time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"QEMU {case} exited before QMP: {process.returncode}")
                time.sleep(0.05)
            if not address.exists():
                raise RuntimeError(f"QEMU {case} did not create QMP socket")
            monitor = Monitor(address)
            state = monitor.command("query-status")["status"]
            if state not in ("prelaunch", "paused"):
                raise RuntimeError(f"Guest unexpectedly running before injected case: {state}")
            blocks = monitor.command("query-block")
            optical = [item for item in blocks if item.get("device") == "cd"]
            if len(optical) != 1 or not optical[0].get("inserted"):
                raise RuntimeError(f"No unique inserted CD source: {blocks}")
            inserted = optical[0]["inserted"]
            if inserted.get("ro") is not True:
                raise RuntimeError(f"Optical source not marked read-only: {inserted}")
            if os.path.realpath(inserted.get("file", "")) != os.path.realpath(source):
                raise RuntimeError(f"Unexpected optical source: {inserted}")
            # Other writable block backends may only be the private OVMF VARS.
            for item in blocks:
                source_info = item.get("inserted") or {}
                if item.get("device") == "cd":
                    continue
                backend = source_info.get("file", "")
                if backend and Path(backend).resolve() != transient.resolve() and Path(backend).resolve() != firmware.resolve():
                    raise RuntimeError(f"Unexpected non-CD backend: {item}")
            if guest_start:
                # The source is a disposable hard link to the original fixture.
                # Unlinking it after QEMU opens it simulates a vanished pathname
                # without modifying the source ISO or touching a physical USB.
                source.unlink()
                if source.exists():
                    raise RuntimeError("Injected pathname removal failed")
                if not [b for b in monitor.command("query-block") if b.get("device") == "cd" and b.get("inserted")]:
                    raise RuntimeError("Open CD backend lost after pathname removal")
                monitor.command("cont")
                process.wait(timeout=120)
                if process.returncode != 0:
                    raise RuntimeError(f"Guest QEMU exited {process.returncode}")
                log = serial.read_text(errors="replace")
                for marker in (
                    "VT079_UEFI_GRUB_STARTED", "VT079_UEFI_KERNEL_STARTING",
                    "K03_GUEST_INIT_STARTED", "K03_GUEST_CD_READONLY_PASS",
                    "K03_GUEST_ISO_MARKER_PASS", "K03_GUEST_POST_KERNEL_CD_PASS",
                    "K03_GUEST_TEST_PASS",
                ):
                    if marker not in log:
                        raise RuntimeError(f"Missing guest marker {marker}")
                return {
                    "guest_run_exit": process.returncode,
                    "guest_cd_hash": next(
                        (line.split("=", 1)[1].strip() for line in log.splitlines()
                         if line.startswith("K03_GUEST_CD_SHA256=")), ""),
                    "source_alias_unlinked_after_open": True,
                    "guest_boot_elapsed_sec": round(time.monotonic() - started, 3),
                    "guest_serial_observed": True,
                }
            monitor.command("eject", {"device": "cd", "force": True})
            after = [item for item in monitor.command("query-block")
                     if item.get("device") == "cd"]
            if len(after) != 1 or after[0].get("inserted"):
                raise RuntimeError(f"Optical eject did not clear medium: {after}")
            monitor.command("quit")
            process.wait(timeout=10)
            if process.returncode != 0:
                raise RuntimeError(f"QEMU eject/quit exited {process.returncode}")
            return {
                "qmp_optical_read_only": True,
                "qmp_eject_cleared_medium": True,
                "qmp_quit_exit": process.returncode,
                "qmp_teardown_elapsed_sec": round(time.monotonic() - started, 3),
                "qmp_before_guest_start": state,
            }
    finally:
        if monitor:
            monitor.close()
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if process.poll() is None:
                raise RuntimeError(f"QEMU process leaked: {case}")
        transient.unlink(missing_ok=True)
        address.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path, help="New K-03 synthetic ISO fixture")
    parser.add_argument("output", type=Path, help="New unused results directory")
    opts = parser.parse_args()
    iso = opts.fixture / "bootable.iso"
    if not iso.is_file() or iso.is_symlink() or opts.output.exists():
        raise RuntimeError("Require existing regular synthetic ISO and unused results path")
    if not (opts.fixture / "k03-source-sha256.txt").is_file():
        raise RuntimeError("Missing K-03 source identity manifest")
    expected = (opts.fixture / "k03-source-sha256.txt").read_text().split()[0]
    before = checksum(iso)
    if before != expected:
        raise RuntimeError("Synthetic ISO changed before isolation test")
    opts.output.mkdir(mode=0o700, parents=False)
    output = opts.output.resolve()
    iso = iso.resolve()
    if iso.parent == output or output in iso.parents:
        raise RuntimeError("Source ISO cannot be located under mutable test output")
    firmware, variables = firmware_pair()
    firmware_hash = checksum(firmware)
    variables_hash = checksum(variables)
    version = subprocess.run(["qemu-system-x86_64", "--version"],
                             capture_output=True, text=True, check=True).stdout.splitlines()[0]
    available_mem_kib = next((line.split()[1] for line in
                              Path("/proc/meminfo").read_text().splitlines()
                              if line.startswith("MemAvailable:")), "unknown")
    disk_kib = shutil.disk_usage(output).free // 1024
    manifest = {
        "task": "K-07", "scope": "synthetic_qemu_host_only",
        "host_os": platform.platform(), "host_arch": platform.machine(),
        "qemu_version": version, "accelerator": "tcg",
        "firmware_code": str(firmware), "firmware_variables_template": str(variables),
        "source_iso_hash": before, "source_iso_bytes": iso.stat().st_size,
        "host_mem_available_kib_start": available_mem_kib,
        "host_disk_free_kib_start": disk_kib,
        "guest_ram_mib": 2048, "guest_cpu_count": 2,
        "guest_network": "none", "physical_disk_attached": False,
        "guest_writable_disk_attached": False, "display": "none",
        "firmware_vars_private": True,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    try:
        media_link = output / "disposable-source-hardlink.iso"
        os.link(iso, media_link)
        if (media_link.stat().st_ino, media_link.stat().st_dev) != (
            iso.stat().st_ino, iso.stat().st_dev
        ):
            raise RuntimeError("Alias does not refer to original synthetic file bytes")
        try:
            manifest.update(run_guest(output, media_link, firmware, variables,
                                      "opened-alias", guest_start=True))
        finally:
            media_link.unlink(missing_ok=True)
        if manifest["guest_cd_hash"] != before:
            raise RuntimeError("Guest after alias unlink did not read original ISO")
        manifest.update(run_guest(output, iso, firmware, variables,
                                  "eject", guest_start=False))
        # Invalid source must propagate a nonzero QEMU exit without a timeout.
        invalid = output / "absent-readonly-source.iso"
        negative = subprocess.run([
            "qemu-system-x86_64", "-nodefaults", "-machine", "q35,accel=tcg",
            "-m", "256", "-display", "none", "-monitor", "none",
            "-device", "ich9-ahci,id=ahci",
            "-drive", f"if=none,id=cd,media=cdrom,format=raw,readonly=on,file={invalid}",
            "-device", "ide-cd,drive=cd,bus=ahci.0",
        ], capture_output=True, text=True, timeout=15)
        (output / "negative-startup.log").write_text(negative.stdout + negative.stderr)
        if negative.returncode == 0 or str(invalid) not in negative.stderr:
            raise RuntimeError(f"QEMU failed to reject missing source: {negative.returncode}")
        manifest["invalid_source_qemu_exit"] = negative.returncode
        manifest["invalid_source_rejected"] = True
        if checksum(iso) != before or checksum(firmware) != firmware_hash or checksum(variables) != variables_hash:
            raise RuntimeError("Original synthetic ISO or firmware template changed")
        manifest["source_hash_unchanged"] = True
        manifest["ovmf_templates_unchanged"] = True
        residual = sorted(p.name for p in output.glob("private-*.fd"))
        residual += sorted(p.name for p in output.glob("monitor-*.sock"))
        if residual or media_link.exists():
            raise RuntimeError(f"Transient QEMU resources not cleaned: {residual}")
        manifest["transient_resources_remaining"] = 0
        manifest["isolation_result"] = "PASS"
        print("K07_SOURCE_ALIAS_DISCONNECT_GUEST_PASS")
        print("K07_QMP_READONLY_EJECT_PASS")
        print("K07_NEGATIVE_QEMU_EXIT_PASS")
        print("K07_QEMU_CLEANUP_PASS")
    finally:
        manifest["finished_utc"] = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat()
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"K07_ERROR: {error}", file=sys.stderr)
        sys.exit(1)
