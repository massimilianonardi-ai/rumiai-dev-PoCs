# PoC 054 — Amazon wishlist browser probe

Purpose: verify what a real Chromium instance running on a GitHub-hosted Ubuntu runner can see when opening the shared Amazon.it wishlist:

`https://www.amazon.it/hz/wishlist/ls/33ZKBWLPZJJVO?`

This PoC is diagnostic only. It does not attempt to bypass CAPTCHA, anti-bot controls, authentication, or other access restrictions.

The workflow records:

- main navigation HTTP status;
- final URL and page title;
- basic detection of Amazon CAPTCHA / bot-block pages;
- wishlist-like item count;
- unique `/dp/<ASIN>` links found in the rendered DOM;
- rendered HTML;
- full-page screenshot;
- a machine-readable `summary.json`.

Artifacts are uploaded even if Amazon blocks the request, so a blocked response is still a useful test result.
