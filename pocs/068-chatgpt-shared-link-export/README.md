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

The exporter starts the configured service through `srv start web-control` when the ordinary `web-control status` call fails. No provider-specific commands or CDP debugger operations are used.

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

Image assets are downloaded **only if** their source is an HTTPS URL from an explicitly accepted OpenAI-owned image host, their response is an image, and fetching succeeds without redirects. Unavailable images remain as remote Markdown links and are listed in `conversation.json` with status/reason. Observed ordinary file hyperlinks are retained but their referenced file bytes are **not** downloaded.

The exporter scans downward and then **back upward**, capturing each distinct rendered message window before the client removes it from the DOM. Neighboring windows are reconciled using message IDs and visible turn indices when present, or overlapping role/content otherwise. A page that opens at its last turn may therefore yield more messages than any individual DOM snapshot. The last rendered HTML remains in `capture/page.html`; the intermediate windows are retained under `capture/segments/` for review.

The JSON contains role, observed turn index/message identity, order, rendered text, extracted Markdown, original message fragment HTML, image URLs and links. `observedSettledAtBottom`, `observedSettledAtTop`, `observedSegmentGaps` and `observationComplete` are **scan observations only**. Even when both edges are reached and no gap is detected, the `completeness` field explicitly states that completeness relative to the source conversation cannot be verified from a shared page alone. Rendered image URLs are retained from all observed windows, not just the last one. Embedded/non-HTTP image sources still require separate support.

The shared-page source may contain richer structured conversation data, but the PoC does not claim to have retrieved that undocumented payload or the internal desktop renderer snapshot. The attached reference exporter for the native ChatGPT application uses a CDP debugger breakpoint to capture a complete conversation snapshot in memory; that app-specific mechanism is distinct from the portable `web-control` share-link consumer.

On a failed extraction after navigation, captured HTML/text remain under `capture/`, and `failure.json` plus `error.txt` diagnose the failure. A failed attempt may reserve a version directory, and the next run never replaces it.

## Verification

```sh
npm test
npm run check
```

The current tests cover synthetic rendered-HTML extraction, virtualized-window merging (including repeated identical text and gaps), and the real exporter command with a simulated external web-control protocol boundary (including a page whose DOM exposes only a moving subset of the turns, versioned files and failure evidence). They do **not** establish successful navigation through a real web-control provider or fidelity against a real shared link. A user-reported physical-host run of the previous revision captured only the final 10 messages of a real virtualized share page, which motivated the current scan change. The new revision still requires physical-provider revalidation, image/download fidelity checks, large-conversation verification, source share updates and workspace-restricted links.

## Opt-in real-provider validation

A separate GitHub Actions workflow, `PoC 068 live shared-link validation`, accepts a share URL through **Run workflow**. It checks out the exact currently recorded `pwc-web-control` provider revision, runs the real public `web-control` command/service under Chrome/Xvfb, and exercises the actual exporter. Its normal output is a minimal summary: message count, available/unavailable images and observed scroll-settling status.

This is **not** automatically run on every push: only the person initiating the workflow deliberately supplies a link. GitHub may retain workflow inputs in run metadata, so do not use confidential shared links through this workflow. The workflow does not print or upload the conversation HTML, text, images or screenshots. Its temporary archive is destroyed with the runner. For private content or to retain the exported archive, use the local command above against your own web-control service.

The hosted run verifies the specific provider revision and public page reachable from that runner. It does not substitute for validation of the user's physical host, browser profile, network or authenticated session.

## Security boundaries

The URL must be an HTTPS `chatgpt.com/share/` conversation link, not a scheduled-task share. The exporter neither extracts cookies nor bypasses sign-in challenges. Browser profile state remains with web-control. Archive output is private data: do not commit it to public GitHub or share it without review. HTML snapshots and any image URL containing signed query parameters can reveal information, so avoid diagnostic logging of asset URLs.

## RumiAI context

Current governing sources: `rumiai-dev/RULES.md`, `CONSISTENCY-GATE.md`, `specifications/rumiai-os/WEB-CONTROL.md`. Active task state: `rumiai-dev/handoff/chatgpt-shared-link-export.md`.
