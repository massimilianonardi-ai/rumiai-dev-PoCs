# PoC 016 — mk runtime refinement model

Status: Experiment completed locally
Date: 2026-09-22

## Question

What is the smallest general model that lets `mk` combine facts derivable from the current project context with facts that become authoritative only after earlier operations execute, while preserving declarative `mk.json` and avoiding language/tool hard-coding in the planner?

The experiment specifically stress-tests:

- filesystem-derived collections whose current members are known before execution;
- generated-source collections that are intentionally unresolved until a generator operation succeeds;
- a trusted provider boundary that derives ordinary operations from collection members;
- conditions depending on operation result, declared output and observable project state;
- plan inspection that preserves unresolved alternatives without running project operations;
- repeated runtime resolution after an operation changes available evidence;
- compatibility with the existing static version-1 model.

## Candidate model

The candidate uses a version-2 descriptor so the existing version-1 contract remains unchanged.

```text
collection
    declarative selection whose current value is resolved from trusted context

provider
    trusted mk implementation selected by declarative type; produces derived ordinary operations

when
    declarative operation guard over result/output/state operands

output
    named pathname produced by an operation and observable after that operation succeeds

failure: continue
    make an executed non-zero result available to later conditions instead of aborting immediately
```

The first provider used by the experiment is deliberately generic:

```text
map-process
```

It maps each member of one file collection to one ordinary shell-free process operation and substitutes only the selected item value. It contains no C++, Maven, compiler or other tool-specific semantics.

A file collection may declare an `after` barrier. Until all named operations/providers have completed successfully, the collection is represented as pending rather than scanning a possibly stale output directory. This is the generated-source bridge.

## Runtime model

The experiment exercises:

```text
resolve reachable context
→ expose ready concrete work + pending/conditional structure
→ execute one ready operation
→ record result
→ resolve/refine reachable context again
→ continue
```

Only dynamic definitions reachable from the requested goals are resolved. An unrelated collection is therefore not scanned merely because it exists in `mk.json`.

## Plan model

For version 2, the candidate plan is structured JSON rather than a linear list. It contains the currently relevant:

```text
collections
providers
operations
```

Resolved collections/providers expose their current items. Generated collections/providers can remain `pending` with `waitingFor`. Guarded operations whose evidence is not available remain `conditional`; both complementary alternatives can therefore be visible in the same plan.

Version 1 keeps the existing line-oriented plan output for compatibility.

## Stress scenarios

`tests/run.sh` expects the path to a candidate `mk.lib.js` and exercises the candidate engine directly. It is an architectural experiment, not permanent product validation.

The scenario verifies:

1. a version-1 static prerequisite plan remains unchanged;
2. an initial source directory is discovered during `--plan` without file enumeration in JSON;
3. a generated source collection remains pending behind `generate` and `--plan` creates no generated files;
4. execution runs `generate`, re-resolves, derives operations for the new files and completes the downstream aggregate;
5. complementary `<100` / `>=100` branches are both preserved before a declared output exists, then the correct branch is selected after the output is produced;
6. a failed operation declared `failure: continue` exposes its non-zero result and selects a fallback branch;
7. state-existence guards select complementary branches from current observable state;
8. a profile can replace a default discovered collection with an explicit subset.

## Result

The candidate model passes all scenarios in the available auxiliary Linux environment using Node.js 22.16.0.

This establishes that one small resolution loop can cover both immediately derivable filesystem membership and later evidence from generated outputs/results/state without turning `mk.json` into executable JavaScript.

It also narrows the trusted extension boundary: project configuration selects a provider type and provider data, but it does not name or embed arbitrary executable resolver modules. Provider implementation remains trusted runtime code. The experiment does not yet require a public plugin-registration API; the first generic provider is sufficient to prove the boundary and generated-source refinement.

## Scope limit

This PoC does not establish incremental fingerprints, cache, parallel scheduling, project-dependency execution, requirement-to-`pkg` resolution, watch/hot-update semantics or a native C++ builder contract. Those remain separate lifecycle questions.
