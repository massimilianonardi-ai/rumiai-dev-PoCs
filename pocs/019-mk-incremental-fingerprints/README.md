# PoC 019 — mk incremental fingerprints

Status: Experiment completed locally; working design not yet promoted
Date: 2026-09-22

## Question

What is the smallest deterministic input/output identity needed for one-shot incremental `mk` execution without introducing watch/session semantics or an artifact-cache subsystem?

The experiment starts from the current version-2 lifecycle model and preserves these existing boundaries:

- project dependency, operation prerequisite and external requirement remain distinct;
- outputs remain named project data;
- `collection.after` requires current-request satisfaction;
- result/output evidence must not be inferred from stale pathnames alone;
- managed persistent state must use `state-path`;
- cache state is non-authoritative/regenerable.

## Candidate declarative shape

Incremental behavior is explicit and opt-in per ordinary operation:

```json
{
  "operations": {
    "compile": {
      "incremental": {
        "inputs": {
          "sources": {"collection": "sources"},
          "config": {"path": "build.conf"}
        }
      },
      "requirements": ["compiler"],
      "action": {
        "type": "process",
        "command": "cc",
        "args": ["..."]
      },
      "outputs": {
        "artifact": {"path": "out/app"}
      }
    }
  }
}
```

`inputs` is a named map. The experiment supports three input sources:

```json
{"path": "config.json"}
{"collection": "sources"}
{"output": {"operation": "generate", "name": "artifact"}}
```

The existing named `outputs` declarations remain the output identity surface. No second output declaration is introduced under `incremental`.

An operation that opts into incremental behavior must declare at least one output. A side-effect-only action has no persistent evidence that can validate a previous success and therefore is not incrementally skippable in the first baseline.

## Data dependency

An incremental input that references another operation's named output creates a data dependency on that producer.

The consumer does **not** also need to duplicate the same relation in `prerequisites`.

This follows the existing distinction:

```text
prerequisite
    explicit work/order relation

output input
    data relation: consumer needs producer evidence
```

The same declarative-economy rule applies to a collection input whose collection has an `after` barrier: the barrier's producer is reached through the collection relation.

## Fingerprint

The PoC computes a SHA-256 fingerprint from a canonical structured representation of the effective operation.

The candidate fingerprint includes:

- effective operation definition, including action, incremental input declarations, outputs, prerequisite names and requirement names;
- selected profile/project environment as reflected in the effective model;
- the complete effective environment passed to the process action;
- resolved action executable identity when it can be observed;
- resolved concrete provider identity for every referenced facility requirement;
- each named input's resolved identity and content snapshot.

Input snapshots are content-based.

Regular-file identity includes:

```text
logical pathname identity
type
mode
size
SHA-256 content digest
```

Directory identity recursively includes a lexical list of contained directories/files and the corresponding mode/content information.

File modification time is deliberately excluded. Touching a file without changing its content does not make an operation stale.

The experiment treats symlink/special-file input/output cases conservatively as non-cacheable rather than inventing an incomplete first contract.

## Output validation

A fingerprint match alone is insufficient.

A previous success is reusable only when every declared output currently exists in a supported fingerprintable form and its current output snapshot exactly matches the snapshot recorded after the successful execution.

Therefore:

```text
same operation/input fingerprint
+ current outputs equal recorded successful outputs
    -> up-to-date
```

Deleting, replacing or modifying a declared output invalidates the record.

The first baseline stores freshness metadata only. It does not store artifact bytes and cannot restore deleted outputs from a remote/local artifact cache.

## Current-request meaning of a hit

A cache hit is not modeled as an operation that simply disappeared.

The experiment introduces the lifecycle state:

```text
up-to-date
```

An `up-to-date` operation is a **verified current-request success-equivalent**:

- ordinary prerequisites may be satisfied by it;
- a `collection.after` barrier may be satisfied by it;
- its validated named outputs become current-request output evidence;
- downstream incremental inputs may consume those outputs.

This is required for generated-source pipelines. Otherwise an incremental generator would be skipped but its `collection.after` consumer could never become authoritative.

A future product implementation must reconcile result-observation semantics consistently: a validated prior success may be reused as successful current-request lifecycle evidence, while failed executions are never cached.

