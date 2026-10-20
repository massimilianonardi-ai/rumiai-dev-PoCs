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

## Data security and validation boundary

This repository already contains user-committed browser profiles and raw response/script evidence, which may include cookies, session data or signed URLs. Never include raw profiles or new unreviewed captures in another commit. Removing tracked files in a forward commit does **not** erase the history; do not rewrite history without explicit authorization.

The static findings above were verified against the exact Git blob sources and event indices, but the controlled runtime experiment has not yet been executed against the physical ChatGPT page and no complete deterministic DOM recreation has been demonstrated.
