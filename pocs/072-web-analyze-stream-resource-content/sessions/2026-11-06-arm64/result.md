# Session result — 2026-11-06, Ubuntu 26.04 ARM64

- Product base: `rumiai-os@e8504ab4652af626f1f72fe769bde742e6af4786`.
- Test suite context: `rumiai-tests@0d88b06c8c3d3e5c9f61a698528a914e19db6816`.
- Host: Ubuntu 26.04.1 ARM64, VMware guest; Node.js 26.13.0; HeadlessChrome 157.0.8103.38.
- Target: an already-authorized public ChatGPT shared page; URL and private response evidence are intentionally omitted.
- Method: apply the PoC patch, run the real `m web-analyze` command, and correlate `Network.streamResourceContent` command replies in the raw CDP wire ledger with `responseProvenance=response-only` rows.

## Outcome

| Observation | Amazon | ChatGPT | Total |
| --- | ---: | ---: | ---: |
| Response-only rows | 8 | 15 | 23 |
| Disk-cache Stylesheet responses | 8 | 15 | 23 |
| `Network.streamResourceContent` attempts | 8 | 15 | 23 |
| CDP errors `-32602` (`Request with the provided ID does not exists`) | 8 | 15 | 23 |
| Bodies saved by streaming | 0 | 0 | 0 |
| Bodies still unavailable | 8 | 15 | 23 |

Both captures used the public URLs already authorized for the web-analyze
validation workflow; URLs and private response evidence are intentionally
omitted. The product patch issued streaming immediately when each
response-only disk-cache Stylesheet event arrived. CDP rejected every request
ID as nonexistent. The corresponding `Network.getResponseBody` calls still
failed with their existing `-32000` outcome. Streaming at this late response
event cannot recover these bodies.

This negative result is specific to the response-only cached-CSS path. It does
not test streaming armed earlier on a live request, and it does not rule out
that separate use. Do not integrate the response-only streaming branch or claim
that CSS text from `CSS.getStyleSheetText` represents original HTTP bytes.

Sanitized command output from both captures is reproducible with
`tests/summarize.mjs`. The raw captures remain private under the local
`work/stream-poc-output/` directory and are not included in this repository.
