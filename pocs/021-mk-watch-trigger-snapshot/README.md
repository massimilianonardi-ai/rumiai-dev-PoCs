# PoC 021 — mk internal watch trigger snapshot

Status: Active experiment
Date: 2026-09-23

## Question

Can a deterministic watch trigger snapshot be derived **inside the existing mk engine** by reusing current version-2 resolution and incremental fingerprint machinery, instead of creating a second filesystem/config resolver in a watch wrapper?

## Experiment boundary

The PoC does not copy the lifecycle resolver.

It loads the current target `lib/sys/js/mk.lib.js` and, only inside the experiment, instruments that exact source at runtime to expose selected internal functions:

```text
_loadProjectConfig
_selectModel
_validateReferences
_resolveV2
_publicPlan
_sha256
```

This is deliberately an experimental inspection technique, not a product API proposal.

The trigger snapshot is then derived from:

```text
canonical project root
+ requested goals/profile
+ selected normalized project model
+ current public resolved plan
+ current reachable incremental operation fingerprints
```

and serialized/digested by the product's current deterministic SHA-256 helper.

The goal is to determine whether existing mk resolution already contains enough authoritative evidence for watch triggering.

## Expected properties

For a local project whose mutable influences are represented by current declarative lifecycle surfaces, the trigger digest should:

- remain stable across mtime-only changes;
- change when declared incremental input content changes;
- change when a declared output is modified/deleted and therefore the producer ceases to be up-to-date;
- change when the executable identity participating in an incremental fingerprint changes;
- change when observable state used by a reachable condition changes;
- remain based on the same selected model/resolution semantics as one-shot mk.

A semantically equivalent formatting-only rewrite of `mk.json` should not need to trigger merely because raw JSON bytes changed; the selected normalized model is the identity input.

## Important limitation under test

An ordinary non-incremental process operation may still depend on mutable external/project state that is not declared in any current mk input/condition/requirement surface.

For example:

```json
{
  "action": {
    "type": "process",
    "command": "sh",
    "args": ["-c", "cat opaque.txt > out"]
  }
}
```

Changing `opaque.txt` is intentionally invisible to the current declarative model.

If the trigger digest also remains unchanged, that is not a bug in the snapshot algorithm: it proves that a watch contract cannot safely infer undeclared mutable dependencies.

The product design must therefore choose one of these general directions before promotion:

- watch is supported only when all relevant change-driving influences are represented by existing declarative inputs/conditions/requirements; or
- introduce an explicit additional watch-trigger declaration for influences that are intentionally non-incremental.

The PoC does not select that policy yet.

## Relationship to PoC 020

PoC 020 validated:

```text
thin long-running supervisor
    -> opaque trigger snapshot
    -> fresh one-shot mk request
```

PoC 021 tests whether the opaque snapshot can be produced by the existing trusted engine.

If successful, the combined architecture is:

```text
mk engine
    resolves authoritative trigger identity
        |
        v
opaque deterministic digest

thin watch supervisor
    compares digest
    runs fresh one-shot mk request on change
```

No second lifecycle graph resolver is required.

## Stress scenarios

The test uses the real current `mk.lib.js` implementation and verifies:

1. stable snapshot for an unchanged post-build project;
2. mtime-only source change does not alter the digest;
3. declared incremental input content change alters the digest;
4. one-shot rebuild establishes a new stable digest;
5. declared-output tampering alters the digest;
6. executable-content change alters the digest;
7. reachable condition-state change alters the digest;
8. formatting-only `mk.json` rewrite leaves selected-model digest stable;
9. undeclared mutable input of a non-incremental operation remains invisible, demonstrating the unresolved contract gap.

## Scope limit

The PoC does not define:

- public watch CLI/schema;
- recursive project-dependency watch snapshots;
- provider-level incremental templates;
- host filesystem notification backends;
- polling interval policy;
- handling of transient invalid project configuration;
- final eligibility rules for watchable non-incremental operations.
