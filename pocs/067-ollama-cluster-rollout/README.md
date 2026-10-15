# Ollama fleet update — two-file rsudo-admin operator PoC

Status: **physical 8/8 fleet success demonstrated by the 2026-10-14 chat-inline
operator code; this repository consolidation remains pending its own physical
re-run**. Do not treat the committed code as byte-identical to the code that
produced the successful log.

## Operator path

The PoC comprises exactly **two operator-selected source files**:

- `controller.lib.sh`: sourced by `rsudo-admin jobs`; embeds the complete
  remote POSIX shell program, exposes `cluster_rollout` and actually defines
  `repair_ollama_nfs_worker` for worker apply operations.
- `rollout.job`: selected as the job template. Its **mandatory first line**
  is exactly `exec > "/m/src/git/rsudo-jobs.log" 2>&1`.

Load the eight rsudo credential groups in the operator's own session. Select
`controller.lib.sh`, then `rollout.job` in `rsudo-admin jobs`. Review the
three pinned SHA-1/SHA-256 values in the editable job. The committed job
defaults to `check`. Edit the final mode operand to `canary` (after global
preflight, apply gis/apps only) or `rollout` (gis/apps canaries, then six
remaining workers). The log's absolute path is fixed and truncated on every
run. Library sourcing and interactive job editing precede log redirection.

The controller pins the catalog, checks every host before applying changes,
preserves tracked/untracked Git state except for the three approved osarch
selectors, uses Git fast-forward only, and refuses concurrent unexpected
changes. All seven workers must retain the concrete
`ollama@v0.35.1!linux-x86_64`; the central CPU artifact is pinned. The
worker CPU package root is verified against a SHA-256-pinned artifact manifest
found in the concrete root **or** in the pre-existing local
`/var/lib/ollama-worker/runtime/0.35.1-cpu/MANIFEST.sha256` **or** in the
shared read-only `/mnt/rumiai-ai/runtime/MANIFEST.sha256`. A missing
manifest, a mismatched manifest hash or a mismatched installed payload
stops the rollout before mutation.

For this persistent PoC, worker model NFS mount, fstab and service mount
dependency are **validated fail-closed**, rather than changed. The successful
chat-inline operator version also supported conservative NFS reconciliation;
that additional behavior has *not* been ported here. Do not represent this
PoC as a drop-in replacement for its NFS repair behavior. The current
deployment has already passed these NFS checks and needs no repair.

On a changed Git revision or an unhealthy service, apply reconciles the system
service with `srv host system install` and restarts it. On a repeat run with
the exact pinned revision and healthy service/API, unnecessary service
restarts are skipped. Each apply verifies enabled/active service, Ollama API
version, visibility of `qwen3:4b`, and bounded real chat inference.

## Current known fleet

- Eight hosts: `gis`, `apps`, `apisix`, `keycloak`, `apisix_psn`,
  `apps_psn`, `keycloak_psn`, `webgisrpr`.
- 2026-10-14 physically deployed `rumiai-os` pin:
  `9f4524d9af44cc031ba039b88cfda8d2df0e1c65`.
- All hosts retain the local `/m/src/git/rumiai-os` checkout.
- Read-only NFS model store on workers:
  `/mnt/rumiai-ai/models`.
- Ollama v0.35.1 API endpoint:
  `127.0.0.1:11435`.

## Validation and remaining evidence

On 2026-10-15, [GitHub Actions run 38702344501](https://github.com/massimilianonardi-ai/rumiai-dev-PoCs/actions/runs/38702344501) completed successfully for committed SHA `e516e5fd314716a2315392067ac9ef3ceab5d6f3`: `sh`/`dash`/`bash` syntax, simulated fleet sequencing, an extracted verifier using real SHA-256 on a disposable filesystem and isolated real Git forward/repeat/stale-HEAD tests all passed. The Git fixture substitutes systemd, API, package metadata and physical rsudo transport; these are not full live-cluster tests. The exact committed two-file code is still pending physical validation and NFS reconciliation parity remains intentionally open.

`test-controller.sh` exercises the **simulated rsudo sequencing boundary**;
`test-git-safety.sh` exercises real local Git in a disposable root Linux
environment while mocking OS/service/API dependencies;
`test-worker-manifest.sh` exercises real SHA-256 commands against an
isolated extracted worker-manifest verifier. Run with POSIX `sh`.
The isolated test host must permit a disposable `/m`; the Git safety
test refuses to run if `/m` already exists. It must not be run on the
user's production hosts.

The recorded 2026-10-14 run validated an earlier, **chat-inline** two-file
operator with global preflight 8/8, canaries gis/apps, then six successful
applies. It did not validate this exact committed PoC, an additional actual
post-update reboot, or a repeat run. The separate historical `rsudo-admin`
terminal closure issue is also unresolved as an independent question.
