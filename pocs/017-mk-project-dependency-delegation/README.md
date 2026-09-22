# PoC 017 — recursive mk project dependency delegation

Status: Experiment completed locally
Date: 2026-09-22

## Question

Can `mk` keep project-to-project dependency orchestration small by delegating each dependent project's lifecycle request to another `mk` instance, instead of importing or flattening the dependent project's internal operation graph into the parent planner?

The experiment intentionally isolates this question from the existing operation/provider/runtime-refinement implementation. It does not modify `rumiai-os` and does not promote a schema contract.

## Candidate semantic model

A project dependency remains a first-class project-to-project relation. It is not represented as a fake local operation or an ordinary process action.

The candidate descriptor used by this PoC is deliberately provisional:

```json
{
  "version": 2,
  "goals": {
    "build": [],
    "check": []
  },
  "dependencies": {
    "core": {
      "project": "../core",
      "goals": {
        "build": ["compile"],
        "check": ["verify"]
      }
    }
  }
}
```

The important semantic property is not the exact field spelling. It is the explicit mapping:

```text
requested parent goal(s)
    ↓
project dependency relation
    ↓
requested child goal(s)
    ↓
new mk instance rooted at the child project
```

The child `mk` instance owns all details of the child lifecycle. The parent does not inspect or merge child operations, providers, collections or conditions.

## Delegation protocol exercised

For execution:

```text
mk(A, parent-goals)
→ derive child goal request for B
→ invoke mk(B, child-goals)
→ B recursively resolves its own dependencies
→ child success/failure returns across the process boundary
→ A continues its own lifecycle
```

For plan inspection:

```text
mk(A, --plan, parent-goals)
→ invoke mk(B, --plan, child-goals)
→ return B's plan as a nested project plan
→ do not execute lifecycle work
```

The experiment keeps project boundaries visible instead of flattening child operations into the parent plan.

## Goal aggregation

When one parent request contains multiple goals that map to the same dependent project, the child goals are unioned into one child request while preserving first occurrence order.

Example:

```text
A: build + check
    ↓
B: compile + verify
```

This avoids invoking the same direct dependency once per requested parent goal.

## Profile behavior

The candidate baseline does **not** inherit the parent profile implicitly across a project boundary.

A dependency may explicitly select a child profile. Therefore:

```text
parent profile
    ≠ implicit child profile

explicit dependency profile
    → child profile
```

This keeps project configuration ownership local to each project and avoids accidental coupling between identically named profiles in unrelated projects.

## Cycle detection

Recursive delegation requires a small invocation context containing the canonical project roots already present in the active dependency chain.

The PoC propagates this chain to child `mk` processes and rejects:

```text
A → B → A
```

before recursion can continue indefinitely.

This is coordination metadata only; it does not require importing the child lifecycle graph.

## Stress scenarios

`tests/run.js` executes the experimental `candidate-mk.js` and verifies:

1. `A → B → C` recursively delegates lifecycle requests;
2. dependent projects execute before the parent project continues;
3. two requested parent goals mapping to the same direct dependency produce one child invocation with the union of required child goals;
4. a parent profile is not implicitly inherited by child or grandchild projects;
5. an explicitly configured dependency profile is passed to the child;
6. `--plan` returns a nested project plan and performs no execution;
7. `A → B → A` is rejected as a project dependency cycle;
8. a child request failure propagates as parent failure.

The experiment passes locally with Node.js 22.16.0.

## Result

The recursive delegation approach is sufficient for the tested baseline and keeps the multi-project extension conceptually small:

```text
project dependency declaration
+ parent-goal → child-goal mapping
+ optional explicit child profile
+ recursive mk invocation
+ invocation-chain cycle detection
+ nested plan/result propagation
```

No global multi-project operation graph is required for these cases.

The experiment therefore supports continuing with a design in which project dependency orchestration is implemented by `mk` delegating the dependent lifecycle request to another `mk` instance, while keeping `dependency`, `prerequisite` and `process action` semantically distinct.

## Open boundary exposed by the PoC

Recursive process delegation by itself does not provide global de-duplication across sibling branches of a diamond dependency graph:

```text
    A
   / \
  B   C
   \ /
    D
```

If both `B` and `C` independently request `D`, separate child process trees can request `D` twice. The current experiment deliberately does not add shared-session coordination, locking, cache or incremental semantics merely to solve that future case.

Before product promotion, the task should decide whether the first project-dependency contract:

- permits independent repeated lifecycle requests across sibling branches; or
- requires request-wide project/goal de-duplication and therefore a shared invocation/session context.

This is the main remaining semantic question exposed by PoC 017.

## Scope limit

This PoC does not define:

- the final `mk.json` field names;
- remote project discovery/fetching;
- requirement-to-`pkg` resolution;
- incremental fingerprints/cache;
- parallel project scheduling;
- remote execution;
- watch/hot-update sessions;
- request-wide diamond de-duplication.

Those concerns should not be pulled into the first recursive project-dependency implementation unless the current contract requires them.
