# PoC 063 — large-document text engine and column-editing transactions

Status: **experimental; no selected product architecture**. Owner: rumiai-dev/handoff/browser-column-editor.md.

## Try the real browser engine locally — hands-on experimental demo (2026-10-10)

The small human-facing demonstration is under [demo/index.html](demo/index.html) with [demo/app.mjs](demo/app.mjs). It uses actual **PieceDocument + TextEditSelections + external planColumnPaste** from this PoC, a simple browser textarea projection and a separate in-memory one-action-per-undo controller. This is a **hands-on experimental UI**, not the future large-file viewport renderer or a promoted product API.

From a shell with Python 3 and a current checkout:

```sh
cd pocs/063-large-text-engine
python3 -m http.server 8763 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8763/demo/** in Chrome/Chromium or another modern browser. The initial editable document is:

```text
aa
b
```

Try these representative manual operations:

- Type a character directly; **one keystroke gives one undo entry**, accessible with Cmd+Z (Mac) / Ctrl+Z or the buttons. Redo with Cmd+Shift+Z / Ctrl+Shift+Z or the button.
- Click **Aggiungi cursore** using default row **2** and UTF-16 column **0**, then type `Q`. Both selected caret positions receive the character, and a single undo restores both positions. The extra carets are listed, **not visually painted over the textarea**.
- Restore the sample and click **Inserisci a colonne** using the prefilled rectangle and the four rows `X`, `Y`, `Z`, `W`. The result is `aaX\nb Y\n  Z\n  W`: two physical lines are appended beyond EOF, and one undo restores `aa\nb`. The rectangle is chosen through numeric controls; actual drag-to-make-rectangle is **not implemented**.
- Restore the sample; click **Arma incolla da clipboard** and then perform a real Cmd+V / Ctrl+V with your multiline clipboard text in the focused editor. The browser's real `paste` event flows through the same external column planner.
- Load or save a small local text file using the controls; the document is **not automatically persisted**. Try ordinary selection, text paste, Backspace and Enter.

Run this from an **HTTP loopback server**, not a `file://` URL, because browser ES modules need resolvable MIME types and standard same-origin behavior. No npm dependencies or cloud services are required. The development checkout itself can of course be obtained from the GitHub repository.

Deliberate **256 KiB demo cap**: the textarea still holds and redraws the whole document, so testing gigabyte files in this UI would misrepresent the engine's performance. For performance/memory, use the isolated command-line benchmarks. Unicode width is supplied by a simplistic experimental view function; arbitrary font/pixel geometry, visual multiple-carets, native rectangular mouse dragging, cross-browser IME sequences, and MadEdit-Mod GUI parity remain open. `demo/` is a PoC UI adapter only and does not modify `TextEditBase`, `TextEditSelections`, core document methods, undo persistence, or canonical project architecture.

The real-Chromium CDP driver in `tests/browser-input.mjs` also visits this **same hands-on page** and exercises actual keyboard input, undo/redo, browser pointer clicks on controls, two-caret editing, interactive column button paste and real OS/browser clipboard Ctrl+V, while the existing browser IDB test remains independent. These checks are on the actual browser DOM and real PoC model, not simulated editor implementations.

### Native pointer rectangle candidate (2026-10-11)

The interactive browser PoC now supports **real pointer-drag rectangle creation** on the textarea, either by enabling **Seleziona rettangolo col mouse** or by holding **Alt/Option** during drag. A lightweight clipped highlight follows the pointer. On release, browser pixel coordinates are converted to oriented document rows and candidate visual columns, checked through the existing DOM-independent `probeRectangles`, then copied into the external column planner's four input fields. Column insert and genuine Ctrl/Cmd+V from the clipboard still use the **unchanged** `planColumnPaste` and selection layer. Reverse/upward drag direction and scrolled textarea coordinates are preserved, and the pointer gesture alone makes **no document edit and no undo entry**.

Important correctness boundary: pointer-to-column mapping is a deliberately provisional **monospace/ASCII plus tab** browser adapter, not a generic pixel/glyph geometry contract. Hit testing **refuses** rows with Unicode/complex glyphs and columns falling *inside* tab stops rather than silently editing the wrong character; use the manual numeric rectangle fields for Unicode cases under the existing view-supplied width policy. The overlay is only a visual/column-planner preview, **not an extra canonical selection store**; `TextEditSelections` owns actual selections when the planner executes the paste. The UI still redraws the complete textarea and is still capped at 256 KiB. No multi-caret overlay, generalized Unicode/font geometry, native MadEdit GUI parity, drag auto-scroll, or gigabyte viewport efficiency is claimed.

The real Chrome CDP regression in `tests/browser-input.mjs` dispatches **physical mouse move, press, drag and release** on the human-facing demo, including the button mode, modifier-based Alt/Option drag, reverse orientation, overlay geometry, actual planner paste, OS clipboard paste and one undo. It additionally checks refusal of ambiguous tab cells/Unicode pixels and actual vertical scrollTop row translation. The original browser input and IndexedDB scenarios remain independent and continue to execute.

## Independent visible-row / Unicode DOM-layout experiment (2026-10-11)

A **second** browser page, [demo/viewport.html](demo/viewport.html) ([demo/viewport.mjs](demo/viewport.mjs)), is accessible from the original human-facing [demo/index.html](demo/index.html). Serve the PoC root with the same local `python3 -m http.server 8763 --bind 127.0.0.1` command and open **http://127.0.0.1:8763/demo/viewport.html**. This is a distinct, explicitly experimental **limited editor adapter**, not a replacement for the working textarea/column demo and **not** a promoted product/API.

The new DOM-independent `src/viewport-probe.mjs` takes an indexed `PieceDocument`-compatible text store, vertical scroll offset, viewport height, row height and overscan, and returns **only bounded visible row slices** (maximum 512 UTF-16 source units for each line); it does not own selections, rendering, clipboard semantics, undo/history or actions. The browser projects those rows into a fixed-height, no-wrap scrolling DOM using line-height 24px. Loading a generated corpus with **200,000 physical rows** retains the indexed document in the core, but not 200,000 DOM nodes; navigating to a far-away row and editing near that viewport with the **actual `TextEditSelections`** and an outer single-action undo/redo wrapper are possible. The separate “2 MiB line” fixture deliberately clips display content, **rejects click-to-edit in that truncated row**, and never puts the 2 MiB text in DOM. Initial loading still builds the entire JavaScript input string and its newline index in RAM; this is **not streaming file I/O** or bounded total document memory.

Unicode pointer hit testing on short, fully rendered rows is measured against the **actual browser text layout**: `Intl.Segmenter` determines grapheme boundaries and collapsed DOM `Range` measurements provide candidate pixel x positions at those boundaries, including tabs, surrogate pairs, combining marks and ZWJ emoji. The nearest **grapheme boundary**, not an arbitrary UTF-16 code unit inside a grapheme, becomes the canonical one-caret selection. Boundary positions that Chromium measures as **nonmonotonic or indistinguishable** are rejected; this does **not** prove all bidirectional or complex shaping cases are detected or correct. Pixel mapping does not redefine the DOM-independent `probeLine` or clipboard planner, and does **not** guarantee correct RTL/bidi editing, variable-font clusters, wraps, multi-selection painting, IME, full-native keyboard input, horizontal giant-line scrolling or production accessibility. The dedicated viewport page uses **separate insertion/delete buttons** after mouse selection instead of claiming a complete IME or input pipeline; edits and undo act on the same underlying experimental text/selection layers.

Actual evidence at PoC revision with linked viewport page `a8520036c0050d2d1562a7b78e608506c4f2b557`: [Actions 38091271091](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38091271091) **both core and real Chromium/IndexedDB jobs PASS**. In real Chrome, a 200,000-row corpus with a far-away row selected mounted **27 DOM rows** and read **595 UTF-16 units** in that one measured projection, then passed insert/undo and Unicode pointer checks (emoji surrogate pair, combining sequence, ZWJ sequence). A hosted Node v22.23.3 scan of **600** dispersed viewport positions used at most **27 rows**, **594 payload units**, **22 UTF-16 units per individual underlying slice** in the particular generated corpus, and took **18.38 ms total for that single 600-projection run**; it also verified a 2 MiB *unselected* long row was truncated in data projection. These numbers are exploratory, runner-specific observations, **not** browser frame-time, memory-use or arbitrary-document guarantees. The separate Chrome giant-line fixture verified a real **2,097,152-unit ASCII line**: only **512 units** were exposed in the DOM and pointer editing on the clipped row was refused. [Actions run 38091386569](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38091386569) passed **both** hosted core and real-Chromium/IndexedDB jobs at documentation revision `38b5ff2992f8abb7df5b50b91498256c1b741ed0`, following the verified giant-line browser code. The giant line is intentionally display-clipped and **not** a benchmark of fully editable selected 2 MiB Unicode lines.

