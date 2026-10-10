# PoC 059 protocol v2 — preregistered regime gates

The isolated-cell operating-regime gates were evaluated before any task-level model fitting or task score inspection.

| Candidate | I | Seeds satisfying criterion | Required | Result |
|---|---:|---:|---:|---|
| regular_candidate | 2.90 | 6/10 | 8/10 | fail |
| chaotic_candidate | 3.25 | 10/10 | 8/10 | pass |

Protocol decision: **inconclusive_stop_per_preregistered_gate**.
The chaotic candidate passes; the regular candidate fails (6/10, below the preregistered 8/10 threshold). Protocol v2 therefore requires stopping without selecting another I value or running the task benchmark.

Every RK4 stage uses the same step size as the final update. Per-seed estimates and full estimator settings are in results.json.
This gate describes isolated-cell finite-time dynamics; it does not classify the driven, coupled network or establish AI utility.
