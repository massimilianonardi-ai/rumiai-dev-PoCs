#!/usr/bin/env python3
import argparse
import configparser
import os
import pathlib
import re
import shutil
import stat
import zipfile

ENV_SHEBANG = b"#!/usr/bin/env python\n"


def safe_relative(name: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"unsafe wheel member: {name}")
    return path


def write_file(path: pathlib.Path, data: bytes, executable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    mode = 0o755 if executable else 0o644
    path.chmod(mode)


def parse_target(spec: str):
    target = spec.strip().split("[", 1)[0].strip()
    if ":" not in target:
        raise ValueError(f"unsupported entry point: {spec}")
    module, attr = (part.strip() for part in target.split(":", 1))
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", module):
        raise ValueError(f"unsupported entry-point module: {module}")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", attr):
        raise ValueError(f"unsupported entry-point callable: {attr}")
    return module, attr


def entry_script(module: str, attr: str) -> bytes:
    return (
        "#!/usr/bin/env python\n"
        f"from {module} import {attr}\n"
        f"raise SystemExit({attr}())\n"
    ).encode()


def materialize(wheel: pathlib.Path, root: pathlib.Path):
    site = root / "python" / "site-packages"
    bindir = root / "bin"
    site.mkdir(parents=True, exist_ok=True)
    bindir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(wheel) as zf:
        names = zf.namelist()
        dist_infos = sorted({n.split("/", 1)[0] for n in names if ".dist-info/" in n})
        if len(dist_infos) != 1:
            raise ValueError("wheel must contain exactly one dist-info directory")
        dist_info = dist_infos[0]

        entry_points = {}
        ep_name = f"{dist_info}/entry_points.txt"
        if ep_name in names:
            parser = configparser.ConfigParser(interpolation=None)
            parser.read_string(zf.read(ep_name).decode("utf-8"))
            if parser.has_section("console_scripts"):
                entry_points = dict(parser.items("console_scripts"))

        for member in names:
            if member.endswith("/"):
                continue
            rel = safe_relative(member)
            data = zf.read(member)
            parts = rel.parts
            data_marker = next((i for i, p in enumerate(parts) if p.endswith(".data")), None)
            if data_marker is not None:
                tail = parts[data_marker + 1 :]
                if not tail:
                    continue
                scheme = tail[0]
                scheme_rel = pathlib.PurePosixPath(*tail[1:]) if len(tail) > 1 else pathlib.PurePosixPath()
                if scheme == "scripts" and scheme_rel.parts:
                    if data.startswith(b"#!python\n") or data.startswith(b"#!pythonw\n"):
                        data = ENV_SHEBANG + data.split(b"\n", 1)[1]
                    write_file(bindir / pathlib.Path(*scheme_rel.parts), data, executable=True)
                elif scheme in {"purelib", "platlib"} and scheme_rel.parts:
                    write_file(site / pathlib.Path(*scheme_rel.parts), data)
                continue
            write_file(site / pathlib.Path(*parts), data)

        for command, spec in sorted(entry_points.items()):
            if "/" in command or command in {".", ".."}:
                raise ValueError(f"unsupported command name: {command}")
            module, attr = parse_target(spec)
            write_file(bindir / command, entry_script(module, attr), executable=True)

    print(f"wheel={wheel}")
    print(f"root={root}")
    print(f"site-packages={site}")
    for path in sorted(bindir.iterdir()):
        print(f"command={path.name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel")
    parser.add_argument("root")
    args = parser.parse_args()
    materialize(pathlib.Path(args.wheel), pathlib.Path(args.root))


if __name__ == "__main__":
    main()
