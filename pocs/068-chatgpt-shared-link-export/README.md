# PoC 068 — ChatGPT shared-link export with web-control

Status: Experimental. Not a published RumiAI command/package.

## Objective

Accept one ChatGPT conversation sharing URL as the only application-specific input, open it via the provider-neutral public web-control command, and archive the rendered evidence and extractable visible messages in immutable numbered local revisions.

This is a **site-specific deterministic adapter**, not a web-control provider, web-sense agent, ChatGPT account export, or API integration.

## Requirements

- Node.js 22 or newer.
- npm dependency installation in this directory.
- A configured web-control **compatibility level 2** provider (pwc-web-control or electron-web-control), with normal profile/service configuration.
- A public or otherwise accessible ChatGPT conversation sharing link; log in manually with the chosen browser profile if the workspace restricts access.

The exporter starts the configured service through \`srv start web-control\` when the ordinary \`web-control status\` call fails. No provider-specific commands or CDP debugger operations are used.

## Run

\`\`\`sh
cd pocs/068-chatgpt-shared-link-export
npm install
node export.mjs "https://chatgpt.com/share/<id>" "./archive"
\`\`\`

For a direct development installation where the web-control client is not in PATH, set \`WEB_CONTROL_CMD\` to its public command executable path.

A successful call writes \`0001/\`, then \`0002/\` on the next call, and so on:

\`\`\`text
archive/
  0001/
    conversation.md
    conversation.json
    capture/
      page.html
      page.txt
      metadata.json
    assets/
      image-0001.png
  0002/
    ...
\`\`\`

Image assets are downloaded **only if** their source is an HTTPS URL from an explicitly accepted OpenAI-owned image host, their response is an image, and fetching succeeds without redirects. Unavailable images remain as remote Markdown links and are listed in \`conversation.json\` with status/reason. Observed ordinary file hyperlinks are retained but their referenced file bytes are **not** downloaded.

The JSON contains individual role, order, rendered text, extracted Markdown, original message fragment HTML, image URLs and links. Its \`completeness\` field explicitly states that completeness relative to the original conversation cannot be verified from a shared page alone. \`observedSettledAtBottom\` is evidence of a stable scroll observation, not proof of total coverage. Captured rendered HTML/text are preserved to support later re-extraction when ChatGPT changes its DOM.

On a failed extraction after navigation, captured HTML/text remain under \`capture/\`, and \`failure.json\` plus \`error.txt\` diagnose the failure. A failed attempt may reserve a version directory, and the next run never replaces it.

## Verification

\`\`\`sh
npm test
npm run check
\`\`\`

The current tests cover synthetic rendered-HTML extraction and the real exporter command with a simulated external web-control protocol boundary (including versioned files and failure evidence). They do **not** establish successful navigation through a real web-control provider or fidelity against a real shared link. Live provider + share validation, image/download coverage, large and virtualized conversations, source share updates and workspace-restricted links remain open.

## Experimental cumulative DOM assembly (render-probe evidence)

A separate native CDP experiment, `render-probe.mjs`, records real DOM turn
subtrees as ChatGPT mounts them. For a previously captured private directory,
assemble the observed turn HTML into one offline **structural** document:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01
```

Optionally, compare the captured message IDs against a separately acquired
conversation RAW from `chatgpt-export.lib.js`:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01 \
  --raw /private/path/conversation.raw.json.gz
```

Use a **new output directory outside the capture directory**. The assembler verifies snapshot SHA-256,
orders original `conversation-turn-N` indices (not capture order), keeps all
snapshot-version provenance and uses the latest recorded version per turn.
It emits `index.html`, `audit.json` and `resource-references.json`.

The HTML is deliberately inert: its CSP blocks scripts, external images and
network requests. It preserves original DOM markup with only minimal presentation CSS, but does not reproduce
original stylesheets, image bytes, React state or event listeners. The audit
does not claim conversation completeness without RAW comparison. The input
archive and output files can contain conversation contents and signed resource
links: **keep them private and do not commit them**.

## Experimental offline CSS and media localization

To use the original CSS, font and image bytes already collected by the native CDP `web-analyze` capture, first build the structural DOM, then attach verified static resources into a **different, new** output directory:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01
node localize-rendered-resources.mjs \
  ./cumulative-dom-01 ./analysis-chromium-resources-02 ./cumulative-dom-localized-01
```

Open `cumulative-dom-localized-01/index.html` locally. The output contains `assets/` and `localization-audit.json`. It copies only captured first-party CSS/fonts/images/SVG and verifies every copied body's original SHA-256. Remote URLs without a matching saved response appear in the audit and are not fetched. In particular, Google favicon URLs may not correspond to the original favicon response URLs.

