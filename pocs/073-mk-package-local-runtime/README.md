# PoC 073 — Package-local mk runtime

Status: Experimental; not a released mk source repository or a published catalog entry.

## Goal

Prove that the **real** `mk.lib.js` engine can be distributed inside an
immutable `pkg` concrete as `root/lib/mk.lib.js`, reached only through
`root/bin/mk` and the normal package launcher. Neither mk engine nor mk
libraries are installed into `m-core/lib/sys`.

Build has no compilation step: packaging is POSIX file copy and archive.
Node.js is a **package runtime dependency** (`nodejs =26`) and is not required
to bootstrap the m root or to produce the archive. The existing `pkg`
integration and command-launch code handles that dependency on execution.

The PoC stages a copy of the engine from the exact
`rumiai-os` revision `673df1a2d5476ad57d54c7bc7e1fc2deeaf16195`, with only
its two watch-child re-entry paths adjusted to the sibling package `cmd/mk`
launcher. It uses an isolated copy of the real product root. It does **not** change
`rumiai-os/main` and does not publish a fake `mk` entry in
`pkg-catalog/main` before a dedicated source repository and downloadable
versioned release exist.

## Layout

```text
artifact root/
    bin/mk
    lib/mk.lib.js
materialized pkg/mk@v0.1.0/
    root/                 (above artifact)
    cmd/mk               (owned by pkg metadata)
    link/mk -> ../root/bin/mk
    dependency            (nodejs =26)
```

The separate `cmd/mk` is the **generic pkg launcher**: it sources the existing
`pkg/pkg-launch` library owned by m-core; it contains no mk implementation.
The artifact itself contains all mk implementation files.

## Real-source execution

```sh
sh pocs/073-mk-package-local-runtime/tests/run.sh /path/to/rumiai-os-checkout
```

The test copies a provided product checkout to a disposable runtime root,
removes its old `bin/sys/mk` and `lib/sys/js/mk.lib.js`, builds an archive
containing the staged engine, installs real managed Node.js through `pkg`,
integrates the archive using the actual `pkg_integrate` and
`pkg_default_apply`, and calls `m mk` through the real package launcher.
It exercises `--goals`, `--plan`, execution with managed Node identity and
`--watch` re-entry through the package-local launcher, including an input change.

The GitHub Actions workflow uses pinned product source revision
`673df1a2d5476ad57d54c7bc7e1fc2deeaf16195`.

## Known remaining work

1. The two watch re-entry sites were redirected experimentally to the
   package-local `cmd/mk`; the full permanent watch regression suite and
   all existing callers must be realigned before production publication.
2. Establish the dedicated mk source repository and publish a verifiable
   package release artifact there. The current connector cannot create a
   repository or publish GitHub release assets.
3. Only after the release is available, add the real `pkg/mk` descriptor to
   `pkg-catalog` and test `pkg install mk` end-to-end from a clean m-core
   root (including full watch and regression behavior).
4. Remove the old system mk only in the coordinated, fully validated product
   extraction step. No real installation is migrated by this PoC.
