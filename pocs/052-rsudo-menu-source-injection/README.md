# PoC 052 — rsudo menu source injection

Status: Experimental

## Question

Can the explicit stream representation proven by PoC 051 be transported through
the real `rsudo --interactive` SSH/sudo path and run the existing menu command on
a remote host that has no m runtime tree?

## Method

The PoC reuses PoC 047 only to provision a real Ubuntu 26.04 SSH/sudo target.
The target `rsudo` implementation, OpenSSH client/server and sudo remain real.

The caller explicitly embeds exactly:

```text
core
array
map
term
menu
```

The generated source installs `loadlib-inject`, its generated dispatcher and
wrappers, explicitly loads core, sets the command argv, then appends the real
`bin/sys/menu` command body. The complete program is piped to `rsudo --interactive`
with no remote m files or helper tree.

## Expected result

The remote menu renders through the SSH PTY, Enter selects the first item, the
serialized result contains `enter` and `one`, and rsudo returns status 0.
