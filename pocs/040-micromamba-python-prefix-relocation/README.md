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


## Observed result

PASS on GitHub Actions run `36271204228` at PoC revision `2bb78d88eab49ab43749a9b8647ffc04b369fc8c`, on Ubuntu 24.04 and macOS 14 Apple Silicon.

The result separates interpreter relocation from environment relocation very clearly.

```text
conda-forge CPython 3.13.15
    direct prefix move             -> PASS on Linux and macOS
    sys.prefix after move          -> follows moved environment
    python -m pip after move       -> PASS
    micromamba list moved prefix   -> PASS

generated pip command
    shebang                         -> absolute original-prefix Python
    direct pip after move           -> BREAKS
                                      Linux status 127
                                      macOS status 126

Conda relocation metadata
    Linux paths.json files          -> 25
    Linux path entries              -> 7058
    Linux prefix-placeholder entries-> 207
    Python-package placeholder entries -> 12

    macOS paths.json files          -> 19
    macOS path entries              -> 7014
    macOS prefix-placeholder entries-> 206
    Python-package placeholder entries -> 12

old original-prefix references after raw mv
    Linux                           -> 654 files
    macOS                           -> 163 files
```

On macOS, the environment was created through the lexical `/var/...` temporary path while its physical location is `/private/var/...`. The corrected experiment compares directory identity after physical canonicalization but deliberately scans both lexical and physical prefix spellings, because both can be embedded in installed files.

The evidence therefore supports a narrower conclusion than "Conda environments are relocatable": the tested conda-forge CPython interpreter itself discovers the moved prefix and continues to run, while the materialized environment retains substantial installation-prefix state and generated commands can remain bound to the original location.

For RumiAI, the reusable parts are the package-prefix model, explicit relocation metadata and deliberate native-binary relocation techniques. The destination-prefix binding model itself is not a match for the stronger permanent-relocatability goal.
