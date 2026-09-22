# PoC 015 — mk native C++ graph expansion

Status: Experiment completed
Date: 2026-09-22

## Question

Can the current `mk` goal/operation/prerequisite/process model represent a fine-grained native C++ build, and what is the smallest missing responsibility needed to preserve automatic source discovery when files are added, removed or renamed?

This experiment deliberately separates two questions:

1. can the current planner/executor run separate compile operations and a final link operation?
2. can the current static `mk.json` model derive those operations from the current project filesystem without manually enumerating each source?

## Reference input

The historical/reference repository `massimilianonardi-ai/m` contains:

```text
var/#_os/m/bin/makefiles/makefile_type_cpp_gcc.mk
```

at current repository revision:

```text
2a57a29880c2d7a32e18782122062c695fcb1a3a
```

This file is design evidence only, not RumiAI authority.

The useful behavior extracted from it is:

- recursively discover C/C++ sources rather than list them manually;
- derive object paths from source paths;
- create corresponding object directories;
- compile one source into one object;
- link all discovered objects into the final output;
- let source add/remove/rename change the effective graph without editing the project build description.

The old makefile also handles depfiles, DEBUG/RELEASE flags, target architecture and other concerns. Those are intentionally outside this first experiment.

## Fixture

The fixture contains three initial C++ translation units:

```text
src/main.cpp
src/math/add.cpp
src/math/multiply.cpp
```

and a hand-written `mk.manual.json` that enumerates the corresponding compile operations and link inputs explicitly.

The test first copies that file to `mk.json` and verifies the current real `mk` can execute the fine-grained graph.

It then adds a fourth source used by `main.cpp` without editing `mk.json`. The stale static graph is expected to fail at link time because the new translation unit is not represented by any operation.

## Experimental graph expander

`prototype/expand-native-cpp.js` is PoC-only code. It is not a proposed public API and its `project.experimental.json` descriptor is not a proposed `mk.json` schema.

The prototype:

```text
project filesystem
    -> deterministic source discovery
    -> concrete operation graph
    -> ordinary version-1 mk.json
    -> current unmodified mk planner/executor
```

It produces only existing `mk` primitives:

```text
goal
operation
prerequisite
process action
```

The generated graph contains one compile operation per discovered source plus one link operation consuming all generated objects.

The test repeats graph expansion and build after:

```text
add source
rename source
remove source
```

without editing the experimental project descriptor.

## Tooling boundary

The PoC provisions the JavaScript runtime through the real RumiAI `pkg` path because current `mk` requires the managed `nodejs` runtime.

The C++ compiler is the real host `c++` driver supplied by the GitHub-hosted runner. The current `pkg-catalog` has no GCC/Clang package definition, and compiler package management is not the property under test here.

## Expected evidence

A successful experiment should establish only these claims:

1. current `mk` already executes a manually expanded fine-grained C++ graph correctly;
2. current static `mk.json` cannot automatically change that graph when the source set changes;
3. pre-planning graph expansion can produce an ordinary current `mk` graph that handles add/remove/rename without changing planner/executor semantics.

The experiment does **not** by itself decide whether the final product boundary should be a provider/plugin API, a generic declarative expansion primitive, another trusted extension mechanism, or something else.

## Result

The experiment establishes the expected separation.

### 1. Fine-grained execution already works

The hand-written static graph successfully builds and runs through the current unmodified `mk` implementation.

The initial plan is:

```text
dir-dist
dir-build-obj
compile-main
dir-build-obj-math
compile-add
compile-multiply
link
```

Each translation unit is compiled by its own ordinary `process` action and `link` depends on all compile operations.

### 2. Static configuration does not discover a changed source set

After adding `src/math/subtract.cpp` and changing `main.cpp` to call `subtract()` without changing `mk.json`, the same static graph fails as expected because no operation exists for the new translation unit.

This is not a planner or process-executor failure. The graph being planned is simply stale.

### 3. Pre-planning graph expansion is sufficient

The PoC-only expander discovers sources and emits an ordinary current version-1 `mk.json`. No planner/executor change is required.

After expansion, the build succeeds through the real current `mk`. Re-expansion also handles:

```text
add     src/math/subtract.cpp
rename  src/math/multiply.cpp -> src/math/product.cpp
remove  src/math/add.cpp
```

without changing the experimental project descriptor.

The final generated graph contains only the already-current concepts:

```text
goal
operation
prerequisite
process action
```

The missing responsibility exposed by this case is therefore **deriving/expanding the concrete operation graph from current project state before planning**, not a new compile/link execution primitive.

## Hosted evidence

The workflow is:

```text
GitHub Actions run 35720179362
PoC revision      1e3260d4f07b7e365ba1cde961cdac199988ed35
rumiai-os         c2dcde09c2582ff67733911816088952fa1eb5ee
```

Ubuntu completed the full experiment:

```text
PASS poc-015 mk native C++ graph expansion
```

The macOS job did not reach `mk` in either attempt. Both attempts failed while provisioning the required managed `nodejs` runtime:

```text
pkg install nodejs
curl: (56) The requested URL returned error: 403
```

Therefore this PoC has positive Ubuntu hosted evidence and no macOS execution evidence. The macOS failure is outside the property under test and is not counted as evidence against the `mk` model.

## Architectural consequence

This experiment narrows the next design question substantially.

The existing static planner/executor can remain unchanged for this class of native build if a prior model-expansion stage can turn declarative project intent plus current project state into ordinary operations.

What remains unresolved is **which extension boundary owns that expansion**. Plausible classes include a trusted reusable operation provider/builder, a generic declarative expansion facility, or another extension mechanism. The PoC does not select among them.

The experiment therefore does not justify promoting a new public schema or modifying `mk` yet. The next useful test should compare candidate expansion boundaries against another graph-producing case—especially generated sources—before fixing the product API.
