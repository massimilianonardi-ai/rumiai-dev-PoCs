# Risultato — sessione 2026-08-27-local-001

## Esito

**PoC riuscito.**

La matrice ha completato con:

```text
shells=3
fail=0
```

su:

- `dash`;
- Bash in modalità POSIX;
- BusyBox `sh`.

## 1. Data handling

Le primitive candidate:

```sh
rumiai_print
rumiai_println
```

usano `printf` con formato costante e hanno preservato il corpus testato, incluso `%s`, testo simile a command substitution, whitespace, quote, backslash, newline e UTF-8.

Il test usa file e `cmp` per non perdere newline finali durante la verifica.

Questo valida il principio minimo di `POSIX-DATA-001`, `POSIX-DATA-002` e `POSIX-DATA-003` per l'ambito testato.

## 2. Root discovery

L'entrypoint candidato ha determinato la propria root correttamente per:

- `./rumiai-os`;
- path assoluto;
- esecuzione da una current working directory differente;
- lookup tramite `PATH`.

Il risultato non dipende dalla current working directory.

L'invocazione tramite symlink viene rifiutata esplicitamente, come previsto dal contratto ristretto di questo PoC. Non viene quindi simulato `readlink -f` con parsing fragile o dipendenze GNU.

## 3. Static checks

Il linter minimale:

- accetta il subject conforme;
- rifiuta fixture contenenti Bash shebang, `$RANDOM`, `printf` con format operand variabile, path host-specific e `readlink -f`.

Il linter è deliberatamente un guardrail iniziale e non sostituisce analisi semantica o test comportamentali.

## 4. Decisioni supportate dall'evidenza

Il PoC supporta le seguenti direzioni:

1. la foundation iniziale di `rumiai-os` può restare in `/bin/sh` senza Bash/GNU per le operazioni testate;
2. la root può essere scoperta in modo relocatable senza path hardcoded;
3. non è necessario implementare oggi una generica `realpath` o un resolver symlink per avviare il clone normalmente;
4. è preferibile dichiarare esplicitamente una modalità non supportata piuttosto che introdurre una compatibilità fragile;
5. i controlli statici possono trasformare alcune regole canoniche in enforcement automatico.

## 5. Limiti

La sessione non certifica ancora:

- macOS;
- Cygwin;
- ksh-family shells;
- invocazione tramite symlink;
- quoting/serializzazione argv generale;
- array/map;
- package manager;
- deployment target.

Questi punti richiedono PoC separati quando diventano necessari.

## Conclusione

La foundation testata è un candidato valido per informare il primo bootstrap stabile di `rumiai-os`, ma il codice non viene ancora promosso automaticamente nel repository prodotto. Il passo successivo è consolidare in `rumiai-dev` le decisioni specifiche confermate dal PoC e definire l'architettura minima iniziale di `rumiai-os`.
