# GitHub-hosted ngspice run — 2026-10-08

- Source commit: `b9d371e33f52f28c40ccf5dee2b5c48ad56231bf`.
- Workflow: https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/37754200236
- Job ID: `113234590760`; status: completed/success.
- Host: GitHub-hosted Ubuntu 24.04; Python 3.12.14; NumPy 2.3.5; SciPy 1.17.0; ngspice from Ubuntu's package repository.
- Invocation: `python pocs/058-physical-reservoir-simulation/experiment.py --engine ngspice --output results`, with one OpenBLAS/OMP thread.
- Full default workload: seeds 11/29/47; 1200/500/700 train/validation/test samples plus 150 warmup symbols each; eight model variants.

`report.md` is the report printed by the real experiment, extracted from the completed job log with timestamp prefixes removed. It is retained here as compact revision-specific evidence. The full results.json referred to by that report, all generated circuit netlists, logs, input arrays, predictions and raw circuit trajectories are in the workflow artifact:

https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/37754200236/artifacts/11539771228

Artifact ID: `11539771228`; ZIP size: 738061516 bytes; SHA-256: `36dceff7e60c2ab446130b0a8fb07ccdbde4d9e8ecf152e382f146fcd89df999`. Artifact expires on 2026-11-07 according to GitHub metadata. This repository retains the compact report after expiry; a rerun of the pinned source regenerates full evidence.

The maximum SPICE-versus-ODE voltage discrepancies in the 60-symbol probes were approximately 41.3 microvolts (RC) and 25.7 microvolts (coupled diodes). Halving SPICE's maximum timestep changed sampled voltages by at most 13.3 and 12.2 microvolts. The full benchmark agrees closely with the separate auxiliary SciPy session. These checks establish consistency of the specified simulators/models over this experiment, not calibration against physical devices.

All checks and the hosted run passed. The model-level negative findings also remain: no physical candidate beats simple delayed digital predictors on temporal regression; component/readout perturbations expose fragility; the optical candidate is a reduced model whose present encoding/operating point does not solve the selected nonlinear tasks. No actual circuit, energy or hardware speed measurement was performed.
