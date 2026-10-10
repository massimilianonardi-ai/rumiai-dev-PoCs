# jsc — independent experimental compiler

Private local PoC package `rumiai-poc-jsc@0.0.0-poc.1`. **Not published and not a stable product/API commitment**.

Requires Node 22 or newer. Compiles a JSON descriptor containing `version: 1` and an array of `{id, file, deps, format?}` for **classic** JavaScript module bodies. Emits a classic-script `JscRuntime.installBatch([...])` registration, **not a loader**. Every source receives `require`, `module` and `exports`. Only manifest-declared dependencies can be required. Static ESM `import`/`export` syntax is unsupported and rejected rather than translated.

Run from an offline-installed package:

```sh
./node_modules/.bin/jsc ./modules.json ./compiled.js
```

To optionally produce one classic file with a separately installed loader:

```sh
./node_modules/.bin/jsc-assemble ./modules.json ./bundle.js ./node_modules/rumiai-poc-dynamic-loader/loader.js
```

Packaging merely concatenates the **independent** runtime and the compiler-produced registrations. The compiler package contains no loader and does not depend on the loader package.

Failures exit nonzero; failed syntax, dependency and manifest validation does not overwrite a previously successful compiled output. The assembler expects a loader path when used outside the original PoC source tree. The CLI and manifest are experimental, not a released `m` command.
