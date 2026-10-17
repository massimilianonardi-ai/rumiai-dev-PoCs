# PoC 069 — web-page-analyze: live Amazon + ChatGPT

**Status: first physical two-site run completed; viewport/replay defects under correction, still not visually accepted.**

This is an experimental browser-analysis PoC built **directly on the two
authorized real pages**. All prior fixture experiments, their tests and the
fixture CI workflow were removed from the current tree. It preserves native
MHTML unmodified. The generic *visual collage* now combines **only original
browser screenshot fragments**, with provenance and explicit missing ranges;
it does not reconstruct HTML/CSS or purport to be one complete MHTML document.

## One physical run

On the Linux VM, from the PoC directory:

```sh
git pull --ff-only
sh run-live.sh live-03
```

Requires working visible Chromium, Node 26, npm, git and outbound access to
clone/install the current independently versioned `pwc-web-control 0.1.6`
provider on its first use. The launcher clones the **verified provider HEAD**
`403f4fa9bbea419715e9c834e847c6f2b60ae421` once under this PoC's
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
2. Manually explore the content, scrolling **in whichever direction you need**
   (including down to the bottom then up to the beginning), expanding safe
   sections if relevant. When finished, press **Enter in the terminal**.
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
  evidence/live-03/
    amazon-wishlist/
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
For a new trial use `sh view.sh live-03`.

The loopback viewer allows only generated comparison/collage HTML,
screenshot PNGs and their small diagnostics; **raw private MHTML, DOM HTML,
browser profiles and arbitrary filesystem paths are not published** by
the server. No data is uploaded and no native MHTML is rewritten.

The collage includes the **visible scroll-container content only**, excluding
fixed UI chrome, when `capture.json` supplies the scroll-container rectangle.
It arranges actual screenshot segments by observed scroll coordinates and
records their checkpoint sources, overlaps, unobserved top/bottom ranges,
drifting scroll extent and any unstable screenshots. Virtualized DOM content
may disappear or shift; consequently geometric continuity is **provisional**
and the collage does **not** falsely merge MHTML internals or claim to
recover invisible text. For `live-01` and `live-02`, which lack the
rectangle, it falls back to a navigable full-viewport screenshot timeline
instead of fabricating crops. Use fresh `live-03` evidence for scrollable
fragments and visual coverage diagnostics.

### Slight screenshot offset on ChatGPT

The user additionally noticed that **original/live** and
**reopened-MHTML/automated** screenshots show slightly different portions
of ChatGPT. Previously `reopen()` mapped the live scroll position as a
*percentage* of the source document's total scroll range to the MHTML
scroll range, introducing a pixel shift when the height changed. Now it
uses the **actual CSS-pixel scrollTop**, tests alignment and records the
source/archived scroll extents; a position unavailable in the reopened
MHTML is marked as *clamped/incomplete*, not force-matched by percentage.
The new behavior has not yet been physically confirmed by the user.

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

Use the new run name `live-03`. The private `live-01` and `live-02`
results remain untouched. This latest correction is **not yet physically
verified**.

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
