# PoC 059 — Amazon price extraction through web-control

Purpose: verify that the current ChatGPT Amazon Price Watch observation step can be replaced by a deterministic program that uses the released `web-control` command surface instead of model-driven browser work.

This PoC is deliberately narrower than the full monitor. It does **not** read or write Google Sheets, send Gmail, schedule itself, use ChatGPT, or define `web-sense`. It answers only:

> Given an Amazon.it ASIN, can current `web-control` obtain a price that is safe to classify as verified, or explicitly explain why it is not verified?

The experiment reuses the access/block diagnostics learned in PoC 054 and adds product-page/price evidence.

## Preconditions

- `web-control` is installed and its service is running.
- The current browser profile can access Amazon.it.
- Node.js is available to execute this experimental script.

## Run

One product:

```sh
node probe.mjs B012345678
```

Several products:

```sh
node probe.mjs B012345678 B0ABCDEFGHI
```

To retain rendered evidence:

```sh
OUT_DIR=artifacts node probe.mjs B012345678
```

`WEB_CONTROL_CMD` may override the client command path. `AMAZON_ORIGIN`, `AMAZON_POLL_INTERVAL_MS` and `AMAZON_POLL_TIMEOUT_MS` are experimental overrides.

## Result contract

The script prints one JSON document. Each observation contains:

- requested ASIN and final URL/status;
- product title and availability text when observable;
- common block/challenge signals;
- ordered DOM price candidates and the evidence selected;
- either a verified EUR price or explicit unverified reasons.

A price is accepted only when:

- navigation did not return an HTTP error;
- no known Amazon block/challenge signal is active;
- the rendered page identifies the requested ASIN;
- a product title is present;
- the best-priority visible price-candidate group resolves to exactly one EUR value.

If any observation is unverified the process exits with status 1, while still printing all per-product results.

This PoC does not bypass CAPTCHA, anti-bot controls, authentication or other access restrictions.

## Why this experiment exists

The current ChatGPT `Amazon Price Watch` task already expresses most of its behavior as deterministic state rules (previous/current price, monitored minimum, target, target-notified state and alert thresholds). The open question is reliable product-price observation. If this PoC works on a representative physical sample, the remaining monitor logic can be implemented without invoking a model for each poll.

Amazon-specific selectors and use of `web-control debug cdp` are experimental application details. They do not redefine the provider-independent `web-control` contract.
