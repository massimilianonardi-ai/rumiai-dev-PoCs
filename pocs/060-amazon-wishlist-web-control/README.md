# PoC 060 — Amazon wishlist enumeration through web-control

Purpose: validate complete deterministic enumeration of an Amazon.it wishlist through the current `web-control` runtime.

The user maintains monitored membership only in Amazon. This PoC therefore accepts a wishlist URL, discovers products itself, reads prices visible in the wishlist, drives lazy loading by scrolling, using only provider-neutral rendered HTML inspection and document scrolling.

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
- `networkTrace: null`, explicitly indicating that the portable interface does not record fetch/XHR;
- a conservative `complete` flag.

The run is considered complete only after the browser is at the bottom, no new ASIN has appeared, document height has stopped growing, and no recognized loading indicator remains for the configured number of stable rounds.

A blocked/challenge page or a run that reaches the maximum round count without meeting the completion condition exits non-zero. The output remains structured JSON with `completionReason`: `stable-bottom`, `blocked` or `max-rounds-reached`.

If the page disappears or a `web-control` command fails mid-run, the CLI emits a diagnostic to stderr, but still writes a structured partial observation to stdout (`complete: false`, `failure` with the failed operation and any safely observed remaining page IDs, `completionReason` set to the failure reason). The CLI uses exit code 2 for this case; the experimental import API continues to **throw** on transport failures and attaches any partial `observation` to the thrown error. These failures are never reported as a completed wishlist, nor treated as an authenticated-site validation PASS.

An HTTP 4xx/5xx result or a final page outside the expected Amazon.it wishlist route is explicitly classified as blocked/unverified. An Amazon sign-in redirect must not be reported as a successfully enumerated empty wishlist.

This PoC does not bypass CAPTCHA, challenges, authentication, or Amazon anti-bot controls. The portable interface does not record network requests; the observation is derived from the rendered HTML and scroll geometry.

## Interpretation

The rendered-page/scroll result is the reference path. The adapter does not call or infer Amazon internal continuation endpoints. Any future optimization would require separately demonstrated equivalence to the complete visible product set.

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

`price-monitor.mjs` exports `evaluate({lists, observations, accessFailure, unreliable, checkedAt})`. Inputs use integer euro cents; `lists` contain named rows with ASIN, previous current/minimum, user-owned target, and target-notified state. Observations provide `asin`, `priceCents`, `verified`. Outputs: `changes`, `alerts`, per-list `coverage`, `failed`, and email requirements. `notificationAcknowledgement` on target alerts is **only** applied by a downstream delivery/persistence coordinator after successful email delivery. The function never sends mail, changes sheets, or mutates inputs. Synthetic tests: `test-price-monitor.mjs`. This pure decision module delegates report formatting, email delivery and full end-to-end operation to separate PoC modules below; notably, error-email success verification is the coordinator's responsibility.

## Wishlist / workbook bridge (experimental)

`wishlist-price-adapter.mjs` converts a complete, non-blocked `extract()` result into verified/unverified price-monitor observations; incomplete or ambiguous enumerations fail closed. `price-monitor-sheet-adapter.mjs` reads the existing twelve-column `Watch`/`Star Wars` Google Sheet arrays into the pure monitor's cents-based rows and creates only a cell-level update plan. It never writes Google Sheets, sends email or overwrites spreadsheet formulas, user-owned targets, notes or URLs. The live workbook's G/H columns contain formulas and must remain untouched. The `Target notificato` acknowledgement is planned **only** when the caller separately confirms successful email delivery. See `test-adapters.mjs` for the isolated bridge test. This PoC still requires a real authenticated runtime and a coordinator to perform end-to-end sheet persistence and notification delivery. The extractor requires only the provider-independent `web-control 2` operations. It does not call the Playwright-specific `debug cdp` extension.

## Isolated coordinator and email formatting

`price-monitor-reports.mjs` produces HTML alert and mandatory access-error messages without sending them. `price-watch-coordinator.mjs` joins the two wishlist observations, pure monitoring decisions, email delivery acknowledgements and cell-level sheet updates through explicitly injected I/O methods. It checks that each spreadsheet tab has exactly one configured wishlist source; unverified prices are never written and target notification state is only planned after a successful Gmail send acknowledgement. It has **no live Google/Amazon implementation or background scheduler**. The current ChatGPT automation remains disabled until authenticated wishlist access, both wishlist URLs, sheet write safety and email delivery have been physically/end-to-end validated. Synthetic coordinator tests live in `test-coordinator.mjs`.

## Membership reconciliation (Amazon-owned)

`price-monitor-membership.mjs` makes each complete Amazon wishlist extraction authoritative for that cycle's monitored ASIN membership, even when the legacy Sheet contains fewer or older rows. Existing matching Sheet rows retain target and history; old Sheet rows absent from the current Amazon list remain as historical, unmodified rows and are not monitored. New verified items receive an append-row cell plan; new unverified items are observed but not written. Appended rows include explicit G/H formula-copy instructions rather than replacing existing formulas. The I/O implementation must materialize those copies and apply writes safely; no actual row append has yet been performed on the user's Sheet. Failed wishlist extraction leaves that list's historical rows in the attempted failure count, but never treats the failure as a complete membership result. Per-list ASIN evidence is scoped so another wishlist cannot falsely satisfy a blocked list's coverage.

## Provider-independent extraction (2026-10-11)

The current implementation consumes only `web-control page new/navigate/inspect/scroll/capture/close`. A local Cheerio HTML parser interprets rendered Amazon-specific item markup; the provider never receives any Amazon parser or generic JavaScript evaluation request. `page scroll 0` reads layout without motion, while a positive delta advances the real browser and triggers lazy loading. Completeness requires consecutive stable bottom-of-document observations, item count and layout height; a blocked, empty, or incomplete result never becomes a successful complete list. Network trace is deliberately unavailable (`null`), not faked. The same adapter requires the immutable full facility compatibility level `web-control 2` (Electron v0.1.4 or Playwright v0.1.5); older compatibility-level-1 providers do not implement `scroll` and must not be silently selected as equivalent. No browser/vendor APIs are referenced by the extractor. Install the PoC-only HTML parser once with `npm install` inside this directory (or `npm ci` if a lockfile is present). It is not part of the provider package. The hosted Electron integration fixture tests a real browser without authenticating to Amazon; real authenticated Amazon.it DOM behavior still requires physical acceptance.

Real hosted source-to-browser acceptance: [GitHub Actions run 38166410339](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38166410339) passed with actual `electron-web-control@66dd8e61b90be85fde0e12677e2153cc4a72e710` under Xvfb/Openbox. A local lazy-loaded wishlist fixture produced three distinct items, two verified prices and one `view-all-options` entry, with observed positive scrolling and stable bottom. The same run's synthetic scenarios passed. This is real Electron process/IPC/rendering evidence on a hosted Linux x86_64 runner **against a local fixture**, not an authenticated physical Amazon.it or user's Linux ARM64 validation.
