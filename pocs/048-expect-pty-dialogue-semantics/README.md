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
- after the child then exits normally, a minimal POSIX wrapper preserves status 37 independently of Expect's post-`interact` wait semantics and the driver propagates that status.

## Human handoff

The PoC now exercises Expect's real `interact` primitive.

The inner handoff driver performs one deterministic setup exchange, emits an experimental handoff marker, then calls `interact`. A second Expect process is used only as an automated laboratory harness: it provides a real controlling PTY to the inner driver and simulates operator input after observing the handoff marker.

The PoC uses the literal local sequence `__TESTLAB_RETURN__` only as an experimental escape from `interact`. Expect consumes that sequence locally, returns control to the driver, and does not forward it to the child. The driver then continues deterministic dialogue with the same child.

The exercised Expect implementations diverge in the status returned by `wait` after a spawn has passed through `interact`: Expect 5.45 on macOS preserved the fixture's status 37 in this experiment, while Expect 5.45.4 on Ubuntu returned 0 even though handoff, return to automation and child completion all succeeded. `close_on_eof 0` did not remove that divergence.

The PoC therefore wraps only the spawned target with a minimal POSIX-sh status recorder. It executes the target unchanged, records its numeric status in a private PoC-owned file, and exits with the same status. Expect still owns the PTY/dialogue boundary; the status recorder prevents adapter semantics from depending on the divergent post-`interact` `wait` result. This is an internal experimental mechanism, not a proposed public file/API contract.

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
