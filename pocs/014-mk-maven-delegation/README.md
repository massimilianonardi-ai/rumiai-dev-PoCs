# PoC 014 — mk Maven delegation

Status: Experiment completed
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

## Result

The current generic `mk` model is sufficient for this delegated Maven case without a Maven-specific adapter.

The successful configuration exposes:

```text
goal build
    -> operation maven-package
    -> process action: mvn -q package
```

`mk --plan build` resolves exactly:

```text
maven-package
```

and `mk build` delegates the opaque operation to Maven. Maven produces
`target/mk-maven-poc-1.0.0.jar`; the built class is then executed through the
selected Java provider and prints:

```text
mk-maven-ok
```

### Hosted evidence

Successful GitHub Actions run:

```text
run        35717912561
PoC        7fdb760c31e9168db68f72e51d0d0b62b67c68da
rumiai-os  bacf3b6d37b508c6b07bd8b6bb88019bc50a627f

Ubuntu     PASS poc-014 mk -> Maven delegation
macOS      PASS poc-014 mk -> Maven delegation
```

The first run, `35717818592`, failed before reaching `mk` because Maven was
installed before a provider had been selected for its declared `java >=17`
package dependency. Reordering provisioning to install/select Temurin first and
only then install Maven made both hosts pass. This is evidence of the existing
`pkg` provider/dependency boundary, not a need for Maven-specific behavior in
`mk`.

## Conclusion

For a project whose upstream build engine already owns its internal lifecycle,
the current `process` action provides the required delegation boundary. This
case provides no evidence that `mk` needs a Maven-specific adapter or additional
core primitive.

The next useful stress case is the opposite end of the granularity spectrum: a
native fine-grained build in which `mk` must see source discovery and multiple
compile/link operations directly.
