# PoC 032 — concurrent shared artifact publication/restoration

Status: Experiment completed; concurrent shared-local protocol promoted
Date: 2026-09-23

## Question

Can the cross-checkout artifact identity validated by PoC 031 be made safe for concurrent local publishers/restorers without a global lock, while freshness metadata remains project-scoped?

The experiment is intentionally local/user-scoped. It does not add remote transport, distributed locking, eviction or garbage collection.

## Starting point

PoC 031 validated this split:

```text
project-scoped freshness metadata
    keyed by canonical project root + operation

shared local artifact bytes
    keyed by the existing effective operation fingerprint
```

The remaining blocker is concurrency. The current project-scoped product store uses a replace pattern that is safe only because the store is not shared:

```text
remove final store
rename staged store -> final store
```

That pattern is unsafe for a shared fingerprint namespace because one process could remove a valid publication committed by another process between verification and replacement.

## Candidate protocol

The experiment keeps one shared fingerprint root:

```text
<mk-cache>/shared-artifacts/<fingerprint>/
    current
    candidates/
        <candidate-id>/
            manifest.json
            payload/...
```

Published candidate directories are immutable.

`current` is a small regular selector file containing one candidate id. It is replaced atomically through same-directory temporary-file + rename.

A restore:

```text
read current once
-> resolve immutable candidate
-> verify manifest + every payload snapshot
-> stage project outputs
-> verify staged outputs
-> replace project destinations
-> verify final project outputs
-> write receiving checkout's project-scoped freshness record
```

A later selector update does not invalidate an in-progress reader because already-published candidates are never removed by writers.

## Publication

A writer first creates a private staging directory that is never selected by `current`.

After copying outputs and fully verifying staging, it derives a deterministic base candidate id from:

```text
operation
fingerprint
verified output snapshots
```

Equivalent writers therefore race toward the same candidate path.

Publication is:

```text
verified private staging
-> rename staging -> deterministic candidate path

if another equivalent writer already committed that candidate:
    verify the existing candidate
    discard own staging

if the deterministic candidate path exists but is corrupt:
    never delete/replace it
    publish a uniquely named immutable recovery candidate instead

-> atomically replace current selector with chosen valid candidate id
```

No writer removes another committed candidate.

This makes identical publication idempotent while preserving a safe recovery path from externally corrupt committed state.

## Corruption model

Committed candidates are treated as immutable by `mk`, but cache state is non-authoritative and may be corrupt because of external damage or interrupted historical versions.

A corrupt selected candidate is therefore a conservative restore miss.

A publisher refreshing that fingerprint:

- leaves the corrupt candidate untouched;
- publishes a new verified recovery candidate;
- atomically points `current` to the new candidate.

Readers that captured the previous selector may fail verification and conservatively execute. Readers that capture the new selector can restore immediately. Neither requires deleting a candidate another reader may still be using.

## Cleanup boundary

Per-attempt staging directories and selector temporary files are cleaned after normal success/failure/race handling.

Committed but no-longer-selected recovery candidates are **not** deleted by writers. Deleting immutable candidates safely while readers may hold them is a separate garbage-collection problem and is deliberately outside this PoC.

An abrupt process kill may leave an unselected staging directory. Such staging paths are never reachable through `current` and therefore cannot be mistaken for a valid artifact. Reclaiming abandoned staging is also future GC/maintenance work.

## Test-only controls

The candidate engine removes its PoC control environment variables before invoking the real `mk` resolver so those controls do not alter effective operation fingerprints.

The controls only create deterministic race windows for:

- pause after verified staging;
- fail after verified staging;
- pause after atomic selector publication;
- pause after a restore has captured/verified its immutable candidate.

They are not proposed product API.

## Stress scenarios

`tests/run.js` verifies:

1. two equivalent checkouts execute and publish the same fingerprint concurrently;
2. equivalent writers converge on one deterministic committed candidate without a global lock;
3. one publisher can finish and expose a complete selected candidate while another writer is still paused in private staging;
4. the losing writer cleans its staging and does not replace/delete the winner candidate;
5. handled publisher failure after verified staging leaves no selected partial artifact and cleans private staging;
6. a later writer can publish normally after that failed staging attempt;
7. two independent checkouts restore the same fingerprint concurrently from one immutable candidate without executing their actions;
8. both receiving checkouts create only their own project-scoped freshness metadata;
9. a corrupt selected candidate causes a conservative miss;
10. a publisher can refresh that corrupt fingerprint with a new immutable recovery candidate without deleting the corrupt candidate;
11. another checkout can restore from the newly selected recovery candidate while the refreshing publisher is still alive after selector commit;
12. final selected artifact bytes remain verified/readable;
13. no normal race leaves selector temp files or private staging directories.

## Result

The experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35854778813
```

against exact `rumiai-os` revision:

```text
446418f1a9bfd31238088b8dee81a29e0c814b14
```

Observed:

```text
PASS PoC 032 concurrent shared artifact publication/restoration
OBSERVED publication=immutable-candidate+atomic-selector
OBSERVED equivalent-writers=idempotent-no-global-lock
OBSERVED corrupt-refresh=no-delete-of-committed-candidate
OBSERVED freshness-metadata=project-scoped
```

The experiment validates the concurrency protocol required to promote the PoC 031 identity split:

- equivalent concurrent publishers converge on one deterministic candidate without a global lock;
- a slow/losing writer never removes or replaces another writer's committed candidate;
- selector publication is atomic and only ever points at a fully verified immutable candidate;
- handled staging failure leaves no selected partial artifact;
- concurrent restorers can safely consume the same immutable candidate and independently establish project-scoped freshness metadata;
- corrupt selected state is a conservative miss and can be refreshed by publishing a new immutable recovery candidate, without deleting the corrupt candidate while readers may still reference it;
- a reader can restore from the newly selected recovery candidate while the refreshing publisher is still alive after selector commit;
- normal race handling cleans staging and selector temporary files.

Committed but unselected candidates are deliberately not deleted by writers. Safe reclamation/eviction remains future garbage-collection work.

The temporary hosted workflow was removed after evidence collection.

## Promotion status

The PoC 031 identity split and this concurrency protocol were subsequently promoted into current `MK.md` and `CURRENT-MODEL.md` and implemented in `rumiai-os`.

The promoted shared-local architecture is:

```text
project-local freshness metadata
+ shared immutable artifact candidates by existing fingerprint
+ atomic per-fingerprint selector
+ conservative corruption miss/recovery
```

Promotion still does not establish:

- remote/network artifact transport;
- shared multi-user trust;
- artifact eviction/GC;
- abandoned-staging reclamation;
- distributed locking;
- cross-operation semantic equivalence;
- parallel lifecycle scheduling.

The first promoted product implementation is `rumiai-os` commit
`699c77923cda2cd5fd58844f29a6dc9e175d760b`; manual alignment follows through
`c3c51e6f070c774c103eeb7f71c759e3ebfda4ec`.

Permanent product coverage is provided by the real public `mk` tests including
`artifact-restoration.test` and `shared-artifact-concurrency.test`.
