# PoC 068 — ChatGPT shared-link export with web-control

Status: **Experimental — final operator-accepted milestone (2026-10-29).** Not a published RumiAI command/package.

## GitHub Actions publication adapter (2026-10-30)

**Current export contract:** citation buttons and grouped references may be
visible but no external citation link target or click behavior is guaranteed.
Missing HTTPS destination evidence must not block publication. Archive images,
original conversation structure, safe local resources, and script disabling
remain subject to their independent checks.


The optional `share-metadata.mjs` reader extracts the **original chat title**
from the original shared-page document title and the **first user message's**
`create_time` from the React Router hydration stream, formatting the archive
date in `Europe/Rome`. The separately generated offline HTML has a generic
title and is never used for naming. The original HTML response is saved only
as SHA-256-verified *private* evidence by `render-probe.mjs` when static-body
capture is enabled, and is not included in the final archive.

To request the metadata through the integrated exporter, add `--with-metadata` to
`node export-offline.mjs <share-url> <new-output-dir>`. Its success report then
includes `metadata.title`, `metadata.createdAt` and `metadata.date`; the
private original Document is discarded on success by default, so the
publication adapter does not need raw capture access.

The separate `publish-chat-archive.mjs` adapter accepts a private JSON request
containing exactly `url` and `topic` and a local checkout of the
`rumiai-dev` destination repository. It performs the accepted export with
private evidence, validates title, date, CSP, local resources and path safety,
and stages the **complete unchanged** archive at
`chats/<topic>/<YYYY-MM-DD> <original title>/index.html` with its assets.
It never overwrites an archive. It does **not** run Git commands or publish
anything remotely: `rumiai-dev/.github/workflows/chatgpt-export.yml` performs
authorized Issue dispatch, forward-only Git commits and completion reporting.

The GitHub-hosted raw-share metadata extraction for the sample
`Integrare Chat e Work` recovered date `2026-10-08` and targeted metadata
and publication-adapter tests passed. Actual original-Document CDP capture
integration and Issue-to-Git publication must be assessed by their respective
workflow results; they cannot be inferred from component tests.

## Integrated Node.js command — validated on GitHub-hosted Linux (2026-10-29)

The **previous operator-accepted linked archive** remains a separately
validated PoC milestone. The current integrated Node.js command is
intended for citation-independent offline archiving:

```sh
cd pocs/068-chatgpt-shared-link-export
npm install
node export-offline.mjs \
  'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
  "$HOME/my-private-chatgpt-export"
```

The output directory **must not already exist**. On successful
completion it contains `index.html` and locally saved resources.
Chromium, Node.js 22+ and the current PoC npm dependencies must
already be available. There is no input-file upload, ChatGPT login
bypass, provider API access or source JavaScript replay.

**Current behavior (2026-10-30):** The operator explicitly removed
citation link reachability/functionality as a requirement of exports.
The integrated `export-offline.mjs` now performs one private
original-CSS/image/DOM capture, renders the captured conversation,
localizes exact captured image resources when necessary, and checks
local image integrity and the script-blocking CSP. It preserves the
original citation control appearance but **does not reconstruct or
require verified destinations** for +N groups or singleton references.
No fixed number or distribution of citations is required. Citation
controls may therefore be inert in the archived document; their target
URLs and external availability are not promised. The old guarded
source-card and singleton restoration scripts remain standalone
historical PoC tools, not prerequisites of the integrated exporter.

The command retries a `sweep-not-ready` capture once with a fresh
Chromium profile. **Citation and external-link decorative IMG icons are
ignored** before image localization: original HTML/CSS bytes outside those
small image tags, the visible citation text and substantive conversation
images are retained. Images inside citation controls, known Google favicon
endpoints and explicitly small/icon-marked external-link badges are omitted.
Missing original turn markup, missing substantive conversation media and
failed structural/CSP checks still prevent publication. Neither citation
targets nor their icon bytes are required.

A real public-share export exposed a root-relative ChatGPT image such as
`/images/ecosystem/apps/github/icon.png` that Chrome had not supplied as a
saved image response. The integrated exporter now localizes such `img src`
references using the **exact public `https://chatgpt.com` URL**: no external
host, redirect or substituted icon is allowed; MIME, signature, size and
SHA-256 identity are checked before the HTML is rewritten to a local asset.
The validator still refuses missing relative files and unlocalized images.
This bounded first-party retrieval is distinct from the network-free
localization of already captured third-party image bodies.

When a second Chromium capture still cannot supply an exact Google favicon
body, the integrated command makes one narrowly scoped recovery attempt for
the **original** `https://www.google.com/s2/favicons` URL. HTTPS redirects
are limited to the Google favicon service's static image endpoint. Responses
are retrieved without user credentials, validated by bounded size, MIME,
signature and SHA-256, and recorded as **direct HTTPS recovery evidence**,
not mislabelled as browser CDP captures. The existing exact-image localizer
then verifies that evidence and preserves the original HTML/CSP behavior.
Images from other unmatched remote origins, failed requests, invalid images,
or unsupported MIME types still prevent publication.

Failed runs retain private diagnostics without creating a partial archive.
Successful runs discard them unless `--keep-evidence` is set.

This is still a site-specific experimental visible-HTML archive, not
a certification of complete RAW conversation history or pixel-perfect
visual equivalence. The old operator-approved linked archive and
its revision-specific acceptance results are historical evidence for
that earlier implementation, **not** promises about the current
citation-independent exporter.

**Fresh end-to-end Linux execution passed** on the GitHub-hosted
Ubuntu runner in [PoC 068 Live Offline Export run 40954580470](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/40954580470)
for the example URL above. Node.js 22 syntax checks and all eight
`export-offline` Node tests passed; the real Chromium-driven command
published a private offline archive with 8 verified +N groups,
19 group links, 8 singleton links, 0 residual remote images and
a script-blocking CSP. The resulting `index.html` was 264,928 bytes.
No HTML or CDP evidence was uploaded from the runner. This is a
successful **auxiliary GitHub-hosted Linux test of this exact share**,
not by itself physical validation of the operator's host or proof of
support for arbitrary shares.

**Operator correction (2026-10-29):** the operator explicitly confirms
that a real export test had already been carried out and that its
result was perfect. The previous statement that real/operator testing
was still pending is therefore superseded. This confirmation is
operator-reported evidence, separate from the independently logged
GitHub Actions execution; the exact command, source revision and
private output of that earlier test were not supplied with this
correction and must not be invented. The previously operator-accepted
offline archive remains valid.

## Final experimental outcome and acceptance

**Development of this PoC is concluded at the operator's request.** The
result is useful but intentionally not pixel-perfect or production-ready.
The source implementation remains as-is; the finalization records actual
observations and explicitly accepted gaps rather than attempting further
renderer or CSS changes.

The **private offline result** is the script-free original-CSS rendering
followed by verified source-link reconstruction, exact image localization
and the separate singleton-link postprocessor. In the operator's physical
browser checks:

- Assistant diagram rendering and long-user-message disclosures were
  accepted; previously verified grouped citations contain **8 native
  expandable groups and 19 functional HTTPS links**.
- Original external-link icons are displayed correctly after exact-URL
  / SHA-256 matching of **24 image references** to **11 captured image
  bodies**, without changing the original inert CSP.
- **8 single-source citations open the correct external HTTPS link**.
  Their original icon remains visible, but the following caption/text
  wraps onto another line rather than staying beside the icon.
- The **4 separate "Fonti" buttons do not provide a working disclosure**
  in this final offline output. This is a known, accepted functional gap.

The last successful guarded browser capture identified one original
HTTPS destination for each of the 8 singleton popover buttons and
observed all 4 "Fonti" controls, but the latter did not produce
sufficient verified disclosure content for a safe script-free replay.
No inferred destinations or fabricated Fonti panels are introduced.

**Validation boundaries:** the operator has confirmed the final
singleton-link navigation and preceding icon / grouped-link behavior.
The earlier **12/12 Node tests** and successful guarded live-capture
exercise applied to revision `f585472`. No physical Node result for
the later `tests/restore-singleton-citations.test.mjs` suite was
supplied in this conversation; do not claim it passed. Visual fidelity
of the cost table and the "Scrittura" block spacing was not separately
confirmed. The RAW completeness of the underlying shared conversation
has **not** been proven; the exported visible messages must not be
represented as a certified full ChatGPT history.

