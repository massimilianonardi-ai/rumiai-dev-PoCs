# PoC 022 — shared operation input identity

Status: Active experiment
Date: 2026-09-23

## Question

Can operation input identity be separated from incremental freshness policy so the same declaration can drive both:

- one-shot incremental fingerprints; and
- long-running watch trigger derivation,

including for operations that are intentionally **not** incrementally reusable?

The current promoted contract nests input identity under:

```text
operation.incremental.inputs
```

That is sufficient for incremental caching but leaves a gap for watch-only change identity on non-incremental operations.

## Candidate model

Introduce a first-class operation-level input map:

```json
{
  "inputs": {
    "source": {"path": "src/input.txt"}
  },
  "incremental": {}
}
```

The input grammar remains exactly the current incremental input grammar:

```json
{"path": "relative/or/absolute/path"}
{"collection": "collection-name"}
{"output": {"operation": "producer", "name": "artifact"}}
```

The semantic split is:

```text
inputs
    operation data/change identity

incremental
    opt-in reusable freshness policy
```

A non-incremental operation may therefore declare:

```json
{
  "inputs": {
    "source": {"path": "opaque.txt"}
  },
  "action": {
    "type": "process",
    "command": "sh",
    "args": ["-c", "cat opaque.txt > out"]
  }
}
```

Such an operation still executes normally whenever a one-shot request reaches it, but a watch trigger resolver has authoritative declared change identity.

## Compatibility with the current contract

The already-promoted form must remain valid:

```json
{
  "incremental": {
    "inputs": {
      "source": {"path": "src/input.txt"}
    }
  }
}
```

The PoC tests a compatibility normalization:

```text
legacy incremental.inputs
    -> normalized operation.inputs
    -> incremental enabled

new operation.inputs + incremental {}
    -> same normalized operation.inputs
    -> incremental enabled

operation.inputs without incremental
    -> normalized operation.inputs
    -> incremental disabled
```

If both `operation.inputs` and non-empty `incremental.inputs` are declared, the configuration is rejected as ambiguous rather than inventing merge precedence.

An empty legacy `incremental.inputs` remains equivalent to an incremental operation with no varying declared file/data inputs.

## Data dependency semantics

Input identity should not change meaning depending on whether incremental reuse is enabled.

Therefore:

- an output input creates a data dependency on the producer;
- a collection input makes the collection relation part of operation reachability;
- a path input contributes identity but creates no operation ordering relation by itself.

These are the same relations already implemented for current incremental inputs.

## Alternative considered: watch.inputs

A separate watch-only surface such as:

```json
{
  "incremental": {
    "inputs": {
      "source": {"path": "src/input.txt"}
    }
  },
  "watch": {
    "inputs": {
      "source": {"path": "src/input.txt"}
    }
  }
}
```

would duplicate the same semantic declaration for an operation that is both incremental and watchable.

An inheritance rule such as “watch.inputs defaults to incremental.inputs” reduces duplication only for some cases and creates two input namespaces plus precedence/override rules.

PoC 022 therefore treats the shared operation-level map as the simpler candidate unless runtime behavior exposes a reason to keep separate identities.

## What this does not imply

First-class inputs do **not** make every operation incremental.

They also do not mean that an action is pure or deterministic. They only declare data/change relations the lifecycle engine may use for dependency resolution, incremental identity when enabled, and watch trigger identity.

The existing incremental correctness rule remains: reusable freshness is valid only if every mutable influence on an incrementally cached action is represented by declared inputs, effective environment, executable identity and requirements.

## Stress scenarios

The executable candidate normalizer verifies:

1. current legacy `incremental.inputs` remains accepted;
2. the equivalent new `inputs` + `incremental: {}` form normalizes identically;
3. first-class `inputs` is valid without incremental reuse;
4. an output input creates the same data dependency in both incremental and non-incremental cases;
5. collection inputs remain ordinary shared input identity;
6. duplicate declarations across `inputs` and `incremental.inputs` are rejected;
7. empty legacy incremental inputs remain valid;
8. a separate `watch.inputs` design requires duplicated input identity for the common incremental+watch case.

## Scope limit

The PoC does not yet modify the current `mk` parser or specification.

Before promotion it must still be checked against the real current resolver so that extracting input ownership does not alter:

- incremental cache compatibility;
- current data-dependency behavior;
- plan/refinement semantics;
- version-2 profile replacement;
- permanent tests.
