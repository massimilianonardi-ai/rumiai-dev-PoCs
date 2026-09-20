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


## Result

GitHub-hosted execution established a common user-scope lifecycle on both current auxiliary hosts.

Run `35509150751` at `7e790f838abb7f34b305a4ad6931d2b0d2c258d4` passed on Ubuntu and macOS with:

```text
Linux
    install  -> write unit + systemctl --user enable
    start    -> systemctl --user start
    stop     -> systemctl --user stop
    restart  -> systemctl --user restart
    uninstall-> stop + disable + remove + daemon-reload

macOS
    install  -> write LaunchAgent definition + launchctl enable
    start    -> bootstrap when unloaded / kickstart when loaded
    stop     -> SIGTERM through launchctl while definition remains loaded
    restart  -> kickstart -k
    uninstall-> remove definition + bootout
```

A follow-up run `35509294369` at `168f71396c3547f50af982fa557fece8b4c8f2a4` also passed on both hosts and established that an awaited `launchctl bootout <service-target>` cleanly unloads the installed LaunchAgent while leaving its plist on disk; the service can then be started again with `bootstrap`.

Therefore the cleaner normalized launchd mapping is:

```text
install
    persist the plist and enabled intent without starting the service

start
    bootstrap the installed plist when unloaded

stop
    bootout the loaded service and leave the plist installed

restart
    kickstart -k when loaded
    (implementation must handle the installed-but-unloaded state coherently)

uninstall
    bootout if loaded, remove the plist, clear any adapter-owned persistent state
```

The PoC does not establish the final manifest serialization mechanism, adapter filesystem names, system-wide privilege/account policy, or RumiAI product implementation.
