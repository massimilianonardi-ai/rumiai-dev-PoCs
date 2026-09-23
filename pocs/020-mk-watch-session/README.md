# PoC 020 — mk watch session

Status: Active experiment
Date: 2026-09-23

## Question

Can long-running `mk` watch/hot-update behavior be modeled as a supervision/session layer around complete one-shot `mk` requests, without turning one `_executeV2` invocation into an indefinitely mutable lifecycle session?

The experiment deliberately separates:

```text
watch session supervisor
    owns repetition, waiting, cancellation and cycle failure handling

trigger resolver
    owns the deterministic identity of relevant changing inputs/state

one-shot mk request
    continues to own normal project resolution, dependencies, requirements,
    incremental freshness, execution and refinement
```

The public product surface is not selected by this PoC. In particular, the experimental command/environment interface below is not a candidate `mk.json` schema or public CLI.

## Candidate session protocol

The experiment uses two external executables only to isolate the architectural boundary:

```text
snapshot command
    prints the current deterministic trigger snapshot

run command
    performs one complete one-shot lifecycle request
```

The session is:

```text
run initial request
→ snapshot after the request
→ poll trigger snapshot
→ if unchanged: keep waiting
→ if changed: run one fresh request
→ snapshot again after that request
→ repeat
```

Taking the new baseline **after** each one-shot request is important: filesystem effects produced by that request are absorbed into the post-cycle baseline instead of automatically causing an immediate second cycle.

This alone does not make generated outputs legitimate watch triggers. Product trigger derivation must still avoid accidental feedback loops and should be based on authoritative input identity rather than arbitrary project-tree change.

## Cycle failures

A failed one-shot cycle does not terminate the experimental watch session and does not immediately retry the same unchanged trigger snapshot.

Instead:

```text
trigger changed
→ run request
→ request fails
→ establish post-cycle trigger baseline
→ wait for another relevant change
```

This avoids a tight failure/retry loop while preserving the normal one-shot request's exit/error behavior inside each cycle.

Whether the eventual product should offer a stop-on-failure mode is intentionally not decided here.

## Snapshot failures

Failure to resolve the trigger snapshot is different from a lifecycle-cycle failure.

If the supervisor cannot establish trustworthy trigger identity, it cannot decide whether another request is required. The PoC therefore treats snapshot resolution failure as a session failure.

## Cancellation

SIGINT/SIGTERM belong to the long-running supervisor. If a one-shot child request is active, the supervisor forwards the signal to that child and terminates the session after the child exits.

This keeps cancellation ownership at the session boundary rather than inventing persistent cancellation state in the one-shot lifecycle engine.

## Why not poll `mk` blindly

A timer that simply runs `mk <goal>` continuously would be architecturally simple, but non-incremental reachable operations would execute on every timer tick even when no relevant project input changed.

Therefore the session needs a change identity distinct from the normal one-shot execution request.

The PoC does **not** settle how the production trigger resolver obtains that identity.

## Product trigger questions still open

The next design step must bind trigger identity to the existing lifecycle model without duplicating it in an outer wrapper.

Candidate evidence to evaluate includes:

- project `mk.json` identity, so project/profile/model changes reload cleanly;
- reachable incremental path inputs;
- reachable incremental collection roots/membership/content;
- upstream producers reached through output-input data dependencies;
- requirement-provider/executable identity changes that affect effective fingerprints;
- exclusion or controlled treatment of generated outputs to prevent feedback loops;
- recursive child-project ownership without flattening project dependencies.

A likely architectural requirement is that trigger resolution belongs inside the current trusted `mk` engine, while the long-running session itself may remain a thin supervisor around fresh one-shot engine processes.

That is still working design, not current contract.

## Experiment interface

`watch-session.js` reads:

```text
RUMIAI_POC_WATCH_SNAPSHOT
    executable that prints one deterministic trigger snapshot

RUMIAI_POC_WATCH_RUN
    executable representing one complete one-shot mk request
```

Options:

```text
--interval-ms <positive integer>
--max-runs <positive integer>
```

`--max-runs` exists only to make the experiment deterministic in tests.

## Stress scenarios

`tests/run.js` verifies:

1. an initial one-shot request always runs;
2. unchanged trigger identity does not run another request;
3. same-content/mtime-only change does not trigger when the snapshot is content based;
4. changed trigger content starts exactly one new request;
5. a cycle's own filesystem effects are absorbed by the post-cycle baseline and do not self-trigger immediately;
6. a failed cycle does not terminate the session or busy-loop;
7. another later trigger change causes a new cycle after a failure;
8. trigger-snapshot failure terminates the supervisor rather than guessing;
9. SIGTERM is forwarded to an active child and terminates the watch session.

## Scope limit

This PoC does not define:

- a public `mk --watch` option;
- project configuration for watch;
- the production trigger resolver;
- filesystem notification adapters;
- polling interval policy;
- recursive child-project watch protocol;
- artifact cache behavior;
- parallel scheduling;
- remote execution.

Those require further evidence before promotion.
