# PoC 068 — Structured ChatGPT shared-link export with web-control

Status: Experimental. The five-share anonymous-public artifact acceptance runner physically passed 5/5 on 2026-10-17 through an isolated PWC v0.1.6 controller. It observed 3/3 Avatar images, 3/3 public Mirror images and 16/16 Mirror sandbox files. ChatGPT-faithful HTML and full-fidelity completeness remain unaccepted; user-uploaded binaries remain deferred to authenticated Phase 2.

## Objective

Archive user-authorized ChatGPT shared conversations using the real structured shared-page snapshot, preserving raw message objects and their artifact identities without deriving transcript completeness from a virtualized DOM.

This is a **site-specific deterministic adapter**, not a web-control provider, web-sense agent, ChatGPT account export, or official ChatGPT API integration.

## Active Node.js exporter (web-control compatibility level 3)

The supported PoC entrypoint is `export-share.mjs`. It uses the common `web-control debug session` transport provided by `pwc-web-control` and `electron-web-control` v0.1.6 (facility compatibility level 3). It neither opens a raw CDP TCP port nor launches a second browser.

From this PoC directory:

```sh
node export-share.mjs "https://chatgpt.com/share/<id>" "./archive"
```

The command checks/starts the normal `web-control` service, creates a page, **commits an initial local `data:` document through the portable `web-control page navigate` command**, then attaches the persistent debugger session. It subsequently executes a page-context same-origin JSON request to `/backend-anon/share/<id>` with `/backend-api/share/<id>` as fallback. After the initial local navigation has completed, and before navigating to the validated ChatGPT share URL, the site adapter checks the page's browser User-Agent: if the Electron product token is present, it removes **only** `Electron/<version>` via the page-scoped `Emulation.setUserAgentOverride` CDP method. This preserves the actual Chromium identity and version for the share's renderer; standard Chromium pages need no adjustment. The provider's default identity and other browsing sessions are unchanged. The exporter independently attempts to close the created page and debugger session even when one close operation fails or stalls. Its `cleanup` report distinguishes acknowledged commands from a verified disappearance of the page, retries a page close once when the page remains listed, and has bounded cleanup requests. The exporter does not close unrelated browser pages. The command reports `electronUserAgentNormalized` in its diagnostics. It accepts only a structurally valid `mapping/current_node` snapshot. The active path does **not** use Network or Debugger event-domain streaming, script hook discovery, breakpoints, or a separate browser. It uses only targeted `Runtime.evaluate` DOM inspection and bounded viewport positioning for generated-image lazy loading; structured conversation completeness never relies on scrolling.

The exporter preserves the active branch, structured message objects (including non-text parts), raw compressed JSON, JSONL, Markdown, audit evidence, checksums and a Node-created ZIP. Every successful export creates an immutable directory and ZIP rather than overwriting a previous run. Assistant-generated `sandbox:/mnt/data/` files are recovered using the physically observed public `file_from_message` route, indexed in `FILES.json`, and linked locally when downloaded.

For generated images, the anonymous page is allowed to finish document loading before the structured snapshot is read. The anonymous export holds **one** generated-image surface stationary after bringing it into view and waits for its image to finish loading (or to time out) before moving to the next. Each surface has an individual bounded wait; the original rapid viewport cycling was also unsuitable for reliable lazy-load observation, but standalone Electron experiments did not predict the managed provider outcome: installed Electron still failed to materialize images whereas an isolated PWC Chromium controller recovered 3/3. Acquisition matches completed images to structured `image_asset_pointer` identities by raw URL file ID and dimensions, not by presentation order. The exported byte stream is fetched from the observed signed `oaiusercontent.com` image URL, with type, signature and expected byte-size validation; decorative `<img>` layers sharing a file ID are deduplicated. Signed query parameters are transport-only and are not persisted. The `generatedImageDom.browser` diagnostic now records only non-sensitive document readiness, whether the browser still advertises an Electron UA token, whether the page has the expected share origin, and the count of image-CDN resource entries. Failed binary retrieval attempts preserve only safe status/error categories, never the signed source URL. An app-wide network-idle condition is **not** used as a completion test: persistent/background requests and offscreen lazy assets make that condition unreliable. Timeouts and missing binaries remain explicit. `generatedImageDom` reports expected/identified/downloaded counts, available surfaces, activated surfaces, and individual per-surface loaded/timeout statuses without disclosing signed URLs. On 2026-10-16 the user observed a three-image failure in Electron with its original User-Agent, then **3 fully loaded generated-image surfaces and 3 public CDN HTTP 200 responses** in the same standalone Electron binary when only `Electron/44.7.0` was removed from the User-Agent. A subsequent standalone Electron experiment also verified the **CDP** path: after first committing a local `data:` document, attaching the debugger, applying `Emulation.setUserAgentOverride`, and navigating to the public share, three distinct generated-image CDN downloads returned HTTP 200 and all nine `<img>` DOM layers loaded. A prior PoC revision applied CDP's override without an explicit document-bootstrap step and failed to materialize any `<img>`. The current PoC reproduces the physically successful initialization order with portable `web-control`, and the 3/3 generated-image archive download has now been physically observed under the isolated real PWC controller, not the installed Electron provider.

