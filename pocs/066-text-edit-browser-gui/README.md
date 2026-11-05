# PoC 066 — browser GUI on TextEdit 0.8.2

This experiment exercises rendering, viewport, pixel hit-testing, font metrics, scrolling, keyboard input and mouse/drag using the **existing TextEdit library**. It deliberately contains no alternate document or selection engine.

## Experimental Document2D presentation-unit contract (not product API)

Open [presentation.html](presentation.html) after compiling the actual m core browser script as described below. This is a **separate experiment** alongside `document2d.html`; the established TextEdit 0.8.2 GUI and the actual `RawDocument2D` and `CellDocument2D` sources remain untouched.

The page's **document composer** wraps the real `RawDocument2D` in a PoC-only proxy that changes **only** its public `getRegions` *presentation response*: one `kind:'text'` region per UTF-16 code unit, preserving each exact `region.text`, and an illustrative optional `displayText` for isolated surrogate halves, combining marks and TABs. It forwards the real public selection, editing, reading, revision, subscription and lifecycle methods. This is **not** the behavior of product `RawDocument2D.getRegions` today: the real product currently returns bounded aggregated Raw text runs and its permanent tests explicitly cover that contract.

The same renderer accepts this experimental Raw view, real `CellDocument2D` over it, and an additional nested Cell. It reads only the resulting public `Document2D` `getRegions` / `getSelections` / `setSelections` / `insert` / `subscribe` surface. It never inspects the backing source, calls `Intl.Segmenter`, interprets UTF-16 units or switches on the implementation type. Its visible unit spans use browser-measured font advances; pointer and keyboard navigation use only published region boundaries. Actual source text appears **only** in the separate diagnostic probe, to verify that display placeholders did not corrupt it. Rendering `displayText` (if present) does not alter `getRect`, selected `read`, source edits or `region.text`.

The PoC deliberately tests one physical row with `A😀Be\u0301\tZ`. Raw presentation uses independent `H`/`L` diagnostic placeholders for the emoji's two UTF-16 surrogates and a dotted-circle prefix for an isolated combining mark. The Cell view recomposes the actual emoji and combining grapheme, and its TAB occupies columns through the next stop. The same real Flat/Piece source supports genuine mouse click, caret arrows and single-character editing. The auxiliary Chromium test `tests/presentation-browser.mjs` exercises both backends and three modes, exact-data preservation, real composed Cell resegmentation, visual span non-clipping and actual keyboard/mouse behavior.

### Canonical GUI/Document2D contract pilot (G01)

`canonical-gui.html` and `canonical-gui.js` are a separate browser
prototype that composes actual `RawDocument2D → CellDocument2D` (and
optional nested Cell/Annotation/Fold/Substitution) **without any
`getRegions` modification or compact-transport codec**. Its renderer
receives only the outermost nominal `Document2D`, uses public region
boundaries, supports the existing TAB advance and displays annotations
as zero-width overlays. The source is visible only to a separate
diagnostic probe, never to renderer code. The existing transport
experiment pages remain untouched.

`tests/canonical-gui-browser.mjs` exercises real Chromium on the
unmodified pinned jsc-compiled core across Flat/Piece × five views.
It asserts whole ZWJ/combining graphemes, tab width, unchanged
aggregated Raw, synthetic regions, DOM geometry and source preservation.
G01 is initial-display acceptance. G02 adds pointer hit-test, valid
whole-region caret boundaries (including multi-column TAB), left/right
navigation and simple-key `insert`, still using only the outermost
`Document2D`. Its separate real Chromium test checks source revision,
one content notification and actual repaint on Flat/Piece.
G03 adds a targeted real `Delete` key attempt against one published
visible unit and verifies the public view's rejection of protected
Substitution content. Fold marker click rejection and strict left/right
caret boundary behavior are driven by real mouse/arrow events; a separate
diagnostic public `Document2D.replace` batch mixes an otherwise valid
edit with a protected span to prove atomic refusal on Fold/Substitution.
Zero-width Annotation is compared against actual DOM pixel positions;
the annotation remains non-interactive metadata.
`tests/canonical-protected-browser.mjs` covers Flat/Piece × three
synthetic views on the unmodified, compiled core. This remains scoped G03
evidence, **not** complete deletion/selection/IME behavior. G04
scrolling/viewport and physical-host acceptance remain open.

### G07 Ubuntu 26.04 ARM64 reference-VM validation

**The operator's Ubuntu 26.04 ARM64 VM is the primary reference host.**
The ordered real-validation policy is in `rumiai-dev/TESTING.md` and
`PHYSICAL-TESTING.md`: (1) operator Ubuntu 26.04 ARM64 VM;
(2) operator Ubuntu 24.04 or 26.04 x86_64 VM; (3) macOS 27 ARM64.
Virtualization is expected and never an automatic rejection condition.

