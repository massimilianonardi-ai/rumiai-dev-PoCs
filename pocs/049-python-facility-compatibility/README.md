# PoC 049 — Python facility compatibility mapping

Status: Experimental

## Question

Can the existing `pkg` facility compatibility model represent the Python compatibility classes observed in PoC 044 without introducing a second dependency resolver or composing two independently selected interpreter providers for one consumer?

This experiment deliberately uses PoC-only facility names. It tests a shape rather than proposing final public names:

```text
generic Python runtime facility
    suitable for pure-Python consumers

CPython runtime facility
    suitable for CPython-specific consumers
    including abi3 and minor-specific extensions
```

A CPython provider can realize both facilities. An alternate Python implementation can realize only the generic one.

## Why one facility per interpreter requirement

PoC 044 proved that these wheel classes have different compatibility semantics:

```text
py3-none-any
cp38-abi3-<platform>
cp312-cp312-<platform>
```

Modeling "runtime Python" and "CPython ABI" as two simultaneous dependencies would allow `pkg` to select two different provider packages independently. This PoC instead checks whether a consumer can express one atomic interpreter requirement using the existing facility mechanism:

- pure Python -> generic runtime facility range;
- abi3 CPython extension -> CPython facility range;
- CPython-minor extension -> exact CPython facility level.

Platform compatibility remains an orthogonal wheel/osarch selection concern.

## Experiment shape

Two CPython-like provider packages and one alternate-implementation-like provider are integrated into a disposable copy of the current `rumiai-os`:

```text
provider cp312
    generic facility 3.12
    CPython facility 3.12

provider cp313
    generic facility 3.13
    CPython facility 3.13

provider alternate313
    generic facility 3.13 only
```

Every exposed Python command is reached through the provider's normal `facility-cmd/<facility>/python` projection. Consumer commands use `#!/usr/bin/env python`.

The experiment proves:

1. a pure consumer with `>=3.12 <3.14` can switch from the CPython-like provider to the alternate provider;
2. an abi3-like consumer with a CPython range can switch from 3.12 to 3.13;
3. a CPython-3.12-specific consumer with `=3.12` cannot execute with the 3.13 CPython provider;
4. a CPython-specific consumer cannot execute with a provider that exposes only the generic Python facility;
5. removing a binding restores normal facility-default inheritance.

The provider-binding command may reject an incompatible selector immediately or may accept the selector as configuration and let dependency resolution reject it at launch. Either behavior is acceptable for this PoC; the required invariant is that an incompatible provider never executes the consumer.

## Scope

A PASS establishes that the existing facility/dependency primitives are expressive enough for the tested compatibility shape.

It does not choose the final facility names, define the final Python facility contracts, or prove that catalog authors can derive all required constraints automatically from arbitrary Python package metadata.
