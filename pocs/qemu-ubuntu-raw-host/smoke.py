#!/usr/bin/env python3
"""Real paused QEMU/OVMF inspection of disposable ISO and disk backends."""
import json
from pathlib import Path
import shutil
import subprocess
import sys


def check(plan_path, vars_path, firmware_template):
    plan = json.loads(Path(plan_path).read_text())
    if plan.get("physical_disk_write_enabled") is not False:
        raise RuntimeError("Cannot smoke-test a writable physical disk plan")
    cmd = list(plan["command"])
    index = cmd.index("-monitor")
    if cmd[index + 1] != "none":
        raise RuntimeError("Monitor was not isolated")
    cmd[index:index + 2] = ["-qmp", "stdio"]
    index = cmd.index("-serial")
    cmd[index + 1] = "none"
    cmd += ["-S"]
    if firmware_template:
        Path(vars_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(firmware_template, vars_path)
    process = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, bufsize=1,
    )
    def receive():
        while True:
            raw = process.stdout.readline()
            if not raw:
                raise RuntimeError("QEMU exited before QMP reply")
            reply = json.loads(raw)
            if "event" not in reply:
                if "error" in reply:
                    raise RuntimeError(str(reply["error"]))
                return reply
    def call(command):
        process.stdin.write(json.dumps({"execute": command}) + "\n")
        process.stdin.flush()
        return receive().get("return")
    try:
        greeting = receive()
        if "QMP" not in greeting:
            raise RuntimeError("QMP greeting missing")
        call("qmp_capabilities")
        state = call("query-status")
        if state["status"] not in ("prelaunch", "paused"):
            raise RuntimeError(f"guest unexpectedly running: {state}")
        blocks = call("query-block")
        expected = int(plan["physical_disks_exposed_readonly"]) + 1
        inserted = [item["inserted"] for item in blocks if item.get("inserted")]
        if len(inserted) != expected:
            raise RuntimeError(f"expected {expected} inserted backends, got {blocks}")
        if not all(item.get("ro") is True for item in inserted):
            raise RuntimeError(f"QEMU opened a writable disk: {blocks}")
        call("quit")
        process.communicate(timeout=15)
        if process.returncode != 0:
            raise RuntimeError(f"QEMU exited {process.returncode}")
        print(json.dumps({"scope":"QEMU paused device introspection",
                          "architecture":plan["architecture"],
                          "accel_requested":plan["accelerator_requested"],
                          "qemu_exit":process.returncode,
                          "readonly_block_devices":len(inserted),
                          "result":"PASS"}, indent=2))
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: smoke.py READONLY_PLAN.json PRIVATE_VARS_PATH TEMPLATE_OR_-")
    check(sys.argv[1], sys.argv[2],
          None if sys.argv[3] == "-" else sys.argv[3])
