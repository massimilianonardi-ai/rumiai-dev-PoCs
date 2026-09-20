# PoC 012 — GitHub-hosted result

Date: 2026-09-20

## Revisions and runs

```text
initial/refined lifecycle:
    rumiai-dev-PoCs@7e790f838abb7f34b305a4ad6931d2b0d2c258d4
    GitHub Actions run 35509150751
    Ubuntu   PASS
    macOS    PASS

awaited launchd bootout probe:
    rumiai-dev-PoCs@168f71396c3547f50af982fa557fece8b4c8f2a4
    GitHub Actions run 35509294369
    Ubuntu   PASS
    macOS    PASS

relocatable invocation probe:
    rumiai-dev-PoCs@a500e3073d89d00127e0a174958ad64a0d43dbef
    GitHub Actions run 35511575613
    Ubuntu   PASS
    macOS    PASS
```

## Findings

- A real `systemctl --user` manager is reachable on the GitHub Ubuntu runner and supports the normalized install/start/stop/restart/uninstall lifecycle.
- A real `gui/<uid>` launchd domain is reachable on the GitHub macOS runner.
- launchd foreground jobs satisfy the same no-self-daemonizing process model already required by the RumiAI service contract.
- `launchctl bootout` is suitable for normalized stop when completion is awaited: the job leaves the domain while the installed plist remains.
- `launchctl bootstrap` can start that installed-but-unloaded definition again.
- `launchctl kickstart -k` provides restart for a loaded job.
- Native supervisor verbs should remain adapter details rather than becoming the portable/public RumiAI host-action vocabulary.
- systemd rejects an arbitrary special-character RumiAI bootstrap pathname when that pathname is the ExecStart executable, even when unit escaping reconstructs it correctly.
- Using the already-contracted `/bin/sh` interpreter as the systemd executable and passing the exact `m` bootstrap plus command as serialized arguments preserves relocatability for the stressed path set.
- launchd `ProgramArguments` constructed through `plutil` preserves the exact bootstrap/command argv for the same stressed path set and avoids shell/XML reinterpretation.

## Limits

This is auxiliary GitHub-hosted evidence, not physical validation. It does not prove system-scope privilege/account semantics. User-scope lifecycle and relocatable manifest invocation are established for the tested systemd/launchd hosts.
