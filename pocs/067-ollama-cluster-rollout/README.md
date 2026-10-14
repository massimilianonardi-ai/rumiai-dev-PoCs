# Ollama fleet update — operator PoC

Status: pre-physical-validation. This does not claim fleet rollout completion.

This is a site-specific rsudo-admin jobs program, not a new m command,
package installer, provider selector or service supervisor. It reconciles
the eight ALREADY DEPLOYED hosts described by the active
rumiai-local-ai-cluster-development handoff. It does not join a new host
or replace an installed Ollama concrete package root.

## Operator path

Start rsudo-admin with the required credential groups loaded in its session.
Choose "rsudo jobs"; select controller.lib.sh as the library and rollout.job
as the template. The console edits a private copy of the job before execution.
Review the three pinned SHA values in that temporary job. The template defaults
to `check` (non-mutating preflight). Edit only the final mode operand to `canary`
(apply only on gis and apps) or `rollout` (canaries, then remaining six
workers). The program preflights all eight nodes for every mode.

The controller resolves the exact catalog commit and checks for the Ollama
0.35.1 definition, then preflights all eight hosts before changing any runtime
checkout or service. It applies first to gis, then the apps worker canary,
then the other six workers sequentially. Any failure stops later mutations.

Each worker preflight requires the pinned installed CPU artifact manifest and
all its payload content, the exact provider, read-only NFS model mount, declared
fstab options, mount dependency, and active/enabled system service. The gis
preflight validates the central CPU artifact and existing system service.
After a fast-forward update each host reselects linux-x86_64, reconciles its
existing srv host system registration, restarts, checks its API and model, and
runs a real bounded Ollama CPU inference with thinking disabled.

The catalog SHA is pinned as a source/reconciliation reference. It is not
retrospective proof of the catalog revision originally used to construct
the already-installed concrete provider. The provider identity and installed
artifact digest/content are instead verified on each worker.

The updater tolerates ONLY the three managed tracked osarch selector changes.
It rejects other tracked modifications, stale expected HEADs and non-forward
updates. It preserves untracked runtime/state paths and never calls
git clean, git reset --hard or force. Git rejects conflicting untracked files.
If a node fails after a completed fast-forward, stop for diagnosis rather than
attempting a history rewrite.

The job currently assumes the known site and deployment:
- /m/src/git/rumiai-os on each Ubuntu server
- gis:/m/ai/runtime/ollama/0.35.1-cpu immutable artifact
- ollama@v0.35.1!linux-x86_64 and non-login ollama service account
- model store mounted read-only at /mnt/rumiai-ai/models on workers
- Ollama 0.35.1 at 127.0.0.1:11435 with qwen3:4b

## Validation boundary

The included isolated Git test checks selected safe-update properties with
host-manager/API/package external boundaries simulated. It is not a test of
real rsudo authentication, Ubuntu systemd, NFS, integrated package manifests
or CPU inference. A first real gis/apps canary and then a recorded fleet run
are required before this operator PoC can become a validated normal path.
