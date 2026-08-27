# PoC 001 — POSIX foundations

## Obiettivo

Trasformare alcuni finding dell'audit del repository storico `massimilianonardi/m` in evidenza eseguibile e riproducibile prima di progettare le primitive equivalenti di `rumiai-os`.

Questo PoC non propone ancora la nuova implementazione. Verifica il comportamento di primitive storiche rispetto al contratto POSIX e alla regola secondo cui dati e sintassi shell non devono essere confusi.

## Provenienza delle fixture

Le fixture in `fixtures/` sono copie del materiale storico analizzato allo snapshot:

`massimilianonardi/m@e4faae1c1d9b27cc5503b987ba5e7bf2874c906c`

File sorgente:

- `cmd/lib/arg.lib.sh`
- `cmd/lib/array.lib.sh`
- `cmd/lib/enc.lib.sh`

Le fixture non sono codice candidato automaticamente al riuso in `rumiai-os`.

## Ipotesi verificate

1. `rand()` dipende dalla variabile shell `$RANDOM`, che non fa parte del contratto POSIX; in una shell che non la fornisce il comportamento storico può diventare deterministico.
2. `a2o()` usa il dato come format string di `printf`, quindi una stringa come `%s` non viene trattata letteralmente.
3. `array add` incorpora il valore dentro `eval`; sintassi shell contenuta nel valore può essere valutata nuovamente ed eseguita.

## Esecuzione

Test singola shell:

```sh
dash tests/test-historical-primitives.sh
bash --posix tests/test-historical-primitives.sh
busybox sh tests/test-historical-primitives.sh
```

Oppure, sulle shell disponibili localmente:

```sh
sh tests/run-local-matrix.sh
```

Il test restituisce exit code diverso da zero se almeno un problema viene riprodotto. In questo PoC un `FAIL` indica quindi che il difetto storico è stato osservato; non indica un errore dell'harness.

## Sessioni

La prima sessione riprodotta durante l'audit è archiviata in `sessions/2026-08-27-local-001/`.
