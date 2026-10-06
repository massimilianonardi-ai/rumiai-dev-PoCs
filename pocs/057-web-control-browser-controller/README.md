# PoC 057 — web-control browser controller

## Question

Can the deterministic `web-control` layer be implemented behind a stable local controller boundary while keeping Playwright/Chromium as replaceable implementation details?

This PoC supports `rumiai-dev/handoff/web-access-sense.md`.

## Scope

The experiment intentionally excludes AI reasoning, Amazon-specific behavior, ChatGPT integration, scheduling and product/runtime packaging. It validates only the deterministic browser-control substrate proposed for `web-control`.

The controller:

- owns one Playwright persistent Chromium context backed by a dedicated profile directory;
- exposes opaque page identities rather than Playwright objects;
- communicates over a local Unix-domain socket using newline-delimited JSON requests/responses;
- supports page creation/list/close and navigation;
- supports deterministic CSS-selector `click`, `fill` and `press` primitives;
- exposes rendered HTML, readable text and storage inspection;
- captures HTML, text, full-page PNG and MHTML plus metadata;
- exposes an explicitly low-level `debug.cdp` operation that opens a temporary page-scoped CDP session for one command;
- never requires a public Chrome remote-debugging port.

The default controller mode is **non-headless**. `HEADLESS=1` exists only so the same semantics can be exercised automatically in CI or other non-graphical environments.

## Experimental protocol

`tests/run.mjs` starts a local HTTP fixture and exercises the controller in two separate runs using the same browser profile.

The fixture verifies:

1. JavaScript/fetch changes are visible after rendering;
2. deterministic fill/click operations work;
3. a popup is registered as a separate opaque page identity;
4. HTML/text/PNG/MHTML captures are non-empty and contain post-rendering state;
5. a raw `Runtime.evaluate` CDP command can be issued through the controlled debug surface;
6. cookie and localStorage state survive controller/browser restart when the same dedicated profile is reused.

All normal automated checks use only localhost resources and therefore do not depend on external network access after Playwright/Chromium installation.

## Run

```sh
npm install
npx playwright install chromium
npm test
```

To watch the browser manually, run the controller without `HEADLESS=1` and send JSON requests through the configured Unix socket. The PoC deliberately does not promote a final CLI syntax.

## Interpretation boundary

A successful PoC demonstrates that the proposed controller/session/page/capture/debug mechanics are viable. It does **not** make the current JSON method names, socket protocol, Playwright provider, CSS selector surface, capture formats or process model a RumiAI contract. Those remain experimental until promoted through the normal `rumiai-dev` specification process.
