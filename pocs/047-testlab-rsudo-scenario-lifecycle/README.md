# PoC 047 — testlab rsudo scenario lifecycle

Status: Experimental

## Question

Does the accepted minimal testlab scenario model hold up when one scenario creates a real disposable SSH/sudo system and then exposes that same live reality to both unattended and interactive rsudo activities?

The PoC is specifically testing the boundary:

```text
scenario
    materializes or binds the concrete reality

activity
    decides what to do inside that reality

assertion
    optionally decides what must be true
```

It does not define the final testlab CLI, state layout, scenario format, provider API, context representation or validation integration.

## Scenario model under test

One scenario instance has persistent experimental state and an inventory of concrete resources.

Ownership is recorded per resource:

```text
owned
    created by this scenario instance and eligible for cleanup

external
    pre-existing/shared input that the scenario may use but must not destroy
```

The PoC lifecycle is:

```text
prerequisites
    -> instance identity/state
    -> create/bind resources and record them immediately
    -> readiness
    -> publish context
    -> READY
    -> one or more activities
    -> cleanup owned resources only
```

The local `run.sh` verbs exist only to exercise that lifecycle. They are not a proposed public testlab command syntax.

## Concrete reality

The first scenario uses:

- the supplied current/development `rumiai-os` checkout as an external target;
- the host Podman engine as a prerequisite;
- a shared Ubuntu 26.04 base image as external/shared cache content;
- one disposable Podman container as a testlab-owned resource;
- a real OpenSSH server installed inside that container;
- a real unprivileged login account;
- real password authentication;
- real `sudo` requiring that password;
- a real host TCP port selected by Podman and bound only on `127.0.0.1`.

The container is not privileged.

Podman supports omitting the host port in a publish mapping such as `127.0.0.1::22`, in which case it chooses a host port; `podman port` reports the resulting mapping.

## Important rsudo integration observation

Current rsudo accepts a host identity but does not expose an SSH port/config operand. A disposable Podman target should not require binding host port 22 or modifying the operator's SSH configuration.

Therefore this PoC creates a scenario-local `ssh` adapter in the activity PATH. The adapter does not emulate SSH: it delegates to the host's real `ssh` executable and only adds `-F <scenario-config>` so the real client can reach the random localhost port.

Consequently:

- the SSH transport, sshd and sudo boundaries are real;
- the operator's `~/.ssh/config` and system SSH configuration are not modified;
- the PoC does **not** prove that current rsudo can natively address an arbitrary SSH port without an execution-environment adapter;
- whether a future product interface should expose SSH connection configuration remains a separate decision.

## Persistent experimental state

By default instances are stored below:

```text
${TMPDIR:-/tmp}/rumiai-testlab-poc-047/
```

Override this with:

```text
TESTLAB_POC_STATE_ROOT=/some/path
```

Each instance stores at least:

```text
status
resources
context
ssh_config
known_hosts
bin/ssh
probe.stdout
probe.stderr
```

The state directory is private to the invoking user. Synthetic scenario credentials are stored there deliberately so a later activity can reuse the same live scenario.

A successful cleanup leaves the instance metadata in place with status `closed`. This is experimental evidence/recovery state, not a proposal for final testlab persistence.

## Resource inventory

The experimental `resources` file is tab-separated:

```text
<ownership>    <kind>    <identity>
```

Every owned resource is recorded immediately after successful creation. Cleanup walks the inventory in reverse creation order and ignores external resources.

The representation is deliberately provisional.

## Run

Host prerequisites:

```text
podman
ssh
ssh-keyscan
openssl
standard POSIX shell utilities used by run.sh
```

The Podman service/machine must already be usable.

Prepare a scenario:

```sh
./run.sh prepare /path/to/rumiai-os
```

The command prints the instance directory. Use that exact directory for later PoC operations:

```sh
./run.sh status <instance-dir>
./run.sh context <instance-dir>
./run.sh probe <instance-dir>
./run.sh interactive <instance-dir>
./run.sh cleanup <instance-dir>
```

`probe` invokes the real current rsudo entrypoint through the scenario-local real-SSH adapter and verifies that remote `id -u` executes as root through real sudo.

`interactive` attaches the operator to an interactive rsudo shell in the same already-prepared scenario. It requires a real terminal and deliberately contains no automated assertion.

`cleanup` is idempotent for already-removed owned containers. It never removes resources recorded as external.

## Crash/recovery experiment

The resource inventory is persisted before later setup/readiness steps. To exercise recovery deliberately:

1. prepare a scenario and note its instance directory;
2. interrupt or terminate the PoC after the owned container has been recorded;
3. inspect `resources`;
4. run `./run.sh cleanup <instance-dir>`.

A normal shell trap is useful but is not the recovery authority. A process that cannot run its trap (for example after SIGKILL) still leaves the resource inventory needed by a later cleanup invocation.

## Interpretation

Evidence supporting the model requires all of the following:

1. prerequisites fail before scenario-owned runtime resources are created;
2. every created owned container is present in the persisted resource inventory;
3. readiness is established independently of the rsudo assertion;
4. the published context is sufficient for later independent activities;
5. unattended rsudo uses real SSH, sshd and sudo;
6. the same live instance remains usable for interactive work;
7. cleanup removes only owned resources;
8. cleanup can be retried from persisted state after interruption.

A failure should be classified as one of:

- scenario-model defect;
- PoC implementation defect;
- host prerequisite/Podman behavior;
- current rsudo integration limitation;
- target rsudo defect.

No PoC outcome silently becomes a permanent test or promoted RumiAI contract.
