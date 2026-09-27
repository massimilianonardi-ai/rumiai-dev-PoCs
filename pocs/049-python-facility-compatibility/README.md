# PoC 049 — Python facility compatibility mapping

Status: Experimental

## Question

Can the existing `pkg` facility compatibility model represent the CPython compatibility classes observed in PoC 044 without introducing another dependency resolver or a second independently selected interpreter facility?

The revised experiment uses one PoC-only Python runtime facility. Its compatibility level is the CPython major/minor runtime level:

```text
provider CPython 3.12 -> facility compatibility 3.12
provider CPython 3.13 -> facility compatibility 3.13
```

Consumers then use the existing dependency constraint language:

```text
pure-Python-like consumer
    >=3.12 <3.14

abi3-like CPython consumer
    >=3.8 <3.14

cp312-specific consumer
    =3.12
```

Every provider exposes the same facility command:

```text
python
```

and every consumer command keeps:

```sh
#!/usr/bin/env python
```

## Why the experiment was revised

The first PoC 049 revision deliberately tested a two-facility model:

```text
generic Python runtime facility
CPython-specific facility
```

with the same CPython provider realizing both and both facilities exposing a command named `python`.

Hosted run `36303903347` reached provider-default configuration on both Linux and macOS and then failed when the second facility default was set. The current `pkg` global facility-command projection correctly prevents two independent facility defaults from owning the same public `python` command.

That is useful negative evidence: splitting one interpreter identity across two independently selected facilities is not a clean fit for the current model and would also create a coherence problem if their selectors diverged.

The revised experiment therefore tests the smallest current requirement: interchangeable **CPython** providers under one facility. Supporting another Python implementation in the future is deliberately not predesigned by this task.

## Experiment shape

Two CPython-like provider packages are integrated into a disposable copy of the current `rumiai-os`:

```text
provider cp312
    Python facility 3.12

provider cp313
    Python facility 3.13
```

The experiment proves:

1. a pure-Python-like consumer can inherit 3.12, bind to 3.13 without reinstalling, then return to the default;
2. an abi3-like consumer can do the same across the tested CPython minor levels;
3. a cp312-specific consumer cannot execute under the 3.13 provider;
4. changing the facility default to 3.13 is observed by compatible unbound consumers, while the incompatible exact-3.12 consumer is rejected before its target executes;
5. restoring the facility default to 3.12 restores the exact consumer without rewriting it.

The provider-binding command may reject an incompatible selector immediately or may accept it as configuration and let dependency resolution reject it at launch. Either behavior is acceptable for this PoC; the required invariant is that an incompatible provider never executes the consumer.

## Scope

A PASS establishes that the existing facility/dependency compatibility primitives are expressive enough for the tested **CPython minor-version** compatibility classes.

It does not choose the final public facility name, define the complete Python facility contract, solve cross-implementation compatibility, or prove that arbitrary Python package metadata can always be converted automatically into the correct facility constraint.
