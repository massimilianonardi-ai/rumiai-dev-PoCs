# PoC 058 — electrical and optoelectronic reservoir simulation

Question: can small, explicit physical component models provide useful fading memory and nonlinear features for a digitally trained readout? What fails when numerical resolution or components change?

This is experimental code for `rumiai-dev/handoff/chaotic-dynamics-rumiai-research.md`, not a product command, brain emulation or new RumiAI architecture. It uses open-source **ngspice, NumPy and SciPy**. No GPU, cloud account, external dataset or proprietary simulator is required after installation. Python is deliberately used for the existing numerical solver/linear-algebra ecosystem; it is not a product-language decision.

## Run on Ubuntu Linux

From this directory:

```sh
sudo apt-get update
sudo apt-get install -y ngspice python3-venv
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
OPENBLAS_NUM_THREADS=1 .venv/bin/python experiment.py --output results
```

The default engine is ngspice; its absence is an error, never a silent fallback. For explicit mathematical screening without SPICE:

```sh
OPENBLAS_NUM_THREADS=1 .venv/bin/python experiment.py --engine scipy --output results-ode
```

A shorter development run uses `--quick --seeds 11`. Full default runs use three seeds and independent streams containing 1,200 training, 500 validation and 700 test observations each, plus 150 discarded warmup symbols per stream. `--seeds` accepts a space-separated list of integer seeds. Use a new output directory for every execution: existing evidence is never overwritten. A successful run exits 0; dependency, simulation or numerical-check failure exits nonzero. Files are written only inside the requested output directory; ngspice subprocesses are bounded to 180 seconds each.

GitHub Actions runs automatically for source changes on the experimental branch. The first hosted execution is [run 37754200236](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/37754200236), linked from [draft PR 1](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/pull/1). After the workflow is accepted on the default branch, it can also be launched through **Actions → PoC 058 physical reservoir simulation → Run workflow**. The workflow installs dependencies on Ubuntu 24.04 and invokes the same full experiment with ngspice. It uploads netlists, circuit logs, sampled circuit trajectories, predictions, JSON and Markdown results as a 30-day artifact. Runtime depends on the host; the workflow allows 25 minutes. No RumiAI runtime installation is needed.

## Physical models

### Electrical: explicit component netlists and independent ODE

Sixteen capacitor voltages are sampled at the end of each 1 ms input symbol. Each branch has a 10 kOhm input resistor, a capacitor (30–600 nF), an ideal voltage source with fixed random input gain/offset and, for nonlinear variants, two antiparallel diodes. The coupled variant adds a 100 kOhm resistor between adjacent nodes in a ring.

For node i the ODE is:

```
C_i dv_i/dt = (a_i u + b_i - v_i)/R_i
              - 2 Is sinh(v_i / (n V_T))
              + Gc (v_(i-1) + v_(i+1) - 2 v_i)
```

Omit the diode term for `rc-linear`, and coupling for uncoupled models. Diode parameters are Is=1 nA, n=1.8, temperature=27 C. The ODE clips the exponential argument only far outside the intended operating range as a solver safeguard. ngspice uses its diode device model, not a software reservoir substituted for the circuit. Zero capacitor voltages are the initial conditions. Input transitions are linear ramps occupying 1% of a symbol, then held constant; the ODE and SPICE use the same waveform.

These are generic junction models, not manufacturer-calibrated parts: diode capacitance, detailed temperature variation, amplifier rails/bandwidth/output impedance, ADC loading and wiring parasitics are not modeled. Behavioral voltage sources represent the input encoder/offset drivers, whose implementation and power remain unmeasured. There are no programmable synapses in this circuit. Passive coupling is fixed.

### Optical/fiber: reduced component model

One Mach–Zehnder intensity modulator, a 1 mW laser, a 50:50 splitter, photodiode responsivity 0.8 A/W, 2 kOhm transimpedance and a 20 ns detector/filter time constant form a nonlinear delayed loop. An optical branch supplies delayed feedback and a matched detector/filter; the other supplies the observed voltage. Equivalent delay/filter commutation is assumed. The 17-slot delay is 170 ns: at group index 1.468 this corresponds to **34.72 m of fiber**, not persistent memory. Loss is 0.2 dB/km. Fixed mask slots last 10 ns, with 16 slots per input symbol; 16 reported states are sequential samples of one device, not parallel physical neurons.

```
tau dz/dt = -z + A cos²(pi/4 + pi V/(2 Vpi))
V = 0.7 mask(t) u(t) + g [eta z(t-delay) - eta 0.4 V]
A = P_laser × splitter × responsivity × transimpedance = 0.8 V
Vpi = 1 V, g = 1.6 (feedback) or 0 (ablation)
eta = 10^(-loss_dB_per_km × fiber_km / 10)
```

