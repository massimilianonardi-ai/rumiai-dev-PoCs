# PoC 051 — explicit loadlib injection stream

Status: Experimental

## Question

Can the current `loadlib-inject.lib.sh` backend support an existing bootstrap-integrated
m command using a completely explicit embedded library set, without parsing source,
computing dependency closure or creating an m runtime tree on the execution host?

This PoC targets the current menu path first because its injected closure is small and
contains no dependency on m semantic roots after core is loaded.

## Candidate stream format

The generated POSIX-sh stream contains, in order:

1. the normal `loadsyslib` specialization;
2. the current `loadlib-inject.lib.sh` backend;
3. one numbered shell-function wrapper for each explicitly selected system shell
   library, preserving the library source text inside that function boundary;
4. one generated `_loadlib_inject_dispatch` case statement mapping exact
   `sys/sh/<reference>` identities to those wrappers;
5. an explicit `loadsyslib "core"` bootstrap load;
6. the selected integrated command body.

The generator receives the complete library set from its caller. It does not inspect
the command or libraries for dependencies and does not add transitive libraries.

For the menu case the explicit set is:

```text
core
array
map
term
menu
```

## Expected properties

- the generated stream parses as POSIX sh;
- `loadsyslib` resolves only explicitly embedded libraries through the injected
  dispatcher;
- the menu command loads its normal dependencies lazily through `loadsyslib`;
- Enter on the first item produces the same serialized command result expected from
  the normal menu surface;
- no copied/materialized m runtime tree is required by the generated stream.

This PoC evaluates only the stream representation and local execution semantics. It
does not yet define a public preload CLI and does not yet exercise rsudo transport.