From an existing PoC checkout on the Ubuntu ARM64 VM:

```sh
git -C rumiai-dev-PoCs pull --ff-only
sh rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/tests/g07-ubuntu-arm64.sh
```

The launcher verifies guest Ubuntu 26.04/aarch64, records the
virtualization type when detectable, uses the installed **system Chromium**
headful when a GUI session exists and native headless otherwise, and
never requires bare-metal hardware. Headless browser tests are real
on-host evidence for the exercised properties, **not** proof of a
window manager, compositor or Electron integration.

With native `git`, `node` 22+, `npm`, `python3` and installed Chromium,
the runner creates disposable checkouts, compiles the pinned real
`rumiai-os@c453b5764fec8403571125ea62107ae072a823a1` core,
resolves and records the exact PoC revision before testing, and runs
the G01/G02/G03/G04/G06 suites plus native browser pixel/screenshots.
`RUMIAI_G07_POC_SHA` may explicitly pin a committed PoC revision;
`RUMIAI_G07_CHROMIUM` selects a nondefault Chromium executable.
No sudo, user product checkout mutations or automatic upload.

Results remain locally under `~/rumiai-g07-<UTC-timestamp>/` (or
`RUMIAI_G07_REPORT_DIR`): host/revision/mode metadata, `status.txt`,
per-suite logs and five screenshots. A `PASS` requires executing every
declared suite on this actual reference VM; unrun platforms remain
`PENDING`. `rumiai-tests` owns formal evidence per `PHYSICAL-TESTING.md`.
Do not treat a GitHub runner with a similar OS label as this VM.

### G07 Ubuntu x86_64 reference-VM validation

After the successful scoped ARM64 browser run, the next ordered reference
host is the **operator's Ubuntu 24.04 or 26.04 x86_64 VM**. Its separate
launcher is `tests/g07-ubuntu-x86_64.sh`. **Do not run this stage on
`vmdev`**: that named Ubuntu 26.04 reference VM is **ARM64 (`aarch64`)**
and its scoped G07 browser validation has already passed. A shell prompt
or checkout path alone does not establish the host architecture.

First identify and enter the **separate x86_64 reference VM**, then verify
its architecture before launching the test. The hostname of that second
VM has not yet been established in this workstream; do not infer that it
is `vmdev`. From the parent directory of the PoC checkout on the
verified x86_64 machine:

```sh
uname -m  # must print x86_64; otherwise stop on this host
git -C rumiai-dev-PoCs pull --ff-only
sh rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/tests/g07-ubuntu-x86_64.sh
```

If the actual second host is not available, leave its G07 result PENDING;
neither an ARM64 rerun nor generic hosted CI substitutes for it.

This accepts the named Ubuntu guest versions with native x86_64 Node.js
22+ and installed system Chromium, and records the actual guest,
virtualization, browser session and exact pinned product/PoC revisions.
It runs the same six real-browser suites and captures local logs and
screenshots in `~/rumiai-g07-x86_64-<UTC-timestamp>/` by default.
`RUMIAI_G07_CHROMIUM`, `RUMIAI_G07_POC_SHA` and
`RUMIAI_G07_REPORT_DIR` have the same meanings as on ARM64.
A generic hosted-CI smoke test can validate launcher mechanics but
**cannot** establish a PASS on the operator's x86_64 VM.
macOS 27 ARM64 and Electron are separate pending work.

### G06 canonical renderer boundary and 0.8.2 comparison

The canonical GUI remains a **separate PoC-only page**.
`canonical-region-renderer.js` owns public `Document2D.getRegions` /
`getSelections` → DOM glyph, annotation, selection and caret geometry.
`canonical-gui.js` owns the composed view lifecycle,
mouse/keyboard gesture interpretation, bounded paging and diagnostics.
The renderer does not inspect Flat/Piece/Raw/Cell identities, source offsets,
backing objects or Unicode segmentation.

In the scoped behavior shared with TextEdit 0.8.2, unshifted left/right
arrows collapse a selected range and Shift+left/right extends or reverses
a **whole-unit, same-row selection**; the canonical renderer paints the
selected interval using public region boundaries. This does **not** add
drag, rectangle, multiline, IME or system clipboard equivalence.

`tests/canonical-parity-browser.mjs` drives **both actual
browser GUI pages** in hosted Chromium using the original TextEdit 0.8.2
and the pinned real compiled `Document2D`. The old GUI uses source
UTF-16 caret columns while the canonical GUI uses visual cell columns;
the test checks **the same physical source result** across those
different coordinate spaces. It records unimplemented disparities
rather than asserting full GUI parity.

**Developer reproduction**: check out `rumiai-os` with
`rumiai-dev-PoCs` nested under `rumiai-os/src/rumiai-dev-PoCs`.
From the `rumiai-os` root run:

