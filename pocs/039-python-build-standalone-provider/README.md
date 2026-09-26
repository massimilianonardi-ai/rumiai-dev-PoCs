# PoC 039 — python-build-standalone relocatable provider

Status: Experimental

## Question

Can a current `python-build-standalone` CPython distribution act as a genuinely relocatable RumiAI Python provider, while the consumer environment remains separate from the interpreter and its executable scripts keep using:

```sh
#!/usr/bin/env python
```

through the existing `pkg` facility/provider projection?

This PoC composes the successful PoC 038 package-environment model with an actual standalone CPython runtime instead of delegating provider commands to host Python.

## Pinned upstream input

The hosted experiment uses the current upstream release selected when the PoC was created:

```text
python-build-standalone release: 20260924
CPython:                       3.13.15
target:                        x86_64-unknown-linux-gnu
artifact:                      install_only.tar.gz
sha256:                        c20e1ff8600a0241849588b36948942eaccdc80da34df69674f3784a687197de
```

The release artifact is downloaded directly from the upstream GitHub release and its digest is verified before extraction.

## Experiment shape

The Linux experiment:

1. extracts the standalone runtime into one arbitrary directory and verifies interpreter startup plus representative stdlib/native modules;
2. moves the complete runtime directory without rewriting it and verifies startup, `sys.prefix`, `sysconfig`, SSL, ctypes and sqlite again;
3. builds the PoC 038 pure-Python and native-extension wheels **after** that runtime movement, so a stale sysconfig/include path becomes behaviorally visible;
4. materializes those wheels with the PoC 038 experimental wheel materializer, preserving `#!/usr/bin/env python`;
5. integrates the moved standalone runtime as the concrete provider of an experimental Python facility in a disposable copy of the exact RumiAI checkout;
6. launches pure and native consumers through the real RumiAI package launcher;
7. moves the complete disposable RumiAI root, including the Python provider and consumers, then reruns the same commands without rewriting either provider or consumer;
8. scans the relocated provider and consumer trees for references to the pre-move RumiAI root and reports references to the standalone runtime's first extraction location.

## Why build after runtime relocation

Runtime startup can succeed while build metadata remains tied to an earlier prefix. Building a CPython extension only after the standalone interpreter has moved makes `sysconfig` path correctness observable through a real compiler invocation rather than only through string inspection.

## Scope

A PASS establishes Linux evidence only for this pinned upstream artifact and exact RumiAI input revision. It does not yet validate macOS loader/install-name behavior, choose a permanent Python facility compatibility contract, adopt `PYTHONPATH`, or promote the experimental wheel materializer.

The experiment deliberately keeps `PYTHONDONTWRITEBYTECODE=1` as the provisional package-root immutability control discovered by PoC 038. Bytecode-cache ownership remains a separate open design question.


## Observed result

PASS on GitHub Actions run `36269289831`, using PoC revision `e311db990ebae3d8674b90cdc53c4f082c16463d` against exact `rumiai-os` revision `7d71de0de59120fb85236f087f0298c6dc637d71` on Ubuntu 24.04.

The pinned upstream artifact digest matched `c20e1ff8600a0241849588b36948942eaccdc80da34df69674f3784a687197de`.

Observed behavior:

```text
standalone CPython 3.13.15
    extract at runtime-a -> startup/sysconfig/native stdlib OK
    move to runtime-b    -> startup/sysconfig/native stdlib OK
    sys.prefix           -> follows runtime-b
    sysconfig include    -> follows runtime-b
    native extension build after move -> PASS

RumiAI provider integration
    provider command -> standalone python/bin/python3
    pure consumer    -> PASS via #!/usr/bin/env python
    native consumer  -> PASS
    sysconfig inside managed provider -> live package prefix

whole RumiAI-root move
    provider + consumers move together
    pure/native commands still run
    managed old-prefix scan -> clean
    initial standalone extraction prefix hits -> 0
```

The upstream install-only distribution contained three pre-existing bytecode-cache files. The first PoC 039 run incorrectly treated the mere presence of those shipped files as runtime mutation. The corrected run snapshots those files before managed execution and proves their count/content remain unchanged. Consumer package roots acquired no `__pycache__` directories while `PYTHONDONTWRITEBYTECODE=1` was projected experimentally.

A later cross-host rerun, GitHub Actions run `36270231418` at PoC revision `00da3691eab956902a4b8a7303f62d7e3d0a1b93`, passed both Ubuntu 24.04 and macOS 14 (Apple Silicon). The macOS job used the pinned aarch64 Apple Darwin artifact with SHA-256 `a18e1d1b6067d39cf7b2b605fdb78ad6b8a3aed221c44ef934d399dccf355453`.

The macOS job established the same tested properties as Linux:

```text
standalone CPython 3.13.15
    direct runtime move                 -> PASS
    sys.prefix after move               -> live physical prefix
    tested sysconfig include path       -> live physical prefix
    SSL / sqlite / ctypes               -> PASS
    native extension build after move   -> PASS

RumiAI provider integration
    provider + pure/native consumers    -> PASS
    #!/usr/bin/env python               -> PASS
    whole managed-root move             -> PASS
    managed old-prefix scan             -> clean
    initial extraction-prefix hits      -> 0
```

The preceding macOS failure at run `36269415163` was a harness bug: macOS exposed the same temporary directory lexically as `/var/...` while CPython reported its physical path as `/private/var/...`. The corrected PoC canonicalizes directory paths with `pwd -P` before semantic comparison or old-prefix scanning.

This now gives direct Linux + macOS evidence that the tested `python-build-standalone` artifact can serve as a movable RumiAI Python provider and that the tested `sysconfig` include path follows the live runtime prefix strongly enough to build a CPython native extension after relocation.

The result still does not prove every `sysconfig` variable is path-independent and does not settle bytecode-cache ownership, Python compatibility semantics, consumer environment projection, or the final wheel materializer.