The original `demo/index.html` remains the actual multi-caret/rectangle clipboard test, with its earlier small-file textarea cap. Both pages share real experimental backend modules. The new work adds only PoC 063 projection, browser UI and test code, without changing `TextEditBase`, `TextEditSelections`, the separate planner, product code, history persistence or cross-repository contracts.

## Questions

Can a self-contained JavaScript core (no DOM, framework or packages) support a general grouped-edit transaction with complete selection/caret snapshots? Is whole-string replacement an acceptable baseline for huge documents? What changes when edits use immutable reference chunks in an indexed sequence?

## Source-grounded MadEdit-Mod behavior

Inspect the upstream [MadEdit.cpp](https://github.com/LiMinggang/madedit-mod/blob/master/src/MadEdit/MadEdit.cpp), [MadUndo.h](https://github.com/LiMinggang/madedit-mod/blob/master/src/MadEdit/MadUndo.h), and [README](https://github.com/LiMinggang/madedit-mod/blob/master/README). These are reference evidence, **not** a requirement to clone the upstream implementation:

- In GetColumnDataFromClipboard, the AutoFillColumnPaste path repeats the *original* newline-delimited clipboard input until the destination selection row count is covered. Both README v0.2.9 and the source describe this as option-dependent, not unconditional behavior.
- InsertColumnString computes virtual horizontal padding in spaces and records multiple insert/overwrite primitives in one undo unit; the recorded caret position is not sufficient evidence that upstream undo saves full multi-selection state.
- The README still lists partial loading of huge files as incomplete. No large-file performance claim for MadEdit-Mod follows.

The corpus at fixtures/column-cases.json labels cases by evidence: source-verified cycle-fill, partial source-backed virtual padding, and explicitly *hypothetical* excess-row/blank-fill policy. These are **not** claims of complete Excel/CSV compatibility. No native MadEdit-Mod GUI execution was performed.

## Implementations and known limitations

- src/documents.mjs: FlatDocument uses one JS string; PieceDocument is an indexed sequence of immutable piece references in a deterministic pseudo-random treap. The tree stores cumulative UTF-16 lengths and newline counts, and each source chunk has an array of newline offsets for line navigation.
- src/transactions.mjs: transaction editing is expressed as sorted nonoverlapping original-document ranges; replacements apply right-to-left, and undo/redo group all edits and copy selection/caret *value* snapshots. The experimental column plan maps one source line to one target row, supports cycle/blank/once policies, and allows caller-supplied virtual padding.
- tests/run.mjs: 4,000 deterministic seeded insert/delete/replace mutations are cross-checked against FlatDocument, with random slices, line-start checks, source fixtures, multi-range grouped transaction, cursor/selection undo, redo, branching, and repeated history.
- benchmark.mjs: measures 500 random distributed insertions and 1,000 small random reads per document size. It reports process heap/RSS deltas but **does not** prove long-session retained memory use, file-load performance or guaranteed latency.

Important omissions: no lazy file I/O, CRLF logical-line model, grapheme segmentation/display-column geometry, IME, DOM renderer, piece coalescing, disk-backed undo history, persistent storage, huge (>4GiB) newline indices, cursor rebasing, or transactional failure rollback. All offsets are UTF-16 code units; the two candidate engines are exploratory, not production-ready. Randomized treap balancing has no fixed worst-case guarantee. The flat baseline may use V8 cons strings/deferred flattening and heap/RSS deltas are not precise object-retention measurements.

## Run

Use Node.js 22+ (no npm dependency, no network):

~~~sh
node tests/run.mjs
node --expose-gc benchmark.mjs 1 8 32
~~~

These runs are process-local and timing is host/Node/GC-dependent. For comparison use repeated isolated processes, same runtime flags, warmups where appropriate, and measure peak RSS/external memory and history growth separately.

## First isolated Linux VM run (2026-10-10)

Node v22.16.0, Linux x86_64, 5.8 GiB reported RAM. 4,000-edit parity test **PASS** (plus fixture and history checks). One exploratory run of 500 random local insertions, measured within-process (not comparative production evidence):

| Input | FlatDocument editing | PieceDocument editing |
| --- | ---: | ---: |
| 1 MiB | 313.35 ms | 9.48 ms |
| 8 MiB | 4,164.05 ms | 2.72 ms |
| 32 MiB | 15,437.23 ms | 2.35 ms |

A second process run at 1/8 MiB measured 254.86/3379.06 ms for FlatDocument and 8.13/3.61 ms for PieceDocument. These numbers are **illustrative only**: no statistical sampling, unequal initialization costs, different internal string representations, no forced full flattening after each edit, no history retention under the benchmark, and no cross-browser validation. In particular the reported near-zero heap/RSS deltas are **not** credible evidence that a 32 MiB document uses negligible RAM. The robust qualitative observation is that the tested sequence shows a steep size dependency for whole-string replacement whereas the piece implementation's local writes remained small; future fairer benchmarks must test both under long sessions and memory pressure.

## Second local Linux experiment — history and fragmentation (2026-10-10)

This is a repeatable experiment on the existing PoC 063 document and transaction implementations: Node.js v22.16.0 on Linux x86_64, independent processes per scenario, two explicit GCs per checkpoint, initial 2 MiB ASCII document. Values below are **absolute V8 process heap after GC**, not cumulative allocation or browser guarantees.

| Scenario | Operations | Heap after GC | Live tree nodes |
| --- | ---: | ---: | ---: |
| Mixed edits, no history | 12,000 | 12.919 MiB | 23,902 |
| Mixed edits, with history | 12,000 | 24.445 MiB | 23,902 |
| Append-only, no history | 36,000 | 17.973 MiB | 36,001 |
| Append-only, with history | 36,000 | 45.611 MiB | 36,001 |
| Mixed edits, with history | 24,000 | 42.623 MiB | 47,577 |

The implementation retains many pieces, source chunks and per-operation history objects. Even append-only inserts accumulate one new node/source each time. History includes separate forward/backward arrays and complete selection value snapshots per edit. The gap for 36k append-only operations was 27.638 MiB with history enabled (not a precise isolated allocation measure). This demonstrates **per-edit growth of these prototypes**, not a general theorem about piece trees.

**Probe: rebuilding the entire text as one piece after 16,000 dispersed edits.**

| Scenario | Heap before | Heap after | Live nodes |
| --- | ---: | ---: | ---: |
| No history | 15.165 MiB | 6.201 MiB | 31,848 → 1 |
| With 16,000 history entries | 27.818 MiB | 18.842 MiB | 31,848 → 1 |

300 undo and 300 redo steps after rebuilding passed the exact text-equality check. RSS did not shrink proportionally: V8 can retain reserved pages. **Whole-document rebuilding is only a diagnostic probe**, not an acceptable enormous-file compaction solution because it materializes the entire document. Any durable strategy needs incremental compaction, retention accounting and history-storage analysis.

Run from this PoC directory, with no external packages:

    node --expose-gc tests/history-memory.mjs piece no-history 12000 2 mixed
    node --expose-gc tests/history-memory.mjs piece history 12000 2 mixed
    node --expose-gc tests/history-memory.mjs piece no-history 36000 2 append
    node --expose-gc tests/history-memory.mjs piece history 36000 2 append
    node --expose-gc tests/compaction.mjs 16000 history
    node --expose-gc tests/compaction.mjs 16000 no-history
    node tests/clipboard-paths.mjs

The memory scripts emit JSON-line samples of heap, RSS, peak resident set, node/source counts and undo state. No browser, real disk-backed history or arbitrary-size file input has been tested by these measurements.

### Upstream clipboard-path findings

Reading MadEdit-Mod MadEdit.cpp (TranslateText, GetTextFromClipboard, GetColumnDataFromClipboard, InsertColumnString) reveals different semantics from the PoC's simple source-line mapping:

- Ordinary plain text counts one row when nonempty plus each CR/LF/CRLF terminator, and appends a terminal line break on the column-paste path; a trailing newline is an extra *empty source row*.
- MadEdit-Mod's dedicated column clipboard format stores its own line count; it must not be conflated with plain text and is not exercised by the tests.
- Auto-fill requires a selected destination, enabled option and strictly more destination rows than source rows; without that combination it does not repeat.
- The upstream insertion path can continue after the selected destination rows. The PoC columnPastePlan currently clips excess source rows to explicit targets. This is a **known semantic mismatch**, not validated MadEdit-Mod parity.

The new source-path characterization exercise is a *simplified model derived from source*, not a native GUI test. Full behavior, clipboard types, TSV/CSV parsing, virtual columns, Unicode and visual selection still need comparison against the real application.

## Incremental coalescing and compact history candidate (2026-10-10)

The original PieceDocument/History pair is retained as a control. Experimental additions:

- ChunkedPieceDocument (in src/documents.mjs) appends short inserted strings to a bounded (4,096 UTF-16 code-unit) mutable source chunk and merges adjacent pieces **only** when they reference contiguous ranges within the same source. It does not reconstruct the document or alter untouched original source chunks; large insertions retain independent sources. This is bounded-local join coalescing, **not** general fragmentation control or filesystem-backed partial loading.
- CompactHistory (src/compact-history.mjs) records each edit's original offset, deleted text and inserted text once. It stores one selection/caret snapshot per committed after-state plus the initial state. Undo derives inverse coordinates using accumulated length deltas and restores the prior snapshot. No fixed undo-depth cap is imposed. Selection ranges are copied as plain data, not yet a generalized 2D selection engine.

Tests (tests/variants.mjs) compared all three document variants across 6,000 seeded edits each, including Unicode, combining marks, tabs and CRLF; they checked text, slices, logical LF line indices and local coalescing. All six combinations of document and history variants passed 500 multi-range transactions with full undo/redo, selection restoration and redo-branch invalidation. The original tests/run.mjs and source-path clipboard test still passed. These are headless core tests, not browser/editor usability tests.

### Single-run isolated-process memory comparison

Node.js 22.16.0 on Linux x86_64, 2 MiB initial ASCII text, 36,000 one-transaction edits, explicit GC twice before each reported heap sample; *one process per scenario*. Memory is **absolute retained V8 heap after GC**, not the incremental allocation by the editor alone, and peak RSS is a process metric.

| Workload / pair | Retained heap | Live nodes | Live source chunks | Edit time |
| --- | ---: | ---: | ---: | ---: |
| Append / original pieces + original history | 45.679 MiB | 36,001 | 36,001 | 142.80 ms |
| Append / chunked pieces + original history | 34.966 MiB | 15 | 15 | 107.46 ms |
| Append / original pieces + compact history | 31.109 MiB | 36,001 | 36,001 | 138.06 ms |
| Append / chunked pieces + compact history | 20.400 MiB | 15 | 15 | 92.24 ms |
| Distributed mixed edits / original pieces + compact history | 41.859 MiB | 71,308 | 35,966 | 355.47 ms |
| Distributed mixed edits / chunked pieces + compact history | 34.334 MiB | 71,308 | 15 | 441.25 ms |

**Repeatability check:** three additional isolated processes per pair, same 36k/2-MiB input and explicit GC, reported retained-heap medians: original/original append **45.670 MiB**, chunked/original append **34.973 MiB**, original/compact append **31.109 MiB**, chunked/compact append **20.402 MiB**, original/compact distributed **41.865 MiB**, chunked/compact distributed **34.332 MiB**. The heap samples varied by less than 0.03 MiB within each scenario, while operation-time samples varied considerably; therefore use these figures only as *this Node/V8 workload's* memory comparison, not a general latency ranking. Peak RSS also reflects allocator/platform behavior and is not proportional to retained heap.

For the append workload the combined approach reduced retained heap by about 55% relative to the original pair, and live nodes by 99.96%. **Neither result generalizes to dispersed edits**: the distributed workload still contains 71k nodes and the added boundary checks increased editing time in that isolated run. Long-lived history also grows with the number of transactions, even in the compact journal. The two history implementations preserve selection snapshots in the tested cases; this does not prove safe persistence, failure-atomic updates or memory-bounded unlimited undo.

Run independent comparisons (avoid comparing heap of multiple variants within one process):

    node tests/variants.mjs
    node --expose-gc tests/compare-memory.mjs piece original append 36000 2
    node --expose-gc tests/compare-memory.mjs chunked original append 36000 2
    node --expose-gc tests/compare-memory.mjs piece compact append 36000 2
    node --expose-gc tests/compare-memory.mjs chunked compact append 36000 2
    node --expose-gc tests/compare-memory.mjs piece compact mixed 36000 2
    node --expose-gc tests/compare-memory.mjs chunked compact mixed 36000 2

Future validation needs repeated samples, additional Node/browser versions, large deletions, arbitrary multi-range stress, Unicode geometry, streaming I/O, incremental compaction for dispersed edits, compact selection and history encoding, memory caps and potentially disk-backed history. Source-chunk counts exclude chunks referenced only by journal copies; this PoC's undo data holds JavaScript strings, not references to original source slices. Performance timings here are illustrative and have no pass thresholds.


## Bounded distributed-edit repacking and external journal (2026-10-10)

This is experimental work; the original text/history controls remain available.

- LocalRepackDocument rebuilds only a bounded region near each edit; it reduces nodes but retains too much copied text in some workloads.
- AdaptiveRepackDocument repacks a small neighborhood (default 256 UTF-16 units each side) only when it contains ten or more pieces. This is a *local candidate* rather than an accepted editing model; untouched faraway text is not materialized by repacking.
- CompactHistory now accepts a journal-storage port (length/read/appendAt). ArrayJournal is the default in-memory implementation; the external adapter is independent.
- adapters/node-file-journal.mjs is a Node-only PoC adapter with UTF-8 journal payloads and fixed 16-byte disk index records. It holds no resident JS array of history entries/offsets and supports redo-branch truncation, random reads, close and reopening existing files.

Real headless checks: tests/repack-journal.mjs passed 9,000 random text edits per repack variant, including Unicode, newlines, arbitrary slices/line starts and a large deletion; 750 grouped two-range transactions with every undo/redo and full selection snapshot; branch truncation, journal reopen/read and a simulated failed append preserving document/selection. tests/repack-memory.mjs checks SHA-256 of the entire resulting document and selection after 1,000 undo/redo operations per workload.

### Linux Node v22.16.0 isolated-process comparison

Input: 2 MiB ASCII document, 36,000 deterministic *dispersed* edits; three independent processes per scenario, two explicit GCs before each post-edit heap sample. Medians:

| Text / history | V8 heap after GC | Live pieces | Peak RSS | Editing time |
| --- | ---: | ---: | ---: | ---: |
| Chunked / RAM | 34.716 MiB | 71,308 | 93.133 MiB | 529.97 ms |
| Adaptive / RAM | 28.947 MiB | 19,780 | 94.957 MiB | 551.91 ms |
| Chunked / file | 19.440 MiB | 71,308 | 93.258 MiB | 619.70 ms |
| Adaptive / file | 13.672 MiB | 19,780 | 93.258 MiB | 732.98 ms |

The file journal retained all 36,000 edit records in 6.324 MiB on disk. The combination reduced **retained V8 heap by about 60.6%**, and live document piece count by **72.3%**, compared with the chunked/RAM case on this workload. It **did not** proportionally reduce peak process RSS; the file-journal path also has noticeable I/O cost. No latency or memory guarantee for browsers or other hosts follows. Full per-run data and machine identity are in sessions/repack-journal-20261010.json.

Run from the PoC directory:

    node tests/repack-journal.mjs
    node --expose-gc tests/repack-memory.mjs chunked array mixed 36000 2
    node --expose-gc tests/repack-memory.mjs adaptive array mixed 36000 2
    node --expose-gc tests/repack-memory.mjs chunked disk mixed 36000 2
    node --expose-gc tests/repack-memory.mjs adaptive disk mixed 36000 2

### Limitations — explicit non-completion boundaries

The file journal is **not crash-atomic**: redo truncation, append and document mutation are not one durable transaction. File synchronization is explicit, not automatic; the journal alone cannot reconstruct a restarted document/session. No corruption recovery, concurrency locking, disk quota/eviction, checkpoints, browser IndexedDB/OPFS adapter, or async transaction protocol is implemented. The per-record 32-MiB limit is a PoC guardrail rather than an accepted specification. Synchronous Node I/O belongs solely to this test adapter, not to a future browser core.

Adaptive repacking reduces piece count under this dispersed workload but may retain underused ranges of shared source chunks. It does not solve huge-file lazy I/O, memory accounting of fully retained undo/selection history, visual Unicode geometry, actual native MadEdit-Mod paste, or browser viewport/IME performance. No product/runtime repository was modified.

## Generic asynchronous history persistence (user-fixed direction, 2026-10-10)

**Fixed task-local boundary:** Persistent history is essential, but its storage medium is external to the text engine and selected through an adapter. A local file, a browser persistence API (e.g. IndexedDB or OPFS), an application host bridge and a remote persistence service are possible providers. The text core must not import Node filesystem or browser persistence APIs. **Crash resistance, atomic durable transactions, recovery of interrupted writes and storage-corruption handling are explicitly out of scope now**; do not make them the next blocking work item.

New experimental modules:

- `src/async-history.mjs`: a separate Promise-based `AsyncHistory` candidate with injected storage operations `count()`, `read(index)`, `appendAt(index, record)`, `readSession()`, `writeSession({initial, cursor})`. These are PoC names, not yet product APIs. It preserves complete recorded caret/selection snapshots and grouped edit transactions.
- `adapters/callback-journal.mjs`: generic callback adapter for an application-supplied asynchronous persistence service; has no Node or browser dependencies. A provider may implement those callbacks using browser storage or network services.
- `adapters/node-async-file-journal.mjs`: genuine asynchronous Node filesystem implementation of the **same port**, separate from the engine. Existing synchronous `NodeFileJournal` remains historical benchmarking evidence and is not required by the new candidate.
- `tests/async-adapter.mjs`: exercises 160 two-range transactions on both FlatDocument and AdaptiveRepackDocument via a simulated asynchronous external service. It recreates a new editor against the original base text, restores journal and cursor state, checks every undo/redo and selection, persists an undone cursor, reopens, replaces a redo branch, and verifies a rejected append leaves the active editor unchanged. It also verifies clean close/reopen using the real asynchronous Node file adapter.

Run from this PoC directory:

    node tests/async-adapter.mjs

**Limits of demonstrated persistence:** A normal reopen currently replays every journal entry from a caller-provided *original/base document*, so startup cost grows with the history size. No persisted document checkpoint or browser-native/HTTP provider has yet been tested. The service adapter test uses an in-memory *simulation of an external service*, not evidence of real network or browser storage behavior. On-disk tests use Node's real filesystem; they do not claim crash recovery. Journal records are stored externally and are not all loaded into the core heap for normal undo/redo; replay still traverses all prior entries on reopen. Persistence service choice and buffering/backpressure policies remain to be measured for large histories.

The new async port is deliberately additive: older synchronous `CompactHistory` / `NodeFileJournal` benchmark paths remain usable for comparisons. Moving actual browser UI editing to Promise-based commit calls and designing latency-aware execution are future experiments, not yet validated public behavior.

## Browser IndexedDB adapter and asynchronous latency experiment (2026-10-10)

The **generic Promise-based history journal remains the persistence boundary**. Browser, file and service-specific APIs are never imported by the text/history core. These are PoC-only candidate interfaces, not a product API selection.

- adapters/indexeddb-journal.mjs implements the existing count/read/appendAt/readSession/writeSession port using real browser IndexedDB, integer-keyed records and a cached scalar record count. Redo branching deletes future records through a key range. Single-writer assumption.
- tests/browser-idb.html, tests/browser-idb-scenario.mjs and tests/browser-indexeddb.mjs implement an HTTP-origin real-Chromium test. 800 grouped two-range transactions are written, then three *new Chromium processes* on the same user profile verify complete text/selection, 60 undo/redo, reopened undone cursor, redo-branch replacement, and a final new-process reopen. The test measures browser commit and open latency if it can execute.
- tests/reopen-cost.mjs measures ordinary clean-session replay using the actual asynchronous Node file adapter; tests/storage-latency.mjs models an artificial delayed provider to isolate the cost of storage roundtrips, not real network latency.

### Auxiliary Linux measurements

Node v22.16.0, Linux x86_64, small initial two-line text repeated 80 times, separate single runs; GC explicitly called before heap samples. Normal clean-session reopen *requires N individual journal reads and N text edits* from a caller-supplied original document; no checkpoint replay acceleration is implemented.

| Journal entries | Real Node file-adapter reopening | V8 heap after reopen + GC |
| ---: | ---: | ---: |
| 250 | 47.41 ms | 4.437 MiB |
| 1,000 | 98.71 ms | 4.503 MiB |
| 2,500 | 737.82 ms | 4.607 MiB |

These timing samples are noisy, not statistically sampled, and are *not* browser/IndexedDB results. Absolute V8 heap on these small texts is not a RAM guarantee for huge files.

In the separately simulated service adapter, 100 serial commits took 4.35 ms with zero artificial latency and 888.55 ms when each callback introduced 4 ms delay. The existing AsyncHistory awaits *two storage writes per commit* (append and session update) and reads every record on reopen; 101 records with the 4-ms delayed simulated service took 586.16 ms to reopen. Concurrent commits are rejected, not queued. This is a real limitation for a responsive foreground editor and motivates testing foreground edit decoupling, batching/backpressure and normal-session checkpoints, without tying the text core to any particular persistence backend.

**Browser verification:** the local auxiliary container's Chromium launches, but its administrative policy blocks navigation to loopback URLs (net::ERR_BLOCKED_BY_ADMINISTRATOR). On independent GitHub Actions Ubuntu/Chrome, however, real IndexedDB browser integration **PASSED** at exact PoC revision `c515028d88e0067b30fece678e80f4596e09af61` ([run 38050510920](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38050510920)); the separate Node core test job also passed. The browser used four distinct Chrome processes sharing a profile: 800 grouped edits, full text/selection restoration, 60 undo/redo, persisted undone cursor, new redo branch and subsequent restart. In that single hosted run, the first reopen of 800 edits took 294.4 ms; later reopen samples were 296.5 and 305.8 ms; IndexedDB commit mean was 0.826 ms, with p95 1.20 ms. These are revision-specific measurements, not cross-browser, cross-device or statistical latency guarantees. The browser harness was corrected to await real asynchronous completion through Chrome DevTools Protocol rather than capturing an early virtual-time DOM snapshot; preceding failed runs represented the test driver returning `pending`, not validated IndexedDB failures.

Run from this directory:

    node tests/async-adapter.mjs
    node --expose-gc tests/reopen-cost.mjs 250
    node --expose-gc tests/reopen-cost.mjs 1000
    node --expose-gc tests/reopen-cost.mjs 2500
    node tests/storage-latency.mjs 4 100
    CHROMIUM_BIN=/usr/bin/chromium node tests/browser-indexeddb.mjs

Browser run requires working loopback navigation and an installed Chromium. By explicit user instruction, **crash resistance, interrupted-write recovery and storage atomicity are not current goals**. Browser GUI/IME, huge-document lazy I/O, history retention limits, and exact native MadEdit-Mod paste semantics remain unverified.

## Optional foreground history + external background persistence (2026-10-10)

**User-fixed behavior:** Persistence is optional. Editor text changes and undo/redo must never wait for ordinary persistence; file, IndexedDB, remote or service storage is implemented **outside** the editor. An explicit external synchronization request may await completed writes. The editor should only expose a very small generic interface, not own filesystem, IndexedDB, or service policy. Crash recovery and journal atomicity remain out of scope.

This checkpoint adds **candidate-only** modules without changing the previous `AsyncHistory` research baseline:

- `src/foreground-history.mjs`: `ForegroundHistory`, a synchronous reference history with a single optional `subscribe(listener)` notification interface. Each change emits either an append record with the cursor position or a cursor movement; text, grouped edits, undo/redo and complete selection snapshots are applied immediately.
- `adapters/background-persistence.mjs`: external `BackgroundPersistence` controller that consumes changes in order and passes them to the existing generic asynchronous journal provider. It owns a serialized queue, a readable `status` (pending/errors), an optional `detach()`, and an **external** `await flush()` call that waits only for changes issued at invocation time. It does not belong in the editor core and has no Node, DOM, network, or filesystem imports.
- `tests/background-persistence.mjs`: covers no-adapter editing, 160 fast foreground edits while a simulated provider is slow, cursor/selection undo/redo, explicit flush, ordered branch writes, reopen through existing `AsyncHistory`, a real asynchronous file adapter, and a failed persistence operation that does not cancel a user edit.
- Extended the real Chromium/IndexedDB test to add two further **independent Chrome processes** testing foreground edits plus external IndexedDB background persistence and normal reopen. The existing four-process IndexedDB integration test remains.

### Local benchmark scope

On this auxiliary Linux/Node v22.16.0 process, 160 sequential foreground edits finished in **7.87 ms** while the simulated external provider inserted a nominal **5 ms per storage call**. The explicit `flush()` subsequently took about **1709 ms**. This is a single scenario and a simulated slow service, *not a UI frame-rate measurement or a real network timing guarantee*. The foreground text and selections remained immediately available; after flush, an independent history reader reconstructed the exact text/state. Undo/redo and redo-branch replacement were verified. A storage failure was reported by `flush()` and `status.error`; the active text edit still completed.

### Known restrictions

This is a PoC **separation-of-responsibility probe**, not a complete potentially-unlimited low-RAM undo design. `ForegroundHistory` currently retains its entire undo journal in memory, independent of whether an external provider is attached. The external queue also has no memory/length cap, retry mechanism, checkpoint or recovery protocol: prolonged slow/unavailable storage can grow the backlog, and a failed write is visible but not recovered. A provider listener that performs heavy synchronous work can still block the caller; adapters must only enqueue synchronously and perform I/O asynchronously. The test controller currently attaches to an **empty** foreground history and empty provider. Background persistence of an already-running session and offloaded old undo entries remain to be investigated.

Do not silently turn an opt-in provider into an editor requirement, conflate ordinary background saving with explicit flush, or change the text core to wait for I/O. **No product implementation, crash-resistance work, or architectural selection is implied.**

Run from the PoC directory:

    node tests/background-persistence.mjs
    node tests/browser-indexeddb.mjs

## Optional archived undo with a small hot window (2026-10-10)

**User-fixed boundaries:** Persistence is optional and externally managed. Normal text editing and commits must never await routine storage. Explicit external synchronization may wait. Crash recovery, interrupted-write atomicity and corruption handling remain out of scope.

This is an additive **candidate experiment**, not a chosen engine. The new source module *src/spill-history.mjs* keeps a configurable recent window of undo records after an external component has acknowledged their storage. It has no Node, browser, file or networking APIs. An external persistence bridge supplies a generic archived-record reader and receives history-change notifications; *adapters/background-persistence.mjs* gained backward-compatible optional confirmation/reader hooks. Foreground text commits are synchronous. **Deep undo/redo of an evicted record can await an asynchronous cold read**, unlike routine background persistence.

The behavioral test *tests/spill-history.mjs* verified: with no provider, unlimited logical undo/redo remains entirely in RAM; with real Node async file storage and 16 hot records, all 900 records are archived and complete 900 undo + 900 redo preserve exact text and full selection snapshots, including multi-range transactions, a branch created after deep undo, and clean new-session reopening. Under failed storage writes, unacknowledged records remain resident and can still be undone or redone; errors remain visible to the external caller.

### Auxiliary Linux Node v22.16 measurements

Each 12k-edit case ran in a separate process on a 2-MiB initial document, with identical deterministic distributed edits, two ranges per selection, two explicit garbage collections before heap measurement:

| History mode | V8 heap after GC | Resident undo records | External journal | Peak process RSS |
| --- | ---: | ---: | ---: | ---: |
| Original foreground, no provider | 15.56 MiB | 12,000 | none | 68.13 MiB |
| Spill-aware, no provider | 15.84 MiB | 12,000 | none | 61.00 MiB |
| Spill-aware, async Node file, recent 128 | 10.76 MiB | 128 | 2.112 MiB | 79.12 MiB |

V8 heap decreased by about **30.9%**, while RSS did **not** decrease; the file case had higher observed peak RSS. Twelve explicitly awaited 1k-edit storage flushes took about **16.6 seconds cumulatively**, separate from approximately **243 ms of foreground commit processing** in that same single run. Timing is noisy and host dependent; none of these figures is a browser responsiveness or physical-host memory guarantee. The full text/document tree remains in RAM, only old history records are offloaded.

The real Chromium/IndexedDB workflow now has two additional process stages for 420 foreground edits with 12 resident records, complete deep undo/redo through genuine IndexedDB cold reads, and clean-process reopening. Check the exact hosted workflow result before claiming browser success.

To reproduce from the PoC root:

    node tests/spill-history.mjs
    node --expose-gc tests/spill-memory.mjs foreground 12000
    node --expose-gc tests/spill-memory.mjs no-provider 12000
    node --expose-gc tests/spill-memory.mjs file 12000
    node tests/browser-indexeddb.mjs

**Important limits:** While the provider is slow or unavailable, the background queue and unacknowledged in-memory entries can grow; this PoC cannot guarantee a fixed RAM ceiling without changing policy. Once evicted, deep undo needs the external record reader and can be slower. No automatic retry, batching, service-lifetime cleanup, checkpoint acceleration, huge-file lazy loading or crash recovery is implied. No permanent test or production editor implementation was changed.

## Visual column / 2D geometry experiment (2026-10-10)

The undo/redo **model** has sufficient experimental evidence to move on: grouped edits, full selection/caret snapshots, branching, optional external persistence, and hot/cold archive navigation have passed appropriate tests. This does **not** select a final implementation, nor validate action grouping and IME-level behavior in a real GUI. As explicitly requested, an external storage provider's sustained throughput is **not an editor problem**: asynchronous buffering absorbs bursts but cannot make a slower provider as fast as memory. Do not spend the editor workstream pursuing a false sustained-RAM/storage speed equivalence.

A separate candidate `src/visual-column-probe.mjs` explores 2D geometry without integrating storage policy or a view engine:

- Text positions are **UTF-16 offsets**, distinct from **visual cell columns** and extended grapheme clusters. `Intl.Segmenter` identifies graphemes; the **caller injects `widthOf(grapheme, column, row)`** rather than baking font, locale, emoji or East Asian width assumptions into the document. Tabs advance to the next configurable tab stop.
- `probeLine` measures a single logical line, handling CRLF as a line terminator and returning cell intervals; `locateColumn` returns an exact offset, an explicit EOL virtual-space count, or an **unresolved inside-grapheme** result with its two offset boundaries.
- `probeRectangles` translates multiple possibly disjoint rectangles into sorted text targets and reports unresolved glyph boundaries and overlapping/colliding selections separately. It **does not invent** snap-to-glyph, merge, virtual-selection or MadEdit-Mod paste policy. Ambiguous rows must not be applied silently.
- `tests/visual-column-probe.mjs` passed on `FlatDocument` and `AdaptiveRepackDocument`: tab spans, emoji surrogate pairs, combining marks, wide characters under an explicit injected width rule, CRLF, empty lines, virtual columns, collisions including nested overlaps, and one grouped 2D insertion with exact undo/redo selection restoration using existing `ForegroundHistory`.
- `tests/visual-column-scale.mjs` passed against a 32 MiB document with a massive intervening unselected line: two independent short selected rows caused **six slice calls totaling 13 UTF-16 units**, without reading that unrelated long line. This is **not** a benchmark for a selected huge single line or a full renderer.

Run:

    node tests/visual-column-probe.mjs
    node tests/visual-column-scale.mjs 32

**Open semantic decisions:** How a real view measures grapheme width and proportional-font/pixel geometry, handling caret placement inside tabs/wide cells, visual/virtual selection extension, overlapping multicursor ranges and clipboard-source overflow require observed behavior and explicit policy. A single selected extremely long line is currently segmented/materialized entirely: this candidate alone does not satisfy the huge-line performance target. MadEdit-Mod native GUI behavior remains unverified; the pre-existing `columnPastePlan` is still intentionally provisional and must not be labeled compatible for excess source rows. No editor product code or permanent tests were changed.

## Unified input, editor-owned selections and outer reversible-command controller (2026-10-10)

**User correction:** Cursors are **zero-dimensional selections owned by the editor**, not by the action/history wrapper. All physical keyboards feed one unified ordered input stream. Multiple independent editing keyboards and collaborative editing, including concurrency and synchronization, are out of scope and delegated to higher external layers. Persistence likewise remains external and optional.

An **additive PoC-only candidate** in `src/action-command-probe.mjs` explores this separation, without replacing previous benchmark evidence:

- `EditorCore` owns the document and selection ranges (`anchor === head` is a caret). Its only edit operation applies a validated, sorted, non-overlapping batch and returns exact overwritten spans and before/after selection snapshots. It has no undo/redo, history cap, storage, physical keyboard identity or collaboration policy.
- `ActionController` wraps the editor, interprets one ordered user input (`text`, `backspace`, provisional `pasteRows`) at a time, and builds both forward/inverse editor-compatible batches from the exact command result. It owns the optional history, configured undo depth, branching and notifications. Undo and redo use the same editor edit entrypoint but never append new history entries.
- `tests/action-command-probe.mjs` covers real `FlatDocument` and `AdaptiveRepackDocument` models: each separately typed character is one undo step, two physical-keyboard annotations still form *one* serial stream, one input across two carets is one undo, exact selection restoration, nonempty selection replacement with unequal span lengths, UTF-16 surrogate-pair Backspace, redo branching, three-row virtual-column paste sourced from existing `probeRectangles`, duplicate caret rejection, paste row mismatch rejection, optional undo limit, and rejection of a stale wrapper after an out-of-band document change.
- The failure test injects a `replace` that rejects **before mutation** during a multi-range batch. Earlier applied changes are rolled back, and no user action is recorded. This is a *conditional* transaction guarantee: a document primitive that mutates and then throws (or OOM conditions) does not have proven strong rollback semantics.

**Limitations:** `pasteRows` explicitly requires exactly one source row per selected target and is **not** MadEdit-Mod-compatible for overflow/autofill/CSV cases. Backspace handles one code unit or a surrogate pair, not full grapheme clusters. Real DOM keyboard events, IME/composition, visual hit-testing, source/target mapping, collaborative merges and native MadEdit-Mod GUI have **not** been tested by this headless action-object PoC. The class names and method shapes are experimental, not normative product APIs.

Run from this PoC directory:

    node tests/action-command-probe.mjs

Earlier `History`, `ForegroundHistory`, `AsyncHistory` and `SpillHistory` remain comparison artifacts, not approved product architectures. Do not reopen persisted-provider throughput work in the editor.

## Stepwise TextEditBase / TextEditSelections experiment (2026-10-10)

The current user correction establishes a **strict layering boundary**. The candidate `TextEditBase` is a **structural contract**, not a mandatory class: each existing `FlatDocument`, `PieceDocument`, and `AdaptiveRepackDocument` satisfies single-interval `length`, `slice(start,end)`, `replace(start,end,text)`. Base receives exactly *one* range per call and **has no selection, batch, undo, callback, clipboard, geometry, or direction semantics**. This experiment does **not** add batch mutation to the base contract.

`src/text-edit-selections-probe.mjs` adds a separate candidate `TextEditSelections` object composed over one such store. It owns user-configured ordered **oriented** selections (a zero-length selection is a caret), translates one string to every selection and maps an array of strings **one-to-one in the user's configured selection order** (not the physical offset order). Wrong array cardinality is rejected without editing. It maps the edit to separate single-interval `TextEditBase.replace` calls in reverse offset order. Disjoint targets only; duplicates/overlaps are explicitly rejected before any write. The result includes exact old/new fragments, original-coordinate edits, inverse coordinates, and selection snapshots for an **external** action/undo controller; there are no editor listeners or internal history.

**Direction is deliberately not predetermined.** A caller-provided policy receives the full oriented selection and target text. Two independent *illustrative* policies demonstrate distinct semantics for backward selections: (1) reverse the sequence of Unicode grapheme clusters in the inserted text while replacing the range; (2) insert the text at the range's right boundary, leaving selected text intact (rightward placement). Both preserve the selection direction after collapse, and neither policy is a `TextEditBase` feature. Other directional behaviors remain possible. Forward selections use direct replacement in this narrow test. No particular directional policy is approved for the product.

Column geometry remains another external step. The existing `probeRectangles` converts requested visual positions into target offsets and EOL virtual padding; the upper caller materializes spaces and per-target texts before invoking the selection layer. No `columnMode`, MadEdit autofill rules or clipboard format logic is embedded in either lower level.

`tests/text-edit-selections-probe.mjs` runs this candidate against the **actual three PoC document representations** in GitHub Actions: unsorted user selection order, string replication, array one-to-one mapping, backward direction policies, exact grapheme reversal (emoji and combining character), zero-length carets, 3-row column-style insertion with externally prepared EOL spaces, external inverse replay, invalid array count and duplicate/overlapping range rejection. Inputs are completely validated before the first write. A fault-injected backend that rejects the second single-range call demonstrates **no exceptional-failure rollback**: the first valid replacement remains, the exception reaches the caller, and no successful edit result or new selection state is returned. **This is intentionally not all-or-nothing failure atomicity**; a backend defect or memory exhaustion can leave an incomplete action, and any caller must treat the failed action as exceptional rather than record a completed undo. No browser DOM, real IME, real MadEdit-Mod clipboard, collaborative editing or persistence is validated by this new test.

Run from this PoC directory:

    node tests/text-edit-selections-probe.mjs

No permanent test or product change. The old combined `EditorCore` PoC and previous history experiments remain comparison references; these names/methods are not yet a canonical API.

## Defensive rollback overhead versus fast single-range editing (2026-10-10)

This is an **exploratory cost measurement**, not a requirement to keep defensive rollback or a pass/fail performance threshold. The user's primary constraint is extremely fast editing of large documents; a normal in-memory `TextEditBase.replace(start,end,text)` should not fail for valid arguments. Invalid input/ranges should be rejected before document mutation. Remaining failure modes include implementation bugs and resource exhaustion, where a second mutation during rollback can itself fail and strong atomicity is unproven. The base has **no** multi-selection/transaction/undo knowledge.

`tests/rollback-cost.mjs` compares three approaches on the same prepared edits and the **real** `FlatDocument`, `PieceDocument`, `AdaptiveRepackDocument`: (a) direct descending one-range replacements; (b) pre-reading each replaced span (normal information a separate undo controller may need), then descending replacements with no rollback; (c) the same old-text capture plus a `try/catch`, one inverse descriptor per successful edit and a rollback path that is inactive in the ordinary case. Backends and select counts vary, with 12 median samples after warmup and alternate strategy order. Timing excludes document construction, input setup, clipboard decoding, selection interpretation, UI rendering, GC runs outside timing, and keyboard/IME; percentages are observational, not universal.

The exact hosted run at revision `2e41017f2ff9eff94e18a6c8eabda9963a135f40` passed both CI jobs: [run 38074844243](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38074844243). Its Node v22.23.3 Linux x64 core job produced the following medians (milliseconds, 12 samples after warmup; 32/256 disjoint one-character replacements):

| Backend | KiB | Edits | Direct | Capture old | Capture + guard | Guard / capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FlatDocument | 256 | 32 | 4.375 | 4.416 | 4.454 | +0.9% |
| FlatDocument | 256 | 256 | 41.809 | 42.661 | 43.184 | +1.2% |
| PieceDocument | 1024 | 32 | 0.086 | 0.109 | 0.142 | +30.3% |
| PieceDocument | 1024 | 256 | 0.309 | 0.311 | 0.380 | +22.2% |
| AdaptiveRepackDocument | 1024 | 32 | 0.135 | 0.147 | 0.161 | +9.5% |
| AdaptiveRepackDocument | 1024 | 256 | 0.537 | 0.561 | 0.648 | +15.5% |

The guard adds a per-completed-edit inverse object/allocation plus exception handling. The difference is measurable on the faster tree backends, though **absolute deltas are sub-millisecond**; small microbenchmarks and runner variance do not imply stable production ratios. Capturing overwritten spans is a **different operation**, useful for optional external undo even when no rollback is attempted. FlatDocument's entire-string replacement cost dominates this comparison. The experiment does *not* establish what happens on an exceptional backend failure; its `try/catch` cannot guarantee recovery from mutate-then-throw or out-of-memory. No mandatory rollback or extra atomic batch method should be introduced in `TextEditBase` on the basis of this result. No product implementation changes.

Run from the PoC root:

    node --expose-gc tests/rollback-cost.mjs 12

## Speed-first selection editing, no exceptional rollback (2026-10-10)

Current experimental choice, after the measured cost comparison above: `TextEditSelections.replace` validates payload count/types, oriented direction plans, and all duplicate/overlapping/out-of-range intervals **before modifying the underlying document**. It captures old spans needed for an explicit result and potential externally owned undo, then invokes only one `TextEditBase.replace` per target, highest offset first. It does **not** allocate a per-completed-operation recovery journal or run rollback code when an otherwise valid base operation throws.

The updated `tests/text-edit-selections-probe.mjs` validates that (a) bad input/direction detected after another valid plan performs zero base writes, and (b) a backend fault during the second edit is propagated after exactly one earlier edit has succeeded, with no rollback attempt. The latter is an **exceptional, partially applied action**, not a completed transaction; a higher controller must not record it as successfully undoable and must decide how to recover/reinitialize if the backing store becomes unreliable. This policy deliberately favors a smaller, faster normal path over incomplete best-effort recovery from severe backend faults.

This change does not affect normal action granularity (a multi-selection paste remains one external user action on successful completion), nor add selection awareness to `TextEditBase`. Benchmarks are exploratory and do not imply a quantified speedup until the changed selection implementation itself is measured. Earlier rollback/failure tests in other additive PoC candidates continue to describe **those different candidates**, not the current `TextEditSelections`.

## Selection-layer hot-path comparison (2026-10-10)

`tests/selection-hotpath.mjs` measures the **current rollback-free `TextEditSelections.replace` end-to-end method** with 32–2048 disjoint selected one-character replacements, using the same real `FlatDocument`, `PieceDocument` and `AdaptiveRepackDocument` backends. Its control performs the same single-range replacements directly on the base after capturing overwritten data. The selected path additionally validates selection identities, orientation policies, text-to-selection mapping, builds result snapshots, and computes inverse coordinates. It deliberately uses **reverse user selection order** to exercise association mapping, not only naturally sorted offsets.

Results are comparative exploratory medians after warmup, without a speed threshold; file size and target counts vary by backend. Document initialization and GC are excluded, but actual renderer, browser hit testing, keyboard/IME, and external undo persistence remain out of scope. Because the control does less semantic work than the selection layer, any extra time is not solely a rollback cost. The earlier benchmark includes a separate control with defensive rollback bookkeeping; that candidate is **not** the current hot path. Exact CI measurements should only be attributed to their tested revision.

Run:

    node --expose-gc tests/selection-hotpath.mjs 9

## Native JavaScript string as a direct benchmark reference (2026-10-10)

The user requested a comparison against **plain native JavaScript strings**, not only wrappers around document data structures. The existing `tests/selection-hotpath.mjs` now also benchmarks `NativeJavaScriptString` at 256 KiB (32/256 selections) and 4 MiB (32/256 selections). Its **direct** variant operates on one local JavaScript string using `value = value.slice(0,start) + insert + value.slice(end)` for each replacement, with prior content captured by native `slice`. Its **selection** variant passes a thin single-interval string-store adapter to the unmodified `TextEditSelections` candidate, so the selection layer is included without adding a new text storage implementation. Other backends and workloads remain unchanged. All cases run within the same hosted CI invocation with alternating measured order; constructor/setup, explicit GC and input generation are excluded from timed regions. For native strings, V8 may optimize ropes/concatenations and defer flattening; selected samples do not establish a general memory/copying bound. This adds a fair explicit native-language reference, not a new editor architecture.

The added native-string benchmark completed successfully at exact PoC revision `86ee3a0e8673d18129c34625cea236b2374da7d3`, [CI run 38079896501](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38079896501), Node v22.23.3 linux/x64, 9 measured samples after warmup. In the same hosted run:

| Store | Document | Ranges | Direct + old text (ms) | TextEditSelections (ms) |
| --- | ---: | ---: | ---: | ---: |
| Native JavaScript string | 256 KiB | 256 | 28.7970 | 29.8669 |
| FlatDocument | 256 KiB | 256 | 29.2496 | 29.3894 |
| Native JavaScript string | 4 MiB | 32 | 22.1306 | 22.9183 |
| Native JavaScript string | 4 MiB | 256 | 200.6925 | 204.7192 |
| PieceDocument | 4 MiB | 32 | 0.1239 | 0.1621 |
| PieceDocument | 4 MiB | 256 | 0.2642 | 0.3977 |
| PieceDocument | 4 MiB | 2048 | 1.2551 | 2.8798 |
| AdaptiveRepackDocument | 4 MiB | 32 | 0.1217 | 0.1534 |
| AdaptiveRepackDocument | 4 MiB | 256 | 0.4442 | 0.6544 |
| AdaptiveRepackDocument | 4 MiB | 2048 | 2.4594 | 3.4728 |

At 4 MiB and 256 ranges, native-string editing through the selection layer was approximately 515× the PieceDocument elapsed time **for this very specific dispersed single-character replacement workload**. Native string and FlatDocument are close at 256 KiB. These are *not* comprehensive text-engine benchmarks: V8 may defer string flattening, GC and memory retention are not measured here, and repeated insertion/other patterns could change the ranking. This should not be generalized into an absolute product speedup claim. Both CI jobs passed, although the browser job exercises earlier behavior, not this new benchmark.

Execute with:

    node --expose-gc tests/selection-hotpath.mjs 9

## Cached execution order for repeated selection edits (2026-10-10)

`TextEditSelections` now caches a physical-order permutation **when its caller sets the selections** and refreshes it after a successful operation. This avoids sorting the same selections from scratch for every keystroke, including when the user-specified selection order is the reverse of document order. The permutation does **not** change the externally visible array-to-selection pairing: the original user selection IDs still identify corresponding payloads, results and orientation.

A direction policy is still free to translate edit targets. Each operation checks that its cached execution order is monotonic for the **actual resulting primitive plans**; if a policy moved a target across another, it sorts the planned operations instead. That fallback is covered by an additional test with a backwards selection whose edit target jumps past a forward selection, followed by a second edit. Duplicate/overlapping target validation remains mandatory and happens before all writes. `TextEditBase` stays one-range-only; no rollback, history or persistent state is added. The new candidate passed both hosted jobs at exact PoC revision `28815b3697bbcd2c135ad1059b3403d8bb0d88f3`: [run 38079174120](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38079174120). The new `test-core` regression passed, including a re-ordered backward target across a second selected range; the Chromium job covered existing browser behavior, not the new selection algorithm. The same 9-trial 4 MiB benchmark reported for **2,048 ranges**:

| Backend | Previous revision: raw / selections (ms) | Cached revision: raw / selections (ms) |
| --- | --- | --- |
| PieceDocument | 1.7555 / 4.4414 | 1.3308 / 3.3188 |
| AdaptiveRepackDocument | 4.4597 / 5.2864 | 2.5309 / 3.5836 |

**These cross-run absolute timings cannot establish a speedup caused by caching**, because the raw backend baseline changed materially across hosted runs as well. The selection-layer overhead remains important, especially on a fast backend. The ordering cache is a low-level candidate to be further profiled on comparable within-run controls, not a final selected optimization.

## External column-edit preparation on existing selection primitives (2026-10-10)

The new exploratory `src/column-edit-probe.mjs` takes a *single rectangular user selection* and an explicit clipboard data input. It uses the **existing** `probeRectangles` view-width/grapheme/virtual-EOL translator, computes a list of oriented selections and **one string per selection**, and returns them to the existing `TextEditSelections.setSelections` / `replace` calls. It does **not** call `TextEditBase.replace`, manage history, or implement a second selection-edit engine. The core remains unaware of columns/clipboard.

The small policy matrix includes plain text line splitting (trailing LF produces an empty data row), CRLF normalization, a reference form for MadEdit-Mod's native clipboard format with **explicit row count**, selected-row cyclic fill when requested, source-shorter-than-target behavior without fill, and **source overflow extending into already existing target document rows** (never silently clipping source lines). By default the planner **still rejects** overflow requiring new rows; an experimental opt-in `materializeRows` policy (documented below) now supports a restricted downward EOF case without changing either lower-level editor. The planner rejects unresolved grapheme/tab column boundaries instead of silently snapping. It preserves user traversal in reverse-row selection and backward column-selection orientation. The column-mode name and modes remain **outside** `TextEditSelections`, and the data inputs are explicit model fixtures, not access to the OS clipboard.

`tests/column-edit-probe.mjs` exercises the planner plus **real** `FlatDocument`, `PieceDocument` and `AdaptiveRepackDocument`, with one success returning an inverse patch replayed externally to restore text and oriented selections. This is **source-behavior-inspired work, not native MadEdit-Mod GUI validation or full clipboard parity**. No product contract was promoted. Run:

    node tests/column-edit-probe.mjs

## Opt-in EOF column growth and paired native-string benchmark (2026-10-10)

An opt-in `materializeRows: true` option in `src/column-edit-probe.mjs` now synthesizes missing rows when a source has more rows than the selected + available destination rows **and the target continues downward with a forward horizontal orientation**. Existing destination rows are still resolved by `probeRectangles`, with tab/grapheme ambiguity checked before editing. Missing rows use spaces representing the requested virtual starting column plus caller-supplied source strings, joined by a validated explicit LF/CRLF or inferred existing newline style. They are staged as one ordinary EOF `replace` target, except when the final existing target is itself an EOF caret: the trailing synthesized lines are fused into that caret's text to avoid duplicate target positions. Selection identities and all per-row clipboard policies remain entirely outside `TextEditBase` and `TextEditSelections`; neither was modified. Unsupported upward missing rows or backwards-horizontal missing-row policies reject explicitly; LF/CRLF does not yet cover native bare-CR mode.

At PoC revision `3773b49fd32794b16dc3e030f40af52f75e1761b`, [Actions run 38085120689](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38085120689) passed both jobs. `tests/column-edit-probe.mjs` runs actual Flat/Piece/Adaptive backends and checks plain/native clipboard row counts, source overflow, final-newline behavior, existing text suffix, CRLF, virtual cells, invalid tab positions, orientation rejection and exact external inverse application restoring text. This is NOT native MadEdit-Mod GUI equivalence.

`tests/column-extend-hotpath.mjs` adds a **paired** experiment using raw native JavaScript string slicing/concatenation as a direct control, and the same string through the minimal `TextEditSelections` adapter, alongside real Flat/Piece/Adaptive models. At exact commit `96562d8ec9111f6602c7b3d1861c0a8e94ccc3c3`, [Actions run 38085273493](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38085273493) passed both jobs. Node v22.23.3, hosted Ubuntu x64, nine timed medians; an unselected 4 MiB prefix line plus 128 source clipboard rows (125 new rows) yields just three primitive edits. Constructor and explicit GC are excluded, with raw and selection samples alternating in the same invocation:

| Backend | Planning (ms) | Direct with old text (ms) | With selections (ms) |
| --- | ---: | ---: | ---: |
| NativeJavaScriptString | 2.1362 | 1.9428 | 1.9963 |
| FlatDocument | 1.9936 | 1.9482 | 2.0204 |
| PieceDocument | 0.0879 | 0.0409 | 0.0572 |
| AdaptiveRepackDocument | 0.0833 | 0.0828 | 0.1024 |

This result contrasts with **earlier 256 dispersed edits** because this workload is only three edits near the document tail. It does not prove a memory/RSS ceiling, selected giant-line cost, UI-frame latency or a universal speedup.

## Real browser input projection, limited boundary test (2026-10-10)

At exact commit `5c59bf0d5e8a73ca682a2859cb4e313ddacc76c3`, [Actions run 38085536635](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38085536635) passed both the core and actual Chromium browser jobs. `tests/browser-input.mjs` drives a real Chromium textarea over HTTP by DevTools `Input.insertText`, keyboard Ctrl+Z and Ctrl+Shift+Z, mouse click and an IME preview; the page module `tests/browser-input-scenario.mjs` redirects real `beforeinput` to a DOM-independent `PieceDocument` + `TextEditSelections`, and maintains a minimal test-only external action history. Two independent typed characters are two undoable actions; native pointer hit testing projects a caret, and keyboard undo/redo restore text. Chromium emitted a real `compositionstart` on the IME preview probe.

**At this initial checkpoint only:** IME final commit and action grouping, actual clipboard paste, visual multi-line selections, pixel-perfect grapheme hit testing, full controller capability, memory/performance in browser, actual MadEdit-Mod GUI were not proven. Later independent tests now cover a *restricted* native paste and IME commit path as described below. The earlier IndexedDB browser regression also passed but does not validate these editing semantics. These PoC HTML/driver files are test fixtures, not an editor runtime or product API.

MadEdit-Mod reference source pinned for this investigation: [MadEdit.cpp at 97cfc879](https://github.com/LiMinggang/madedit-mod/blob/97cfc87996577444f0f3fa14344eddc09352e46e/src/MadEdit/MadEdit.cpp), including `GetColumnDataFromClipboard` (native rowCount, plain fallback and optional autofill) and `InsertColumnString` (row loop/EOF newline). This is only source-based characterization; native GUI remains unexecuted.

## Native Chromium paste, IME confirmation, and column planner composition (2026-10-10)

The existing `tests/browser-input-scenario.mjs` is still a **test-only external input/history controller** atop unchanged `PieceDocument`, `TextEditSelections` and `planColumnPaste`. It now handles an actual Chromium clipboard `paste` event (via permitted `navigator.clipboard.writeText` and CDP-driven Ctrl+V) rather than inventing a JavaScript `ClipboardEvent`. One paste of two lines into **two unordered editor carets** produces one undo entry and undoes both destinations together. A single native textarea is still used for visible input; a generic `keyup` listener was found to destroy the multiple canonical carets after Ctrl+Z by projecting the browser's lone caret. The PoC now projects keyboard selection only on actual navigation keys and uses the external editor's selections as the authoritative multi-caret state.

The IME test uses real Chrome composition events: two `Input.imeSetComposition` previews leave the canonical document/history unchanged; `Input.insertText` confirms the composition as one external undo action; undo and redo restore its document text. A separate test verifies that a new, identical character typed immediately afterward is **another** undo action (not a suppressed IME echo), and cancelling a later composition preserves the model and does not add history. This is one Chromium event sequence, **not** a cross-browser/OS/IME contract or proof that every composition order and selection shape works.

For the **combined column path**, the test supplies an explicit test rectangle (it does *not* drag a real native visual rectangle), writes four actual clipboard rows, and triggers browser Ctrl+V. The external column planner generates two ordinary selection replacements (the second includes the synthesized EOF continuation) against `'aa\nb'`, producing `'aaX\nb Y\n  Z\n  W'`, with **two newly materialized lines**, **one undo entry** and correct undo/redo. No column policy was added to the text store or selection layer.

Hosted CI evidence (Node 22.23.3 on Ubuntu Linux x64, real Google Chrome):

- [Run 38086362034](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38086362034): both jobs **PASS** at PoC commit `da9ee5c9d7b5e0aaa0035a11243cd8923600f0d5` (real clipboard paste, grouped undo and IME commit; repaired the test's overbroad native-keyup projection).
- [Run 38086461359](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38086461359): both jobs **PASS** at `54cff04333670f800196e61700b7e476a96f9ea1` (identical subsequent input, IME cancellation).
- [Run 38086557499](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38086557499): both jobs **PASS** at `17a91f12b090b3645e65c88be58cb7b89f90ac4b` (real native-browser clipboard routed through EOF column planner and undo/redo). The existing IndexedDB browser regression also passed but is separate from editor input.

This remains a small test page that mirrors the entire **tiny** document into a textarea. It does not establish viewport-limited rendering, accessibility, native rectangle hit testing, real spreadsheet applications, MadEdit-Mod GUI equivalence, host IMEs beyond the tested Chrome/CDP path, or performance/memory figures for large document browser use.

## Truly selected giant lines: process-isolated memory and ASCII geometry candidate (2026-10-10)

The previous EOF-column benchmark left its 4 MiB giant line **unselected**. This new workload actually selects entire 4/16 MiB lines or partitions a single selected 4 MiB line across 64 non-overlapping selections. `tests/selected-long-line-stress.mjs` compares direct document replacements that capture all overwritten text against `TextEditSelections.replace` on genuine native-string/Flat/Piece/Adaptive implementations. Each timed path is paired and alternates order across five trials (plus warm-ups); document creation, selection setup and explicit GC are excluded. Independent child processes measure post-GC retained heap/RSS and the Linux lifetime RSS high-water. Neither editing path writes history to storage. **A one-range deletion can remain nearly constant-time through shared string/backing storage without proving that later inspection, copying or serialization of the removed 16 MiB is free.**

At PoC revision `080350bc1fc0a5ab99216ec3c4e6e13a053608c5`, [Actions run 38087866071](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38087866071) passed both jobs on Node v22.23.3 Linux x64. The 4 MiB line partitioned into **64 selected ranges** gave the following medians (milliseconds, direct / selection path):

| Backend | Direct with overwritten text captured | `TextEditSelections` |
|---|---:|---:|
| Native JavaScript string adapter | 42.7 | 44.0 |
| FlatDocument | 43.2 | 43.1 |
| PieceDocument | 0.178 | 0.222 |
| AdaptiveRepackDocument | 0.333 | 0.379 |

The more serious discovery is in the original `probeLine` visualization candidate: selecting the **first few columns** on one 2 MiB ASCII row still creates 2,097,152 grapheme cell objects. In independent Node children with FlatDocument, complete geometry took **915.982 ms** and retained an additional **150.430 MiB heap** (post-GC; process peak RSS **274.625 MiB**). With AdaptiveRepackDocument, complete geometry took **916.209 ms** and similarly retained **150.432 MiB heap**. This is the *geometry* cost and should not be confused with core replacement throughput or browser DOM memory.

`src/visual-column-ascii-probe.mjs` is a **separate, experimental alternative**, not a new editor API. For known ASCII runs it advances only to the requested visual columns using small document slices, validates a character beyond the desired boundary to avoid misclassifying an adjacent Unicode combining sequence, and **falls back to the unchanged full `Intl.Segmenter` geometry** when a non-ASCII code unit is encountered before the target is resolved. It does not invent Unicode chunk-boundary semantics. `tests/visual-column-ascii-probe.mjs` checks exact parity with the full geometry across 1,600 deterministic mixed Unicode/document fixtures and eight chunk sizes, including tabs, CRLF, wide glyphs, emoji, composed graphemes, Unicode fallback, end-of-line virtual positions and a 2 MiB actual selected line.

For that same 2 MiB ASCII line with target column 2, the isolated FlatDocument candidate measured **1.266 ms**, **0.033 MiB retained heap delta**, and **4,096 UTF-16 units** read; the AdaptiveRepackDocument candidate measured **1.129 ms**, **0.035 MiB retained heap delta** and the same bounded read. These are contrasting *workloads on a deliberately favorable ASCII prefix*: memory samples are subject to Node/V8 GC and process high-water effects; they do not establish the same improvement for general Unicode, far-right columns, tabs with custom view widths, pixel geometry, document rendering or clipboard interactions. The fallback can still materialize the entire line. Genuine browser UI, MadEdit-Mod native GUI, viewport virtualization and physical-host validation remain open. No current RumiAI specification, product runtime, lower-level edit interface or permanent tests were modified.

## Next measurements and semantic work

1. Extend the now-tested Chromium clipboard/IME input path to native visual rectangle creation, real spreadsheet TSV/CSV semantics, selection directions and cross-browser composition behaviors; keep the browser-to-model projection outside the text engine.
2. Characterize MadEdit-Mod source-to-destination mapping through actual native GUI and source evidence, including overflow **above** the document, reverse direction, bare-CR newline, autofill, CSV/TSV, tabs, Unicode and virtual columns.
3. Extend now-measured selected-line memory/latency to realistic mixed Unicode, fragmented backing storage, far-right visual positions, repeated edits and viewport-limited rendering; keep capture/undo persistence external.
4. Continue visual selection and viewport-limited DOM rendering experiments without confusing display geometry with text storage.

The JavaScript toolchain remains independently owned by handoff/javascript-build-and-runtime-loading.md. Never treat PoC 061's CodeMirror use as permission to adopt it as our editor engine.
