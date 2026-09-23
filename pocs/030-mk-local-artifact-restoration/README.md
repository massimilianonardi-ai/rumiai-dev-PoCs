# PoC 030 — mk local artifact restoration

Status: Experiment in progress
Date: 2026-09-23

## Question

Can the existing incremental-freshness model restore declared output bytes from local non-authoritative cache state when the operation fingerprint is still reusable but current outputs are missing or corrupt, without turning plan resolution into a mutating operation or introducing shared/remote cache semantics?

## Candidate boundary

No new `mk.json` syntax is introduced.

An operation already declares:

```text
inputs
outputs
incremental: {}
```

Those declared outputs are the only artifact boundary used by the experiment.

The current freshness record remains metadata. Artifact bytes are stored separately under the same semantic cache owner resolved through:

```text
state-path user sys mk cache
```

This matches the state model: artifacts used only to avoid regenerable work are non-authoritative cache state.

## Candidate lifecycle

Successful incremental execution:

```text
execute operation
-> snapshot declared outputs
-> copy verified declared output bytes/tree into local artifact store
-> write normal freshness metadata
```

Later request:

```text
resolve current fingerprint
-> current outputs do not satisfy freshness record
-> --plan remains read-only and reports normal executable state

execution path only:
    matching freshness metadata
    + complete verified local artifact store
    -> stage restoration
    -> replace declared outputs
    -> verify restored output snapshots
    -> next normal refinement resolves operation up-to-date

artifact store absent/corrupt/incomplete
    -> conservative miss
    -> execute action normally
    -> refresh local artifact store on success
```

A result-field observation still forces actual execution. Artifact restoration must not synthesize process-result evidence.

## Private local layout

The experiment keeps artifact layout private below the existing project-scoped mk cache identity:

```text
<mk-cache>/
    projects/<sha256(canonical-project-root)>/
        operations/...
        artifacts/<sha256(operation)>/<fingerprint>/
            manifest.json
            payload/<sha256(output-name)>
```

This intentionally preserves the current canonical-project-root cache boundary. Copying/moving a checkout is therefore a miss in the first experiment even if its source content is identical.

No cross-project/content-addressed sharing contract is implied.

## Artifact representation

The first candidate stores only the same filesystem forms already accepted by incremental snapshots:

- regular files;
- directory trees containing regular files/directories;
- recorded permission mode bits.

Symlinks and special files remain unsupported/cache misses.

The cached copy is verified against the existing output snapshot hashes before it is considered restorable. Restoration is staged in temporary sibling paths and re-snapshotted before replacing declared destinations.

Artifact-store failure never fails the lifecycle by itself. It degrades to ordinary operation execution because cache state is non-authoritative.

## Integration rule

Restore is attempted only from `_executeV2`, immediately before the operation action would otherwise execute.

It is not attempted when:

- the current effective fingerprint differs from the freshness record;
- process-result evidence is required for the operation;
- cached output bytes fail integrity verification;
- cache/state resolution is unavailable.

This placement is intentional:

- `--plan` remains non-mutating;
- the normal resolver/fingerprint model remains authoritative;
- successful restoration becomes visible to the next ordinary refinement pass rather than inventing a second success model.

## Stress scenarios

`tests/run.js` verifies:

1. missing file output restores without re-executing its action;
2. `--plan` does not restore a missing output;
3. tampered file output restores from verified cache without action execution;
4. directory-tree output restores nested bytes and permission mode;
5. multiple declared outputs restore as one operation result without action execution;
6. a restored producer output satisfies an output-input consumer through normal refinement;
7. one provider-derived incremental member can restore independently through the same ordinary operation machinery;
8. corrupt cached artifact bytes cause a conservative miss and actual execution, after which restoration works again;
9. result-field observation still forces actual execution rather than restoration-only reuse;
10. a copied/moved checkout misses the project-scoped artifact store and executes normally.

## Scope limit

The PoC does not define:

- shared or remote artifact cache;
- cross-project content-addressed artifact reuse;
- eviction/size policy;
- artifact garbage collection;
- stale provider-member artifact cleanup;
- parallel restoration/execution;
- remote execution;
- archive/network representation;
- security/signing of cache contents.

Those remain separate concerns.
