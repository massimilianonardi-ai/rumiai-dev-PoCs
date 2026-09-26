# PoC 036 — podman-static relocatability

Status: Experimental

## Question

Can the unmodified current `mgoltzsche/podman-static` release bundle be used from an arbitrary Linux filesystem location with isolated mutable state, closely enough to serve as the upstream basis for a relocatable RumiAI `pkg podman`?

The preferred outcome is direct reuse. This PoC is specifically looking for evidence that would force a RumiAI-specific adaptation or justify an upstream report; it is not attempting to redesign or rebuild Podman.

## Pinned upstream input

The experiment currently pins:

- `mgoltzsche/podman-static` release `v6.1.2`;
- the published amd64 and arm64 release archives;
- the release SHA-256 digests published by GitHub.

No distro Podman package is installed by the experiment.

## Hypothesis

After extraction and physical relocation of the release tree:

1. the shipped executables remain runnable without copying them into `/usr/local`;
2. Podman can be pointed at the relocated `conmon`, `crun`, networking helpers and seccomp/configuration data;
3. mutable config, graph storage, run state, HOME and temporary files can all stay below experiment-owned directories;
4. with real host prerequisites present, the same relocated bundle can execute a container, rootless networking, a communicating pod, port forwarding and `podman kube play/down`;
5. any remaining dependency can be classified as a Linux host contract rather than accidentally inherited distro userland.

## Important current concern

The upstream static build deliberately omits the Podman `systemd` build tag. Current upstream/community evidence indicates that this also removes the scheduler used by container health checks: a configured health check can remain in `starting` state indefinitely even though the container itself is running.

The experiment records both the static binary evidence and the observed runtime health state. This matters for RumiAI because health-based service readiness would be a natural testing primitive.

## Isolation choices

The experiment uses the `vfs` storage driver first. This deliberately avoids making `/dev/fuse` a prerequisite for the first compatibility result; `fuse-overlayfs` can be evaluated separately as a performance/storage optimization.

It does not install `uidmap`, rewrite `/etc/subuid` or `/etc/subgid`, or otherwise repair the host. Missing subordinate-ID support is recorded as a host requirement.

## Run

```sh
./run.sh
```

The associated GitHub Actions workflow runs the experiment on a clean hosted Ubuntu environment where the release artifact can be downloaded directly.

## Interpretation

A PASS means the upstream bundle, with launch-time path/configuration materialization only, successfully exercised the listed behaviors from a relocated tree. It is experimental evidence, not a promoted package contract and not permanent RumiAI validation.

A failure must be classified before proposing a private patch:

- missing/unsupported host facility;
- upstream `podman-static` defect or limitation;
- Podman contract requirement;
- RumiAI package-integration mismatch.

