# PoC 012 — User host supervision

Status: Active
Date: 2026-09-20

## Question

Can the current RumiAI `srv host user` design rely on a small normalized lifecycle:

```text
install
uninstall
start
stop
restart
```

while mapping to real host user supervisors without introducing host semantics into the portable `srv` core?

The PoC intentionally does **not** test RumiAI package/provider behavior. It tests only the external host-supervisor boundary that a future adapter must call.

## Linux probe

The Linux path uses the calling user's real systemd user manager:

```text
~/.config/systemd/user/<unit>
systemctl --user daemon-reload
systemctl --user enable
systemctl --user start
systemctl --user restart
systemctl --user stop
systemctl --user disable
```

The probe does not enable linger. If the hosted environment has no reachable systemd user manager, that is recorded as an environment limitation rather than hidden.

## macOS probe

The macOS path uses a real per-user LaunchAgent definition:

```text
~/Library/LaunchAgents/<label>.plist
launchctl bootstrap gui/<uid> <plist>
launchctl kickstart -k gui/<uid>/<label>
launchctl bootout gui/<uid>/<label>
```

The probe uses `plutil -lint` for plist syntax. It does not use the legacy `launchctl load/unload` surface.

If a GitHub-hosted macOS runner has no GUI login domain, that is expected to expose the need for physical/logged-in host validation rather than motivating a fake domain.

## Scope

This PoC answers only:

- whether the host manager is reachable in the auxiliary environment;
- whether the normalized lifecycle can be represented by real host operations;
- whether stop/uninstall must be modeled differently from native command names.

It does not define system-wide account policy, RumiAI state mapping, restart policy, logging policy or the final adapter filesystem layout.
