# PoC 002 — POSIX bootstrap foundation

## Obiettivo

Validare una foundation minima sostitutiva per il bootstrap di `rumiai-os` senza migrare direttamente le primitive storiche di `massimilianonardi/m`.

Il PoC verifica tre aspetti:

1. output di dati arbitrari tramite `printf` con formato costante;
2. scoperta relocatable della root dell'entrypoint `rumiai-os`;
3. controlli statici minimi contro alcune violazioni POSIX/portabilità già emerse dall'audit.

## Specifica di riferimento

`rumiai-dev/specifications/rumiai-os/POSIX-PORTABILITY-LAYER.md`

Requirement principali verificati:

- `POSIX-PLAT-002`
- `POSIX-PLAT-003`
- `POSIX-DATA-001`
- `POSIX-DATA-002`
- `POSIX-DATA-003`
- `POSIX-PATH-001`
- `POSIX-PATH-002`
- `POSIX-PATH-003`
- `POSIX-PATH-009`
- `POSIX-TEST-001`
- `POSIX-TEST-003`
- `POSIX-TEST-004`

## Ambito deliberatamente escluso

Questo PoC non implementa array, map, serializzazione generale argv, package management o deployment.

Queste primitive verranno introdotte solo quando un requisito reale di `rumiai-os` ne dimostrerà la necessità.

## Contratto root discovery del PoC

Sono supportate:

- invocazione relativa (`./rumiai-os`);
- invocazione assoluta;
- invocazione da una current working directory differente;
- invocazione tramite `PATH`.

L'invocazione dell'entrypoint tramite symbolic link è deliberatamente **non supportata** in questa fase e deve fallire esplicitamente. Questo evita di introdurre una falsa portabilità basata su parsing fragile di `ls -l` o su estensioni GNU.

## Esecuzione

```sh
sh tests/run-matrix.sh
```

La matrice usa automaticamente, se disponibili:

- `dash`;
- Bash in modalità POSIX;
- BusyBox `sh`.

## Risultato corrente

La sessione `sessions/2026-08-27-local-001/` ha completato tutti i test con esito positivo sulle tre shell disponibili nell'ambiente di audit.
