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

## Security boundaries

The URL must be an HTTPS \`chatgpt.com/share/\` conversation link, not a scheduled-task share. The exporter neither extracts cookies nor bypasses sign-in challenges. Browser profile state remains with web-control. Archive output is private data: do not commit it to public GitHub or share it without review. HTML snapshots and any image URL containing signed query parameters can reveal information, so avoid diagnostic logging of asset URLs.

## RumiAI context

Current governing sources: \`rumiai-dev/RULES.md\`, \`CONSISTENCY-GATE.md\`, \`specifications/rumiai-os/WEB-CONTROL.md\`. Active task state: \`rumiai-dev/handoff/chatgpt-export.md\`.
