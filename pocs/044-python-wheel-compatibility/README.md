# PoC 044 — Python wheel compatibility dimensions

Status: Experimental

## Question

Which Python compatibility dimensions must remain visible to RumiAI when a consumer can be rebound to a different Python provider?

The experiment distinguishes three real wheel classes:

```text
py3-none-any
cp38-abi3-<platform>
cp312-cp312-<platform>
```

and tests them with CPython 3.12 and 3.13.

## Experiment shape

The hosted Linux/macOS experiment:

1. builds all fixtures with CPython 3.12;
2. installs the pure wheel with pip under both 3.12 and 3.13 and imports it;
3. builds a native extension using the CPython stable limited API and tags it `cp38-abi3`;
4. installs/imports that abi3 wheel under both 3.12 and 3.13;
5. builds an ordinary CPython-3.12 native extension and tags it `cp312-cp312`;
6. proves pip accepts/imports it under 3.12 but rejects it under 3.13;
7. deliberately feeds both native wheels to the minimal PoC 038 materializer, which does not perform tag selection, to separate materialization from compatibility validation.

## Interpretation

A PASS does not define the final `pkg` facility schema. It establishes that "Python version" is not one scalar compatibility property.

At minimum, the eventual selection/materialization boundary must preserve enough information to distinguish:

- implementation/language runtime compatibility;
- stable versus implementation/minor-specific ABI;
- platform/osarch compatibility.

It also tests where validation belongs: either the final materializer must validate the already-selected wheel tag, or an earlier trusted wheel-selection boundary must make an incompatible wheel impossible to reach materialization.
