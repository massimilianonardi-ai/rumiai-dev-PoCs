# PoC 024 — recursive watch trigger ownership

Status: Experiment in progress
Date: 2026-09-23

## Question

Can watch-trigger identity preserve the existing project-dependency ownership boundary by composing opaque child-project trigger digests recursively, instead of flattening dependent-project lifecycle/input identity into the parent?

The stress cases are:

```text
A -> B -> C
A -> B/C -> D
```

The experiment keeps watch itself unpromoted. It tests only recursive trigger ownership.

## Hypothesis

The same ownership rule already used by project dependency execution should also apply to watch-trigger identity:

```text
project A
    local authoritative trigger digest
    + active dependency descriptors
        B request -> opaque B digest
        C request -> opaque C digest
    -> A digest
```

Each child owns resolution of its own model, inputs, collections, requirements, executable/output evidence and further dependencies.

The parent consumes only:

```text
dependency name
canonical child project
requested child goals
optional explicit child profile
opaque child trigger digest
```

It does **not** import the child's operations, collections, inputs, requirements or incremental fingerprints.

This mirrors current one-shot dependency delegation and avoids creating a global multi-project resolver merely for watch.

## Local trigger identity

For one project/request, the experiment derives a local digest from the current trusted `mk` resolver using:

- canonical project root;
- requested goals and selected profile;
- selected normalized model;
- current public **local** plan with project dependencies excluded from that local plan value;
- resolved shared operation input snapshots;
- incremental fingerprints.

This extends the PoC 021 technique to the now-promoted first-class operation `inputs` model. Non-incremental declared inputs therefore participate in change identity without enabling incremental reuse.

The experiment instruments the real current `lib/sys/js/mk.lib.js` in memory only to expose existing internal functions. It does not copy the lifecycle resolver and does not modify `rumiai-os`.

## Recursive composition

For each active direct dependency, the experiment recursively requests the child's trigger digest using exactly the mapped child goals and optional explicit child profile.

The parent digest input contains a dependency entry shaped experimentally as:

```text
{name, project, goals, profile, digest}
```

No child plan or child operation/input graph is embedded.

Cycle detection uses canonical project roots in the active recursive chain, matching the current project-dependency identity boundary.

No request-wide de-duplication is introduced. In a diamond, both sibling branches independently request and resolve the shared downstream project.

## Experiment observability

The experimental command prints JSON containing:

- the root digest;
- the root direct dependency digest descriptors;
- an instrumentation-only `visits` list showing every project request resolved recursively.

`visits` exists only so the PoC can prove diamond behavior. It is not part of digest identity and is not a proposed product surface.

## Stress scenarios

`tests/run.js` verifies:

1. unchanged recursive snapshot is stable;
2. mtime-only change in a deep child input is stable because input identity is content based;
3. changing C input changes C, B and A trigger digests;
4. changing B input changes B and A but leaves C unchanged;
5. changing A input changes only A;
6. formatting-only rewrite of child `mk.json` leaves the recursive digest stable;
7. an inactive child dependency is not part of the requested goal's trigger identity;
8. explicit child profile selection participates through the child's selected normalized model;
9. in `A -> B/C -> D`, D is resolved independently once per sibling branch and its input change propagates through both branch digests to A;
10. same-named operations across projects do not collide because child identity is scoped behind the child digest;
11. `A -> B -> A` is rejected as a recursive project-dependency cycle.

## Promotion gate

A successful result would support this working direction:

```text
watch supervisor
    asks root mk engine for trigger digest

root mk trigger resolver
    owns root local identity
    recursively asks each active child for opaque child digest

child
    owns its complete trigger semantics recursively
```

It would **not** yet settle:

- public `--watch` CLI/session behavior;
- transient invalid `mk.json` handling during a live session;
- polling interval policy or filesystem-notification adapters;
- cycle failure/retry options;
- remote execution;
- request-wide exactly-once/de-duplication.

Those remain separate questions.
