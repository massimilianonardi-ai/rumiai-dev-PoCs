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
