# PoC 042 — Python bytecode cache as package state

Status: Experimental

## Question

Can Python bytecode remain enabled while keeping an immutable RumiAI package root clean by routing `.pyc` files to consumer state with `PYTHONPYCACHEPREFIX`?

The experiment also checks relocation behavior: an old cache generated before the RumiAI root moves must not prevent the relocated consumer from running, and the cache must be safely discardable and regenerable.

## Experiment shape

Using the real current RumiAI package launcher and a synthetic Python facility provider, the experiment:

1. materializes a pure-Python consumer separately from its interpreter;
2. keeps the consumer command at `#!/usr/bin/env python`;
3. exposes the consumer package tree through the same provisional `PYTHONPATH` probe used by PoC 038;
4. sets `PYTHONPYCACHEPREFIX="$HOME/.cache/python"` in the consumer environment;
5. proves imports create bytecode only in consumer state, not under the immutable package root;
6. moves the complete disposable RumiAI root and runs the same consumer again;
7. proves the old cache remains harmless and a cache entry for the relocated source is generated;
8. deletes the cache entirely and proves it is regenerated successfully.

A PASS does not adopt `PYTHONPYCACHEPREFIX` as a contract, but establishes it as a stronger candidate than globally disabling bytecode writes.


## Observed result

PASS on GitHub Actions run `36271759567` at PoC revision `4aa6b4f2a29237021dc6da4d312254b6ebf695a6`, on Ubuntu 24.04 and macOS 14.

On both hosts:

```text
consumer package root
    runtime __pycache__              -> none

consumer state
    initial generated .pyc files     -> 18
    old cache moves with whole root  -> PASS
    old cache remains harmless       -> PASS
    relocated source gets new cache  -> PASS
    whole cache can be deleted       -> PASS
    relocated cache regenerates      -> PASS
```

The first two failed hosted attempts were harness corrections rather than negative evidence about `PYTHONPYCACHEPREFIX`:

- the first tried to identify cache/source association by searching raw source-path bytes inside `.pyc`;
- the second computed the expected cache path correctly but continued using the consumer state path from before the whole RumiAI root moved.

The final experiment re-resolves consumer state after relocation and verifies cache identity structurally with `importlib.util.cache_from_source()`.

This is direct evidence that, for the tested consumer, bytecode does not need to be disabled to preserve immutable package roots. Routing `PYTHONPYCACHEPREFIX` into consumer state preserves bytecode caching while making the cache disposable and regenerable. The mechanism remains experimental until the surrounding Python consumer-environment contract is settled.
