# PoC 026 — mk watch trigger composition

Status: Experiment completed; local trigger composition validated
Date: 2026-09-23

## Question

What is the smallest authoritative **local-project** trigger identity needed by a future mk watch session, now that session ownership, shared operation inputs, recursive project ownership and transient-invalid configuration behavior have been established?

The experiment focuses on evidence that is semantically relevant but is not completely represented by the current public plan alone.

## Current evidence boundary

The current trusted mk engine already owns:

- normalized selected project/profile model;
- reachable plan/condition state;
- reachable requirement state and selected facility provider concrete;
- shared path/collection/output input declarations;
- collection reachability and membership;
- executable resolution and content identity;
- incremental fingerprints;
- declared output snapshots used to verify incremental freshness.

The watch trigger must compose these existing identities. It must not introduce a second filesystem scanner, package resolver or executable resolver.

## Candidate local composition

For one canonical project/request, the PoC hashes:

```text
canonical project + goals + profile
+ selected normalized model
+ current public local plan
+ reachable collection content evidence
+ declared input evidence for reachable non-skipped operations
+ executable/effective-environment identity for reachable non-skipped actions
+ current output evidence for incremental operations
+ current trusted incremental fingerprints
```

The additions beyond the public plan have specific purposes.

### Executable identity

A non-incremental operation is still change-sensitive in watch mode. If its resolved executable bytes change at the same configured command path, the normalized model and public plan alone do not change.

The PoC therefore reuses the existing trusted `_resolveExecutableIdentity` result for every reachable non-skipped process action. No executable lookup is reimplemented.

### Shared inputs

Declared operation `inputs` are change-driving identity whether or not `incremental` is enabled.

For trigger composition:

- path inputs use the existing path snapshot primitive;
- resolved collection inputs use the resolver's existing collection membership and the same path snapshot primitive;
- output inputs observe the declared producer output pathname through the existing snapshot primitive even when a fresh zero-execution resolver cannot mark that producer completed.

The last point does **not** make stale output a current-request lifecycle result. It is watch/change identity only. Normal one-shot execution still owns producer success/data-dependency semantics.

### Provider collections

A `map-process` provider semantically consumes the items of its reachable collection even though derived operations currently have no first-class operation `inputs`.

The public plan exposes collection membership but not item contents. Therefore the candidate trigger adds content snapshots for members of every reachable **resolved** collection using the membership already chosen by the trusted resolver.

A pending collection is not independently scanned. This preserves existing `after` semantics and avoids treating an old generated tree as authoritative before its producer barrier is satisfied.

### Requirement provider identity

No additional package query is required. The public resolved plan already exposes the concrete provider selected for each reachable facility requirement. A provider-default change therefore changes trigger identity through the existing requirement resolver.

### Incremental outputs

Incremental freshness already requires current declared outputs to match the successful record. The candidate trigger includes current output snapshots for reachable incremental operations using the existing `_outputSnapshots` helper.

This makes output deletion/tampering explicit watch identity without extending the rule to ordinary generated outputs.

## Output feedback boundary

Not every declared output becomes a watch trigger.

An ordinary non-incremental generated output is excluded unless it is also authoritative through another existing relation, for example:

- it is explicitly consumed as a downstream operation `input`; or
- it belongs to a reachable resolved provider/input collection.

Incremental outputs remain relevant because their current bytes are part of reusable freshness validity.

This gives the intended split:

```text
ordinary generated output only
    -> not trigger identity

output explicitly consumed as input
    -> trigger identity

incremental declared output
    -> freshness/trigger identity
```

A watch supervisor still establishes its baseline **after** each one-shot cycle, as validated by PoC 020, so legitimate generated input changes produced by that cycle are absorbed rather than immediately self-triggering.

## Stress scenarios

`tests/run.js` uses the real current mk engine through runtime instrumentation and verifies:

1. unchanged post-execution trigger identity is stable;
2. mtime-only changes do not alter content identity;
3. changing a project-local executable used by a non-incremental operation changes the digest;
4. restoring identical executable bytes restores the previous digest;
5. switching the concrete provider selected for a reachable facility requirement changes the digest;
6. that same provider switch does not affect a goal where the requirement is unreachable;
7. tampering with an incremental operation output changes the digest;
8. one-shot repair restores the stable digest;
9. changing a non-incremental producer output that is explicitly consumed as an output input changes the digest;
10. one-shot producer/consumer repair restores the stable digest;
11. changing an ordinary non-incremental output that no reachable node consumes does **not** change the digest;
12. repeated one-shot execution may rewrite that output without changing post-cycle trigger identity;
13. changing content of a reachable `map-process` provider collection item changes the digest even when membership/path is unchanged;
14. restoring that collection item content restores the digest.

A real synthetic pkg facility/provider pair is used for the requirement-provider scenario; the package resolver is not stubbed.

## Result

The experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35829179152
```

against exact `rumiai-os` revision:

```text
c2d8d4a0c4503e1de461e72840a13abb0da61c41
```

Observed:

```text
PASS PoC 026 mk watch trigger composition
OBSERVED nonincremental-executable=trigger-identity
OBSERVED requirement-provider=reachable-plan-identity
OBSERVED output-input=trigger-identity
OBSERVED ordinary-output=not-trigger-identity
OBSERVED provider-collection-content=trigger-identity
```

The result closes the local trigger-composition question.

The public plan already carries reachable requirement/provider state and incremental ready/up-to-date effects, but it is not sufficient alone. A correct local trigger additionally needs:

- current executable/effective-environment identity for reachable non-skipped process actions;
- current content identity of declared operation inputs, including output inputs even when a fresh zero-execution runtime cannot mark their producer completed;
- current member content for reachable resolved collections, because `map-process` provider membership alone does not change when a source file changes in place;
- current declared-output evidence for incremental operations.

The experiment also validates an important exclusion boundary: an ordinary non-incremental output that is not consumed through another declared data relation is not trigger identity. Rewriting or externally changing such an output does not by itself request another lifecycle cycle.

This does not weaken output-input or incremental semantics:

```text
ordinary unconsumed output
    excluded

output explicitly consumed as operation input
    included

incremental output
    included as freshness evidence
```

The temporary hosted workflow was removed after evidence collection.

## Promotion gate

The experiment establishes the local trigger-composition boundary needed before deciding public watch/session syntax.

It would not yet select:

- public `--watch` CLI/configuration;
- polling interval/default policy;
- optional host filesystem-notification adapters;
- lifecycle-cycle stop/continue options;
- user-facing temporary-unavailable diagnostics;
- remote watch execution.