**This is still a static, non-interactive reconstruction:** JS, network access and React are disabled by CSP; scripts, API responses, Chrome profiles and unrelated binary downloads are intentionally excluded. Original stylesheets improve the chance of visual similarity but require real screenshot comparison before claiming parity. Keep all evidence/output private, as original markup and resource URLs may contain personal data.

## Verify visible-message completeness against the captured RAW

The original `linear_conversation` data is already embedded in the share's
archived HTML `Document` body collected by `web-analyze`. No additional
network request or separate RAW export is needed for this capture.

After assembling the cumulative DOM, compare its **ordered original message
IDs** against that archived React Router hydration stream:

```sh
node audit-rendered-dom-raw.mjs \
  ./cumulative-dom-01 \
  ./analysis-chromium-resources-02 \
  --out ./raw-completeness-01.json
```

The source response is found through the existing `resources.jsonl` index;
its bytes are checked against the original SHA-256 and length. The audit does
**not execute page scripts**. It counts RAW user messages and assistant final
messages addressed to `all`, excluding messages explicitly marked
`is_visually_hidden_from_conversation: true`. It compares expected IDs with
captured DOM IDs, in order, without printing any message text or raw IDs.
A mismatch, ambiguous visual-message coverage or corrupt evidence produces a nonzero exit
status; `--out` refuses to overwrite an existing report. The audit
also reports missing intermediate `conversation-turn-N` ordinals and
assistant nodes that lack `end_turn=true`. Even matching ID sets are
**inconclusive**, not complete, if there are missing turn ordinals or
assistant nodes but zero assistant replies accepted by the text-finality
filter. This matters for generated-image shares: `end_turn` may not
accurately classify assistant image output.

For the archived PoC 068 share the hydration stream has **951 RAW nodes**,
including **21 user messages** and **21 visible assistant final messages**.
Four additional assistant final messages are marked visually hidden.
The 42 captured DOM IDs match the 42 visible RAW IDs **in the same order**;
the ordered-ID SHA-256 is
`6a9aba4e9294c8c5b0e17756b59a6f4cea03e30d40ef744393d20ea3186916b3`.
This establishes visible-message identity/order coverage for **this capture**,
not a React execution, asset-parity or cross-conversation guarantee.

Keep archived hydration data and audit output private; do not commit unreviewed
browser profiles, original HTML bodies or transcript data.

## Generated-image capture diagnostic (read-only)

For a share containing ChatGPT-generated images, **do not conclude that a
`complete-visible-message-identity-and-order` ID audit proves image coverage**.
Some assistant nodes may lack `end_turn=true`, and a probe may observe turn
wrappers without ever saving their message-bearing HTML.

After collecting `analysis-images-01`, `render-probe-images-01`, and
`cumulative-images-01`, inspect already-saved local evidence:

```sh
node inspect-image-capture.mjs \
  ./cumulative-images-01 ./analysis-images-01 ./render-probe-images-01
```

The report lists saved image MIME categories, binary byte sizes, PNG dimensions
(where supported), origin **categories only**, counts of initial blank/nonblank
turn wrappers, snapshot image elements and cumulative DOM media-reference
categories. It imports the existing RAW ID audit for its inconclusive/complete
status. Each archived image and turn snapshot is checked against its SHA-256 and
recorded byte length; corrupt evidence fails. It **never prints URLs, source
HTML, private message/turn IDs or binary payloads**.

The presence of five saved PNG responses does not on its own establish which
ones were generated by ChatGPT, whether they were present in the captured turn
HTML, or whether the offline page includes them. Use the report to distinguish
binary acquisition from message-renderer and localization gaps. The inspection
runs completely offline, does not modify its inputs and does not launch a
browser. The first successfully localized 42-turn text-share baseline remains
unchanged.

## Unidentified turn evidence for image-bearing shares

The renderer probe now also writes `turn.unidentified-snapshot` records for
nonempty turn wrappers that lack descendant `data-message-id` elements. Their
full outer HTML is saved content-addressed in the existing private `turns/`
directory, but **not** embedded in the JSONL stream. These records are separate
from `turn.snapshot` and are deliberately **ignored by the cumulative DOM
assembler**: they are evidence for inspection, not proof that a rendered
message or original image has been identified. Blank placeholders and image
widgets may both produce unidentified snapshots.

The read-only `inspect-image-capture.mjs` reports their counts, HTML image-tag
counts and sanitized source classes separately from normal snapshots. This
requires a **new render-probe capture**; the old archive cannot recover
snapshots that were never recorded. The `web-analyze` network archive does not
need to be repeated. From the PoC directory, use a fresh private directory:

```sh
node render-probe.mjs \
  'https://chatgpt.com/share/6ad13a5b-e9f0-83eb-8519-9e2d8c8097f3' \
  ./render-probe-images-02 --sweep
node inspect-image-capture.mjs \
  ./cumulative-images-01 ./analysis-images-01 ./render-probe-images-02
```

