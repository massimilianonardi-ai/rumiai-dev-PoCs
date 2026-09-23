# PoC 031 — cross-checkout shared artifact identity

Status: Experiment completed; identity split promoted after PoC 032
Date: 2026-09-23

## Question

Can verified local artifact bytes be reused across different canonical project roots while freshness metadata remains project-scoped, without introducing a second operation identity or any remote/network cache semantics?

The current local-restoration baseline deliberately scopes both freshness metadata and artifact bytes by canonical project root. This experiment isolates only the artifact-identity question.

## Candidate split

Keep existing freshness metadata unchanged:

```text
<mk-cache>/projects/<sha256(canonical-project-root)>/operations/...
```

Experimentally move only verified artifact bytes to a user-local shared namespace keyed by the **existing effective operation fingerprint**:

```text
<mk-cache>/shared-artifacts/<fingerprint>/
    manifest.json
    payload/...
```

No new project declaration or fingerprint algorithm is introduced.

The existing fingerprint already includes:

- operation name;
- normalized effective operation definition, including declared outputs;
- effective process environment;
- resolved executable identity;
- selected requirement-provider identity;
- resolved declared inputs.

Therefore the candidate is intentionally conservative: equivalent work with a different operation name or definition does not share merely because resulting bytes happen to match.

## Restore protocol

For a checkout with no local freshness record:

```text
resolve current operation fingerprint
→ find shared artifact candidate by that fingerprint
→ verify manifest and every cached output snapshot
→ stage/verify declared output restoration
→ replace destinations
→ write this checkout's own project-scoped freshness record
→ normal refinement observes up-to-date
```

The shared artifact store never becomes authoritative. Missing/corrupt/incomplete shared state remains a conservative miss and ordinary action execution refreshes it.

`--plan` remains read-only and does not restore outputs or create project freshness metadata.

## Why not key only by output bytes

Byte-identical outputs are insufficient identity for reusable work. Two actions may happen to emit the same bytes while differing in definition, input identity, environment, executable or requirement provider.

The experiment therefore reuses the current effective operation fingerprint rather than inventing content-only output reuse.

## Stress scenarios

`tests/run.js` verifies:

1. checkout A executes and seeds a shared artifact;
2. independent checkout B with identical effective operation/input/output identity has no local freshness record and `--plan` remains ready/non-mutating;
3. B execution restores from the shared artifact without running its action, then creates B-local freshness metadata and becomes up-to-date;
4. restored executable mode is preserved;
5. a different operation definition that emits byte-identical output does not reuse A's artifact;
6. different input content does not reuse A's artifact even when action output could be byte-identical;
7. a different operation name with otherwise equivalent behavior remains conservatively distinct;
8. corrupt shared payload is a conservative miss and causes ordinary execution/refresh;
9. an incremental `map-process` member can restore across checkouts through the same existing per-operation fingerprint semantics;
10. no artifact reuse requires or implies network transport, project-dependency de-duplication or shared freshness metadata.

## Result

The corrected experiment passed on both Ubuntu and macOS in GitHub Actions run:

```text
35846792755
```

against exact `rumiai-os` revision:

```text
533095820ea4f22446510a0f7b338253d908d018
```

Observed:

```text
PASS PoC 031 cross-checkout shared artifact identity
OBSERVED freshness-metadata=project-scoped
OBSERVED artifact-bytes=fingerprint-shared-local
OBSERVED remote-transport=not-required
```

The first diagnostic run `35846703434` failed only because the corruption fixture selected an arbitrary shared store whose output bytes matched `SAME`; by that point several deliberately different fingerprints produced those same bytes. The fixture was corrected to capture and corrupt the exact store created by checkout A while it was still the only candidate. No candidate semantic change was required.

The experiment validates the identity split:

```text
project-local freshness metadata
    remains keyed by canonical project root + operation

shared user-local artifact bytes
    may be keyed by the existing effective operation fingerprint

successful cross-checkout restore
    verifies shared artifact
    materializes declared outputs
    writes the receiving checkout's local freshness record
    returns to ordinary refinement
```

The existing fingerprint was sufficient for the exercised cases. Different operation definitions, different declared inputs and different operation names remained distinct even when resulting output bytes could be identical. Provider-derived members reused the same ordinary per-operation mechanism.

No network/remote transport was required or exercised.

## Promotion status

The concurrency blocker identified here was subsequently resolved by PoC 032. The combined identity/concurrency model was then promoted into current `MK.md` and `CURRENT-MODEL.md` and implemented in `rumiai-os`.

The promoted architecture is:

```text
project-scoped freshness metadata
    answers whether this checkout has verified reusable evidence

user-local shared artifact store keyed by effective operation fingerprint
    supplies verified bytes for equivalent work across canonical roots

restore success
    materializes bytes
    writes local freshness evidence
    returns to normal resolver refinement
```

Promotion does not establish:

- remote/network artifact transport;
- global/multi-user sharing;
- artifact eviction or garbage collection;
- trust/signing for imported remote artifacts;
- cross-operation-name semantic equivalence;
- parallel lifecycle scheduling;
- request-wide project dependency exactly-once behavior.

The first promoted product implementation is `rumiai-os` commit
`699c77923cda2cd5fd58844f29a6dc9e175d760b`; manual alignment follows through
`c3c51e6f070c774c103eeb7f71c759e3ebfda4ec`.
