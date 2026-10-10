# Independent local artifacts — experimental release boundary

This directory defines two **private, locally packed, individually versioned** artifacts, without registering any npm namespace, publishing, or changing RumiAI OS / `mk` / `pkg`:

- `rumiai-poc-jsc@0.0.0-poc.1`: classic-module compiler and optional assembler commands. **Contains no loader implementation.**
- `rumiai-poc-dynamic-loader@0.0.0-poc.1`: self-contained classic runtime script. **Contains no compiler code.**

Both names and the version are **PoC-only**. They are *not* finalized public package identities or compatibility guarantees. Both archives are built by copying current source files into temporary staging trees, then running local `npm pack` (no publication or network).

From `pocs/062-jsc-dynamic-loader`:

```sh
npm run build:packages
npm run test:distribution
```

Tarballs are written to `distribution/dist/` unless a destination is passed directly to `distribution/build.mjs`.

Offline consumer usage from an otherwise unrelated project:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund \
  /path/to/rumiai-poc-jsc-0.0.0-poc.1.tgz \
  /path/to/rumiai-poc-dynamic-loader-0.0.0-poc.1.tgz
./node_modules/.bin/jsc ./modules.json ./compiled.js
./node_modules/.bin/jsc-assemble ./modules.json ./bundle.js \
  ./node_modules/rumiai-poc-dynamic-loader/loader.js
```

To use separate scripts in a browser, first include/copy `node_modules/rumiai-poc-dynamic-loader/loader.js`, then `compiled.js`. The compiler artifact requires only Node.js 22+ on the **build machine**. A regular browser needs the loader script, **not** Node or npm. The optional assembler embeds the explicitly supplied loader and the compiled registrations in a single classic JS file.

The `tests/distribution.mjs` regression runs `npm pack`, installs both tarballs offline into a new temporary consumer outside the source checkout, executes the installed CLI, consumes the **installed** loader, checks manual registration, validates v1-to-v2 cleanup, rejects ESM without clobbering prior output, tests a missing-loader failure, and runs the one-file bundle. This validates packaging and the tested semantics, **not** a finalized stable public ABI, independent publish/release governance or compatibility across arbitrary historical versions.

The loader contract remains experimental: its global is `JscRuntime`, and `installBatch` commits definitions after disposal starts. An `onDispose` error cannot roll back external application effects. Applications must reacquire exports after replacement and choose a full reload when the prior state/resources cannot be safely recovered.
