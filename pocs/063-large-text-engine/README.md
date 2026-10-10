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
- `tests/action-command-probe.mjs` covers real `FlatDocument` and `AdaptiveRepackDocument` models: each separately typed character is one undo step, two physical-keyboard annotations still form *one* serial stream, one input across two carets is one undo, exact selection restoration, redo branching, three-row virtual-column paste sourced from existing `probeRectangles`, duplicate caret rejection, paste row mismatch rejection, optional undo limit, and rejection of a stale wrapper after an out-of-band document change.
- The failure test injects a `replace` that rejects **before mutation** during a multi-range batch. Earlier applied changes are rolled back, and no user action is recorded. This is a *conditional* transaction guarantee: a document primitive that mutates and then throws (or OOM conditions) does not have proven strong rollback semantics.

**Limitations:** `pasteRows` explicitly requires exactly one source row per selected target and is **not** MadEdit-Mod-compatible for overflow/autofill/CSV cases. Backspace handles one code unit or a surrogate pair, not full grapheme clusters. Real DOM keyboard events, IME/composition, visual hit-testing, source/target mapping, collaborative merges and native MadEdit-Mod GUI have **not** been tested by this headless action-object PoC. The class names and method shapes are experimental, not normative product APIs.

Run from this PoC directory:

    node tests/action-command-probe.mjs

Earlier `History`, `ForegroundHistory`, `AsyncHistory` and `SpillHistory` remain comparison artifacts, not approved product architectures. Do not reopen persisted-provider throughput work in the editor.

## Next measurements and semantic work

1. Test real browser input and composition/IME through an editor-owned-selection plus outer-controller split, maintaining exact user-action undo granularity.
2. Characterize MadEdit-Mod source-to-destination mapping through source evidence and real native GUI whenever practical, including overflow rows, autofill, CSV/TSV, tabs, Unicode and virtual columns.
2. Stress longer edit histories and measure retained source chunks, node/piece growth, consolidation/fragmentation, GC and disk-backed possibilities. Compare a balanced piece tree, rope, and alternative line indexing under the same operations and correctness tests.
3. Separately prototype mapping text offsets to visual columns and viewport-limited DOM rendering; do not conflate display geometry with text storage or commit to a rendering engine.

The JavaScript toolchain remains independently owned by handoff/javascript-build-and-runtime-loading.md. Never treat PoC 061's CodeMirror use as permission to adopt it as our editor engine.
