# PoC 027 — mk watch fresh-bootstrap supervision

Status: Experiment in progress
Date: 2026-09-23

## Question

Can a long-running mk watch supervisor remain a stable process while every trigger-resolution pass and every one-shot lifecycle cycle starts through a **fresh m bootstrap**, so package/facility environment changes become visible without mutating the supervisor process itself?

This question exists because the current pkg contract explicitly states:

```text
every new m bootstrap
    re-resolves global facility environment

already-running processes
    are not mutated retroactively
```

A watch implementation that repeatedly calls the resolver or `mkMain` inside one long-lived process could therefore observe stale package-projected environment.

## Candidate process boundary

The experiment uses this structure:

```text
long-running supervisor
    owns timers, comparison and session lifetime

each trigger poll
    -> fresh $m_ROOT/m bootstrap
    -> trigger resolver child

each lifecycle cycle
    -> fresh $m_ROOT/m bootstrap
    -> one-shot mk child
```

The supervisor itself never attempts to refresh or reconstruct package environment.

## Why both children must be fresh

A fresh trigger child is needed so executable/effective-environment identity uses the package environment that would apply to a newly started integrated command.

A fresh lifecycle child is needed so the actual build/test/run cycle executes under the same current bootstrap semantics.

The two sides must agree. It would be incorrect for the trigger resolver to notice a new provider environment while the lifecycle cycle still executes with the supervisor's stale inherited environment.

## Experiment boundary

The PoC reuses:

- the PoC 026 trigger-composition resolver without copying it;
- the real current m bootstrap;
- the real current pkg facility-default environment projection;
- the real current mk JavaScript engine for one-shot execution.

A synthetic provider exposes one facility environment variable:

```text
POC027_VALUE=one
```

in provider version 1 and:

```text
POC027_VALUE=two
```

in provider version 2.

The facility default uses an unversioned provider selector, so changing the provider package default changes the selected concrete while preserving selector intent.

## Stress scenario

The test verifies:

1. a new m bootstrap sees provider v1 environment value `one`;
2. the watch supervisor starts through that bootstrap and therefore retains `one` in its own long-lived environment;
3. the initial one-shot child runs through another fresh bootstrap and observes `one`;
4. provider package default changes to v2 while the supervisor remains alive;
5. the supervisor's own inherited environment remains `one`;
6. the next trigger poll, started through a fresh bootstrap, observes environment identity `two` and changes the digest;
7. exactly one new lifecycle cycle starts;
8. that one-shot cycle also starts through a fresh bootstrap and observes `two`;
9. a direct new m bootstrap after the transition independently reports `two`;
10. no in-process environment mutation or package resolver duplication is required.

## Result sought

A successful experiment would establish this watch-session process invariant:

```text
session control may be long-lived
but trigger resolution and lifecycle execution are fresh-bootstrap operations
```

This would allow polling cadence and future optional notification backends to remain session implementation details while package/environment semantics remain owned by m/pkg.

The experiment does not yet select public `mk --watch` syntax or polling interval.
