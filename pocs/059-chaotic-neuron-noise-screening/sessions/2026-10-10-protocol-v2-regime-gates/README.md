# Preregistered protocol v2 regime gate

This run evaluates the isolated-cell Lyapunov gates from TASK-PREREGISTRATION.md v2, before task fitting or task-score inspection.

Decision: **inconclusive; stop before task benchmark**, exactly as preregistered. I=3.25 passed the chaotic gate for 10/10 seeds. I=2.90 met the regular gate for 6/10 seeds, below the required 8/10. No alternate I value was searched, and no task-level score was produced.

Reproduce from the PoC root with Python and NumPy:

    OPENBLAS_NUM_THREADS=1 python3 pocs/059-chaotic-neuron-noise-screening/sessions/2026-10-10-protocol-v2-regime-gates/run-regime-gates.py --output /tmp/poc059-regime-gates

- Protocol: v2, commit 7c89467332db536d8250c0234463a87576a0fca7
- Model source: commit 5ec3a445e2c8db66709250a05554c476878e5c81
- Runtime: Python 3.12.14, NumPy 2.3.5
- Seeds and all per-seed estimates: results.json
- No AI task benchmark was run.

SHA-256:

- run-regime-gates.py: 4486f16ac7f9e0f78aa39bdd5cd0c3b45f5f806b413782c5e6051c51d73b4eb4
- results.json: 9f0416f2ddbb7830aec51f221f6cc07f8c96fcc38e1423a817020f8ba3f1073c
- report.md: 7b5d86b15b13308abeed82ac2c00dc7aa2b12d0c273a17c168ac5f219463aa4d
