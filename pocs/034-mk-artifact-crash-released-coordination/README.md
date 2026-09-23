# PoC 034 — crash-released shared artifact maintenance coordination

Status: Experiment in progress
Date: 2026-09-23

## Question

Can the safety model established by PoC 033 be made crash-live with a portable local ownership witness, without PID inspection, age-based timeouts, a global publication lock or reader leases?

The experiment remains local/user-scoped. It does not choose a cache-size/retention policy, add a public cache-management command, introduce remote/cross-user transport or change lifecycle scheduling.

## Starting point

PoC 033 established two distinct results:

```text
reader safety
    immutable candidate quarantine + transactional restore is enough
    no reader lease is required

writer/maintenance safety
    publication must exclude reclamation across the final
    verified-candidate -> current-selector commit window
```

Plain persistent marker files were safe in races but not live after `SIGKILL`: a dead owner left an indistinguishable pathname.

The current platform baseline is POSIX.1-2024. This PoC therefore evaluates a FIFO-based activity witness using the POSIX `mkfifo` utility and FIFO non-blocking open semantics.

## Candidate primitive

Each active owner publishes a unique FIFO pathname only after opening the FIFO read-only and non-blocking in the owning process:

```text
create private/preparation FIFO
open read end O_RDONLY | O_NONBLOCK
rename FIFO to unique published token pathname
keep read descriptor open for the critical section
```

Another process probes the published token by opening it write-only and non-blocking:

```text
open O_WRONLY | O_NONBLOCK succeeds
    -> a reader is currently open
    -> owner is live

open fails with ENXIO
    -> no reader is open
    -> owning process no longer holds the token
    -> token is stale and reclaimable
```

Abrupt process termination closes the read descriptor in the kernel, while the FIFO pathname may remain. The pathname therefore becomes distinguishable as stale without inspecting a PID or waiting for a timeout.

Preparation names are not ownership claims. They may be ignored or removed; if removal races acquisition, acquisition must fail conservatively before entering the protected critical section.

## Coordination model under test

There is no global maintenance lock. Both sides publish unique activity tokens:

```text
publication writer
    publish live publication token
    scan/reap maintenance tokens
    if any live maintenance token exists: abandon artifact selection
    verify candidate
    atomically commit current selector
    release publication token

maintenance pass
    publish live maintenance token
    scan/reap publication tokens
    if any live publication token exists: perform no reclamation
    otherwise reclaim eligible state
    release maintenance token
```

The symmetric handshake is safe for every start ordering:

```text
writer visible first
    maintenance sees writer and backs off

maintenance visible first
    writer sees maintenance and backs off

both become visible concurrently
    one or both may back off, but neither proceeds through the other's live token
```

Multiple maintenance passes do not need to exclude each other for this experiment. Candidate reclamation uses atomic rename-to-quarantine and tolerates another maintenance process winning the same pathname race. Whole-fingerprint eviction may intentionally retire the selected candidate.

## Attempt ownership

A writer also holds a unique FIFO attempt token while `.staging-<token>` exists.

Maintenance may therefore distinguish:

```text
staging + live matching attempt FIFO
    -> live writer state, preserve

staging + stale/missing matching attempt FIFO
    -> abandoned/non-owned staging, reclaim
```

The `.current-<token>` selector temporary is created only while the matching publication FIFO is live. Maintenance proceeds past the publication gate only after no live publication token remains, so selector temporaries are then safe crash residue to remove.

## Reader model

Readers remain unregistered. Maintenance atomically moves an unselected immutable candidate out of the canonical `candidates/` namespace before deletion.

If a reader captured that old candidate, transactional restoration either completes from readable bytes or fails before committing project destinations and falls back to ordinary lifecycle execution.

## Stress scenarios

`tests/run.js` exercises:

1. selected candidates survive ordinary sweep while unselected candidates are reclaimed;
2. a live publication FIFO blocks maintenance from reclaiming the candidate being selected;
3. a reader can lose an old candidate during restore and safely fall back without a reader lease;
4. live staging survives maintenance while its attempt FIFO is live;
5. `SIGKILL` closes the attempt FIFO descriptor and makes abandoned staging reclaimable;
6. a live selector publication window blocks maintenance;
7. `SIGKILL` makes the publication FIFO stale, allowing the next maintenance pass to remove both stale token and `.current-*` residue;
8. killing maintenance leaves a FIFO pathname whose stale state is detected and reaped by a later maintenance pass;
9. a publisher starting while maintenance is live completes the project action but does not select artifact state;
10. maintenance then reclaims that unselected candidate;
11. whole-fingerprint eviction may leave project freshness metadata behind and the next lifecycle request degrades to an ordinary execution miss.

## Promotion boundary

A PASS on Ubuntu and macOS would establish development evidence that POSIX FIFO activity tokens resolve PoC 033's crash-liveness blocker on both hosted platforms while preserving the existing shared-artifact safety semantics.

That evidence alone does not yet change `MK.md` or product code. Promotion would still require the normal specification decision, product/manual realignment, permanent tests and proportional validation against the then-current revisions.
