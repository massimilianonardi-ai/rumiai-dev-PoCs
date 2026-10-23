# PoC 068 — ChatGPT shared-page rendering mechanism

Status: Experimental evidence, not an RumiAI interface or a stable ChatGPT contract.
Source: committed real-browser capture at `rumiai-dev-PoCs@cfc4533627382bb0e339ea1c424eb96d1f88b123`, in `analysis-chromium-resources-02`. No history lookup and no new live capture in this analysis.

## Reproducible source attribution

The two particularly relevant **compiled** JavaScript resources in `scripts.jsonl` are:

| Captured asset URL basename | Content-addressed file | Git blob SHA | Role observed |
|---|---|---|---|
| `8b34dbc2-i6mnaw2f0obqfl0x.js` | `scripts/082eaa5e9e0e8547ce0633aed3766333d588e8eebf60d57f3715f1a68354ba6a.js` | `7287982fb205398a8460c37984f3aaa1fd2254d6` | Turn rendering, intersection-driven child mounting, render-coordinator |
| `conversation-small-fcu1fuggk1duh76x.js` | `scripts/d87462a803a961d4625067bad08fd48971020bfb7f6f6b3dfdcbf3933c01c84c.js` | `4e31b5fed07b29a27a5068b2b11b1b56d23b0f7d` | Scroll-root event registration and DOM queries by original IDs |

These generated symbol names and constants are specific to **this** captured build. Git blob SHA gives the exact revision independent of changing production asset filenames.

## Identified rendering chain

1. **Identity:** the message JSX sets `data-message-id` from `message.id`. The turn `section` sets `data-turn-id` and `data-turn-id-container` from `turn.id`, with `data-testid` derived from `conversation-turn-` plus turn ordinal. The outer virtualized turn `div` also holds `data-turn-id-container` and `data-is-intersecting`. Multiple nested nodes may share a turn ID; never assume there is only one matching element.
2. **Virtual turn implementation:** minified function `a5n` in the `8b34...` compiled asset receives `intersectionObserver`, `alwaysShow`, `forceRender`, `onIntersectingChange`, `turnId` and `turnIndex`. It calls the supplied observer's `observe` method, handles visibility callbacks, sets local React state, and calls `onIntersectingChange`. When content is not enabled, its child JSX is `null`; a wrapper can remain with `--estimated-turn-height` and/or `--last-known-height`.
3. **Rendering exceptions:** the calling component renders the final five turns unconditionally, and turns within ±5 positions of the selected reference index. It also supplies explicit `forceRender` for selected/targeted turns. Special content groups can trigger additional always-render conditions. These are observed build constants, not general guarantees.
4. **Coordinator and geometry:** the calling component (observed near minified `tpr`) maintains a set of currently intersecting turn IDs. The `onIntersectingChange` callback updates that set and its reference index; a layout-preservation step finds a turn by `data-turn-id-container` and corrects the real scroll container's `scrollTop` after reflow to retain the user's visual anchor.
5. **Actual scroll-root listener:** in the `conversation-small...` asset, function `QNe` registers a native `scroll` listener and toggles `data-scroll-from-top` using the element's own `scrollTop`, not `window.scrollY`. Scroll-to-message behavior queries `data-message-id` first and falls back to `data-turn-id-container`.

The application uses an observer adapter (its exposed `observe` is not necessarily a raw `IntersectionObserver`). We must distinguish the adapter callback from the native browser observer's callback instead of claiming their equivalence without runtime instrumentation.

## Comparison with physical capture

The new `summary.json` reports 4,768 events, including 1,063 DOM mutation batches, 1,066 interaction events, 1,882 network events and 666 performance events, with no declared dropped event records. Its DOM batches aggregate 1,994 added nodes, 821 removed nodes and 1,758 attribute changes. There are 256 captured `scroll` events.

The capture also archived 614 response bodies (40,498,763 bytes) and 530 parsed-script source events (525 distinct source files). These counts validate substantial source coverage, **not** perfect completeness.

The existing `web-analyze` DOM mutation samples omit individual node IDs, and its scroll records contain `window.scrollY` instead of the target container's `scrollTop`. Therefore the original event stream cannot independently prove which `data-turn-id-container` gained/lost content after each observer notification. Static source analysis plus temporal correlation cannot conclusively attribute a particular mutation to a specific callback.

## Controlled experiment required to establish causality

