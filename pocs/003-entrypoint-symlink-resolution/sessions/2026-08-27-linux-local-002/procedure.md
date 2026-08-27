# Procedure — PoC 003 linux-local-002

Date: 2026-08-27

## Purpose

Run the revised `pocs/003-entrypoint-symlink-resolution` test matrix against multiple shell implementations after consolidating the Issue 8 `realpath` strategy.

## Subject under test

```text
pocs/003-entrypoint-symlink-resolution/subject/rumiai-os
```

The subject:

1. uses `$0` directly when it contains `/`;
2. otherwise resolves it with `command -v --`;
3. canonicalizes with `realpath --`;
4. verifies the final target with `[ -f ... ]`;
5. derives the parent using `${RUMIAI_ENTRY%/*}`;
6. validates `(cd -- "$RUMIAI_ROOT")`;
7. exports fundamental state only after all checks succeed.

## Test harness

```text
pocs/003-entrypoint-symlink-resolution/tests/run
```

The harness creates an isolated temporary workspace and tests positive and negative path-resolution cases.

## Commands executed

From the PoC directory/environment, the equivalent commands were:

```sh
dash tests/run
bash --posix tests/run
busybox sh tests/run
```

## Required result

Each shell run must report:

```text
SUMMARY pass=14 fail=0
```

The complete session therefore requires:

```text
42 pass
0 fail
```

Any non-zero failure count invalidates consolidation.