HTML files may contain conversation content and signed URLs; keep them private
and do not commit or paste them into public logs. Normal text-turn assembly
remains unchanged.


### Correlate archived PNG responses with the newly observed image turns

Run the **same** read-only diagnostic with `render-probe-images-02`.
Its `linkage` section now correlates literal `<img src>` attributes against
exact original image response URLs in the already-saved `resources.jsonl`,
after SHA-256/size verification. It counts **distinct URLs and saved content
bodies**, so repeated snapshots do not inflate distinct-image counts. The
`unidentified.turns` table contains only `conversation-turn-N` ordinal and
aggregate counts; it does not expose original turn/message IDs or signed URLs.
`imageOrdinalsAbsentFromCumulative` identifies image-bearing turn ordinals
missing from the previously assembled *message-qualified* DOM. An ordinal
without an unambiguous `data-testid` is reported as `null`.

Exact URL matching is intentionally strict. URLs changed by redirects, expiring
signatures or source transformations count as unmatched until individually
verified. A match does **not** independently establish RAW assistant ownership,
the displayed pixels, or conversation-wide completeness. No HTML/image bytes
are modified, no browser or network is used and no implicit localization or
assembly is performed.


### Diagnose unresolved image URLs

The existing `linkage.unidentified.unmatchedEvidence` counters, including
the equivalent per-turn counters, now classify unmatched image references.
A `sameRequestRedirect` requires the **same archived CDP session and
request ID**, with exactly one image-body hash for that request; the count
`redirectPngBodies` refers to distinct hashes, not appearances across
snapshots. `sameOriginPathDifferentQuery`, `sameOriginDifferentPath`
and `samePathDifferentOrigin` are *diagnostic similarities only*, never
accepted body identities. `nonHttp` and `noSharedOriginOrPath` remain
unlinked. Query strings, signed URLs, hostnames and paths are not printed.

Use the same read-only invocation against existing private directories.
The three ordinal image turns are evidence of DOM rendering, not of
complete RAW assistant-message capture or pixel fidelity.


### Assess whether a same-path image candidate is unique

When a recorded `<img src>` and a saved image response have the same origin
and path but different query strings, the `samePathCandidateEvidence`
section now reports whether that reference has zero, one or multiple
**distinct saved body hashes**. It separately counts distinct provisional
PNG-body candidates. Only when one archived URL and one body are involved
does `queryComparison` count identical-value, changed-value and
one-sided parameter *keys*. The names and values are never printed.
Multiple different bodies for one path are explicitly marked ambiguous.

One candidate is **not** automatic identity: a query parameter could change
the selected image, dimensions or authorization. The tool intentionally
does not copy/match/rewrite images or modify the earlier cumulative output.
This check runs against the same already archived three directories; no
new browser/network capture is necessary.

## Offline generated-image preview (explicitly provisional)

The generated-image share has three additional observed image-bearing turns
without `data-message-id`: ordinals 2, 4 and 6. A dedicated opt-in path
reuses the **existing** cumulative DOM assembler and resource localizer.
It never changes the default behavior for the previously accepted text share.

From the PoC directory on vmdev, with the existing private captures:

```sh
node assemble-rendered-dom.mjs \
  ./render-probe-images-02 ./cumulative-images-preview-01 \
  --include-unidentified-images

node localize-rendered-resources.mjs \
  ./cumulative-images-preview-01 ./analysis-images-01 \
  ./cumulative-images-preview-localized-01 \
  --provisional-image-path
```

Open the resulting `cumulative-images-preview-localized-01/index.html`
**locally**. The first command includes only image-bearing
`turn.unidentified-snapshot` events, selecting the latest observed
image-bearing frame per unqualified turn; message-qualified frames retain
priority. These frames remain explicitly non-message-identified in the
`audit.json`. Their original DOM is not invented or assigned assistant IDs.

The second command permits *only* original `<img src>` references to external
PNG responses from the existing CDP archive, and only when the exact
origin+path has one distinct verified PNG body and one archived URL.
No candidate is accepted by host alone, no ambiguous path is accepted, and
the selected bodies are SHA-256/size-checked before output creation.
For a provisionally substituted image, the localizer removes its original
remote `srcset` so the browser cannot choose a blocked responsive image
instead of the archived local PNG.
An opt-in provenance manifest in `localization-audit.json` records URL
fingerprints, saved SHA-256 and `identityVerified: false`. The actual image
bodies **may differ** because query parameters changed; this is a visual
trial, not verified byte-to-DOM identity, assistant-role completeness or
pixel parity. Review the output visually before drawing conclusions.

The preview stays inert with CSP blocking scripts and network. All files,
including audits, may contain private conversation evidence and remain
private. Output directories must not exist in advance and are never
overwritten. The already validated text reconstruction and Markdown
baseline stay unchanged.


