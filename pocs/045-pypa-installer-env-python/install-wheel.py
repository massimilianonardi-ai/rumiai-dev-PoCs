#!/usr/bin/env python3
import argparse
import io
import pathlib
import sys
import sysconfig

from installer import install
from installer.destinations import SchemeDictionaryDestination
from installer.scripts import Script
from installer.sources import WheelFile
from installer.utils import Scheme


ENV_PYTHON_SHEBANG = b"#!/usr/bin/env python\n"


class EnvPythonDestination(SchemeDictionaryDestination):
    """PoC-only POSIX destination that late-binds Python through env."""

    def write_file(self, scheme, path, stream, is_executable):
        if scheme == Scheme("scripts"):
            data = stream.read()
            first, separator, rest = data.partition(b"\n")
            rewritten_python_script = separator and first in {b"#!python", b"#!pythonw"}
            if rewritten_python_script:
                data = ENV_PYTHON_SHEBANG + rest
            with io.BytesIO(data) as rewritten:
                return self.write_to_fs(
                    scheme,
                    str(path),
                    rewritten,
                    is_executable=is_executable or rewritten_python_script,
                )
        return super().write_file(scheme, path, stream, is_executable)

    def write_script(self, name, module, attr, section):
        script = Script(name, module, attr, section)
        script_name, data = script.generate("python", "posix")
        first, separator, rest = data.partition(b"\n")
        if not separator or first != b"#!python":
            raise RuntimeError(f"unexpected generated script shebang: {first!r}")

        with io.BytesIO(ENV_PYTHON_SHEBANG + rest) as stream:
            return self.write_to_fs(
                Scheme("scripts"),
                script_name,
                stream,
                is_executable=True,
            )


def scheme_dict(root: pathlib.Path):
    site = root / "python" / "site-packages"
    return {
        "purelib": str(site),
        "platlib": str(site),
        "scripts": str(root / "bin"),
        "headers": str(root / "include"),
        "data": str(root / "data"),
    }


def materialize(wheel: pathlib.Path, root: pathlib.Path, mode: str):
    schemes = scheme_dict(root)
    if mode == "stock":
        destination = SchemeDictionaryDestination(
            scheme_dict=schemes,
            interpreter=sys.executable,
            script_kind="posix",
            bytecode_optimization_levels=(),
        )
    else:
        destination = EnvPythonDestination(
            scheme_dict=schemes,
            interpreter=sys.executable,
            script_kind="posix",
            bytecode_optimization_levels=(),
        )

    with WheelFile.open(wheel) as source:
        source.validate_record(validate_contents=True)
        install(
            source=source,
            destination=destination,
            additional_metadata={"INSTALLER": b"rumiai-poc-045\n"},
        )

    print(f"mode={mode}")
    print(f"root={root}")
    print(f"site={schemes['purelib']}")
    print(f"scripts={schemes['scripts']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["stock", "env"])
    parser.add_argument("wheel")
    parser.add_argument("root")
    args = parser.parse_args()
    materialize(pathlib.Path(args.wheel), pathlib.Path(args.root), args.mode)


if __name__ == "__main__":
    main()
