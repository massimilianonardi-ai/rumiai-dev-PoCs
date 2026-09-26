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

## Observed results

GitHub Actions run `36226837622` exercised the released `v6.1.2` archive after extracting it and physically moving the complete bundle to a different path.

### Binary closure

The inspected shipped executables used by the experiment are static or static PIE and expose no ELF interpreter, including:

- `podman`;
- `crun`;
- `runc`;
- `conmon`;
- `fuse-overlayfs` and `fusermount3`;
- `pasta` / `passt`;
- `netavark`;
- `aardvark-dns`;
- `catatonit`;
- `rootlessport`;
- `quadlet`.

The relocated Podman process was observed using the relocated `conmon` and `crun` paths and experiment-owned graph/run roots. No copy into `/usr/local` was required.

### Rootless functional path

On Ubuntu 22.04, and on Ubuntu 24.04 with its unprivileged-user-namespace AppArmor restriction disabled only for the diagnostic run, the unmodified release bundle passed:

- `podman info`;
- image pull and basic container execution;
- rootless outbound networking;
- communication between containers in one pod;
- host port forwarding;
- `podman kube play --network=pasta` followed by `podman kube down`.

The experiment used explicit launch-time configuration and isolated state only; it did not rebuild or patch the upstream binaries.

### Ubuntu 24.04 AppArmor path policy

On the strict Ubuntu 24.04 hosted runner:

- AppArmor was enabled;
- `kernel.apparmor_restrict_unprivileged_userns=1`;
- the installed Podman profile was pathname-bound to `/usr/bin/podman`;
- the relocated binary failed during rootless re-exec.

The kernel audit identified the relocated executable and denied `/proc/self/exe` execution while transitioned into the `unprivileged_userns` profile.

This is classified as a host security-policy/path integration constraint, not evidence that the static bundle itself requires its original extraction path.

### Default Kube networking without a user systemd bus

On the hosted environments that otherwise passed rootless execution, plain `podman kube play` reached Netavark/Aardvark but failed when Aardvark attempted to use `systemd-run --user` while no user systemd bus was available.

The same manifest passed with `--network=pasta`. For the initial RumiAI service-test use case, the experiment therefore demonstrates a rootless path that does not require the default Aardvark startup path.

### Health-check scheduling

A container created with an automatic health check remained in `starting` after the configured interval. This matches the known consequence of the current `podman-static` build omitting Podman's `systemd` build tag: the release is usable for the tested container/service behaviors, but automatic Podman health-check scheduling must not currently be assumed.

RumiAI can still perform explicit readiness probes independently; whether automatic Podman health scheduling is a required package property remains a separate integration decision.

## Current conclusion

The evidence supports direct reuse of `mgoltzsche/podman-static` as the preferred upstream basis rather than rebuilding the Podman userland closure.

No RumiAI-specific binary patch has been justified by this PoC. The remaining concerns are host/integration contracts:

1. rootless subordinate-ID/user-namespace prerequisites;
2. hardened AppArmor pathname policy on recent Ubuntu hosts;
3. default Netavark/Aardvark behavior when a systemd host has no user bus;
4. absent automatic health-check scheduling in the no-systemd Podman build.

These must be handled or explicitly scoped by the eventual package/test integration rather than silently hidden in a private fork.