## Readable offline view after the failed original-layout preview

The real private image-share preview assembled **six turn ordinals**, **three
message IDs**, 17 copied stylesheets and three same-path candidate PNGs, but the
operator observed only the first user prompt, large empty spaces, image
placeholder text and missing later prompts. A successful structural count is
**not** a visual/reading success. Original React layout CSS can rely on
missing runtime state; the original replay path remains experimental and is
not considered accepted.

A separate, deliberately **non-facsimile reading view** is now available
from the **existing** already-localized private output. It does not recapture
the site, alter that output, or use the original ChatGPT stylesheets:

```sh
node render-readable-image-preview.mjs \
  ./cumulative-images-preview-localized-01 \
  ./cumulative-images-reading-01
```

Open `cumulative-images-reading-01/index.html` locally. This builds six
simple, sequential semantic cards from the already captured turn snapshots,
extracts only text nodes from identified messages (not buttons/controls),
and embeds individually SHA-256-verified localized PNG bodies as
`data:image/png;base64` URLs. It has no external fonts, stylesheets,
scripts, remote images, React classes, or virtualized heights; the CSP
restricts image sources to `data:`.

Its sanitized CLI result distinguishes `identifiedTextTurns`,
`identifiedTextTurnsWithContent`, `imageOnlyTurns`,
`imageTurnsWithPng`, `distinctVerifiedPngBodies`, and ordinal lists
`missingTextOrdinals` / `missingImageOrdinals`. Text absent from an
archived snapshot is **not invented**. The image-body assignments are still
only provisional because original `img src` and downloaded PNG query
values differ. This is a reading/coverage diagnostic, **not** proof of
original visual fidelity or assistant-message ownership. All output remains
private and existing output directories are never overwritten.


## Same-session URLs for ordinary Internet images (2026-10-24)

The visually accepted generated-image reading view is **not** evidence that
different signed query strings identify identical image bytes. For the new
operator-provided Internet-image share
`https://chatgpt.com/share/6ad1c0b3-f42c-83eb-bfbc-4e44c80863dc`,
the PoC has an **opt-in, metadata-only** same-browser-session experiment.
Unlike comparing two separate captures, it cannot accidentally attribute
different session signatures to an image-delivery mechanism.

From the PoC 068 working directory, using a fresh private directory **outside
the Git repository** (do not commit generated files):

```sh
umask 077
CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-internet-images-XXXXXXXX")"
node render-probe.mjs \
  'https://chatgpt.com/share/6ad1c0b3-f42c-83eb-bfbc-4e44c80863dc' \
  "$CAPTURE_DIR" --sweep --compare-image-urls
node inspect-image-capture.mjs --same-session "$CAPTURE_DIR"
```

`--compare-image-urls` enables CDP Network observation in the same browser
session that records each turn's HTML and browser-selected `img.currentSrc`.
It records only image **request and response URL metadata**, not the response
body bytes. Network redirects and `srcset` may cause `currentSrc` to differ
from literal `img src`. Both are checked separately against image requests
and responses and reported as sanitized exact-request, exact-response,
same-origin-path-different-query, inline/blob or unmatched counts. Results
include anonymous conversation ordinals, not original message/turn identities.

`events.jsonl`, `turns/` and `profile/` are **sensitive private evidence**:
they can contain original text, signed URLs and browser-session state. Never
commit, paste or publish them; share only the aggregate CLI JSON. HTTP URL
matches do **not** establish response byte identity, image-role provenance
or completeness beyond actually observed DOM frames. The previous default
probe, accepted text/Markdown artifacts, and simplified image reading view
are unchanged.


## Offline archive with exact same-session CDP image bodies (experimental)

To avoid relying on provisional same-path matches between captures, opt in to
image response-body capture **in the same Chromium session as DOM observation**.
Use two **new** directories outside the repository; never overwrite or commit
private originals or the previously accepted generated-image reading view.

```sh
umask 077
CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-image-body-XXXXXXXX")"
node render-probe.mjs 'https://chatgpt.com/share/<share-id>' \
  "$CAPTURE_DIR" --sweep --capture-image-bodies
node render-same-session-offline.mjs \
  "$CAPTURE_DIR" "$CAPTURE_DIR-reading"
```

For a **single command** that captures and renders automatically, pass the
new destination after `--offline-output`:

```sh
umask 077
CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-image-body-XXXXXXXX")"
node render-probe.mjs 'https://chatgpt.com/share/<share-id>' \
  "$CAPTURE_DIR" --sweep --capture-image-bodies \
  --offline-output "$CAPTURE_DIR-reading"
```

The separate offline renderer remains available for re-rendering the same
unchanged capture into another new directory, with no network access.

