# PoC 060 — Amazon wishlist enumeration through web-control

Purpose: validate complete deterministic enumeration of an Amazon.it wishlist through the current `web-control` runtime.

The user maintains monitored membership only in Amazon. This PoC therefore accepts a wishlist URL, discovers products itself, reads prices visible in the wishlist, drives lazy loading by scrolling, and records future `fetch`/XHR requests initiated by the page while loading more items.

It does **not** use Google Sheets, Gmail, ChatGPT, `web-sense`, or individual product-page navigation.

## Preconditions

- `web-control` is installed and its service is available.
- The controlled persistent browser profile can open Amazon.it.
- Node.js is available to execute this experimental script.

Check:

```sh
srv start web-control
web-control status
node --version
```

## Run

The known Price Watch wishlist is the default:

```sh
node probe.mjs
```

Explicit wishlist:

```sh
node probe.mjs 'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?'
```

Capture rendered evidence as well:

```sh
OUT_DIR=artifacts node probe.mjs
```

Useful experimental overrides:

```text
WEB_CONTROL_CMD
AMAZON_SCROLL_WAIT_MS
AMAZON_STABLE_ROUNDS
AMAZON_MAX_ROUNDS
OUT_DIR
```

## Result

The script emits one JSON document containing:

- navigation/final URL/title and block detection;
- all unique ASINs observed during the entire scrolling session, not only those left in the final DOM;
- per-item title, product URL and wishlist-visible price candidates;
- every scroll round with item count, document height, scroll position and loading indicators;
- page-level `fetch`/XHR calls observed after the network recorder was installed;
- a conservative `complete` flag.

The run is considered complete only after the browser is at the bottom, no new ASIN has appeared, document height has stopped growing, and no recognized loading indicator remains for the configured number of stable rounds.

A blocked/challenge page or a run that reaches the maximum round count without meeting the completion condition exits non-zero.

An HTTP 4xx/5xx result or a final page outside the expected Amazon.it wishlist route is explicitly classified as blocked/unverified. An Amazon sign-in redirect must not be reported as a successfully enumerated empty wishlist.

This PoC does not bypass CAPTCHA, challenges, authentication, or Amazon anti-bot controls. Network observation is passive instrumentation of requests already initiated by the rendered page.

## Interpretation

The rendered-page/scroll result is the reference path. The recorded requests are evidence for a possible later optimization. An internal continuation request must not be adopted merely because it appears once: it must first be shown to reproduce the same complete product set in the same authenticated browser/session context.
