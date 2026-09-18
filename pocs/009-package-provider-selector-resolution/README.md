# 009 — Package provider selector resolution

## Question

Can the approved package-provider model keep configured selectors authoritative and
resolve them at consumer launch time without rewriting the managed package store?

The PoC focuses on:

- explicit consumer binding overriding a facility default;
- no implicit fallback to the only installed provider;
- generic provider selectors following the provider package default;
- exact provider selectors remaining pinned;
- compatibility validation at every resolution;
- mutable binding/default changes being observed without reinstalling the consumer;
- facility-specific runtime environment being applied from the resolved provider;
- no package-store mutation during consumer launch.

This is experimental material. It does not define the public `pkg` command syntax,
state pathname contract or final facility-projection catalog format.

## Experimental layout

The fixture uses the current semantic roots conceptually:

```text
state/system/current/sys/pkg/conf/facility-default/<facility>
state/system/current/pkg/<consumer>/conf/.m/binding/<facility>

pkg/<provider-concrete>/
pkg/<provider-selector> -> <provider-concrete>
```

The provider runtime projection used by the PoC is deliberately provisional:

```text
pkg/<provider-concrete>/facility-env/<facility>
```

The only purpose of that file in this PoC is to show that a launcher can apply the
resolved provider dynamically without storing a concrete binding inside the consumer.

## Run

```sh
tests/run
```

Success prints one `PASS` line per scenario and exits 0.
