# PoC 028 — mk public watch baseline

Status: Experiment completed; public watch baseline validated
Date: 2026-09-23

## Question

Do the completed watch experiments support one minimal public execution-mode contract without introducing a new project schema, a second resolver or public tuning options?

The candidate public surface is:

```text
mk --watch [existing --project/--profile options] <goal>...
```

`--watch` is an execution mode. It is not a project goal, does not reserve the goal name `watch`, and does not add a `watch` member to `mk.json`.

## Candidate baseline

The experiment composes the already-validated boundaries from PoC 020 through PoC 027:

```text
public --watch request
-> resolve canonical project/request identity
-> wait for a valid recursive trigger snapshot
-> run one fresh-bootstrap one-shot request
-> establish a fresh post-cycle trigger baseline
-> poll trigger identity
-> on change, run another fresh-bootstrap one-shot request
-> repeat
```

### Version and option scope

The candidate baseline is version 2 only because authoritative watch identity depends on version-2 declarations such as operation inputs, contextual collections, requirements and the current resolved model.

`--watch` is incompatible with introspection/plan modes:

```text
--plan
--goals
--show-goal
```

The first baseline adds no public interval, debounce, notification-backend or stop-on-failure option.

Portable polling is an implementation mechanism, not public project semantics. A future host notification backend may reduce wakeups while preserving the same authoritative trigger digest.

### Cycle failure policy

A failed one-shot lifecycle cycle is reported but does not terminate the watch session.

The supervisor establishes the post-cycle trigger baseline and waits for another relevant trigger change before trying again. This avoids a tight retry loop.

Fatal trigger/supervisor failures remain session-fatal.

### Temporary invalid configuration

A root or active dependent-project configuration that is temporarily invalid is a retryable trigger-unavailable state:

- no lifecycle work runs while trigger identity is unavailable;
- startup waits for the first valid trigger identity;
- an established session retains the last valid baseline;
- restoring identical normalized semantics causes no lifecycle cycle;
- restoring a changed valid identity causes exactly one cycle.

### Process/environment boundary

The supervisor may be long-lived, but every trigger-resolution pass and every lifecycle cycle starts through a fresh `m` bootstrap.

This preserves current pkg semantics for facility command/environment changes without mutating the supervisor environment in process.

### Trigger ownership/composition

The experimental resolver composes:

- normalized local project model and current resolved plan;
- declared input content identity;
- reachable provider collection member content;
- reachable action executable/effective-environment identity;
- reachable requirement/provider identity;
- incremental output/fingerprint validity;
- opaque recursive child-project trigger digests.

Ordinary non-incremental unconsumed outputs are excluded.

Project dependency trigger ownership remains recursive; child lifecycle internals are not flattened.

## Experiment implementation

This PoC does not modify `rumiai-os`.

`candidate-mk.js`:

- recognizes one pre-`--` `--watch` token;
- delegates all remaining option/goal validation to the real current `_parseCli` through runtime instrumentation;
- uses the real current project-discovery boundary;
- supervises trigger and lifecycle children through fresh `m` bootstraps.

`trigger-snapshot.js` instruments the real current `mk.lib.js` to reuse existing private resolver primitives and returns:

- digest on success;
- experimental status 10 for temporary project-configuration unavailability;
- non-zero fatal status for other resolver failures.

`run-once.js` invokes the real current `mkMain` for one ordinary request.

The experiment-only status/diagnostic transport is not a proposed public product API.

## Stress scenarios

`tests/run.js` verifies:

1. `--watch` can be combined with existing `--project` and goal operands;
2. `--watch --plan`, `--watch --goals` and `--watch --show-goal` are rejected;
3. a version-1 project is rejected for watch;
4. a valid version-2 watch request runs one initial cycle;
5. unchanged trigger identity causes no repeated cycle;
6. declared input change causes exactly one new cycle;
7. a failing lifecycle cycle is reported and does not busy-loop or terminate the session;
8. another later trigger change runs another lifecycle cycle after that failure;
9. temporary invalid root configuration pauses the session without work;
10. restoring unchanged valid configuration causes no cycle;
11. changing a recursively active child declared input triggers the parent session;
12. temporary invalid active-child configuration pauses the parent session and recovery obeys the same baseline rules;
13. SIGTERM terminates the long-running supervisor and is forwarded to an active one-shot child;
14. no public polling interval/tuning option is accepted by the candidate surface.

## Result

The final experiment passed on both GitHub-hosted Ubuntu and macOS in run:

```text
35834779030
```

against exact target revision:

```text
rumiai-os c2d8d4a0c4503e1de461e72840a13abb0da61c41
```

The final harness exercises the candidate through integrated `#!/usr/bin/env m` command wrappers and verifies the real current lifecycle engine for every one-shot cycle.

The diagnostic iterations exposed two useful implementation constraints rather than product-model failures:

- an integrated command is sourced by `m`, so its own pathname must come from `m_COMMAND_BIN`, not `$0`;
- signal semantics must be tested at the same integrated-command process boundary that the product will use.

The final run validates the complete first baseline:

- `--watch` as execution mode, not goal/schema;
- version 2 only;
- plan/introspection incompatibility;
- no public polling tuning;
- initial one-shot cycle followed by post-cycle baseline;
- content-based trigger changes without mtime-only noise;
- no feedback from ordinary unconsumed outputs;
- reachable executable identity changes;
- recursive opaque child-project trigger ownership;
- temporary invalid root/child configuration retry;
- changed child identity during invalidity causing one recovery cycle;
- failed lifecycle cycle reporting without busy-loop/session termination;
- later recovery after a failed cycle;
- SIGTERM forwarding to an active integrated one-shot child;
- fresh integrated `m` bootstrap boundaries for trigger and lifecycle children.

## Promotion gate

The experiment closes the design gate for the first public watch baseline. The next work is canonical promotion into `MK.md`, product implementation in `rumiai-os`, permanent tests and task validation.

Portable polling remains the first implementation mechanism. Optional host notification backends remain a future optimization and must preserve the same authoritative trigger semantics.
