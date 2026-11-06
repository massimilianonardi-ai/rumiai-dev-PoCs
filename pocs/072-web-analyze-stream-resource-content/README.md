# web-analyze: `Network.streamResourceContent` for cached response-only CSS

## Question

Can CDP `Network.streamResourceContent` recover a cached stylesheet body when
`Network.responseReceived` is observed without a preceding
`Network.requestWillBeSent` and the later `Network.getResponseBody` fails?

## Experimental change

`patches/stream-response-only-cached-css.patch` starts CDP streaming directly
from the response event for a response-only disk-cache Stylesheet. It reuses
the product's bounded stream implementation (16 MiB per request, 64 MiB total)
and records the source as `Network.streamResourceContent` only if all bytes are
available. This patch was applied only in a disposable worktree based on
`rumiai-os@e8504ab4652af626f1f72fe769bde742e6af4786`.

## Reproduction

Use the real Chromium/Node runtime and a private output directory. Supply an
already-authorized HTTPS page through `WEB_ANALYZE_POC_URL`; do not save its URL
in this PoC. Run the patched checkout's real command, then summarize only the
response-only rows and matching CDP command results:

```sh
PATH="$RUMIAI_M_OS_RUNTIME/bin:$PATH" \
  ./m web-analyze "$WEB_ANALYZE_POC_URL" "$PRIVATE_OUTPUT_DIR"
node tests/summarize.mjs "$RUN_DIRECTORY"
```

`tests/summarize.mjs` intentionally emits no URLs, request IDs, bodies, page
text or CDP packet contents beyond grouped numeric error codes and fixed error
classifications.

## Result

See `sessions/2026-11-06-arm64/result.md`. On two real Ubuntu 26.04 ARM64
Chromium captures, every streaming command for the response-only cached CSS
failed because CDP reported that the request ID does not exist. No HTTP body
was recovered. Do not integrate this response-only streaming branch.

`CSS.getStyleSheetText` may still provide the stylesheet's current parsed text
in a separate artifact; that text is not the original HTTP response body.
