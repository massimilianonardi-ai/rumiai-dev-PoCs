# PoC 063 — large-document text engine and column-editing transactions

Status: **experimental; no selected product architecture**. Owner: rumiai-dev/handoff/browser-column-editor.md.

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

## Next measurements and semantic work

1. Characterize source-to-destination row mapping by reading upstream code and using actual MadEdit-Mod GUI whenever practical, including one/two/many clipboard lines, zero-width selections, long/short target rows, trailing newline, source rows exceeding targets, Unicode and tabs.
2. Stress longer edit histories and measure retained source chunks, node/piece growth, consolidation/fragmentation, GC and disk-backed possibilities. Compare a balanced piece tree, rope, and alternative line indexing under the same operations and correctness tests.
3. Separately prototype mapping text offsets to visual columns and viewport-limited DOM rendering; do not conflate display geometry with text storage or commit to a rendering engine.

The JavaScript toolchain remains independently owned by handoff/javascript-build-and-runtime-loading.md. Never treat PoC 061's CodeMirror use as permission to adopt it as our editor engine.
