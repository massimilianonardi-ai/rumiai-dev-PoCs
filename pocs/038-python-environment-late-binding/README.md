# PoC 038 — Python environment late binding

Status: Experimental

## Question

Can a Python package environment remain physically separate from the Python interpreter and still behave as a relocatable RumiAI package when its executable scripts use:

```sh
#!/usr/bin/env python
```

with the concrete interpreter selected at launch by the existing `pkg` facility binding/default and PATH projection model?

The experiment also asks where that model stops being safe when an installed Python package contains a CPython native extension.

## Why this PoC exists

The standalone-Python evaluation identified two different responsibilities that must not be conflated:

1. make the Python runtime itself relocatable;
2. prevent subsequently installed Python packages from reintroducing an absolute interpreter/prefix dependency.

`venv` and ordinary `pip` are useful controls because generated scripts normally bind to the environment's absolute interpreter path. Conda/micromamba are useful references because they treat a prefix as a package environment and explicitly track/repair prefix-sensitive files, but a materialized Conda environment is not freely movable without relocation processing.

This PoC isolates responsibility 2. It does **not** claim that the synthetic Python providers used here are relocatable runtime distributions; they delegate to two real host CPython installations solely to make provider identity and cross-version ABI behavior observable.

## Experiment shape

The GitHub-hosted experiment supplies two different real CPython minor versions (`3.12` and `3.13`) as synthetic providers of one experimental Python facility.

It then:

1. builds a pure-Python wheel with both a `console_scripts` entry point and a wheel `.data/scripts` file using `#!python`;
2. installs that wheel into an ordinary `venv` with pip and proves that both installed commands acquire absolute venv shebangs and break after the venv directory is moved;
3. materializes the same wheel with the experimental low-level materializer, producing `#!/usr/bin/env python` for both command forms;
4. keeps the consumer's `site-packages` below the consumer package root, physically separate from the selected Python provider;
5. launches the consumer through the real current RumiAI `pkg` launcher and proves that facility default and consumer binding changes select different Python providers without rewriting the consumer scripts;
6. builds a CPython native extension with Python A, materializes it as a second wheel, proves it works with Python A, and deliberately binds that consumer to Python B to expose the ABI boundary;
7. physically moves the complete disposable RumiAI root and reruns the pure and native consumers without rewriting their scripts or environment tree;
8. scans the relocated consumer concretes for references to the original RumiAI root.

## Experimental environment projection

The consumer package environment currently uses:

```sh
PYTHONPATH="$pkg_launch_root/python/site-packages"
export PYTHONPATH
```

This is deliberately an **experimental probe**, not a proposed package contract. It demonstrates that a site-packages tree can be made visible from the package's live relocated root without embedding the installation prefix in the tree. `pkg_launch_root` is currently an implementation variable of the launcher; the PoC is intended to determine whether a promoted design eventually needs a generic declarative root-relative package-environment projection instead of depending on that internal shell context.

## Native-extension expectation

The native wheel is deliberately compiled for Python A's ordinary CPython ABI rather than the stable `abi3` ABI. The expected result is therefore:

```text
provider A -> import succeeds
provider B -> provider selection succeeds, native import fails
```

That distinction matters: `#!/usr/bin/env python` can make interpreter selection relocatable and late-bound, but it cannot make a consumer binary-compatible with every Python provider. A future Python facility/consumer compatibility contract must preserve that distinction rather than treating language-version compatibility and extension ABI compatibility as equivalent.

## Run

The intended validation path is the associated GitHub Actions workflow. Locally, with two distinct CPython minor versions available:

```sh
PYTHON_A=/path/to/python3.12 \
PYTHON_B=/path/to/python3.13 \
./run.sh /path/to/rumiai-os
```

The supplied `rumiai-os` checkout is copied first. All synthetic package integration, provider configuration and physical relocation occur only in that disposable copy.

## Interpretation

A PASS would establish only the following experimental properties:

- `#!/usr/bin/env python` composes with the current real `pkg` late-binding provider path;
- a pure-Python consumer environment can remain separate from the selected interpreter and can survive relocation without rewriting generated scripts;
- the same installed consumer can follow facility-default/binding changes without reinstalling or rewriting command files;
- ordinary CPython native extensions introduce a real interpreter ABI compatibility constraint that `pkg` must not hide;
- an absolute-prefix scanner is useful validation evidence even when the preferred runtime model is permanent path independence rather than Conda-style destination-prefix rewriting.

It does not choose a standalone CPython upstream, define a Python facility compatibility schema, adopt `PYTHONPATH` as the final integration mechanism, or define the final wheel installer.

## Observed result

Pending the first hosted run.
