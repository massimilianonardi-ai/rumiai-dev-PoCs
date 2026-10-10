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
- per-item title, product URL, wishlist-visible price candidates and `purchaseAction` (`add-to-cart`, `view-all-options`, `ambiguous`, `unknown`);
- every scroll round with item count, document height, scroll position and loading indicators;
- page-level `fetch`/XHR calls observed after the network recorder was installed;
- a conservative `complete` flag.

The run is considered complete only after the browser is at the bottom, no new ASIN has appeared, document height has stopped growing, and no recognized loading indicator remains for the configured number of stable rounds.

A blocked/challenge page or a run that reaches the maximum round count without meeting the completion condition exits non-zero.

An HTTP 4xx/5xx result or a final page outside the expected Amazon.it wishlist route is explicitly classified as blocked/unverified. An Amazon sign-in redirect must not be reported as a successfully enumerated empty wishlist.

This PoC does not bypass CAPTCHA, challenges, authentication, or Amazon anti-bot controls. Network observation is passive instrumentation of requests already initiated by the rendered page.

## Interpretation

The rendered-page/scroll result is the reference path. The recorded requests are evidence for a possible later optimization. An internal continuation request must not be adopted merely because it appears once: it must first be shown to reproduce the same complete product set in the same authenticated browser/session context.

## Purchase-action interpretation

The per-item `purchaseAction` reflects the visible wishlist action, not global inventory status. `add-to-cart` means direct wishlist cart action; `view-all-options` means the item directs the user to alternative offers instead. `ambiguous` and `unknown` explicitly avoid inferring availability. The current experiment recognizes Italian and English visible button labels, scoped to each wishlist item. Price verification remains independent of this classification; selectors/labels require physical DOM validation if Amazon changes its interface.

## Reusable JavaScript API (experimental)

Import `extract` from `amazon-wishlist-extract.mjs`. The existing PoC CLI remains the single extraction engine; the API delegates to it and does not duplicate browser/DOM logic.

```js
import { extract } from './amazon-wishlist-extract.mjs';

const observation = await extract(
  'https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO',
  { webControlCommand: '/path/to/web-control', timeoutMs: 300000 }
);
if (!observation.complete || observation.blocked) {
  // Preserve evidence; do not interpret this as a complete wishlist.
}
```

Options: `webControlCommand`, `scrollWaitMs`, `stableRounds`, `maxRounds`, `timeoutMs`. All optional. Returns the same structured observation as the CLI, including `items[].price` and `items[].purchaseAction`. Incomplete/blocked observations are returned as data; transport/process failures throw. This API is currently an experimental subprocess adapter, not a promoted RumiAI library, package, or stable runtime contract. JSON/CSV/HTML/PDF report generation, monitoring history, presentation, and delivery belong downstream.

## Pure monitoring decision experiment

`price-monitor.mjs` exports `evaluate({lists, observations, accessFailure, unreliable, checkedAt})`. Inputs use integer euro cents; `lists` contain named rows with ASIN, previous current/minimum, user-owned target, and target-notified state. Observations provide `asin`, `priceCents`, `verified`. Outputs: `changes`, `alerts`, per-list `coverage`, `failed`, and email requirements. `notificationAcknowledgement` on target alerts is **only** applied by a downstream delivery/persistence coordinator after successful email delivery. The function never sends mail, changes sheets, or mutates inputs. Synthetic tests: `test-price-monitor.mjs`. The experiment does not yet implement report renderers, email adapters, or a complete end-to-end workflow; particularly error-email success verification is the coordinator's responsibility.