**Anonymous phase:** export all structured shared conversation content and publicly accessible artifact binaries without requiring a signed-in session. A real unsigned-session check established that user-uploaded attachments cannot be viewed/downloaded from the public share. Preserve their raw metadata and identify their unavailable binaries; defer authenticated retrieval to a separate second phase after the anonymous export is final. The current image acquisition does not probe user-only uploads for binary content; `MEDIA.json` marks them `deferred-authenticated` with `availability_class: user-upload`, while anonymous-public images whose binaries remain unavailable are `missing` with `availability_class: public-image`. `ACQUISITION.json` and command output report both counts separately. These categories describe the current work phases and do not claim full-fidelity completion. **Known incompleteness:** all five anonymous artifact checks passed in the user-run PWC acceptance log, but ChatGPT-faithful HTML/presentation and full site-completeness are still unverified; `observationComplete` remains false. The committed log records the test program's successful local artifact checks, not an independent remote reread of its ZIPs/manifests. One Mirror user-upload image remains `deferred-authenticated`; a structural snapshot or artifact gate does not prove full-fidelity completeness.

## Release-oriented publication path (not yet physically accepted)

The **new** PoC command 'chatgpt-extract' orchestrates the already validated
structured public-share acquisition plus a separate, auditable publication step.
This does not change the web-control provider/facility or the existing
'export-share.mjs' forensic output and acceptance runner.

From this PoC directory (after 'npm install'):

~~~sh
node chatgpt-extract.mjs "https://chatgpt.com/share/<id>" "./published-reference-chats"
~~~

Optionally use 'npm link' here to install the development command name
'chatgpt-extract <link> <dir>' into the invoking Node.js environment.
The destination must be an explicit project/workspace directory; this path
does not default to a user home. The existing web-control 3 controller must
already be running. Chromium must be available for the **offline PDF print
stage**, using WEB_CONTROL_BROWSER_EXECUTABLE or the 'chromium' executable.
The print stage runs a separate temporary local headless profile without
navigating to ChatGPT or changing the extraction browser.

Each newly exported conversation has a GitHub-readable 'README.md', an
offline 'conversation.html', a printable 'conversation.pdf' plus 'media/',
'files/' and technical 'data/'. The companion ZIP includes the three readable
documents, downloaded binaries and technical source evidence. The readable
Markdown and HTML use only relative links for downloaded media/files; the
PDF prints inline image content but does not embed arbitrary binary attachments.
User-only uploads remain visibly deferred. The render pipeline uses the
existing structured 'TRANSCRIPT.md', not the DOM-window extraction that
previously failed.

To re-extract the five selected reference chats with this publication layout
in one physical PWC session:

~~~sh
node reference-publication.mjs "./published-reference-chats"
~~~

The command writes a five-share report alongside five immutable conversation
directories/ZIPs and does not delete earlier captures. **The previously
verified 5/5 test was for the artifact gate of the original forensic exporter,
not for these new Markdown/HTML/PDF outputs.** These outputs still require a
real PWC+Chromium test on the user's VM and visual inspection for completeness.
The new command has unit fixtures but no claimed physical publication PASS.
See 'docs/chatgpt-extract.md' for the exact contract and limitations.

## Chronological publication correction

The user's physical review of the first published reference archives found a real
presentation defect: downloaded images and files were appended to a final
inventory rather than placed at the events that produced or displayed them.
The latest PoC publication now builds the human-facing transcript from
source **active-branch ordinals**, visible message objects, activity classifications
and artifact reference ordinals. Generated-image tool results are interleaved
with the user/assistant dialogue where they occur; files already linked in a
visible message are kept at that message, not duplicated elsewhere. No appendix
is used as a substitute for unknown placement. If an artifact's original position
cannot be verified, it is reported as unplaced and the command does not mark
chronological acceptance as successful.