## Failure behavior

Only successful executions can update a freshness record.

A failed action:

- remains a real failure/current-request result according to existing semantics;
- does not create or refresh an incremental record;
- therefore cannot become an `up-to-date` hit on the next request.

If a successful action does not leave every declared output present and fingerprintable, the request may still preserve the existing operation-success semantics, but no reusable incremental record is written.

## State location and authority

The production state root should be obtained through:

```text
state-path user sys mk cache
```

The first baseline is user-scoped because incremental build freshness is ordinary per-user development state, not authoritative system configuration.

Inside that returned cache area, the PoC model isolates records by a SHA-256 key derived from the canonical project root and then by operation identity.

Conceptually:

```text
<state-path user sys mk cache>/
    projects/
        <sha256(canonical-project-root)>/
            operations/
                <sha256(operation-name)>.json
```

The exact subordinate representation is private `mk` cache format, not a new public state-path contract.

Using canonical project identity deliberately makes a copied/moved checkout a cache miss in the first baseline. Cross-checkout/shared cache identity is a separate future concern.

Cache state is non-authoritative:

- missing record -> miss;
- unreadable/invalid/corrupt record -> miss;
- unsupported cached schema -> miss;
- `--plan` may read cache state but does not create/update it.

A cache defect must not be able to turn an operation that should execute into a false success.

## Requirements and execution environment

The selected concrete provider identity of each existing `pkg` facility requirement participates in the fingerprint. Changing the effective provider therefore invalidates the operation even when project files are unchanged.

The candidate also fingerprints the complete effective environment passed to a process action and the observable executable identity. This intentionally favors correctness over hit rate for the first baseline.

External behavior not represented by project inputs, effective environment, executable identity or declared requirements remains outside deterministic incremental identity. A cacheable operation must not silently depend on undeclared mutable external state.

## Project dependencies

Project-to-project dependency delegation remains recursive and unchanged.

The parent still invokes the child `mk` request. The child decides whether its own operations are `up-to-date`.

The first incremental baseline does not add:

- request-wide exactly-once behavior;
- cross-sibling de-duplication;
- a parent-owned flattened dependency fingerprint;
- a shared artifact cache across projects.

This preserves MK-28 through MK-35.

## Stress scenarios

The local executable experiment verifies:

1. first request executes and records successful freshness state;
2. an unchanged second request becomes `up-to-date`;
3. mtime-only changes do not invalidate;
4. input-content changes invalidate;
5. declared-output modification invalidates;
6. action-definition changes invalidate;
7. selected requirement-provider identity changes invalidate;
8. a verified `up-to-date` producer satisfies `collection.after`;
9. changed generated content propagates to the consumer;
10. producer repair that restores the same downstream input content need not rerun the downstream operation;
11. an output input creates its producer data dependency without an extra prerequisite;
12. corrupt non-authoritative cache state degrades to a miss;
13. `--plan` does not create persistent cache state;
14. canonical project identity prevents accidental cache reuse after copying the checkout;
15. an incremental side-effect-only operation with no declared output is rejected;
16. a failed action never creates reusable freshness state.

The experiment passes locally with Node.js 22.16.0.

## Result

The experiment supports this minimal incremental model:

```text
explicit incremental operation
+ named inputs
+ existing named outputs
+ effective action/environment/tool identity
+ resolved requirement-provider identities
        |
        v
content fingerprint

previous successful fingerprint
+ current declared outputs equal recorded outputs
        |
        +-- yes -> up-to-date current-request satisfaction
        |
        +-- no  -> execute

successful execution
        -> observe outputs
        -> atomically refresh non-authoritative cache record
```

This is freshness metadata, not artifact caching.

## Still outside the candidate baseline

The PoC does not settle or implement:

- incremental behavior for derived `map-process` members/provider-level templates;
- artifact storage/restoration;
- remote/shared cache;
- relocatable project cache identity;
- watch/hot-update sessions;
- parallel scheduling;
- request-wide dependency de-duplication;
- persistent caching of failures;
- symlink/special-file fingerprint semantics.

Those should not be pulled into the first incremental work unit without a concrete requirement.
