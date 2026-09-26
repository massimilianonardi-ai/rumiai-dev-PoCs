# PoC 046 — Python provider consumer-site hook

Status: Experimental

## Question

Can a selected Python provider expose one consumer-owned site-packages tree with ordinary Python site semantics without embedding either the provider path or the consumer path in installed scripts?

The mechanism under test is deliberately small:

1. the Python provider contains one static `.pth` hook in its own site-packages;
2. the hook reads a PoC-only environment variable naming the live consumer site directory;
3. the hook calls `site.addsitedir()` on that directory;
4. consumer commands continue to use `#!/usr/bin/env python`.

The environment-variable name is experimental and is not a proposed RumiAI contract.

## Why this is different from bare PYTHONPATH

PoC 043 proved that putting the consumer site directly on `PYTHONPATH` exposes ordinary modules but does not process that site's `.pth` files.

This PoC instead keeps the provider's normal startup/site processing in control. A static provider hook adds the live consumer site through Python's own `site.addsitedir()`, preserving the tested `.pth` behavior.

## Experiment shape

Using the same pinned `python-build-standalone` CPython 3.13.15 artifacts as PoC 039, on Linux and macOS the experiment:

1. extracts the relocatable provider;
2. installs one static provider-side `.pth` hook containing no installation path;
3. creates a consumer site with a package plus a `.pth` file that adds a relative directory and executes an observable import line;
4. runs direct `python -c` with only the consumer-site environment value;
5. runs a consumer command using `#!/usr/bin/env python` with the provider selected through PATH;
6. launches a child `python` process from that consumer and verifies the same consumer site is visible there;
7. moves provider and consumer trees and repeats without rewriting either the provider hook or the command;
8. scans the moved provider hook/consumer command for the original paths.

## Scope

A PASS establishes the Python-native mechanics only.

It does not adopt the PoC environment-variable name, does not define how `pkg` will expose a consumer-root-relative site path, and does not yet decide whether the final bridge belongs in the Python provider package, another trusted runtime component, or generated consumer integration.

The important property is that the Python command remains provider-independent and location-independent while normal site-directory semantics are preserved.
