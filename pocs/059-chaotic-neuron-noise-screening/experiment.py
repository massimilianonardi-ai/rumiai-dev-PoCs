#!/usr/bin/env python3
"""Screen noise and diffusive synchronization in identical Hindmarsh–Rose cells."""
import argparse
import json
from pathlib import Path
import numpy as np

N = 16
DT = 0.02
SUBSTEPS = 8
PARAMS = dict(a=1.0, b=3.0, c=1.0, d=5.0, r=0.005, s=4.0, xr=-1.618, I=3.25)
COUPLINGS = (0.0, 0.05, 0.2, 0.5)


def rhs(q, drive, coupling, current):
    x, y, z = q
    p = PARAMS
    return np.array((
        y - p["a"]*x**3 + p["b"]*x**2 - z + current + drive + coupling*(np.mean(x)-x),
        p["c"] - p["d"]*x**2 - y,
        p["r"]*(p["s"]*(x-p["xr"])-z),
    ))


def step(q, drive, coupling, current):
    k1 = rhs(q, drive, coupling, current)
    k2 = rhs(q + 0.5*DT*k1, drive, coupling, current)
    k3 = rhs(q + 0.5*DT*k2, drive, coupling, current)
    k4 = rhs(q + DT*k3, drive, coupling, current)
    return q + DT*(k1 + 2*k2 + 2*k3 + k4)/6


def initial(seed):
    rng = np.random.default_rng(seed)
    center = np.array([[-1.3078], [-7.3218], [3.3530]])
    return center + rng.normal(0, 0.005, (3, N))


def simulate(u, coupling, init_seed, noise_seed, condition="clean", sigma=0.0):
    rng = np.random.default_rng(noise_seed)
    q = initial(init_seed + 19)
    current = np.full(N, PARAMS["I"])
    if condition == "current_mismatch_1pct":
        current *= 1 + rng.uniform(-0.01, 0.01, N)
    xout = np.empty((len(u), N))
    for k, inp in enumerate(u):
        drive = 0.3 * inp  # identical drive: isolate population synchronization
        for _ in range(SUBSTEPS):
            q = step(q, drive, coupling, current)
        if condition == "independent_process_noise":
            q[0] += rng.normal(0, sigma, N)
        elif condition == "common_process_noise":
            q[0] += rng.normal(0, sigma)
        xout[k] = q[0]
    return xout


def metrics(clean, observed):
    scale = np.std(clean)
    scale = scale if scale > 1e-12 else 1.0
    centered = observed - observed.mean(axis=1, keepdims=True)
    pair_disagreement = float(np.sqrt(np.mean(centered**2))/scale)
    displacement = observed-clean
    collective_shift = float(np.sqrt(np.mean(displacement.mean(axis=1)**2))/scale)
    total_shift = float(np.sqrt(np.mean(displacement**2))/scale)
    cov = np.cov(clean, rowvar=False)
    ev = np.maximum(np.linalg.eigvalsh(cov), 0)
    prob = ev[ev > 0]/ev.sum() if ev.sum() > 0 else np.array([])
    erank = float(np.exp(-np.sum(prob*np.log(prob)))) if len(prob) else 0.0
    return pair_disagreement, collective_shift, total_shift, erank


def single_rhs(q):
    p = PARAMS
    x, y, z = q
    return np.array([y-p["a"]*x**3+p["b"]*x**2-z+p["I"],
                     p["c"]-p["d"]*x*x-y,
                     p["r"]*(p["s"]*(x-p["xr"])-z)])


def lyapunov_estimate(dt=DT):
    rng = np.random.default_rng(91)
    q = np.array([-1.3078, -7.3218, 3.3530]) + rng.normal(0, 0.01, 3)
    delta = rng.normal(size=3)
    eps = 1e-7
    delta *= eps/np.linalg.norm(delta)
    p = q + delta

    def advance(s):
        k1 = single_rhs(s)
        k2 = single_rhs(s + DT*k1/2)
        k3 = single_rhs(s + DT*k2/2)
        k4 = single_rhs(s + DT*k3)
        return s + dt*(k1+2*k2+2*k3+k4)/6

    for _ in range(round(100/dt)):
        q, p = advance(q), advance(p)
    logs = []
    interval_steps = round(0.2/dt)
    for _ in range(1000):
        for _ in range(interval_steps):
            q, p = advance(q), advance(p)
        d = p-q
        norm = np.linalg.norm(d)
        if norm <= 0 or not np.isfinite(norm):
            return float("nan")
        logs.append(np.log(norm/eps)/(interval_steps*dt))
        p = q + eps*d/norm
    return float(np.mean(logs))