**Private artifact retention / reproduction:** the accepted result is
stored on the operator's vmdev host, not in Git. The final opt-in
postprocessor is `restore-singleton-citations.mjs`; it creates a new
private `chatgpt-share2-singletons-*` directory from the previously
accepted `chatgpt-share2-exact-icons-*` archive and the two verified
original remaining-control captures. The invocation and evidence
requirements are documented in **"Verify and restore eight singleton
citation anchors"** below. Preserve the existing final result and
source captures locally; do not commit HTML, private links, session
profiles or source image bodies to this repository.

All remaining deviations above are **accepted limitations of this
closed experimental milestone**, not active implementation tasks.
A later improvement would require an explicit new work unit.



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

## Development notes and prior experimental checkpoints

The following sections document the successive implementation and evidence
gathering stages. Earlier statements about pending tests or incomplete
interaction behavior refer to their specific checkpoints, **not** to the
operator-accepted final state summarized at the start of this README.
The preserved commands are useful for reproducing or auditing the PoC;
none of the earlier stages is a mandatory follow-up for the closed task.

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
`/src\s*:[^;]+/i` to replace minified final `@font-face` source
declarations. Because the final `src` may have **no trailing
semicolon**, the regex consumed the closing `}` and merged the
remaining CSS into the first `@font-face` rule. The replacement is now
bounded by either `;` or `}` using `/src\s*:[^;}]+/i`.
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

## Physical mathematical rendering acceptance — 2026-10-25

The operator ran the corrected PoC at `rumiai-dev-PoCs@58d31e1ffc2d4dbdd8bc0b7b96ccd2cffd3cc25d` on vmdev with the **existing** private `/home/admino/chatgpt-batch-vGRePjHh/1-capture` and created `1-reading-katex-css-fixed/index.html` (without new ChatGPT navigation or overwriting earlier views). Sanitized audit: 16 turns, **198 visual KaTeX formulas**, 0 unavailable formulas, 68 links, `same-session-offline` status. The operator explicitly **accepted the visual mathematical rendering**, including superscripts, subscripts, special symbols, and the complex relation following “La relazione può essere vista così:” in turn 2. This is user-observed visual fidelity for the captured share-1 mathematics, **not pixel-level equality, RAW conversation completeness or acceptance of all assets and conversations**. Earlier paragraphs that described this exact physical check as pending are historical checkpoints, now superseded by this confirmed result.

No new renderer modification is required for this result. The 27 known `border-width` omissions, share-2 loading failure, missing/optional attachments and other artifact provenance remain separate; the user-accepted share-3 view, earlier private captures and reading files remain untouched.

## Investigating a share with no turn snapshots (2026-10-26)

The operator's earlier batch on public share
`6ad1c0f5-7110-83eb-bc19-356d48fc1259` produced
`sweep.not-ready`, no `turn.snapshot` records and therefore **no reading
HTML**. Its existing private capture directory is
`/home/admino/chatgpt-batch-vGRePjHh/2-capture`. Nine observed image
responses **do not establish that conversation turns loaded**. No source
has yet established whether the page is unavailable, delayed, blocked by
its own UI or using changed selectors. Do not silently loosen the DOM
readiness condition or invent content from missing snapshots.

To classify what the existing capture actually proves **without new
navigation**, run from the PoC directory:

```sh
node inspect-share-readiness.mjs \
  /home/admino/chatgpt-batch-vGRePjHh/2-capture
```

This only reads the original local `events.jsonl` and prints an
allowlisted counts-only JSON: whether the navigation command reported an
error, whether the expected DOM scroll root or turn wrappers were
observed in the final not-ready page shape, and counts of relevant events.
No HTML, chat text, URLs, message IDs, paths or signed tokens are emitted.
It also handles old recordings where `sweep.not-ready.pageShape` did
not yet exist, labelling them **inconclusive** rather than inventing a
cause. It never modifies the existing private capture or accepted share-1
and share-3 offline readers. The next step depends on the real findings.


## Bounded live DOM readiness check for the nonhydrated second share (2026-10-26)

The original share-2 private capture contains 329 events and a single
`sweep.not-ready`, but it predates the structured `pageShape`
diagnostic. Existing-capture inspection reported
`readiness-failure-without-page-shape`: navigation command reported
no error, nine image bodies were attempted, and there were zero
conversation-turn snapshots. This does **not** establish expiry,
accessibility, full hydration or selector breakage.

A scoped `render-probe.mjs --readiness-only --headless` mode now performs
one new, bounded Chromium/CDP observation of the page and stops without
scrolling the whole conversation or exporting HTML. The new report
`private-safe-live-share-readiness` exposes only normalized DOM
structural counts and booleans, the limited browser navigation command
outcome and initial/final page shapes, never conversation text or URLs.
It distinguishes both expected hooks, missing turn wrappers, missing
scroll root, both absent and an incomplete DOM evaluation; none of these
alone proves the reason or validity of a shared link. It observes
up to 30 seconds, exits earlier after two consecutive valid hook checks,
and keeps private DOM/profile data only in its newly allocated capture
directory. An HTTP status may be unavailable; no status is fabricated.

From the PoC folder on vmdev:

```sh
git pull --ff-only
umask 077
READINESS_DIR="$(mktemp -d "$HOME/chatgpt-share2-readiness-XXXXXXXX")"
node render-probe.mjs \
  'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
  "$READINESS_DIR" --headless --readiness-only
```

Share **only** the sanitized JSON whose `status` is
`private-safe-live-share-readiness`. Do not publish or commit the
private capture folder. The output is diagnostic rather than an
archive. It does not change the previously accepted 1/3-reading
exports, share-1 math CSS, original captures, or optional attachments.
A real Chromium test covers the two core situations: rendered turns
present and page loaded but expected hooks absent. A result with no
turn wrappers does **not** justify inventing missing conversation text.


## Same-session original CSS offline preview (2026-10-26)

Use the already-acquired private Chromium capture made with
render-probe.mjs --sweep --capture-image-bodies --capture-static-bodies.
The new **opt-in experimental** renderer assembles the verified original
turn DOM and reuses the existing CSS/font/image resource localizer. It
verifies SHA-256 for every selected archived static body and correlates
image response bodies by exact CDP session/request identity. Outputs
are private and immutable; no previous reading view is changed.

On vmdev, after pulling the updated PoC:

    umask 077
    STYLED_DIR="$(mktemp -d "$HOME/chatgpt-share2-styled-XXXXXXXX")"
    rmdir "$STYLED_DIR"
    node render-same-session-styled.mjs \
      /home/admino/chatgpt-share2-full-2MGSvdpK "$STYLED_DIR"
    xdg-open "$STYLED_DIR/index.html"

The preview retains original captured DOM classes, SVG, styles and static
resource bodies. It preserves ordinary HTML link pointer interaction, but
**does not replay React, page scripts, tooltip state or the expandable
OpenAI +1 control**. CSP still blocks script execution and external
network-backed assets. An original CSS snapshot without its original
document ancestors, themes, stylesheet order and runtime may render
differently. The stylesheet files were captured as network responses:
this capture **did not record original stylesheet insertion/cascade order**,
so loaded CSS order is provisional. Unresolved assets are counted; absence
of an acquisition error is not proof of complete CSS/font coverage.

The generated HTML and audit files may contain conversation text and
signed URLs. Keep them outside Git, do not paste them into public reports.
The accepted semantic views remain the stable reference. Run
node --test tests/same-session-styled.test.mjs for the local integration
fixture and visually check the real share's diagram and grouped links
before accepting this mode.

## Physical validation: diagram accepted, remaining table and control issues (2026-10-26)

The operator physically inspected the original-CSS offline view of share 2 and
**accepted the diagram** following “2. La soluzione che adotterei”. Preserve
this working SVG/layout behavior. Three differences remain:
the cost-per-token table acquires full cell borders absent in the original,
the compact OpenAI +1 references neither open nor expand and their icon is
too small, and long user messages show an inert “Mostra di più” control.

