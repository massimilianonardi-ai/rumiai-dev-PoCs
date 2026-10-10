# 063 — Experimental benchmark: original `m.Class` vs native JavaScript classes

Independent performance and stress investigation. This is not a product implementation, permanent test suite, or decision about which class API should be used.

## Target

- Original `m.Class`: `massimilianonardi-ai/m`, branch `master`, pinned commit `2a57a29880c2d7a32e18782122062c695fcb1a3a`, file `js/lib/js/m/Class.js`.
- No modifications to the target; the 39,092-byte source is evaluated verbatim in the same Node.js JavaScript realm as the control implementations.
- Native `class` and function/prototype baselines implement comparable work for each scenario; native get/set accessors implement observed property semantics, not the function-call API of `m.Class`.

## Scenarios

- Define 3,500 classes, 7 measured repetitions after 2 warm-ups.
- Construct 130,000 objects: primitive properties, per-instance composed object, and a derived class.
- Invoke methods and access public properties 6 million times.
- Execute 400,000 observed-property reads/writes and 1.2 million triggered method calls.
- Measure retained heap size with forced garbage collection for 650,000 live objects per implementation.
- Stress retain 1 million live objects, churn 650,000 temporary instances in 10 batches, and measure garbage collection and retained memory.

Each timed variant is launched in a separate Node process (`--expose-gc`); measured samples use `process.hrtime.bigint()`. Memory is measured with `process.memoryUsage()`, comparing `heapUsed` after full GC with a baseline after allocating the retention array. Measurements are host-, engine- and revision-specific, not universal statements about JavaScript performance. A GitHub-hosted Linux runner is an auxiliary environment, not physical validation on a RumiAI reference host.

## Reproduce

Checkout original `m` at the exact pinned SHA next to this PoC and run:

```sh
node --expose-gc tests/benchmark.mjs --class-file /path/to/m/js/lib/js/m/Class.js --output benchmark-results.json
```

The workflow `.github/workflows/poc-063-m-class-benchmark.yml` downloads the pinned upstream file and verifies its exact Git blob SHA-1 before execution and executes on GitHub-hosted Ubuntu with Node 22 and 24. It prints `@@RESULT@@` and `@@DIAG@@` lines and uploads the complete `benchmark-results.json` artifacts. There are no thresholds that would confuse a speed difference with a functional test failure.

## Limitations

- Definition, inheritance, composition, trigger and observable property scenarios differ semantically from the minimal native object model; their numeric comparisons measure the stated matched operation only.
- GC and JIT timings depend on process state, engine version, runner CPU contention and system memory; interpret small differences conservatively.
- The retained heap delta covers objects and runtime allocation side effects, not total library file footprint. Source size is separately recorded.
- RSS is process-wide and includes non-heap memory; do not interpret it as per-instance object size.
- Experimental baseline never rewrites or updates original `m.Class`.
