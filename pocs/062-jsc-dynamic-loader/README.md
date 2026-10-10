# 062 — Experimental `jsc` and classic-script dynamic loader

This is a **PoC**, not a released `m` command/library, a design contract, or an ESM compiler. It deliberately explores a model where several **ordinary classic JavaScript sources** are joined into **one classic browser JavaScript bundle**. A small explicit module descriptor supplies names, dependencies and source paths. The loader registers factories, evaluates them only on first `require`, and can replace factories and invalidate their transitive instantiated consumers.

## Run

```sh
npm run build
npm test
# The memory check needs Node.js --expose-gc and runs as part of npm test
# Requires a functioning local Chromium (or CHROMIUM=/path/to/chrome)
npm run test:browser
```

Open `example/demo.html` with `file://` after build (or from a local server). No npm dependencies are needed for the compiler or loader; Node.js is needed only to build/test.

## Source contracts (experimental)

- `example/modules.json` has `version:1` and an array `modules: [{id,file,deps,format?}]`. The optional `format` can only be `classic`. The compiler explicitly rejects ESM format declarations and static `import` / `export` statements; no ESM reinterpretation or translation. Explicit browser-native dynamic `import()` expressions, if written in a classic source, are not transformed or controlled by the `jsc` registry and are therefore outside the managed loading contract.
- Each `.js` source is a function body receiving `require`, `module`, `exports`. Only declared dependencies may be requested; exports use `module.exports` or `exports`.
- The generated one-file classic bundle includes the loader and module factory registrations. Evaluation is lazy even though download is not: the single file must still be transferred in its entirety.
- `JscRuntime.install` validates a replacement dependency graph before disposing the prior factory; missing dependencies and new cycles fail without tearing down the running instance. Valid replacements invalidate the updated module and instantiated dependents, calling `module.onDispose`. Clients **must reacquire** exports: already-captured exports are not live-updated. Invalid source syntax must be rejected by compilation before deployment; the runtime cannot undo external side effects from scripts that execute and throw.
- `JscRuntime.revision(id)` returns a per-registered-module install revision and resets to zero upon removal. With `JscRuntime.loadScript(url, {expect: id})`, a network request is not reported successful merely because the `<script>` tag loaded: it must actually install the expected module. No cryptographic content integrity or transactionality is claimed.
- `JscRuntime.remove` refuses removal when another registered module depends on the target.
- Cyclic dependencies are rejected during a `jsc` build; runtime initialization cycles are also rejected. No cross-module shared state restoration or atomic multi-module upgrades yet.
- This source format is not legacy `m.Class` compatibility or native ESM; separate adapters and comparative PoCs are needed.

## Freshness and release consistency are different concerns

A development server must send `Cache-Control: no-store` for reloadable source scripts. The browser's classic `<script src>` transport has no `fetch()` cache-mode override; this PoC's `loadScript()` relies on server headers and does not use POST or `eval`. Plain `fetch(url, {cache:'no-store'})` can obtain up-to-date source text but does **not** directly execute it under restrictive CSP without another execution transport.

For a web deployment, use revalidated HTML/release metadata (`Cache-Control: no-cache`), content-hashed immutable assets, atomic publication of complete release assets, and retention of assets referenced by still-active clients until migration. Server cache headers cannot by themselves upgrade JavaScript already loaded and executing in an open page. Service workers require separate update/version policy; avoid incompatible old HTML/new JS mixes.

## Limits requiring real follow-up

- Not yet a replacement for esbuild, Rollup or webpack: no ESM syntax, AST dependency analysis, CSS, source maps, minification, cross-package resolution, npm graph or tree shaking.
- `module.onDispose` only calls user-registered cleanup; external references, DOM/event subscriptions not cleaned by the module, network resources and other retained objects still require discipline. Runtime cleanup callback failures are aggregated; no atomic rollback is provided.
- Local Node tests verify the classic/ESM separation, successful unchanged output after rejected builds, preflight validation of a replacement graph, revision checks, bounded registry entries, and 2000 replacement/dispose operations. A separate Node `--expose-gc` heap experiment samples retained memory over 7000 replacement/re-instantiation operations: this tests Node and controlled cleanup only; **not** proof of bounded heap usage in a long-lived real browser. A real-browser script test passed on GitHub Actions Ubuntu/Chrome (run 38034189246) for two consecutive same-URL patch GETs under CSP without `unsafe-eval`. Locally the available Chromium hangs even on a trivial headless invocation (infrastructure limitation). An expanded hosted Chrome test now additionally attempts a browser heap plateau check after 3,000 replacements with exposed GC and `performance.memory` (pending hosted validation); multi-release deployment tests remain open.
- Hot replacement can invalidate active consumers; caller must reacquire its entry module. No safe rollback on a broken replacement, no transaction, no state transfer.
- The dynamic `<script>` route requires a server for remote updates and an appropriate site CSP; does not bypass CSP to execute arbitrary downloaded text.
- Integrate via existing `mk` process actions only if relevant; tooling/package installation belongs to future `pkg` evaluation and **no product files are changed by this PoC**.
