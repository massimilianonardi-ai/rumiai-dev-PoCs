# PoC 072 — Independent RumiAI OS composition: POSIX vs mk

Status: Experimental; not a product distribution.
Date: 2026-10-23

## Question

Can a release-like tree be assembled from independent Git repositories with only POSIX shell/Git/filesystem operations? What extra value does the current real `mk` engine provide when run with host Node.js, without an installed RumiAI OS?

This PoC deliberately models just three small contributions (`m`, `pkg`, `lang`), not the actual implementation of those subsystems. The mini-bootstrap is a test fixture, not a replacement for the canonical `rumiai-os/m`.

## Inputs and execution

`tests/run.sh <absolute-path-to-real-mk.lib.js>` makes three *real local Git repositories* from `fixtures/m`, `fixtures/pkg`, and `fixtures/lang`. Each repository is committed, and its exact HEAD is supplied to both builders. The POSIX builder and the `mk` lifecycle independently clone and check out those same SHAs.

The POSIX builder is `build-posix.sh`. The `mk` builder is the actual `mk` v1 lifecycle in `mk.json`, run by directly invoking the unmodified JavaScript engine with the host's Node.js. Both assemble the same executable `m` by concatenating component-contributed fragments, install commands and resources, preserve executable modes, create the relative language selector, and publish an output tree.

Expected output:
```
m
bin/sys/pkg-root
bin/sys/lang-root
pkg/
res/sys/lang/en_US/demo/message
res/sys/lang/it_IT/demo/message
res/sys/lang/current -> en_US
```

The PoC verifies a byte-equivalent output tree (`git diff --no-index`), the physical bootstrap root after relocation, and the two native child commands running in the exported environment. It also checks that `mk --plan` does not execute build actions.

## Repeatable hosted experiment

The workflow `.github/workflows/poc-072-rumiai-os-composition.yml` uses the real `mk.lib.js` from `rumiai-os` at pinned commit `5ca07aeb26dbc04c0b38998bb05edacd8587a977`; the product checkout is only an engine source, **not** the runtime environment being assembled.

Local requirements: POSIX shell, Git, Node.js, `realpath`, standard filesystem utilities and Git's tree comparison. No pre-existing `m`, `pkg` or managed Node installation is used.

## First hosted results

The first completed green run (commit `822555748e052dc6aad871e07046a60293fb21ae`, [run 39964211916](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39964211916)) passed on Ubuntu and macOS with host Node.js 24.21.0. Both builders produced equivalent file contents, modes and relative selector links; both generated bootstrap entrypoints executed correctly.

The experiment exposed a real host difference: macOS `diff -r` followed the `current -> en_US` directory selector and reported a loop, so the comparison now uses Git's `diff --no-index` to compare symlink entries rather than traverse them. macOS temporary directories may also have a symlinked `/var` path, so bootstrap root checks compare physical roots. Earlier failing runs are evidence of these errors, not successful validation.

## Boundaries and next experiment

These fixtures isolate the acquisition/composition question; they do **not** prove that today's complete `rumiai-os` is composable, that the real `pkg` and `lang` ownership can be separated without changes, or that `mk`'s v2 features work standalone. The current `mk` command wrapper, `pkg` facility requirement resolution, `m`-backed cache and `watch` still depend on the `m` runtime. No product code or canonical specification is changed here.

After the basic equivalence check, expand the PoC to use genuine component source trees and compare failure recovery, incremental changes, collision handling, reproducible provenance and maintenance effort. Preserve both implementation paths until the evidence supports a choice.
