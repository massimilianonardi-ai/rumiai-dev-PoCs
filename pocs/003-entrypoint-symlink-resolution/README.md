# PoC 003 — Entrypoint and symlink resolution

## Obiettivo

Validare una strategia robusta e minimale per determinare:

- `RumiAI_BOOTSTRAP_BIN`, pathname fisico/canonicalizzato del bootstrap executable `rumiai-os`;
- `RumiAI_ROOT`, directory fisica/canonicalizzata che contiene il bootstrap reale;
- la corretta risoluzione dell'invocazione diretta, tramite `PATH` e tramite symbolic link;
- il fallimento per loop e link dangling;
- l'invariante che `cd -- "$RumiAI_ROOT"` riesca.

I nomi canonici esportati sono esattamente:

```text
RumiAI_BOOTSTRAP_BIN
RumiAI_ROOT
```

Il PoC non scrive nulla nel repository prodotto `rumiai-os`.

## Baseline

**POSIX.1-2024 / The Open Group Base Specifications Issue 8**.

Issue 8 standardizza `realpath`, quindi il PoC delega al sistema la pathname resolution fisica invece di costruire un resolver di symlink in shell.

## Strategia consolidata

1. Se `$0` contiene `/`, trattarlo come pathname di invocazione.
2. Se `$0` non contiene `/`, risolverlo attraverso `command -v -- "$0"`.
3. Canonicalizzare direttamente con `realpath -- "$RumiAI_BOOTSTRAP_BIN"`.
4. Verificare `[ -f "$RumiAI_BOOTSTRAP_BIN" ]`.
5. Derivare la root con:

   ```sh
   RumiAI_ROOT=${RumiAI_BOOTSTRAP_BIN%/*}
   [ -n "$RumiAI_ROOT" ] || RumiAI_ROOT=/
   ```

6. Verificare `(cd -- "$RumiAI_ROOT")`.
7. Esportare `RumiAI_BOOTSTRAP_BIN` e `RumiAI_ROOT` solo dopo il successo dei controlli.

Le condizioni di errore del top-level bootstrap usano uno status di uscita non-zero, normalmente `exit 1`. Non esiste alcun comando POSIX `fail` richiesto da questo PoC.

## `dirname` / `basename`

Dopo `realpath`, `RumiAI_BOOTSTRAP_BIN` è già un pathname assoluto canonicalizzato di un regular file.

Nel dominio ristretto del bootstrap:

```sh
${RumiAI_BOOTSTRAP_BIN%/*}
```

è preferito a `dirname` perché non richiede un processo esterno o una nuova cattura di output.

Se servisse il basename nello stesso dominio:

```sh
${RumiAI_BOOTSTRAP_BIN##*/}
```

Questa scelta non vieta `dirname`/`basename` per altri problemi.

## `realpath -e`

Il bootstrap non dipende da `realpath -e`. L'entrypoint deve esistere e il target finale viene verificato esplicitamente dopo la canonicalizzazione.

## Codice storico confrontato

Riferimenti principali:

```text
cmd/lib/realpaths.lib.sh
var/#_os/m/bin/m.lib
var/#_os/m/bin/m-filesystem.lib
```

Si mantengono le buone idee sulle parameter expansion e sulla distinzione path logico/fisico; non si mantiene il parsing di `ls -ld` per i symlink.

## Pathname e command substitution

La normale command substitution POSIX rimuove i newline finali. Il PoC usa un piccolo sentinel protocol per non perdere automaticamente newline che appartengono al pathname.

## Casi testati

- invocazione relativa;
- invocazione assoluta;
- `cd -- "$RumiAI_ROOT"`;
- invocazione tramite `PATH`;
- symlink con target relativo;
- symlink con target assoluto;
- catena di symlink;
- symlink in un componente intermedio;
- pathname con spazi e testo ` -> `;
- componente pathname che inizia con `-`;
- symbolic-link loop, con fallimento atteso;
- dangling symlink, con fallimento atteso;
- root il cui ultimo componente termina con newline;
- `cd` sulla root con newline finale.

## Evidenza storica

La sessione:

```text
sessions/2026-08-27-linux-local-002/
```

ha prodotto 42 pass / 0 fail complessivi su `dash`, `bash --posix` e BusyBox `sh`, ma precede la decisione finale sui nomi delle variabili. I file di sessione non vengono riscritti retroattivamente.

Il subject e il test harness correnti sono stati aggiornati ai nomi `RumiAI_BOOTSTRAP_BIN` e `RumiAI_ROOT`; una nuova esecuzione verrà archiviata quando verranno affrontati i test fisici/reference-host.

## Stato

**Algoritmo consolidato; naming canonico aggiornato; reference-host physical tests ancora da eseguire.**

Non è autorizzata alcuna promozione del codice nel repository `rumiai-os` senza consenso esplicito dell'utente.
