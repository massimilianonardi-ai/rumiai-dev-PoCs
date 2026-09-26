# PoC 037 — official Podman macOS package relocation

Status: Experimental

## Question

Can the exact official Podman macOS installer payload be used from a relocatable RumiAI package root, without rebuilding Podman and without materially changing the behavior expected from the official distribution?

This is intentionally stricter than merely asking whether the `podman` executable launches.

## Upstream input

Pinned input:

- Podman `v6.1.2`;
- official `podman-installer-macos-arm64.pkg`;
- release SHA-256 `88def43af7fbe7baf40fc2f12d69267f6d845768020709900fb1b8c3bfe015b3`.

The experiment does not use Homebrew and does not rebuild any Podman binary.

## Method

The macOS runner:

1. downloads and verifies the official signed installer;
2. expands the flat package without installing it system-wide;
3. copies the exact `/opt/podman` payload to an arbitrary temporary location;
4. verifies the code signatures of the principal shipped binaries;
5. records the baked-in `/opt/podman/bin` helper path;
6. uses Podman's documented `helper_binaries_dir` configuration to point helper lookup at the relocated official binaries;
7. exercises client/machine inspection and `podman machine init` using isolated HOME/configuration.

The experiment deliberately does not claim `podman machine start` validation because GitHub-hosted macOS runners do not support nested virtualization.

## Interpretation

A successful result would show that the official userland payload itself can remain unmodified and relocatable with documented configuration only. It would not by itself prove complete equivalence with the system installer, because the official pre/post-install scripts also configure PATH/manpath and install the optional `podman-mac-helper` system service used for default Docker socket integration.

A failure is evidence against using a relocatable RumiAI `pkg podman` on macOS and favors simply using the official system installer.

## Observed result

GitHub Actions run `36227410955` executed on the standard ARM64 `macos-14` runner.

The exact upstream v6.1.2 installer:

- matched the release SHA-256;
- was signed by `Developer ID Installer: Red Hat, Inc. (HYSCB8KRL2)`;
- was trusted by Apple's notary service and accepted by Gatekeeper;
- expanded to the official Podman payload containing `podman`, `gvproxy`, `vfkit`, `krunkit`, `podman-mac-helper`, libraries and documentation;
- preserved valid code signatures for all principal relocated executables.

The official `podman` binary contains the build-time `/opt/podman/bin` helper path, as expected from the upstream installer build. With only the documented `helper_binaries_dir` override pointed at the relocated official payload, the relocated client:

- reported Podman 6.1.2;
- selected its macOS machine provider;
- successfully downloaded the machine image;
- completed `podman machine init`;
- successfully exposed the resulting machine through `podman machine inspect`.

`podman machine start` was intentionally not used as validation because GitHub-hosted macOS runners do not support nested virtualization.

## Conclusion

The exact official Podman userland payload is substantially relocatable without rebuilding: documented configuration is sufficient for the tested client and machine-initialization path.

It is nevertheless **not identical to running the official installer**, because relocation deliberately omits the installer's system-side effects, including PATH/manpath registration and installation of `podman-mac-helper` for the default Docker socket integration.

Under the task's stricter equivalence criterion, this PoC therefore does not justify a RumiAI `pkg podman`. The official macOS `.pkg` installer already provides the no-Homebrew path while preserving the complete upstream installation behavior.
