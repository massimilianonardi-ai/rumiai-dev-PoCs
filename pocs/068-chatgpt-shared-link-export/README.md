# PoC 068 — Structured ChatGPT shared-link export with web-control

Status: Experimental. The new Node.js web-control 3 path is hosted-fixture tested, not physically validated on a ChatGPT shared page.

## Objective

Study complete structured snapshot capture for a user-authorized ChatGPT shared URL by reusing the existing working persistent CDP exporter. The earlier provider-neutral DOM-based exporter is retained only as a failed physical-site experiment.

This is a **site-specific deterministic adapter**, not a web-control provider, web-sense agent, ChatGPT account export, or API integration.

## Node.js structured-snapshot exporter (web-control 3)

**Current recommended PoC entrypoint:** `export-share.mjs`, implemented entirely in Node.js. It uses the **common** `web-control debug session` API introduced in source compatibility level 3 and implemented by both Playwright/Chromium and Electron. Both provider releases `v0.1.6` now declare facility compatibility `web-control 3` through `pkg-catalog`. There is no external CDP debugger port and no separately launched browser. This path requires an installed `web-control 3` provider/service.

From this PoC directory:

```sh
node export-share.mjs "https://chatgpt.com/share/<id>" "./archive"
```

The program checks/starts the normal `web-control` service, opens a dedicated page and debugger session, enables the Chromium debugger domains, navigates the link, inspects actual JSON responses and embedded JSON, and only when available discovers the original semantic `mergeActiveBranch` marker in the loaded JavaScript. If a compatible hook is found, it installs a **persistent** breakpoint and reads the call-frame argument before resuming. It never synthesizes a ChatGPT internal endpoint or reconstructs a virtualized transcript by DOM scrolling.

The Node port preserves the original Python reference's `mapping/current_node` active-branch traversal, visible user/assistant candidate classification, full message objects including non-text parts, RAW gzip, JSONL, Markdown, audit, hashes and a ZIP archive. The ZIP is built with Node standard-library compression; no Python, extra ZIP binary or download-only Node dependency is required for this entrypoint. The original `reference/chatgpt-export-v3.py` remains unchanged for comparison.

A positive acquisition creates an immutable `YYYY-MM-DD title` output directory with the original forensic files plus `ACQUISITION.json`, and a ZIP beside it. This stage preserves **image/graphic object references but does not download image binary contents or reproduce the original rendered HTML**. Failure exits nonzero and writes numbered `share-debug-diagnostic-NNNN.json` evidence with phase, counts and JSON *field names only*, not chat values.

**Validation limitation:** the original Python reference was physically validated against the native macOS ChatGPT application. Neither that app's internal `mergeActiveBranch` hook nor a complete `mapping/current_node` data object has been observed on a real `chatgpt.com/share/` browser page. Hosted fixtures demonstrate the machinery, not real-site export completeness. If the shared site does not expose an equivalent snapshot, the Node adapter fails explicitly and the diagnostic directs further study of observed structured payloads. No second-browser/CDP-port workaround should be substituted for this new public `web-control` interface.

## Superseded separate-browser Python CDP experiment


**Historical comparison only. The active Node.js entrypoint above supersedes this standalone-browser Python adapter.** The legacy `node export.mjs` path remains in the repository as a comparison artifact, not as an accepted complete-chat exporter.

The original user-provided, proven macOS script is stored **unchanged** at `reference/chatgpt-export-v3.py`. The browser-share adapter `export-share-cdp.py` imports its existing `WebSocket`, `CDP`, call-frame evaluator, active-branch traversal, forensic export writer and multimodal object preservation. It changes **only** how the browser target is selected, how the shared URL is navigated, and how the *actual* browser renderer's structured snapshot is discovered. The native app's `app://-/index.html` breakpoint is **not** assumed to exist on `chatgpt.com/share/`.

This experimental adapter does **not** use `web-control` or the provider's short-lived `debug cdp` command. A breakpoint must stay attached during navigation. It uses a separately launched, explicitly opt-in Chromium debugging target, bound to **localhost only**, and never changes browser provider configuration. Keep this browser profile dedicated to the PoC; CDP grants powerful access to all tabs in that browser. Do not expose its debugger port to the network.

