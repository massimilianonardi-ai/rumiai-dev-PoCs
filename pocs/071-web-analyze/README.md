# web-analyze — Chromium manual-session logger

Reusable JavaScript ES module and CLI for recording browser behavior while a human uses **visible Chromium**. Uses Playwright 1.63.0, Node >=22 and a dedicated persistent browser profile. This is exploratory RumiAI PoC 071, not a published `web-control` facility or integrated RumiAI OS library.

## Run

```sh
npm install
WEB_ANALYZE_CHROMIUM=/usr/bin/chromium WEB_ANALYZE_PROFILE=./local-profile \
  node bin/web-analyze 'https://example.org' ./evidence/session-001
```

The output directory **must not already exist**. Use the browser normally and press Enter in the launching terminal when finished. Each subsequent run requires a new output directory. Closing the Chromium window also finalizes the logs. The `local-profile` directory persists sign-in state and should not be uploaded or committed.

Programmatic API:

```js
import { startWebAnalyze } from './src/web-analyze.mjs';
const session = await startWebAnalyze
({
  url: 'https://example.org',
  outputDir: './evidence/session-002',
  profileDir: './local-profile',
  executablePath: '/usr/bin/chromium'
});
const summary = await session.stop('operator-finished');
```

## Recording format

Seven JSONL streams and a final JSON summary, created with private filesystem permissions:

- `lifecycle.jsonl`: page/tab/frame opening and closing; navigations, load, ready state, CDP lifecycle.
- `interaction.jsonl`: pointer/mouse/keyboard category without input contents, click, wheel, scroll, focus, form and visibility metadata.
- `dom.jsonl`: batched mutation types, element tags, attribute names, added/removed nodes and explicit batch overflow counts.
- `network.jsonl`: HTTP request method/type/status, response metadata/timing, CDP request IDs, network completion/failures, WebSocket frame length/opcode and EventSource metadata.
- `console.jsonl`: browser console level, source location and text length.
- `performance.jsonl`: browser navigation/resource timings, long tasks and layout shift entries when browser support allows.
- `error.jsonl`: page/runtime exceptions, crashes and instrumentation failures.
- `summary.json`: session boundaries, per-stream counts, dropped data and logging failures.

Each JSONL line has a globally increasing `sequence`, UTC ISO `time`, process monotonic `elapsedMs`, an event identity and structured data. CDP and Playwright overlap intentionally as separate observation channels; align by request IDs and timing as available. There is no claim that instrumentation exposes every internal JavaScript statement or every transient DOM state.

## Privacy and fidelity boundaries

The observer does not log form values, actual typed characters, raw HTTP bodies, cookies, authorization headers, WebSocket payloads, raw console text or DOM text. URL query parameter values, fragment and credential components are redacted; URLs' hosts and path segments **can still identify private resources** and should be protected as sensitive. Logs are private (0700 directory, 0600 files). Authentication, consent and challenges remain human-operated; sandbox and HTTPS verification are enabled by default.

Some events are intentionally sampled (wheel 40 ms, scroll 80 ms); DOM mutation batches coalesce over 100 ms and cap 200 records; heavy traffic may drop details, reported via counters. Instrumentation itself slightly affects timing. No browser extension is required.

## Development status

Run `npm test` for logger format/redaction tests. The initial auxiliary Node 22 execution passed 2/2 tests and syntax checks. A full graphical Chromium recording has **not yet been verified** on the operator's desktop, because the auxiliary environment lacked Playwright. Do not interpret that test evidence as physical browser validation.