The offline HTML keeps intermediate thinking/activity groups collapsed in
native HTML details/summary elements in sequence, using **only** public
commentary actually present in the share. Absent or private hidden reasoning is
not reconstructed or exported as plaintext; the disclosure says when content
is unavailable. The PDF opens those disclosures for printing and keeps inline
downloaded images. This corrects chronology, but does not yet establish a
pixel-exact replay of all ChatGPT UI components.

The real 2026-10-17 first publication run committed to
'published-reference-chats/' reached **4/5**: Mirror failed with
'share.snapshot-not-observed', whereas Avatar and the other three published.
These are immutable older samples and still exhibit the original defect;
source code commits do not retroactively alter them. To rebuild the four
already captured chats **without calling PWC**, run:

~~~sh
node rebuild-publication.mjs "./published-reference-chats" "./chronological-reference-chats"
~~~

The second path must be an explicit sibling project/workspace directory, not
a home-directory default. Inspect the newly created Markdown/HTML/PDF files
and commit the new reference captures deliberately after review. Mirror requires
its separate real-browser reattempt when the public snapshot can be acquired.

## Five-share anonymous PWC acceptance

The reference-specific regression runner tests all five user-authorized shared links sequentially through the *existing* isolated PWC client. It invokes the actual `export-share.mjs` command, checks structured counts, stored file/media SHA-256 hashes, archive/ZIP integrity, image/sandbox completeness, and verified page disappearance. Each run creates immutable archives and a separate timestamped `reference-acceptance-*.json` report. User-upload binaries classified `deferred-authenticated` do not count as missing public images.

```sh
WEB_CONTROL_CMD=/path/to/isolated/pwc-web-control/bin/web-control \
  node reference-acceptance.mjs "./archive" 30
```

The PWC service/client and browser must already be operational and able to access the public shares. The script does not install software, alter provider/facility selection, log in, or touch the user's configured Electron profile. A report with `passed:5` means the selected **anonymous artifact gate** passed; it does not certify HTML fidelity, original ChatGPT presentation, or full-fidelity `observationComplete`. On 2026-10-17 the real isolated PWC run reported `passed:5`, `total:5` on all selected links, with SHA-256/archive checks, zero unresolved public media and sandbox files, and verified disappearance of all created pages. Explicit debugger-session close was not acknowledged for the Mirror case, although its page was verified absent. The committed evidence is `rumiai-chatgpt-5-links-20261017T063546Z-1389990/acceptance.log` and accompanying status/service logs. The five per-share ZIPs and separate acceptance JSON report are not present in that commit, so external inspection of exported HTML and ZIP contents is still pending. Keep test artifacts under an explicit project/workspace destination, not a user-home output directory. Full-fidelity release acceptance remains false.

## Public-share reference interaction diagnostic

The independent diagnostic captures renderer and click evidence without changing the exporter. If navigation settles on a login or any other page instead of the requested share, it emits `reference.share-page-not-loaded`, saves `failure.json` in its allocated directory and exits non-zero rather than reporting a successful capture:

```sh
node capture-share-reference.mjs "https://chatgpt.com/share/<id>" "./reference-captures" --seconds 8
```

It records independent page/DOM/CDP probes. In the anonymous phase it clicks at most three generated-image surfaces (first, middle, last when more exist), and one representative for each assistant sandbox artifact type. Every selected generated-image interaction records pre/post renderer state, including the number of loaded image elements, image/video/canvas elements, CSS backgrounds and overlay actions. The inventory still records user-upload image/file labels by owning message and label occurrence, but **does not click them in the anonymous phase**. A text label such as "Ha caricato un file" does not imply an anonymous download endpoint. Captured requests and rendered placeholders are diagnostic evidence, not proof that generated image bytes are retrievable.

These diagnostic directories may include public conversation content and temporary signed resource URLs. Do not commit them except under explicit, narrowly scoped authorization. The five selected reference captures already committed for this task are a deliberate exception. The user-upload probes are retained for the later authenticated phase; no further user-upload transport investigation is required to finalize the anonymous phase. Any eventual transport claim must be based on physical evidence, not hosted fixtures alone.

The original, user-provided macOS Python exporter remains unchanged at `reference/chatgpt-export-v3.py`. The older standalone-browser Python adapter and DOM-window exporter below are historical experiments, **not** accepted export paths.

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
