# PoC 045 — PyPA installer with env-selected Python

Status: Experimental

## Question

Can current PyPA `installer` provide RumiAI's final wheel-materialization boundary without a fork, by specializing only its public destination behavior so POSIX Python commands use:

```sh
#!/usr/bin/env python
```

instead of an absolute interpreter path?

## Pinned upstream

```text
PyPA installer: 1.0.1
upstream main inspected: ba622422bc1c458d8cb82f08085a807cf2146d7a
```

The current public API separates wheel traversal from destination behavior through `WheelDestination`. `SchemeDictionaryDestination` owns file placement, `#!python` rewriting and entry-point script generation.

## Experiment shape

The experiment uses the PoC 038 pure wheel, which contains both:

- a `console_scripts` entry point;
- a wheel `.data/scripts` file beginning with `#!python`.

It compares:

1. stock `SchemeDictionaryDestination` with the current interpreter, which should embed that concrete interpreter;
2. a small subclass that changes only POSIX Python command materialization;
3. execution before and after moving the complete materialized payload;
4. an old-prefix scan after relocation.

The adapter deliberately leaves wheel parsing, file placement, RECORD generation and other installer mechanics to upstream `installer`.

## Scope

A PASS would show that RumiAI does not need to replace pip's resolver/build frontend or fork PyPA `installer` merely to obtain relocatable Python command shebangs.

It would not settle wheel-tag selection, consumer site processing, bytecode ownership or the final package/facility contract.

## Observed result

PASS on GitHub Actions run `36272471386` at PoC revision `a370909b65d01e6d89b6e128761c9bc743e6e65d`, on Ubuntu 24.04 and macOS 14.

On both hosts, stock `SchemeDictionaryDestination` embedded the concrete CPython 3.13 executable into both generated command forms:

```text
console_scripts      -> #!<absolute CPython path>
.data/scripts        -> #!<absolute CPython path>
```

The PoC destination subclass changed only POSIX Python-script materialization and produced:

```text
console_scripts      -> #!/usr/bin/env python
.data/scripts        -> #!/usr/bin/env python
```

The adapted commands executed before and after moving the complete materialized payload, and the relocated payload contained zero references to its original installation prefix.

For rewritten Wheel `#!python`/`#!pythonw` scripts the adapter also ensures the Unix executable bit, matching the Wheel specification's recommended installer behavior for scripts whose archived mode may not already be executable.

The experiment leaves wheel traversal, ordinary file placement, metadata/RECORD generation and wheel structural validation in upstream `installer`. The custom surface is therefore narrow: POSIX Python command generation/rewriting plus executable mode. Wheel compatibility-tag selection remains a separate trusted responsibility, as demonstrated by PoC 044.
