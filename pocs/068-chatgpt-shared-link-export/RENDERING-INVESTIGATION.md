# PoC 068 — ChatGPT shared-page rendering mechanism

Status: Experimental evidence, not an RumiAI interface or a stable ChatGPT contract.
Source: committed real-browser capture at `rumiai-dev-PoCs@cfc4533627382bb0e339ea1c424eb96d1f88b123`, in `analysis-chromium-resources-02`. No history lookup and no new live capture in this analysis.

## Reproducible source attribution

The two particularly relevant **compiled** JavaScript resources in `scripts.jsonl` are:

| Captured asset URL basename | Content-addressed file | Git blob SHA | Role observed |
|---|---|---|---|
| `8b34dbc2-i6mnaw2f0obqfl0x.js` | `scripts/082eaa5e9e0e8547ce0633aed3766333d588e8eebf60d57f3715f1a68354ba6a.js` | `7287982fb205398a8460c37984f3aaa1fd2254d6` | Turn rendering, intersection-driven child mounting, render-coordinator |
| `conversation-small-fcu1fuggk1duh76x.js` | `scripts/d87462a803a961d4625067bad08fd48971020bfb7f6f6b3dfdcbf3933c01c84c.js` | `4e31b5fed07b29a27a5068b2b11b1b56d23b0f7d` | Scroll-root event registration and DOM queries by original IDs |

These generated symbol names and constants are specific to **this** captured build. Git blob SHA gives the exact revision independent of changing production asset filenames.

## Identified rendering chain

1. **Identity:** the message JSX sets `data-message-id` from `message.id`. The turn `section` sets `data-turn-id` and `data-turn-id-container` from `turn.id`, with `data-testid` derived from `conversation-turn-` plus turn ordinal. The outer virtualized turn `div` also holds `data-turn-id-container` and `data-is-intersecting`. Multiple nested nodes may share a turn ID; never assume there is only one matching element.
2. **Virtual turn implementation:** minified function `a5n` in the `8b34...` compiled asset receives `intersectionObserver`, `alwaysShow`, `forceRender`, `onIntersectingChange`, `turnId` and `turnIndex`. It calls the supplied observer's `observe` method, handles visibility callbacks, sets local React state, and calls `onIntersectingChange`. When content is not enabled, its child JSX is `null`; a wrapper can remain with `--estimated-turn-height` and/or `--last-known-height`.
3. **Rendering exceptions:** the calling component renders the final five turns unconditionally, and turns within ±5 positions of the selected reference index. It also supplies explicit `forceRender` for selected/targeted turns. Special content groups can trigger additional always-render conditions. These are observed build constants, not general guarantees.
4. **Coordinator and geometry:** the calling component (observed near minified `tpr`) maintains a set of currently intersecting turn IDs. The `onIntersectingChange` callback updates that set and its reference index; a layout-preservation step finds a turn by `data-turn-id-container` and corrects the real scroll container's `scrollTop` after reflow to retain the user's visual anchor.
5. **Actual scroll-root listener:** in the `conversation-small...` asset, function `QNe` registers a native `scroll` listener and toggles `data-scroll-from-top` using the element's own `scrollTop`, not `window.scrollY`. Scroll-to-message behavior queries `data-message-id` first and falls back to `data-turn-id-container`.

The application uses an observer adapter (its exposed `observe` is not necessarily a raw `IntersectionObserver`). We must distinguish the adapter callback from the native browser observer's callback instead of claiming their equivalence without runtime instrumentation.

## Comparison with physical capture

The new `summary.json` reports 4,768 events, including 1,063 DOM mutation batches, 1,066 interaction events, 1,882 network events and 666 performance events, with no declared dropped event records. Its DOM batches aggregate 1,994 added nodes, 821 removed nodes and 1,758 attribute changes. There are 256 captured `scroll` events.

The capture also archived 614 response bodies (40,498,763 bytes) and 530 parsed-script source events (525 distinct source files). These counts validate substantial source coverage, **not** perfect completeness.

The existing `web-analyze` DOM mutation samples omit individual node IDs, and its scroll records contain `window.scrollY` instead of the target container's `scrollTop`. Therefore the original event stream cannot independently prove which `data-turn-id-container` gained/lost content after each observer notification. Static source analysis plus temporal correlation cannot conclusively attribute a particular mutation to a specific callback.

## Controlled experiment required to establish causality

