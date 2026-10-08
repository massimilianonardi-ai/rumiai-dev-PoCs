# Physical reservoir simulation — results

Electronic engine: **ngspice**. Seeds: [11, 29, 47]. Train/validation/test: (1200, 500, 700).

NMSE is held-out mean squared error divided by target variance (lower is better).
Memory score sums positive held-out R² across delays 1–12 (higher is better).

| Model | Features | Temporal NMSE mean ± SD | Memory score mean | Square NMSE mean |
|---|---:|---:|---:|---:|
| linear-lags | 16 | 0.56100 ± 0.01346 | 12.000 | 1.00643 |
| quadratic-lags | 152 | 0.00000 ± 0.00000 | 12.000 | 0.00000 |
| digital-esn | 16 | 0.81171 ± 0.01947 | 3.863 | 0.15607 |
| rc-linear | 16 | 0.83227 ± 0.02126 | 5.868 | 1.00193 |
| diode-uncoupled | 16 | 0.84469 ± 0.01897 | 4.320 | 0.14834 |
| diode-coupled | 16 | 0.82980 ± 0.01112 | 4.280 | 0.17054 |
| optical-no-feedback | 16 | 1.00084 ± 0.00094 | 0.932 | 1.00173 |
| optical-fiber | 16 | 0.99850 ± 0.00124 | 0.711 | 1.00314 |

SD is descriptive across the listed seeds, not a confidence interval.

## Frozen-readout sensitivity

| Model | Clean NMSE | 1% readout noise NMSE | 5% component perturbation NMSE |
|---|---:|---:|---:|
| rc-linear | 0.83227 | 110.88495 | 230.87802 |
| diode-uncoupled | 0.84469 | 5.58501 | 11.12598 |
| diode-coupled | 0.82980 | 2.65503 | 6.35772 |
| optical-no-feedback | 1.00084 | 1.00085 | 1.00067 |
| optical-fiber | 0.99850 | 0.99852 | 0.99860 |

## Numerical checks

```json
{
  "rc_analytic_max_volts": 3.0893166969026e-08,
  "rc_ode_refinement_max_volts": 3.176986114183933e-07,
  "rc_spice_vs_ode_max_volts": 4.130011896796848e-05,
  "rc_spice_refinement_max_volts": 1.3248700633461397e-05,
  "diodes_ode_refinement_max_volts": 8.908631021764535e-08,
  "diodes_spice_vs_ode_max_volts": 2.5696549776299538e-05,
  "diodes_spice_refinement_max_volts": 1.2166615606878928e-05,
  "optical_8_to_16_rms_volts": 0.004757128888335015,
  "optical_16_to_32_rms_volts": 0.002350550261346648,
  "optical_no_feedback_analytic_max_volts": 4.440892098500626e-16,
  "optical_future_input_causality_max_volts": 0.0
}
```

Full parameters, versions, ridge selections, refinement metrics and per-seed results are in results.json.
The quadratic baseline has more features and is a deliberately strong reference, not a matched hardware budget.
Electrical states are simultaneous capacitors; optical states are time-multiplexed samples, not 16 simultaneous neurons.
All readouts are trained digitally; no local synaptic learning or brain-like intelligence was demonstrated.
Wall-clock timings measure simulation on this host, not physical inference latency or energy.
No physical measurements, device calibration, hardware speedup or novel AI capability are established.
