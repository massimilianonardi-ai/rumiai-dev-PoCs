# 011 — Facility-default global command projection

## Question

Can a facility default publish commands through the existing `bin/ext` and
`bin/ext-<osarch>` surfaces while preserving provider-selector semantics,
without copying provider commands or republishing when an unversioned provider
package default changes?

## Candidate mechanism

For an unversioned provider selector, a global facility command link points
through the provider package selector rather than directly to one concrete:

```text
bin/ext-<osarch>/<command>
    -> ../../pkg/<provider>!<osarch>/facility-cmd/<facility>/<command>
```

A generic provider class analogously uses:

```text
bin/ext/<command>
    -> ../../pkg/<provider>/facility-cmd/<facility>/<command>
```

A version-pinned facility selector instead targets the selected concrete
identity.

This keeps package-default selection authoritative. Switching the package
selector should change the command reached by an unversioned facility default
without rewriting the public facility link.

## Properties explored

- unversioned global links follow provider package-default changes;
- version-pinned global links do not follow provider package-default changes;
- the same facility selector can project independently into multiple osarch
  command roots;
- global publication uses only existing `bin/ext[-osarch]` roots;
- an existing unrelated public pathname is treated as a collision;
- replacement/removal is allowed only when an existing link matches the exact
  projection expected from the old facility default.

Environment projection is deliberately not addressed by this PoC. Its global
application point remains a separate design question.
