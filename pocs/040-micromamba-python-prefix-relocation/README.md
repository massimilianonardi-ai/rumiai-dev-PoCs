# PoC 040 — micromamba Python prefix relocation

Status: Experimental

## Question

What part of the Conda/micromamba Python environment model is actually reusable for RumiAI?

This experiment distinguishes three properties that are easy to conflate:

1. the Python interpreter itself can discover a moved prefix;
2. commands installed into that prefix remain runnable after the prefix moves;
3. the complete environment contains no durable references to its original installation prefix.

The experiment is intentionally descriptive. It does not assume that a Conda environment is or is not freely relocatable.

## Pinned micromamba input

```text
micromamba release: 2.9.0-0
channel:            conda-forge
requested Python:   3.13
```

The workflow selects the official release binary for the runner architecture and verifies the release SHA-256 before use.

## Experiment shape

The hosted Linux/macOS experiment:

1. creates a fresh micromamba prefix containing Python 3.13 and pip;
2. records CPython `sys.prefix`, `sys.base_prefix`, executable and representative stdlib/native-module behavior;
3. inspects the package cache's `info/paths.json` metadata and counts files that declare a Conda prefix placeholder;
4. records the generated pip shebang and scans the complete environment for the original physical prefix;
5. physically moves the complete environment directory without asking micromamba to relink or rewrite it;
6. reruns the interpreter and `python -m pip` from the moved location;
7. separately tries the generated `pip` command, preserving whether it works or fails as evidence rather than forcing either answer;
8. scans the moved environment for references to the original prefix.

## Interpretation

Useful RumiAI ideas may include:

- prefix as a complete package/materialization boundary;
- explicit metadata describing files that need prefix rewriting;
- binary relocation performed deliberately during package installation;
- keeping the Python package manager itself independent from Python.

The experiment does **not** make destination-prefix rewriting a RumiAI contract. RumiAI's stronger working goal remains permanent path independence where practical, with `pkg` owning provider selection and managed Python commands using `#!/usr/bin/env python`.

## Run

```sh
MICROMAMBA_URL=... \
MICROMAMBA_SHA256=... \
./run.sh
```

The associated GitHub Actions workflow supplies pinned official artifacts for Linux x86_64 and macOS runner architectures.
