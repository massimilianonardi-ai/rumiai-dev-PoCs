# Two real-page observation trials (experimental)

This is a bounded experiment inside PoC 068, not a released product or an implemented site-specific exporter. It reuses the **current PWC web-control level-3 commands** without modifying the provider.

The two explicit targets are:

- Amazon Wishlist: https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?ref_=list_d_wl_lfu_nav_3
- ChatGPT shared conversation: https://chatgpt.com/share/6ad1c0f5-7110-83eb-bc19-356d48fc1259

## Normal path on the actual interactive VM

Run a working PWC provider in visible-browser mode first. The client must be invokable as 'web-control', or selected via 'WEB_CONTROL_CMD' pointing to a **single actual executable path** for the PWC client. A headless controller is rejected. Do not change the installed provider default merely for this experiment.

In the PoC directory:

~~~sh
git pull --ff-only
node --check experiments/two-site-observation.mjs
node --test tests/two-site-observation.test.mjs
node experiments/two-site-observation.mjs ./experiments/evidence/two-sites-01
~~~

The **explicit destination is required** and must be new; do not use a HOME-based output path. The trial creates one folder per site without reusing old evidence. 'experiments/evidence/' is gitignored because real MHTML/DOM snapshots may contain account-specific data, cookies reflected in markup or other private material. Never commit them to a public GitHub repository before deliberate review/redaction.

For each site the script:

1. Opens a real PWC page and navigates to the specified URL. It records native baseline HTML, MHTML, screenshot, CDP DOMSnapshot and content fingerprints.
2. Opens a persistent CDP session, installs an event observer, and prints a prompt to the terminal. The **user manually** scrolls, expands and interacts with the website in the visible browser. Return to the terminal and press **Enter** once finished.
3. Records trusted clicks (targets/selector, not field contents), sampled scroll positions, keyboard activation evidence and the fact of form changes **without any input values**. A detected login redirect stops the site trial. Password entry, purchases, deletions and form submission are not automatically replayed. Recording is intentionally incomplete for unsupported gestures and cross-origin frames; these must not be silently claimed as learned.
4. Captures final manual-page evidence, then creates a fresh page and navigates from the beginning.
5. Replays scroll positions and **only** native 'summary' elements and buttons already declaring 'aria-expanded', using the existing PWC click command for trusted browser input. Other actions are reported as skipped/unreplayable. An element's semantics are checked again in the live replay before a click. No login bypass or anti-bot workaround.
6. After every **executed** replay action, stores separate native 'page.mhtml', 'page.html', 'page.png' and CDP 'dom-snapshot.json' plus evidence/checksums. Skipped/unsafe actions are explicitly retained in 'replay-steps.json' **without** creating duplicate snapshots. Captures are sequential, not atomic; before/after DOM fingerprints flag possible changes during the acquisition window.
7. Produces 'review.html': a generic, navigable **collage of captured screenshots** with references to MHTML and DOM/CSS evidence. It does **not** claim to reconstruct a single functional website. 'site-analysis.json' contains CDP element/layout counts per state and changes, usable as research input for a future site-specific exporter, **not** a completed exporter.
8. Writes site-level 'report.json', original 'demonstration.json', 'replay-steps.json' and top-level 'summary.json'. Every report explicitly leaves full visual fidelity and content completeness unverified.

Distinct sampled scroll positions are preserved, including intermediate positions needed by virtualized lists. Identical consecutive positions may be deduplicated; scroll capture is still a sampled observation rather than a complete physical gesture recording.

The script does not automatically publish any captured page. The user must review the outputs locally, including 'review.html', rendered MHTML, screenshots and the reported skipped actions.

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