The history before time zero is z=0. Electrical subtraction supplies the feedback bias. The nonlinear forcing is held within each tick; `scipy.signal.lfilter` integrates the detector's first-order response exactly for that held forcing. This narrow delay discretization is checked at 8, 16 and 32 ticks per slot. A full 16-tick benchmark also checks task sensitivity with a refitted readout. It is not an electromagnetic simulation or a reproduction of any published apparatus. Fiber dispersion, polarization, phase drift, laser/shot/thermal noise, component bandwidth outside the stated filter, modulator insertion loss, feedback electronics and ADC/DAC are not calibrated. This model cannot establish build feasibility or optical energy efficiency.

The electrical and optical clocks intentionally differ; only the discrete input task is shared. This is a functional comparison, not an equal-bandwidth, area, energy or cost comparison.

## Learning tasks and comparisons

Each input stream is independently drawn uniformly from [-1,1]. All models receive the same causal information in each split, restart from zero state and discard warmup. Test labels never enter fitting or hyperparameter selection.

1. Nonlinear temporal regression: `y[k] = u[k-1] u[k-3] + 0.5 u[k-6]`.
2. Fading memory: reconstruct each of `u[k-1]` through `u[k-12]` with its own readout.
3. Instantaneous nonlinear representation: reconstruct `u[k]²`.

These synthetic tasks isolate mechanisms; they are not evidence of performance on speech, vision, LLMs or real sensors. All learning is a **digital ridge-regression readout**. No on-device training, plasticity, adaptation or autonomous chaos is claimed.

Comparisons: 16 explicit input lags with a linear readout; those lags with all pairwise quadratic products (152 features); a fixed 16-state digital echo-state network; linear RC, uncoupled diode RC, coupled diode RC; optical with feedback removed; optical with fiber feedback. The quadratic model intentionally spans the task exactly and is a strong reference, not an equal-size hardware competitor. The ESN and physical parameters are fixed working configurations, not optimized representatives of their model families. The same six ridge penalties are selected separately for each target using validation data only. Features and targets are normalized using training data only. Fitting uses only training data even after selecting the penalty.

Report nonlinear/static NMSE (MSE divided by test target variance), individual delay R², their clipped-positive sum over 12 delays, feature count, readout coefficient count and effective rank. The optical delay line and digital buffers store more state than the reported observable dimension; the equal 16-feature count is not equal physical resources. All state-generation and readout costs would need inclusion in any hardware comparison.

## Checks and perturbations

- Electronic ODE resolution/tolerance refinement; when ngspice is selected, independent SPICE-versus-ODE trajectory comparison and halved SPICE maximum timestep, for linear and coupled nonlinear networks.
- Analytic constant-input RC and no-feedback optical detector responses.
- Optical trajectory refinement and full-task refinement; causality under changed future input.
- Independent seeds/data splits, finite outputs and source/dependency/parameter recording.
- Frozen-readout sensitivity to Gaussian readout noise (standard deviation 1% of each training feature's standard deviation).
- Frozen-readout component perturbation: each electrical R and C receives a fixed independent uniform ±5% change; the optical detector time constant increases by 5%. These are different stated sensitivity probes, not equally severe manufacturing models. Drift runs start from zero on the same test input and warm up; they represent a changed calibrated device, not an abrupt in-stream fault or retraining.

Very large error amplification is a valid negative finding, not a reason to hide the run. Numerical checks assert engineering tolerances, not a required AI benchmark win.

## Outputs and evidence

`report.md` is the readable summary; `results.json` records every seed, parameter, version, source SHA-256, numerical check, metric and chosen penalty. Input streams/targets are saved in `inputs-<seed>.npz`, and held-out temporal predictions in CSV. In ngspice mode each case retains its generated `circuit.cir`, `ngspice.log` and `states.dat`. `sessions/` retains selected, explicitly identified run evidence; generated full trajectories remain in workflow artifacts.

Wall-clock time is simulator cost on the executing host, not physical inference speed. Hardware latency, energy, learning efficiency and superiority over current AI are **not established**. A build decision requires a more robust candidate, realistic component models and measurements on a small circuit. This first experiment deliberately reports failures as well as successes.

## Primary references

- ngspice manual (circuit elements, diode model, transient analysis, behavioral sources and `wrdata`): https://ngspice.sourceforge.io/docs/ngspice-manual.pdf
- SciPy `solve_ivp` (LSODA adaptive ODE integration): https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html
- SciPy `lfilter`: https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.lfilter.html
- Paquot et al., optoelectronic reservoir computing, Scientific Reports 2, 287 (2012): https://arxiv.org/abs/1111.7219 . Motivation for delayed optoelectronic processing; this PoC is not a numerical reproduction of that paper.