Open `$CAPTURE_DIR-reading/index.html` locally. The new `audit.json` reports
observed text/image turn coverage, captured body counts, unresolved image
references, absent ordinals and remaining provenance limitations. Both input
and output contain **private** conversational material; the CLI reports
only sanitized counts and ordinal positions.

`--capture-image-bodies` records the exact browser image requests, their
response URLs, and image bodies using native CDP `Network.getResponseBody`
when `Network.loadingFinished` occurs. Image bytes are saved privately in
`images/<sha256>.<ext>` with `0600` permissions and a matching
`network.image-body` event keyed by actual `sessionId/requestId`. Supported
formats are PNG, JPEG, WebP and GIF; other types (including SVG), failed,
unavailable, invalid or oversized bodies retain explicit status evidence
without unverified substitution. Limits: 12 MiB per image, 64 MiB captured
distinct bytes and at most 128 distinct bodies. Existing metadata-only
`--compare-image-urls` and the default observer do not download image bytes.

The renderer checks snapshot and body SHA-256, verifies response-to-body
request identity, and links the page's browser-selected `img.currentSrc` to
the corresponding **exact URL within the same CDP session**. If a snapshot's
`currentSrc` is absent, exact observed `img.src` is an eligible fallback;
an origin+path-only association is **never accepted**. Multiple differing
verified bodies for the same selected URL are reported as unresolved. The
resulting HTML uses a stand-alone reading layout with embedded `data:`
image bytes and CSP blocking JS and network access. Missing resources remain
visible as gaps in `audit.json`, and a partial output is never labeled as
complete. Original message RAW ownership/finality, full share completeness
and actual visual parity beyond the selected source snapshots remain open.

This is still a PoC, not a replacement for the pinned production Markdown
baseline. Keep all browser profiles, image bytes, signed URLs and message
snippets **outside public Git**; previously committed browser profiles
require separate privacy handling.

## Security boundaries

The URL must be an HTTPS \`chatgpt.com/share/\` conversation link, not a scheduled-task share. The exporter neither extracts cookies nor bypasses sign-in challenges. Browser profile state remains with web-control. Archive output is private data: do not commit it to public GitHub or share it without review. HTML snapshots and any image URL containing signed query parameters can reveal information, so avoid diagnostic logging of asset URLs.

## RumiAI context

Current governing sources: \`rumiai-dev/RULES.md\`, \`CONSISTENCY-GATE.md\`, \`specifications/rumiai-os/WEB-CONTROL.md\`. Active task state: \`rumiai-dev/handoff/chatgpt-export.md\`.


## Rich content and recovery from earlier private captures (2026-10-24)

The first operator batch exposed a major readability gap: the prior
single-command view flattened all HTML formatting into plain text, placed
site favicons as full-size figures and could not display formulas. The richer
renderer now projects **safe semantic markup** from captured DOM: headings,
bold/italic/underline, paragraphs, lists, quotes, preformatted code, tables,
valid absolute HTTP(S) hyperlinks, and captured **MathML** formulas (with
explicit LaTeX-source or unsupported audit outcomes when needed). The
untrusted page's CSS/JS/React runtime is **not** replayed. Source-site icons
are suppressed rather than upscaled; their enclosing source hyperlinks
remain clickable when the captured DOM contains real `href` values.
Full-sized content images are still embedded only from exact-session
hash-verified CDP response bodies. Missing decorative icons are not
misreported as missing primary image content.

**Reuse your existing capture; no new browser visit is needed** for rendering
fixes. From the PoC 068 folder after pulling the update:

```sh
node render-same-session-offline.mjs \
  "$HOME/chatgpt-batch-vGRePjHh/1-capture" \
  "$HOME/chatgpt-batch-vGRePjHh/1-reading-rich"
node render-same-session-offline.mjs \
  "$HOME/chatgpt-batch-vGRePjHh/3-capture" \
  "$HOME/chatgpt-batch-vGRePjHh/3-reading-rich"
