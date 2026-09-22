# PoC 014 — mk Maven delegation

Status: Active
Date: 2026-09-22

## Question

Can the current `mk` lifecycle model represent a normal Maven project without a Maven-specific feature in the `mk` core?

The intended minimal shape is:

```text
goal build
    -> operation maven-package
    -> process action
    -> mvn -q package
```

Maven remains opaque to `mk`: Maven owns its internal lifecycle, source discovery, compilation and packaging.

## Fixture

`fixtures/project/` is a minimal Java project containing:

- `pom.xml`;
- one Java source file;
- `mk.json` with one `build` goal and one `maven-package` operation.

The process action deliberately omits `cwd` so this PoC also verifies the current contract that the project root is the default working directory.

## Runtime/tool path

The hosted experiment installs and selects these packages through the real RumiAI `pkg` subsystem:

```text
nodejs
temurin
maven
```

Temurin is selected as the system provider of the `java` facility. Maven itself declares `java >=17`.

The experiment then invokes the real public `mk` command from the checked-out `rumiai-os` revision.

## Expected evidence

The experimental test verifies:

1. `mk --plan build` resolves exactly one operation, `maven-package`;
2. `mk build` successfully delegates to Maven;
3. Maven produces `target/mk-maven-poc-1.0.0.jar`;
4. the generated class runs with the selected Java provider and prints `mk-maven-ok`.

A successful result demonstrates that the existing generic process action is sufficient for this simple delegated-engine case. It does not establish a Maven-specific adapter requirement.
