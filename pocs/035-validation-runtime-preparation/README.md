# PoC 035 — Validation target runtime preparation

Status: Experimental

## Question

Can a formal-validation launcher prepare a managed Node.js runtime *inside the same disposable exact-revision `rumiai-os` clone* using only the real RumiAI package path, while retaining enough revision evidence to identify the `pkg-catalog` snapshot that participated?

This PoC is intentionally outside canonical specifications. It tests the preparation mechanism needed by the active `mk` validation work unit; it does not define the final `rumiai-validate` configuration syntax or evidence schema.

## Hypothesis

Given an exact clean `rumiai-os` checkout, a validation launcher can:

1. create an independent disposable clone of that exact product commit;
2. isolate mutable user roots;
3. execute the disposable target's real public package command:
   - `pkg install nodejs`
   - `pkg default nodejs`
4. resolve and execute Node.js through the target's normal `m` command path;
5. recover the immutable `pkg-catalog` commit used by `pkg install` from the package subsystem's own catalog cache.

No host Node binary is copied into the target and no test-private replacement runtime is synthesized.

## Scope

The experiment checks mechanism and evidence availability only. It does **not** decide:

- the final validation configuration keys;
- whether package preparation is declared per validation scope or inferred elsewhere;
- the final evidence record names;
- catalog pinning/replay semantics;
- whether hosted execution is sufficient for the eventual milestone.

## Run

```sh
./run.sh /path/to/exact/rumiai-os/checkout
```

The script creates and destroys its own disposable clone. The supplied checkout is used only as the product source/update point.

Expected success output contains:

```text
product-commit=<sha>
catalog-commit=<sha>
managed-node=<absolute path inside disposable target>
node-version=<version>
PASS validation target runtime preparation
```

## Hosted experiment

The associated temporary workflow executes the same PoC on GitHub-hosted Ubuntu and macOS against the exact product revision recorded by the active `mk` work unit.

Positive results are experimental evidence only. They are not formal `rumiai-validate` evidence.
