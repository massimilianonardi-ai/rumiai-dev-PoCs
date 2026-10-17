# PoC 069 — web-page-analyze: live Amazon + ChatGPT

**Status: live browser test ready for the user's VM; not yet physically accepted.**

This is an experimental browser-analysis PoC built **directly on the two
authorized real pages**. All prior fixture experiments, their tests and the
fixture CI workflow were removed from the current tree. There is no generic
fake website, independent HTML/CSS restyling, screenshot collage masquerading
as the original website, or old PoC 068 code.

## One physical run

On the Linux VM, from the PoC directory:

```sh
git pull --ff-only
sh run-live.sh live-01
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
   No HTML/CSS asset-reference rewriting, remote download, or local viewer
   proxy is used.
   At the end of the site, the PoC **opens its screenshot-only comparison
   directly in the same visible Chromium** using the actual PoC-local file
   URI. You inspect the two renderings side by side and press **Enter** to
   continue, before it switches to the next site. Neither the desktop file
   manager nor a document portal is involved.
6. The process repeats for the **long ChatGPT shared conversation**:
   `https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835`.

The other exact URL is
`https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3`.

### Result layout

All persistent files are underneath this checkout, for example:

```text
pocs/069-web-page-analyze/
  evidence/live-01/
    amazon-wishlist/
      events.json
      plan.json
      report.json
      comparison.html
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
HTML page. You may open the comparison with Chromium directly, passing its
`file:` URI as a browser navigation target, without invoking a desktop file
manager or document portal. The actual MHTML is directly opened by the
replay browser as part of the experiment.

**No captured account data, MHTML, screenshots or browser profile files
are committed to GitHub.** The `evidence/` and `.runtime/` directories
are ignored. Output folders are immutable by name; use another run name
for a new attempt.

## Acceptance and current limits

This is a **live site experiment**, not an already proven general exporter.

The operator must inspect `summary.json`, each `plan.json` and
`comparison.html`. Specific checks: demonstrated direction transitions
(including reverse traversal), state coverage, fidelity of images/fonts/CSS,
and whether MHTML reopens in Chromium without network dependencies. A
`complete:true` status means all recorded phases and captures passed the
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
