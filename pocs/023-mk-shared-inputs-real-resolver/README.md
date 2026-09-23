# PoC 023 — shared inputs in the real mk resolver

Status: Active experiment
Date: 2026-09-23

## Question

Does the PoC 022 split between operation input identity and incremental freshness remain coherent when applied to the **real current mk parser/resolver/executor**, rather than to an isolated normalizer?

## Method

The experiment loads the current target `lib/sys/js/mk.lib.js` and applies a narrow runtime source transformation in memory. The product repository is not modified.

The transformation does only the candidate ownership move:

```text
operation.inputs
    owns path/collection/output input declarations

operation.incremental
    remains the opt-in freshness policy
```

Legacy `incremental.inputs` is normalized into the same internal `operation.inputs` map.

The real resolver then reuses that shared map for:

- collection/output reachability;
- data-dependency readiness;
- incremental input snapshots/fingerprints when incremental is enabled;
- experimental watch input snapshots when incremental is not enabled.

This PoC is specifically intended to detect semantic regressions caused by extracting input ownership from `incremental`.

## Compatibility rule under test

These two configurations must normalize to the same runtime operation and produce the same incremental fingerprint:

Legacy:

```json
{
  "incremental": {
    "inputs": {
      "source": {"path": "src/input.txt"}
    }
  }
}
```

Candidate:

```json
{
  "inputs": {
    "source": {"path": "src/input.txt"}
  },
  "incremental": {}
}
```

A non-incremental operation may declare `inputs` and remains ordinarily executable on every one-shot request.

## Stress scenarios

The test uses the transformed real current engine and verifies:

1. legacy and candidate incremental forms normalize identically;
2. both produce the same current incremental fingerprint;
3. both reach `up-to-date` through the same persistent freshness machinery;
4. non-incremental path inputs are resolved as watch/change identity but do not make the operation up-to-date;
5. changing that path input changes the resolved input snapshot;
6. a non-incremental output input creates a real data dependency on its producer without duplicate prerequisite declaration;
7. a non-incremental collection input makes the collection reachable;
8. ambiguous simultaneous non-empty `inputs` and `incremental.inputs` is rejected;
9. the existing legacy form remains accepted without project migration.

## Scope limit

This is still an experiment. It does not modify `MK.md` or `rumiai-os`, and it does not yet establish the public watch command/session contract.
