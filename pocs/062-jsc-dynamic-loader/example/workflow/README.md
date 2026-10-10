# jsc + dynamic loader: working example

This is an **experimental**, dependency-free consumer workflow for classic JavaScript modules. It exercises the compiler and the **independent** loader, not ESM or a production-ready package.

From `pocs/062-jsc-dynamic-loader/`:

```sh
npm run demo:workflow
```

The command builds the demo, starts a local HTTP preview on `127.0.0.1:8787` and prints these pages:

- [Development](http://127.0.0.1:8787/dev.html): `loader.js` and `initial.js` are distinct; `optional.js` is **not downloaded** until you select *Carica modulo opzionale*.
- [One-bundle release](http://127.0.0.1:8787/release.html): `bundle-all.js` contains the **unmodified independent loader** and all three module registrations. The optional code is already downloaded, but its factory **is not evaluated** until selected.

In either page: select the optional-module button, click *Usa modulo*, select *Applica patch v2*, then use it again. The patch is produced by a **separate jsc compilation** and loaded with `JscRuntime.loadScript('./patch.js',{expect:'optional'})`. The previous module's registered click handler is removed via `module.onDispose`; the UI obtains the new exports using `require('optional')` again. The running document is not reloaded.

Generate files without opening a server:

```sh
npm run build:workflow
```

Output in `example/workflow/dist/`:

| File | Purpose |
| --- | --- |
| `loader.js` | Independent runtime, copied without modification |
| `initial.js` | `jsc` registrations for core + app |
| `optional.js` | Separately compiled first optional module |
| `patch.js` | Separately compiled replacement v2 |
| `bundle-all.js` | One classic JavaScript file containing loader + core + app + optional v1 |
| `dev.html`, `release.html`, `client.js` | Ordinary application demo UI, **not part of the distributable module library** |

You can independently use the compiler on another classic manifest:

```sh
node src/jsc.mjs example/workflow/modules/base.json /tmp/initial.js
```

Then load the **independent** `src/loader.js` before the compiled registrations. The runtime interface currently used by the PoC is `JscRuntime`: `installBatch`, `require`, `revision`, `invalidate`, `remove` and browser-only `loadScript`. This is experimental, not a promoted public release API.

Tests:

```sh
npm run test:core
npm run test:workflow
```

The second command uses an actual Chromium browser (set `CHROMIUM` to override its path). It checks the development page makes **one on-demand GET** for the optional module, the bundled release makes **zero** optional GETs, and both successfully load the compiled patch with a single active click listener.

**Limits:** a single bundle delays optional **evaluation**, not transmission. Physically deferred network transfer requires separate scripts. `loadScript` depends on correct server caching policies (the local preview sends `no-store`); a production deployment needs release-coherent, hashed assets. Existing captured exports are not automatically updated after replacement. Modules must register their own cleanup; a throwing disposer may require a full page reload. The compiler **does not accept or reinterpret ESM**, and this PoC is not yet an installed `m` command or production library.
