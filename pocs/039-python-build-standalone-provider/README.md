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
