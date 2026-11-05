#!/usr/bin/env python3
"""Minimal Ubuntu host -> native-architecture read-only QEMU ISO guest prototype.

The disk inventory path is intentionally read-only. No direct physical writes are
permitted by this prototype; a safe exclusive-ownership design is still pending.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys


def fail(code, message):
    print(f"MBOOT_QEMU_{code}: {message}", file=sys.stderr)
    raise SystemExit(1)


def selected_iso(cmdline):
    values = [x[len("mboot.iso="):] for x in cmdline.split()
              if x.startswith("mboot.iso=")]
    if len(values) != 1 or not values[0].startswith("/"):
        fail("ISO_ARGUMENT", "exactly one absolute mboot.iso= path is required")
    return Path(values[0])


def physical_disks():
    result = subprocess.run(
        ["lsblk", "-J", "-b", "-o", "PATH,TYPE,SIZE,RO,RM"],
        check=True, text=True, capture_output=True,
    )
    records = json.loads(result.stdout).get("blockdevices", [])
    disks = []
    for item in records:
        if item.get("type") != "disk":
            continue
        path = Path(item["path"])
        if not stat.S_ISBLK(path.stat().st_mode):
            fail("NOT_BLOCK", f"{path} is not a block disk")
        disks.append({"path": str(path), "size": int(item["size"])})
    return sorted(disks, key=lambda x: x["path"])


def firmware(architecture):
    paths = {
        "x86_64": [
            ("/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_VARS_4M.fd"),
            ("/usr/share/OVMF/OVMF_CODE.fd", "/usr/share/OVMF/OVMF_VARS.fd"),
        ],
        "aarch64": [
            ("/usr/share/AAVMF/AAVMF_CODE.fd", "/usr/share/AAVMF/AAVMF_VARS.fd"),
            ("/usr/share/qemu-efi-aarch64/QEMU_EFI.fd", None),
        ],
    }
    for code, variables in paths[architecture]:
        if Path(code).is_file() and (variables is None or Path(variables).is_file()):
            return code, variables
    fail("FIRMWARE", f"UEFI firmware not installed for {architecture}")


def blockdev(driver, filename, name):
    return "json:" + json.dumps({
        "driver": driver, "filename": filename, "node-name": name,
        "read-only": True,
    }, separators=(",", ":"))


def generate(iso, disks, arch, firmware_code, vars_template, vars_private):
    executable = {
        "x86_64": "qemu-system-x86_64",
        "aarch64": "qemu-system-aarch64",
    }[arch]
    if not shutil.which(executable):
        fail("QEMU_MISSING", executable)
    use_kvm = os.access("/dev/kvm", os.R_OK | os.W_OK)
    accel = "kvm" if use_kvm else "tcg"
    machine = "q35" if arch == "x86_64" else "virt"
    command = [
        executable, "-nodefaults", "-no-user-config",
        "-machine", f"{machine},accel={accel}",
        "-cpu", "host" if use_kvm else "max",
        "-m", "2048", "-smp", "2", "-no-reboot",
        "-display", "none", "-monitor", "none", "-serial", "stdio", "-nic", "none",
    ]
    if vars_template:
        if not vars_private:
            fail("VARS_PATH", "a private OVMF VARS path is required")
        command += [
            "-drive", f"if=pflash,format=raw,readonly=on,file={firmware_code}",
            "-drive", f"if=pflash,format=raw,file={vars_private}",
        ]
    else:
        command += ["-bios", firmware_code]
    if arch == "x86_64":
        command += ["-device", "ich9-ahci,id=ahci"]
    else:
        command += ["-device", "qemu-xhci,id=xhci"]
        command += ["-device", "usb-storage,drive=optical"]
    command += ["-blockdev", blockdev("file", str(iso), "optical-file")]
    command += ["-blockdev", 'json:{"driver":"raw","node-name":"optical","file":"optical-file","read-only":true}']
    if arch == "x86_64":
        command += ["-device", "ide-cd,drive=optical,bus=ahci.0,bootindex=1"]
    # ARM64 USB storage uses the optical raw node and needs an explicit LUN.
    for index, item in enumerate(disks):
        name = f"physical{index}"
        backend = "host_device" if item.get("physical", True) else "file"
        command += ["-blockdev", blockdev(backend, item["path"], name)]
        command += ["-device", f"virtio-blk-pci,drive={name}"]
    return command, accel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--cmdline-file", type=Path, default=Path("/proc/cmdline"))
    parser.add_argument("--fixture-disks", type=Path,
                        help="For isolated tests only; never for installed service")
    parser.add_argument("--vars-directory", type=Path, default=Path("/run/mboot-qemu"))
    options = parser.parse_args()
    try:
        cmdline = options.cmdline_file.read_text(encoding="utf-8")
        iso = selected_iso(cmdline)
        if not iso.is_file():
            fail("ISO_MISSING", f"selected ISO not readable: {iso}")
        disks = physical_disks()
        if options.fixture_disks:
            if options.execute:
                fail("FIXTURE_EXEC", "fixture-disk mode cannot execute QEMU")
            disks = json.loads(options.fixture_disks.read_text())
            if any(not Path(d["path"]).is_file() for d in disks):
                fail("FIXTURE_INVALID", "fixture paths must be existing files")
            for disk in disks:
                disk["physical"] = False
        if not disks:
            fail("NO_DISKS", "physical disk inventory is empty")
        arch = platform.machine()
        if arch not in ("x86_64", "aarch64"):
            fail("ARCH", f"unsupported host architecture: {arch}")
        code, template = firmware(arch)
        vars_private = None
        if template:
            vars_private = options.vars_directory / "ovmf-vars.fd"
            if options.execute:
                options.vars_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(template, vars_private)
        cmd, accel = generate(iso, disks, arch, code, template, vars_private)
        observation = {
            "architecture": arch, "accelerator_requested": accel,
            "iso": str(iso), "physical_disks_exposed_readonly": len(disks),
            "all_disk_backends_readonly": True, "physical_disk_write_enabled": False,
            "firmware": code, "command": cmd,
        }
        if not options.execute:
            print(json.dumps(observation, indent=2))
            return
        print("MBOOT_QEMU_GUEST_START", flush=True)
        print("MBOOT_QEMU_DISKS_READONLY=" + str(len(disks)), flush=True)
        subprocess.run(cmd, check=True)
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError) as error:
        fail("EXECUTION", str(error))


if __name__ == "__main__":
    main()