- Inject observation **before initial page navigation**, recording native `IntersectionObserver` and `ResizeObserver` constructions, registrations and callback notifications with their root/options/target turn IDs. Record listener-registration callsites for `scroll`, `wheel` and `resize`, avoiding password, request-body and token capture in diagnostic logs.
- At runtime identify the actual `[data-scroll-root]` element and record `scrollTop`, `scrollHeight`, `clientHeight`, element bounds and a stable DOM locator. Change **real element.scrollTop** incrementally in each direction; synthetic dispatch of a `scroll` event alone does not change geometry or establish an observer transition.
- Observe every `[data-turn-id-container]` placeholder and its descendant `[data-message-id]` nodes. For each transition, correlate observer notification, wrapper `data-is-intersecting`, added/removed descendants, outerHTML snapshot, message IDs and height. Capture full rendered turn HTML before virtualization removes it, without assuming that HTML alone preserves interactive behavior.
- Compare observed message IDs with the independently verified `chatgpt-export.lib.js` RAW transcript; report missing turns, repeated IDs, unrendered special components, resource failures and snapshots that exceeded explicit size limits. Only then attempt assembling an offline DOM replica.
- Preserve the existing Markdown baseline at `rumiai-os@17077e469469f11dddb66a530a1692a663ba9fcb`; a rendering probe belongs to this PoC until its behavior is verified.

## Executable controlled observer probe

The independently instrumented experimental entrypoint is `render-probe.mjs`. It launches Chromium from PATH via native loopback TCP CDP, injects a probe using `Page.addScriptToEvaluateOnNewDocument` **before initial navigation**, and captures:
- `listener.register` for scroll/wheel/resize listener registration;
- `intersection.create`, `intersection.observe`, `intersection.callback`;
- `resize.create`, `resize.observe`, `resize.callback`;
- `scroll.actual` with the scroll target's true scrollTop, scrollHeight and clientHeight;
- `dom.mutation` with affected turn IDs and counts;
- `turn.snapshot` with turn ID, descendant message IDs, and content-addressed full outerHTML files in `turns/` (per snapshot maximum 2 MiB; oversize explicitly reported).
- `turn.initial` for the first observed wrapper state, `turn.content-mounted` and `turn.content-unmounted` for observable changes in descendant message presence, and `turn.wrapper-removed` if the wrapper itself vanishes. These are observation-frame transitions, **not** direct instrumented React lifecycle hooks; changes occurring entirely between capture frames can be missed. Transition records preserve original turn/message IDs but omit message HTML.
- `listener.register`, `intersection.create` and `resize.create` include limited JavaScript origin stack frames, to locate the registration logic in captured JS; URL query strings/fragments are stripped from these callsite hints. Missing/minified symbols and wrapper-library stacks remain possible.

The optional `--sweep` option waits until a `[data-scroll-root]` and turn wrappers appear (up to 120 seconds), then modifies the scroll element's actual scrollTop incrementally forward and backward, allowing browser intersection callbacks and React to execute organically. Synthetic scroll-event dispatch alone is not used. The ordinary manual capture mode remains active until operator signal/browser close. The tool does not inject a fake React renderer, nor does it guarantee snapshots for every turn.

Usage from the PoC directory (choose a **fresh private directory**):

```sh
node render-probe.mjs \
  'https://chatgpt.com/share/6ad1c0d5-49ec-83eb-a79b-85b04b938835' \
  './render-probe-run-01' --sweep
```

Inspect `render-probe-run-01/summary.json`, `events.jsonl`, and `turns/*.html`. These are private data and should not be committed.

The latest regression fixture additionally checks per-turn content mount/unmount transitions, stable IDs and registration callsites. This does not establish which callback causes each transition on ChatGPT's live page.

Validation: `tests/.support/render-probe.mjs` runs the real entrypoint against a self-hosted virtualized HTML fixture in a real Chromium browser; its assertions check actual IO callback emissions, target scroll, snapshots, original message IDs at both ends and content persistence. GitHub Actions run `39432091366` (2026-10-20) reports PASS: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39432091366 . The follow-up commit `2a8cacecbef5c9cda5753d23d78b45acda031e7e` avoids duplicate snapshots for nested wrappers sharing the same turn ID by selecting the outermost wrapper; the updated Chromium test also reports PASS in run `39432702338`: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39432702338 . This is **synthetic-fixture browser validation**, not a real ChatGPT replay result. Full-page coverage and faithful DOM reconstruction remain open.

## Data security and validation boundary

This repository already contains user-committed browser profiles and raw response/script evidence, which may include cookies, session data or signed URLs. Never include raw profiles or new unreviewed captures in another commit. Removing tracked files in a forward commit does **not** erase the history; do not rewrite history without explicit authorization.

The static findings above were verified against the exact Git blob sources and event indices, but the controlled runtime experiment has not yet been executed against the physical ChatGPT page and no complete deterministic DOM recreation has been demonstrated.
