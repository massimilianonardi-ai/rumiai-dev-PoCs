# 064 — eval-free namespace scopes for jsc (experimental)

This PoC explores design alternatives; it is **not** the `jsc` product, a proposed final JSON schema, a compatibility layer, or a promoted RumiAI specification. In particular, the current JSON, implementation and contracts are **not assumed immutable**. This experiment changes no product or permanent tests.

## Run

```sh
node probe.mjs
# Optional direct comparison against the actual jsc engine:
node actual-jsc-probe.mjs /path/to/rumiai-os/bin/sys/jsc.js
```

Requires Node.js 22 (tested on Node.js v22.16.0), with no packages, network access or `eval` required for the strict candidate. The legacy model deliberately emits direct `eval` to reproduce the critical current-generator mechanism. It uses Node `vm` to execute classic scripts inside isolated contexts; this is **not** a real browser test. A separate real-Chromium attempt in this execution environment did not produce usable DOM output and is **not** counted as validation.

The emitters in `probe.mjs` are small **behavioral models of namespace emission**, not executions of the entire shipped `jsc` command or all its path, CSS, minification and validation logic. A separate actual-engine probe executes the current Node generator directly (not the full `m` command). The `legacy` wrapper intentionally mirrors the relevant expression produced by `rumiai-os/bin/sys/jsc.js` at product HEAD `038ca42fdd22adbf0fda9a41ab17baa6cde5b948`; `strict` is an exploratory alternative using a candidate `imports` map on namespace nodes. The map is **not** a proposed or implemented product contract.

## Execution evidence

Node.js v22.16.0: **16/16 modeled assertions passed**; actual current generator was also invoked directly from an exact byte-identical source copy (Git blob `288221ab1f0db09cc3f14e87c526fb439d33e341`), verifying initial scope, second-bundle reopening and the redefinition mismatch. The complete shell command and permanent CI were not tested.

- Both modeled emitters resolve ordered lexical declarations and ancestor namespace names and reopen a namespace from a second bundle using unqualified symbols.
- Both the modeled wrapper and the actual current generator fail the desired redefinition semantics: after a second bundle declares `function MyClass(){ return 77; }`, the previous export (`42`) still wins. The permanent `jsc` suite intends `77`. The actual generator likewise returned `42` where the permanent test intends `77`; the complete product launcher was not exercised.
- A `strict` emitter using **statically named** `let` aliases populated from namespace objects at bundle initialization supports the same tested separate-bundle use case, and publishes the new function on redefinition (`77`). No `eval`, `with`, `new Function` or module registry is required in the generated strict candidate.
- Local lexical variables, parameters, `Math`, pre-existing global lexical declarations, `typeof` on absent bindings, reassignment of imported local names, browser-style global namespace access and an explicit CommonJS bridge were exercised in Node's classic-script VM.
- Importing a nonexistent namespace property changes a free-name `ReferenceError` into a `TypeError` on attempted invocation. Declaring a class with the same name as an injected `let` alias causes a syntax error. These are **counterexamples to naive universal automatic alias insertion**.
- Capturing a function-valued namespace property at load time differs from qualifying the property lookup inside a function after later changes: both are viable designs, but they have different semantics.
- A `with`-based dynamic namespace cannot be used under `use strict`.

## Candidate solutions to compare

| Candidate | Retains unqualified access across bundles | `use strict` | Static standalone output | Key issue |
|---|---|---|---|---|
| Compile-time aliases, runtime values (tested) | Yes, for statically named imports | Yes | Yes | Must know import names, source/scope collisions, missing symbols |
| AST-based free-name analysis plus alias generation (not implemented) | Potentially | Yes | Yes | Name-resolution ambiguity against runtime properties/global lexical bindings |
| Whole-program static linking (not implemented) | Yes, within a linked compilation | Yes | Yes | Separately generated bundles are not independently linked unless dependencies are supplied |
| Namespace-qualified access (tested for behavior) | Via qualified names, not transparent unqualified aliases | Yes | Yes | Changes source/API semantics and reads updated values dynamically |
| `with`/Proxy dynamic scope | Possibly | **No** | Depends | Violates strict mode; special cases remain |

`AST` is a candidate compiler implementation technique, not proof that an analyzer can infer arbitrary runtime properties. No automatic identifier discovery has been implemented here. Even a perfect syntax analyzer can only see free identifiers; it cannot generally know whether each denotes a global lexical binding, a future namespace property, or something else. Existing JavaScript lexical shadowing and `this` behavior must also be considered carefully.

## Design questions still open

1. Should separately compiled bundles have the same implicit unqualified scope discovery as today's `eval` path, or should available external names be statically declared/resolved? If static, should names be inferred from linked metadata, AST analysis, source descriptors, or a combination?
2. Are imported values captured when a bundle is evaluated, or should references track subsequent namespace mutations? Exact old behavior and desirable new behavior need separate definition.
3. How should conflicting local declarations, outer globals, accessors, missing properties, assignments, changes of function strictness, and namespace redefinitions behave?
4. Is the output always independently distributable or may some deployment workflows link multiple compilation units first?
5. What must browser CommonJS/global publication and namespace freeze/reopen semantics be? The PoC has only an explicit CommonJS export bridge, not a final portable-library wrapper.

No product/contract decision is taken by this PoC. Compare candidates against the **twelve user-selected desired properties**, then jointly choose the architecture and only then realign specifications, implementation and permanent tests.
