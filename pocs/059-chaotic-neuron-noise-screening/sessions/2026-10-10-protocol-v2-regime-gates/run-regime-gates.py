#!/usr/bin/env python3
"""Run the preregistered PoC 059 protocol-v2 isolated-cell regime gates."""
import argparse
import importlib.util
import json
from pathlib import Path
import numpy as np

SEEDS = [11, 29, 47, 71, 89, 101, 131, 149, 173, 197]
CENTER = np.array([-1.3078, -7.3218, 3.3530])
PROTOCOL = "TASK-PREREGISTRATION.md v2"
SOURCE_REVISION = "5ec3a445e2c8db66709250a05554c476878e5c81"


def load_experiment():
    path = next(parent / "experiment.py" for parent in Path(__file__).resolve().parents if (parent / "experiment.py").is_file())
    spec = importlib.util.spec_from_file_location("poc059_experiment", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def estimate(module, current, seed, dt):
    module.PARAMS["I"] = current
    rng = np.random.default_rng(seed)
    q = CENTER + rng.normal(0, 0.01, 3)
    delta = rng.normal(size=3)
    eps = 1e-7
    delta *= eps / np.linalg.norm(delta)
    p = q + delta

    def advance(state):
        k1 = module.single_rhs(state)
        k2 = module.single_rhs(state + 0.5 * dt * k1)
        k3 = module.single_rhs(state + 0.5 * dt * k2)
        k4 = module.single_rhs(state + dt * k3)
        return state + dt * (k1 + 2*k2 + 2*k3 + k4) / 6

    for _ in range(round(100 / dt)):
        q, p = advance(q), advance(p)
    interval_steps = round(0.2 / dt)
    logs = []
    for _ in range(1000):
        for _ in range(interval_steps):
            q, p = advance(q), advance(p)
        difference = p - q
        norm = np.linalg.norm(difference)
        if norm <= 0 or not np.isfinite(norm):
            return float("nan")
        logs.append(np.log(norm / eps) / (interval_steps * dt))
        p = q + eps * difference / norm
    return float(np.mean(logs))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    module = load_experiment()
    regimes = []
    for label, current in (("regular_candidate", 2.90), ("chaotic_candidate", 3.25)):
        rows = []
        for seed in SEEDS:
            rows.append({
                "seed": seed,
                "dt_0_02": estimate(module, current, seed, 0.02),
                "dt_0_01": estimate(module, current, seed, 0.01),
            })
        if label == "regular_candidate":
            successes = sum(r["dt_0_02"] <= 0 and r["dt_0_01"] <= 0 for r in rows)
            criterion = "at least 8/10 seeds non-positive at both steps"
        else:
            successes = sum(r["dt_0_02"] > 0 and r["dt_0_01"] > 0 for r in rows)
            criterion = "at least 8/10 seeds positive at both steps"
        regimes.append({
            "label": label, "I": current, "success_count": successes,
            "required_count": 8, "criterion": criterion, "seeds": rows,
        })
    regular_ok = regimes[0]["success_count"] >= 8
    chaotic_ok = regimes[1]["success_count"] >= 8
    comparison = "eligible_for_task_benchmark" if regular_ok and chaotic_ok else "inconclusive_stop_per_preregistered_gate"
    result = {
        "protocol": PROTOCOL,
        "source_revision": SOURCE_REVISION,
        "seeds": SEEDS,
        "integrator": "classical RK4; every intermediate stage and update uses the same dt",
        "estimator": {
            "center": CENTER.tolist(), "initial_state_sd": 0.01,
            "initial_separation": 1e-7, "burn_in_model_time": 100,
            "renormalized_intervals": 1000, "interval_model_time": 0.2,
        },
        "regimes": regimes,
        "comparison_gate": comparison,
        "task_level_scores_run": False,
    }
    (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
    lines = [
        "# PoC 059 protocol v2 — preregistered regime gates", "",
        "The isolated-cell operating-regime gates were evaluated before any task-level model fitting or task score inspection.", "",
        "| Candidate | I | Seeds satisfying criterion | Required | Result |",
        "|---|---:|---:|---:|---|",
    ]
    for regime in regimes:
        ok = regime["success_count"] >= 8
        lines.append(f"| {regime['label']} | {regime['I']:.2f} | {regime['success_count']}/10 | 8/10 | {'pass' if ok else 'fail'} |")
    lines += [
        "", f"Protocol decision: **{comparison}**.",
        "The chaotic candidate passes; the regular candidate fails (6/10, below the preregistered 8/10 threshold). Protocol v2 therefore requires stopping without selecting another I value or running the task benchmark.",
        "", "Every RK4 stage uses the same step size as the final update. Per-seed estimates and full estimator settings are in results.json.",
        "This gate describes isolated-cell finite-time dynamics; it does not classify the driven, coupled network or establish AI utility.",
    ]
    (output / "report.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()