- Inject observation **before initial page navigation**, recording native `IntersectionObserver` and `ResizeObserver` constructions, registrations and callback notifications with their root/options/target turn IDs. Record listener-registration callsites for `scroll`, `wheel` and `resize`, avoiding password, request-body and token capture in diagnostic logs.
- At runtime identify the actual `[data-scroll-root]` element and record `scrollTop`, `scrollHeight`, `clientHeight`, element bounds and a stable DOM locator. Change **real element.scrollTop** incrementally in each direction; synthetic dispatch of a `scroll` event alone does not change geometry or establish an observer transition.
- Observe every `[data-turn-id-container]` placeholder and its descendant `[data-message-id]` nodes. For each transition, correlate observer notification, wrapper `data-is-intersecting`, added/removed descendants, outerHTML snapshot, message IDs and height. Capture full rendered turn HTML before virtualization removes it, without assuming that HTML alone preserves interactive behavior.
- Compare observed message IDs with the independently verified `chatgpt-export.lib.js` RAW transcript; report missing turns, repeated IDs, unrendered special components, resource failures and snapshots that exceeded explicit size limits. Only then attempt assembling an offline DOM replica.
- Preserve the existing Markdown baseline at `rumiai-os@17077e469469f11dddb66a530a1692a663ba9fcb`; a rendering probe belongs to this PoC until its behavior is verified.

## Executable controlled observer probe

The independently instrumented experimental entrypoint is `render-probe.mjs`. It launches Chromium from PATH via native loopback TCP CDP, injects a probe using `Page.addScriptToEvaluateOnNewDocument` **before initial navigation**, and captures:
- `listener.register` for scroll/wheel/resize listener registration;
- `intersection.create`, `intersection.observe`, `intersection.callback`;
- `resize.create`, `resize.observe`, `resize.callback`;
- `scroll.actual` with the scroll target's true scrollTop, scrollHeight and clientHeight;
- `dom.mutation` with affected turn IDs and counts;
- `turn.snapshot` with turn ID, descendant message IDs, and content-addressed full outerHTML files in `turns/` (per snapshot maximum 2 MiB; oversize explicitly reported).
- `turn.initial` for the first observed wrapper state, `turn.content-mounted` and `turn.content-unmounted` for observable changes in descendant message presence, and `turn.wrapper-removed` if the wrapper itself vanishes. These are observation-frame transitions, **not** direct instrumented React lifecycle hooks; changes occurring entirely between capture frames can be missed. Transition records preserve original turn/message IDs but omit message HTML.
- `listener.register`, `intersection.create` and `resize.create` include limited JavaScript origin stack frames, to locate the registration logic in captured JS; URL query strings/fragments are stripped from these callsite hints. Missing/minified symbols and wrapper-library stacks remain possible.

The optional `--sweep` option waits until a `[data-scroll-root]` and turn wrappers appear (up to 120 seconds), then modifies the scroll element's actual scrollTop incrementally forward and backward, allowing browser intersection callbacks and React to execute organically. Synthetic scroll-event dispatch alone is not used. The ordinary manual capture mode remains active until operator signal/browser close. The tool does not inject a fake React renderer, nor does it guarantee snapshots for every turn.

Usage from the PoC directory (choose a **fresh private directory**):

```sh
node render-probe.mjs \
  'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835' \
  './render-probe-run-01' --sweep
```

Inspect `render-probe-run-01/summary.json`, `events.jsonl`, and `turns/*.html`. These are private data and should not be committed.

The latest regression fixture additionally checks per-turn content mount/unmount transitions, stable IDs and registration callsites. This does not establish which callback causes each transition on ChatGPT's live page.

Validation: `tests/.support/render-probe.mjs` runs the real entrypoint against a self-hosted virtualized HTML fixture in a real Chromium browser; its assertions check actual IO callback emissions, target scroll, snapshots, original message IDs at both ends and content persistence. GitHub Actions run `39432091366` (2026-10-20) reports PASS: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39432091366 . The follow-up commit `2a8cacecbef5c9cda5753d23d78b45acda031e7e` avoids duplicate snapshots for nested wrappers sharing the same turn ID by selecting the outermost wrapper; the updated Chromium test also reports PASS in run `39432702338`: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39432702338 . This is **synthetic-fixture browser validation**, not a real ChatGPT replay result. Full-page coverage and faithful DOM reconstruction remain open.

## Real shared-page experiment and cumulative reconstruction (2026-10-20)

The operator supplied a private `render-probe-run-01.zip` captured on the
agreed real ChatGPT share using `--sweep`. The review found 5,247 events:
331 native IntersectionObserver callbacks, 135 real scroll events, 82
observed turn-content mounts, 78 unmounts, 148 snapshot events yielding 147
distinct HTML files. The 42 snapshotted turn IDs cover the contiguous ordinal
range **1–42**, with 42 distinct message IDs. A further wrapper was observed
without any saved rendered message. `conversation-turn-0` was **not**
captured; its absence is not automatically proof of a missing message.

Native IntersectionObserver #13, with `[data-scroll-root]` and 1,000 px root
margins, had matching same-turn visibility notifications preceding all observed
mount/unmount transitions. This is compelling temporal correlation, not an
instrumented proof of the internal React state update responsible for each
transition. No independent RAW transcript was included in the ZIP; complete
conversation coverage remains unverified.