```sh
node lib/sys/js/jsc.lib.js lib/sys/js/core/modules-js.json lib/sys/js/core/document2d-browser.generated.js
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/canonical-gui.html`
and sibling `index.html` in separate browser tabs. The original
0.8.2 GUI remains unchanged. Revisions and CI must be read from the
specific workflow run rather than assuming the current HEAD was exercised.

### G04 canonical bounded-viewport prototype

The same `canonical-gui.html` page now has `basic`, `long`
(>100,000 UTF-16 code units) and `many` (1,200 rows) fixtures.
The actual renderer requests at most 3 rows by 100 columns from the
outermost existing unmodified `Document2D` per paint, mounts only
these rows, and preserves whole indivisible regions crossing an
edge. Real vertical wheel and PageUp/PageDown page row windows; Shift
+ wheel pages columns. Arrow left/right query a single exposed cell
to find the whole token and can move into a different window, while
up/down use valid public row boundaries. This is **logical paging**,
not a browser-native proportional scrollbar or a benchmark for
full-row `getRowWidth` complexity. The latter remains a known
nonindexed source method, used only to clamp horizontal navigation.

Rapid reconfiguration cancels pending animation frames and guards
the generation; old document views are destroyed and detached.
A diagnostic probe may modify the *retired physical source* solely
to test that it cannot repaint the newly selected view. Neither
the renderer nor user input receives the physical source.

`tests/canonical-viewport-browser.mjs` drives real Chromium mouse,
keyboard, edits, source invalidation and reconfiguration on Flat/Piece.
The current file-loading/IME/full scrollbar and reference physical-host
capabilities remain outside this PoC work unit. The execution plan
and authoritative task state live solely in
`rumiai-dev/handoff/browser-column-editor.md`.

### Generic incremental and direct Cell packers (strictly experimental)

The current published `Document2D.getRegions` interface returns complete
detached region arrays; the existing PoC `presentation-transport.packRows`
first requests all exposed units. To evaluate direct production without a
public interface change, two **explicitly separate** PoC candidates are
being compared.

The generic `presentation-bounded.js` producer requests a sequence of
small bounded `getRegions` windows on the **actual composed views**. It
incrementally appends original regions to compact records, handles whole
indivisible regions repeated at chunk edges and preserves ordered zero-width
annotations. It never builds the full expanded result for the total window,
but each chunk still allocates normal `getRegions` objects and transformed
Cell views may repeatedly rescan from row start. Thus it is not true
zero-intermediate-object direct production.

The `prepare-cell-packed-candidate.mjs` script modifies **only a disposable
copy** of the pinned real `CellDocument2D.js`. A PoC-specific
`__pocPackRegions` method consumes the actual private `#scanRow`
visitor and directly accumulates compatible `cells` pairs, leaving the
normal public method and original product intact. The scanner itself still
allocates its internal cell records. This instrumentation proves a narrower
Core Cell path and is not a general direct API for Fold/Substitution.
Results of browser tests must explicitly distinguish the two paths.

`tests/presentation-bounded-browser.mjs` uses the exact pinned real
jsc-compiled core with **both experimental changes staged on a disposable
copy**. It checks parity of the original expanded units, generic
bounded-chunk packing and direct scanner packing, across Flat/Piece,
Unicode+TAB fixtures, nested Cell, Annotation, Fold and Substitution.
A separate bounded real Chromium heap/timing comparison measures
24 retained windows over long real `PieceDocument` content. The GUI's
existing renderer continues consuming the old format: the candidate's
byte/heap improvements are not evidence of full host/pixel parity.


### Declared implicit Raw units and Shift+wheel paging (PoC-only)

This second Raw-only transport experiment keeps the **published** aggregated
`RawDocument2D.getRegions` exactly unchanged. `presentation-direct.js` can
emit an `unitEncoding:'utf16'` record: one exposed UTF-16 code-unit
boundary per occupied Raw column is declared by this encoding, instead of
serializing redundant per-unit `cells:[[i,i],...]` pairs. Sparse `glyphs`
keep the same diagnostic presentation of surrogate halves, marks, controls,
and ZWJ as the existing PoC. The codec validates row/column/text extents,
rejects unknown encodings and invalid glyph indexes, then reconstructs
the same whole visual units for the unchanged GUI. **This is a PoC-only
transport encoding**, not a public `Document2D` value/contract.

A Raw-only long-line GUI scenario lets a real Shift+wheel event move the
bounded 100-column reading window across a >100k UTF-16 source row. The
test verifies actual start/end cell columns, exactly 100 mounted DOM
units, equality across expanded/paired/direct/implicit transport variants,
and editing after moving the viewport.

