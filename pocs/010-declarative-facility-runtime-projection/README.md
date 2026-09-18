# 010 — Declarative facility runtime projection

## Question

Can a facility provider describe its consumer runtime projection entirely as data,
while supporting both command exposure and environment values rooted at the
selected provider useful root?

## Candidate schema

```text
facility-cmd/<facility>/<command>
    one relative executable target pathname followed by newline

facility-env/<facility>/<variable>
    one typed value descriptor followed by newline
```

Environment descriptor kinds:

```text
root
root-path <relative-path>
literal <value>
```

`root` resolves to the provider useful root. `root-path` resolves beneath that
root. `literal` produces the remaining text without shell evaluation.

The materialized provider command projection is a private directory of symlinks.
The launcher prepends that directory to PATH for the selected facility and applies
the environment descriptors as ordinary exported variables.

This is PoC material until promoted into the package contract.