The separate `assemble-rendered-dom.mjs` utility now creates an inert
cumulative `index.html`, `audit.json` and `resource-references.json`
from render-probe evidence. It verifies individual hashes, orders by original
DOM `conversation-turn-N` ordinal, preserves all captured snapshot-version
provenance and selects the latest version per turn. The optional `--raw`
argument compares message identities against a separately acquired
`conversation.raw.json.gz`. The utility's synthetic reconstruction tests and
real Chromium render-probe regression tests passed in
[GitHub Actions run 39490178468](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39490178468).
The archived real run was independently inspected and a structural HTML
preview assembled, but **the GitHub-published assembler has not itself been
executed on the private ZIP in CI**.

This is a structural artifact, not a browser-session replay. It does not
include original loaded CSS/remote image bytes, internal React state or event
listeners. Its strict Content Security Policy blocks external/network loads
and scripts, with original asset reference URLs retained only in the private
reference audit. Browser profiles or captured HTML containing private content
must not be committed.

## Data security and validation boundary

This repository already contains user-committed browser profiles and raw response/script evidence, which may include cookies, session data or signed URLs. Never include raw profiles or new unreviewed captures in another commit. Removing tracked files in a forward commit does **not** erase the history; do not rewrite history without explicit authorization.

The static findings above were verified against the exact Git blob sources and event indices. A user-operated controlled runtime experiment on the actual ChatGPT share is now available as a private ZIP and supports the observer/turn correlation described below. The full-fidelity, interactive DOM has **not** been recreated.

## Cumulative offline DOM assembly (2026-10-20)

The standalone experimental `assemble-rendered-dom.mjs` consumes an existing `render-probe.mjs` evidence directory. It does **not** navigate ChatGPT and does **not** replace the original renderer. It verifies each snapshot's SHA-256 against both filename and manifest, derives turn order from the captured `data-testid="conversation-turn-N"`, validates `data-turn-id-container` and `data-message-id`, selects the latest sequence-numbered HTML snapshot per turn, and concatenates exactly one original outer wrapper per turn into an **inert** cumulative document. Every previous snapshot version remains recorded in `audit.json`. It rejects duplicate ordinals, cross-turn duplicate message IDs, inconsistent identity, corrupt evidence and existing destination directories.

Invocation from this PoC directory:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01
# Optionally validate IDs against an independently exported source:
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-with-raw --raw /private/path/conversation.raw.json.gz
```

Files: `index.html` (original captured turn subtrees and minimal non-original presentation CSS), `audit.json` (selected hashes, all source versions, ordinal gaps and optional RAW-ID differences), `resource-references.json` (not-downloaded `src`/`href`/`poster`/`srcset` references). External network/script loading is blocked by a Content Security Policy; the HTML is **not** the running ChatGPT application and cannot preserve React state, callbacks, original CSS, asset bytes or interactivity. The assembly is private conversation data and should not be committed.

The operator's uploaded `render-probe-run-01.zip` was locally audited and assembled without opening its Chromium profile. Physical evidence: 148 snapshot events / 147 distinct source HTML blobs map to **42 unique ordered turn IDs and 42 message IDs**, with the captured `conversation-turn-1` through `conversation-turn-42` range contiguous and no duplicate ordinals. The resulting cumulative page contains **42 top-level turn subtrees**; its resource-reference audit finds **13 `src`** and **27 `href`** references (not asset files). The original `conversation.raw.json.gz` was **not included**, so equivalence to the total source conversation is unverified; the additional non-message turn wrapper remains unrepresented, because no HTML snapshot was recorded for it. The private resulting ZIP was delivered to the user separately, not added to Git.

Regression: `tests/.support/assemble-rendered-dom.mjs` verifies ordering, snapshot selection, version retention, RAW gap detection, a non-executable CSP, integrity failure and overwrite refusal. GitHub Actions `39490178468` passed both this synthetic-data test and the existing real-Chromium render-probe fixture: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39490178468 . This is **not** a test of the user page with a browser, nor an original-CSS/resource fidelity guarantee.

## Offline static-resource localization (2026-10-22)

Experimental, source-bounded `localize-rendered-resources.mjs` is a **second stage** after `assemble-rendered-dom.mjs`. It consumes an existing inert cumulative DOM output and the existing `analysis-chromium-resources-02` data captured by `web-analyze`. No network requests are made, no original capture is changed and no Chromium profile is read.

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01
node localize-rendered-resources.mjs ./cumulative-dom-01 \
  ./analysis-chromium-resources-02 ./cumulative-dom-localized-01
```

