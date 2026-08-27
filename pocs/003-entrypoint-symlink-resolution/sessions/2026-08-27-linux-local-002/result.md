# Result — PoC 003 linux-local-002

Date: 2026-08-27  
Status: **PASS**

## Result summary

```text
dash          14 pass / 0 fail
bash --posix  14 pass / 0 fail
busybox sh    14 pass / 0 fail
TOTAL         42 pass / 0 fail
```

## Validated behavior

The revised candidate successfully validated:

- relative invocation;
- absolute invocation;
- physical/canonical root derivation;
- successful `cd -- "$RUMIAI_ROOT"`;
- `PATH` invocation;
- relative symbolic-link target;
- absolute symbolic-link target;
- symbolic-link chains;
- symbolic link in an intermediate pathname component;
- spaces and literal ` -> ` text in pathnames;
- leading-dash pathname components when invoked unambiguously;
- symbolic-link loops rejected with failure;
- dangling symbolic links rejected with failure;
- pathname component ending with newline;
- `cd` into a root whose final component ends with newline.

## Algorithm conclusion

The PoC supports consolidating the following design:

```text
$0 with slash          -> use as invocation pathname
$0 without slash       -> command -v -- "$0"
invocation pathname    -> realpath --
canonical entrypoint   -> existing regular-file check
canonical entrypoint   -> ${RUMIAI_ENTRY%/*}
canonical root         -> (cd -- "$RUMIAI_ROOT")
success                -> export fundamental state
```

No custom recursive symlink resolver is required for the current POSIX.1-2024 Issue 8 contract.

No parsing of `ls -l`, GNU `readlink -f`, or GNU-specific `realpath` option is required.

## `dirname` conclusion

For this constrained post-`realpath` domain, parameter expansion is preferred over `dirname`:

```sh
RUMIAI_ROOT=${RUMIAI_ENTRY%/*}
```

with the explicit `/` edge normalization.

This result does not imply that `dirname` is invalid for other pathname operations.

## Remaining validation

This session is a Linux cross-shell development validation, not complete reference-host certification.

The same PoC should still be executed on the current reference:

- Ubuntu LTS;
- macOS.

The current design intentionally avoids requiring `realpath -e` so that it does not depend on Issue 8 CLI options that are not yet documented uniformly by current reference hosts.

Any runtime divergence material to RumiAI will be evaluated according to the canonical POSIX baseline-evolution rule.

## Promotion status

The PoC result is sufficient to consolidate the algorithm in `rumiai-dev` architecture/specification/decision documents.

It does **not** authorize copying or implementing the result in `rumiai-os` without explicit user consent.
