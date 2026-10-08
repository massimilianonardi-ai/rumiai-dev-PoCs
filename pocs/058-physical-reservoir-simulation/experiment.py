"""Exploratory physical reservoirs; not a RumiAI runtime interface."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import time

import numpy as np
import scipy
from scipy.integrate import solve_ivp
from scipy.linalg import solve
from scipy.signal import lfilter

NODES = 16
PERIOD = 1e-3
WARMUP = 150
SIZES = (1200, 500, 700)
ALPHAS = (1e-8, 1e-6, 1e-4, 1e-2, 1., 100.)


def _electrical_parameters(seed, drift=0.):
    rng = np.random.default_rng(seed)
    params = dict(r=np.full(NODES, 1e4), c=np.geomspace(.3, 6., NODES) * PERIOD / 1e4,
                  gain=rng.uniform(-.65, .65, NODES), bias=rng.uniform(-.25, .25, NODES),
                  coupling=1e-5, saturation_current=1e-9, nvt=1.8 * 8.617333262e-5 * 300.15)
    if drift:
        # Fixed multiplicative component drift, separate from stochastic readout noise.
        rng = np.random.default_rng(seed + 10000)
        params['r'] *= 1 + rng.uniform(-drift, drift, NODES)
        params['c'] *= 1 + rng.uniform(-drift, drift, NODES)
    return params


def _drive(u, t):
    # 1% rise interval, held for the remainder of each symbol; causal at t=0.
    q = max(0., t / PERIOD)
    k = min(int(q), len(u)-1)
    if k == 0:
        return u[0]
    f = min(1., (q-k)/.01)
    return u[k-1] + f * (u[k]-u[k-1])


def _electrical_scipy(u, p, nonlinear, coupled, refinement=1):
    def rhs(t, v):
        current = (p['gain'] * _drive(u, t) + p['bias'] - v) / p['r']
        if nonlinear:
            current -= 2 * p['saturation_current'] * np.sinh(np.clip(v/p['nvt'], -35, 35))
        if coupled:
            current += p['coupling'] * (np.roll(v, 1) + np.roll(v, -1) - 2*v)
        return current / p['c']
    ts = (np.arange(len(u))+1) * PERIOD
    # LSODA uses adaptive error control; max_step also resolves the input waveform.
    sol = solve_ivp(rhs, (0., ts[-1]), np.zeros(NODES), t_eval=ts,
                    method='LSODA', rtol=2e-7/refinement, atol=1e-9/refinement,
                    max_step=PERIOD/(8*refinement))
    if not sol.success:
        raise RuntimeError(sol.message)
    return sol.y.T


def _electrical_spice(u, p, nonlinear, coupled, path, refinement=1):
    path.mkdir(parents=True, exist_ok=True)
    lines = ['RC reservoir, physical SI units', '.temp 27',
             '.options reltol=1e-7 abstol=1e-12 vntol=1e-9 method=gear',
             'Vin input 0 PWL(0 %.12g' % u[0]]
    for k in range(1, len(u)):
        lines.append('+ %.12g %.12g %.12g %.12g' %
                     (k*PERIOD, u[k-1], (k+.01)*PERIOD, u[k]))
    lines += ['+ %.12g %.12g)' % (len(u)*PERIOD, u[-1]),
              '.model junction D(Is=1e-9 N=1.8 Tnom=27)']
    for i in range(NODES):
        lines += [f'B{i} src{i} 0 V={p["gain"][i]:.12g}*v(input)+({p["bias"][i]:.12g})',
                  f'R{i} src{i} v{i} {p["r"][i]:.12g}',
                  f'C{i} v{i} 0 {p["c"][i]:.12g} IC=0']
        if nonlinear:
            lines += [f'Dp{i} v{i} 0 junction', f'Dn{i} 0 v{i} junction']
        if coupled:
            lines.append(f'Rc{i} v{i} v{(i+1)%NODES} {1/p["coupling"]:.12g}')
    dt = PERIOD/(32*refinement)
    lines += ['.control', 'set noaskquit', 'set numdgt=15', 'set wr_singlescale',
              f'tran {dt:.12g} {len(u)*PERIOD:.12g} 0 {dt:.12g} uic',
              'wrdata states.dat ' + ' '.join(f'v(v{i})' for i in range(NODES)),
              'quit', '.endc', '.end']
    (path/'circuit.cir').write_text('\n'.join(lines)+'\n')
    proc = subprocess.run(['ngspice', '-b', 'circuit.cir'], cwd=path,
                          capture_output=True, text=True, timeout=180)
    (path/'ngspice.log').write_text(proc.stdout + proc.stderr)
    if proc.returncode or not (path/'states.dat').exists():
        raise RuntimeError(f'ngspice failed; inspect {path}/ngspice.log')
    data = np.loadtxt(path/'states.dat')
    ts = (np.arange(len(u))+1)*PERIOD
    if data.shape[1] != NODES+1 or data[-1, 0] < ts[-1]-1e-10:
        raise RuntimeError('incomplete ngspice output')
    return np.column_stack([np.interp(ts, data[:, 0], data[:, i+1]) for i in range(NODES)])


def _optical(u, seed, ticks=8, feedback=True, drift=0.):
    # Narrow method-of-steps discretization: delayed value held within a tick;
    # scipy.signal.lfilter integrates the linear detector RC exactly for that hold.
    rng = np.random.default_rng(seed)
    mask = rng.choice([-1., 1.], NODES)
    slot = 10e-9
    tau = 20e-9 * (1 + drift)
    delay_slots = NODES+1
    d = delay_slots*ticks
    h = slot/ticks
    a = np.exp(-h/tau)
    attenuation = 10**(-.2 * (299792458*slot*delay_slots/1.468)/1000/10)
    # 1 mW laser, 50% feedback/read splitter, 0.8 A/W PD, 2 kOhm TIA.
    voltage_scale = 1e-3*.5*.8*2000
    encoded = np.repeat((u[:, None]*mask).ravel(), ticks)
    z = np.zeros(len(encoded))
    gain = 1.6 if feedback else 0.
    for begin in range(0, len(z), d):
        end = min(begin+d, len(z))
        # z index is end-of-tick; delayed forcing uses the start-of-tick state.
        idx = np.arange(begin, end)-d-1
        delayed = np.zeros(end-begin)
        valid = idx >= 0
        delayed[valid] = z[idx[valid]]
        voltage = .7*encoded[begin:end] + gain*attenuation*(delayed-.4)
        forcing = voltage_scale*np.cos(np.pi/4 + np.pi*voltage/(2*1.))**2
        prior = z[begin-1] if begin else 0.
        z[begin:end], _ = lfilter([1-a], [1, -a], forcing, zi=[a*prior])
    return z.reshape(len(u), NODES, ticks)[:, :, -1]


def _digital(u, seed):
    rng = np.random.default_rng(seed)
    w = rng.normal(size=(NODES, NODES))
    w *= .8/max(abs(np.linalg.eigvals(w)))
    win = rng.uniform(-1., 1., NODES)
    bias = rng.uniform(-.3, .3, NODES)
    x = np.zeros(NODES)
    result = []
    for value in u:
        x = .5*x + .5*np.tanh(w@x + win*value+bias)
        result.append(x.copy())
    return np.asarray(result)


def _lags(u):
    out = np.zeros((len(u), NODES))
    for k in range(NODES):
        out[k:, k] = u[:len(u)-k]
    return out


def _targets(u):
    past = _lags(u)
    nonlinear = past[:, 1]*past[:, 3] + .5*past[:, 6]
    return np.column_stack([nonlinear, past[:, 1:13], u*u])


def _fit_predict(xs, ys):
    mean = xs[0].mean(axis=0)
    scale = xs[0].std(axis=0)
    scale[scale < 1e-10] = 1.
    matrices = [np.column_stack([np.ones(len(x)), (x-mean)/scale]) for x in xs]
    ym = ys[0].mean(axis=0)
    yscale = ys[0].std(axis=0)
    train_y = (ys[0]-ym)/yscale
    a = matrices[0].T@matrices[0]/len(xs[0])
    b = matrices[0].T@train_y/len(xs[0])
    regularizer = np.eye(a.shape[0]); regularizer[0, 0] = 0
    candidates = []
    for alpha in ALPHAS:
        weights = solve(a+alpha*regularizer, b, assume_a='pos')
        pred = (matrices[1]@weights)*yscale+ym
        candidates.append((np.mean((pred-ys[1])**2, axis=0), weights))
    choices = np.argmin([item[0] for item in candidates], axis=0)
    weights = np.column_stack([candidates[k][1][:, j] for j, k in enumerate(choices)])
    def predict(x):
        return np.column_stack([np.ones(len(x)), (x-mean)/scale])@weights*yscale+ym
    return predict, [ALPHAS[k] for k in choices]


def _metrics(y, pred):
    mse = np.mean((y-pred)**2, axis=0)
    variance = np.var(y, axis=0)
    nmse = mse/variance
    return dict(nonlinear_nmse=float(nmse[0]),
                static_square_nmse=float(nmse[-1]),
                memory_r2=(1-nmse[1:13]).tolist(),
                memory_score=float(np.clip(1-nmse[1:13], 0, 1).sum()))


def _json(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(type(value).__name__)


def _main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['ngspice', 'scipy'], default='ngspice')
    parser.add_argument('--output', type=Path, default=Path('results'))
    parser.add_argument('--seeds', type=int, nargs='+', default=[11, 29, 47])
    parser.add_argument('--quick', action='store_true')
    args = parser.parse_args()
    if args.engine == 'ngspice' and not shutil.which('ngspice'):
        parser.error('ngspice is required; install it or explicitly select --engine scipy (ODE-only evidence)')
    if args.output.exists():
        parser.error('output already exists; choose a new session directory')
    args.output.mkdir(parents=True)
    sizes = (240, 120, 160) if args.quick else SIZES
    output = dict(engine=args.engine, seeds=args.seeds, sizes=sizes, warmup=WARMUP,
                  nodes=NODES, period_seconds=PERIOD, alphas=ALPHAS, results=[], checks={},
                  python=sys.version, numpy=np.__version__, scipy=scipy.__version__,
                  platform=platform.platform(), source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  parameters={}, evidence='simulation only; no measured hardware speed/energy')
    if shutil.which('ngspice'):
        output['ngspice_version'] = subprocess.check_output(['ngspice', '--version'], text=True)
    output['optical_parameters'] = dict(slot_seconds=10e-9, delay_slots=17, group_index=1.468,
        fiber_metres=299792458*170e-9/1.468, attenuation_db_per_km=.2, laser_watts=.001,
        splitter_fraction=.5, responsivity_amp_per_watt=.8, transimpedance_ohms=2000,
        detector_tau_seconds=20e-9, vpi_volts=1., phase_bias_radians=np.pi/4,
        input_gain_volts=.7, feedback_gain=1.6, feedback_offset_volts=.4, ticks_per_slot=8)
    started = time.perf_counter()
    for seed in args.seeds:
        print(f'seed {seed}: generating independent train/validation/test streams', flush=True)
        rng = np.random.default_rng(seed+1000)
        streams = [rng.uniform(-1, 1, n+WARMUP) for n in sizes]
        ys = [_targets(u)[WARMUP:] for u in streams]
        np.savez_compressed(args.output/f'inputs-{seed}.npz',
                            **{name: u for name, u in zip(['train','validation','test'], streams)},
                            **{name+'_targets': y for name, y in zip(['train','validation','test'], ys)})
        p = _electrical_parameters(seed)
        output['parameters'][str(seed)] = p
        if seed == args.seeds[0]:
            probe = streams[0][:60]
            step = _electrical_scipy(np.ones(30), p, False, False)
            times = (np.arange(30)+1)*PERIOD
            analytic = (p['gain']+p['bias'])*(1-np.exp(-times[:,None]/(p['r']*p['c'])))
            output['checks']['rc_analytic_max_volts'] = float(np.max(abs(step-analytic)))
            if not np.allclose(step, analytic, atol=2e-6):
                raise RuntimeError('RC analytic check failed')
            for nonlinear, coupled, name in [(False, False, 'rc'), (True, True, 'diodes')]:
                reference = _electrical_scipy(probe, p, nonlinear, coupled, 2)
                ordinary = _electrical_scipy(probe, p, nonlinear, coupled)
                error = float(np.max(abs(reference-ordinary)))
                output['checks'][name+'_ode_refinement_max_volts'] = error
                if error > 2e-4:
                    raise RuntimeError('ODE refinement failed')
                if args.engine == 'ngspice':
                    spice = _electrical_spice(probe, p, nonlinear, coupled, args.output/('check-'+name))
                    fine = _electrical_spice(probe, p, nonlinear, coupled, args.output/('check-'+name+'-fine'), 2)
                    agreement = float(np.max(abs(reference-spice)))
                    refinement = float(np.max(abs(spice-fine)))
                    output['checks'][name+'_spice_vs_ode_max_volts'] = agreement
                    output['checks'][name+'_spice_refinement_max_volts'] = refinement
                    if agreement > 2e-3 or refinement > 5e-4:
                        raise RuntimeError('SPICE/ODE agreement or refinement failed')
            optical_steps = [_optical(probe, seed, ticks=n) for n in (8,16,32)]
            e1 = float(np.sqrt(np.mean((optical_steps[0]-optical_steps[1])**2)))
            e2 = float(np.sqrt(np.mean((optical_steps[1]-optical_steps[2])**2)))
            output['checks']['optical_8_to_16_rms_volts'] = e1
            output['checks']['optical_16_to_32_rms_volts'] = e2
            if e2 > .8*e1 or e2 > .01:
                raise RuntimeError('optical refinement failed')
            dark = _optical(np.zeros(20), seed, feedback=False)
            analytic = .4*(1-np.exp(-np.arange(1, 20*NODES+1)*10e-9/20e-9))
            output['checks']['optical_no_feedback_analytic_max_volts'] = float(np.max(abs(dark.ravel()-analytic)))
            if not np.allclose(dark.ravel(), analytic, atol=1e-10):
                raise RuntimeError('detector step-response check failed')
            changed = probe.copy(); changed[30:] *= -1
            causal_error = float(np.max(abs(_optical(changed, seed)[:30]-optical_steps[0][:30])))
            output['checks']['optical_future_input_causality_max_volts'] = causal_error
            if causal_error != 0.:
                raise RuntimeError('optical causality check failed')
        for name in ['linear-lags', 'quadratic-lags', 'digital-esn', 'rc-linear',
                     'diode-uncoupled', 'diode-coupled', 'optical-no-feedback', 'optical-fiber']:
            t0 = time.perf_counter()
            print(f'  {name}', flush=True)
            def states(u, split, drift=0.):
                if name == 'linear-lags':
                    return _lags(u)
                if name == 'quadratic-lags':
                    lags = _lags(u)
                    # Strong digital baseline with all quadratic lag interactions, not target-specific oracle.
                    i,j = np.triu_indices(NODES)
                    return np.column_stack([lags, lags[:,i]*lags[:,j]])
                if name == 'digital-esn':
                    return _digital(u, seed)
                if name.startswith('optical'):
                    return _optical(u, seed, feedback=name=='optical-fiber', drift=drift)
                pp = _electrical_parameters(seed, drift)
                nonlinear = name != 'rc-linear'; coupled = name == 'diode-coupled'
                if args.engine == 'scipy':
                    return _electrical_scipy(u, pp, nonlinear, coupled)
                return _electrical_spice(u, pp, nonlinear, coupled,
                                        args.output/f'seed-{seed}'/name/split)
            xs = [states(u, split)[WARMUP:] for u, split in zip(streams, ['train','validation','test'])]
            if not all(np.isfinite(x).all() for x in xs):
                raise RuntimeError('non-finite simulator output')
            predict, alpha = _fit_predict(xs, ys)
            pred = predict(xs[2])
            metrics = _metrics(ys[2], pred)
            result = dict(seed=seed, model=name, features=xs[0].shape[1],
                          readout_coefficients_per_target=xs[0].shape[1]+1,
                          feature_max_abs=float(max(np.max(abs(x)) for x in xs)),
                          selected_alpha=alpha, clean=metrics)
            if name.startswith('diode') and result['feature_max_abs']/p['nvt'] >= 30:
                raise RuntimeError('electronic state approaches the ODE exponential safeguard')
            s = np.linalg.svd((xs[0]-xs[0].mean(0))/(xs[0].std(0)+1e-12), compute_uv=False)
            probability = s*s/np.sum(s*s)
            result['effective_rank'] = float(np.exp(-np.sum(probability*np.log(probability+1e-30))))
            if name not in ('linear-lags', 'quadratic-lags', 'digital-esn'):
                # A calibrated clean device is perturbed after fitting, with weights frozen.
                noise = np.random.default_rng(seed+2000).normal(size=xs[2].shape)*.01*xs[0].std(0)
                result['readout_noise_1pct'] = _metrics(ys[2], predict(xs[2]+noise))
                drifted = states(streams[2], 'test-drift', .05)[WARMUP:]
                result['component_drift_5pct'] = _metrics(ys[2], predict(drifted))
                if name == 'optical-fiber':
                    finer = [_optical(u, seed, ticks=16)[WARMUP:] for u in streams]
                    fine_predict, _ = _fit_predict(finer, ys)
                    result['refined_16_ticks'] = _metrics(ys[2], fine_predict(finer[2]))
            result['simulation_and_fit_wall_seconds'] = time.perf_counter()-t0
            output['results'].append(result)
            np.savetxt(args.output/f'predictions-{seed}-{name}.csv',
                       np.column_stack([ys[2][:,0], pred[:,0]]), delimiter=',',
                       header='target,prediction', comments='')
            print(f'    NMSE={metrics["nonlinear_nmse"]:.5f}; memory={metrics["memory_score"]:.3f}/12', flush=True)
    output['total_wall_seconds'] = time.perf_counter()-started
    (args.output/'results.json').write_text(json.dumps(output, indent=2, default=_json)+'\n')
    names = list(dict.fromkeys(r['model'] for r in output['results']))
    report = ['# Physical reservoir simulation — results', '',
              f'Electronic engine: **{args.engine}**. Seeds: {args.seeds}. Train/validation/test: {sizes}.', '',
              'NMSE is held-out mean squared error divided by target variance (lower is better).',
              'Memory score sums positive held-out R² across delays 1–12 (higher is better).', '',
              '| Model | Features | Temporal NMSE mean ± SD | Memory score mean | Square NMSE mean |',
              '|---|---:|---:|---:|---:|']
    for name in names:
        rows = [r for r in output['results'] if r['model']==name]
        errors = [r['clean']['nonlinear_nmse'] for r in rows]
        memory = [r['clean']['memory_score'] for r in rows]
        square = np.mean([r['clean']['static_square_nmse'] for r in rows])
        report.append(f'| {name} | {rows[0]["features"]} | {np.mean(errors):.5f} ± {np.std(errors):.5f} | {np.mean(memory):.3f} | {square:.5f} |')
    report += ['', 'SD is descriptive across the listed seeds, not a confidence interval.', '',
               '## Frozen-readout sensitivity', '',
               '| Model | Clean NMSE | 1% readout noise NMSE | 5% component perturbation NMSE |',
               '|---|---:|---:|---:|']
    for name in names:
        rows = [r for r in output['results'] if r['model']==name and 'readout_noise_1pct' in r]
        if rows:
            values = [np.mean([r[key]['nonlinear_nmse'] for r in rows]) for key in ['clean','readout_noise_1pct','component_drift_5pct']]
            report.append('| '+name+' | '+' | '.join(f'{v:.5f}' for v in values)+' |')
    report += ['', '## Numerical checks', '', '```json', json.dumps(output['checks'], indent=2), '```', '',
               'Full parameters, versions, ridge selections, refinement metrics and per-seed results are in results.json.',
               'The quadratic baseline has more features and is a deliberately strong reference, not a matched hardware budget.',
               'Electrical states are simultaneous capacitors; optical states are time-multiplexed samples, not 16 simultaneous neurons.',
               'All readouts are trained digitally; no local synaptic learning or brain-like intelligence was demonstrated.',
               'Wall-clock timings measure simulation on this host, not physical inference latency or energy.',
               'No physical measurements, device calibration, hardware speedup or novel AI capability are established.']
    (args.output/'report.md').write_text('\n'.join(report)+'\n')
    print('\n'.join(report), flush=True)


if __name__ == '__main__':
    _main()