Start a dedicated Chrome/Chromium process on the physical test host in another terminal (choose the installed binary, `chromium` or `google-chrome`):

```sh
CDP_PROFILE=$(mktemp -d)
chromium --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir="$CDP_PROFILE" about:blank
```

Then from the PoC directory:

```sh
python3 export-share-cdp.py "https://chatgpt.com/share/<id>" "./archive" --port 9222
```

The new command creates a separate blank tab, attaches via the original persistent CDP WebSocket client, observes structured JSON actually delivered to the shared page, and if absent looks for the original semantic `mergeActiveBranch` marker **in the loaded HTTPS JavaScript**. It sets a breakpoint only if the marker is actually found and reloads the page without dropping the debugger session. It accepts the result only when it contains a valid `mapping/current_node` parent chain. No private endpoint, chat content, or internal API schema is invented.

**Success** produces the original forensic outputs inside a uniquely named folder: `conversation.raw.json.gz`, `TRANSCRIPT.md`, `VISIBLE_MESSAGES.jsonl`, `NON_TEXT_PARTS.json`, `AUDIT.json`, `SHA256SUMS`, `README.md` and a ZIP, plus `ACQUISITION.json` stating the acquisition method. The original raw message objects retain multimodal metadata and file pointers, but the command does **not** claim to download image files or create a visual ChatGPT HTML clone. Those are separate tasks *after* structured capture.

**Failure** (for example, no compatible hook or network snapshot in the real share page) exits nonzero, creates a numbered `share-cdp-diagnostic-NNNN.json` with counts/phase, observed JSON key-shapes (field names only, never message values), and a specific failure identity, and does not fabricate a complete transcript. The real browser-share hook is **not yet verified on the user's physical host**; tests cannot prove that the macOS app and shared website use the same renderer hook. If no hook is found, the next activity is to examine the observed shared-page payload shape, not to return to DOM scroll hacks.

The user-supplied macOS exporter itself still works according to the user's physical validation, and has not been modified. The existence of CDP here does not imply that a Chrome browser shares its application-specific `app://` JavaScript code.

## Earlier experimental DOM exporter (not physically accepted)

## Requirements

- Node.js 22 or newer.
- npm dependency installation in this directory.
- A configured web-control **compatibility level 2** provider (pwc-web-control or electron-web-control), with normal profile/service configuration.
- A public or otherwise accessible ChatGPT conversation sharing link; log in manually with the chosen browser profile if the workspace restricts access.

The exporter starts the configured service through `srv start web-control` when `web-control status` fails. The active implementation uses only the public `page navigate`, `page inspect`, `page press` and `page capture` commands: **no CDP, Playwright internals, private ChatGPT API, or hidden browser script evaluation**. Scrolling inside ChatGPT's nested pane through keyboard navigation is still subject to real-site acceptance testing.

## Run

```sh
cd pocs/068-chatgpt-shared-link-export
npm install
node export.mjs "https://chatgpt.com/share/<id>" "./archive"
```

For a direct development installation where the web-control client is not in PATH, set `WEB_CONTROL_CMD` to its public command executable path.

A successful call writes `0001/`, then `0002/` on the next call, and so on:

```text
archive/
  0001/
    conversation.md
    conversation.json
    conversation.html
    capture/
      page.html
      page.txt
      metadata.json
      segments/
        00001.html
        00002.html
        ...
    assets/
      image-0001.png
  0002/
    ...
```

Image files are handled for approved HTTPS OpenAI image hosts and bounded base64 inline `data:image/` sources. Inline image bytes are written locally without network access; remote downloads use four workers with a seven-second per-file timeout rather than a long sequential wait. The caller's Node TLS trust configuration (for example `NODE_EXTRA_CA_CERTS` on the corporate host) still applies. `blob:`/canvas-backed media cannot be downloaded from a serialized DOM using Node fetch alone. Unavailable assets remain marked in `conversation.json` and Markdown. Ordinary attachment links are retained without claiming to have downloaded the attachment bytes.

