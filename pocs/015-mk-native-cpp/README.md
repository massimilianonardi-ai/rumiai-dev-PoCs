# PoC 015 — mk native C++ graph expansion

Status: Active
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
