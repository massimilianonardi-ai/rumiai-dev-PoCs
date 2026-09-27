# PoC 048 — Expect PTY dialogue semantics

Status: Experimental

## Question

Can one small Expect-based host adapter provide the stronger interactive-driver semantics RumiAI needs without making those semantics part of testlab orchestration?

This PoC tests only:

- execution of a child behind a real PTY;
- exact prompt synchronization before sending each response;
- transcript capture;
- distinction between dialogue synchronization failure and child-command result;
- propagation of a normal child exit status.

It does not define a public RumiAI command name, final CLI, scenario API, activity DSL, assertion DSL or testlab integration.

## Host prerequisite model

`expect` is treated as a host prerequisite for this experiment.

On Ubuntu the workflow installs the distro package before running the PoC. On macOS the experiment uses the Expect already available on the host when present.

The experiment does not install or package Tcl/Expect through RumiAI `pkg`.

## Fixture

The fixture program deliberately:

1. requires standard input to be a TTY;
2. prints a prompt without a terminating newline;
3. waits for the first exact response;
4. prints a second prompt;
5. waits for the second exact response;
6. prints an observable completion record;
7. exits with status 23.

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
- a deliberately wrong prompt produces driver timeout status 124 rather than being reported as a child/application result.

## Human handoff

Expect's `interact` primitive remains the intended mechanism to hand an already-spawned PTY back to the operator in a later adapter design. This PoC deliberately does not fix how that transition is represented in a public interface; it first proves the common prompt-synchronized PTY core.

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

The run is CI evidence only. It does not replace execution on the physical/reference macOS host or Ubuntu 26.04 reference host, and it does not yet validate the future human-handoff surface built around Expect `interact`.
