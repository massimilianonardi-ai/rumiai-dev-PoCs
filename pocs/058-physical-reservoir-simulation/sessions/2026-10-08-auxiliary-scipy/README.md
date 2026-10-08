# Auxiliary Linux ODE run — 2026-10-08

Source: `b9d371e33f52f28c40ccf5dee2b5c48ad56231bf`, identical experiment source SHA-256 recorded in results.json. Execution occurred before the connector created that commit; the local source was committed as `3fefac6ec12016af2510a5edab7120f0be6c3379` with identical tree content. These are the same source bytes, not evidence relabeled onto changed source.

Invocation: `OPENBLAS_NUM_THREADS=1 python experiment.py --engine scipy --output /tmp/reservoir-full`.

Full default workload: three seeds, eight models, training/validation/test 1200/500/700 per seed after 150 warmup samples. Exit 0. Total simulated experiment wall time about 107 seconds. Environment and exact dependency versions are in results.json. ngspice was absent on this host: this session is ODE/delay-model evidence only.

The explicit missing-ngspice path and existing-output-directory protection were also exercised and both returned exit 2 with the documented diagnostic. They are operational checks, not AI or hardware evidence.

## Interpretation

- Linear RC retains some input history (memory score approximately 5.87/12) but cannot represent the square of a symmetric input through a linear readout.
- Diode cells provide a useful static nonlinear representation (mean square NMSE approximately 0.148 uncoupled, compared with 1.002 for linear RC), with no demonstrated temporal advantage over simple digital lag predictors.
- The quadratic digital baseline spans all three synthetic tasks and solves them nearly exactly. This is expected and explicitly acknowledged, not a failure of the experiment.
- In this optical configuration, feedback does not improve the memory score. A quadrature-biased modulator with a bipolar mask is a restrictive candidate: without feedback the transfer about its constant offset is odd, whereas the square target is even. This is a model limitation, not a general limitation of optics.
- Excellent clean-data conditioning is insufficient: frozen readouts amplify the specified noise and parameter perturbations dramatically in several electronic cases. These nominal candidates are not ready for a hardware-performance claim.
- Timestep refinement, analytic responses and optical causality checks passed. Refining optical sampling from 8 to 16 ticks did not change the conclusion of temporal NMSE near 1.

No hardware energy/speed measurements, physical calibration, spiking, chaos classification or local learning were performed. The remaining research question is which architecture/encoding/regularization improves the accuracy–robustness tradeoff on a predeclared new evaluation, not whether to claim a winning prototype from these results.