```

The exact home paths above are examples from this one operator experiment.
Do **not** overwrite the previous reading directories or publish the input
capture. The audit now distinguishes preserved MathML, fallback/missing
math, links, decorative image suppression and still-unmatched content images.

The second share had `sweep.not-ready` after the full readiness window
and **zero** turn snapshots, so its existing capture cannot produce a reading
view. This is not an image-body problem. A subsequent Chromium acquisition
will now record a sanitized `pageShape` (presence/counts of scroll root,
turn markers and main elements, without page text/URLs) and fail with an
explicit nonzero readiness status rather than implying an exported result.
A future diagnosis still requires real host evidence; do not invent missing
turns or silently use a different source.

## Captured formula structure survey (2026-10-24)

On the first physical rich-reading run, the operator reported
`unavailableMathFormulas=198` and no rendered formulas. Before assuming
that the *original formula sources* are absent, inspect the **existing
private** capture's parsed DOM structure and all snapshots with:

```sh
node inspect-math-capture.mjs "$HOME/chatgpt-batch-vGRePjHh/1-capture"
```

The command prints **only counts and turn ordinals**, distinguishing
actual `katex` roots, MathML, TeX annotations, source attributes,
visible KaTeX HTML without MathML, and cases where an older saved
snapshot contains a formula missing in the selected latest snapshot.
No formula source text, URL, message ID, or HTML is printed.
The output will determine whether existing archived evidence can be
typeset directly or whether recovering real formulas needs a targeted
capture change. In parallel, the semantic renderer no longer mistakes
auxiliary `katex-*` class names for separate complete equations.

The user's third transcript reading view was visually judged **very
good** apart from optional attachments. Those attachments can be
misleading transcript duplicates; no attachment export is introduced.
Do not claim that correcting placeholder counts itself reconstructs
mathematical formulas.


## Replaying captured HTML-only KaTeX formulas without a new browser capture

The first real image/text capture has **198 actual KaTeX roots** on six
turns, with `katex-html` visual geometry but **zero MathML, TeX annotations,
TeX attributes or earlier snapshots containing them**. This is not merely a
bad snapshot selection. Preserve the already-typeset HTML geometry rather
than attempting to infer original source LaTeX.

The offline semantic reader now keeps a tightly allowlisted subset of
KaTeX span classes, numeric layout styles, SVG paths and text, and embeds
the pinned **KaTeX 0.16.25** CSS with bundled WOFF2 fonts from the **installed
npm package**. The output `index.html` remains self-contained and works
without network or JavaScript. Untrusted styles, event handlers, remote
resources, foreignObjects and other executable DOM are removed. The
source formula has **not** been recovered semantically: the exported
representation is faithful *visual HTML*, subject to physical inspection.

From the PoC folder after `git pull --ff-only`:

```sh
npm ci --no-audit --no-fund
node render-same-session-offline.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/1-capture \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex
xdg-open /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex/index.html
```

The older `1-reading-rich` and the user-accepted `3-reading-rich` stay
untouched. The JSON audit now contains `visualKatexFormulas`; a nonzero
value certifies *preserved and serialized visual markup*, not visual
correctness as rendered by a specific browser. The operator must inspect
fractions, exponents, radicals, delimiters and alignment. Attachment export
is deliberately not added, as the current user judged it optional and
potentially misleading in these transcript shares. Historical shared
browser captures remain private and outside public Git.


## KaTeX positioned layout fidelity (2026-10-24)

The operator's physical output showed all 198 visual KaTeX formula roots but
**incorrect** script sizes and offsets (sub/superscripts), plus a badly
distorted displayed relationship after the sentence
"allora OGY o delayed-feedback sono concettualmente più naturali.
La relazione può essere vista così:". The formula text/markup itself remains
private; no exact mathematical content is inferred from that description.

Root cause in our **own sanitizer**: it discarded trusted KaTeX numeric
`font-size` and positioned-layout `position` declarations from the
already captured visual HTML, although such styles are required to retain
KaTeX's original layout. The renderer now permits **only tightly constrained**
position keywords, bounded numeric font sizes/layout measurements and safe
transform/colour values in KaTeX's *own* visual span/SVG descendants. It
still removes `fixed` positioning, source URLs, event attributes, arbitrary
CSS, executable HTML and network resources.

The new `tests/.support/verify-katex-visual-geometry.mjs` compares the
**original generated KaTeX HTML and its exported sanitized projection in
a real headless Chromium browser**, using the same installed version-pinned
KaTeX CSS and WOFF2 fonts. It requires matching node counts, computed
positioning/font sizes and subpixel-aware bounding boxes across real
sub/superscripts, fractions, matrices, radicals and multi-line relations.
The fixture is a regression test of a *complete executable browser layout
path*, but is not a visual certification of the user's 198 private formulas.

To inspect the actual physical sample **without another browser capture**,
after `git pull --ff-only` and `npm ci --no-audit --no-fund` in PoC 068:

```sh
node render-same-session-offline.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/1-capture \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-layout
xdg-open /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-layout/index.html
```

The original private capture, `1-reading-katex`, and visually accepted
`3-reading-rich` remain untouched. Verify especially the complete
displayed relationship after the OGY/delayed-feedback sentence. The new
output should preserve proper subscript sizes/offsets; record any remaining
failing formula by ordinal/context without publicly sharing raw formulas,
signed asset URLs or captures.

## Investigate physical KaTeX geometry divergence before another renderer change (2026-10-24)

The operator physically rejected **both** previous export revisions (despite
all 198 roots and a synthetic Chromium geometry PASS). No further guess-based
CSS changes should be promoted until there is evidence from the **original
saved KaTeX DOM** and the **actual failing rendered HTML**.

The new local-only `inspect-katex-difference.mjs` compares the captured
and rendered formulas root-by-root, preserving ordinal and formula order.
It checks count and sequence of elements, CSS class tokens, missing/changed
approved layout properties and omitted SVG geometry attribute **names**.
The JSON prints only numeric turn ordinals, formula/node counts and
**approved property names with counts**: never math text, literal CSS values,
private URLs, hashes or message identifiers.

Run on vmdev, from PoC 068:

```sh
git pull --ff-only
node inspect-katex-difference.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/1-capture \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-layout
```

It also indicates whether the operator-provided sentence
"La relazione può essere vista così:" occurs in any formula-bearing turn,
without printing surrounding text or the formula itself. The report does
**not** render new output or browse ChatGPT, does not modify old captures,
and is subject to a privacy regression fixture. A structurally identical
pair can still differ in computed layout due to KaTeX CSS versions, container
styles or font fallback: if no structural/layout-style loss is found, the
next experiment must inspect **actual local browser computed geometry**,
not change CSS blindly. Accepted share-3 rich output remains untouched.

## Actual-capture geometry in Chromium, no new web navigation (2026-10-24)

The operator confirmed that **both Firefox and Chromium** render the
previous 198-formula export incorrectly. This rules out a simple
Firefox-only problem; incidental VMware GPU log messages do not prove
a KaTeX rendering fault. The private DOM diff for all 198 real formulas
found exactly **4,919 descendant elements on both sides**, identical
tag sequences/class tokens and all checked inline style values, with
only 27 `border-width` declarations dropped. That does not explain
the broad subscript/superscript failure by itself.

The read-only `inspect-katex-computed.mjs` now takes the *actual selected
private source math nodes* and the corresponding *already exported* math
nodes, places each pair under the **same exported KaTeX CSS and fonts**
in a throwaway local Chromium page, and reports only per-turn aggregate
computed property and geometry discrepancy counts; no formula contents,
HTML, signed URLs or actual CSS values leave the host. Temporary HTML
and browser profile are private and deleted immediately. This measures
whether the same offline stylesheet produces differences between
captured source nodes and exported nodes; it is **not a comparison to
the original live ChatGPT stylesheet**.

```sh
git pull --ff-only
node inspect-katex-computed.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/1-capture \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-layout
```

If the source and export geometries coincide under one stylesheet while
both physical browsers disagree with ChatGPT, the next hypothesis to
test is **original live ChatGPT CSS/fonts and parent context** rather
than another speculative DOM serializer change. If they differ, inspect
computed property names and numeric geometry from this report first.
No new export, navigation, or stylesheet modification is undertaken.


## Actual live ChatGPT versus offline computed KaTeX CSS (2026-10-24)

The operator-confirmed failure is the same in Firefox and Chromium: 198
actual KaTeX roots are retained but their *displayed font* is different,
with baseline-sized subscripts. Chromium real-capture, same-offline-CSS
diagnostic confirmed 198 paired formula roots and 5,117 source/export
nodes, 362 altered geometric nodes with a maximum 4-pixel delta, and
**only 27 differing border widths** (top/bottom/left/right on each).
There are **no computed fontSize, fontFamily, position, verticalAlign
or transform changes under that same stylesheet**. This localizes the
primary still-unverified difference to the live page's **actual CSS,
fonts or parent context**, which prior tests did not reproduce.

To measure that boundary *rather than modifying the renderer*, use the
opt-in `--compare-live-katex` mode. It opens the public share once,
scrolls it using the established observer, samples formula computed styles
as turn content mounts, then loads the **existing** offline HTML in the
**same Chromium CDP session** for comparison. It compares per-descendant
computed font families/sizes, line-height, alignment, positioning, borders,
transforms and bounding boxes while retaining only **numeric discrepancy
counts, CSS property names, and turn ordinals** in the report. No formula
text, signed URL, style literal values or chat content appear in the
terminal report. The browser profile and DOM snapshots in the new
capture directory still contain **private data**, so keep them outside Git.

```sh
umask 077
COMPARE_DIR="$(mktemp -d "$HOME/chatgpt-katex-live-XXXXXXXX")"
node render-probe.mjs \
  'https://chatgpt.com/share/6ad1c0b3-f42c-83eb-bfbc-4e44c80863dc' \
  "$COMPARE_DIR" --sweep --headless \
  --compare-live-katex \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-layout/index.html
