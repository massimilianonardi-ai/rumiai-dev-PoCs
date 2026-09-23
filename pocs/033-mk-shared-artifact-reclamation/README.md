# PoC 033 — shared artifact garbage collection/reclamation safety

Status: Experiment completed; safety validated, crash-liveness blocker remains
Date: 2026-09-23

## Question

Can the promoted shared-local `mk` artifact store reclaim immutable candidates safely while publication and restoration are concurrent, without introducing reader leases, deleting live writer state, or weakening conservative failure behavior?

This experiment is intentionally local/user-scoped. It does not define a cache-size or retention policy and does not add remote transport, cross-user trust, distributed locking, a public cache-management command or parallel lifecycle scheduling.

## Starting point

The current product model stores shared artifact bytes under one fingerprint namespace:

```text
<mk-cache>/shared-artifacts/<fingerprint>/
    current
    candidates/
        <immutable-candidate>/
            manifest.json
            payload/...
```

Writers publish fully verified immutable candidates and replace `current` atomically. They never delete committed candidates, because a reader may already have captured an older candidate after a selector change.

The cache is non-authoritative. Missing or corrupt artifact state must remain a conservative miss that falls back to ordinary execution.

## Safety model under test

### Reader side: quarantine instead of reader registration

The existing restore path stages and verifies project outputs before replacing any destination. Therefore maintenance can reclaim an unselected immutable candidate by first atomically renaming the candidate directory out of `candidates/` into a private quarantine area and then deleting it.

A concurrent reader that captured the old pathname has only two safe outcomes:

```text
copy/verify completes before reclamation interferes
    -> normal successful restore

candidate pathname disappears during restore
    -> restore fails before project destinations are committed
    -> lifecycle executes the operation normally
```

The PoC therefore tests whether explicit reader lease/registration state is unnecessary for candidate reclamation.

### Writer side: publication/maintenance exclusion

A writer can verify a committed candidate and then be about to select it. Maintenance must not reclaim that candidate in this window.

The experimental coordination is per fingerprint:

```text
writer:
    create publication pin
    verify no maintenance marker is active
    verify candidate
    atomically publish current
    remove pin

maintenance:
    create maintenance marker exclusively
    if any publication pin exists: do no reclamation
    otherwise reclaim eligible candidates
    remove maintenance marker
```

A writer that creates its pin after maintenance became active observes the maintenance marker, removes its pin and abandons artifact selection conservatively. The project operation itself may still succeed and keep its project-scoped freshness/output state.

These filesystem markers are deliberately only a safety experiment. Their crash-liveness behavior is part of the question, not an assumed production solution.

### Ordinary sweep versus whole-fingerprint eviction

The PoC distinguishes two maintenance actions:

```text
sweep
    never reclaim the candidate named by current
    quarantine and delete only unselected committed candidates

evict
    retire current atomically while maintenance owns the fingerprint
    quarantine and delete all committed candidates
```

Whole-fingerprint eviction intentionally does not remove project-scoped freshness metadata. A later project whose metadata refers to reclaimed bytes must simply miss restoration and execute normally.

### Attempt residue

The experiment does not guess whether these paths are abandoned:

```text
.staging-*
.current-*
```

Maintenance leaves them untouched. This proves safety around live writers and exposes the separate crash-liveness question: reclaiming such residue requires a reliable ownership/liveness mechanism rather than pathname age or non-portable process inspection.

## Stress scenarios

`tests/run.js` exercises at least:

1. an ordinary sweep never reclaims the selected candidate;
2. an unselected committed candidate is quarantined/reclaimed;
3. maintenance cannot reclaim a candidate while a writer holds the publication-selection window;
4. a reader may capture a candidate, `current` may advance, and maintenance may reclaim the old candidate without exposing partial project outputs;
5. that reader degrades to ordinary execution if its source disappears during restore;
6. maintenance leaves a live `.staging-*` directory untouched;
7. a killed writer may leave `.staging-*` residue and maintenance does not guess that it is safe to delete;
8. maintenance is blocked while a writer owns a live `.current-*` publication window;
9. killing that writer leaves conservative publication-pin/selector-temp residue rather than unsafe reclamation;
10. whole-fingerprint eviction can remove artifact bytes while project freshness metadata remains;
11. the next lifecycle request treats those missing bytes as a conservative restore miss and executes normally;
12. killing maintenance after it acquires its marker leaves a stale marker that blocks later maintenance rather than permitting unsafe concurrent reclamation.

## Expected decision boundary

The experiment can validate reclamation **safety** independently from reclamation **liveness after crashes**.

If filesystem marker/pin coordination passes the races but a killed process necessarily leaves state that cannot be classified safely without timeouts or process inspection, the result is not ready for product promotion. The next design step would be to evaluate a local coordination primitive whose ownership is released by the kernel on process termination, while preserving the same candidate/quarantine semantics.

No production contract is changed by this PoC until that remaining boundary is resolved and promoted through the normal specification gate.

## Result

The experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35859604116
```

against exact `rumiai-os` revision:

```text
c3c51e6f070c774c103eeb7f71c759e3ebfda4ec
```

Observed:

```text
PASS PoC 033 shared artifact reclamation safety
OBSERVED reader-lease=not-required-with-quarantine+transactional-restore
OBSERVED writer-maintenance-gate=filesystem-pin+maintenance-marker-safe
OBSERVED crash-residue=conservative-retention-or-block
OBSERVED promotion-blocker=crash-liveness-needs-kernel-released-coordination
```

The safety result is positive:

- an ordinary sweep can quarantine/delete unselected immutable candidates while keeping the selected candidate;
- a restore does not require a reader lease if reclamation is atomic at the candidate pathname and restoration remains transactional;
- a reader whose captured candidate disappears before copy/verification degrades to a conservative miss and ordinary execution without partial project output exposure;
- publication requires exclusion from reclamation only across the final verified-candidate-to-selector-commit window;
- whole-fingerprint eviction can leave project-scoped freshness metadata behind; missing artifact bytes remain a conservative miss.

The filesystem-only publication pin + maintenance marker is **not promotable** as the production coordination mechanism. `SIGKILL` can leave both pin and maintenance marker pathnames behind. Treating them as live is safe but can block reclamation indefinitely; deleting them based on age or guessed process identity would add a non-portable or unsafe liveness rule.

The same limitation prevents safe automatic reclamation of abandoned `.staging-*` and `.current-*` residue when ownership is represented only by persistent pathnames.

## Decision

PoC 033 closes the reader-safety question: no reader lease is required for immutable candidate reclamation under the current transactional restore contract.

It does **not** close crash liveness. Before product/spec promotion, the writer/maintenance ownership mechanism must be replaced by a local primitive whose live ownership disappears or is reliably detectable after process termination. The next experiment should retain the validated quarantine/transactional semantics and evaluate a POSIX-compatible crash-released ownership primitive.

No current `MK.md`, `CURRENT-MODEL.md`, `rumiai-os` implementation or permanent test is changed by this result yet.

The temporary hosted workflow was removed after evidence collection.