The first issue has a concrete local cause: the generic evidence assembler
injects default table and cell borders. In the styled preview only, strip
that fallback rule before including captured original CSS. The semantic
reading view and source snapshots are untouched. A fixture checks that the
generic table rule is absent; visual acceptance on the real table is pending.

For React-dependent controls, merely enabling pointer events was insufficient.
`inspect-styled-interactions.mjs <capture-dir>` inspects the **existing**
private source snapshots, selects the newest message-qualified frame per
ordinal, and emits a whitelisted JSON describing show-more and OpenAI/+N
control ancestry, clipping hints, available anchors and attributes.
It never emits conversation text, URL values or identifiers. Do not
fabricate missing source links or execute the original React runtime.
If expanded message content or citation targets were never in the
captured DOM, another *targeted* live interaction observation may be
necessary. The accepted diagram needs no new capture.


## Opt-in capture of expanded messages and hoverable source evidence (2026-10-26)

The original-CSS preview still does not replay React. A physical vmdev review
confirmed 12 rendered turns and four passing PoC fixture tests, but grouped
OpenAI +1 sources and long-user-message “Mostra di più” controls remained
inert. The private-safe inspector showed expansion controls with
\`aria-expanded=false\` / \`data-can-expand\` on turns 1, 5, 9 and +N
reference components on 2, 4, 6. Source URL values were not exposed in that
report. The cost-table fix has a passing fixture, not yet visual acceptance.

To observe the **original page's own interaction state** without copying
or executing its scripts offline, run one **new opt-in live capture**:

    umask 077
    INTERACTIVE_CAPTURE="$(mktemp -d "$HOME/chatgpt-share2-interactive-XXXXXXXX")"
    node render-probe.mjs \
      'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
      "$INTERACTIVE_CAPTURE" \
      --headless --sweep --capture-image-bodies --capture-static-bodies \
      --observe-interactions
    node inspect-live-share-interactions.mjs "$INTERACTIVE_CAPTURE"

Only \`--observe-interactions\` changes the normal sweep: at each mounted
page step it clicks visible collapsed message-preview buttons using their
original React handlers, and issues a bounded synthetic pointer/mouse hover
to each previously unseen +N source-count control. The normal DOM mutation
observer then records expanded message snapshots. After source hovers, newly
appeared HTTPS anchor hrefs (if any) are recorded in the **private**
\`events.jsonl\`, with the current ordinal/index as weak correlation evidence.
No source URLs, message texts or IDs appear in sanitized CLI reports.
This experiment neither navigates to third-party links nor fetches source
pages explicitly. A hover can fail to activate a provider control; a newly
appeared anchor is not proven to belong to a specific source until inspected.
Repeated remounts and the assembler's latest-snapshot selection can still
select a collapsed snapshot; compare the new capture's evidence before
claiming full message coverage.

The standalone \`inspect-live-share-interactions.mjs\` command reports only
attempt counts, successful anchor discoveries, source ordinals and failures.
It does not validate the exact links or text completeness. The new capture,
including URLs, browser profile, HTML and resource bodies, is private and
must not be uploaded or committed. Preserve earlier accepted files and use
a fresh output path for any later rendering. Do not treat the new capture
as visual acceptance until the archived text and source popovers are checked.


## Interactive observation result and nested-label correction (2026-10-27)

The operator executed the real Chromium opt-in capture at
\`/home/admino/chatgpt-share2-interactive-QelaT13q\`.
The physical run passed both dedicated test cases, recorded 59 turn snapshots,
completed the sweep, attempted eight source-group hovers, and found
**four distinct HTTPS anchors after two hovers** (one on ordinal 2,
one on ordinal 6). No individual link-to-pill ownership was established,
and two hovers on ordinal 4 yielded no new anchors. Crucially,
\`expandedClickAttempts=0\` and no expansion errors were observed.

Source inspection showed the previous show-more detector compared exact
\`button.textContent\` despite the visible "Mostra di più" label belonging
to a nested \`span\`. The opt-in detector now checks exact normalized
**leaf-span labels** as well as the button, counts candidate buttons and
label matches, and clicks only those below \`[data-can-expand]\`.
The summary adds \`expandCandidates\` and \`expandLabelsMatched\`.
A synthetic DOM-control regression covers an aggregate button text that
contains additional hidden text; real Chromium expansion remains pending.

To assess the *existing* interaction capture without another navigation:

    node inspect-source-hover-attribution.mjs \
      /home/admino/chatgpt-share2-interactive-QelaT13q

The counts-only report tests each source-hover event's captured URLs against
the \`+N\` numeric expectation in the latest verified turn snapshot, using
the same leaf-span ordering as the hover sampler. Numerical agreement is
**not proof of URL ownership**: portal links can arise from other controls,
and some groups remain unobserved. Never publish \`events.jsonl\`.

To verify the corrected show-more detector requires a **new** private
opt-in Chromium run with \`--observe-interactions\`. Preserve all prior
captures, accepted views and the accepted diagram. The actual offline
buttons have not yet been replaced by a verified standalone behavior.


## Native offline user-preview expansion from verified expanded frames (2026-10-27)

The operator executed the fixed opt-in live capture at
\`/home/admino/chatgpt-share2-interactive-m8xthV9A\`. Four physical Node
tests passed. In this capture the source page recognized five expandable
preview candidates, matched all five labels and attempted five original
React clicks. The selected turn-1 and turn-9 frames showed
\`aria-expanded=true\` and \`data-expanded\`; turn 5 was collapsed again
in its latest frame. These results **do not prove** completeness of
the text or a working offline preview by themselves.

The styled renderer now **optionally prefers an earlier verified expanded
snapshot** for a user turn over a later collapsed remount. The generic
\`assemble-rendered-dom.mjs\` behavior remains unchanged unless called
with \`preferExpandedPreviews:true\`. In the styled view only, user
\`[data-can-expand]\` previews are rendered with native checkbox/label
controls (no scripts) and local CSS targeted exclusively to those
previews. The original user text and graphical assets remain in the DOM.
An expanded source preview opens by default and may be collapsed; a
collapsed one opens when “Mostra di più” is activated. Other turns
including the accepted assistant diagram are not parsed or modified.
The visual result, click interaction and text coverage **require physical
operator verification**.

From the PoC root:

    git pull --ff-only
    node --test tests/offline-preview-controls.test.mjs \
      tests/same-session-styled.test.mjs
    umask 077
    STYLED_DIR="$(mktemp -d "$HOME/chatgpt-share2-preview-XXXXXXXX")"
    rmdir "$STYLED_DIR"
    node render-same-session-styled.mjs \
      /home/admino/chatgpt-share2-interactive-m8xthV9A "$STYLED_DIR"
    xdg-open "$STYLED_DIR/index.html"

The result reports \`restoredPreviews\` and
\`initiallyExpandedPreviews\`. A positive number means controls were
transformed, **not** that their display has been physically accepted.
Verify the long user messages in turns 1, 5 and 9, the accepted diagram
and cost-per-token table. The CSS overrides apply after all captured
static stylesheet links, to counteract clipping by original outer
containers. Original CSS body hashes and semantic reading output are
preserved. The source-pill \`+N\` popovers are still unresolved: only
one of eight hover groups had a numerically matching link count, and
numeric agreement does not prove provenance. Do not fabricate links.


## Original CSS preservation and source-popup attribution (2026-10-27)

The operator physically confirmed that long user messages **start collapsed**
and expand/collapse correctly. This acceptance is retained.

The writing block after "Una richiesta sperimentale potrebbe essere questa:"
and beginning "Scrittura" lacked both left and bottom padding relative to
the original ChatGPT page. The previously introduced fixed 1rem padding
fallback has been **removed** from the styled renderer at user request.
The goal is to find the difference in original DOM ancestors, CSS custom
property inheritance, stylesheet order or cascade, not to accumulate
per-component CSS patches. The semantic reading view, original CSS
bodies and accepted assistant diagram remain unchanged.

Inspect read-only evidence from the existing private capture:

    node inspect-captured-writing-layout.mjs \
      /home/admino/chatgpt-share2-interactive-m8xthV9A

This report lists editor and ancestor element types, component names and
spacing-related **property names only**. No CSS values, conversation text,
identifiers or URLs are printed. Computed padding still needs a browser
comparison of the original live page and the offline page. Do not infer
missing declarations from property names or add more manual CSS patches.

The previous source-hover sampler targeted badge containers rather than
the actual popup trigger with aria-haspopup. The opt-in sampler now
exclusively activates that trigger by sending mouse events and a DOM click;
it checks aria-controls and the presence of exactly one newly visible
popup container for link extraction. Exact controlled-popup attribution
is preferred; the single-new-popup case is recorded separately.
Generic page-wide anchor changes remain counts only, not attributed
source URLs. Metadata includes scopeType, triggerExpanded, expectedSources,
scopedAnchorCount and observedNewAnchors; private link targets remain
only in the local event archive. Numerical agreement between +N and
link count is insufficient to prove ownership. Do not synthesize offline
source groups until attribution has been physically verified.

After pulling the PoC, run focused tests and create one new private opt-in
capture if source-popup provenance is still required:

    node --test tests/offline-preview-controls.test.mjs \
      tests/live-share-interactions.test.mjs \
      tests/captured-writing-layout.test.mjs
    umask 077
    CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-share2-sources-XXXXXXXX")"
    node render-probe.mjs \
      'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
      "$CAPTURE_DIR" \
      --headless --sweep --capture-image-bodies \
      --capture-static-bodies --observe-interactions
    node inspect-live-share-interactions.mjs "$CAPTURE_DIR"

No prior capture or accepted output is overwritten. Optional
copy-to-clipboard buttons remain deferred under script-src none.

## Source popup attribution: October 27 runtime correction

Physical vmdev test: six of seven Node tests passed; the new source-popup
fixture failed because no popup was selected. The live source observation
recorded eight scope candidates but **zero URL targets** in the private
capture `/home/admino/chatgpt-share2-sources-Ld75fDXQ`. The writing-layout
inspection found two captured editor instances, on turn ordinals 2 and 6,
with all four original editor padding custom property names present; this
does not establish their computed values.

The previous popup reader initialized `scopeType` with the string
`'none'` but tested `if (!scopeType)`. Because a nonempty string is
truthy, it never searched for a newly visible source popup. This is now
corrected: if the controlled element lacks link anchors, the sampler
checks whether exactly one new or previously hidden popup became visible.
The inspector also reports counts of empty controlled panels and non-anchor
controls, plus per-group ordinal/index and structural metrics in sourceGroups,
without exposing URL values or inventing links. It excludes
source triggers nested inside external links and preserves private-event
separation. A controlled group and a single-new-popup group remain
distinct provenance categories; neither is accepted as a verified group
until physical observations support the association.

After pulling, rerun the focused source-interaction test. The 2026-10-27
capture predates this fix and cannot be reinterpreted as proof of source
ownership. One **new** opt-in Chromium capture using the existing
`--observe-interactions` flag will be required to test the repaired
sampler. The original styled output, native show-more controls and all
captured CSS remain unchanged.


## Source card controls: physical observation and passive target evidence (2026-10-27)

On vmdev, revision dcbf875 passed all eight focused Node tests and a
new same-session Chromium capture completed successfully at
/home/admino/chatgpt-share2-sources-fixed-ZPOiH7NQ, with 85 turn snapshots.
All eight observed grouped source controls opened with triggerExpanded=true,
but **none supplied an anchor href**. Seven presented clickable buttons:
for all seven the button count matched the number of expected sources
(two buttons for OpenAI +1; five for the +4 group). The eighth group had
zero buttons at the captured moment. This is structural evidence, **not**
URL attribution. The capture remains private and no links are invented.

The next diagnostic does not activate source cards or navigate to
external pages. It checks whether any source-card button declares a direct
HTTPS destination in an HTML data attribute or immediately attached React
element prop. Only one unambiguous destination per button is recorded;
javascript/data URLs are rejected. Exact URLs are written **only to the
local private events.jsonl**, grouped by ordinal, pill index and button
index. The sanitized CLI report contains only counts
(groupsWithButtons, buttonCountMatches, buttonsWithReactClicks,
buttonsWithDirectTargets, and per-source-group directTargets). A React
onClick handler's existence does not reveal its destination. This probe
never clicks the cards; if URLs reside only in handler closures, it must
report zero rather than invent destinations.

The earlier capture did not record these button properties, so a new
opt-in same-session observation is needed. Run the focused tests before
capturing. No change is made to the accepted diagram, CSS, writing block,
preview toggles or CSP. Offline source-group reconstruction requires
proven exact button-to-URL attribution.


## Opt-in guarded source-card action probe (2026-10-27)

Physical vmdev evidence for revision af7e052: all six focused tests pass;
private capture /home/admino/chatgpt-share2-targets-WiF0gU8j contains 79
snapshots. Eight of eight source groups expose exactly as many buttons as
the source count indicated by the +N badge: 19 buttons in total, each
with a React onClick handler, but **zero direct HTTPS target attributes
or immediate React props**. More passive href/prop scans will not recover
the intended URL. No URL has yet been attributed to an individual card.

The separate, opt-in --probe-source-card-actions flag is accepted only with
--observe-interactions and --sweep. It is NOT part of the normal exporter.
It uses an isolated Chromium process, enables Chrome DevTools Fetch request
interception before source buttons are clicked, and fails every intercepted
request. Newly created page targets inherit this guard while paused before
their debugger resumes. If the guard cannot be installed, the target is
closed (or left paused if closing fails), never resumed unguarded. The capture also replaces window.open and
programmatic anchor.click in the disposable page with inert wrappers for
the remainder of the session, retaining attempted HTTPS URLs in private
events. The guard remains active through the rest of the browser session
to prevent delayed React callbacks from obtaining external network access.
Because it disables networking after first activation, this capture
must not be used to evaluate completeness of original assets/DOM.

Every source-card observation is recorded privately with its mounted
turn ordinal, source-pill index and button index. The sanitized standalone
report counts only attempted window openings, programmatic anchor clicks
and browser-level blocked requests; it never prints URL values. React
buttons may unmount when clicked, so an unattempted card cannot be
considered observed. The diagnostics do not claim that a blocked background
request belongs to the clicked card. No offline link is generated unless
source ownership is unambiguous in captured evidence.

From the PoC directory, to run a new **navigation-guarded** observation:

    (
      set -eu
      git pull --ff-only
      node --check render-probe.mjs
      node --check inspect-source-card-actions.mjs
      node --test tests/live-share-interactions.test.mjs tests/source-card-actions.test.mjs
      umask 077
      CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-share2-card-actions-XXXXXXXX")"
      node render-probe.mjs 'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' "$CAPTURE_DIR" --headless --sweep --observe-interactions --probe-source-card-actions
      printf 'CAPTURE_DIR=%s\n' "$CAPTURE_DIR"
      node inspect-source-card-actions.mjs "$CAPTURE_DIR"
    )

The private capture may contain URLs and source message text: do not paste
events.jsonl or transfer it into a repository. Keep the previous validated
offline diagram, original CSS/font bodies, collapsed-by-default preview
behavior and semantic export unchanged. This is a bounded research probe,
not a complete solution to citation interaction or to writing-block CSS.


## CDP trusted-pointer follow-up (2026-10-27)

Physical vmdev result for `0410fdf`: the correct share 2 URL yielded
81 snapshots and eight source-card action groups, 19 synthetic
`HTMLElement.click()` attempts, **no** `window.open` or programmatic
anchor-click URL, and two intercepted network requests (ordinal 4/group 1,
ordinal 2/group 2). The blocked requests were NOT proved to belong to a
specific card and do not establish a source destination.

The next distinct experiment uses the opt-in flag
`--probe-trusted-source-card-actions` instead of
`--probe-source-card-actions` (the two are mutually exclusive).
After the source pill has opened in a disposable browser session,
CDP `Fetch.enable` must succeed before any click is dispatched.
The probe checks the exact expected number of source-card buttons,
their viewport rectangles and the hit-test at each center point,
then sends native CDP `Input.dispatchMouseEvent` move/press/release
events. Unlike `HTMLElement.click()`, these input events can exercise
browser user-activation paths. It records `window.open` and programmatic
anchor-click intent as **private evidence**, plus temporally nearby
blocked requests without claiming the latter belong to a card.
Navigation remains blocked after guard installation, including any
newly paused page target. No original stylesheet or offline output is
modified.

A sanitized counts-only report is generated with
`inspect-trusted-source-cards.mjs`. It reports dispatches,
obscured/unmounted buttons and source intents per group. No URLs are
printed. Because a true click may dismiss its popup, later cards may
be unavailable; partial group coverage is not proof of missing sources.

The old capture cannot validate trusted input; one new isolated
guarded observation is required **only after** running focused tests.
Do not combine this capture with CSS/image fidelity testing.
Do not publish private `events.jsonl` or promote intercepted
background requests to verified source links.

From the PoC directory:

    (
      set -eu
      git pull --ff-only
      node --check render-probe.mjs
      node --check inspect-trusted-source-cards.mjs
      node --test tests/trusted-source-cards.test.mjs
      umask 077
      CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-share2-trusted-XXXXXXXX")"
      node render-probe.mjs 'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' "$CAPTURE_DIR" --headless --sweep --observe-interactions --probe-trusted-source-card-actions
      printf 'CAPTURE_DIR=%s\n' "$CAPTURE_DIR"
      node inspect-trusted-source-cards.mjs "$CAPTURE_DIR"
    )


## Trusted input visibility correction (2026-10-27)

The operator ran the real e6beb9f probe with the verified share-2 URL.
All three focused Node tests passed and the capture at
/home/admino/chatgpt-share2-trusted-avDsYYDq completed, with 76 snapshots,
eight source groups and 19 source-card observations. **All 19 were
reported card-not-visible**, so CDP did not dispatch a single native
mouse event. This is a positioning/readiness failure of the experimental
probe, not evidence about the source destinations. Network guarding was
successfully enabled, with no guarded failures.

The separate trusted-input mode now brings each +N source trigger into
the viewport *before opening its popup*. If a button still falls outside
the viewport, it calls scrollIntoView exactly once, waits for layout to
settle and evaluates geometry and hit testing again before any pointer
input. A closed/unmounted button is not clicked. Zero-size or invalid
geometry is reported separately, since scrolling cannot make such a
control visible. The original synthetic-click probe and regular
read-only capture remain unchanged.

The private-safe report adds scrollAttempts, zeroSize and invalidGeometry
per source group. These values distinguish positioning attempts from
actual dispatched input and prevent interpreting a zero-target result as
a tested navigation if nothing was clicked.

Run a single new guarded capture only if the focused test suite succeeds,
using --headless --sweep --observe-interactions
--probe-trusted-source-card-actions with the verified
https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259 URL.
The accepted offline HTML, diagram, CSS and long-message toggles are not
altered. Raw events.jsonl remains private.


## Verified per-card URLs and virtual-scroll preservation (2026-10-27)

Physical vmdev capture `/home/admino/chatgpt-share2-trusted-jmYoPJvJ`,
made with revision `27d0d7b`, passed all 11 focused Node tests and completed
70 distinct turn snapshots. For **5 of the 8 known source-pill groups**
(ordinals 6:0, 4:0, 2:0, 2:1, 2:2), all 10 native CDP mouse inputs were
dispatched and all 10 resulted in per-card `window.open` attempts.
The other three known groups (6:1, 6:2, 4:1) were not visited in
this particular sweep; they are **not proven absent**. The three
blocked requests are unscoped network evidence only.

Cause of incomplete group coverage: when the trusted-input probe called
`scrollIntoView` for a source pill, it moved the same virtualized scroll
root that the main sweep was traversing. The source-specific mode now
restores the sweep's current scroll cursor **after every sampling action**,
preventing popup positioning from altering iteration progress. This
cursor preservation is disabled for the normal capture, CSS acquisition
and synthetic-click modes. A deterministic regression test exercises
the actual sweep body with interaction-induced scroll jumps.

`inspect-trusted-source-evidence.mjs` verifies private source action
evidence without emitting URLs. It requires exactly one unambiguous
HTTPS destination for a successfully dispatched source-card button,
rejects invalid protocols and conflicting values across captures,
and does not promote adjacent blocked requests to links. A separate
previous `interaction.source-hover` capture can supply the full
8-group catalog so missing groups are shown as missing rather than
silently skipped. Distinct URLs are stored and processed only in
private local files. This script does **not** yet modify the offline
HTML; standalone source-popover restoration still requires complete
and structurally matched evidence plus a browser acceptance check.

From the PoC root, inspect the evidence **already captured**:

    node inspect-trusted-source-evidence.mjs \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ

After pulling, run:

    node --test tests/live-share-interactions.test.mjs \
      tests/trusted-source-cards.test.mjs \
      tests/sweep-scroll-cursor.test.mjs \
      tests/trusted-source-evidence.test.mjs

Only then perform one new **navigation-guarded** sweep with the corrected
scroll cursor using exactly this URL:

    https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259

Use `--headless --sweep --observe-interactions --probe-trusted-source-card-actions`
and a new private directory, then pass that directory alongside the two
previous evidence directories to `inspect-trusted-source-evidence.mjs`.
If verification reports 8/8 groups complete, the next work unit can
implement opt-in offline links using those verified destinations.
Never paste `events.jsonl` or private links.


## Targeted source group recovery (2026-10-27)

Physical vmdev run on revision `a60e522`: all **15/15** focused tests
passed. Previous private evidence returned 5/8 complete source groups
(10/19 destinations), then the cursor-preserving guarded capture
`/home/admino/chatgpt-share2-trusted-XPK0vYAM` raised the aggregate
to **7/8 groups, 17/19 per-card HTTPS targets**, without ambiguities
or conflicting URLs. The sole missing group is turn ordinal **4**,
source-pill index **1**, expected **2** destinations.

The opt-in trusted-input mode can now accept
`--source-group 4:1`. This causes its existing source scanner to skip
all other ordinals and source-pill indices *without clicking them*,
so the popup at 4:0 cannot obscure 4:1. It retains native CDP pointer
dispatch, fail-closed network interception and scroll-cursor
preservation. The group identifier is the existing
`conversation-turn-<ordinal>` and zero-based source-pill index,
not a new source identity. The flag is rejected outside the guarded
`--probe-trusted-source-card-actions --observe-interactions --sweep`
combination. If the target is not mounted during the sweep, no
`interaction.trusted-source-card-intents` event will be generated
and the evidence auditor must report the group incomplete; no URLs
may be inferred.

Run one new **private** guarded capture after targeted regression tests:

    node --test tests/targeted-source-group.test.mjs \
      tests/live-share-interactions.test.mjs \
      tests/trusted-source-cards.test.mjs \
      tests/trusted-source-evidence.test.mjs

    umask 077
    CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-share2-targeted-XXXXXXXX")"
    node render-probe.mjs \
      'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
      "$CAPTURE_DIR" \
      --headless --sweep --observe-interactions \
      --probe-trusted-source-card-actions --source-group 4:1

    node inspect-trusted-source-cards.mjs "$CAPTURE_DIR"
    node inspect-trusted-source-evidence.mjs \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ \
      /home/admino/chatgpt-share2-trusted-XPK0vYAM \
      "$CAPTURE_DIR"

The source evidence auditor is intentionally strict: it verifies
unambiguous per-button HTTPS targets but does not yet independently
prove that ordinal/index identity survived *every* remount between
different captures. Keep that acceptance step separate before rendering
live source links in an offline artifact. Source URLs are never
included in sanitized output. No changes to original CSS,
approved diagram, long-message preview or inert offline policy.


## Cross-capture source-group identity audit (2026-10-27)

The physical vmdev `5aed187` targeted run passed **17/17 Node tests**.
Its private capture `/home/admino/chatgpt-share2-targeted-vdv4T3G3`
visited only source group `4:1`, dispatched two trusted CDP mouse
clicks and intercepted two `window.open` HTTPS destinations. With
the three existing private evidence directories, the strict
`inspect-trusted-source-evidence.mjs` audit now reports **8/8
source groups and 19/19 card destinations, ambiguousCards=0**.
These are per-card navigation intents; they are not yet validated
offline links. No intercepted blocked background request is used
as source attribution.

Before assigning URLs to pill controls in the inert styled export,
the exact cross-capture group identity must be checked independently.
`inspect-source-group-identity.mjs` reads and SHA-verifies existing
`turn.snapshot` files and selects the richest snapshot for each
conversation ordinal. It compares original capture turn/message
identities and SHA-256 fingerprints of the normalized text immediately
surrounding each ordered `+N` leaf control. It detects cardinality
changes, missing snapshots, insufficient distinctive local text,
within-turn fingerprint collisions and cross-capture context or
message-identity mismatches. No text, URL, message identifier, hash
or original capture filename is printed; only each ordinal/index
and the verification status are reported.

This is deliberately fail-closed. Even if all 19 URLs are verified
by browser input, `safeToRestore` remains false unless every
source group has matching captured message identities and local
contexts from at least two independent captures. Stable context is
necessary but not a complete proof of UI appearance, original
source-card order or historical source URL validity. No original
CSS, accepted diagram, collapsed-message controls, CSP or offline
source button is changed by this audit.

From the PoC directory, after pulling and testing, inspect the four
existing **private** capture directories:

    node --test tests/source-group-identity.test.mjs \
      tests/trusted-source-evidence.test.mjs
    node inspect-source-group-identity.mjs \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ \
      /home/admino/chatgpt-share2-trusted-XPK0vYAM \
      /home/admino/chatgpt-share2-targeted-vdv4T3G3

Do not share raw capture data. Once identity auditing and full-card
attribution are confirmed on vmdev, restoration of native, script-free
source disclosure and external anchors can be developed as a separate
explicitly validated rendering step.


## Optional inert offline source disclosures (2026-10-27)

Physical vmdev evidence on PoC 2f6960c passed six targeted tests
and `inspect-source-group-identity.mjs` reported **8/8 stable source-pill
groups**, `completeUrlGroups=8` and `safeToRestore=true`, using four
independent private captures. Earlier guarded CDP input recovered **19/19
per-card HTTPS window-open destinations**, with no ambiguities.

The styled original-CSS renderer now supports a strictly opt-in
`--sources <private-evidence-dir>...` extension. The default two-argument
invocation produces the **unchanged** styled archive. In source mode the
renderer checks complete unambiguous HTTPS intent per button, audits
cross-capture source-pill identity **including the selected styled
capture**, then additionally compares each selected turn snapshot's
ordered local source-pill fingerprints against the trusted reference.
Any missing turn, changed group ordering, unsupported original trigger,
missing selected snippet or incomplete URL evidence aborts the entire
render, without creating the user-requested output directory.

Only exact original trigger HTML fragments are replaced; unrelated
assistant markup (including accepted SVG and cost table) and original
captured CSS bodies remain untouched. Each verified group becomes a
script-free native `<details><summary>` disclosure. The summary retains
the original trigger's label, child icon markup, class and inline style.
Its list displays the verified HTTPS source links labeled by hostname
and source ordinal: **original card titles were not captured**, so
synthetic card titles are never attributed to the original interface.
The additional CSS affects `poc068-source-details` and its children
only, providing necessary popover presentation without changing the
writing editor or arbitrary assistant content. Existing `script-src
'none'` and the archive's private-file permissions remain in force.
External source URLs are intentionally contained in the resulting
private HTML because the user explicitly requested usable links;
they are never copied to Git or included in sanitized stdout.

No new browser acquisition is needed. From the PoC directory, run:

    node --test tests/offline-source-controls.test.mjs \
      tests/source-group-identity.test.mjs \
      tests/trusted-source-evidence.test.mjs \
      tests/offline-preview-controls.test.mjs \
      tests/same-session-styled.test.mjs

    umask 077
    STYLED_DIR="$(mktemp -d "$HOME/chatgpt-share2-linked-XXXXXXXX")"
    rmdir "$STYLED_DIR"
    node render-same-session-styled.mjs \
      /home/admino/chatgpt-share2-interactive-m8xthV9A \
      "$STYLED_DIR" --sources \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ \
      /home/admino/chatgpt-share2-trusted-XPK0vYAM \
      /home/admino/chatgpt-share2-targeted-vdv4T3G3
    xdg-open "$STYLED_DIR/index.html"

Verify in Chromium the original OpenAI +N summary appearance, native
open/close behavior, correct and distinct external targets (without
requiring the target website to be live), the already accepted diagram,
long-user-message collapse controls, the cost table, and the unmodified
original CSS on the "Scrittura" writing block. The new source controls
are **not yet operator-accepted** until the physical test and visual
comparison succeed. RAW/full-conversation completeness remains separate.


## Legacy source-hover compatibility for styled archive (2026-10-27)

Physical vmdev test on `45eeda7` passed **15/15 focused Node tests**.
However, rendering against the previously accepted styled source capture
`/home/admino/chatgpt-share2-interactive-m8xthV9A` stopped before
creating an output with **`Invalid expected source count`**.
The opt-in renderer accidentally included that old styled-capture event
stream in the strict navigation/source-count evidence collector. This
older snapshot capture is valid for CSS, DOM and message identity but its
`interaction.source-hover` events predate the `expectedSources` field.
The four separately validated navigation captures already verify 19/19
targets and must remain the only input to source-link attribution.

The fix preserves strict verification, **separating evidence purposes**:
`auditSourceGroupIdentity(identityCaptures,evidenceCaptures)` reads
hashed turn/message snapshots from **all** identity captures (including
the old styled source) but reads source-count and URL evidence only from
the explicitly supplied, complete navigation captures. Both capture
sets are checked for consistency; source evidence directories must
belong to the identity set. Existing CLI and one-argument use continue
to require source evidence from every input, unchanged.

The styled renderer now calls the identity audit with
`[...navigationEvidenceDirs, styledCapture]` and the independent
`navigationEvidenceDirs`. The source-linked output remains opt-in
and fail-closed; the exact selected source turn still must pass its
fingerprint check before any source control is written. The integration
test fixture now includes a legacy `interaction.source-hover`
without `expectedSources` in its styled capture, which reproduces
the prior failure. No CSS, renderer output defaults, source URL values,
original user preview behavior or accepted diagrams are changed.

On vmdev rerun the focused source/identity/styled tests, then repeat
the same `render-same-session-styled.mjs ... --sources ...` command
with a new private output directory. No new Chromium acquisition
is necessary. Report a sanitized error if another strict check fails
rather than patching the original snapshots.


## Captured source trigger lexical matching (2026-10-27)

Operator vmdev on `2ae3f93`: all **15/15** targeted Node tests
passed. Styled rendering progressed past the legacy `expectedSources`
issue but failed with **`Exact captured source trigger not found; no
transformation`**, with no output directory created. The source-pill
DOM signature and URL evidence were already accepted; the failure
concerns how the renderer locates the *literal bytes* of the original
source trigger in a browser-captured HTML snapshot. The earlier
implementation searched for `trigger.outerHTML` from linkedom, but
the parser can serialize original attribute quoting, entity spellings,
whitespace and inline SVG differently.

The source restoration routine now tokenizes only HTML tag boundaries,
respecting quoted `>`, comments, raw-text tags, nested tags and void
elements, and records the byte ranges of original `aria-haspopup`
elements. Each source candidate is parsed independently, required to
contain exactly one direct +N pill and matched in order against the
already-verified canonical DOM trigger and label. It rejects missing,
multiple, nested or structurally different candidates. Replacement
proceeds from the end of the document using exact source byte ranges,
and the original trigger's child markup (including SVG) is reused
literally inside native `summary`. All bytes outside each verified
trigger range remain unchanged. There is no whole-document
reserialization or relaxation of strict identity/HTTPS checks.

New regression tests exercise quoted `>`, `&amp;`, inner SVG,
identical-looking source groups with distinct ordered URLs, and
ambiguous trigger rejection. The default two-argument archive remains
unchanged, and the opt-in source mode remains fail-closed. The accepted
diagram, table, message preview and original CSS are not restyled.

On vmdev, run the focused regression suites before retrying the same
five-input rendering command (one styled capture + four private link
evidence captures) in a fresh output directory. If parsing the real
capture exposes a further mismatch, report only the sanitized
exception; never publish raw HTML or private source URLs.


## Offline citations, source controls and missing icons: operator review (2026-10-27)

The operator physically confirmed that the latest opt-in linked HTML opens
and that the *multi-link citation* groups expand/collapse and their HTTPS
links work. However, the favicon-style icons in those groups are absent
(the destination website shows its own icon when opened), citations with
a **single link** do not open their destination, and separate **"Fonti"**
controls do not expand/collapse. These three UI categories must not be
conflated with the already verified 8 groups / 19 URL intents. The
existing `offline-source-controls.mjs` only builds native disclosures
for +N source-pill groups; each source anchor is explicitly generated
with a hostname label and **no icon element**, so missing icons in
those generated lists are a current implementation gap, not evidence
that an original favicon was captured.

The separate, read-only `inspect-offline-link-controls.mjs` inspects a
**local generated output directory**, not live ChatGPT. It reports
counts by turn for standalone "Fonti"/"Sources" controls,
single-citation-like buttons, buttons/anchors without href,
native +N disclosure counts, missing icon elements, original img and
SVG-use resources, CSS URLs and relevant CSP flags. Remote, local and
missing image references are distinguished without exposing actual
URLs, messages, CSS declarations or file paths. A button without an
href is **not automatically a broken link**; it may have had React
onClick behavior, now inert because the archive preserves
`script-src 'none'`. Likewise an original external favicon reference
does not prove a local byte was captured. Only an actual Chromium
interaction test can prove rendering, visibility and navigation.

From the PoC directory, inspect the latest private linked archive:

    node --test tests/offline-link-controls.test.mjs
    STYLED_DIR="$(find "$HOME" -maxdepth 1 -type d -name 'chatgpt-share2-linked-*' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f 2-)"
    test -f "$STYLED_DIR/index.html"
    node inspect-offline-link-controls.mjs "$STYLED_DIR"

Never paste the private HTML, raw URLs or message text. Use the sanitized
report to determine which original controls still need independent
source-to-URL evidence before converting them to native anchors/details.
Do not change the already working multi-link +N disclosures, accepted
diagram, table, user previews, original CSS or inert CSP until exact
provenance and structural ownership are known. Keep the accepted source
archive available for regression comparison.


## Offline citation and asset provenance follow-up (2026-10-27)

The operator ran `inspect-offline-link-controls.mjs` on the actual
latest linked offline page at PoC revision `13eb6e7`: **2/2 fixture
tests passed**. The page contains 8 native +N disclosures and all 19
HTTPS source anchors, correctly labelled, each disclosure has a native
summary and an SVG in its summary, but **all 19 submenu links lack
icon elements**. Four separate `Fonti` buttons have no href or native
expand/collapse state. Nine `aria-haspopup` elements outside the
restored +N controls are single-citation *candidates*, not verified
links (8 spans and 1 button). The page includes **24 remote IMG
references** and 9 absolute SVG-use references. With
`script-src 'none'`, remaining original React-only buttons cannot
be made functional simply by preserving the original markup. This is
user-observed browser evidence plus structural evidence; it is not
proof of source URL ownership for singleton citations or `Fonti`.

`inspect-offline-control-provenance.mjs` is a distinct read-only
private-safe inspector for the existing linked offline output plus
previously recorded private captures. It reports the DOM role/parent
of the four `Fonti` controls and singleton popup candidates, along
with how many external IMG URLs can be matched by **exact HTTPS URL
and a verified SHA-256 file body** in those captures. Same-session
request identity is required; one request/body mismatch, corrupt
file or conflicting hash is counted and not accepted. It does not
rewrite the offline HTML, fetch any website, associate icons with
citation targets, open a source popup or print raw URLs/text/hashes.

Normal run from the PoC root after `git pull --ff-only` and the
focused fixture tests:

    node --test tests/offline-control-provenance.test.mjs
    STYLED_DIR="$(find "$HOME" -maxdepth 1 -type d -name 'chatgpt-share2-linked-*' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f 2-)"
    test -f "$STYLED_DIR/index.html"
    node inspect-offline-control-provenance.mjs "$STYLED_DIR" \
      /home/admino/chatgpt-share2-interactive-m8xthV9A \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ \
      /home/admino/chatgpt-share2-trusted-XPK0vYAM \
      /home/admino/chatgpt-share2-targeted-vdv4T3G3

This report is the prerequisite for choosing whether already verified
image bytes can be reused. Do not substitute a site's favicon from a
different URL, synthesize citation URL ownership or weaken the offline
CSP. Maintain the operator-accepted eight multi-source disclosures,
original CSS, diagram, cost table and message-preview semantics.


## Exact offline localization of previously captured icons (2026-10-27)

The operator's latest vmdev run on PoC `5cf5b9e` passed all **4/4**
source-control diagnostics and confirmed that **all 24 external IMG
references** in the accepted linked archive have a saved image body
matched by their **exact HTTPS URL and SHA-256** in the five existing
private capture directories. These 24 references are backed by 11
verified recorded image bodies and have **zero conflicts**.

`localize-exact-captured-images.mjs` is an independent, opt-in,
network-free postprocessor. It accepts an existing private linked
archive, a **new output directory** and one or more private capture
directories. It SHA-verifies indexed original image bytes, checks
supported image format signatures, and refuses any missing/conflicting
source reference before creating output. Only original remote `img
src` attributes are rewritten to local `assets/poc068-exact-<sha>`
files; remote `srcset` is removed on each localized image to ensure
the browser does not prefer an unverified remote alternative. It
preserves the original CSP (including `script-src 'none'`), CSS,
unchanged image markup beyond the matched attributes, accepted
assistant diagram, cost table, long-message native previews and all
existing 8 native +N disclosures / 19 HTTPS anchors. It copies the
previous archive into a new private directory and refuses symlinks,
unsupported formats, corrupt/missing image bodies or ambiguous mapping.
The existing linked output is never modified.

This fixes original IMG references whose exact bytes were captured;
it does **not** invent favicon elements in the 19 generated source
menu anchors, does not convert singleton React citation controls into
anchors, and does not make the four separate `Fonti` React buttons
work. Those remain distinct work units requiring verified ownership.

From the PoC directory on vmdev:

    node --test tests/localize-exact-captured-images.test.mjs \
      tests/offline-control-provenance.test.mjs
    STYLED_DIR="$(find "$HOME" -maxdepth 1 -type d -name 'chatgpt-share2-linked-*' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f 2-)"
    test -f "$STYLED_DIR/index.html"
    EXACT_DIR="$(mktemp -d "$HOME/chatgpt-share2-exact-icons-XXXXXXXX")"
    rmdir "$EXACT_DIR"
    node localize-exact-captured-images.mjs "$STYLED_DIR" "$EXACT_DIR" \
      /home/admino/chatgpt-share2-interactive-m8xthV9A \
      /home/admino/chatgpt-share2-targets-WiF0gU8j \
      /home/admino/chatgpt-share2-trusted-jmYoPJvJ \
      /home/admino/chatgpt-share2-trusted-XPK0vYAM \
      /home/admino/chatgpt-share2-targeted-vdv4T3G3
    node inspect-offline-control-provenance.mjs "$EXACT_DIR"
    xdg-open "$EXACT_DIR/index.html"

The report must count 24 localized IMG references and zero conflicts;
the generated archive should have **zero remote IMG src references**
and preserve 8 details / 19 links. Physical Chromium comparison is
required to accept icon appearance, layout and click behavior. Do not
send private archives or original source URLs to GitHub.


## Guarded recovery of singleton citation and standalone Fonti behavior (2026-10-28)

The operator accepted the **external-link icon visibility** in the
exact-localized private offline archive. This visual result is fixed;
no more image recapture is required. The existing 8 expanded +N groups
and 19 individually verified HTTPS destinations must also be preserved.

The two remaining controls are semantically different from +N groups:
- singleton citation triggers may navigate directly without displaying a
  dropdown; a current static span with aria-haspopup is not sufficient
  evidence of its correct destination;
- the four separate "Fonti" buttons may open a dedicated source panel;
  their original panel DOM and click ownership must be observed rather
  than guessing that their content is the union of nearby +N links.

New opt-in live runner mode \`--probe-remaining-controls\` probes only
these two control categories under the same **fail-closed CDP Fetch
interception** and trusted pointer input as the earlier successful
source-card experiment. The new mode is mutually exclusive with the
original +N source-card action modes, and requires \`--headless --sweep
--observe-interactions\`. It selects exact standalone Fonti-labelled
buttons and leaf aria-haspopup controls containing an IMG but no +N
source pill. It excludes nested aria-haspopup wrappers and the
previously accepted +N controls. It stores per-control original markup,
any directly intercepted window.open or scripted anchor clicks and
bounded newly visible popup DOM **only inside the private capture**.
All subsequent network requests remain blocked. It always retains the
virtualized sweep's scroll cursor after a probe.

\`inspect-remaining-controls.mjs\` prints a **privacy-safe summary**
(counts, turn/index, control kind, evidence status and popup structure
only). An intercepted direct HTTPS open is navigation intent evidence;
a nearby blocked request is not. Popup observation alone is not proof
of complete panel content. No offline HTML/CSS, image assets, source
URLs, CSP, accepted diagram/table, preview controls or working +N
disclosures are modified by this observation work unit.

From the PoC root, run the focused tests and **one new disposable
guarded observation** of the already known correct share 2 URL:

    node --test tests/remaining-controls.test.mjs \
      tests/trusted-source-cards.test.mjs
    umask 077
    CAPTURE_DIR="$(mktemp -d "$HOME/chatgpt-share2-remaining-XXXXXXXX")"
    node render-probe.mjs \
      'https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259' \
      "$CAPTURE_DIR" --headless --sweep \
      --observe-interactions --probe-remaining-controls
    node inspect-remaining-controls.mjs "$CAPTURE_DIR"

Never share events.jsonl or the private capture directory's HTML files.
Report only the sanitized JSON. On actual evidence, implement **separate
inert, script-free** transformations for verified singleton direct
anchors and verified Fonti panel disclosure, preserving the approved
24 localized external-image references and the working 8/19 +N links.
If observed evidence is insufficient, keep those controls unmodified
and explain the precise missing association rather than substituting
the known +N target URLs.


## Two-stage singleton navigation and inline Fonti follow-up (2026-10-28)

Physical vmdev on PoC `866de4c` passed **9/9** focused Node tests
and completed a guarded Chromium capture in
`/home/admino/chatgpt-share2-remaining-23cpAMPP` (1,459 events,
113 unique turn snapshots). It found 12 individual control attempts:
four standalone `Fonti` buttons (ordinal 6 initially offscreen,
2 unmounted, 4 and 8 dispatched without a newly visible recognized
popup) and **eight singleton-citation controls** (ordinals 2,4,6,8).
All eight singleton triggers successfully opened a visible original
React popup, each with exactly **one button, zero href anchors**.
None of the eight initial trigger clicks directly opened an HTTPS URL.
This confirms that original singleton citation links must be tested
at the *popup's internal button*, not inferred from its original
`aria-haspopup` span. The absence of a `Fonti` dialog is not proof
that the button did nothing: it might change inline turn DOM or
render under an unrecognized non-dialog container.

The same opt-in `--probe-remaining-controls` mode now performs a
**second, independently hit-tested trusted CDP pointer click** only
if the original singleton popup yields one connected, visible button.
It captures `popupCardOpened` and `popupCardAnchors` as private
per-control evidence, distinct from the initial trigger intents.
The report prints only the counts, the second-click result and a
`popupButtonHasImage` flag. For each `Fonti` click it also saves
bounded original assistant-turn DOM **before/after** in the private
capture, and reports only `turnChanged` / `turnTruncated` flags.
Offscreen or unmounted targets can now be retried on later sweep
positions, at most three attempts, without monopolizing a scan
at one cursor. The original strict Fetch network guard and
sweep-scroll cursor preservation remain in place.

The report is still evidence, **not** a renderer repair. Single
citations may be converted to script-free direct anchors only after
their *own* popup button's exact HTTPS destination is verified and
matched to the original turn/control. The four `Fonti` panels
must be reconstructed from an actually observed/verified panel, not
from the existing 19 +N URL targets. The previously accepted icon
localization, eight +N disclosures, original CSS and diagram,
long-message controls and `script-src 'none'` remain unchanged.

From PoC 068 on vmdev, rerun the focused tests and one new guarded
observation using exactly the same correct share URL and flags as
above. Inspect the new private capture using
`node inspect-remaining-controls.mjs <new-capture-dir>`. Never
paste raw HTML, `events.jsonl` or captured source URLs.


## Verify and restore eight singleton citation anchors (2026-10-29)

The guarded real vmdev capture on PoC `f585472` succeeded in
`/home/admino/chatgpt-share2-remaining-7GRRAT1l`: 101 unique turn
snapshots and 12 attempted remaining controls, zero Fetch guard
failures. **All eight** singleton citation popup buttons were
independently hit-tested and dispatched, each with one directly
intercepted `window.open` HTTPS target. Thus we now have exact
second-click attribution, not inferred links from adjacent +N pills.

All four `Fonti` buttons also dispatched: ordinals 2 and 6 reported
a changed turn DOM, while 4 and 8 did not; no previously recognized
standalone popup. This is not sufficient to reconstruct four native
Fonti disclosures.

`restore-singleton-citations.mjs` is an opt-in, fail-closed **local
postprocessor** accepting the existing *exact-icons* private archive,
a NEW private output directory, and BOTH original remaining-control
captures (first-click observation and successful second-click
observation). It requires exactly eight original single-citation
controls, the 1/2/3/2 per-turn distribution, matching structural
fingerprints across both captures, unique exact HTTPS second-button
intent for each, and matching per-turn/index/structure in the offline
HTML. It ignores mutable React IDs and original IMG.src URL values
because the latter were replaced by SHA-verified local image files.
It patches only verified original byte ranges by wrapping each source
control with a normal native HTTPS anchor and copying the original
element bytes intact. The existing 8 +N groups / 19 link targets, the
original external icons, CSS and inert CSP are unchanged. A missing
or ambiguous association aborts without creating an output.

`inspect-fonti-dom-deltas.mjs` reads the private original Fonti
before/after HTML events and prints only structural counts/deltas
(added/removed links, elements, list items, buttons, sections,
aria-expanded changes and normalized text length differences).
It does not reconstruct Fonti; evidence of the actual panel's DOM
and ownership must precede that change.

From the PoC root on vmdev:

    node --test tests/restore-singleton-citations.test.mjs
    umask 077
    ORIGINAL="$(find "$HOME" -maxdepth 1 -type d -name 'chatgpt-share2-exact-icons-*' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f 2-)"
    test -f "$ORIGINAL/index.html"
    OUTPUT="$(mktemp -d "$HOME/chatgpt-share2-singletons-XXXXXXXX")"
    rmdir "$OUTPUT"
    node restore-singleton-citations.mjs "$ORIGINAL" "$OUTPUT" \
      /home/admino/chatgpt-share2-remaining-23cpAMPP \
      /home/admino/chatgpt-share2-remaining-7GRRAT1l
    node inspect-fonti-dom-deltas.mjs \
      /home/admino/chatgpt-share2-remaining-7GRRAT1l
    xdg-open "$OUTPUT/index.html"

If it succeeds, verify eight direct HTTPS singleton citations,
all eight accepted +N menus and 19 links, icon visibility, diagram
and CSS. Keep the old exact-icons archive intact for comparison.
If the strict identity check refuses a control, report the sanitized
error: do not patch the HTML or insert a guessed URL. Never share
the private archive, original links, raw events or capture DOM.
