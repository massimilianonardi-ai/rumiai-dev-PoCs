# PoC 041 — relocated standalone Python sdist build

Status: Experimental

## Question

After a `python-build-standalone` runtime has already been moved, can an ordinary Python packaging frontend/backend path build source distributions into usable pure-Python and native-extension wheels without reintroducing a dependency on the runtime's previous location?

This extends PoC 039 beyond the hand-built wheel fixture. The build under test is:

```text
local source distribution (.tar.gz)
    -> relocated standalone CPython
    -> python -m pip wheel
    -> isolated PEP 517 build environment
    -> pinned setuptools + wheel backend
    -> wheel
    -> PoC 038 materializer
    -> #!/usr/bin/env python
```

## Pinned inputs

The workflow reuses the same `python-build-standalone` 20260924 / CPython 3.13.15 install-only artifacts exercised by PoC 039.

The source projects declare:

```text
setuptools==80.9.0
wheel==0.45.1
```

as their PEP 517 build requirements so the backend/toolchain boundary is reproducible.

## Experiment shape

For both Linux and macOS the experiment:

1. extracts the standalone runtime at one arbitrary path and moves it before any package build;
2. verifies that the moved runtime provides `pip`;
3. constructs two local source distributions: one pure Python and one CPython C extension;
4. runs `python -m pip wheel` on both sdists using isolated PEP 517 builds;
5. materializes the resulting wheels with the PoC 038 experimental materializer and verifies `#!/usr/bin/env python`;
6. executes both consumers against the relocated standalone runtime;
7. moves the standalone runtime a second time without rewriting either consumer;
8. executes the same materialized consumers again;
9. scans wheel/materialized outputs and the twice-moved runtime for the first build-time runtime prefix.

## Scope

A PASS is evidence that an ordinary pip/setuptools source-build path can operate after relocation for the tested pure/native fixtures and that the resulting materialized consumers remain independent from the runtime location.

It does not establish that arbitrary PyPI sdists are relocatable, does not adopt pip/setuptools as the final RumiAI build frontend/backend, and does not settle Python ABI compatibility or the final consumer-environment projection.
