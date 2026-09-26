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
