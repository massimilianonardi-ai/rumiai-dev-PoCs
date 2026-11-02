# PoC 073 — runtime-specific shared-library projections

Status: Experimental. Source revision independent of RumiAI `m` runtime.

## Question

Can already-installed, version-specific shared libraries be exposed through
reusable symbolic-link directories and selected through the language runtime's
existing search-path mechanism without copying payloads or rewriting links on
each `context` invocation?

## Java experiment

`tests/java-classpath.sh` compiles two Java implementations of the same
binary class with different return values; packages each as a JAR; builds
two separate symlink directories with the same `shared.jar` leaf; compiles
the consumer once; and launches that consumer with a scoped `CLASSPATH`.

Cases:
1. switch library views A -> B -> A without recompilation or symlink edits;
2. reverse two classpath entries to confirm the first matching class wins;
3. pass an explicit `java -cp` that omits the JAR, verifying it overrides
   `CLASSPATH` instead of behaving as a global, unconditional setting.

The portable JVM directory wildcard must remain a literal
`<view>/*` classpath entry. It expands JARs in that directory, not recursively.
Loose `.class` files require a distinct class-root classpath entry; a JVM
module path is separate. Merely adding a directory containing JARs without
a wildcard is insufficient.

## Local validation evidence (2026-11-02)

Executed on the provided Linux container with OpenJDK
`21.0.12.1`, using `sh tests/java-classpath.sh`.
POSIX shell parse checks also passed for `sh` and `dash`.
Observed output:

```text
PASS: JAR symlink projections A/B/A; left-to-right precedence A/B; explicit -cp overrides CLASSPATH
```

This verifies real Java compilation and runtime loading from symlink
directories for the experiment; it does not exercise `m`, package
installation, or an application-managed Java class loader. The hosted
Ubuntu/macOS workflow is published but no finished hosted run result
has yet been inspected.

## What this does not establish

- No new RumiAI package descriptor, installation projection or `context`
  grammar has been selected or implemented by this experiment.
- `java -jar`, Java module paths, application launchers and custom
  classloaders have separate semantics, so `CLASSPATH` cannot be called
  universal.
- Java JAR/class compatibility, duplicates, ordering, trust and removal
  lifetime need contract-specific validation. JAR basename collisions in
  one combined symlink directory are a separate problem.
- Shell libraries use `.` and current `m` `loadlib` identities, not the
  executable `PATH` by fiat. Python ordinary site behavior is likewise
  not equivalent to bare `PYTHONPATH` (see existing PoC 043).
- No generic `LIB_PATH` or global `LD_LIBRARY_PATH` is implied.

## Corrected architectural interpretation (2026-11-02)

The user clarified that the intended analogy is **ordinary package commands
and their published `cmd` symlinks searched through `PATH`**, not facility
contracts or provider-realization metadata. Libraries should be independently
publishable from concrete installed packages, through similarly reusable
package-owned symlink views. The selected context composes the corresponding
runtime-specific library search path, just as it composes command paths.
A package need not declare a facility in order to share a library.

The underlying package-concrete selections must remain coherent across both
command and library views. Facility bindings may independently participate
when a consumer actually depends on a facility, but they are neither a
prerequisite nor the naming/ownership model for ordinary shared libraries.

This PoC verifies the **Java lookup mechanism only**. It does not prescribe
physical view directory names, package library export metadata, a new
`context` operand grammar or changes to `loadlib`. Any such product API
requires separate evaluation of existing package responsibilities and normal
consumer scenarios.
