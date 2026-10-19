# Olla on GIS: pinned first inference gateway

Status: **operator execution pending** (2026-10-19). This PoC is a
GIS-local canary, not a validated eight-worker cluster or a new m product API.

## Fixed operator choices

- Install the existing upstream **Olla v0.0.29** product on **gis**
  (`10.200.0.19`), not on a new VM or `apps`.
- Run Olla on `127.0.0.1:40114` first, pointing to the existing GIS
  Ollama `127.0.0.1:11435`. Do not change any Ollama service bindings yet.
- Later, with confirmed corporate network permissions and restricted access,
  extend the model pool to seven other Ollama endpoints bound to `0.0.0.0`.
  A wildcard bind does not authenticate requests or open firewalls.
- Use an upstream native Linux amd64 binary rather than a container.
- The Olla version, port, endpoint and runtime root are **PoC deployment
  settings**, not promoted RumiAI configuration conventions.

## Verified upstream release

https://github.com/thushan/olla/releases/tag/v0.0.29

```text
olla_v0.0.29_linux_amd64.tar.gz
SHA-256 fafb482e50def1f56f210ef28b46c67021bb6e25b0ff0a595682e2aac214fcc4
```

The digest was verified against GitHub release asset metadata on 2026-10-19,
not against a downloaded local copy. Any installation must validate the
download against that exact digest before extraction.

## Operator flow

These are two rsudo-admin operator-selected sources:

- `controller.lib.sh` — full remote POSIX `sh` installer embedded in library;
- `install.job` — edit `check` to `install` to perform an authorized apply.
  First line redirects to the pre-existing operator log path exactly.

From a credential-loaded RumiAI operator environment, run
`rsudo-admin`, select **rsudo jobs**, then select those two files.
Check mode is read-only. Install mode stages the pinned Olla binary
on `gis` and starts the GIS-local Olla service; it does not mutate
any of the eight Ollama services, network ACLs or firewalls.

If no rsudo-enabled operator connection is available, do **not** interpret
a green repository check as a physical installation. Keep the step pending.

## Acceptance boundaries

- `gis` must answer its pre-existing loopback `/api/tags` endpoint.
- Archive SHA-256 and extracted executable must be validated.
- Olla YAML must pass `--validate-config` before activation.
- Olla `/internal/health` and a real proxied `qwen3:4b` chat must be
  exercised on `gis` before calling the physical canary complete.
- Olla must remain local-only until an explicitly scoped client access
  and infrastructure exposure change is validated.
- Neither Olla nor self-hosted Ollama natively provides inbound API
  authentication. Upstream Olla's automatic connection retries are disabled
  in this canary because acceptance may be ambiguous after a disconnect.
- Permanent integration into the `m` `pkg`/`srv` facility is **not**
  implemented by this one-off experiment. Do not claim that `srv`
  manages Olla from a native package provider until one exists.

## Evidence

2026-10-19: the assistant's execution environment could not connect to
`gis:22` and could not retrieve the GitHub binary due to missing
external DNS. The isolated GitHub-hosted Ubuntu runner **did download the
real pinned release**, verified its SHA-256, validated the exact YAML
embedded in the operator library, launched Olla and sent an actual chat
through Olla to a **simulated** Ollama backend.

GitHub Actions [run 39208513826](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/39208513826)
passed at exact PoC revision `2781b640e5fcc25f9cf70144c388e56d0de3a4d1`.
Its first job step validates the real pinned Olla executable, configuration
and proxied HTTP chat with the simulated Ollama backend. The second step
extracts the **same remote POSIX program** embedded in `controller.lib.sh`,
runs its read-only `check`, performs the `install` path on a disposable
GitHub Ubuntu machine, verifies systemd service active/enabled, checks its
health and proxied chat via that installer, and repeats the installation
to test same-source behavior. Both steps succeeded.

These are genuine upstream Olla and systemd executions, but the *backend*
is simulated. The `rsudo-admin` UI, encrypted enterprise credentials, real
SSH/rsudo transport, actual `gis` host, real model computation, corporate
network policies and the other seven workers **were not exercised**.
**Physical GIS install, real inference and eight-host routing remain
unvalidated.** A fresh attempt from the assistant's environment on
2026-10-19 got TCP `ConnectionRefusedError` connecting to
`10.200.0.19:22`; no loaded `rsudo` operator session was available.

The GIS operator job's install mode enables a new `olla-gis-poc.service`
only after checking the pre-existing local Ollama endpoint, validating
the downloaded archive and passing Olla's own config validation.
It fails closed rather than overwriting a different binary, YAML or unit
already present. When running against GIS, the final gate is model discovery
plus one real bounded proxied `qwen3:4b` inference, not health-only success.
The remote job is *not* automatically executed when GitHub CI passes.