```

The returned JSON distinguishes source vs offline formula coverage.
When coverage is incomplete because a virtualized turn was missed, do
not interpret missing pairs as agreement. When both are covered and
font-related computed properties differ, investigate the live KaTeX
stylesheet/font loading rules or inherited CSS. If computed properties
match but the physical display still differs, inspect loaded font-face
resources and original page context. No new offline view is produced,
and none of the already accepted private outputs is changed.


## Live KaTeX comparison observability and bounded sampling (2026-10-24)

The first operator's live-CSS probe on vmdev at `24adeb0e` displayed only
`DOM rendering observation active`, with no subsequent progress or result
before Ctrl+C; the resulting `CDP connection closed` message was a
transport symptom of interrupted execution, **not a completed diagnostic**.
Neither successful comparison nor a specific hang cause was established.

Investigation found the opt-in probe repeatedly computed layout for *all*
currently visible KaTeX descendants at every third scroll step, without
caching, and silently waited for navigation/scroll/comparison. One share
has 198 formulas/5,117 DOM descendants, so redundant costly measurements
are a plausible source of slow execution. The opt-in live metric probe now
**caches per-turn font-settled results inside each document**, computing a
turn again only when additional formulas mount or previously loading fonts
finish. The shared normal sweep still scrolls in both directions, sampling
on steps with a cheap cache lookup.

The CLI now prints numbered-phase-agnostic `[KaTeX]` diagnostics to stderr:
browser start, waiting for the expected DOM, scrolling direction and
periodic step counts, observed math-turn and sample/error counts, opening
the existing offline HTML and comparison completion; a heartbeat reports
the current phase every 10 seconds. This output includes **no formula,
URL, message or signed data**. A bounded 6-minute scroll deadline
classifies incomplete runs as such. In this opt-in mode a SIGINT requests
cancellation and closes the CDP socket, then finishes private recording
gracefully with exit status 130 rather than printing an unhandled
`CDP connection closed` error. Existing captured formula markup, original
source and offline views are unchanged.

Reuse the same command as in the preceding live-CSS section, but allocate
a **new** private `$HOME/chatgpt-katex-live-XXXXXXXX` capture directory.
Do **not** reuse the interrupted directory or publish its browser profile.
Only a report with nonzero `comparison.pairedRoots` provides meaningful
live-vs-offline evidence; zero or an interrupted run is not success.
No physical operator validation has yet been obtained for the new
instrumented behavior.


## Standalone KaTeX CSS font-face parse failure: root cause and correction (2026-10-25)

Real physical vmdev live-versus-offline Chromium comparison had complete
formula coverage: **198 of 198 roots, 5,117 matched nodes**, but
`fontFamily`, `fontSize` and `lineHeight` differed in all 5,117;
`display` differed in 3,241, `position` in 1,257 and geometry differed
in 5,101 (maximum reported displacement 887.25 CSS px). The live page
registered 20 KaTeX font faces, whereas the offline archive registered
**zero**. The problem was not a lost formula subtree.

A new real-Chromium regression,
`tests/.support/verify-standalone-katex-css.mjs`, opens the **exact
standalone HTML produced by `renderSameSessionOffline` under its
unaltered CSP** and asserts that `@font-face` rules are parsed, KaTeX
fonts register/load in `document.fonts`, and computed `.katex`
styles use KaTeX fonts. This test failed on the original revision with
`styleSheets=1, ruleCount=23, katexRuleCount=0, fontRuleCount=1,
fontFaces=0, loadedFonts=0, rootFontFamily="system-ui, sans-serif"`.

**Confirmed implementation defect:** `embed-katex-css.mjs` used
`/src\\s*:[^;]+/i` to replace minified final `@font-face` source
declarations. Because the final `src` may have **no trailing
semicolon**, the regex consumed the closing `}` and merged the
remaining CSS into the first `@font-face` rule. The replacement is now
bounded by either `;` or `}` using `/src\\s*:[^;}]+/i`.
The exact revised standalone HTML passes the real Chromium CSS
registration, WOFF2 loading and computed root-font test (GitHub Actions
[40217034013](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/40217034013)
**PASS**); all other PoC tests including real CDP image capture passed.

The operator's real 198-formula archive still needs **physical
visual acceptance** after regeneration; regression PASS proves the
browser interprets the corrected embedded CSS/font assets, not that
every private equation exactly matches the live ChatGPT layout.

Rebuild **without revisiting ChatGPT or overwriting prior work**:

```sh
git pull --ff-only
node render-same-session-offline.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/1-capture \
  /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-css-fixed
xdg-open /home/admino/chatgpt-batch-vGRePjHh/1-reading-katex-css-fixed/index.html
```

Check the subscript/superscript size and position and the complex display
relation following “La relazione può essere vista così:” in turn 2.
If any residual discrepancy persists, distinguish it from the previously
dominant invalid-CSS bug. The 27 inline `border-width` losses
identified by the separate private-DOM diagnostic remain a possible
minor difference and have **not** been silently changed in this work
unit. Preserve private captures, accepted share-3 view, pinned Markdown
baseline and all older offline outputs.
