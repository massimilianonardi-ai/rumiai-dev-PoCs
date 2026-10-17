# PoC 069 — web-page-analyze

**Status: first controlled browser probe implemented; full URL/resource fidelity not yet accepted.**

This working name identifies a **generic browser-page analysis experiment**, not a new installed RumiAI command or API. Its purpose is to determine how a user makes an arbitrary website reveal relevant content, then replay the *learned intent* from a fresh page and capture evidence faithful enough for later export. Start from the current independent `web-control` observation/control facility; do not duplicate its browser mechanics.

## First controlled probe (2026-10-17)

The first executable experiment is `experiment.py`, backed by a self-contained
local web fixture in `fixture/` (HTML document, **relative CSS**, relative SVG,
relative JavaScript and an independently scrollable area that progressively
reveals 24 items). `tests/test_experiment.py` protects the down→up
direction change and actually exercises Chromium and CDP on a controlled
in-memory copy of that fixture.

The script is **experimental instrumentation**, not a new `web-control`
provider, installed product command, site exporter or generic event recorder.
The real fixture uses local HTTP; on the hosted auxiliary Linux environment
the browser navigation to even localhost is blocked by its administrator, so
a deliberately degraded `--embedded-host-test` option inserts the fixture
directly into Chromium and explicitly disables external-resource acceptance.

Supported invocation from this PoC directory, in an environment with a
system Chromium and Python `playwright` 1.57.x:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
python3 experiment.py --mode scripted --run control-http-01
```

No `HOME`, `/tmp` or desktop-portal path is selected as an artifact
directory. The sole persistent output is created in this **exact PoC** under
`evidence/<new-run-name>/`, which is gitignored. An existing run cannot be
overwritten. The `--mode manual` option uses the same local page but allows a
person to demonstrate a bottom→top journey; the only prompt is Enter to end
recording. This initial probe intentionally targets the known fixture
`#scrollbox`, not arbitrary website scroll containers. Do **not** apply it
to Amazon/ChatGPT until the native resource and observed-direction gates pass.

For each replay state, it writes the **unmodified native Chromium MHTML**,
separate **DOM serialization** (`dom.html`, explicitly *not* a complete offline
page), **CDP DOMSnapshot**, **viewport screenshot** and `manifest.json`.
The `demonstration.json` retains the actual individual scroll-event samples
and the inferred **ordered direction phases**, rather than imposing one
scroll direction. `report.json` distinguishes the embedded auxiliary test
from the real HTTP/CSS test and never asserts unverified visual fidelity.
No HTML/CSS rewriting, MHTML parser, file-opening viewer or old PoC 068
machinery is used.

**Actual auxiliary-host result:** Chromium launched through real Playwright
mouse-wheel input and CDP MHTML/DOM capture, with observed/inferred directions
`down → up`. The initial replay showed 6 items at scrollTop 0; at the bottom
it showed all 24 at scrollTop 3715; on return to the top it showed all 24 at
scrollTop 0. Chromium's captured MHTML in this embedded mode includes HTML/CSS
MIME parts, but the CSS had been inserted directly by the fixture loader:
**this does not establish that a relative external stylesheet or SVG would
survive an HTTP-based save and offline reopening**. An additional **real Chromium** resource test (`tests/test_native_archive.py`)
uses the browser's normal resource-request path for the same fixture stylesheet,
with a controlled response supplied by Playwright because this hosted
environment blocks navigation. Chromium's `Page.captureSnapshot` MHTML
contained a separate `text/css` MIME part located at the requested resource
URL; the captured archive contained no `file:///` artifact reference.
This demonstrates **native MHTML resource packaging**, not correct offline
reopening, relative-folder complete HTML export, or pixel-level equivalence.

The run produced no validated native **Save Page Complete HTML** or
pixel-fidelity comparison. This is early research evidence, not full acceptance.

## Two independent problems

### 1. Record and understand the demonstration

The user navigates a real browser normally. Observe which scrollable containers are used; scroll **direction, start/end positions, reversals and sequencing**; clicks/expansions; lazy loading; viewport state; and changes that make content appear/disappear. Preserve the raw demonstration first. Build a higher-level, *testable* intent sequence without flattening it into a predefined top-to-bottom scan.

In particular, the user may **start at the bottom, scroll down to confirm the end, then traverse upward to the beginning**. A learned replay must preserve that demonstrated strategy if it is material. A generic automatic scan that ignores the demonstration is **not evidence of learning**. Compare the replay's direction, content coverage and action-dependent state changes to the original observation.

### 2. Acquire original browser rendering evidence

At the meaningful states of the **automatic replay**, acquire synchronized evidence from two independent sources:

- **Browser-native page archival** (investigate Chromium Save Page Complete and/or its MHTML snapshot) including the stylesheet, image and font resources the browser actually used. Determine experimentally which representation can be reopened reliably offline.
- **CDP DOM/layout/computed-style evidence**, viewport screenshot and original resource URLs. Record the state identity and acquisition interval so that a dynamic-page mismatch is visible, not silently merged.

Do not confuse `page.content()` with Chrome's complete-page save operation. **Do not rewrite CSS or resource URLs as a speculative repair** before establishing what the browser's native archive already preserves. Do not claim MHTML is pixel-perfect without comparing it with actual Chromium rendering.

## Outputs to evaluate, only after the base is proven

**Generic view:** a navigable aggregation of actual page states, using captured browser-native material as much as possible. Where merging would break layout or omit virtualized content, preserve separate states with source provenance. No invented dialogue or media order.

**Specialized-exporter research:** an evidence corpus for reconstructing scroll triggers, application states, virtualized elements, lazy loads and site component behavior. The corpus may support a later dedicated exporter; its implementation is **not** an initial PoC requirement.

## Minimal first acceptance

Use only the two authorized, concrete reference pages in private browser sessions:

- Amazon Wishlist: `https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3`
- ChatGPT long shared conversation: `https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835`

Before collecting either page again, build a **controlled local fixture** with scrollable/virtualized elements and known CSS/assets. The experiment must first prove that the recorded bottom-to-top interaction is represented faithfully in the inferred replay, and that Chromium-native archives preserve styles/resources when opened directly through a stable, PoC-owned path.

### Acceptance barriers

1. All experiment-owned files have verified physical paths **inside this PoC** and are never opened through desktop document-portal aliases; no hidden temporary browser-opening path may become an artifact reference.
2. No arbitrary browser-independent scroll convention replaces the recorded human behavior. Deviations must be justified and tested against the observation.
3. Saved HTML/CSS/asset references resolve exclusively to the archived PoC resources when an *offline* HTML artifact is claimed. Raw DOM serialization does not qualify.
4. Each state has a provable mapping between its native browser archive, DOM/CSS snapshot and screenshot. No result may be called visually faithful based only on successful file I/O or node counts.
5. Browser/session-sensitive evidence remains private and is not committed to a public repository by default.
6. If any checkpoint cannot be reproduced or the browser-native archive lacks crucial resources, classify the attempt as incomplete; do not add compensating renderers before understanding the cause.

No event recorder, replay, CSS converter, viewer or export generator has been carried over from PoC 068. The first small controlled fixture now proves reversible browser-input replay, but the **HTTP-based native CSS/SVG archival and offline-opening comparison remains the next gate**. The existing experiment is not general-purpose page analysis.
