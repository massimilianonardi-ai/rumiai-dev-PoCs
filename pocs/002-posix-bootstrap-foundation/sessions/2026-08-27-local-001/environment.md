# Ambiente — sessione 2026-08-27-local-001

## Host

```text
Linux 93ae9706778b 6.18.35 #1 SMP Fri Aug 21 00:36:21 UTC 2026 x86_64 GNU/Linux
```

## Shell disponibili

```text
dash    /usr/bin/dash
bash    /usr/bin/bash
busybox /usr/bin/busybox
```

Matrice eseguita:

- `dash`;
- `bash --posix`;
- `busybox sh`.

## Nota

Questa sessione dimostra il comportamento del PoC sulle implementazioni disponibili nell'ambiente di audit. Non sostituisce la futura matrice di certificazione su macOS e Cygwin.

Il PoC non usa path host-specific per i propri workspace temporanei: crea `.work/` relativamente alla propria root e lo rimuove al termine dei test.
