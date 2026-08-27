# PoC 003 — Entrypoint and symlink resolution

## Obiettivo

Validare la phase 0 che determina:

```text
RumiAI_BOOTSTRAP_BIN
RumiAI_ROOT
```

con invocazione diretta, tramite `PATH` e tramite symbolic link.

Baseline:

**POSIX.1-2024 / The Open Group Base Specifications Issue 8**.

## Strategia corrente

```text
$0 con slash      -> pathname di invocazione
$0 senza slash    -> command -v sul PATH corrente
                         ↓
              command -p realpath -e
                         ↓
               regular-file check
                         ↓
        ${RumiAI_BOOTSTRAP_BIN%/*}
                         ↓
             cd validation della root
```

Il risultato di `command -v` non deve essere già assoluto: un `PATH` può contenere directory relative e `realpath -e` esegue la canonicalizzazione finale.

## Naming e command substitution

La naming convention corrente è definita in:

```text
rumiai-dev/specifications/rumiai-os/FILESYSTEM-NAMING.md
```

Il final component reale del bootstrap è controllato e fissato a `rumiai-os`.

Il PoC corrente non usa più il precedente sentinel per i newline terminali. La normale command substitution è sufficiente perché l'output canonicalizzato termina con il nome controllato `rumiai-os`.

Directory parent o symlink esterni possono comunque avere nomi arbitrari. Un newline in una parent directory è interno al pathname completo e viene preservato; un nome di symlink esterno viene conservato in `$0` prima della canonicalizzazione.

La gestione generale di pathname esterni il cui final component può terminare con newline resta un problema separato e non viene generalizzata dal bootstrap.

## `dirname`

Dopo `realpath`, la root viene derivata con:

```sh
RumiAI_ROOT=${RumiAI_BOOTSTRAP_BIN%/*}
[ -n "$RumiAI_ROOT" ] || RumiAI_ROOT=/
```

`dirname` non è necessario in questo dominio ristretto.

## Stato del PoC

Il subject corrente è allineato alla phase 0 implementata nel prodotto, con output aggiuntivo soltanto per rendere osservabili i due valori durante il test.

La sessione storica:

```text
sessions/2026-08-27-linux-local-002/
```

precede le decisioni finali su naming, `realpath -e`, diagnostica e rimozione del sentinel e non viene riscritta retroattivamente.

La prossima sessione dovrà includere anche:

- `PATH` con componente relativo;
- parent directory esterna contenente newline;
- symlink esterno con nome arbitrario;
- successo senza output nel prodotto reale;
- mapping dei codici di errore della phase 0.

I reference-host physical tests restano da eseguire.
