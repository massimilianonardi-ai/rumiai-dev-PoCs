# PoC 050 — rsudo ssh-command

Status: Experimental

## Question

Does current `rsudo --ssh-command` correctly replace the SSH command in normal,
recursive and interactive execution without regressing the existing rsudo suite?

This PoC validates the user-authored runtime change at
`rumiai-os@c33b39ded5020d85943ca826cedbe3ff6d2a4492`.
It does not define the final public contract.

## Cases

The real-network cases reuse PoC 047 only as a scenario provider. They exercise:

1. `--ssh-command "<ssh> -F <scenario-config>"` in non-interactive rsudo;
2. ambient `RSUDO_SSH_COMMAND` without the option;
3. a recursive `rsudo fs delete` call, proving the selected SSH command survives
   the recursive call;
4. interactive rsudo through a real PTY;
5. command-string behavior when one SSH argument pathname contains spaces.

The SSH client, sshd and sudo path remain real. PoC 047's PATH shim is not used for
these cases.

The workflow separately runs the complete permanent `rumiai-os/rsudo` group against
the same product revision to detect regressions.

## Interpretation

The first four cases are expected to succeed.

The pathname-with-spaces case is observational: it determines whether the current
unquoted expansion of `RSUDO_SSH_COMMAND` has full command-line quoting semantics.
A non-zero result here is evidence of a command-string representation limitation,
not an rsudo transport failure.

No PoC result silently changes the rsudo specification or permanent tests.
