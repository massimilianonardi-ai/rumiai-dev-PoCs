# PoC 004 — Phase 1 regression suite

## Obiettivo

Trasformare la matrice fisica Phase 1 già validata in una suite di regressione ripetibile e aggiungere forcing sistematico degli status bootstrap/CLI `1..10` senza modificare il checkout prodotto sottoposto a test.

Baseline:

**POSIX.1-2024 / The Open Group Base Specifications Issue 8**.

Repository prodotto di riferimento:

```text
massimilianonardi-ai/rumiai-os
```

Commit fisicamente validato di riferimento:

```text
4f311d1fb5b35a722cf9575d890a9fa616040199
```

Il checkout passato alla suite è trattato come input read-only. Ogni test che richiede mutazioni lavora su una copia temporanea contenente soltanto l'albero prodotto (`rumiai-os`, `bin`, `conf`, `lang`, `lib`).

## Esecuzione

Da un checkout di `rumiai-dev-PoCs`:

```sh
sh pocs/004-phase-1-regression/tests/run /percorso/al/checkout/rumiai-os
```

Per ripetere solo una delle due sezioni:

```sh
sh pocs/004-phase-1-regression/tests/core /percorso/al/checkout/rumiai-os
sh pocs/004-phase-1-regression/tests/status-map /percorso/al/checkout/rumiai-os
```

La suite non usa Git per identificare o modificare il prodotto: l'operatore deve selezionare esplicitamente il checkout/commit da validare e registrarlo nella sessione di test.

## Copertura automatizzata

`tests/core` automatizza la parte non interattiva della matrice fisica consolidata:

- syntax check con host POSIX `sh` e, se disponibile, Bash in POSIX mode;
- mode eseguibile del runtime e di `bin/log`;
- esposizione strutturale `bin/rumiai-os -> ../rumiai-os`;
- explicit source senza shebang e senza executable bit;
- direct source con `#!/usr/bin/env rumiai-os`;
- status logger `12..16` e filtering;
- canonicalizzazione del runtime via pathname relativo/assoluto, PATH, symlink relativi/assoluti, chain, symlink intermedio e pathname con spazi;
- PATH relativo da CWD arbitraria;
- canonicalizzazione del source con spazi e alias/symlink chain;
- precedenza lingua/config e fallback lingua/encoding;
- lifecycle `return`, fall-through failure, `exit`, SIGTERM.

L'avvio realmente interattivo Bash/POSIX `sh` con verifica del prompt richiede un TTY reale e resta esplicitamente un gate fisico manuale. La suite lo riporta come `SKIP`, non come `PASS`.

## Status `1..10`

`tests/status-map` forza ogni ramo senza patchare il codice prodotto:

| Status | Contratto | Forcing |
|---:|---|---|
| 1 | PATH resolution | source dell'entrypoint con `$0` privo di slash e `PATH` vuoto |
| 2 | runtime realpath | source con `$0` pathname inesistente |
| 3 | invalid bootstrap bin | source con `$0` che canonicalizza a directory |
| 4 | root `cd` | fault injection del builtin `cd` nel processo isolato |
| 5 | i18n load | rimozione di `lib/i18n.lib` nella copia temporanea |
| 6 | log load | rimozione di `lib/log.lib` nella copia temporanea |
| 7 | shell load | rimozione di `lib/shell.lib` nella copia temporanea |
| 8 | command resolution | source pathname con componente intermedio inesistente |
| 9 | invalid command entry | runtime stesso usato come source command |
| 10 | shell launch | selezione `sh` + fault injection mirata di `command -p -v sh`; `realpath`, `awk` e `date` continuano a usare i tool host reali |

Gli status `4` e `10` rappresentano failure che su un host POSIX sano sono difficili o impossibili da produrre stabilmente tramite sole mutazioni del filesystem. La fault injection è confinata al processo di test e lascia invariati i file del prodotto.

## Vincoli

- nessuna scrittura nel checkout prodotto;
- nessuna dipendenza da pathname host hardcoded;
- directory temporanee sotto `${TMPDIR:-/tmp}`;
- cleanup via `trap`;
- runner e fixture shell compatibili POSIX;
- nessuna pretesa di sostituire la validazione fisica sui reference host.

## Stato

**Harness costruito; in attesa di prima esecuzione contro il commit prodotto reale sui reference host macOS e Ubuntu 26.04/aarch64.**

Durante la costruzione, il forcing `1..10` è stato dry-run su un subject locale minimale che replica i rami del contratto. Il primo dry-run ha mostrato che GNU `realpath --` può accettare un final component inesistente; lo status `8` è stato quindi reso deterministico usando un componente intermedio inesistente. Dopo la correzione il dry-run del mapping ha prodotto `10/10 PASS`. Questo non costituisce evidenza di prodotto.
