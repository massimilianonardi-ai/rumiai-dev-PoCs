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
import socket
import stat
import subprocess
import sys
import time


def fail(code, message):
    print(f"MBOOT_QEMU_{code}: {message}", file=sys.stderr)
    raise SystemExit(1)


def selected_iso(cmdline):
    values = [x[len("mboot.iso="):] for x in cmdline.split()
              if x.startswith("mboot.iso=")]
    if len(values) != 1 or not values[0].startswith("/"):
        fail("ISO_ARGUMENT", "exactly one absolute mboot.iso= path is required")
    return Path(values[0])


def locate_iso(iso, execute):
    # Ubuntu's native initramfs-tools loop= path retains the backing ext4
    # filesystem at /host. The ISO remains there after switch-root.
    if ".." in iso.parts:
        fail("ISO_PATH", "ISO path must not traverse outside its source")
    if iso.is_file():
        return iso
    if not execute:
        fail("ISO_MISSING", f"selected ISO not readable: {iso}")
    mountpoint = Path("/host")
    if not os.path.ismount(mountpoint):
        fail("SOURCE_NOT_PRESERVED", "Ubuntu loop= backing mount absent at /host")
    candidate = mountpoint / iso.relative_to("/")
    if not candidate.is_file():
        fail("ISO_MISSING", f"ISO absent from preserved backing filesystem: {iso}")
    return candidate

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
    # QEMU -blockdev uses a comma-separated key=value interface, unlike QMP
    # blockdev-add which accepts a JSON argument. Double commas in filenames.
    filename = filename.replace(",", ",,")
    return f"driver={driver},node-name={name},filename={filename},read-only=on"


def qmp_command(stream, command):
    stream.write((json.dumps({"execute": command}) + "\r\n").encode())
    stream.flush()
    while True:
        line = stream.readline()
        if not line:
            raise RuntimeError("QMP connection closed")
        response = json.loads(line)
        if "event" in response:
            continue
        if "error" in response:
            raise RuntimeError(f"QMP {command}: {response['error']}")
        if "return" in response:
            return response["return"]


def run_qemu_with_diagnostics(command, qmp_path):
    qmp_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if qmp_path.exists():
        if not stat.S_ISSOCK(qmp_path.lstat().st_mode):
            fail("QMP_PATH", f"refusing to replace non-socket path: {qmp_path}")
        qmp_path.unlink()
    command = command + ["-qmp", f"unix:{qmp_path},server=on,wait=off"]
    print("MBOOT_QEMU_CHILD_COMMAND=" + json.dumps(command), flush=True)
    process = subprocess.Popen(command)
    connection = None
    try:
        deadline = time.monotonic() + 30
        while not qmp_path.exists() and process.poll() is None:
            if time.monotonic() >= deadline:
                print("MBOOT_QMP_SOCKET_NOT_READY", flush=True)
                break
            time.sleep(0.1)
        if qmp_path.exists() and process.poll() is None:
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.settimeout(10)
            connection.connect(str(qmp_path))
            stream = connection.makefile("rwb", buffering=0)
            greeting = json.loads(stream.readline())
            if "QMP" not in greeting:
                raise RuntimeError("QMP greeting missing")
            print("MBOOT_QMP_CONNECTED=" + json.dumps(greeting), flush=True)
            qmp_command(stream, "qmp_capabilities")
            while process.poll() is None:
                status = qmp_command(stream, "query-status")
                blocks = qmp_command(stream, "query-block")
                print("MBOOT_QMP_STATUS=" + json.dumps(status, sort_keys=True), flush=True)
                print("MBOOT_QMP_BLOCKS=" + json.dumps(blocks, sort_keys=True), flush=True)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
        return_code = process.wait()
        print(f"MBOOT_QEMU_CHILD_EXIT={return_code}", flush=True)
        return return_code
    finally:
        if connection is not None:
            connection.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        try:
            if stat.S_ISSOCK(qmp_path.lstat().st_mode):
                qmp_path.unlink()
        except FileNotFoundError:
            pass


def generate(iso, disks, arch, firmware_code, vars_template, vars_private):
    executable = {
        "x86_64": "qemu-system-x86_64",
        "aarch64": "qemu-system-aarch64",
    }[arch]
    if not shutil.which(executable):
        fail("QEMU_MISSING", executable)
    use_kvm = (os.environ.get("MBOOT_FORCE_TCG") != "1" and
               os.access("/dev/kvm", os.R_OK | os.W_OK))
    accel = "kvm" if use_kvm else "tcg"
    machine = "q35" if arch == "x86_64" else "virt"
    cpu = "host" if use_kvm else ("cortex-a72" if arch == "aarch64" else "max")
    smp = "1" if arch == "aarch64" and os.environ.get("MBOOT_FORCE_TCG") == "1" else "2"
    command = [
        executable, "-nodefaults", "-no-user-config",
        "-machine", f"{machine},accel={accel}",
        "-cpu", cpu,
        "-m", "2048", "-smp", smp, "-no-reboot",
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
    command += ["-device", "virtio-scsi-pci,id=scsi0"]
    command += ["-blockdev", blockdev("file", str(iso), "optical-file")]
    command += ["-blockdev", "driver=raw,node-name=optical,file=optical-file,read-only=on"]
    command += ["-device", "scsi-cd,drive=optical,bus=scsi0.0,bootindex=1"]
    # Every inventoried physical block disk is represented read-only.
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
        iso = locate_iso(iso, options.execute)
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
        options.vars_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        qmp_path = options.vars_directory / "qemu.sock"
        print("MBOOT_QEMU_GUEST_START", flush=True)
        print("MBOOT_QEMU_DISKS_READONLY=" + str(len(disks)), flush=True)
        return_code = run_qemu_with_diagnostics(cmd, qmp_path)
        if return_code:
            raise subprocess.CalledProcessError(return_code, cmd)
    except RuntimeError as error:
        fail("QMP", str(error))
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError) as error:
        fail("EXECUTION", str(error))


if __name__ == "__main__":
    main()
