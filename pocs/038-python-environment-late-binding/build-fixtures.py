#!/usr/bin/env python3
import argparse
import base64
import csv
import hashlib
import io
import os
import pathlib
import subprocess
import sys
import sysconfig
import tempfile
import zipfile


def record_hash(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def wheel_bytes(name, version, tag, root_is_purelib, files, entry_points=None):
    dist = name.replace("-", "_")
    dist_info = f"{dist}-{version}.dist-info"
    payload = dict(files)
    metadata = (
        "Metadata-Version: 2.1\n"
        f"Name: {name}\n"
        f"Version: {version}\n"
        "\n"
    ).encode()
    wheel = (
        "Wheel-Version: 1.0\n"
        "Generator: rumiai-poc-038\n"
        f"Root-Is-Purelib: {'true' if root_is_purelib else 'false'}\n"
        f"Tag: {tag}\n"
        "\n"
    ).encode()
    payload[f"{dist_info}/METADATA"] = metadata
    payload[f"{dist_info}/WHEEL"] = wheel
    if entry_points:
        lines = ["[console_scripts]"]
        for command, target in entry_points.items():
            lines.append(f"{command} = {target}")
        lines.append("")
        payload[f"{dist_info}/entry_points.txt"] = ("\n".join(lines)).encode()

    record_path = f"{dist_info}/RECORD"
    rows = []
    for path in sorted(payload):
        data = payload[path]
        rows.append([path, record_hash(data), str(len(data))])
    rows.append([record_path, "", ""])
    out = io.StringIO(newline="")
    csv.writer(out, lineterminator="\n").writerows(rows)
    payload[record_path] = out.getvalue().encode()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(payload):
            zf.writestr(path, payload[path])
    return buf.getvalue()


def pure_wheel(outdir: pathlib.Path):
    source = '''import os\nimport sys\n\ndef main():\n    print("fixture=pure")\n    print("provider=" + os.environ.get("RUMIAI_PYTHON_PROVIDER", ""))\n    print(f"version={sys.version_info.major}.{sys.version_info.minor}")\n    print("executable=" + sys.executable)\n    print("module=" + __file__)\n    return 0\n'''.encode()
    data_script = b'''#!python\nfrom pocpure import main\nraise SystemExit(main())\n'''
    name = "rumiai-poc-pure"
    version = "1.0"
    filename = outdir / "rumiai_poc_pure-1.0-py3-none-any.whl"
    data = wheel_bytes(
        name,
        version,
        "py3-none-any",
        True,
        {
            "pocpure/__init__.py": source,
            "rumiai_poc_pure-1.0.data/scripts/poc-data": data_script,
        },
        {"poc-pure": "pocpure:main"},
    )
    filename.write_bytes(data)
    print(filename)


def native_wheel(outdir: pathlib.Path):
    c_source = r'''#include <Python.h>

static PyObject *probe_value(PyObject *self, PyObject *args) {
    return PyUnicode_FromString("native-ok");
}

static PyMethodDef methods[] = {
    {"value", probe_value, METH_NOARGS, "Return native probe marker."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
    PyModuleDef_HEAD_INIT,
    "_nativeprobe",
    NULL,
    -1,
    methods
};

PyMODINIT_FUNC PyInit__nativeprobe(void) {
    return PyModule_Create(&module);
}
'''
    package_source = '''import os\nimport sys\nprint("native-import-provider=" + os.environ.get("RUMIAI_PYTHON_PROVIDER", ""))\nprint(f"native-import-version={sys.version_info.major}.{sys.version_info.minor}")\nfrom . import _nativeprobe\n\ndef main():\n    print("fixture=native")\n    print("provider=" + os.environ.get("RUMIAI_PYTHON_PROVIDER", ""))\n    print(f"version={sys.version_info.major}.{sys.version_info.minor}")\n    print("executable=" + sys.executable)\n    print("native=" + _nativeprobe.value())\n    print("module=" + __file__)\n    return 0\n'''.encode()

    include = sysconfig.get_paths()["include"]
    ext_suffix = sysconfig.get_config_var("EXT_SUFFIX")
    if not ext_suffix:
        raise SystemExit("Python EXT_SUFFIX is unavailable")
    with tempfile.TemporaryDirectory(prefix="rumiai-poc038-native-") as td:
        td = pathlib.Path(td)
        cfile = td / "nativeprobe.c"
        sofile = td / ("_nativeprobe" + ext_suffix)
        cfile.write_text(c_source)
        cmd = [os.environ.get("CC", "cc"), "-shared", "-fPIC", f"-I{include}", str(cfile), "-o", str(sofile)]
        subprocess.run(cmd, check=True)
        native_bytes = sofile.read_bytes()

    major, minor = sys.version_info[:2]
    impl = f"cp{major}{minor}"
    platform_tag = sysconfig.get_platform().replace("-", "_").replace(".", "_")
    tag = f"{impl}-{impl}-{platform_tag}"
    filename = outdir / f"rumiai_poc_native-1.0-{tag}.whl"
    data = wheel_bytes(
        "rumiai-poc-native",
        "1.0",
        tag,
        False,
        {
            "pocnative/__init__.py": package_source,
            f"pocnative/_nativeprobe{ext_suffix}": native_bytes,
        },
        {"poc-native": "pocnative:main"},
    )
    filename.write_bytes(data)
    print(filename)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    outdir = pathlib.Path(args.output)
    outdir.mkdir(parents=True, exist_ok=True)
    pure_wheel(outdir)
    native_wheel(outdir)


if __name__ == "__main__":
    main()
