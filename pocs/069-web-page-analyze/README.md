# PoC 069 — web-page-analyze: runtime analysis and shared-chat DOM accumulation

**Current direction (2026-10-19): JavaScript two-page, append-only export of the actual ChatGPT shared-page DOM. Prior scroll/MHTML replay remains historical diagnostic evidence, not the new export algorithm. Complete transcript and rich-media fidelity remain subject to physical validation.**

This is an experimental browser-analysis PoC built **directly on the two
authorized real pages**. All prior fixture experiments, their tests and the
fixture CI workflow were removed from the current tree. It preserves native
MHTML unmodified. The generic *visual collage* now combines **only original
browser screenshot fragments**, with provenance and explicit missing ranges;
it does not reconstruct HTML/CSS or purport to be one complete MHTML document.

## JavaScript port of the original Python exporter (2026-10-19)

The PoC now includes `python-export.mjs`, which reproduces the Python
`chatgpt-export.py` **data/export stage** when provided with a real
`mapping/current_node` snapshot: traverse only the active parent chain,
detect missing ancestors and cycles, classify internal/tool messages,
retain the entire original message objects including non-string parts,
write `conversation.raw.json.gz`, `TRANSCRIPT.md`,
`VISIBLE_MESSAGES.jsonl`, `NON_TEXT_PARTS.json`, `AUDIT.json`,
`README.md`, `SHA256SUMS` and a ZIP archive, entirely in JavaScript.
The original Python's macOS SQLite catalog, app-specific breakpoint and
interactive conversation selection are deliberately **not** run against
the public shared URL.

The **same existing** `run-accumulate.sh` workflow still opens only the
user-supplied share URL. Its observer installs before navigation; source
navigation, first captured messages and initial top-of-chat position are
unchanged. After the original HTML accumulator completes, the exporter
also writes:

```text
evidence/accumulations/<run>/python-export/
evidence/accumulations/<run>/python-export.zip
```

For the **real shared-page** path this bundle explicitly contains
`shared-page-dom-observations` with the retained original turn HTML,
observed text and roles, and its adjacency/continuity evidence.
It **does not** fabricate the unavailable renderer
`mapping/current_node` snapshot, source `message` objects, message
parents, hidden turns, or missing attachments. In other words, the
Python-compatible **file layout** is reproduced, but the exported source
data is not asserted to be identical to the macOS snapshot. No user/assistant
message selection is added. `complete=false` remains in force until
physical beginning/end, identity, order, media and rendering checks pass.

## Automatic export from the already verified chat beginning

The default command uses the original working **URL-first/top-first**
navigation and pre-navigation `MutationObserver` without replacing it
with macOS-specific application routing or a message selector. **No manual
scrolling and no terminal Enter are required in the default mode.**

```sh
cd /m/src/git/rumiai-os_TEST/src/rumiai-dev-PoCs/pocs/069-web-page-analyze
git pull --ff-only
sh run-accumulate.sh accum-auto-01 \
  'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835'
```

Use any unused run name; previous evidence is never overwritten.
After capturing and persisting the initial mounted turns, the automatic
driver tries Chromium `PageDown`, then targeted wheel input and
`scrollIntoView` of the last mounted turn when progress stalls.
It samples browser-visible movement and new message identities after
every action and drains the original observer before the next movement.
It **always finalizes its available output** when the navigation budget or
bounded no-progress checks terminate, even if full coverage cannot be
proven. Output files include `export/index.html`,
`python-export.zip`, `python-export/`, `manifest.json` and
`navigation.jsonl` under the gitignored run directory. A ZIP or
HTML write failure is an error, not an accepted export.

The original Python captures a native Electron snapshot through a
renderer breakpoint; the public shared page has not been shown to
expose that same complete snapshot. Automatic browser traversal is
therefore **not** a claim of byte-identical original snapshot contents:
`manifest.complete=false` and `completeExportVerified=false` remain
until actual full-message, order, and media checks are passed.
Stop reason `automatic-navigation-stalled` is **not** proof of the end.

The explicit `PWC069_SCROLL_MODE=manual` mode remains available only
for comparative diagnosis; it is not part of the normal export path.
The tests `accumulate-auto.test.mjs` and
`accumulate-python-export.test.mjs` protect autonomous traversal and
Python serialization semantics on simulated inputs; a complete physical
export of the real shared URL has not yet been demonstrated.

## Restored inspect-01 single-tab startup (2026-10-19)

The operator-confirmed beginning-of-chat startup was **not** originally
implemented by `accumulate.mjs`. It was `investigate.mjs`, introduced at
revision `4d229fb29068c4021587778c380bcf4ae629e99f`, running as
`inspect-01`. It created one visible Chromium tab, enabled CDP
`Page`/`Debugger`/`Profiler`/`Network`, injected
`investigate-observer.js` through
`Page.addScriptToEvaluateOnNewDocument`, started precise coverage, then
navigated directly to the share URL. Its `initial` checkpoint was recorded
**without any programmatic scroll**. The user physically confirmed that
`inspect-01` opened on the first conversation messages.

The export path now **reuses this same first-page startup sequence**, in
particular the original investigation observer and CDP injection. It adds
the accumulating observer before the same single navigation but **does not
open the second export tab until after** the original page's first
snapshot and viewport screenshot. That untouched initial browser
screenshot is retained as private `startup-initial.png`, and
`manifest.json` records an `inspect01Startup` checkpoint. Only then
does the exporter initialize the invisible replica, drain initial
identities and begin automatic traversal. No restored scroll, message
choice, route rewriting or premature second-tab creation is permitted.

This is **source-level recovery** of the observed startup, not a physical
reconfirmation on the operator's Chromium and not evidence that later
segments or complete rich assets were exported. The existing automatic
traversal/export and its incomplete-coverage reporting remain a separate
open issue. The source of the originally confirmed startup is preserved
under `investigate.mjs` and Git history, not inferred from the later
`accumulate.mjs` implementation.

## Share URL is the only conversation selection — preserve proven top-first startup

**Current explicit user correction:** The conversation is identified by the
`https://chatgpt.com/share/<id>` link supplied to the exporter. There is
**no** SQLite conversation catalog, numerical conversation-choice menu,
interactive message selection, or macOS `app://` navigation in the
shared-link export path. The earlier direct Python-to-JavaScript conversion
of the **macOS** exporter is only a reference for preserving output data
and semantics; importing its conversation selection and renderer breakpoint
would **break the web shared-link workflow**. Do not adopt that standalone
macOS entrypoint in this PoC.

The current JavaScript `run-accumulate.sh` requires the shared link as its second positional argument (explicit
URL, no implicit conversation fallback). Its startup order now follows the **historically observed
`inspect-01` single-tab CDP bootstrap**, not the later two-tab
`accumulate.mjs` bootstrap: capture the original page's initial checkpoint
before creating the invisible export tab, then scan and persist initial
turns before automatic traversal.
The operator verified that recent research runs start at the correct
beginning of the shared conversation. We must **not** add scroll-to-bottom,
navigate-to-app-route, restore-scroll, conversation-list UI, or another
initial-state reset.

