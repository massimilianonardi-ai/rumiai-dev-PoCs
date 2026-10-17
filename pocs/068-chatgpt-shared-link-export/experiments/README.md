# Two real-page observation trials (experimental)

This is a bounded experiment inside PoC 068, not a released product or an implemented site-specific exporter. It reuses the **current PWC web-control level-3 commands** without modifying the provider. This revision explicitly supersedes the first physical trial that reported 22 Amazon scroll actions and 20 ChatGPT actions but did not provide a usable viewer or a monotone replay.

The two explicit targets are:

- Amazon Wishlist: https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3
- ChatGPT shared conversation: https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835

## Normal path on the actual interactive VM

The easiest normal path starts an **isolated PWC v0.1.6** for this trial and leaves the installed/default web-control provider untouched. It uses the current pinned PWC Git commit verified during preflight, installs the pinned Playwright dependency into a disposable project-side runtime, and cleans the isolated browser profile/service after the trial. It requires network access for the git/npm setup and a working system Chromium, Node and POSIX shell.

From the PoC directory, after updating the checkout:

~~~sh
git pull --ff-only
node --check experiments/two-site-observation.mjs
node --test tests/two-site-observation.test.mjs
sh experiments/run-two-sites.sh two-sites-03
~~~

The last command is **interactive** and runs both URLs in sequence, with no need to install or change an 'srv' default. The service startup is now explicitly gated: PWC must open Chromium and respond to `web-control status` before site observation begins. The launcher retries short status probes for a bounded period, detects a terminated service, and prints saved `pwc-service.log` diagnostics if startup fails. A `connect ENOENT` from a single initial status probe is no longer treated as an immediate fatal result. The output destination must not exist yet. It prints the normal readiness prompt when it is time to interact with Chromium. If the pinned PWC remote HEAD no longer matches the verified provider revision, it fails explicitly rather than silently switching the tested backend.

If a compatible visible PWC service is already running and 'web-control' resolves to its client, the direct experimental command also works:

~~~sh
node experiments/two-site-observation.mjs ./experiments/evidence/two-sites-03
~~~

'WEB_CONTROL_CMD' may instead point to the executable client of an already-running isolated PWC service. A headless controller is rejected. Do not change the installed provider default merely for this experiment.

The **explicit destination is required** and must be a new direct child of **this PoC's** `experiments/evidence/`. The runner rejects all other paths rather than allowing HOME, `/run/user` or external directories. The one-command launcher resolves the evidence directory relative to its own PoC checkout, not the calling terminal's current working directory. Only the short-lived Unix-domain IPC socket remains under `/tmp` because its pathname cannot exceed the platform's socket limit; it is not an output artifact. The trial creates one folder per site without reusing old evidence. 'experiments/evidence/' is gitignored because real MHTML/DOM snapshots may contain account-specific data, cookies reflected in markup or other private material. Never commit them to a public GitHub repository before deliberate review/redaction.

For each site the script:

1. Opens a real PWC page and navigates to the specified URL. It records native baseline HTML, MHTML, screenshot, CDP DOMSnapshot and content fingerprints.
2. Opens a persistent CDP session, installs an event observer, and prints a prompt to the terminal. The **user manually** scrolls, expands and interacts with the website in the visible browser. Return to the terminal and press **Enter** once finished.
3. Records trusted clicks (targets/selector, not field contents), sampled scroll container evidence, keyboard activation evidence and the fact of form changes **without any input values**. A detected login redirect stops the site trial. Password entry, purchases, deletions and form submission are not automatically replayed. Recording is intentionally incomplete for unsupported gestures and cross-origin frames; these must not be silently claimed as learned.
4. Captures final manual-page evidence, then creates a fresh page and navigates from the beginning.
5. Uses the demonstrated scroll evidence **only to choose the scroll container**, then scans monotonically forwards by approximately 85% of its viewport as in the working `amazon-wishlist-extract` probe, with 1.5-second loading intervals and three stable bottom observations. It does not replay manual up/down jitter. While traversing the page, it replays **only** visible native `summary` controls or buttons with `aria-expanded` after rechecking their semantics. Other actions are reported as skipped/unreplayable, without scrolling backward to find them. No login bypass or anti-bot workaround.
6. After every **executed** replay action, stores separate native 'page.mhtml', 'page.html', 'page.png' and CDP 'dom-snapshot.json' plus evidence/checksums. Skipped/unsafe actions are explicitly retained in 'replay-steps.json' **without** creating duplicate snapshots. Captures are sequential, not atomic; before/after DOM fingerprints flag possible changes during the acquisition window.
7. Produces 'review.html': a generic, navigable **collage of captured screenshots** with references to MHTML and DOM/CSS evidence. It does **not** claim to reconstruct a single functional website. 'site-analysis.json' contains CDP element/layout counts per state and changes, usable as research input for a future site-specific exporter, **not** a completed exporter.
8. Writes site-level 'report.json', original 'demonstration.json', 'replay-steps.json' and top-level 'summary.json'. Every report explicitly leaves full visual fidelity and content completeness unverified.

