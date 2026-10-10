# Dynamic loader — independent experimental classic library

Private local PoC package `rumiai-poc-dynamic-loader@0.0.0-poc.1`. **Not published and not a stable product/API commitment**.

Copy/include `loader.js` as a normal **classic browser script** before compiler-produced registrations. The loader is self-contained, requires no `jsc` code or Node runtime in the browser, and exposes the existing experimental global `JscRuntime`:

- `install(id, deps, factory)`: register/replace one definition.
- `installBatch(changes, {expectedRevisions?})`: preflight the complete graph, reject invalid/cyclic/missing dependencies before touching active instances, then dispose affected consumers and commit definitions. Cleanup failures are reported after commit: **a full page reload may be required**.
- `require(id)`: evaluate on first request, then reuse cached exports.
- `revision(id)`, `state()`: inspect registered version/count and instantiated modules.
- `invalidate(id)`: dispose an instance and instantiated dependents.
- `remove(id)`: delete a definition when it has no registered dependents.
- `loadScript(url, {nonce?, expect?})`: load a classic script in a browser and reject if expected registrations did not change.

Factories get `require`, `module`, `exports`; use `module.onDispose(callback)` to stop timers, remove listeners and free application resources. After updating a module, reacquire its exports with `JscRuntime.require(id)`: old captured references are **not** live bindings. A throwing disposer may leave externally visible effects partly cleaned up, and a page reload can be the only safe application-level recovery; do not claim transactional rollback of DOM/network activity.

Transport via `loadScript` follows browser caching/CSP rules. A development server should serve reloadable scripts with `Cache-Control: no-store`. A single-file release can defer evaluation but not the transmission of its embedded code.

The loader neither parses ESM nor emulates native `import`/`export`. Its package is **a script asset**, not a Node ESM import API.