Identity-based deduplication in the accumulator is **not selecting**
which messages to export: every identifiable user/assistant turn seen
while the shared page mounts or removes its segments must be retained.
Missing/unstable identities are explicit evidence limitations, never
an invitation to exclude messages silently.

`tests/accumulate-link-entry.test.mjs` protects the URL-only entry,
pre-navigation observer, startup capture-before-wheel sequence, and
absence of catalog/message-choice dependencies. It is a structural
regression test, not proof of full message or attachment coverage.
No changes to the working browser startup sequence or source navigation
code were made for this correction.

## Physical `accum-01` result: 17 original turns, automatic wheel stalled

On 2026-10-19 the operator ran the first new two-tab experiment on the
corporate workstation. The real terminal output confirms that the source
page and initially invisible replica both opened. The original window
produced **17 initial turn identities**; after **44 wheel attempts**, the
export still contained **17 distinct identities**, although 4 remounts were
observed. The run stopped with `visual-stasis-after-wheel` and
`complete:false`. Resource evidence: 95 response detections,
60 saved, 22 failed, 0 deliberately skipped. These are **resource
detections, not 95 distinct URLs or 95 mandatory assets**; the causes of
the failures require examination of the existing local manifest.

**Conclusion:** neither original conversation end nor source traversal was
verified. `orderComponents=1` for just 17 turns is **not** proof that
later virtualized segments were collected. The local
`evidence/accumulations/accum-01/` remains untouched; do not rerun the
same name or interpret its `export/index.html` as a successful export.

The loop now collects **source input-target/scroll ancestry diagnostics**
(`navigation.jsonl`) and distinguishes new identities from mere
mount/unmount churn. If automated wheel stops visibly changing the page,
it does **not** certify the end or close the browser. Instead, when there
is an interactive terminal, it invites the operator to scroll the
**same original page manually** while a 250-ms sampler keeps copying
and permanently retaining newly mounted/detached turns in the same
invisible second tab. The operator presses **Enter only after visually
reaching the end**. This last confirmation is human-reported, not yet
independent completeness proof.

To directly exercise the known-working human navigation path and skip the
unsuccessful automatic wheel altogether, use a **new unused** run:

```sh
git pull --ff-only
PWC069_SCROLL_MODE=manual sh run-accumulate.sh accum-02 \
  'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835'
```

During the run, scroll the **visible original ChatGPT page** all the way
from its first messages to its last messages, then press **Enter in the
terminal** to finalize. The second tab remains visually invisible
until the export is finalized. Do **not** close the terminal before
pressing Enter; the finalized output is still marked incomplete until
the real full message coverage and rich media are verified.

Before the new run, the older local test can be diagnosed without opening
or disclosing its transcript:

```sh
node diagnose-accumulation.mjs accum-01
```

This reads only `manifest.json`, prints retained turn counts, original
stop reason, adjacency continuity, CSS/media gaps and grouped **types**
of response-body failures, without printing message text, raw resource
URLs, signed links or message IDs. No browser or acquisition starts.
`navigation.jsonl` is generated only by new runs. If `accum-01`
already has no raw resource manifest, the error classes may be incomplete.

## Current primary PoC: two Chromium pages, no full snapshot, JavaScript only