`tests/presentation-sparse.mjs` compares the true compiled Raw/Piece
source, 24 retained 4096-column results for the five format modes,
Chromium DevTools JS heap sampled before, immediately after evaluation
and after GC, and Linux child-process-tree RSS from `ps` with a 25-ms
sampled high-water. RSS sums **double-count shared mappings**, sampled
high-water can miss transients, post-evaluation heap is not a guaranteed
within-operation peak, and timings are not calibrated throughput. Hosted
Chromium x64 and these outputs are experimental, not physical reference
host validation. Direct compact production for transformed Cell views
remains outside this experiment.

### Direct Raw compact producer and real Chromium heap benchmark (PoC-only)

A new direct Raw-only producer in presentation-direct.js reads bounded, aggregated
regions from the real RawDocument2D and creates the existing experimental
cells/glyphs compact format *without constructing per-UTF16-unit region objects*.
It is not a new product API; the GUI consumes the same public region decoder
and exposes a Raw-only 'direct' experiment selector.

The Playwright presentation-direct.mjs test compares current aggregated Raw,
expanded units, expanded-then-packed, and direct packed output over a real
PieceDocument with long mixed Unicode/TAB content (128/2048/4096-column
windows). It checks reconstructed glyphs and exact columns, equal actual DOM
rendering, pointer/arrow/typing and invalidation. Chromium CDP measures
post-GC JS heap before and after retaining 24 window results in a *fresh
page for each method/width*, with descriptive timings and UTF-8 payload
sizes. Results describe **retained JS heap**, not peak/transient allocation,
process RSS, calibration-grade speed or physical Ubuntu ARM64 validation.
The GUI additionally verifies a Raw-only long mixed-Unicode source row
(>100000 UTF-16 units), confirming exactly 100 mounted unit spans and one
row across all three transport modes with identical visible geometry.
The 4096-column data benchmark does not mount 4096 DOM spans.
Only the Raw-specific direct producer is evaluated; composing a direct
Cell/Annotation/Fold/Substitution producer remains open.

### Compact unit-boundary transport — browser consumer experiment

The `presentation.html` page now has a transport selector (**explicit regions** /
**compact boundaries**) and a text fixture selector (**basic** / **mixed Unicode**).
Both expose the exact same real `Document2D` chain and GUI behavior; only the
outermost experimental `getRegions` response differs. The candidate codec is
`presentation-transport.js`, which runs in this PoC and is **not a published
Document2D interface**.

For consecutive contiguous ordinary text regions, the document-side encoder
combines the original `text` into a run, retaining an ordered `cells` array
of **[relative end-column, UTF-16 end-index]** pairs and a sparse `glyphs`
array for display-only overrides. TAB, annotated zero-width overlays, fold
markers and occupied substitutions remain **separate, indivisible records**
with the original extent and metadata. A run crossing an annotation or
synthetic region is never merged. The GUI only decodes the explicitly
supplied boundaries and uses `text.slice()` on supplied offsets; it does
not segment Unicode, inspect concrete view types or derive editability from
a `kind`. Source `region.text`, `read()`, `replace()`, selections, revision
and invalidation semantics are unchanged.

`tests/presentation-compact.mjs` compares the **actual Chromium DOM and
public visible behavior** across the two transports, for both real Flat/Piece
backends, all six Raw/Cell/nested/annotation/fold/substitution modes, and
both input fixtures. The mixed fixture includes UTF-16 surrogate pairs,
combining marks, TAB, control characters and a ZWJ emoji sequence. The test
exercises actual clicks, arrow navigation, insertion, source preservation,
protected-edit rejection and synthetic-overlay metadata. A separate bounded
benchmark on a real long mixed-Unicode PieceDocument reports UTF-8
serialisation sizes and descriptive `performance.now()` timings. These are
not measured resident heap, stable throughput targets or production runtime
claims; absolute latency and memory require later controlled validation.

### Real Chromium compact-format outcome and ZWJ composition blocker

The **same GUI** now consumes the experimental compact format rather than
merely comparing serialized object sizes. CI [41841068874](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/41841068874)
passed on the actual pinned jsc-compiled core, headless Chromium 141,
Ubuntu 24.04 x64. The new `tests/presentation-compact.mjs` compares
**24 real-browser initial-state combinations**: six Raw/Cell/nested/annotation/
fold/substitution view modes, two Flat/Piece backends and two fixtures
(including combining marks, control code, TAB, emoji and ZWJ). It also
exercises actual mouse+keyboard editing, source text preservation,
annotation/fold/substitution metadata, and atomic protected-edit rejection.
The compact decoder reconstructs **only explicitly provided boundaries**;
it does not segment Unicode or inspect whether the document is Raw or Cell.

A separate real 105000-UTF-16-unit PieceDocument benchmark at a bounded
2048-column viewport measured UTF-8 JSON serialization sizes:
Raw expanded **212214 bytes**, Raw packed **42349 bytes**; Cell expanded
**143901 bytes**, Cell packed **44423 bytes**. These are byte counts of
**JSON payloads, not resident memory** or production transport. The
timings use uncalibrated `performance.now()` samples and are *descriptive
only*. They exclude whole-GUI steady-state memory, OS and physical host
metrics. The packed producer itself still materializes the expanded
regions first; the experiment therefore proves transport/consumer
feasibility and size savings, **not a reduction in underlying engine
allocation cost**.

