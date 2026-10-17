# Corrected Lyapunov refinement run

This is a fresh full PoC 059 mechanism-screen rerun after correcting the RK4 step-size use in the isolated-cell Lyapunov estimator. The earlier session is preserved unchanged. This new run does not train an AI readout and does not replace or alter the preregistered task-level experiment.

- Source commit: `5ec3a445e2c8db66709250a05554c476878e5c81`
- Command: `OPENBLAS_NUM_THREADS=1 python3 experiment.py --seeds 11 29 47 --output <new-directory>`
- Runtime: local Linux, Python 3.12.14, NumPy 2.3.5
- Isolated-cell estimates: 0.0187948805 at dt=0.02 and 0.0187948930 at dt=0.01 per model time unit. Each RK4 intermediate stage uses the same step as the final update.
- Hosted GitHub Actions status was not observable through the available workflow connector when this session was recorded; this is local-run evidence only.

SHA-256:

- `results.json`: `c97b05c454ce4d9f1a720909eddc4cd801807f1122ad37fdd4b5f996a556395d`
- `report.md`: `d2058eb843a624ecdfc7d97e2518c509a4e50165400c2766354e87408f89ab81`
