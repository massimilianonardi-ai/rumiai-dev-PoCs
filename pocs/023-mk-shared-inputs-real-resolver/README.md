# PoC 023 — shared inputs in the real mk resolver

Status: Experiment completed; shared input ownership validated
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

## Result

The final corrected experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35825649079
```

Two earlier diagnostic runs were harness failures, not product-model failures:

- `35825437879`: source-instrumentation template strings were not escaped correctly;
- `35825511309`: the PoC called the internal resolver with a non-canonical temporary project path on macOS while `mkMain` correctly canonicalized it to `/private/var/...`, so the experiment looked up a different project cache identity.

After applying the product's canonical project-root rule, both hosts passed.

The real-resolver experiment validates the candidate ownership split:

```text
operation.inputs
    owns declared path/collection/output data identity

operation.incremental
    opts the operation into reusable freshness
```

It also validates backward-compatible normalization of existing `incremental.inputs` into the same shared input map.

Observed behavior with the transformed real engine:

- legacy and candidate incremental forms normalize identically;
- their current incremental fingerprints are identical within the transformed engine;
- both reach the existing `up-to-date` path through normal freshness records;
- first-class inputs on a non-incremental operation are observable but never make that operation reusable;
- output inputs create the same producer data dependency without a duplicate prerequisite;
- collection inputs use the same collection reachability machinery;
- ambiguous dual declaration is rejected.

The experiment therefore supports promoting first-class operation input identity without introducing `watch.inputs`.

Because freshness metadata is explicitly non-authoritative, a product-version change in the normalized operation/fingerprint representation may conservatively invalidate old cache records. Preserving old cache hits across an engine/schema change is not required for correctness; false hits remain forbidden.

## Scope limit

This is still an experiment. It does not modify `MK.md` or `rumiai-os`, and it does not yet establish the public watch command/session contract.
