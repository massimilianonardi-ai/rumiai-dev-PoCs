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


def wheel_bytes(name, version, tag, pure, files):
    dist = name.replace("-", "_")
    dist_info = f"{dist}-{version}.dist-info"
    payload = dict(files)
    payload[f"{dist_info}/METADATA"] = (
        "Metadata-Version: 2.1\n"
        f"Name: {name}\n"
        f"Version: {version}\n\n"
    ).encode()
    payload[f"{dist_info}/WHEEL"] = (
        "Wheel-Version: 1.0\n"
        "Generator: rumiai-poc-044\n"
        f"Root-Is-Purelib: {'true' if pure else 'false'}\n"
        f"Tag: {tag}\n\n"
    ).encode()

    record_path = f"{dist_info}/RECORD"
    rows = []
    for member in sorted(payload):
        data = payload[member]
        rows.append([member, record_hash(data), str(len(data))])
    rows.append([record_path, "", ""])
    out = io.StringIO(newline="")
    csv.writer(out, lineterminator="\n").writerows(rows)
    payload[record_path] = out.getvalue().encode()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for member in sorted(payload):
            zf.writestr(member, payload[member])
    return buf.getvalue()


def compile_extension(limited):
    source = r"""
#ifdef RUMIAI_LIMITED
#define Py_LIMITED_API 0x03080000
#endif
#include <Python.h>

static PyObject *probe_value(PyObject *self, PyObject *args) {
#ifdef RUMIAI_LIMITED
    return PyUnicode_FromString("abi3-ok");
#else
    return PyUnicode_FromString("cp312-ok");
#endif
}

static PyMethodDef methods[] = {
    {"value", probe_value, METH_NOARGS, "Return compatibility marker."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
    PyModuleDef_HEAD_INIT,
    "_probe",
    NULL,
    -1,
    methods
};

PyMODINIT_FUNC PyInit__probe(void) {
    return PyModule_Create(&module);
}
"""
    include = sysconfig.get_paths()["include"]
    with tempfile.TemporaryDirectory(prefix="rumiai-poc044-") as td:
        td = pathlib.Path(td)
        cfile = td / "probe.c"
        cfile.write_text(source)
        suffix = ".abi3.so" if limited else sysconfig.get_config_var("EXT_SUFFIX")
        if not suffix:
            raise SystemExit("EXT_SUFFIX unavailable")
        output = td / ("_probe" + suffix)

        cc = os.environ.get("CC", "cc")
        if sys.platform == "darwin":
            cmd = [cc, "-bundle", "-undefined", "dynamic_lookup", f"-I{include}"]
        else:
            cmd = [cc, "-shared", "-fPIC", f"-I{include}"]
        if limited:
            cmd.append("-DRUMIAI_LIMITED=1")
        cmd += [str(cfile), "-o", str(output)]
        subprocess.run(cmd, check=True)
        return suffix, output.read_bytes()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    out = pathlib.Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    if sys.version_info[:2] != (3, 12):
        raise SystemExit("PoC fixtures must be built with CPython 3.12")

    platform_tag = sysconfig.get_platform().replace("-", "_").replace(".", "_")

    pure = out / "rumiai_poc_tag_pure-1.0-py3-none-any.whl"
    pure.write_bytes(
        wheel_bytes(
            "rumiai-poc-tag-pure",
            "1.0",
            "py3-none-any",
            True,
            {"poc_tag_pure/__init__.py": b'VALUE = "pure-ok"\n'},
        )
    )

    abi3_suffix, abi3_binary = compile_extension(True)
    abi3_tag = f"cp38-abi3-{platform_tag}"
    abi3 = out / f"rumiai_poc_tag_abi3-1.0-{abi3_tag}.whl"
    abi3.write_bytes(
        wheel_bytes(
            "rumiai-poc-tag-abi3",
            "1.0",
            abi3_tag,
            False,
            {
                "poc_tag_abi3/__init__.py": b"from ._probe import value\n",
                f"poc_tag_abi3/_probe{abi3_suffix}": abi3_binary,
            },
        )
    )

    exact_suffix, exact_binary = compile_extension(False)
    exact_tag = f"cp312-cp312-{platform_tag}"
    exact = out / f"rumiai_poc_tag_exact-1.0-{exact_tag}.whl"
    exact.write_bytes(
        wheel_bytes(
            "rumiai-poc-tag-exact",
            "1.0",
            exact_tag,
            False,
            {
                "poc_tag_exact/__init__.py": b"from ._probe import value\n",
                f"poc_tag_exact/_probe{exact_suffix}": exact_binary,
            },
        )
    )

    print(f"pure={pure}")
    print(f"abi3={abi3}")
    print(f"exact={exact}")
    print(f"platform-tag={platform_tag}")


if __name__ == "__main__":
    main()