- Only first-party `chatgpt.com`, `*.oaistatic.com` and `*.openai.com` **saved** CSS, fonts and image/svg resource rows are eligible; JS, API JSON, HTML response bodies and foreign-host assets are not copied. Every allowed source body is independently checked against its SHA-256 and recorded length before output creation; SVG executable markup and invalid WOFF2 signatures are rejected. Content-addressed bytes are saved under `assets/`.
- CSS files are attached in captured network order (deduplicated), with `url(...)` mapped to hash-named local assets when the matching resource was archived; remaining remote CSS URLs are disabled and `@import` directives are blocked. Captured image and SVG `<use href="...#symbol">` references in original turn HTML are localized when indexed matches exist. Link destinations inside conversation text are **not** rewritten.
- Updated CSP continues to prevent scripts, connections, external media, forms and embedded frames, while allowing only local styles, images and fonts. The result includes `index.html`, original structural audit/reference metadata, `assets/` and `localization-audit.json` (counts and unresolved references). No React state, click handlers or dynamic widgets are restored.
- In the user-committed resource index there are **47 first-party stylesheet response rows (45 distinct SHA-256 bodies)**, **7 first-party fonts labeled application/octet-stream (all named .woff2)**, plus first-party sprite/SVG resources. These are *source inventory*, not proof that all pass localization or that the final rendering matches the live page. Of the 13 `src` DOM references previously observed, most point to `www.google.com/s2/favicons`; the archive separately records **11 HTTP 301 redirects** that share exact session/request IDs with the corresponding saved `t*.gstatic.com` PNG responses. The localizer now permits only these **proven redirect aliases** for third-party images, resolving matching DOM favicon references without hostname/filename guessing. Unmatched original references are still reported, not silently substituted. No sensitive binaries are recopied into Git; use only the user's private local checkout for the output.
- Regression in `tests/.support/localize-rendered-resources.mjs` validates CSS-relative images and WOFF2, SVG symbol fragments, **exact redirect-ID favicon alias mapping with HTML-encoded ampersands**, blocking external CSS imports, preserving inert CSP and ordinary content hyperlinks, rejecting corrupt SHA-256 and refusing to overwrite output. The final focused workflow run is linked in the current handoff; the earlier static-localizer checkpoint PASS was https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39847215881 . **This is a synthetic resource fixture test, not a real CSS screenshot parity validation.**
- RAW message coverage still cannot be verified until `conversation.raw.json.gz` is made accessible; `assemble-rendered-dom.mjs --raw` already supports the comparison without an additional extraction.

## Audited visible-message completeness from archived React Router RAW (2026-10-23)

The previous "RAW not available" boundary has been resolved using evidence
already collected by the operator. The **saved** `text/html` response for
`https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835` is
`analysis-chromium-resources-02/resources/125d7335b12ba7d8ac273ce92acf1aec7435936c3ed48e788d69690814977441.html`.
It embeds a React Router `streamController.enqueue` serialized hydration
stream. Its first frame is a flattened reference table (29,751 entries)
containing the `linear_conversation` array (951 references). This is real
RAW evidence, **not** a second download or a historical model-memory guess.

The 951 references break down into 1 root with no message; 21 user;
29 system; 429 assistant; and 471 tool nodes. Applying this observed
capture's visibility criteria—user messages addressed to `all`, and
assistant messages addressed to `all` with `end_turn=true`, excluding
`metadata.is_visually_hidden_from_conversation=true`—yields exactly
**21 user + 21 final assistant messages**. Four additional completed
assistant finals explicitly marked visually hidden are excluded.

An independent comparison with the operator-uploaded 42-turn cumulative DOM
found **zero missing or extra original message IDs and identical order**.
Both sides' newline-joined ordered IDs have SHA-256
`6a9aba4e9294c8c5b0e17756b59a6f4cea03e30d40ef744393d20ea3186916b3`
from the private capture. This establishes **complete visible-message ID and
order coverage for the archived shared conversation**—not a guarantee about
another share, hidden technical/tool nodes, visual-pixel identity, script
execution or live React state. The operator separately accepted the
localized page's visual fidelity.

A standalone reproducible `audit-rendered-dom-raw.mjs` entrypoint reads the
existing `cumulative-dom-01/audit.json` and the saved HTML `Document`
indexed by `analysis-chromium-resources-02/resources.jsonl`, verifies its
SHA-256 and length, parses the inert hydration data as text, and emits a
privacy-limited JSON result (counts, SHA-256 fingerprints and mismatch status
without raw transcript/ID disclosure):

```sh
node audit-rendered-dom-raw.mjs ./cumulative-dom-01 \
  ./analysis-chromium-resources-02 --out ./raw-completeness-01.json
```

The synthetic test `tests/.support/audit-rendered-dom-raw.mjs` covers
hidden completed finals, intermediate tool/assistant roles, exact ID/order
matching, missing/extra IDs and tampered HTTP archives. New artifacts stay
private and are not automatically committed.
