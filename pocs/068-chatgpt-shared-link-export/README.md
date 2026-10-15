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
