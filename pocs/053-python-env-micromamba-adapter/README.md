# PoC 053 — python-env micromamba adapter

Status: Experimental

## Question

Can a small provider-independent `python-env` command contract be implemented on top of a real micromamba provider without shell activation, raw micromamba CLI leakage, argument corruption or unsafe environment-path handling?

The candidate facility command contract is:

```text
python-env create <environment> <python-version>
python-env run <environment> -- <command> [<arg>...]
python-env remove <environment>
```

The consumer resolves the environment pathname. The adapter requires an absolute path, does not choose RumiAI state placement, does not overwrite an existing target, and refuses `run`/`remove` for a path that does not look like an environment it manages.

## Pinned provider

```text
micromamba release: 2.9.0-0
channel:            conda-forge
```

The GitHub Actions workflow reuses the exact official micromamba artifacts and SHA-256 values already measured by PoC 040.

## Experiment

The hosted Linux/macOS run validates:

1. `create` creates a private prefix with the requested Python minor and working `python -m pip`;
2. an existing unrelated target is rejected without mutation;
3. `run` preserves option-like arguments, spaces, embedded newline and an empty argument;
4. stdin, stdout, stderr and child exit status cross the adapter boundary;
5. running inside the environment does not mutate the caller shell environment;
6. `remove` removes only a recognized environment and rejects an unrelated directory;
7. the same path can then be recreated with a different Python minor, proving the intended rebuild-on-version-change model.

The PoC deliberately does not define requirements/plugin policy, channels as a consumer-facing API, environment migration, GPU policy or a complete Conda abstraction.

## Run

```sh
MICROMAMBA_URL=... \
MICROMAMBA_SHA256=... \
./run.sh
```

## Observed result

Pending hosted execution.
