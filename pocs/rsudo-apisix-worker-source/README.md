# rsudo APISIX worker-local provider experiment

Status: **Experimental / not validated**  
Updated: 2026-11-06

## Question

Can APISIX 3.16.0 and 3.19.0 reveal the deployment provider actually held in one worker's Lua configuration cache, rather than interpreting a potentially drifted configuration file on disk?

This is only a diagnostic experiment for RumiAI `rsudo apisix` work-unit C. The active task state belongs to `rumiai-dev/handoff/rsudo-apisix-administration.md`; canonical public behavior belongs to `rumiai-dev/specifications/rumiai-os/RSUDO-APISIX.md`.

## Mechanism

`run.sh` starts each **digest-pinned official Apache APISIX** image separately with `docker run --network none`, without published ports and without production credentials. It mounts a test-only custom Lua plugin through the documented `apisix.extra_lua_path` interface, enables only `uri-blocker` and the PoC plugin in the isolated configuration, and exposes the plugin exclusively on the container's loopback-only, unauthenticated Control API at `127.0.0.1:9090`. The plugin returns only four allowlisted fields:

- `deployment.role` and the selected provider from `core.config.local_conf()` in the worker;
- `profile.profile` (the worker's cached `APISIX_PROFILE` selector);
- worker PID.

The script first checks a real route is blocked by `uri-blocker` (HTTP 403). Then it rewrites *only the disposable mounted main config file* from provider YAML to JSON and disables the Control API in that on-disk file **without restarting the running gateway**. It independently reads the changed file bytes from inside Docker, queries the worker again, checks the route still blocks, and compares the master PID. A passing observation would demonstrate **worker-cache provider != currently visible disk provider** and show that a user-installed worker plugin can expose one live in-process value.

## How to run

On an isolated Linux development host with Docker and Python 3:

```sh
sh pocs/rsudo-apisix-worker-source/run.sh
```

The script pulls the two official digest-pinned Apache APISIX images if needed. Docker container access remains restricted to the local execution host; no host port is published. It removes its disposable container and temporary files at exit. The deliberate *in-place* file rewrite is test-fixture behavior, **not** a safe production publication algorithm.

## Important boundaries

This PoC is **not** an accepted source identity or mutation-safety implementation. In-process configuration value observation may be stronger than reading the current file, but it does not attest the originally selected file pathname, exact source bytes/hash, profile provenance, all workers, or an authenticated/trusted Admin API listener. An unauthenticated Control API is explicitly unsafe to publish. The PoC cannot be promoted to general `rsudo apisix list/get` or write readiness merely because its HTTP requests succeed. An ordinary installation without the special plugin provides no such endpoint.

No passing CI evidence is claimed by this README. A CI run must be inspected by its exact revision and actual job logs before the status can change. The experiment remains separate from permanent `rumiai-tests` until the property is established and worth protecting permanently.

## Upstream implementation basis

- `apache/apisix@3.16.0` and `@3.19.0`: `apisix/core/config_local.lua` caches `config_data`; `apisix/core/profile.lua` obtains the profile selector from `APISIX_PROFILE`.
- `apisix/cli/file.lua` chooses customized/profile YAML paths and parses the selected on-disk file; this is not an unchanged-worker source binding.
- `apisix/control/router.lua` supports plugin-provided `control_api` entries.
- `docs/en/latest/plugin-develop.md` documents `extra_lua_path` and the `plugins` list replacement behavior.

The official upstream sources are mechanism references, not proof that this current experimental script passes.
