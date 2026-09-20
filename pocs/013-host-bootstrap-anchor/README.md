# PoC 013 — Host bootstrap anchor

Status: Active
Date: 2026-09-20

## Question

Can a host-supervision definition invoke an exact RumiAI `m` bootstrap without embedding the arbitrary `m_ROOT` pathname into systemd or launchd command syntax?

## Candidate mechanism

For each installed host service, the host adapter owns a service-specific bootstrap anchor (symbolic link) beside the supervisor definition:

```text
systemd user
    ~/.config/systemd/user/
        m-srv-<service>.service
        m-srv-<service>-bootstrap -> <exact m_BOOTSTRAP_BIN>

launchd user
    ~/Library/LaunchAgents/
        m.srv.<service>.plist
        m.srv.<service>.bootstrap -> <exact m_BOOTSTRAP_BIN>
```

The supervisor definition invokes the controlled anchor, not the arbitrary RumiAI installation path. Relocating the RumiAI root therefore makes the installed host integration stale until it is reinstalled, but does not require a custom systemd command-line quoting grammar.

The PoC deliberately places the fake bootstrap below a pathname containing spaces and shell/XML/systemd metacharacters, then verifies that the real host supervisor reaches that target through the anchor and passes the expected service-dispatch arguments.

## Scope

This PoC does not define final product filenames or implement `srv host`. It tests only the bootstrap-indirection and manifest-serialization strategy.
