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


## Observed result

PASS on GitHub Actions run `36271936061` at PoC revision `b7f983119456981e9544a4de2c12d670aa7fbc69`, on Ubuntu 24.04 and macOS 14.

Both hosts produced the same semantic result:

```text
ordinary site-packages
    .pth relative path                 -> processed
    .pth import line                   -> executed

bare PYTHONPATH
    directory itself on sys.path       -> yes
    .pth relative path                 -> not processed
    .pth import line                   -> not executed

site.addsitedir(consumer site)
    .pth relative path                 -> processed
    .pth import line                   -> executed
    after complete tree relocation     -> still works
```

Therefore the provisional PoC 038 projection based only on `PYTHONPATH` is sufficient to prove interpreter/environment separation for simple imports, but it is **not semantically equivalent to an ordinary Python site-packages directory**.

The final RumiAI consumer-environment design must make an explicit choice: preserve ordinary site-directory semantics (including `.pth` path additions and executable `import` lines), or deliberately define a narrower model and reject/transform packages that depend on those semantics. `site.addsitedir()` is now proven as one relocatable Python-native primitive for processing a consumer site directory, but this PoC does not prescribe how RumiAI should invoke it.
