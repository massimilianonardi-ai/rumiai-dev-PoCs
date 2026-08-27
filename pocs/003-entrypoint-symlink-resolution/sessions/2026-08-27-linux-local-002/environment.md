# Environment — PoC 003 linux-local-002

Date: 2026-08-27

## Host

```text
Debian GNU/Linux 13 (trixie)
Linux 6.18.35 x86_64
```

The session ran in the available Linux development container. It is not a runtime certification of Ubuntu LTS or macOS.

## Path utility

```text
realpath (GNU coreutils) 9.7
```

## Shell matrix

```text
dash 0.5.12-12
GNU bash 5.2.37(1)-release, invoked with --posix
BusyBox 1.37.0 sh
```

## Normative target

```text
POSIX.1-2024
The Open Group Base Specifications Issue 8
```

## Scope

The environment is used to test the RumiAI entrypoint/root-resolution contract across independent shell implementations while delegating physical pathname resolution to the host `realpath` utility.
