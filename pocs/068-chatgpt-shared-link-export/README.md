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

Use a **new output directory**. The assembler verifies snapshot SHA-256,
orders original `conversation-turn-N` indices (not capture order), keeps all
snapshot-version provenance and uses the latest recorded version per turn.
It emits `index.html`, `audit.json` and `resource-references.json`.

The HTML is deliberately inert: its CSP blocks scripts, external images and
network requests. It preserves original DOM markup, but does not reproduce
original stylesheets, image bytes, React state or event listeners. The audit
does not claim conversation completeness without RAW comparison. The input
archive and output files can contain conversation contents and signed resource
links: **keep them private and do not commit them**.

## Security boundaries

The URL must be an HTTPS \`chatgpt.com/share/\` conversation link, not a scheduled-task share. The exporter neither extracts cookies nor bypasses sign-in challenges. Browser profile state remains with web-control. Archive output is private data: do not commit it to public GitHub or share it without review. HTML snapshots and any image URL containing signed query parameters can reveal information, so avoid diagnostic logging of asset URLs.

## RumiAI context

Current governing sources: \`rumiai-dev/RULES.md\`, \`CONSISTENCY-GATE.md\`, \`specifications/rumiai-os/WEB-CONTROL.md\`. Active task state: \`rumiai-dev/handoff/chatgpt-shared-link-export.md\`.

## Offline cumulative DOM experiment

After collecting real original-renderer turn snapshots using `render-probe.mjs`, the separate Node.js 22 experimental assembler builds one inert offline page, without navigating the target website:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-dom-01
```

The output folder must not already exist and must be outside the capture folder. It contains `index.html`, `audit.json` and `resource-references.json`. Ordinals are taken from the original `conversation-turn-N` DOM attributes; multiple snapshots for one turn are retained in the audit and the most recently recorded version is rendered once.

Optional original-message-ID comparison:

```sh
node assemble-rendered-dom.mjs ./render-probe-run-01 ./cumulative-with-raw \
  --raw /private/path/conversation.raw.json.gz
```

The offline document deliberately does **not** execute scripts or fetch external resources; it is not a full ChatGPT clone, its CSS is minimal, and its resource-references file does not include downloaded assets. All outputs may contain private conversation text or URLs: never commit unreviewed captures or reconstructed pages. Details and the tested capture analysis are in `RENDERING-INVESTIGATION.md`.
