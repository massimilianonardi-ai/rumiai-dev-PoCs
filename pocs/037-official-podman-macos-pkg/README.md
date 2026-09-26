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
