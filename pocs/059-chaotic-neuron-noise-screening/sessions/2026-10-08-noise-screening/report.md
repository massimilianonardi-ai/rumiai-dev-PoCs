# PoC 059 — chaotic-neuron synchronization/noise screening

Isolated-cell finite-time Lyapunov estimates: **0.01879** at dt=0.02 and **0.02397** at dt=0.01 per model time unit (both positive).
All values below are normalized by the clean population state SD. Mean ± SD across seeds.
This experiment measures dynamical noise transmission and synchrony; it does not train or benchmark an AI readout.

| Coupling | Condition | Pair disagreement | Collective shift | Total trajectory shift | Clean effective rank |
|---:|---|---:|---:|---:|---:|
| 0 | clean | 0.5868 ± 0.0376 | 0.0000 ± 0.0000 | 0.0000 ± 0.0000 | 3.6277 ± 0.4734 |
| 0 | common_process_noise | 0.6870 ± 0.0279 | 0.5696 ± 0.0999 | 1.0564 ± 0.1053 | 3.6277 ± 0.4734 |
| 0 | current_mismatch_1pct | 0.6989 ± 0.0187 | 0.3731 ± 0.0122 | 0.9689 ± 0.0615 | 3.6277 ± 0.4734 |
| 0 | independent_process_noise | 0.7772 ± 0.0253 | 0.4247 ± 0.0450 | 1.0589 ± 0.0345 | 3.6277 ± 0.4734 |
| 0.05 | clean | 0.6163 ± 0.0058 | 0.0000 ± 0.0000 | 0.0000 ± 0.0000 | 4.3846 ± 0.1713 |
| 0.05 | common_process_noise | 0.6034 ± 0.0126 | 0.6152 ± 0.1056 | 1.0818 ± 0.0504 | 4.3846 ± 0.1713 |
| 0.05 | current_mismatch_1pct | 0.6444 ± 0.0334 | 0.5155 ± 0.0875 | 1.0364 ± 0.0424 | 4.3846 ± 0.1713 |
| 0.05 | independent_process_noise | 0.7354 ± 0.0087 | 0.4590 ± 0.0411 | 1.0455 ± 0.0121 | 4.3846 ± 0.1713 |
| 0.2 | clean | 0.5938 ± 0.0087 | 0.0000 ± 0.0000 | 0.0000 ± 0.0000 | 3.6451 ± 0.2200 |
| 0.2 | common_process_noise | 0.5600 ± 0.0907 | 0.8649 ± 0.1198 | 1.1984 ± 0.0744 | 3.6451 ± 0.2200 |
| 0.2 | current_mismatch_1pct | 0.6313 ± 0.0690 | 0.6545 ± 0.0139 | 1.0689 ± 0.0301 | 3.6451 ± 0.2200 |
| 0.2 | independent_process_noise | 0.7054 ± 0.0260 | 0.6870 ± 0.0485 | 1.1591 ± 0.0442 | 3.6451 ± 0.2200 |
| 0.5 | clean | 0.4839 ± 0.0459 | 0.0000 ± 0.0000 | 0.0000 ± 0.0000 | 2.2379 ± 0.2119 |
| 0.5 | common_process_noise | 0.3354 ± 0.0546 | 1.0749 ± 0.2376 | 1.2174 ± 0.1782 | 2.2379 ± 0.2119 |
| 0.5 | current_mismatch_1pct | 0.4667 ± 0.0345 | 1.1039 ± 0.2461 | 1.3144 ± 0.1808 | 2.2379 ± 0.2119 |
| 0.5 | independent_process_noise | 0.4802 ± 0.0237 | 1.1295 ± 0.1361 | 1.3119 ± 0.0959 | 2.2379 ± 0.2119 |

Noise is an explicit model-level state kick, not a calibrated thermal/shot/ADC circuit-noise model.
Current mismatch is an external-current perturbation, not a complete component tolerance model.
A positive chaos gate verifies the isolated unforced model regime only; it does not prove the driven network is chaotic.
No hardware, energy, speed or general AI advantage is established.
