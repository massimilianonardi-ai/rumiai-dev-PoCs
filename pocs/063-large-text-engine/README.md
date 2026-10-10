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

## Next measurements and semantic work

1. Characterize source-to-destination row mapping by reading upstream code and using actual MadEdit-Mod GUI whenever practical, including one/two/many clipboard lines, zero-width selections, long/short target rows, trailing newline, source rows exceeding targets, Unicode and tabs.
2. Stress longer edit histories and measure retained source chunks, node/piece growth, consolidation/fragmentation, GC and disk-backed possibilities. Compare a balanced piece tree, rope, and alternative line indexing under the same operations and correctness tests.
3. Separately prototype mapping text offsets to visual columns and viewport-limited DOM rendering; do not conflate display geometry with text storage or commit to a rendering engine.

The JavaScript toolchain remains independently owned by handoff/javascript-build-and-runtime-loading.md. Never treat PoC 061's CodeMirror use as permission to adopt it as our editor engine.
