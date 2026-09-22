# PoC 018 — mk declarative facility requirements

Status: Experiment completed; resulting baseline promoted
Date: 2026-09-22

## Question

Can `mk` model external build/runtime requirements declaratively without creating a second package/provider resolver, while preserving the current iterative lifecycle model?

The concrete stress case is a build operation that needs a provider-independent `pkg` facility such as Java.

## Current package boundary

The current package contract already owns:

- facility identity;
- compatibility constraints;
- provider conformance;
- system facility defaults;
- provider selection;
- package/provider installation state.

A project is not a package consumer. Therefore the PoC rejects creating a synthetic package-consumer identity merely to reuse package bindings.

The existing package model already establishes a precedent for global non-package consumption: `srv` uses the system facility default when no package consumer identity exists.

The promoted baseline therefore resolves an `mk` facility requirement against the **system facility default**, not a project-specific package binding.

Resolution is a query only. It does not install providers, create defaults/bindings or silently choose among installed providers.

## Promoted mk model

The PoC established named requirement definitions that were subsequently promoted:

```json
{
  "requirements": {
    "jdk": {
      "type": "facility",
      "facility": "java",
      "constraints": [">=21", "<26"]
    }
  }
}
```

Operations and trusted providers refer to named requirements:

```json
{
  "operations": {
    "compile": {
      "requirements": ["jdk"],
      "action": {
        "type": "process",
        "command": "javac"
      }
    }
  }
}
```

A requirement is not an operation, prerequisite or project dependency.

## Reachability and refinement

Only requirements referenced by lifecycle nodes reachable from the requested goals are resolved.

An immediately unsatisfied requirement is represented as current plan state. It does not make `--plan` execute, install or configure anything.

During execution:

```text
resolve reachable lifecycle
→ query reachable requirements
→ execute ready work
→ observe external/current state again
→ refine
```

A lifecycle node is not ready while one of its requirements is unsatisfied.

This deliberately permits a real prerequisite to change external state before a later requirement check. The requirement is re-resolved on the next refinement pass rather than frozen permanently before all lifecycle work.

If no executable work remains and a required reachable facility is still unsatisfied, execution fails before the guarded operation/provider action runs.

## Provider requirements

Requirements are supported on both ordinary operations and trusted providers.

This is necessary for cases such as a `map-process` compiler provider: the provider itself may require a compiler/runtime facility before its derived work can execute.

The product implementation may propagate provider requirements to derived operations internally, but that propagation is implementation detail; the declarative requirement remains attached to the provider.

## Required pkg query boundary

The existing public `pkg_dependency_resolve` API is package-consumer-oriented and therefore is not the correct direct API for a project.

The promoted product adds a small package-owned query that composes the existing facility/default/constraint semantics without creating new selection policy.

The promoted public command surface is:

```text
pkg requirement resolve <facility> <constraint>...
```

Promoted behavior:

- resolve the configured system facility default using normal package-class/osarch semantics;
- validate that the selected installed concrete declares the requested facility and satisfies every compatibility constraint;
- print the selected concrete provider identity on success;
- return status 1 when the requirement is not currently satisfiable;
- return status 2 for invalid invocation/syntax;
- perform no installation, provider selection, binding mutation or projection mutation.

The implementation reuses the current package facility/dependency/provider libraries. `mk` consumes only the public query and does not duplicate constraint parsing or provider-selection logic.

The `requirement` term already exists in the current package and mk conceptual models; this query is a public resolution surface over existing package semantics, not a second requirement/provider abstraction.

## Environment/application boundary

A facility default already publishes its `cmd` surface globally and contributes its `env` projection to each new `m` bootstrap.

Therefore the first `mk` facility-requirement baseline does not introduce another facility projection mechanism. A newly invoked `mk` process consumes the bootstrap-visible global facility environment/commands and uses the package query only to validate declared compatibility.

As elsewhere in the current package model, already-running processes are not retroactively mutated if provider configuration changes concurrently.

## Stress scenarios

`tests/run.js` verifies:

1. a goal that cannot reach a requirement does not query it;
2. `--plan` reports a reachable unsatisfied requirement without executing actions;
3. the consuming operation is blocked while its requirement is unsatisfied;
4. a prerequisite can change external state and the requirement is re-resolved on the next refinement pass;
5. a trusted provider can carry a requirement and becomes executable after a prerequisite makes it satisfiable;
6. a permanently unsatisfied requirement fails execution before the consuming action runs.

The PoC passes locally with Node.js 22.16.0.

## Result

The experiment supports a minimal general model:

```text
mk requirement definition
    facility identity + pkg compatibility constraints

reachable operation/provider
    → named requirements

mk resolver
    → package-owned read-only requirement query

pkg
    → system facility default
    → installed provider resolution
    → facility/compatibility validation

satisfied
    → lifecycle node may become ready

unsatisfied
    → plan remains inspectable
    → execution may refine
    → final unresolved requirement fails
```

No new provider graph, project-specific package binding or auto-install policy is required.

## Scope limit

This PoC does not define:

- automatic provider/package installation;
- automatic provider selection;
- project-specific persistent provider bindings;
- requirements unrelated to `pkg` facilities;
- request-wide cache/fingerprints;
- parallel requirement resolution;
- remote requirements;
- watch/session behavior.

Those concerns remain outside the first facility-requirement baseline.
