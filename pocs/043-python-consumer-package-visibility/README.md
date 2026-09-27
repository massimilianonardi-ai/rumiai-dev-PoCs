# PoC 043 — Python consumer package visibility

Status: Experimental

## Question

How should a RumiAI Python consumer expose its package tree to the Python provider selected at launch time without embedding the provider path or the RumiAI installation root?

This experiment compares three mechanisms without adopting any of them:

1. direct `PYTHONPATH` projection;
2. a Python-native `sitecustomize` bridge that calls `site.addsitedir()`;
3. `PYTHONUSERBASE` with the consumer tree materialized at the interpreter's reported user-site layout.

All three consumers keep the executable script at:

```sh
#!/usr/bin/env python
```

and use the real current RumiAI `pkg` launcher/provider projection.

## Why `.pth` matters

A plain import test is not sufficient. Python package environments can contain `.pth` files that add import paths or execute import-time setup. The fixture therefore contains a `.pth` file that:

- adds a relative `extra_path` directory;
- sets a marker through an `import` line.

The experiment checks whether each visibility mechanism actually gives normal site-directory semantics rather than merely inserting one directory in `sys.path`.

## Experiment shape

For Linux and macOS:

1. create a synthetic Python facility provider backed by the runner Python;
2. integrate three otherwise equivalent pure-Python consumers;
3. run them through the real `pkg` launcher;
4. record whether the package imports, whether the `.pth` import line executes, whether the `.pth` relative path is added, and how the user-site layout is derived;
5. move the complete disposable RumiAI root without rewriting any consumer;
6. rerun all three consumers and scan their package concretes for the old root.

Bytecode writes are disabled inside this PoC because PoC 042 separately owns that question.

## Expected distinctions

The PoC is designed to establish behavior, not to force a preferred answer.

- Direct `PYTHONPATH` is expected to make modules importable but not process `.pth` files as site directories.
- `site.addsitedir()` is expected to provide normal `.pth` processing while keeping the package tree location runtime-projected.
- `PYTHONUSERBASE` is expected to provide native site processing but may couple the materialized directory layout to interpreter/platform details; the exact relative user-site layout is recorded on each host.

A PASS means the experiment observed those mechanisms consistently before and after relocation. It does not promote a consumer-environment contract.

## Observed result

PASS on GitHub Actions run `36303162645` at PoC revision `9187bb195831b8b62934a9db1fa584dd72407ab0`, on Ubuntu 24.04 and macOS 14.

The three visibility mechanisms behaved consistently before and after moving the complete disposable RumiAI root:

```text
direct PYTHONPATH
    consumer package import             -> PASS
    consumer .pth import line           -> not processed
    consumer .pth relative path         -> not added

sitecustomize + site.addsitedir()
    consumer package import             -> PASS
    consumer .pth import line           -> processed
    consumer .pth relative path         -> added

PYTHONUSERBASE
    consumer package import             -> PASS
    consumer .pth import line           -> processed
    consumer .pth relative path         -> added
```

All three mechanisms survived whole-root relocation and the relocated consumer concretes contained no reference to the old root.

The `PYTHONUSERBASE` layout was interpreter/platform dependent in the hosted evidence:

```text
Ubuntu / CPython 3.12:
    lib/python3.12/site-packages
    minor-version component present

macOS / CPython 3.14:
    lib/python/site-packages
    minor-version component absent
```

This makes bare `PYTHONPATH` insufficient when normal site-directory semantics are required. Both `site.addsitedir()` and `PYTHONUSERBASE` preserve the tested `.pth` behavior, but `PYTHONUSERBASE` delegates consumer layout to interpreter/platform-specific user-site rules. PoC 046 separately tests moving the `site.addsitedir()` bridge into the selected Python provider itself.
