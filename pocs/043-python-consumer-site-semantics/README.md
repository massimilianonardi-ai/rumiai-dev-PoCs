# PoC 043 — Python consumer site semantics

Status: Experimental

## Question

Is a consumer-owned package directory exposed through `PYTHONPATH` semantically equivalent to an ordinary Python `site-packages` directory, and if not, what Python-native operation restores the missing behavior without binding the consumer to a concrete interpreter path?

The experiment focuses on `.pth` handling because ordinary Python site directories process these files, while the current PoC 038 environment projection uses only `PYTHONPATH`.

## Experiment shape

The fixture contains:

```text
site-packages/
    poc43.pth
    extras/
        pthprobe.py
```

The `.pth` file both adds the relative `extras` directory and executes a small observable import line.

The experiment compares:

1. an ordinary `venv` site-packages directory as the Python control;
2. the same tree exposed only through `PYTHONPATH`;
3. the same tree exposed through `PYTHONPATH` and explicitly processed with `site.addsitedir()`;
4. the explicit-site case after the complete fixture tree is moved.

## Interpretation

A PASS should establish whether bare `PYTHONPATH` preserves normal site semantics. If it does not, the result does **not** automatically adopt `site.addsitedir()` as the RumiAI mechanism. It only identifies the semantic gap that the eventual consumer-environment projection must deliberately preserve or deliberately exclude.

The experiment also records that processing ordinary `.pth` files can execute `import` lines. Preserving normal Python site semantics therefore includes that behavior; a future RumiAI design must not accidentally claim ordinary site compatibility while silently skipping it.