**Confirmed, unresolved composition mismatch:** on the pinned real
core, `CellDocument2D` over **ordinary aggregated** `RawDocument2D`
publishes `👩‍💻` as one grapheme. When its input is instead the
experimental **one-UTF-16-unit-per-region** Raw projection, it publishes
`👩‍` and `💻` as two cells, even though the source and all concatenated
display text are unchanged. The existing scanner flushes after every
incoming text region and can prematurely commit a grapheme before seeing
the next surrogate code unit. Thus the compact format has proven
**faithful to upstream region boundaries**, but the *proposed atomic Raw
region contract is not composition-safe with the present Cell scanner*.
The PoC test makes that mismatch observable and explicitly does not
claim whole-ZWJ grapheme correctness. Do not promote the atomic Raw
`getRegions` shape into the canonical `Document2D` specification or
product until this issue is corrected and covered by real product tests.
The experimental `cells`/`glyphs` wire fields likewise remain
candidate-only, with no product/API authorization inferred from CI PASS.

### Compiled candidate composition (PoC-only)

The PoC also compiles a **disposable copy** of the actual pinned `m.text.document`
core with exactly one proposed `CellDocument2D.#scanRow` carry change.
`tests/prepare-grapheme-candidate.mjs` refuses to patch outside the
`text-edit-candidate-core/` temporary directory and verifies the existing
scanner line before replacing it. The original product checkout and generated
standard browser core are not modified. The `jsc` compiler builds an
isolated browser script from the staged full core, and Playwright intercepts
**only the candidate test page**'s core-script request to load that script.

`tests/grapheme-candidate-browser.mjs` checks the actual composed candidate
with per-code-unit Raw presentation, both physical Flat/Piece backends,
full `Intl.Segmenter` comparison near 2048-column boundaries, nested
Cell/Annotation views, Fold/Substitution protection and single-commit editing.
It also exercises the unchanged GUI through real Chromium with the candidate
core and compact transport, including DOM emoji integrity, mouse/key input and
repaint. The candidate's results are *experimental changed-source evidence*;
none is proof of behavior shipped by `rumiai-os`. The existing unpatched
core and browser checks continue to run first and remain separate.

### Candidate UTF-16 streaming carry experiment (PoC-only)

The standalone Node experiment `tests/grapheme-stream.mjs` isolates
the current Cell scanner's incremental `Intl.Segmenter` flush policy.
The existing policy commits `👩‍` before seeing the low surrogate
of `💻`, incorrectly splitting a single ZWJ grapheme when
Raw presentation uses one region per UTF-16 unit. The candidate retains the
previous grapheme in the carry buffer **when the trailing code unit is an
unpaired high surrogate**. It compares complete-string segmentation with
the candidate's incremental output (text and UTF-16 offsets) for isolated
surrogates, combining marks, ZWJ emoji, flags, Indic text, and chunk
boundaries around 2048 columns. The same test checks that the old
incremental policy still reproduces the known failure.

This **only evaluates a streaming algorithm**, not the actual compiled
`CellDocument2D` integration or a general Unicode conformance
guarantee. It neither changes canonical Raw `getRegions` nor
adopts a compact payload. Actual composed Document2D browser tests and
direct packed-producer heap/DOM measurements remain necessary before
the candidate can be promoted into the product.

### Synthetic regions and bounded-output benchmark (experiment extension)

The same `presentation.html` renderer also accepts real composed
`CellDocument2D → AnnotationDocument2D` and optional real
`FoldDocument2D` or `SubstitutionDocument2D` wrappers, still using
only the public `Document2D` surface. The fixture uses
`A😀Be\\u0301\\tZ\\nHIDDEN\\nTAIL`, one zero-width annotation,
a protected whole-row fold or an occupied `LONG` substitution.
The GUI renders whole synthetic regions independently of their internal
text and positions annotation markers without adding occupied columns.
`tests/presentation-contract.mjs` checks real DOM clipping, surviving
source text, protected `replace` rejection and successful source edit
and subsequent redraw for both Flat/Piece physical backends.

A **descriptive, not calibrated** benchmark inside the same browser
runs bounded windows of 128, 1024 and 4096 columns starting well inside
a 100000-unit real `PieceDocument` line. Each run compares:

- current aggregated real Raw `getRegions` output;
- proposed one-UTF-16-unit-per-region PoC projection with exact `text`;
- an alternative experiment-only compact object retaining the exact
  source run with an explicit array of unit-boundary offsets.