def run(seeds, length):
    rows = []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        u = rng.uniform(-1, 1, length + 100)
        for ci, coupling in enumerate(COUPLINGS):
            base = seed*1000 + ci*20
            clean = simulate(u, coupling, base, base+1)
            clean = clean[100:]
            sigma = 0.05*float(np.std(clean))
            for j, condition in enumerate(("clean", "independent_process_noise",
                                           "common_process_noise", "current_mismatch_1pct")):
                observed = simulate(u, coupling, base, base+10+j, condition,
                                    sigma if "process_noise" in condition else 0.0)[100:]
                pair, collective, total, erank = metrics(clean, observed)
                rows.append({
                    "seed": seed, "coupling": coupling, "condition": condition,
                    "pair_disagreement_over_clean_sd": pair,
                    "collective_shift_over_clean_sd": collective,
                    "total_trajectory_shift_over_clean_sd": total,
                    "clean_state_effective_rank": erank,
                    "noise_sigma_state_units": sigma if "process_noise" in condition else 0.0,
                })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--seeds", nargs="+", type=int, default=[11, 29, 47])
    ap.add_argument("--output", default="results")
    args = ap.parse_args()
    rows = run(args.seeds, 300 if args.quick else 1200)
    lyap = lyapunov_estimate(DT)
    lyap_half_step = lyapunov_estimate(DT/2)
    if not np.isfinite(lyap) or not np.isfinite(lyap_half_step) or lyap <= 0 or lyap_half_step <= 0:
        raise SystemExit(f"chaos gate failed: Lyapunov estimates {lyap}, {lyap_half_step}")
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=False)
    data = {
        "model": "Hindmarsh-Rose three-variable model; x is membrane-potential-like state",
        "parameters": PARAMS | {"dt": DT, "substeps_per_input_symbol": SUBSTEPS,
                                "population": N, "couplings": COUPLINGS},
        "noise_definition": "Gaussian state kick on x at each input-symbol boundary; sigma=5% of clean x SD",
        "mismatch_definition": "fixed independent ±1% variation in external current per cell",
        "input": "shared iid uniform [-1,1], drive amplitude 0.3",
        "seeds": args.seeds,
        "isolated_cell_finite_time_largest_lyapunov_estimate": {"dt": DT, "value": lyap,
                                                                  "dt_half": DT/2, "value_half": lyap_half_step},
        "rows": rows,
    }
    (out/"results.json").write_text(json.dumps(data, indent=2)+"\n")
    groups = {}
    for row in rows:
        key = (row["coupling"], row["condition"])
        groups.setdefault(key, []).append(row)
    lines = [
        "# PoC 059 — chaotic-neuron synchronization/noise screening", "",
        f"Isolated-cell finite-time Lyapunov estimates: **{lyap:.5f}** at dt={DT:g} and **{lyap_half_step:.5f}** at dt={DT/2:g} per model time unit (both positive).",
        "All values below are normalized by the clean population state SD. Mean ± SD across seeds.",
        "This experiment measures dynamical noise transmission and synchrony; it does not train or benchmark an AI readout.", "",
        "| Coupling | Condition | Pair disagreement | Collective shift | Total trajectory shift | Clean effective rank |",
        "|---:|---|---:|---:|---:|---:|",
    ]
    for key, vals in sorted(groups.items()):
        def stat(k):
            v = np.array([x[k] for x in vals])
            return f"{v.mean():.4f} ± {v.std():.4f}"
        lines.append(f"| {key[0]:g} | {key[1]} | {stat('pair_disagreement_over_clean_sd')} | "
                     f"{stat('collective_shift_over_clean_sd')} | {stat('total_trajectory_shift_over_clean_sd')} | "
                     f"{stat('clean_state_effective_rank')} |")
    lines += [
        "", "Noise is an explicit model-level state kick, not a calibrated thermal/shot/ADC circuit-noise model.",
        "Current mismatch is an external-current perturbation, not a complete component tolerance model.",
        "A positive chaos gate verifies the isolated unforced model regime only; it does not prove the driven network is chaotic.",
        "No hardware, energy, speed or general AI advantage is established."
    ]
    (out/"report.md").write_text("\n".join(lines)+"\n")


if __name__ == "__main__":
    main()
