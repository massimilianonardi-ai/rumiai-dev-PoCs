# PoC 048 — Expect PTY dialogue semantics

Status: Experimental

## Question

Can one small Expect-based host adapter provide the stronger interactive-driver semantics RumiAI needs without making those semantics part of testlab orchestration?

This PoC tests only:

- execution of a child behind a real PTY;
- exact prompt synchronization before sending each response;
- transcript capture;
- distinction between dialogue synchronization failure and child-command result;
- propagation of a normal child exit status;
- handoff from automated dialogue to the operator through Expect `interact`;
- explicit return of control from the operator to automation while the child remains live;
- portable child exit-status preservation after automation resumes.

It does not define a public RumiAI command name, final CLI, scenario API, activity DSL, assertion DSL or testlab integration.

## Host prerequisite model

`expect` is treated as a host prerequisite for this experiment.

On Ubuntu the workflow installs the distro package before running the PoC. On macOS the experiment uses the Expect already available on the host when present.

The experiment does not install or package Tcl/Expect through RumiAI `pkg`.

## Fixture

The prompt/dialogue fixture deliberately:

1. requires standard input to be a TTY;
2. prints a prompt without a terminating newline;
3. waits for the first exact response;
4. prints a second prompt;
5. waits for the second exact response;
6. prints an observable completion record;
7. exits with status 23.

A second handoff fixture verifies the hybrid path:

1. requires a TTY;
2. accepts one response sent by automated Expect logic;
3. announces that operator handoff is ready;
4. waits for input that can arrive only through the driver's `interact` phase;
5. reports the operator-supplied value;
6. remains live while the operator returns control to the driver;
7. accepts one final automated response after handoff;
8. exits with status 37.

A driver that merely pre-feeds ordinary stdin is not the semantic model being tested; the Expect driver explicitly waits for each prompt before sending its corresponding response.

## Experimental dialogue format

The PoC-local dialogue file contains one record per interaction:

```text
<prompt><TAB><response>
```

This format is intentionally experimental and is not a proposed product format.

## Run

```sh
./run.sh
```

The run verifies:

- the child observed a TTY;
- the two expected prompts were synchronized in order;
- the responses reached the child;
- the transcript contains the final completion record;
- the driver returned the child's status 23 after successful dialogue;
- a deliberately wrong prompt produces driver timeout status 124 rather than being reported as a child/application result;
- the handoff driver completes automated setup before entering `interact`;
- input from the caller's terminal reaches the child only after handoff;
- child output remains visible through the handoff path;
- an experimental local escape returns control from `interact` to the driver without being forwarded to the child;
- the driver can resume deterministic dialogue with the same live child;
- after the child then exits normally, a minimal POSIX target wrapper preserves status 37 independently of Expect's post-`interact` wait semantics;
- a minimal POSIX launcher keeps driver/infrastructure status separate from target status and returns the target status only after the Expect driver completed successfully.

## Human handoff

The PoC now exercises Expect's real `interact` primitive.

The inner handoff driver performs one deterministic setup exchange, emits an experimental handoff marker, then calls `interact`. The operator side is bound explicitly to Expect's `tty_spawn_id`, which represents the controlling `/dev/tty`, rather than relying on the default `user_spawn_id`/stdin mapping. A second Expect process is used only as an automated laboratory harness: it provides a real controlling PTY to the inner driver and simulates operator input after observing the handoff marker.

The PoC uses the literal local sequence `__TESTLAB_RETURN__` only as an experimental escape from `interact`. Expect consumes that sequence locally, returns control to the driver, and does not forward it to the child. The driver then continues deterministic dialogue with the same child.

The exercised Expect implementations diverge in the status returned by `wait` after a spawn has passed through `interact`: Expect 5.45 on macOS preserved the fixture's status 37 in this experiment, while Expect 5.45.4 on Ubuntu returned 0 even though handoff, return to automation and child completion all succeeded. `close_on_eof 0` did not remove that divergence.

The PoC therefore uses two tiny POSIX-sh boundaries around Expect. A target wrapper executes the target unchanged and records its numeric status in a private PoC-owned file. The Expect driver owns only PTY/dialogue/handoff semantics and returns success when that infrastructure completed correctly. An outer POSIX launcher returns any driver error unchanged; only after a successful driver run does it read and propagate the recorded target status.