The benchmark uses median of nine `performance.now()` samples after
three warmups and reports JSON *character counts* as a serialization
proxy—not resident memory, wire bytes, production latency or a new API.
No time-speed ratio is asserted because hosted CI timing varies. Each
bounded window is verified for exact text equality and column extent.
The contract decision still requires comparison on realistic non-ASCII,
synthetic regions and large rendered viewports before product promotion.

**Decision boundary:** This validates an experimental *candidate* public presentation contract, not a new accepted API. In particular `displayText` is a provisional name and plain isolated spans may or may not suffice across browsers. Any promotion requires agreement on the visual-unit and synthetic-region semantics, Unicode diagnostic representation, bounded-output cost, current-spec/test changes, and product authorization. The current `Document2D.getRegions` contract remains in force until that work.

## Separate browser integration on the real Document2D core

The additional [document2d.html](document2d.html) page does **not** change
the existing TextEdit 0.8.2 GUI. It exercises the current
`m.text.document.Document2D` public surface and the **real**
`FlatDocument` / `PieceDocument` backends, with the composed chain
`RawDocument2D → CellDocument2D → AnnotationDocument2D → CellDocument2D`
and one final `FoldDocument2D` or `SubstitutionDocument2D`.

The browser page loads a temporary classic script generated by the
product's **actual `jsc` compiler**. From the `rumiai-os` checkout
containing this PoC under `src/rumiai-dev-PoCs`, generate that script:

```sh
node lib/sys/js/jsc.lib.js lib/sys/js/core/modules-js.json lib/sys/js/core/document2d-browser.generated.js
```

Then serve `rumiai-os` as described below and open
`http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/document2d.html`.
The generated output is test/development-only and must not be committed
to the product; no browser bundling/distribution contract is introduced.

The new page is deliberately a small, independent GUI integration
boundary: it reads bounded `getRegions` / `getRect` windows,
converts the view's text regions into visual cells, forwards edit and
caret operations through the **public `Document2D` API only**,
and subscribes to `view.subscribe`. Every
`invalidation:{all:true}` rebuilds the entire bounded viewport from
the **new** coordinate revision, even when the event includes precise
old/new endpoint `geometry`. The display does not use source offsets,
edit annotation labels, infer a partial invalidation, retain a
fold/substitution after an upstream revision, or install another
effective selection owner.

The controls exercise initial render, bounded DOM rows, caret and
keyboard input, one source commit for an allowed edit, protected marker
and occupied-region rejection, external hidden edits, annotation-only
reconfiguration and conservative full invalidation.

`tests/document2d-browser.mjs` uses **actual Chromium** with the
**jsc-compiled real product core**, including DOM content, displayed
regions, selection/caret, revision and event correspondence on both
physical backends. The PoC 066 GitHub workflow pins the exact
`rumiai-os` revision, builds the temporary classic core output and
runs the new test alongside existing 0.8.2 GUI tests. Its runner is
pinned to Ubuntu 24.04 because the existing Playwright 1.56.1 does
not support chromium download on GitHub's new Ubuntu 26.04 x64 image.
That auxiliary CI run is **not** physical GUI validation on Ubuntu
26.04 ARM64, macOS or Electron.

This experiment does not claim full editor integration, advanced
pointer/keyboard mappings, 100,000-row performance for Document2D,
IME, accessibility completeness, arbitrary source provenance,
persistent anchors or production rendering policy. The original PoC
066 main GUI and its 100,000-row fixture remain unchanged.

## Launch

The local checkout layout is `rumiai-os/src/rumiai-dev-PoCs`, not sibling repositories. Serve `rumiai-os` as the local web root:

```sh
cd /path/to/rumiai-os
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/`.

The script loads `/lib/sys/js/text-edit.lib.js` from the containing `rumiai-os` checkout through `../../../../lib/sys/js/text-edit.lib.js` and checks the real `TextEdit.VERSION === '0.8.2'`. No remote CDN, npm package or bundler is required to run the demo. A modern browser with `Intl.Segmenter` is needed.

## In scope

- DOM rows bounded to the visible viewport, line numbers, vertical/horizontal scroll, fixed line height and bounded line-prefix reading
- Grapheme-boundary pixel hit-testing measured through browser DOM Range, with explicit rejection when the measured shape is ambiguous
- Carets and selected-range overlays over the actual view
- Click and drag selections; Alt+drag rectangle through `TextEditAdvancedSelections`; edge drag auto-scroll
- Arrow keys, Shift+Arrow, Home/End, PageUp/Down, Ctrl/Cmd+A, Backspace/Delete, Enter, Tab and ordinary direct key text through `TextEdit.replace()`
- Monospaced/proportional font switch for actual browser font-geometry testing; text and selections remain unchanged
- Two-way `Larghezza naturale` versus `Griglia a celle` PoC: native browser advances versus measured one/two-or-more-cell grapheme spans on the SAME source document
- Grid cell width comes from measured ASCII zero advance in the selected font; CJK/emoji start with two logical cells while glyphs too wide for the current font fallback reserve additional integer cells; decomposed accents remain one grapheme, tabs go to the next logical four-cell stop. The GUI feeds this candidate policy to the existing `TextEditRepresentation.setColumnMetrics({tabSize,widthOf})`
- Pixel hit testing and drawn selections map directly to grapheme source boundaries in either mode; grid DOM spans are disposable view fragments, not source mutation
- If a rectangular drag intersects a partial wide grapheme/tab and `TextEditAdvancedSelections` rejects it, the GUI retains the previous valid selection and warns; it does not silently split text or invent another selection owner
- Native scrollbar dragging must not create or extend text selections
- A 100,000-line fixture and an observable `window.__guiProbe.snapshot()`