The page may open at its last loaded ChatGPT segment. The exporter reads the first DOM window once, sends **Home** to the first observed turn, polls for *new older turns*, prepends only those turns, then repeats. If no older prefix appears it tries **PageUp** once and stops after a bounded poll. It does **not** scan downwards, wait repeatedly for an unchanged scroll coordinate, or merge entire DOM windows. Each successful new prefix creates one evidence file under `capture/segments/`; the final raw DOM is under `capture/page.html`. This is deliberately a fast DOM-first heuristic rather than a guarantee that ChatGPT has loaded all earlier segments.

The DOM parser checks two possible identifiers: `data-message-id` and numbered `data-testid="conversation-turn-N"` containers. The output reports `identifiedMessages` and `numberedTurns` so real-site evidence can confirm which attributes actually exist; it does not assert their presence without checking the saved source HTML. When numbers exist only lower-index turns are prepended. Otherwise the prefix algorithm requires ID matches, contiguous overlap, or explicitly records an uncertain alignment. `observedBoundaryExtensions`, `observedSegmentCaptures`, and `observedNoEarlierPrefix` report what was observed. `observationComplete` remains **false**: a lack of newly rendered messages is not proof of source-chat completeness.

The original macOS exporter captures a full structured `mapping/current_node` snapshot by attaching to the native app. This is not the behavior of a shared-link DOM export. The earlier optional snapshot parser and provider-specific CDP scroller have been removed from the active PoC in response to physical-site feedback. No server-internal or app-internal API is guessed or accessed.

The styled `conversation.html` embeds its own CSS, preserves static SVG charts and HTML markup, and references downloaded image assets. Canvas pixels, `blob:` image data, and other browser-only visuals are marked as unavailable; Markdown includes references/limitations instead of pretending those charts are text. This is a readable reconstruction, not ChatGPT's original stylesheet. Raw DOM captures are separate and do not contain the CSS resources required to reproduce the full application.

On a failed extraction after navigation, captured HTML/text remain under `capture/`, and `failure.json` plus `error.txt` diagnose the failure. A failed attempt may reserve a version directory, and the next run never replaces it.

## Verification

```sh
npm test
npm run check
```

Tests cover DOM identity/numbering, prepend-only deduplication (including identical message text and disjoint windows), SVG preservation, styled HTML sanitization, and the public exporter command with a simulated external `web-control` protocol. These tests do not establish real-site completeness or whether Home/PageUp focuses ChatGPT's actual nested scrolling pane. Earlier physical tests were slow, duplicated content, missed images, and flattened charts; the changed revision requires physical revalidation.

## Opt-in real-provider validation

A separate GitHub Actions workflow, `PoC 068 live shared-link validation`, accepts a share URL through **Run workflow**. It checks out the exact currently recorded `pwc-web-control` provider revision, runs the real public `web-control` command/service under Chrome/Xvfb, and exercises the actual exporter. Its normal output is a minimal summary: message count, available/unavailable images and observed scroll-settling status.

This is **not** automatically run on every push: only the person initiating the workflow deliberately supplies a link. GitHub may retain workflow inputs in run metadata, so do not use confidential shared links through this workflow. The workflow does not print or upload the conversation HTML, text, images or screenshots. Its temporary archive is destroyed with the runner. For private content or to retain the exported archive, use the local command above against your own web-control service.

The hosted run verifies the specific provider revision and public page reachable from that runner. It does not substitute for validation of the user's physical host, browser profile, network or authenticated session.

## Security boundaries

The URL must be an HTTPS `chatgpt.com/share/` conversation link, not a scheduled-task share. The exporter neither extracts cookies nor bypasses sign-in challenges. Browser profile state remains with web-control. Archive output is private data: do not commit it to public GitHub or share it without review. HTML snapshots and any image URL containing signed query parameters can reveal information, so avoid diagnostic logging of asset URLs.

## RumiAI context

Current governing sources: `rumiai-dev/RULES.md`, `CONSISTENCY-GATE.md`, `specifications/rumiai-os/WEB-CONTROL.md`. Active task state: `rumiai-dev/handoff/chatgpt-shared-link-export.md`.
