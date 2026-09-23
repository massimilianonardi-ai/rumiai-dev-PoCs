# PoC 025 — watch session transient invalid configuration

Status: Experiment completed; transient-invalid policy validated
Date: 2026-09-23

## Question

How should an established long-running `mk` watch session behave while a root or dependent-project `mk.json` is temporarily invalid during an edit?

The key distinction under test is:

```text
configuration temporarily not resolvable
    -> keep the session alive
    -> retain the last valid trigger baseline
    -> do not run a lifecycle cycle
    -> retry trigger resolution

fatal trigger resolver failure
    -> terminate the watch session
```

The experiment keeps the public watch CLI/schema unselected.

## Why the distinction belongs inside mk

An outer watch supervisor must not parse `mk.json` or reconstruct project/dependency semantics merely to decide whether an error is temporary.

The experimental trigger resolver therefore classifies failures at the trusted mk boundary:

- load/normalize/reference-validation failure of a root or recursively active child configuration is reported as an experimental **temporary configuration** outcome;
- failures after valid configuration has entered normal trigger/lifecycle resolution remain fatal.

The concrete process exit status used by this PoC is test-only and is not a proposed product contract.

## Session policy under test

A watch session first requires one valid trigger snapshot before launching its initial one-shot request.

This gives a meaningful startup rule:

```text
invalid configuration at startup
    -> wait
valid configuration appears
    -> run initial one-shot request
    -> establish post-cycle valid trigger baseline
```

After startup:

```text
valid baseline
-> poll trigger

temporary invalid configuration
-> report unavailable state once
-> retain last valid baseline
-> keep polling

valid configuration returns
-> if digest == last valid baseline: no lifecycle cycle
-> if digest != last valid baseline: run one fresh lifecycle cycle
-> establish a new post-cycle valid baseline
```

A lifecycle cycle never starts from an invalid trigger snapshot.

This preserves the PoC 020 post-cycle-baseline rule: effects produced by a cycle are absorbed by a fresh valid baseline instead of immediately self-triggering another cycle.

## Recursive behavior

The trigger resolver uses the PoC 024 recursive ownership model:

```text
parent local trigger identity
+ opaque digests of active direct child requests
-> parent digest
```

Therefore a temporarily invalid child configuration makes the root trigger temporarily unavailable without flattening or parsing the child in the supervisor.

When that child becomes valid again:

- restoring the same normalized semantics produces the previous digest and no cycle;
- restoring a changed valid child/input identity produces a new root digest and exactly one cycle.

## Experiment interface

The supervisor consumes two external commands:

```text
RUMIAI_POC_WATCH_SNAPSHOT
RUMIAI_POC_WATCH_RUN
```

The snapshot command experimentally returns:

```text
0   valid digest
10  temporary configuration-unavailable state
other non-zero
    fatal trigger-resolution failure
```

Status 10 is an experiment mechanism only.

The trigger resolver also accepts the test-only environment variable
`RUMIAI_POC_TRIGGER_FATAL_FILE` to force a fatal resolver outcome so the
supervisor policy can distinguish it from invalid configuration.

## Stress scenarios

`tests/run.js` verifies:

1. invalid root configuration at session startup does not run a lifecycle cycle and does not terminate the supervisor;
2. once startup configuration becomes valid, the initial lifecycle cycle runs exactly once;
3. temporarily invalid active child configuration keeps the established session alive and does not run work;
4. restoring the exact previous child semantics produces no cycle;
5. changing a declared child input while the child configuration is invalid causes exactly one cycle when valid configuration returns;
6. temporarily invalid root configuration behaves the same way;
7. restoring an unchanged root configuration produces no cycle;
8. a later valid root input change produces exactly one cycle;
9. repeated polling during one invalid interval does not produce a lifecycle busy loop;
10. a fatal trigger resolver failure still terminates the session;
11. recursive trigger ownership remains opaque to the supervisor.

## Result

The experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35827415176
```

against exact `rumiai-os` revision:

```text
92f0d459225ee4117f3c2cb32aa1b8aa9f17ec90
```

Observed:

```text
PASS PoC 025 watch transient invalid configuration
OBSERVED invalid-config=retry-with-last-valid-baseline
OBSERVED fatal-trigger-error=session-failure
```

The experiment validates a useful separation:

```text
configuration unavailable
    retryable watch state

trigger resolver failure after valid configuration
    fatal watch-session error
```

The session never runs lifecycle work while trigger configuration is invalid. At startup it waits for the first valid trigger snapshot before the initial one-shot request. During an established session it retains the last valid baseline across an invalid interval.

When valid configuration returns:

- unchanged normalized semantics produce the previous digest and no cycle;
- changed declared input/model identity produces a new digest and exactly one cycle.

The behavior works when the transient invalidity is in an active dependent project because the recursive trigger resolver owns child configuration resolution; the outer supervisor sees only the temporary/fatal classification and opaque digest.

The experiment also confirms that temporary configuration errors should not be represented as an ordinary digest value. Doing so would incorrectly turn invalidity itself into a lifecycle-change event.

The temporary hosted workflow was removed after evidence collection.

## Promotion gate

The experiment supports this policy:

```text
configuration-invalid trigger outcome
    retryable inside an already-starting/active watch session

fatal trigger-resolution outcome
    session failure
```

It would not yet define:

- public `--watch` syntax;
- user-facing diagnostic wording/status representation;
- polling interval defaults;
- filesystem notification backends;
- stop/continue policy for failed lifecycle cycles beyond the PoC 020 baseline;
- remote watch execution.
