# PoC 069 — web-page-analyze: live Amazon + ChatGPT

**Status: `live-01` through `live-05` are confirmed executed; the user subsequently reports physical feedback consistent with a further run of the human-phase capture revision: Amazon is almost always aligned, ChatGPT user prompts are visible, but ChatGPT source/MHTML alignment is poor and its beginning is still missing. The exact new run identifier and private checkpoint diagnostics have not been supplied. The latest top-coverage and MHTML correction changes remain physically unvalidated.**

This is an experimental browser-analysis PoC built **directly on the two
authorized real pages**. All prior fixture experiments, their tests and the
fixture CI workflow were removed from the current tree. It preserves native
MHTML unmodified. The generic *visual collage* now combines **only original
browser screenshot fragments**, with provenance and explicit missing ranges;
it does not reconstruct HTML/CSS or purport to be one complete MHTML document.

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

The attempted `live-07` shown in the log did **not** create
`evidence/live-07`: `run-live.sh` validates the unused evidence name
before any npm installation. The same name may be reused only while no
such evidence directory exists. Previous evidence stays untouched.

## Corporate workstation Chromium certificate trust

The user reran `live-07` on the work host on 2026-10-19 with
`NODE_USE_SYSTEM_CA=1`. Playwright installed, Chromium started, and the
**native Node test runner passed 45/45**, but the **browser itself** failed
to navigate to *both* authorized pages with
`net::ERR_CERT_AUTHORITY_INVALID`. Both results were incomplete and the
PoC created `evidence/live-07/`, so `live-07` must **never** be rerun or
overwritten. This is distinct from the earlier npm TLS trust failure.

On Linux, Chromium uses a certificate store including NSS; it does not
necessarily use the same root CAs selected by Node's
`NODE_USE_SYSTEM_CA=1`. The PoC launcher now supports a **single
explicit, approved corporate root CA file** for *Chromium*:

```sh
# Replace the placeholder with the real IT-approved PEM/CRT file path.
PWC069_CA_CERT=/absolute/path/company-root-ca.pem sh run-live.sh live-08
```

`live-08` is an example only if it does not already exist. The operator
must first identify the approved certificate path. On Linux, the
`certutil` command from the NSS tools package is required (usually
`libnss3-tools` on Debian/Ubuntu). Without the selected CA or `certutil`,
the launcher exits with a specific error rather than disabling TLS.
`NODE_USE_SYSTEM_CA` and `NODE_EXTRA_CA_CERTS` continue to apply
separately to Node/npm, not automatically to the Chromium NSS database.

The launcher creates three compatibility-specific NSS stores, all **inside
its private `.runtime/session.*`**, and imports the explicitly selected
corporate CA with TLS issuer trust `C,,`. It runs only this PoC's browser
controller with a temporary HOME pointing to that session. After the run,
the temporary NSS databases are removed by the existing cleanup trap.
No root CA is added to the real user HOME, global NSS database or system
trust store, no certificate bytes are put in GitHub, and neither
Playwright `ignoreHTTPSErrors` nor Chromium
`--ignore-certificate-errors` is used.

Chromium's official Linux certificate management reference:
https://chromium.googlesource.com/chromium/src.git/+/master/docs/linux/cert_management.md

## One physical run

On the Linux VM, from the PoC directory:

```sh
git pull --ff-only
# Only after checking the next run name is unused:
sh run-live.sh live-07
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
