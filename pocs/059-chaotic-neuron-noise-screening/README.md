# PoC 059 — chaotic-neuron synchronization and noise screening

This PoC tests a narrow mechanism question: when identical nonlinear neuron-like units receive the same signal, does diffusive coupling reduce disagreement caused by independent disturbances? What happens to the shared trajectory under common-mode disturbances, and how much state diversity is lost?

This is an exploratory numerical screening, not an AI-performance benchmark, not a circuit simulation and not a physical measurement. The bounded model uses open-source Python and NumPy on Linux. It complements PoC 058, which measured electrical/optoelectronic reservoir features but did not include chaotic neurons or synchronization.

## Run on Ubuntu Linux

    sudo apt-get update
    sudo apt-get install -y python3-venv
    python3 -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt
    OPENBLAS_NUM_THREADS=1 .venv/bin/python experiment.py --output results

A short smoke test:

    OPENBLAS_NUM_THREADS=1 .venv/bin/python experiment.py --quick --seeds 11 --output quick-results

The full run uses three seeds and 1,200 input symbols per seed, after 100 warmup symbols. The output path must not already exist. The script fails if the isolated-cell finite-time largest-Lyapunov estimate is non-positive at either of its two time steps.

## Model and perturbations

The model is the three-variable Hindmarsh–Rose neuron model. It has 16 identical cells, each with a small independent initial-state perturbation. All cells receive the same iid input, injected as an external-current drive of amplitude 0.3. The coupling term is all-to-mean diffusive coupling on the membrane-potential-like state x:

    dx_i/dt = y_i - a*x_i^3 + b*x_i^2 - z_i + I + 0.3*u(t)
              + k*(mean_j(x_j) - x_i)
    dy_i/dt = c - d*x_i^2 - y_i
    dz_i/dt = r*(s*(x_i - x_r) - z_i)

Parameters: a=1, b=3, c=1, d=5, r=0.005, s=4, x_r=-1.618, I=3.25. Integration uses fixed-step classical RK4 with dt=0.02 and 8 substeps per input symbol. The isolated unforced-cell finite-time Lyapunov estimate is also recomputed at dt=0.01; both estimates are reported. This checks the operating-regime indicator, not trajectory-level convergence of the entire driven network.

The coupling sweep is k in {0, 0.05, 0.2, 0.5}. Each condition starts from the same seed-specific initial population and input. Noise cases are compared against the matching clean trajectory:

- independent process disturbance: Gaussian state kick added independently to each cell's x once per input symbol;
- common-mode process disturbance: the same Gaussian state kick added to every cell's x once per input symbol;
- current mismatch: fixed independent ±1% variation of external current per cell;
- clean: no injected disturbance.

For the process-noise cases, the standard deviation is 5% of the clean population x standard deviation for that seed/coupling. These are explicit model-level sensitivity probes. They are not calibrated models of thermal/shot noise, transistor mismatch, ADC noise, fiber noise or manufacturing tolerances.

## Metrics and interpretation

- Pair disagreement: RMS deviation of cells from their population mean, normalized by the clean x standard deviation.
- Collective shift: RMS difference between the noisy and clean population-mean trajectories, on the same scale.
- Total trajectory shift: RMS noisy-vs-clean difference across cells and time, on the same scale.
- Clean effective rank: entropy-based rank of the covariance of the 16 x traces.

The corrected positive Lyapunov estimates verify the isolated, unforced cell's operating regime for the stated finite-time estimator. The shared input and coupling change the network dynamics; this estimate does not certify chaos in the driven network. Irregular output alone is not the chaos gate. The 2026-10-08 session's dt=0.01 estimate is invalid because its RK4 intermediate stages used dt=0.02; retain that original record, but use the corrected rerun below for step-refinement evidence.

This screening deliberately has no trained readout and no AI task score. It only tests how coupling redistributes model-level perturbations and state diversity. A later task-level comparison needs matched non-chaotic and digital baselines, train/validation/test separation, and fixed noise assumptions before reading any AI advantage into these dynamics.

## Screening results

Three seeds gave the following descriptive means (SD is across seeds, not a confidence interval):

- At k=0.5, independent process noise reduced normalized pair disagreement from 0.777 ± 0.025 at k=0 to 0.480 ± 0.024.
- The same condition increased total trajectory shift from 1.059 ± 0.035 to 1.312 ± 0.096; collective shift rose from 0.425 ± 0.045 to 1.130 ± 0.137.
- Clean effective rank fell from 3.63 ± 0.47 at k=0 to 2.24 ± 0.21 at k=0.5.
- Common-mode disturbance at k=0.5 still produced a collective shift of 1.075 ± 0.238; synchrony did not restore the clean collective trajectory.
- Intermediate coupling values were non-monotonic for some metrics.

Interpretation: stronger coupling can suppress differences between cells under independent perturbations, while not suppressing the error of the network's shared trajectory. It also reduces diversity. In this screening the stronger coupling increased, rather than decreased, the overall trajectory shift. This is a mechanism-level tradeoff, not evidence that synchronization improves a useful AI computation.

The original full per-seed evidence is preserved in sessions/2026-10-08-noise-screening/. Its dt=0.01 Lyapunov field is not a valid refinement estimate. The corrected full rerun, with each RK4 stage using the requested timestep, is in [sessions/2026-10-10-lyapunov-rk4-correction/](sessions/2026-10-10-lyapunov-rk4-correction/). It reports 0.01879 at dt=0.02 and 0.01879 at dt=0.01, per model time unit; this only validates the isolated-cell indicator at two timesteps, not the coupled driven network.

## References

- Hindmarsh & Rose (1984), A model of neuronal bursting using three coupled first order differential equations, DOI: https://doi.org/10.1098/rspb.1984.0024
- Example analysis reporting chaotic multi-timescale behavior for the selected parameter set: https://www.nature.com/articles/srep46472
- Pérez et al., How synchronization protects from noise: https://pmc.ncbi.nlm.nih.gov/articles/PMC2797083/
- BrainScaleS-2 documentation, mixed-signal analog core with digital configuration and control: https://electronicvisions.github.io/documentation-brainscales2/latest/brainscales2-demos/fp_brainscales.html
