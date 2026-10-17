# chatgpt-extract — PoC 068

Status: experimental command, not an installed RumiAI m/pkg release.

## Goal

Extract one public ChatGPT share through the current web-control 3 provider and publish a **single directory per chat** that is useful on GitHub, as an offline HTML document, and as a printable PDF.

From the PoC directory, after npm install:

~~~sh
node chatgpt-extract.mjs "https://chatgpt.com/share/SHARE-ID" "./published-reference-chats"
~~~

The package exposes the executable name chatgpt-extract; npm link in this PoC directory makes the locally developed command available as:

~~~sh
chatgpt-extract "https://chatgpt.com/share/SHARE-ID" "./published-reference-chats"
~~~

The second operand is mandatory: the command does **not** select a directory below the user's home. Use an explicit directory in the project or an intended publication workspace. WEB_CONTROL_CMD can select the existing isolated PWC client; the CLI otherwise uses the ordinary web-control facility. A running compatible provider is required for acquisition. WEB_CONTROL_BROWSER_EXECUTABLE selects Chromium for offline PDF production; otherwise the program looks for chromium in PATH. The renderer uses a separate temporary **local, headless print profile**, not the acquisition browser or a remote ChatGPT session. It is removed when the printing operation ends.

## Published output

Every successful execution produces a new, never-reused chat directory and one adjacent ZIP:

~~~text
published-reference-chats/
  2026-10-15 RumiAI Avatar/
    README.md
    conversation.html
    conversation.pdf
    media/
    files/
    data/
      TRANSCRIPT.md
      VISIBLE_MESSAGES.jsonl
      TURN_SURFACES.jsonl
      NON_TEXT_PARTS.json
      AUDIT.json
      ACQUISITION.json
      MEDIA.json
      FILES.json
      conversation.raw.json.gz
      EXPORT-README.md
      SHA256SUMS
  2026-10-15 RumiAI Avatar.zip
~~~

The Markdown landing page contains readable visible-turn text, inline relative image references and relative attachments. GitHub renders that README.md when opening the chat directory. The HTML is standalone for offline viewing with inline CSS and relative images; the PDF is printed from that HTML with Chromium and includes visible images as PDF page content. Other binary attachments remain alongside the document and are linked by relative path, rather than falsely claimed as embedded in PDF. The source snapshot and technical manifests remain under data/, with a checksum list for all published files. The adjacent ZIP includes the same directory contents.

The Markdown source is the existing structured TRANSCRIPT.md from the validated active-branch exporter, **not** DOM scrolling or a synthetic transcript. No signed CDN asset URL is intentionally emitted into Markdown, HTML or the PDF. Raw source metadata is preserved as forensic evidence.

The command fails rather than reporting success if PDF printing fails or a downloaded file referenced in a manifest is absent. Existing old export-share.mjs and reference-acceptance.mjs continue to write their original forensic output for backward compatibility.

## Five reference chats

From the PoC directory:

~~~sh
node reference-publication.mjs "./published-reference-chats"
~~~

This re-extracts the five authorized public reference shares, creates readable documents for each, and writes reference-publication-*.json to the explicitly selected destination. It requires the real PWC controller to be reachable on that host. Running it in ChatGPT's auxiliary environment does not substitute for the physical VM. A successful run alone **does not mean visual fidelity is verified**: open each Markdown on GitHub, each offline HTML and each PDF, compare roles/order/text/code/tables and images to the corresponding original shares, and inspect placeholders and relative links.

### Important limits

* Publicly unavailable **user-uploaded** binaries are preserved as non-downloaded/deferred metadata and noted in the readable archive; an authenticated second phase is separate.
* Interactive charts/canvases and other app-only non-text content may be represented by source or a conspicuous placeholder rather than a visual equivalent. Do not silently treat such cases as complete.
* A PDF from Markdown/HTML is a printable representation, not an assertion of byte-for-byte or pixel-for-pixel identity with the ChatGPT web app.
* Opening HTML offline should require no network for downloaded media; external hyperlinks are still hyperlinks and may require network if clicked.
* Do not commit other users' chats, private attachments or signed URLs by default. This project's user authorization to commit evidence is scoped to the selected five reference shares.
* Avoid publishing the technical data/ folder to a *public* repository unless it has been reviewed for conversation content and metadata. GitHub is not inherently private.

The authoritative subsystem architecture stays in rumiai-dev; this is an experimental PoC entrypoint, not a product release or a new web-control provider.
