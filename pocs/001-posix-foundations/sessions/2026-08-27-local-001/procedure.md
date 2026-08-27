# Procedura — sessione 2026-08-27-local-001

## Scopo

Riprodurre su più shell il comportamento delle primitive storiche archiviate in `../../fixtures/` senza modificarle.

## Precondizioni

Dalla root del PoC:

```sh
cd pocs/001-posix-foundations
```

Le shell usate nella sessione devono essere disponibili localmente. La sessione originale ha verificato `dash`, Bash in modalità POSIX e BusyBox `sh`.

## Esecuzione

Il test singolo viene eseguito esplicitamente con ciascuna shell:

```sh
dash tests/test-historical-primitives.sh
bash --posix tests/test-historical-primitives.sh
busybox sh tests/test-historical-primitives.sh
```

In alternativa il runner:

```sh
sh tests/run-local-matrix.sh
```

esegue automaticamente le shell della matrice che risultano disponibili.

## Interpretazione dell'exit code

`tests/test-historical-primitives.sh` usa deliberatamente:

- `PASS` quando il difetto specifico non viene riprodotto in quella shell;
- `FAIL` quando il comportamento storico problematico viene osservato.

Pertanto un exit code `1` del test singolo è atteso quando almeno un difetto viene riprodotto e costituisce evidenza positiva per lo scopo di questo PoC.

`tests/run-local-matrix.sh` restituisce invece `0` dopo avere eseguito la matrice disponibile, perché il suo compito è raccogliere i risultati e non considerare i difetti storici riprodotti come errore del runner.

## Output

L'output osservato nella sessione originale è conservato letteralmente in:

```text
output.txt
```

Le conclusioni sono documentate separatamente in `result.md`.
