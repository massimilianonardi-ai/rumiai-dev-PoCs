# Ambiente — sessione 2026-08-27-linux-local-001

## Host

```text
Linux 0ee4dd6b00a8 6.18.35 #1 SMP Fri Aug 21 00:36:21 UTC 2026 x86_64 GNU/Linux
```

Questa è una sessione locale di audit/PoC. Non viene presentata come esecuzione su Ubuntu 26.04 LTS né come certificazione macOS.

## Shell

```text
sh      /usr/bin/sh
dash    /usr/bin/dash
bash    /usr/bin/bash
busybox /usr/bin/busybox
```

Versioni rilevate dove esposte facilmente:

```text
GNU bash 5.2.37(1)-release
BusyBox 1.37.0
```

## Utility di canonicalizzazione

```text
realpath (GNU coreutils) 9.7
```

## Matrice eseguita

- `dash`;
- `bash --posix`;
- `busybox sh`.

## Host di riferimento progettuali

Alla data della sessione il progetto considera come riferimenti:

- Ubuntu 26.04 LTS;
- macOS Tahoe 26 stabile.

La disponibilità e la semantica di `realpath` su questi host sono state verificate documentalmente; l'esecuzione runtime del PoC su macOS rimane da effettuare prima della certificazione cross-host.
