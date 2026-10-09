# PoC 061 — Offline browser column editor and single-JS bundle

Status: Active experiment (not a promoted RumiAI or m product contract)

## Question

Can an advanced browser text editor use an upstream editing engine while exposing a self-contained one-file JavaScript library that also works in local HTML and later in a secure Electron renderer? Can the existing mk lifecycle delegate the bundling step without a new mk-specific JavaScript compiler?

## Prototype

- CodeMirror 6 supplies text model, multiple selection ranges, rectangular drag selection, history and search keybindings.
- A small browser-only ES module exports an embeddable editor API.
- esbuild emits one IIFE JavaScript file, including the upstream code and runtime CSS styles; the demo HTML is a consumer and not part of the library.
- A version-2 mk.json uses the existing generic process action to delegate to npm/esbuild; this is declarative orchestration, not a new mk provider.
- demo/index.html can be opened as a local file after building. No Node, Electron, server, CDN, remote module or external CSS is required at browser runtime.

## Build and run

On a development machine with Node.js/npm and a one-time network-capable dependency install:

```sh
npm install
npm run build
npm test
```

The browser interaction test uses Playwright Chromium, which must be installed once:

```sh
npx playwright install chromium
```

The above installation requirement applies only to building/testing, not using the resulting dist/editor.js offline.

Once m runtime and selected npm tooling are prepared:

```sh
mk --plan build
mk build
mk check
```

Those mk commands are intended interfaces to validate separately; the presence of mk.json does not claim they have been exercised here.

Open demo/index.html directly. Alt+drag creates rectangles; the button switches ordinary drag into column selection.

## What is measured

1. Actual dependency installation, JS bundling and syntax checks in a hosted runner.
2. Exactly one dist/editor.js, with no separate CSS, chunks or worker assets.
3. Real headless Chromium loading the local file with no development server.
4. Mouse rectangle spanning multiple text lines, typed replacement, undo, multiple independent instances.

A successful result validates this limited prototype, not feature completeness, performance on huge files, tab/Unicode/virtual-space fidelity, full native file integration, mobile support, Electron packaging or mk runtime execution.

## Other candidates and legacy evidence

- Monaco has a columnSelection API and may be a better choice when its richer programming IDE capabilities outweigh workers/asset packaging.
- Ace provides a standalone embeddable editor and multiple cursors; the exact rectangular UX still needs hands-on comparison.
- The old m/cmd/jsc + jsc.js had a JSON-ordered concatenation model, but its Java API references, dynamic eval namespace construction and limited module handling make it unsuitable for adoption unchanged.
- The old m/js/lib/ui-text-edit/m/text/TextEdit.js already has multi-range text insertion and an explicit columnMode flag. This deserves targeted regression-style experiments but is not yet validated as a production editor.
- The old Electron prototype is not a security baseline; a future host must isolate its renderer and provide narrowly scoped file APIs.

## Next

Inspect hosted results, remedy real failures, test rectangle semantics (short lines, tabs, Unicode, CRLF and clipboard), and compare Monaco/Ace before choosing the durable engine or any general mk extension. Preserve all licenses in derivative binary distributions.
