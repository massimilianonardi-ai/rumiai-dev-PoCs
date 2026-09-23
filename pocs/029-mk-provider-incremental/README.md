# PoC 029 — provider-level incremental templates

Status: Experiment in progress
Date: 2026-09-23

## Question

Can a trusted `map-process` provider derive ordinary incrementally reusable operations by reusing the existing operation `inputs` / `outputs` / `incremental` machinery, without introducing a second provider cache model?

The current promoted baseline deliberately limits incremental freshness to ordinary configured operations. The concrete gap is a provider that maps a source collection to many structurally identical compiler/process operations.

## Candidate model

The experiment extends only the trusted `map-process` provider declaration:

```json
{
  "type": "map-process",
  "collection": "sources",
  "inputs": {
    "config": {"path": "build.conf"}
  },
  "outputs": {
    "artifact": {"path": "out/${item}.out"}
  },
  "incremental": {},
  "action": {
    "type": "process",
    "command": "tool",
    "args": ["${item}", "out/${item}.out"]
  }
}
```

Existing `prerequisites`, `requirements` and `action` remain unchanged.

The candidate deliberately does **not** add a provider-level cache record. For each collection item the trusted provider derives an ordinary operation with:

- the current stable derived operation name (provider name + item-derived token);
- provider prerequisites and requirements;
- the substituted process action;
- provider-declared shared inputs;
- provider-declared outputs with `${item}` substitution in output paths;
- ordinary incremental eligibility when `incremental: {}` is present.

The derived item pathname is automatically injected as a private derived input named:

```text
$item
```

This name is not a project-configurable input name because project-defined names use the controlled-name grammar. It prevents the project from duplicating the fact already established by the provider's source collection:

```text
map this collection item
    -> that item content is inherently an input of the derived operation
```

## Reuse of ordinary semantics

No new fingerprint/cache algorithm is introduced.

Each derived member uses the existing ordinary operation machinery for:

- path/content snapshots;
- executable/effective-environment identity;
- requirement-provider identity;
- output validation;
- freshness record path;
- `up-to-date` state;
- successful-record refresh and conservative miss behavior.

The existing provider aggregate semantics remain unchanged because an `up-to-date` derived operation already satisfies `_satisfied`.

## Template substitution boundary

The candidate uses `${item}` only where the current provider already has a trusted substitution concept or where a pathname template naturally extends it:

- process command/args/cwd/env: existing behavior;
- provider input of type `path`: substitute `${item}`;
- declared output `path`: substitute `${item}`.

Collection input names and output-input operation/name references remain ordinary literal lifecycle references. The PoC does not invent expression evaluation or derived-operation-name interpolation.

Provider-level `incremental` is introduced directly in preferred current form:

```json
"incremental": {}
```

The historical ordinary-operation compatibility form `incremental.inputs` is not copied into this new provider surface.

## Stable identity

Current derived operation identity is already based on provider name plus the item pathname token, not collection enumeration position.

Therefore:

- changing collection enumeration order must not invalidate unchanged members;
- adding one member should create one new derived operation without invalidating unchanged members;
- removing a member simply makes that derived operation unreachable in the current request;
- stale non-authoritative freshness records for removed members are harmless and may remain;
- output cleanup for removed collection members is a separate artifact-cleaning concern and is not implied by incremental freshness.

## Stress scenarios

`tests/run.js` exercises the transformed real current `mk.lib.js` and verifies:

1. first provider execution runs every derived member;
2. the next identical request resolves every member `up-to-date` and executes none;
3. mtime-only source change does not invalidate a member;
4. changing one source file reruns only that derived member;
5. changing a provider-declared common path input reruns all members;
6. tampering one declared derived output reruns only that member;
7. adding one collection item runs only the new member;
8. removing a collection item does not invalidate unchanged reachable members;
9. reversing explicit collection include order does not change per-item cache identity;
10. a provider declaring `incremental: {}` without outputs is rejected;
11. provider aggregate completion accepts a mix/all set of `up-to-date` members without adding provider-level cache semantics.

## Experiment method

The PoC loads the exact current `rumiai-os/lib/sys/js/mk.lib.js` and applies a narrow in-memory source transformation only to provider normalization and derived-operation construction.

It does not copy the resolver, incremental engine, cache code or executor.

No product repository modification is made by this experiment.

## Promotion gate

A successful result would support promoting the smallest provider extension:

```text
map-process provider template
    + ordinary shared inputs
    + ordinary declared outputs
    + incremental opt-in

trusted derivation
    -> ordinary derived incremental operations
```

It would not establish:

- provider-level aggregate cache records;
- artifact storage/restoration;
- output cleanup for removed collection items;
- parallel execution;
- remote execution;
- public provider/plugin registration.