## Separate 2D representation-element experiment

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/regions.html` (also linked from the main editor). This **separate browser page** explores a deliberately minimal axis-aligned rectangle model over the same stable TextEdit 0.8.2 library; it does **not** replace the working GUI or introduce new product exports.

- A tab spans three cells at tab stop four and maps to a single real source `\t`.
- A folded region spans six display cells on one projected visual row while mapping to three hidden physical source lines, using a real `TextEditRepresentation.setReplacements` overlay.
- A source-less annotation occupies four cells across two visual rows and is anchored using real `TextEditRepresentation.setAnnotations`.
- Each region can be configured as unselectable (`none`), selected on any overlap (`touch`), or selected only upon complete coverage (`full`). Ordinary ASCII/grapheme cells use the same experimental overlap rule. Configurable rules are proof-of-concept only, not new TextEdit APIs.
- A requested grid rectangle is **not** itself rendered as an effective selection. Only resolved, selected whole regions receive highlighting. Real source-backed regions are translated to physical source ranges, merged and given to the existing `TextEditSelections` owner; no overlapping physical target is duplicated. Visual-only regions can be selected for highlighting but provide **no physical edit target**.
- The replace action uses only the actual `TextEdit.replace()` facade. Selecting never modifies source content. A selected fold may replace a multi-line source interval; its overlay is invalidated normally on committed edits. Test reset restores the original fixture.
- A genuine Chromium regression explicitly compares selection past EOL with `TextEditAdvancedSelections` in `clipped` mode, proving the same *requested geometry versus effective selection* distinction already exists in the stabilized engine. It does not claim to implement a generalized source/view-row mapping or reuse the advanced selector to resolve the new region policies.

The geometry resolver is intentionally local to this PoC. Current TextEditRepresentation has source-mapped **linear** overlays/annotations and source-row metrics, but lacks generalized multi-row view layout and region selection rules; current TextEditAdvancedSelections retains its existing selection-policy contract. This experiment does not answer overlapping-region precedence, caret/navigation inside fold placeholders, editing visual-only regions, arbitrary shapes, viewport virtualization for thousands of projected regions, or semantics of user-configurable presets. The 2D page handles a tiny deterministic fixture only. Do not promote it to a product API or claim full browser editor integration based solely on these tests.

## DOM-independent 2D region experiment (2026-10-15)

The current PoC isolates the previously browser-local 2D region *fixture projection* and selection resolution in `region-geometry.js`. The script works as a classic browser dependency for `regions.html` and as CommonJS source for the independent Node test; its exposed `__regionGeometryPoC` name is **experiment-only**, not a proposed `m` API. `regions.js` still owns all DOM, pointer events, action feedback and actual publication to `editor.selections`. The new source is view-independent: it receives a real TextEdit document and representation, produces visual row/region descriptors, resolves `none`/`touch`/`full` coverage, and returns ordinary physical selections without storing or modifying them. Actual source commit remains exclusively in `TextEdit.replace()`.

The extraction deliberately retains the PoC's **fixture-specific** fold marker, annotation placement, source-interval merging and vertical array order. In particular, coalescing *adjacent* source intervals is observable in this PoC but is **not** a decided general policy for overlapping or source-aliased 2D regions. Reusing the existing `TextEditRepresentation` metrics, overlays and annotations avoids duplicating text, while `TextEditAdvancedSelections` remains the current owner of established source-grid rectangle/line policies. The precise generalization and composition boundary for arbitrary visual regions is still a design question; this fixture module must not be promoted as an API just because its tests pass.

The new `tests/regions-headless.mjs` exercises the **actual pinned TextEdit 0.8.2** under Node, including TAB coverage policies, folded source ranges, source-less highlights, physical interval deduplication, bottom-up/reverse physical selection order, consecutive selected edits and fold invalidation. The existing `tests/regions.mjs` continues to exercise the complete mouse/DOM/browser adapter against the same extracted logic on real Chromium. GitHub Actions runs both suites. Headless region testing is not proof of Firefox/Ubuntu physical validation and the small fixture is not a bounded arbitrary-size 2D viewport.

Open questions for subsequent architecture work: arbitrary region overlap and priority, mapping visual-only region highlights versus editable text selections, source-order versus visual-order conflicts, generalized source-to-view rows and folding navigation, invalidation without full re-projection, and bounded region generation for huge source documents. No new selection kind, input mode, text mutation path, clipboard policy or production module identity was introduced.

## Configurable oriented-selection input and cursor behavior

Both browser pages expose an **opt-in** reverse-grapheme input checkbox, initially off. A selected payload is reversed **per physical selection** whenever that selection's explicit `forward` is false. The operation does not inspect whether the selections originated from a rectangle, an ordinary linear mouse drag or other constructors. `Intl.Segmenter` reverses complete Unicode grapheme clusters independently within each line; existing LF, CR and CRLF separators keep their positions. Disabling the checkbox leaves the payload's characters unchanged, but does not rewrite the selection's orientation.

- All selection APIs produce one ordinary ordered `{start,end,forward}` collection owned by `TextEditSelections`. There is no saved selection-kind flag or persistent rectangle identity. A rectangle constructor assigns entries in the requested vertical row traversal order and `forward` from the horizontal direction. `lineSelection()` creates a single forward selection regardless of endpoint order. `virtual` and `clipped` remain separate high-level **selection construction** policies, not input policies.
- The production TextEdit 0.8.2 selector atomically replaces all selected ranges, retaining each selection's index and `forward` while collapsing it to a caret. **Forward** caret results appear after their inserted text; **reverse** caret results are placed at its beginning (after any virtual padding). Consecutive single-grapheme key input therefore inserts successive characters to the *left* of a reverse caret without special reverse-typing mode. For bulk reverse insertion, enable the checkbox to reverse the full grapheme sequence as well.
- The GUI's one-value-per-selection array accepts entries in current selection order, not document row order: a bottom-up selection receives the first array entry at the bottom. The PoC commands require array count to equal the number of physical targets and show immediate validation errors/success feedback; the underlying TextEdit selector has its own documented normalization rules.
- In the 2D regions page a visual-only annotation has no source selection and cannot be edited. After a successful edit of source-backed regions, their highlights clear, but the physical selected carets remain and can be used for subsequent replacements. Input direction depends only on those physical carets.
- Reversing **each multi-grapheme payload** remains PoC-local input-adapter behavior: the TextEdit engine does not permute input content, record a gesture's origin, or implement clipboard/IME. Direction-aware caret positioning and always-forward line selection are the stable TextEdit 0.8.2 engine behaviors protected by permanent tests.

## Operator-visible replacement feedback (2026-10-14)

The browser GUI now shows the current physical selection count and the current newline-delimited array-entry count **next to the replacement buttons**, with visible inline errors and success confirmations. The main GUI begins with one valid insertion caret but the sample array contains three entries; the array action therefore rejects this mismatch **without modifying the document** until the operator provides exactly one entry per physical selection. Both pages include a versioned script URL to avoid confusing a newly updated HTML view with an older cached GUI script.

The 2D region page deliberately begins with no editable source target, so both replacement buttons are disabled with a nearby explanation until a source-backed region is selected. Selecting a visual-only annotation does not authorize source replacement. After a successful edit, the highlighted 2D region selection clears, but the underlying oriented physical carets remain valid and the replacement buttons stay available so that consecutive editing works without reconstructing the original gesture.

New real Chromium tests click both button types, confirm the initial mismatch is reported within the viewport, exercise successful replacements, verify initial disabled/no-source conditions and enabled post-edit carets, and protect all previous editor interactions. The 2D geometry is still experimental and the new TextEdit 0.8.2 caret contract is exercised.

## Deliberately excluded

History/undo, files, clipboard, remote collaboration and IME. Composition events are ignored rather than claimed supported. This is not an implementation of native browser text input or an accessibility-complete editor.

The grid policy is *experimental*: it tests measured font fallback, fractional pixel advances and logical-column matching. A font-family or mode switch changes representation metrics, not document characters or effective physical selection coordinates. It is not a final East Asian Width / emoji / bidirectional-text contract; unsupported layouts and text over the current per-row projection bound remain explicit limits.

The 100,000-line fixture intentionally includes the Unicode suffix `😀e\u0301` every 97 rows, including row 50,053 (1-based). The gutter stays inside each DOM row, not in an independently scrolling column.

The current experiment intentionally refuses ambiguous RTL/complex shaping, limits editable long-line prefixes to 1,024 UTF-16 units and uses a fixed 24 px row height and no wrapping. It is not a performance guarantee or MadEdit-Mod parity claim. Test these constraints before promotion into a product GUI contract.

Provisional PoC code and trial results stay here; permanently adopted behavior must be promoted into canonical contracts and tests in their respective repositories.