This keeps infrastructure failure distinct from command result and prevents the adapter contract from depending on the divergent post-`interact` `wait` result. The private status file and wrapper/launcher layout are experimental internal mechanics, not proposed public APIs.

This nesting is intentionally test infrastructure, not a proposed product design. It lets CI mechanically establish the hybrid boundary:

```text
automated Expect setup
    -> interact
    -> caller terminal input/output
    -> child PTY
    -> local return-control sequence
    -> automation resumes
    -> child completes
    -> private POSIX status record
    -> Expect driver success
    -> POSIX launcher
    -> child status
```

Earlier PoC attempts established the same portability warning both when the child reached EOF during `interact` and when the child exited only after control had returned to automation. The working design therefore does not make Expect's post-`interact` `wait` status part of the candidate cross-host semantics.

The PoC still does not fix a public command, public escape sequence or higher-level handoff UI.

## Interpretation

A PASS is evidence that the strong PTY/dialogue semantics can be built on Expect as a host prerequisite on the exercised host.

A host without Expect is a missing prerequisite, not evidence that testlab needs to package Expect.

A failure must be classified as:

- host prerequisite/tool behavior;
- PoC driver defect;
- PTY semantic mismatch between hosts;
- child/fixture defect.

No result is a promoted RumiAI product contract by itself.


## Observed results

GitHub Actions run `36302392760` passed on both configured CI hosts.

Observed host prerequisite/tool versions:

```text
Ubuntu 24.04 amd64
    /usr/bin/expect
    Expect 5.45.4
    installed from the Ubuntu repository by the workflow

macOS 15
    /usr/bin/expect
    Expect 5.45
    already present on the host
```

Both hosts passed the same experiment:

```text
PASS expect PTY dialogue semantics
```

That result mechanically exercised a TTY-requiring child, two exact prompt/response synchronization points, transcript capture, child exit-status propagation (23), and a deliberate wrong-prompt timeout classified by the driver as status 124.

This supports using Expect as the common stronger PTY/dialogue prerequisite rather than reducing the contract to the weaker pre-fed-input behavior currently used with `script(1)` on Linux.

The run is CI evidence only. It does not replace execution on the physical/reference macOS host or Ubuntu 26.04 reference host. The original recorded run predates the added `interact` experiment; a new result is recorded only after the updated PoC has run successfully.

### Interact handoff result

GitHub Actions run `36312456161` exercised PoC revision `81c514d31980e42a775ba929dc506ea848ca6189` on both configured CI hosts.

```text
Ubuntu 24.04 amd64 / Expect 5.45.4    PASS
macOS 15 / Expect 5.45               PASS
```

Both hosts observed:

```text
PASS expect PTY dialogue and interact handoff semantics
```

The final experiment mechanically proved the hybrid sequence:

```text
automated prompt/response
-> real Expect interact
-> caller-PTY input reaches the child
-> child output returns through the handoff
-> local return-control sequence
-> deterministic automation resumes on the same live child
-> target status 37 preserved independently from divergent post-interact Expect wait behavior
```

During development the PoC also exposed a real portability detail: after a spawn had passed through `interact`, Expect 5.45/macOS and Expect 5.45.4/Linux did not report the target exit status consistently through Expect's own process-status path. The final PoC therefore keeps PTY/dialogue responsibility in Expect and preserves target status through the minimal POSIX wrapper/launcher boundary described above.

This remains hosted-CI evidence. Physical/reference-host execution on macOS and Ubuntu 26.04 ARM64 is still required before promoting a production adapter surface.

### Physical Ubuntu controlling-terminal correction

Physical Ubuntu 26.04.1 ARM64 execution exposed a distinction that the hosted nested harness had not made visible. With the original default `interact` mapping, the direct operator run returned from `interact` immediately before the operator could enter the `human>` response. The driver then resumed automation after the child side had closed and reported `send: spawn id ... not open`.

The cause is at the handoff boundary: Expect's default user side is `user_spawn_id`, which represents the process standard input, while Expect separately exposes `tty_spawn_id` for the controlling `/dev/tty`. The physical operator contract is specifically terminal control, not arbitrary inherited stdin.

The PoC therefore now binds the operator side of `interact` explicitly to `tty_spawn_id` and the child side explicitly to the saved child spawn id. If a controlling terminal is unavailable, the handoff driver reports an infrastructure error rather than silently treating stdin EOF as an operator return.

This correction is still PoC-local. It does not promote a public adapter API or escape sequence.