Distinct manual scroll positions remain in the private `demonstration.json` as **observation evidence**. The automatic replay follows a forward-only viewport scan, capturing each reached step so virtualized content is not silently omitted. The monotone scan is an experimental adaptation of `amazon-wishlist-extract/src/probe.mjs`; it is not yet proven for every scroll container or site.

The script does not automatically publish any captured page. The user must review the outputs locally, including 'review.html', rendered MHTML, screenshots and the reported skipped actions.


### Startup failures on the physical VM

The first corrected-run attempt in `experiments/evidence/two-sites-02` failed **before opening either website** with `web-control: connect ENOENT /tmp/rumiai-page-trial-231337694.sock`. The service creates its socket only **after** Playwright launches the browser; the previous launcher ran the client immediately and therefore could race startup. The same symptom may also mean Chromium aborted: inspect the saved `two-sites-02/pwc-service.log` to distinguish them. Do not claim a browser failure or a fixed physical run without that evidence. The new readiness gate gives specific `trial.pwc-service-exited-before-ready` or `trial.pwc-startup-timeout` diagnostics and prints the last service-log lines, instead of just propagating `ENOENT`. Chromium's temporary Unix sockets can also exceed Linux's pathname limit when `TMPDIR` is the deep PoC checkout path. The launcher therefore uses a **short-lived symlink under `/tmp` pointing into the PoC's disposable runtime** for its TMPDIR/XDG paths and Chromium profile. Files written through that alias physically reside inside the PoC; only the temporary alias and the IPC socket name are outside and are removed during cleanup. The startup gate remains necessary because the original console output cannot establish whether the error was a race or a Chromium launch failure.

Use a **fresh run name** such as `two-sites-03`; the previous evidence remains unchanged under this PoC. The new launcher also saves `pwc-status.json` only after the service is reachable and prints `[PWC_READY]` before invoking the interactive browser trial. If this marker never appears, the failure is provider startup, not the page observer or replay.

### Viewing without ephemeral desktop file portals

Never browse a copied 'file:///run/user/...' location created by a desktop document portal; it is not the source evidence folder. All generated review links are relative to the PoC. Start the **read-only localhost viewer** from the PoC after the trial:

~~~sh
node experiments/serve-evidence.mjs ./experiments/evidence/two-sites-03
~~~

It prints direct URLs such as 'http://127.0.0.1:<port>/<random-token>/amazon-wishlist/review.html' and the equivalent ChatGPT link. Use those URLs in Chromium. The viewer binds only to 127.0.0.1 and writes no files outside the PoC. MHTML may still download rather than render in some browser configurations; open it from the PoC capture directory for offline verification. The temporary Chromium display session can still internally use an existing desktop 'XDG_RUNTIME_DIR' under /run/user; this is a compositor IPC requirement, **not an exported document location**.

All browser-controlled temporary download/cache directories (TMPDIR and XDG cache/data/config) are now relocated inside the PoC's disposable runtime. The actual evidence is never deleted during launcher cleanup. The report prints the exact absolute '[OUTPUT]', '[FILES]' and '[VIEW]' paths in the PoC.

## Known engineering boundaries

- PWC's existing MHTML capture uses Chromium 'Page.captureSnapshot'; HTML uses the current rendered DOM, and screenshot captures the current page. This **does not guarantee complete offline fidelity**, especially with canvas, virtualized items, remote iframes, stale dynamic resources or unmounted nodes.
- DOMSnapshot captures tree/layout plus a chosen bounded subset of computed CSS. It is not a dump of all CSS rules; state correspondence is best-effort. Fingerprint stability only checks coarse content geometry and does not prove the page is fully loaded.
- Persistent debugger events have a finite buffer. 'observation.overflow' is detected and blocks the transport-complete status. Rapid/unobserved actions, frame crossing and selectors that change across loads may result in incomplete replay.
- Some scroll or expansion events may not reproduce on Amazon or ChatGPT. The purpose of these two physical trials is to measure those failures, not conceal them.
- Amazon might require a login or show a bot/challenge wall. This script does not work around such restrictions or sign in; record a blocked trial rather than declaring success.
- The second browser page uses the **same managed browser context/profile** and a fresh navigation, not a freshly authenticated identity or a clean isolated cookie jar. This distinction matters when interpreting replay success.
- No actual VM/browser validation occurs merely by committing this experiment. Static parser/unit checks are not equivalent to physical observation. The generic collage and structural analysis are preliminary downstream artifacts.

## Acceptance review

For each target, inspect whether the manually exposed content is present in replay snapshots and whether reopening each MHTML reproduces the intended visible state. Compare the rendered screenshot with the archived state and identify missing/duplicated elements. For ChatGPT, explicitly check every user prompt, an example graphical chart and actually visible thinking summaries; for Amazon, check list item count, images, pagination/lazy loading and differing scroll containers. Treat skipped actions, unstable capture windows, missing MHTML/DOM evidence and visual differences as **gaps**, not accepted extraction. Use the raw observed states to decide whether a site-specific exporter needs additional logic.
