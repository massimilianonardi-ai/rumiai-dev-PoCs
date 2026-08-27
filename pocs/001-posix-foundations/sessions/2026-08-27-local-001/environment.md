# Ambiente — sessione 2026-08-27-local-001

## Host di test

```text
Linux 93ae9706778b 6.18.35 #1 SMP Fri Aug 21 00:36:21 UTC 2026 x86_64 GNU/Linux
```

La sessione è stata eseguita nell'ambiente locale di lavoro usato durante l'audit; il risultato non viene assunto come prova di conformità universale, ma come riproduzione concreta dei difetti su più implementazioni di shell.

## Shell verificate

```text
sh      /usr/bin/sh
dash    /usr/bin/dash
bash    /usr/bin/bash
busybox /usr/bin/busybox
```

Matrice eseguita:

- `/bin/dash`
- `/bin/bash --posix`
- `/usr/bin/busybox sh`

## Sorgente storico

Snapshot analizzato:

```text
massimilianonardi/m@e4faae1c1d9b27cc5503b987ba5e7bf2874c906c
```

Primitive interessate:

- `cmd/lib/enc.lib.sh`: `rand()`, `a2o()`
- `cmd/lib/array.lib.sh`: `array()`
- `cmd/lib/arg.lib.sh`: `quote()` usata dall'implementazione array

## Nota su `$RANDOM`

La presenza di `$RANDOM` in una specifica shell non lo rende parte del contratto POSIX. Nella sessione Bash in modalità POSIX e BusyBox `sh` lo espongono comunque; `dash` non lo espone e consente di riprodurre direttamente il difetto di portabilità.
