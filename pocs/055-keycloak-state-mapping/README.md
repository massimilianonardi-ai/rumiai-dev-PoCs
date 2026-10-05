# PoC 055 — Keycloak package state mapping

## Question

For the current RumiAI Keycloak package (26.7.3), which paths below the upstream installation root are changed by a real `start-dev` execution, and which supported Keycloak CLI/environment options can relocate those writes?

This PoC supports the active task `rumiai-dev/handoff/keycloak-package-state-mapping.md`.

## Scope

- upstream Keycloak 26.7.3 tarball;
- current `rumiai-os` `pkg-analyze` at the revision recorded by the active handoff;
- GitHub Actions Ubuntu runner with Java 25;
- `start-dev` only for server startup;
- fresh extracted root for each probe case.

The PoC is diagnostic, not a permanent regression test.

## Cases

1. baseline `start-dev`;
2. `start-dev --db=dev-mem`;
3. `start-dev` with an external H2 file URL via CLI;
4. the same external H2 file URL via `KC_DB` / `KC_DB_URL`;
5. file logging redirected outside the installation root via CLI;
6. the same file logging relocation via `KC_LOG` / `KC_LOG_FILE`.

Each case runs through `pkg-analyze`. A second manifest hashes every regular file before and after the probe so modifications of already-existing files are visible in addition to pkg-analyze's pathname delta.

## Evidence

The workflow uploads:

- pkg-analyze discovery and probe reports;
- before/after root manifests;
- classified added/removed/modified root paths;
- external-state manifests for cases that redirect state;
- Keycloak command help captured from the exact probed distribution.

No conclusion from this PoC is a package contract until reviewed against the current RumiAI specifications.