The user explicitly corrected the research premises after physically running
`inspect-01`: **the shared ChatGPT page does not expose a complete loaded
conversation**, but incrementally mounts/destroys **entire conversation
segments and message divs**. The shared page now genuinely starts at the
beginning (user's observation), unlike previous bottom-first captures.
Do not resurrect a macOS full-`mapping` assumption or wait for the entire
page to exist simultaneously. The old Python exporter is only historical
context; **the implementation is JavaScript**.

Evidence from the supplied physical terminal log:
- `inspect-01` observed 44 distinct mounted identities, 36 removed IDs,
  28 remounted IDs, 141 mount and 128 unmount events. This strongly supports
  **real DOM virtualized segments**.
- All sampled `windowY/rootY` were zero, even while nodes came and went.
  Therefore numeric `scrollTop` is **not** a valid progress/completeness
  primitive for this page.
- `extract-model.mjs` found 0 complete `mapping/current_node` candidates
  among 30 captured first-party JSON bodies. This does not prove that
  no other state exists, but supports prioritizing streaming DOM capture
  over a speculative in-memory snapshot.
- Script capture was **incomplete**: 995 of 1557 parsed scripts saved;
  562 not saved and one worker outside main-page CDP coverage. Do not call
  the existing runtime analysis comprehensive.
- Existing `inspect-01` private evidence and all older `live-*` and
  Amazon experiments are preserved; no migration or rewrite.

### Run the new source + invisible accumulating export

```sh
cd /m/src/git/rumiai-os_TEST/src/rumiai-dev-PoCs/pocs/069-web-page-analyze
git pull --ff-only
sh run-accumulate.sh accum-01 \
  'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835'
```

Use `accum-01` **only if unused**; the script refuses to overwrite
an existing run. Optional second argument is a literal public
`https://chatgpt.com/share/<id>` URL. The experiment requires the same
isolated pinned Playwright runtime/Chromium as `inspect-01` and sets
`ignoreHTTPSErrors` **only in its disposable browser context**.
Do not log in or navigate to unrelated sites in that trust-reduced context.

It opens two actual pages within the same Chromium context:

1. **Original**, visible ChatGPT shared page: the existing
   `accumulate-observer.js` is injected *before navigation*. A
   `MutationObserver` retains every identified complete message-turn DOM
   subtree immediately on mount **and before it is unmounted**, plus
   changes to previously mounted rich nodes. Stable
   `data-message-id` and `conversation-turn` identities are preferred.
   It scans all currently mounted turns, including long messages spanning
   several viewports. The source browser is driven by ordinary
   `mouse.wheel` events, **not** by guessed scroll coordinates.
2. **Export**, initialized visually white/invisible: a detached logical DOM
   accumulates **copies of original turn nodes** and a common ancestry of
   wrapper CSS classes. React's original virtualizer cannot destroy the
   exported copies. The original message markup (text, code, table, SVG,
   MathML, attachments and image references) is cloned before disposal;
   canvas elements are converted to PNG data-URI when readable. Scripts
   and event handlers are removed from this static export; embedded
   iframe/object/embed targets are retained as *inert references*, not
   silently omitted or executed (not executable ChatGPT application state).

A Node.js-side append-only `Accumulator` indexes stable identities and
records adjacency observed in overlapping DOM windows. Already captured
turns are updated on remount, **not discarded**, while disconnected
segments and adjacency cycles are flagged. It streams the actual captured
HTML to gitignored `stream.jsonl` and persists the accumulated records
to `accumulated.json`; the second tab receives updates during the loop.
The original page's mutation queue has a bounded memory budget.
A repeated unchanged *visual viewport* plus no new IDs is a **heuristic
stop condition**, not proof that the last message was reached.

Network responses containing CSS, images, fonts and selected attachments
actually requested by the browser are saved locally with content hashes.
Original stylesheet order, CSS URL asset rebasing and common ancestor
classes are retained on a best-effort basis. Items referenced by
`srcset`, `blob:` or links whose bytes were never requested are
**explicitly incomplete**. Attachments that require separate downloads
are not yet included merely because a link exists.

The output is stored under gitignored
`evidence/accumulations/accum-01/`:

- `export/index.html`: static accumulating replica, made visible when
  finalizing; it uses strict CSP blocking script execution/network loads.
- `export/assets/`: original captured CSS/image/font/media bytes.
- `manifest.json`: stop reason, message counts, adjacency continuity,
  insufficient ID stability, resource failures and missing-media counts.
- `stream.jsonl`, `accumulated.json` and `resources.json`: original
  forensic capture, **potentially containing full private chat text**.
- `browser-profile/`: disposable local browser state.

**Security:** never commit or publish the `evidence/accumulations/`
directory. Its raw HTML, resource URLs, screenshots if added later, and
attached content can carry private or signed data. The export page strips
active JavaScript and uses offline CSP, but faithful visual reproduction
still requires testing stylesheets, images, charts, math and attachments.

**Validation status:** the accumulator and CSS/URL logic pass isolated
JavaScript tests, and the source observer's add/remove/identical-remount
transition was exercised with a fake DOM. The new dual-page Chromium
workflow and offline rendering **have not yet been run against the real
shared page**. The exporter intentionally reports
`completeExportVerified=false` until a measurable end-to-end completeness
and rich-media audit can justify changing that. Do not infer success from
one screenshot or an apparent wheel-loop stop.

## Recovered Python exporter — historical macOS snapshot reference (not the shared-page algorithm)

The user previously supplied the real files **`chatgpt-export.py`** and
**`chatgpt-export.sh`**, including later Python revisions. The original
Python was reviewed directly (not inferred from a chat summary), and its
syntax was checked with the native Python compiler; the shell helper passed
`sh -n`. These files are user-provided source, **not current RumiAI
normative contract or a validated public-share export**.

**What the supplied code actually does:** the shell helper starts/attaches
to the macOS ChatGPT Electron renderer with CDP enabled. The Python scans
loaded JavaScript using `Debugger.getScriptSource` for the semantic
`mergeActiveBranch` marker, locates the conversation snapshot consumer,
places a `Debugger.setBreakpointByUrl`, inspects the matching paused call
frame and serializes the snapshot with `Debugger.evaluateOnCallFrame`.
Its exporter takes `mapping` and `current_node`, traverses parent links,
rejects cycles/missing ancestors, selects the active branch, classifies
user/assistant versus tool/internal messages, **retains the complete
original `message` objects**, includes non-string parts and writes raw
snapshot/visible messages/audit/Markdown. It does **not** reconstruct the
conversation from DOM scroll positions, and therefore can succeed despite
message divs being mounted/unmounted. The user reports it already works
well for their macOS scenario except rendered images/attachments.

**Critical boundary:** this particular script targets `app://-/index.html`
and the macOS-only local catalog `~/.codex/sqlite/codex-dev.db`. The target
of PoC 069 is a public **`https://chatgpt.com/share/...`** page; do not
pretend it exposes `mergeActiveBranch` or an identical complete
`mapping/current_node` snapshot until the browser inspection confirms
that. The right direction is to identify that page's *data source*,
not to fall back to scrolling as an export primitive. If the web page
supplies multiple independently loaded data segments, their identities,
order and completeness must be established without inventing missing
parents.

**Implemented now in PoC 069, keeping prior `live-*` and Amazon unchanged:**

- `conversation-model.mjs` reuses the exact active-branch model concept:
  complete node-chain validation, visibility classification, raw full
  message preservation and resource-reference inventory.
- `extract-model.mjs <investigation-run>` searches saved first-party JSON
  responses for an actual `mapping/current_node` candidate, checks
  it with that deterministic algorithm and writes private candidate
  transcripts and rendering audits. A missing candidate is a legitimate
  finding, not a reason to fabricate DOM-backed data.
- `analyze-investigation.mjs` searches the **collected actual page
  JavaScript** for `mergeActiveBranch` and related model markers, and
  checks redacted response schemas for matching fields.
- The joint investigation now also retains page-loaded **CSS,
  image, font and media byte responses** (subject to explicit size/count
  budgets), CSSOM inline/cross-origin accessibility, computed styles,
  message wrappers, HTML tables, SVG markup, canvas chart PNGs when
  accessible, event listeners and DOM snapshots. Each missing/tainted/
  oversized resource is flagged. All raw rich content remains under
  the **gitignored investigation evidence**, never auto-committed.
- `render-audit.mjs` cross-checks references found in original message
  objects against actual resource bytes. A file pointer or signed URL
  alone is **not** accepted as a successfully captured attachment.

The user-facing final **faithful export** will require two separately
validated stages: (1) complete ordered conversation data independent of
dynamic DOM, (2) an offline renderer with original semantic structures,
CSS/fonts, linked images and downloaded attachments. HTML tables and SVG
may be reconstructed from source data/markup; canvas charts need an
actual bitmap or accessible chart model. Missing authorization, missing
attachments, inaccessible stylesheets or changed rendering must be
reported, never silently substituted with a screenshot collage.

Run the isolated inspection with a new unused name, e.g.:

```sh
git pull --ff-only
sh run-investigation.sh inspect-01
node analyze-investigation.mjs inspect-01
node extract-model.mjs inspect-01
sh prepare-investigation.sh inspect-01
```

The private `analysis-bundle.tar.gz` contains executable JS sources,
structural diagnostics, selected CSS and resource metadata, **not** raw
conversation JSON, browser profile, page HTML, image/font/attachment bytes
or screenshots. The last three commands operate on existing evidence and
do not navigate the site. Inspect before sharing the bundle privately in
this conversation. There is **no new physically validated shared-link
export yet**; success criteria must be determined by inspecting source
data and comparing every message and rich resource to the live page.

## New primary research path: human + AI analysis of the real ChatGPT runtime

**Final goal:** faithful, complete, deterministic export of a shared ChatGPT
conversation. **Supporting goal:** a general, deterministic `web-page-analyze`
mechanism capable of collecting sufficiently deep runtime evidence to let AI
reason about how a page actually works. Neither goal is met by the earlier
scroll-coordinate/MHTML replay; Amazon's ordinary lazy loading was the much
simpler successful case.

**Operator observation (not yet independently validated by the probe):**
Firefox Developer Tools showed a list of `div` elements containing unique
IDs; ChatGPT adds/removes items at the head/tail during scrolling, and there
is no dedicated nested scrolling container. This suggests *window/root
scrolling plus message-list virtualization*, but the implementation, ID
stability, remote data boundaries and full conversation completeness remain
to be verified. Previous generic scroll-replay work did not sufficiently
instrument this and wrongly treated MHTML position as adequate evidence.

### One fresh interactive investigation — separate from the existing runs

```sh
cd /m/src/git/rumiai-os_TEST/src/rumiai-dev-PoCs/pocs/069-web-page-analyze
git pull --ff-only
sh run-investigation.sh inspect-01
```

`inspect-01` is **only an example if the name is unused**. The script
uses the previously pinned PoC-private Playwright runtime, launches a new
disposable Chromium persistent context with the user-requested
`ignoreHTTPSErrors: true` opt-in, and instruments the *real authorized
ChatGPT shared-link page* **before navigation**. It does **not** invoke
the old Amazon/ChatGPT wheel replay, create MHTML, or modify previous
`live-*` evidence. Its browser is sandboxed; do not sign in or use
unrelated sensitive websites in this trust-reduced research context.

The terminal guides three real manual movements: inspect first chat
messages at the **top**, scroll to the **bottom**, then return to the
**top**. Press Enter **only after visually reaching each stage**; the
probe continuously records while the human navigates.

The code and runtime evidence stored locally under ignored
`evidence/investigations/inspect-01/` includes:

- **`investigate-observer.js`**: a passive pre-navigation
  `MutationObserver` recording the additions, removals and attribute
  changes of message-like DOM elements, possible unique IDs and ancestor
  structure. Periodic DOM samples report the ordered mounted identities,
  text **hashes/lengths, never literal message text in the trace**,
  geometry, scroll positions of `window` and the document root, and
  any candidate internal scrollers. Mutations are counted and loss is
  flagged; unsupported IDs cannot prove stable identity.
- **Chrome DevTools Protocol `Debugger.scriptParsed` and
  `Debugger.getScriptSource`**: saved raw page JavaScript sources,
  including chunks dynamically parsed during manual scrolling, with URL
  query removal and SHA-256 provenance in `scripts.json`.
  `Profiler.takePreciseCoverage` records executed function ranges
  separately for initial/top/bottom/top-again stages. This is **main-page
  client JavaScript**; worker scripts, inaccessible dynamic code,
  oversized files, service/server code and other losses are not
  magically covered. Event buffers are processed in-process via direct
  Playwright/CDP, avoiding the current released debugger provider's
  128-event buffer limitation. This direct-CDP path is a **PoC-only
  discovery adapter**, not a new `web-control` architecture or contract.
- **DOMDebugger event-listener inventories** on window/document/main,
  private DOM snapshots, Chromium viewport screenshots, network request
  metadata (without request headers, cookies, URL query parameters or
  POST bodies) and first-party JSON responses in **private local files**.
  The JSON responses can contain the actual shared chat; they are never
  automatically committed or included in the AI sharing bundle.
  The collector also produces `response-schema.jsonl`: JSON property
  names, nesting, types and array lengths without literal user text. This
  redacted schema **is** included in the private AI analysis bundle.
  The main site scripts are not rewritten and all navigation remains
  human-controlled, but debugger attachment and precise V8 coverage can
  **perturb runtime performance and timing**; they are research measurements
  rather than a production passive exporter.
- **Resource budgets**: bounded number/size of scripts, response
  payloads, samples and mutations. Failed collections, browser workers,
  limits and coverage uncertainties are surfaced explicitly. These are
  diagnostic boundaries rather than silent "all code captured" claims.

### Read the trace and share with the AI

```sh
node analyze-investigation.mjs inspect-01
sh prepare-investigation.sh inspect-01
```

The first command reports message remount/removal counts and identity
overlap, root-vs-nested scrolling observations, and the actually executed
JavaScript file/function coverage **by movement phase**. It labels the
virtualization conclusion as *evidence-backed hypothesis*, not an
already identified algorithm. The second command writes the local
`analysis-summary.json` and `analysis-bundle.tar.gz` in the **same
ignored investigation folder**. Share the archive **privately in this
ChatGPT conversation** for source-level AI analysis; **do not commit it
to GitHub** without deliberate review and authorization. The bundle
includes collected JS source and structural traces, which may contain
page-specific information; it excludes browser profile, full network
response bodies, screenshots and private DOM snapshots by default.
Inspect it before sharing if the conversation is sensitive.

**AI-level next step once real evidence is available:** identify exact
message-ID/ordering logic, responsible JS functions and possible
virtualizer, inspect where the complete conversation originates
(client-side structured state versus network-pagination), and compare
the inferred mechanism with the user's Firefox observations. Only
then design a deterministic exporter: first prefer a complete,
verifiably ordered source of structured message data; otherwise use
DOM mount/unmount events with identity-based deduplication, explicit
coverage checks and content serialization while each node is mounted.
A generated archive must preserve content types and media and pass
physical first/last-message, order, count and rendering checks.
**No specific algorithm is certified in advance.**

## Confirmed physical evidence from committed `live-08` diagnostic

The operator committed `diagnose-live-08.jsonl` at PoC 069 HEAD
`e564173a827a939f7e250c5b179ba329ec9b1422`. This contains
two **diagnostic summaries**, not the private PNGs or full checkpoint JSON.

- Amazon: 37 checkpoints, **28 content-aligned**, 8 with
  `content-reflow`, 1 source-unstable; the beginning is photographed in
  both phases and `replayComplete=true`. The occasional reflow is
  explicitly *not* interpreted as pixel-perfect MHTML fidelity.
- ChatGPT: 31 checkpoints, **31 with `content-reflow`**, none
  content-aligned; source screenshot `minTop=17102`, while the
  manual phase **observed and photographed top=0** and the replay did
  **not**. `replayComplete=false`, with unrecovered virtualized
  scroll jumps. In sampled message identities the replay omitted
  **16 user prompts and 12 assistant responses** observed manually.
  The original and MHTML scroll selectors matched; the archive's
  numerical scroll position matched, but 31/31 text comparisons were
  nonuniform. In the earliest six checkpoints, measured median shifts
  were 534–586 CSS px with spreads of the same order. **This is not
  a single uniform offset** and cannot be repaired merely by adjusting
  MHTML `scrollTop`.

These measured results identify **two independent defects**:
the fresh-page automated replay does not traverse the first part of
ChatGPT, and the reopened native MHTML reflows its captured DOM.
The browser-original manual screenshots exist **locally** in the
gitignored `evidence/live-08/chatgpt-share/manual/` and represent a
more faithful visual reference than the replay or native MHTML pair.
The committed diagnostic is not itself image evidence.

To review the genuine original screenshots **without a new live run**:

```sh
git pull --ff-only
sh view.sh live-08
```

Open the printed **Sorgente originale ChatGPT** local link. The
`generate-collage.mjs` viewer preparation reads existing manual
`manifest.json`, numbered checkpoint metadata and PNG file
existence, and optionally `report.json`, then generates
`manual/source-review.html` alongside the unchanged originals.
The browser displays the original PNGs in **chronological order**
with no crop, MHTML substitution or coordinate-based stitching.
It identifies the manually photographed top and provides a shortcut
to it, distinguishes all observed message identities from those
intersecting the viewport in **stable** manual screenshots (not proof
that overlays did not hide text), and separately reports identities
missing from the replay.
Repeated frames and potential screenshot gaps remain visible; the
viewer **does not claim complete textual or image coverage** when
the user scrolled more quickly than the sampler recorded.
The original `manual/manual.html`, MHTMLs, PNGs, reports and old
`collage.html` evidence are preserved. Amazon's original visual
pipeline has not changed.

This work unit does **not** fix the inherent layout reflow in the
native ChatGPT MHTML. Do not silently promote a manual PNG montage
to a self-contained MHTML or claim that the missing ChatGPT beginning
has been recovered in the *replay*; the now-prominent manual evidence
and replay remain explicitly separate.

## Investigate severe ChatGPT misalignment using the existing run

Latest user feedback after the explicit Playwright `ignoreHTTPSErrors`
setup: **Amazon is aligned, while ChatGPT is completely misaligned**.
This is a visual observation on the workstation, not yet a verified
classification of the source screenshot, MHTML DOM, scroll selector,
text-anchor reflow or collage join. In particular, the previous strategy
of correcting the reopened archive's numerical scroll offset cannot
repair missing, virtualized or differently laid-out content.

**Before changing the capture or making the user repeat the long run**,
inspect the existing private evidence locally:

```sh
git pull --ff-only
node diagnose-run.mjs live-08
```

Use `live-08` only if that is the actual existing run identifier; the
command **reads existing files and never starts Chromium, overwrites
evidence or creates a new run**. It compares the Amazon and ChatGPT
checkpoint diagnostics, prints category and independent cause-signal
counts, identifies the first misaligned checkpoints, reports whether
the original source shifted while being captured, and contrasts
confirmed scroll-top coverage and sampled user/assistant message
presence. It highlights when the MHTML reopened with a **different
scroll container**, when matched text anchors show **nonuniform
reflow** versus a correctable offset, and when the content identities
are simply unverified. It never reads or prints user prompt text,
MHTML contents, DOM dumps or screenshots.

A `contentAligned=null` checkpoint is **unverified**, not evidence of
successful alignment, even if `positionAligned=true`. A geometrically
reached `scrollTop=0` also does not prove that the virtualized
ChatGPT conversation beginning is present. The next design change
must follow the physical evidence; do not tune generic Amazon
scroll/CSS behavior based solely on the ChatGPT result.

## Most recent ChatGPT limitations and coverage instrumentation

User inspection after the human-observation update: **Amazon visual alignment is
almost always correct**; **ChatGPT user prompts are now visible**; nevertheless
**ChatGPT's archived/reopened image alignment remains poor** and the beginning
of the conversation is repeatedly missing. These are direct visual reports,
not an uploaded screenshot diff or a verified complete replay. Do not infer
that ChatGPT's original manual source lacks the beginning, or that the MHTML
scroll coordinate necessarily represents the same virtualized content.

Current corrective changes leave Amazon's rendering and native MHTML untouched:

- Long virtualized reverse scrolls have a **distance-dependent replay step
  budget** rather than a fixed 100 checkpoints. Failure to reach the target
  after that budget is recorded explicitly as
  `replay.step-budget-exhausted`, not mislabeled as completed coverage.
  Actual top content remains an independent physical/semantic check.
- MHTML content correction retains the source's multiple unique text-anchor
  requirements; shifts above 100 CSS pixels are eligible only with **three
  or more consistent anchors**, spread at most 2 CSS pixels, and a correction
  within the measured source viewport height (capped at 1200 CSS pixels).
  It scrolls only the reopened archive, without modifying original screenshots
  or serialized MHTML. Unsupported reflow remains unaligned.
- Manual observation and replay now separately record **minimum observed and
  captured top scroll positions**, and the comparison reports whether each
  phase actually photographed the geometric top. A coordinate of zero is
  not proof that the virtualized conversation is semantically complete.
  The terminal prints `[COPERTURA]` with these distinct measurements.
- The new regression tests cover the longer budgets and bounded large-offset
  correction. The existing full-tile collage is unchanged.

The new behavior has **not** been physically validated in the user's Chromium.
Use a distinct new run name only after confirming prior run names are unused;
preserve every existing evidence directory.

## Current workflow: preserve human observation before replay

The important user correction is that **ChatGPT user prompts are visible while
the human scrolls**. In older runs the human-controlled page was closed without
capturing its content: only wheel/scroll events were preserved, followed by
screenshots from a newly navigated replay page. This could not show where the
missing user prompts were lost.

The new `observe.js` emits passive samples during the manually driven page:
scroll position, DOM-mutation revision, image/font state, resource count and
visible message roles and hashed signatures (no raw prompt text in diagnostic
JSON). `manual.mjs` asynchronously polls the source browser while the user
navigates, captures original viewport PNGs at observed quiescent points (and
provisional overlapping samples during continued activity), and uses the
existing **persistent web-control level-3 CDP debugger session** to watch
network request start/finish/failure. Overflow or unavailable network
observation is reported, never silently treated as complete. All PNGs and
metadata are private, gitignored files under each site's `manual/` directory.

After Enter, the original page's observation log is saved and the PoC still
creates an independent replay page. Replay checkpoints also record hashed
user/assistant identities, and the report compares distinct observed manual
signatures against those actually present in replay. Missing prompts are
reported explicitly; if the current page has no recognized role attributes,
the result is **unverified**, not "zero prompts". A match covers only sampled
messages and is **not proof that a whole virtualized conversation was captured**.
Role coverage is checked only on ChatGPT, not Amazon.

The replay now waits for a **bounded quiet period in DOM state, geometry and
image/font readiness** after scroll inputs rather than relying solely on the
previous fixed 900 ms pause. A timeout produces an incomplete checkpoint and
does not fabricate successful loading. This replay gate does **not yet verify
network quiescence**: the network lifecycle is currently measured during the
manual observation phase; that limitation is recorded in the readiness
diagnostics.

The `live-05` regression `replay.visible-scroll-extent-unavailable` was
triggered by a high text-occlusion estimate. The corrected stride is bounded:
occlusion reduces overlap progression but can no longer exhaust a valid
scrolling viewport. The DOM hit-test also restricts obstruction estimates to
the lower part of the view.

To compare the two stages after an actual **new unused** run, use
`sh view.sh <run>`, then open the **Navigazione manuale** and **Confronto**
links printed by the viewer. The pages serve only the explicit screenshot and
diagnostic allowlist over loopback; private MHTML/DOM profiles are not served.
Older `live-01`–`live-05` runs are retained without inventing any earlier
manual PNGs. No archive, CSS, browser screenshot or historic evidence file is
modified by this update.

## Corporate TLS / local trusted CA (npm Playwright setup)

At the user's company workstation, the first attempted `live-07` ended
**before Chromium or any page acquisition** while npm was installing
`playwright`:

```text
npm ERR! SELF_SIGNED_CERT_IN_CHAIN
request to https://registry.npmjs.org/playwright failed
```

The PoC's isolated provider installation now sets
`NODE_USE_SYSTEM_CA=1` **for the npm install subprocess only**, unless
the operator explicitly supplied another value. Node 26 can thereby
trust root CAs already installed in the operating system in addition to
its bundled roots; **TLS certificate validation stays enabled**.
The launcher preserves any explicitly set `NODE_EXTRA_CA_CERTS` or
`npm_config_cafile` values and does not copy certificates or npm
configuration into the repository.

For a workstation with its corporate CA already trusted by Linux, use
the normal new-run command below. If the corporate CA is **not** in the
system trust store, use a trusted company-provided PEM bundle, for example:

```sh
NODE_EXTRA_CA_CERTS=/path/to/approved-company-ca.pem sh run-live.sh live-07
```

The path above is a placeholder, not a discovered path. Ask local IT
for the approved CA if necessary. Avoid `strict-ssl=false` and
`NODE_TLS_REJECT_UNAUTHORIZED=0`. If a trusted corporate npm registry is
required, configure it through the local authorized npm settings rather
than changing or bypassing repository security defaults.

The **first** attempted `live-07` (npm certificate failure) did
not create evidence. The **later** attempted `live-07` (successful
Playwright setup followed by Chromium certificate failure) **did** create
`evidence/live-07/`. Consequently `live-07` is no longer available
for reuse. Preserve all previous evidence and use a new run identifier.

## Corporate workstation: explicit Playwright HTTPS override

On 2026-10-19, `live-07` passed **45/45 native Node tests**, and Chromium
started successfully, but navigation to Amazon and ChatGPT both failed with
`net::ERR_CERT_AUTHORITY_INVALID` on the corporate network. The run created
`evidence/live-07/`, which must be preserved and **never reused**.

At the user's explicit request, the PoC now enables **Playwright's
`ignoreHTTPSErrors: true`** for its one isolated, temporary Chromium
persistent context. The pinned `pwc-web-control` provider implements this
through its default-off, provider-specific environment option
`WEB_CONTROL_IGNORE_HTTPS_ERRORS=1`. `run-live.sh` enables it only for
the subprocess and browser profile belonging to this PoC, and logs the opt-in.
Other provider/browser installations continue verifying HTTPS certificates
by default. Chromium sandboxing remains enabled.

**Security tradeoff:** the experimental browser will no longer reject
untrusted server TLS certificates, including those of the two authorized
sites. Do not use this isolated session for unrelated sensitive browsing,
credentials, or production traffic. Node/npm TLS verification is separate:
the established `NODE_USE_SYSTEM_CA=1` behavior remains for dependency
installation and does not globally disable npm HTTPS verification.

The previous temporary NSS certificate-import approach (`PWC069_CA_CERT`)
has been removed from the launcher. No IT-issued certificate, `certutil`,
extra Chromium flags or changes to the real HOME are needed for this override.
The launcher advances the **existing PoC-private, pinned provider clone**
forward-only from the previous verified provider commit to the new exact pin.
It preserves its `node_modules`; dirty or divergent clones fail safely,
without a force operation.

## One physical run

On the Linux VM, from the PoC directory:

```sh
git pull --ff-only
# Only after checking the next run name is unused:
sh run-live.sh live-08
```

Requires working visible Chromium, Node 26, npm, git and outbound access to
clone/install the current independently versioned `pwc-web-control 0.1.6`
provider on its first use. The launcher uses the **verified provider HEAD**
`2e1759e994f52000975c6383b8cc7b229cd1b425` once under this PoC's
ignored `.runtime/pwc/`, installs its pinned Playwright runtime and starts
its normal controller with a disposable PoC-owned browser profile. It does
**not** change any default installed `web-control` provider or use a personal
browser profile. It waits for `[PWC_READY]` before proceeding.

A short-lived Unix IPC socket and symbolic alias have short names under the
system temporary directory because deep checkout paths exceed Linux socket
name limits. **All files (including browser profiles, temporary file data,
snapshots, manifests, logs and site output) physically reside under this PoC**
or are removed on cleanup. There is no exported reference to any desktop file
portal, and the PoC never launches a file chooser to open evidence.

### During the run

1. **Amazon wishlist** opens in the visible Chromium window.
2. Before manual scrolling begins, the PoC saves the original visible
   viewport. Then explore the content **in whichever direction you need**
   (including down to the bottom then up to the beginning), expanding safe
   sections if relevant. While you scroll, it passively captures additional
   PNGs and activity/message signatures under `manual/`, without steering
   the page or taking focus. When finished, press **Enter in the terminal**.
3. The PoC saves the observed raw wheel/scroll/disclosure events in
   `events.json` and derives an ordered `plan.json`. Wheel direction is
   respected; the plan is **not** replaced with a hard-coded forward scan.
4. Chromium opens the page again; the replay starts at the demonstrated
   starting position and follows the inferred directions/target boundaries.
   It captures original native Chromium MHTML, DOM serialization (clearly
   marked as **not** a complete offline HTML archive), CDP DOMSnapshot/CSS and
   a viewport PNG at every reached checkpoint.
5. Each unmodified MHTML is **opened directly by the same Chromium provider
   via its actual PoC `file:` URI**. The reopened rendering gets its own PNG
   and a CSS/image observation; failure is recorded rather than hidden.
   No HTML/CSS asset-reference rewriting or viewer proxy is used **to
   open native MHTML**. The separate, post-run loopback viewer serves only
   screenshot comparisons and collage images.
   At the end of the site, the PoC **opens its screenshot-only comparison
   directly in the same visible Chromium** using the actual PoC-local file
   URI. You inspect the two renderings side by side and press **Enter** to
   continue, before it switches to the next site. Then Chromium also
   opens the native `overall/page.mhtml` of the **final replay state** for
   direct visual inspection. Neither the desktop file manager nor a document
   portal is involved. The `overall/page.mhtml` is a single unmodified
   snapshot of the final DOM, **not** a fabricated merge of virtualized
   states, and is not certified to contain every previously visible node.
6. The process repeats for the **long ChatGPT shared conversation**:
   `https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835`.

The other exact URL is
`https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3`.

### Result layout

All persistent files are underneath this checkout, for example:

```text
pocs/069-web-page-analyze/
  evidence/live-06/   # illustrative new name, only if unused
    amazon-wishlist/
      manual/
        manual.html           source browser screenshot gallery
        manifest.json         role signatures and network event status
        0000.png              first human-visible screenshot
        0000.json             message hash and scroll diagnostics
        ...
      events.json
      plan.json
      report.json
      comparison.html
      collage.html           original browser viewport fragments, not HTML of the site
      overall/
        page.mhtml           native final-DOM MHTML, opened in Chromium
        manifest.json        snapshot coverage and original page metrics
      states/
        0000/
          page.mhtml            original Chromium MHTML
          page.html             raw DOM serialization; not self-contained
          dom-snapshot.json     CDP DOM/layout/computed CSS
          original.png          online viewport
          reopened.png          direct native MHTML reopened viewport, if supported
          capture.json
          offline.json
        ...
    chatgpt-share/
      ... same structure ...
    summary.json
  .runtime/
    pwc/                     locally cloned provider, ignored from Git
    service-live-01.log
```

The `comparison.html` file is **only a screenshot comparison** with
relative image links within this PoC. It is never presented as the original
HTML page. The native MHTML is opened directly by Chromium as part of the
experiment.

### Reopen evidence after the browser trial — no desktop portal

**Do not double-click `comparison.html` in the desktop file manager.**
On Linux this may route the file through a temporary document portal alias
such as a temporary `file:` document-portal URI: its relative
screenshots no longer resolve against the original PoC folder. This is
a *desktop file-opening problem*, **not** a write location chosen by the PoC.
Original MHTML and screenshot files are already in the correct PoC directory.

Instead, from this PoC checkout:

```sh
sh view.sh live-02
```

This **does not rerun Amazon or ChatGPT**. It builds/rebuilds only the
derived screenshot collage and starts a private read-only
`http://127.0.0.1:<port>/` browser viewer. Open the exact HTTP URLs
printed in the terminal for Amazon and ChatGPT comparisons and collages.
As long as `view.sh` runs, the references resolve against the original
PoC evidence directory; it can be stopped with Ctrl+C and restarted later.
For the already captured `live-04` evidence, use `sh view.sh live-04`.
This regenerates only the comparison collage; it does not repeat the browser run.

The loopback viewer allows only generated comparison/collage HTML,
screenshot PNGs and their small diagnostics; **raw private MHTML, DOM HTML,
browser profiles and arbitrary filesystem paths are not published** by
the server. No data is uploaded and no native MHTML is rewritten.

The **default collage view** now preserves the **entire photographed scroll
container** from every checkpoint. Overlapping checkpoints intentionally repeat
some text: no vertical content is trimmed merely because absolute `scrollTop`
coordinates overlap. It keeps geometrically unstable checkpoints too; when
the scroll-container rectangle is missing, that checkpoint appears as a whole
viewport image. Fixed page chrome is excluded only when the measured inner
scroll rectangle is available. The previous coordinate-trimmed composition
remains available in a collapsed `<details>` section labelled **experimental**:
it can lose small text fragments at seams when ChatGPT virtualization changes
the rendered layout without changing reported scroll geometry.

Both views preserve checkpoint provenance, and only the experimental compact
view claims provisional coordinate intervals. Neither view can recover content
that was never captured, prove actual visual continuity, merge MHTML internals
or restore text removed from the virtualized DOM. The new default mode is a
conservative **montage with deliberate repetition**, not a verified seamless
page. Runs `live-01` and `live-02` without viewport geometry still fall back
to full-screenshot timelines.

### Small missing fragments at collage seams

After viewing the regenerated `live-04` collage, the user reported
**small missing portions between adjacent tiles**, not necessarily the large
unacquired scroll ranges diagnosed from the log. The cause cannot be
proved without the private image pixels, but the existing coordinate-only
greedy strip trimming can discard genuine visible text because the
virtualized ChatGPT DOM changes its spatial relationship to `scrollTop`.

The default `collage.html` now conservatively displays every full captured
scroll-container viewport. No coordinate-based vertical cut is applied to
that default montage, so all already-photographed pixels remain accessible.
Repeated overlap is intentional. The old compact coordinate-trimmed view is
available only by expanding the experimental section, and is not a reliable
completeness reference. Existing `live-04` evidence can be rendered again
with `sh view.sh live-04`: no new browser replay or MHTML modification is
needed. This change addresses **collage presentation loss only**, not absent
source captures or the independently observed live/MHTML offset.

### Current priority: missing captured conversation, not collage overlap

The user's latest inspection confirms **all overlaps in the conservative
montage look correct**, but **large portions of the conversation are
missing near the beginning and between the first two tiles**. Do not
modify tile cut positions as a substitute for missing acquisition.
`live-04` stopped near `scrollTop=12999` and never reached zero;
ChatGPT also shifted its virtualized content during a reverse scroll.
These findings establish incomplete capture, not the exact amount or
identity of lost text. The first two displayed tiles may be adjacent in
scroll coordinates without containing adjacent chat text.

The changes to native-wheel replay, smaller overlapping scroll steps,
anchor-based seam diagnostics, and occlusion handling were committed
**after** `live-04` and are still not validated on the user's VM. The
next relevant check is a new unused acquisition (e.g. `live-05`),
not repeated regenerations of `live-04` collage. It must physically
reach the conversation beginning and demonstrate text continuity before
the ChatGPT export can be accepted.

### Residual defects after conservative montage

The user reviewed the conservative collage of the pre-existing `live-04`
screenshots and confirmed a **much better result**, with two remaining
observations:

1. In one tile, ChatGPT's bottom writing/composer box visually covers a
   line, which cannot be read in either that tile or the following one.
   The original screenshot may not contain those visible pixels; simply
   extending an image crop cannot restore text that the UI occluded.
2. There is a **large textual discontinuity between the first and second
   tiles** when sorted by vertical position. For `live-04` those are
   likely checkpoints `0017` (scrollTop `12999`) and `0016`
   (`13242`), with only `243` CSS pixels of numeric displacement, but
   checkpoint `0017` immediately followed an anomalous scroll jump and
   recovery. Thus numerical overlap is **not** evidence of matching text.

The collage now computes a read-only **text-anchor seam diagnostic** from
`capture.json` for each pair: it compares either older path/fingerprint
anchors or newer rendered-text/line anchors. If two matching anchors are
unavailable, the join is marked as unverified; if their motion conflicts
with the reported scroll displacement, it reports possible discontinuity.
These diagnoses do not read image pixels and cannot reconstruct absent text.

For future live captures, `live.mjs` uses DOM hit-testing to count text
rectangles actually covered by other visible page elements, and estimates
the obstructed portion near the bottom of the scroll viewport. It reduces
the next scroll increment accordingly, records `obscuredText` in
`capture.json`, and refuses to mark a run as complete if covered text
remains or could not be checked. The conservative collage also reports
such occlusion measurements. This *does not alter* ChatGPT's CSS, DOM,
MHTML archives or saved screenshots and may still be insufficient against
dynamic virtualization: physical browser validation is required.

For `live-04`, no new pixels can be created by regenerating the collage.
The existing MHTML/DOM snapshots may contain some text beyond what the
screenshot visibly shows, but that has **not been established**, and the
viewer deliberately does not expose private raw DOM/MHTML through HTTP.
Inspect those original files locally if a particular lost line needs
forensic recovery. A new trial, if undertaken, must use an unused run
name (e.g. `live-05`) and must not overwrite older evidence.

### Current physical findings and corrections (live-04)

The user already ran `live-04` from committed PoC HEAD
`127c3628c23a979b04ee0c5a59bc9371cc0c6bc0` on the Linux VM.
**All 20 Node tests passed for that revision**; these unit results
did not prove visual equivalence. Amazon replayed to its bottom and
reported `captured`. ChatGPT demonstrated `down→bottom, up→top`,
but the reverse scan acquired only states `0000..0017`, ending around
`scrollTop=12999`, and reported `incomplete`. Its observed reverse-scroll
disturbances included `13242→15939` (partially recovered) and
`12999→17041` (not recovered). The start of the conversation was **never
reached**. The screenshot collage cannot restore content that was not
captured. The user also reports a **worse** live/reopened screenshot offset.

Every printed `contentAligned=null` and `contentShift=undefined` means
that the earlier DOM-path matching mechanism was **not able to verify
the content offset**; `mhtmlAligned=true` in those logs checked only
scroll geometry. The old checkpoint JSONs may reveal whether the source
had no anchors or the MHTML changed element paths, but the exact
private screenshots/JSONs are not uploaded to this repository.

The next code revision changes only the experiment:

- content anchors now identify **unique rendered text runs** by
  a hashed text signature and selected line, not a brittle DOM element
  path. Duplicate text is excluded. A correction remains bounded and
  is applied only if multiple matching anchors show the **same** small
  translation. Reflow and absence of matches are explicitly reported.
- a wheel-demonstrated replay uses Chromium's actual CDP mouse-wheel input
  over the recorded scroll container instead of repeatedly assigning
  `scrollTop`. Other demonstrated scroll inputs retain the deterministic
  absolute movement. The smaller step is 45% of the **visible content
  rectangle** (not 80% of an outer viewport) to create capture overlap,
  reduced further when DOM hit-testing detects text obscured at the bottom.
  Nonprogress still fails honestly, and large scroll jumps remain
  explicit gap evidence rather than certified continuous coverage.
- regenerated collage HTML now **shows missing leading and trailing
  intervals**, not just internal gaps. Opening the old `live-04`
  collage after this revision does not create any missing screenshots.

These changes have **not yet been exercised in the user's Chromium**.
They do not modify native MHTML, rewrite archive CSS or retroactively
replace the private `live-04` screenshots. A new acquisition needs a
distinct unused run name such as `live-05`.

**No captured account data, MHTML, screenshots or browser profile files
are committed to GitHub.** The `evidence/` and `.runtime/` directories
are ignored. Output folders are immutable by name; use another run name
for a new attempt.

## Observed first live run and the next correction

The actual user-run `live-01` successfully started the isolated visible
PWC provider and passed the initial four action-planning tests. Amazon
completed a down-to-bottom replay and displayed the screenshot comparison,
but **intermediate original screenshots appeared scrolled back to the top**.
ChatGPT recorded `down→bottom, up→position, down→position, up→top` but
stopped on `replay.start-position-was-restored-or-drifted`, so no comparison
was produced for it. These are negative physical findings, not accepted
capture evidence.

The updated `live.mjs` now:
- **captures the original viewport before** native MHTML and DOMSnapshot,
  and records observed scroll coordinates before/after screenshot and native
  archive separately;
- refocuses the replay page after reopening each native MHTML, restores and
  checks its intended scroll position; separately aligns the *reopened*
  MHTML viewport, since MHTML archives do not preserve live scroll offsets;
- **retries late ChatGPT SPA scroll restoration** before the baseline instead
  of aborting on the first displaced offset; continues retaining labelled
  partial checkpoints/comparisons when subsequent replay fails;
- saves `overall/page.mhtml` from the final DOM **without rewriting** and
  opens it in Chromium after the screenshot comparison. The experimental
  `Network.setBlockedURLs` filter from `live-02` has been **removed**:
  in `live-01` the user confirmed MHTML displayed correctly without that
  filter, whereas both sites were visually degraded in `live-02`. MHTML
  reopening now again uses normal Chromium navigation. Because network
  availability is not forcibly disabled, this is a **visual reopening**
  check, not proof that the archive is self-contained without internet.

The capture report prints `[STATO]` with the intended position, before-focus
position, screenshot position, position after native archival, restoration
status, and offline-viewport alignment. These
diagnostics distinguish an actual source-page jump from a screenshot whose
reopened counterpart is merely at the wrong scroll offset.

**Actual `live-02` result:** Amazon completed `down→bottom, up→top`
through checkpoint `0038` with identical intended, screenshot and
post-archive scroll coordinates. The in-run comparison *appeared* to have
broken styles; the user subsequently clarified that the **same original
MHTML displayed perfectly when opened directly in Chromium after the run**. ChatGPT successfully
aligned its starting position near the bottom (`26925`) and captured
checkpoints `0000` through `0016`, then stopped around scrollTop `13242`
with `replay.opposite-direction`. During the run its previews showed
the same apparent CSS issues; the user later clarified that **native MHTML
itself still renders correctly when opened directly in Chromium**. What
remains unverified is the in-run opening/visual comparison mechanism,
the missing virtualized chat segments and the screenshot offset. Neither
`[ESITO] amazon-wishlist captured` nor a successful standalone MHTML
proves complete content coverage.

The next revision retains ChatGPT's confirmed initial alignment, Amazon's
validated `down→up` trace and the existing screenshot comparison/final
MHTML opening. It removes only the newly introduced offline-request blocker,
records comparable live/reopened stylesheet and body computed-style evidence,
and gives dynamically shifting scroll containers **up to four bounded
directional recovery attempts** before marking a phase incomplete. It never
changes an inferred `up` into a `down` scan. Recovery attempts are saved
in the replay's `disturbances` array, including whether progression was
recovered. Partial states and an incomplete coverage flag are preserved.

The `live-04` trial is already completed and revealed genuine missing coverage.
Preserve all existing private runs. The new wheel/overlap and rendered-text
alignment changes are not yet physically validated; never label the existing
`live-04` output as a successful complete ChatGPT export.

## Acceptance and current limits

This is a **live site experiment**, not an already proven general exporter.

The operator must inspect `summary.json`, each `plan.json` and
`comparison.html`. Specific checks: demonstrated direction transitions
(including reverse traversal), state coverage, fidelity of images/fonts/CSS,
and whether native MHTML reopens visually in Chromium. The current
reopening path is **not network-isolated**, so no independent offline
resource-completeness guarantee is made. A `complete:true` status means
all recorded phases and captures passed the
mechanical gates; it does **not** assert visual equivalence or completeness
of the underlying site content. A skipped control, DOM/mapping mismatch,
failed MHTML reopen or unstable checkpoint must be reported, not hidden.

The first release only replays the **most demonstrated scrolling container**
and safe, currently visible `summary` or expandable buttons. Other
containers and actions are explicitly reported in `plan.json` or
`report.json` as gaps. The recorder deliberately never captures typed
field values or cookies. JavaScript-driven navigation during a demonstration
may reset its in-page event buffer and must be reported as a failed
observation rather than falsely accepted.

Nothing in this PoC implements native Chromium "Save Page Complete" HTML
with its companion resources. It instead evaluates the documented native
MHTML archive and the separate CDP evidence. This distinction is deliberate:
the output is not a hand-built page whose resource references might be
wrong.
