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

## Observed result

PASS on GitHub Actions run `36272360551` at PoC revision `7bf64e8c2612166a3f86e47cefd090b55395077e`, on Ubuntu 24.04 and macOS 14.

The fixtures were built with CPython 3.12 and then tested with both CPython 3.12 and 3.13:

```text
py3-none-any
    pip 3.12 -> accept/import PASS
    pip 3.13 -> accept/import PASS

cp38-abi3-<platform>
    pip 3.12 -> accept/import PASS
    pip 3.13 -> accept/import PASS

cp312-cp312-<platform>
    pip 3.12 -> accept/import PASS
    pip 3.13 -> rejected as incompatible
```

The result was identical in compatibility semantics on Linux and macOS. The concrete native platform tags differed as expected:

```text
Linux:
    cp38-abi3-linux_x86_64
    cp312-cp312-linux_x86_64

macOS:
    cp38-abi3-macosx_10_13_universal2
    cp312-cp312-macosx_10_13_universal2
```

The minimal PoC 038 materializer deliberately accepted the incompatible `cp312-cp312` wheel because it performs no tag selection; importing that materialized wheel under CPython 3.13 then failed. By contrast, the materialized `abi3` wheel imported successfully under 3.13.

This establishes a required trusted boundary: wheel compatibility must be validated before or during materialization. The final design must not infer safety merely from a broad Python facility dependency. It must preserve enough compatibility information to distinguish pure Python, stable ABI, CPython-minor ABI and platform compatibility.
