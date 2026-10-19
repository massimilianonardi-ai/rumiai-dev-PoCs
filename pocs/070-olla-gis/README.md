# Olla on GIS: pinned first inference gateway

Status: **GIS-local installation and first real proxied inference PASS** (2026-10-19). This PoC is a
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
- `install.job` — **already configured for `install`**, following the successful
  physical GIS read-only `check` on 2026-10-19. Its first line still redirects
  to the operator log path exactly; review the selected source before execution.

From a credential-loaded RumiAI operator environment, run
`rsudo-admin`, select **rsudo jobs**, then select those two files.
The user has executed both the earlier read-only check and the install job
successfully on `gis`. The install job staged the pinned Olla binary and
started the GIS-local Olla service. Its source makes no changes to any of
the eight Ollama services, network ACLs or firewalls. Re-execution is not
required to record the already-completed installation.

Physical installation is evidenced by the user's actual GIS operator log,
not by an isolated CI success. Further physical checks require the same
credential-loaded operator environment.

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

**2026-10-19 10:45:24–10:45:33 Europe/Rome — physical GIS installation and real inference PASS.** The user-supplied `rsudo-jobs(20261019-084549).log` (file name is not a log clock source; embedded timestamps are) records `rsudo.start user=mnardi host=10.200.0.19 command="sh -s -- install"`, successful SHA-256 verification (`olla_v0.0.29_linux_amd64.tar.gz: OK`), Olla v0.0.29 Linux amd64 binary revision `421fd808e59a2879059062728d2dcec06d2b23ae`, native config validation (`Result: PASS`), systemd enabling symlink for `olla-gis-poc.service`, and `OLLA GIS INSTALL OK: real qwen3:4b proxied inference; remote workers NOT configured`. `rsudo.end status=0` establishes a successful overall job. The earlier `rsudo.env-file-fallback reason=not-provided` is a nonfatal warning. The exact PoC controller requires successful local Olla health, model discovery and a completed real proxied `/api/chat` response before printing `INSTALL OK`; the log does not reproduce the response contents or test persistence after a reboot. No remote workers are included in this canary. The configured Olla listener is `127.0.0.1:40114`, routing to GIS Ollama at `127.0.0.1:11435`; this path is intentionally inaccessible to off-host application callers. The seven-worker networking, authorized client access, streaming/concurrency/failover and reboot persistence are not yet physically validated.

**2026-10-19 08:57 Europe/Rome — physical read-only preflight PASS.** The user-supplied `rsudo-jobs(20261019-065800).log` records `rsudo.start` to `10.200.0.19` with `sh -s -- check`, then `OLLA GIS CHECK: local Ollama healthy`, `OLLA GIS CHECK: Olla not staged`, `OLLA GIS CHECK OK`, and `rsudo.end status=0`. The nonfatal `rsudo.env-file-fallback reason=not-provided` warning did not stop the operation. This proves the enterprise operator's actual GIS connection and readiness check, not Olla installation or model inference. The subsequently committed `install.job` ends in `olla_gis_deploy install`; it was executed successfully at 10:45. No new job run is needed for the completed GIS-local installation. Network access or worker connectivity is a separate authorized work unit.

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
**Those GitHub CI runs did not validate physical GIS inference or eight-host routing.** The later user-provided 10:45 operator log now independently proves the GIS-local physical install and a real proxied inference; eight-host routing remains unvalidated. The assistant's environment still lacks the corporate `rsudo` credential session, which does not invalidate the user's successful physical run.

The GIS operator job's install mode enables a new `olla-gis-poc.service`
only after checking the pre-existing local Ollama endpoint, validating
the downloaded archive and passing Olla's own config validation.
It fails closed rather than overwriting a different binary, YAML or unit
already present. The GIS install job's final gate is model discovery plus one real bounded
proxied `qwen3:4b` inference, not health-only success. The user executed
that job separately from GitHub CI and it passed. Later reboot and
seven-worker validations remain distinct.
