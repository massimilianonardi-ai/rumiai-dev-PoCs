# 065 — Google Closure Compiler checks and explicit cross-bundle imports

**Status: experimental research only.** Not product jsc, not a final JSON schema and not a normative RumiAI contract. All existing contracts, implementation and descriptor formats remain candidates for redesign.

## Goal

Compare three locations for explicit cross-bundle import declarations while testing the *actual* Google Closure Compiler in check-only mode. The compiler receives generated classic JavaScript and a reusable published API description converted to Closure externs.

This experiment honors the new intended semantics: **an imported external name captures its referent when the consumer bundle initializes**, whereas **explicit qualified namespace access remains live**. No `eval`, `with`, `new Function`, source ESM translation or runtime registry is required.

## Compare the three authoring surfaces

One consumer body is used everywhere:

```js
function Extension() { return MyClass() + Base(); }
function Live() { return m.srv.data.MyClass() + m.Base(); }
```

1. **Per-file:** source-local annotations `// @jsc-import Base from m.Base` and `// @jsc-import MyClass from m.srv.data.MyClass`. These are *invented solely for the PoC* and are not established syntax.
2. **Bundle descriptor:** a file node supplies `imports: {Base:'m.Base', MyClass:'m.srv.data.MyClass'}`. This is a *hypothetical* replacement or extension of the JSON format.
3. **Reusable published API:** the providing bundle describes export names, paths and basic types. A consumer lists paths it uses, and the generator derives local names and import paths from the published interface. It also generates Closure extern declarations from this **same interface**.

All three produce **identical byte-for-byte consumer output**. The PoC deliberately uses simple metadata extraction, **not** a JavaScript parser or production-ready dependency resolver.

## Run

Runtime-only tests, no external dependencies:

```sh
node probe.mjs --runtime-only
```

With a preprovisioned pinned **Google Closure Compiler v20260831** Java JAR:

```sh
CLOSURE_JAR=/path/to/closure-compiler-v20260831.jar node probe.mjs
```

The GitHub Actions workflow `.github/workflows/poc-065-jsc-closure.yml` obtains this version explicitly from Maven Central. Generated libraries themselves do not depend on Closure. Tests can run offline once the compiler JAR is available.

## Verification scope and limitations

- Generated output is independently executed as ordinary **classic JavaScript in Node V8** using isolated contexts, not as ESM.
- Initial exported values are `Base() = 10`, `MyClass() = 42`: both consumers return 52.
- After replacing public namespace properties with `Base() = 100` and `MyClass() = 77`, the import-capturing `Extension()` **still returns 52**, while qualified `Live()` returns **177**.
- Closure runs `--checks_only` with enabled diagnostics `undefinedVars`, `checkTypes`, `missingProperties`; positive consumer and producer plus four intentionally broken fixtures are evaluated.
- A published API entry used as an import is checked by the prototype even before invoking Closure.
- A source import of a mutable namespace *object* would capture the object, not freeze its properties. This experiment imports the **functions directly** to make the reference stability unambiguous.
- Closure externs document an API to the checker; they do **not** create a JavaScript binding at runtime or prove a provider is loaded.
- The PoC does not claim browser runtime validation, CommonJS export validation, final import syntax, deep type checking, real package dependency resolution or the full production `jsc` launcher.
- An executable `CLOSURE_JAR` is required to claim the checks have actually run. The runtime-only path must never be reported as Closure validation.

## Design question

Where should cross-bundle imports live? Per-source annotations keep dependencies near code but introduce nonstandard annotations; descriptor imports avoid modifying sources but can make the descriptor verbose; reusable provider APIs reduce duplicated knowledge and can supply externs, but still need a consumer mapping for local names and versions. **No final design decision is made by this PoC.**
