# PoC 059 — task-level preregistration

Status: **preregistered design; no task-level outcomes inspected**  
Protocol version: 2 (amends v1 before task-level execution)  
Protocol date: 2026-10-10

Version 2 amendment: corrected the Lyapunov timestep-refinement requirement after finding that PoC 059's existing half-step estimator used the base `DT` in its RK4 intermediate stages. No task-level scores have been inspected. Version 1 is retained in Git history; this version supersedes it.  
Scope: simulation only; this file is committed before implementation/execution of the task-level comparison.

## Question

On a fixed temporal nonlinear regression task, do chaotic Hindmarsh–Rose (HR) states give a better accuracy/robustness tradeoff than a matched non-chaotic HR regime when state count, input, readout and tuning budget are held constant? Does coupling change that tradeoff, and does it do so differently under independent process noise, common-mode process noise, readout noise and fixed parameter mismatch?

This tests task utility of a candidate dynamical mechanism. It does not test brain equivalence, physical hardware, energy, speed or superiority over AI systems generally.

## Frozen task and data protocol

- Input symbols are iid uniform on [-1, 1], driven identically into every unit.
- Target at symbol k: y[k] = u[k-1]u[k-3] + 0.5u[k-6], matching PoC 058's temporal nonlinear regression target.
- For each of 10 preregistered seeds (11, 29, 47, 71, 89, 101, 131, 149, 173, 197), generate disjoint streams of 1,200 train, 500 validation and 700 test symbols plus 100 warmup symbols. Restart all systems from their specified initial state per split. Test streams and labels are never used to choose parameters, features, coupling, noise scales or ridge penalty.
- Primary score: held-out test NMSE, MSE divided by variance of that split's target. Report per-seed values, mean, SD and paired differences. No significance claim from 10 seeds alone.
- Secondary diagnostics: pair disagreement, collective and total state displacement from the same-condition clean trajectory, clean-state effective rank, and largest Lyapunov estimate for isolated operating regimes. Report task scores with these diagnostics; synchrony or low NMSE alone is not sufficient.

## Reservoir conditions

- 16 HR units, shared scalar input, observed feature is x from each unit at the end of each symbol (16 readout features).
- Use PoC 059 equations and parameters, with two operating regimes fixed before results: candidate regular HR with I=2.90 and candidate chaotic HR with I=3.25; other parameters remain a=1, b=3, c=1, d=5, r=0.005, s=4, x_r=-1.618. Input drive amplitude 0.3, dt=0.02, 8 RK4 substeps per symbol.
- Coupling k in {0, 0.05, 0.2, 0.5}, all-to-mean diffusive coupling on x.
- Classify regimes on isolated unforced dynamics before task fitting. Estimate the largest Lyapunov exponent using a two-trajectory Benettin-style finite-time estimator, across the 10 preregistered seeds, with coherent RK4 steps h=0.02 and h=0.01. Every RK4 intermediate stage and final update must use the same h; in particular, the h=0.01 run must use 0.01 in all four stages. Burn in for 100 model-time units, then accumulate 1,000 renormalized intervals of 0.2 model-time units; initial separation 1e-7, renormalized after every interval. Use initial state [-1.3078,-7.3218,3.3530] plus independent N(0,0.01) perturbation per seed. Record the per-seed estimates and code revision. Chaotic gate: positive estimate at both steps for at least 8/10 seeds. Regular gate: non-positive estimate at both steps for at least 8/10 seeds. If either candidate fails its gate, mark the chaotic-vs-regular comparison **inconclusive**; do not search new I values in this protocol or use task-test performance to choose the regime. A revised regime requires a new protocol version before running it.
- Use identical initialization, input stream and readout fitting grid across paired conditions. The same unit-identity/initialization seed is paired between regular and chaotic conditions.

## Readout and baselines

- Fit digital ridge regression on the 16 x features. Standardize features and targets on train only; select alpha from {1e-6, 1e-4, 1e-2, 1, 100, 10000} using validation NMSE only; refit selected alpha on train only and score once on test.
- Include the task-matched linear-lag baseline (16 causal input lags, linear readout), a 16-state digital ESN, and PoC 058's quadratic-lag reference. The quadratic-lag baseline exactly spans this target and has 152 features; label it as an upper reference, not a matched hardware/state budget.
- Report parameter, feature and tuning budgets. No task-specific reservoir or baseline hyperparameter search beyond the stated alpha selection. Any ESN setup must be fixed before task runs and reported with its seed and spectral radius.

## Perturbation protocol

Evaluate each frozen clean-trained readout on clean test data and four separate test-only perturbation channels. Use the same per-seed perturbation draws for paired coupling/regime conditions where applicable.

1. Independent process: Gaussian x-state kick at each symbol boundary, independent per cell; sigma = 5% of that condition's clean train-state SD.
2. Common-mode process: same Gaussian x-state kick applied to all cells at each symbol boundary; same sigma convention.
3. Readout: independent additive Gaussian noise on the 16 standardized observed features; sigma = 1% of each feature's train SD before standardization (equivalently 0.01 after scaling).
4. Static mismatch: fixed independent uniform ±1% variation of external current I per unit, drawn once per seed and held through the entire test sequence. This is a model-level mismatch proxy, not a component calibration.

Do not combine channels in the primary report. Do not retrain the readout under perturbed test conditions. Also report the clean-trained model on clean test as the reference. The digital ESN baseline is fixed to PoC 058's update: 16 states, x0=0, W drawn iid standard normal with the data seed and scaled to spectral radius 0.8, Win iid uniform [-1,1], bias iid uniform [-0.3,0.3], and x[k+1]=0.5*x[k]+0.5*tanh(W@x[k]+Win*u[k]+bias). Use its x states at each symbol boundary as 16 features. If an implementation cannot apply a perturbation without changing another condition, document and stop before looking at task scores.

## Decision and reporting rules

- Primary comparison is paired test NMSE: chaotic versus regular HR, separately at each coupling and on clean test. Robustness comparisons are paired noisy-test NMSE shifts relative to each condition's own clean score, kept separate by noise channel.
- Report all ten seed values and all conditions, including failed/numerically unstable runs; no outlier removal. If numerical integration fails or a metric is non-finite, count it as a failed run and investigate only after preserving the original output.
- No post-hoc claim of benefit based on choosing the best coupling. Show the full coupling curve and treat the coupling with lowest validation NMSE as the only selected setting for a secondary summary; report the paired test score at that selected setting without rerunning selection. Per-condition tuning from validation is allowed only where explicitly specified above.
- Do not claim a win from accuracy alone if state diversity collapses or a noise channel causes severe degradation. State a task benefit only if paired scores and uncertainty support it; any broader AI/hardware claim remains out of scope.
- Save source revision, environment, all seeds, raw per-seed scores, parameters, noise draws/seeds, regime-gate estimates and output hashes in a versioned session directory. Preserve this protocol unchanged; corrections require a new version with reason and date.

## Explicit non-claims

This is a numerical model using synthetic inputs, not a calibrated circuit/fiber simulation. State kicks and ±1% current mismatch are not thermal, shot, ADC, fabrication or drift measurements. No BrainScaleS-2 hardware, physical component, energy, latency, local learning or RumiAI runtime integration is involved.
