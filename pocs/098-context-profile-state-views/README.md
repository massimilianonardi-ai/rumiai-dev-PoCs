# PoC 098 — system profile selection versus package var filesystem paths

Status: **Experimental / non-normative**. No product, catalog, package payload, or frozen-suite modification.

## Question

Can two independent POSIX processes with different proposed system-profile selections use the *same* installed package's existing physical `root/<path> -> var/<area> -> state/system/current` links and obtain different writable state? If not, can **already prepared** profile-specific paths avoid the shared selector for a compatible executable while reusing the immutable program bytes?

This PoC responds to the current C2 design gate in `rumiai-dev/handoff/rumiai-os-source-composition.md`. Current authority remains `STATE-MODEL.md` and `PACKAGE-MODEL.md`, not this experiment.

## Method

Run `sh tests/profile-var-routing.sh` from this directory. The probe uses disposable filesystem objects and POSIX shell semantics, plus common host test utilities `mktemp` and `readlink`; it does **not** invoke `m`, `pkg`, a Java runtime, real package integration, or a managed service.

1. Reproduce the actual `pkg-state.lib.sh` relative target `../../../state/system/current/pkg/demo/data` and a package-root path which traverses it. With `system/current` bound to A, two independent subprocesses labelled A and B **both read A**; switching the global selector to B changes the read for A to B. An environment label alone does not change filesystem symlink resolution.
2. Build two **pre-existing** profile-specific execution views. Each has an executable and library symlink pointing to a **single shared immutable payload**, and its own `var/data` link to A or B. A deliberately path-aware POSIX executable that resolves data relative to its **invoked pathname** reads A or B correctly, and `system/current` is not changed by these launches.
3. Invoke the shared payload directly outside the profile view. That invocation is expected to fail because the required relative profile-local `var/` path does not exist. This exposes the view-compatibility boundary rather than silently claiming universal package support.

All generated directories and symlinks are created once **before** the profile-view invocations. No view publication occurs as a side effect of context selection.

## Local observation (2026-11-06)

On the provided Linux x86_64 container, both `sh -n` and execution with `sh` and `dash` succeeded. Each executable run reported:

```text
PASS: fixed package var chain ignores independent shell labels and follows shared system/current
PASS: pre-prepared profile-specific launch views isolate A/B for a path-aware tool without modifying shared current
PASS: direct immutable-root launch is NOT compatible with the view-relative state contract
```

This **first probe** is a narrow mechanical filesystem experiment, not real `m context` validation, macOS/physical-reference-host validation, provider or service integration, or a proof of immutable package-root compatibility.

## Actual `m` integration with a real catalog state descriptor (2026-11-06)

The additional test `tests/integrated-catalog-var-routing.sh` is executed by an actual `m-os` bootstrap and `pkg_integrate` from immutable source SHA `1e3a038a5abf6f8c176272d8e44464c842d3cefd`. The workflow checks out the genuine `pkg-catalog/pkg-schema-v2` tree at `a75f9be1c9a62a72899022eddf55e163d86ab630` and passes the published v1 **GeoServer 3.0.1** `var/data` descriptor (`data_dir`) unchanged.

Only the **useful-root payload** is a synthetic, disposable directory with a single marker file. The fixture uses a distinct package name `poc098state@1.0`; it does **not** download, claim to install, run, or validate the upstream GeoServer binary or any production service. The real `pkg_integrate` path validates and moves the staged root, generates its persistent `root/data_dir` and `var/data` links, copies factory state, and uses the actual `m state-path` resolver. The probe verifies that two labelled child processes still follow the one global `system/current` path, then switches the selector **only inside the disposable GitHub Actions checkout** to show that both processes observe the changed profile. The trap restores the original selector and removes the fixture.

Run the integration test through the pinned workflow rather than invoking it in an ordinary workspace; it intentionally mutates only the checkout-owned test state. It does not require network package downloads after the two exact source checkouts.

**Real execution evidence:** [GitHub Actions run 42196202367](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42196202367), PoC commit `29ee99b109ff40e8bf26fe52fa9026a345afcbcc`: `integrated-catalog-var-fixture (ubuntu-latest)` job `127819943949` **PASS**, confirmed by three final `PASS:` lines in the raw log; `profile-var-routing (ubuntu-latest)` job `127819943846` **PASS**. Both macOS jobs were **QUEUED** at this checkpoint and are **not** classified as PASS or FAIL. Earlier [run 42193917751](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/42193917751) already observed the first probe Ubuntu PASS.

**Evidence limits:** The new test exercises real, current, internal package integration and genuine catalog metadata; it is still an experimental staged-fixture test, **not public `m pkg install` of a real upstream release**. It is not proof of concurrent full contexts, provider policies, system TLS/CA authority, browser NSS, service registration, rollback or physical reference-host validation. Do not promote a C2 contract from these observations alone.

## Implications and unresolved contracts

- A single physical package-root symlink chain targeting mutable global `system/current` cannot implement two simultaneous per-process system profiles. `state-path` alone cannot repair that fixed path.
- A **compatible, path-aware command wrapper** can choose a prepared profile view and share immutable program files, but many upstream programs may resolve physical executable paths, use absolute paths, maintain private mutable files, expect one installation root or bypass the wrapper. The experiment does **not** show they can be redirected safely by `PATH`, symlinks, or environment variables alone.
- Candidate migration directions remain **working design**, not decisions: keep global-only routing for affected packages with an explicit compatibility boundary; prepare profile-specific execution/state views for packages whose real launcher and payload support them; or require an alternate package integration/state-access contract for incompatible software. A generalized per-call symlink rebuild is not justified.
- Distinct authoritative TLS/CA profile selection, provider defaults, globally materialized environment, host service registration, POSIX privilege, and trusted nested-child propagation are **not** addressed by this PoC. Their current consumers remain tied to existing system semantics and must be reconciled together.
- Before any C2 contract promotion or C3 implementation, use actual integrated packages with declared `var/` mappings, test two concurrent shells, real system trust/CA consumers, service instances, and negative unsupported consumers. Do not treat this disposable fixture as replacement for those acceptance tests.

The PoC does not authorize modifying `rumiai-os/main`, `rumiai-tests/main`, the shared `pkg` writer, or current public `context` grammar.
