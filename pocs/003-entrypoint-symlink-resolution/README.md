# PoC 003 — Entrypoint and symlink resolution

## Obiettivo

Validare una strategia robusta e minimale per determinare:

- il pathname fisico/canonicalizzato dell'entrypoint `rumiai-os`;
- `RUMIAI_ROOT` come directory fisica/canonicalizzata dell'entrypoint reale;
- la corretta risoluzione dell'invocazione diretta, tramite `PATH` e tramite symbolic link;
- il fallimento per loop e link dangling;
- l'invariante che `cd -- "$RUMIAI_ROOT"` riesca.

Il PoC non scrive nulla nel repository prodotto `rumiai-os`.

## Baseline

**POSIX.1-2024 / The Open Group Base Specifications Issue 8**.

Issue 8 standardizza `realpath`, quindi il PoC preferisce delegare al sistema la pathname resolution fisica invece di costruire un resolver di symlink in shell.

## Strategia consolidata

1. Se `$0` contiene `/`, trattarlo come pathname di invocazione.
2. Se `$0` non contiene `/`, risolverlo attraverso:

   ```sh
   command -v -- "$0"
   ```

3. Canonicalizzare direttamente il pathname ottenuto con:

   ```sh
   realpath -- "$RUMIAI_ENTRY"
   ```

4. Verificare che il risultato sia un regular file esistente:

   ```sh
   [ -f "$RUMIAI_ENTRY" ]
   ```

5. Derivare la root senza `dirname`:

   ```sh
   RUMIAI_ROOT=${RUMIAI_ENTRY%/*}
   [ -n "$RUMIAI_ROOT" ] || RUMIAI_ROOT=/
   ```

6. Verificare realmente:

   ```sh
   (cd -- "$RUMIAI_ROOT")
   ```

7. Esportare `RUMIAI_ENTRY` e `RUMIAI_ROOT` solo dopo il successo dei controlli.

## Perché non c'è un passaggio preliminare `pwd -P`

`realpath` accetta pathname relativi e restituisce il pathname fisico assoluto canonicalizzato. Rendere prima assoluto `$0` tramite `pwd -P` duplicava lavoro e aumentava il numero di stati intermedi senza aggiungere garanzie.

## Perché non viene usato `dirname`

Dopo `realpath`, `RUMIAI_ENTRY` è già un pathname assoluto canonicalizzato di un regular file.

Nel dominio ristretto del bootstrap:

```sh
${RUMIAI_ENTRY%/*}
```

è sufficiente e preferibile perché non richiede un processo esterno o una nuova cattura di output.

Analogamente, se servisse il basename dello stesso pathname canonicalizzato, il pattern preferito sarebbe:

```sh
${RUMIAI_ENTRY##*/}
```

Questa scelta non vieta `dirname`/`basename` per problemi che richiedono la loro semantica generale.

## Perché non viene usato `realpath -e`

POSIX Issue 8 definisce `-e`, ma il macOS corrente documenta una `realpath` CLI che non espone ancora `-e`/`-E`.

RumiAI non ha bisogno di dipendere da questa opzione per il bootstrap:

- l'entrypoint invocato deve esistere;
- la canonicalizzazione fisica normale è sufficiente quando pathname resolution riesce;
- `[ -f "$RUMIAI_ENTRY" ]` rende esplicito il requisito di esistenza del target finale;
- un dangling link viene quindi rifiutato;
- un symbolic-link loop fallisce durante pathname resolution.

La scelta evita una dipendenza non necessaria da una parte della nuova CLI Issue 8 che non è ancora uniformemente esposta dagli host di riferimento.

## Codice storico confrontato

Il PoC è stato confrontato con il codice storico di `massimilianonardi/m`, in particolare:

```text
cmd/lib/realpaths.lib.sh
var/#_os/m/bin/m.lib
var/#_os/m/bin/m-filesystem.lib
```

Le parameter expansion storiche restano una buona idea. Il parsing di `ls -ld` per ottenere il target del symlink non viene invece mantenuto, perché Issue 8 fornisce ora `realpath` come facility standard più semplice e robusta.

## Pathname e command substitution

La normale command substitution POSIX rimuove i newline finali. Per non perdere automaticamente newline che appartengono al pathname, il PoC cattura l'output con un sentinel non-newline e rimuove poi:

1. il sentinel;
2. esattamente il newline di terminazione della utility.

Il meccanismo rimane locale al PoC/bootstrap e non viene trasformato prematuramente in una generic serialization library.

## Casi testati

- invocazione relativa;
- invocazione assoluta;
- `cd -- "$RUMIAI_ROOT"`;
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

## Sessione di consolidamento

```text
sessions/2026-08-27-linux-local-002/
```

Ambiente locale:

```text
Debian GNU/Linux 13 (trixie)
GNU coreutils realpath 9.7
dash 0.5.12-12
bash 5.2.37 --posix
BusyBox 1.37.0 sh
```

Risultato:

```text
dash          14 pass / 0 fail
bash --posix  14 pass / 0 fail
busybox sh    14 pass / 0 fail
TOTAL         42 pass / 0 fail
```

## Host di riferimento

La baseline normativa resta Issue 8.

La documentazione dei reference host indica la presenza di `realpath`, ma questa sessione non costituisce una certificazione runtime sul macOS o sull'Ubuntu LTS di riferimento.

Il run su tali host resta una validazione separata. Se emerge una divergenza reale rispetto al contratto necessario a RumiAI, verrà applicata la regola canonica di valutazione compatibilità/fallback/astrazione/baseline.

## Stato

**Algoritmo consolidato a livello di design e PoC Linux cross-shell.**

Non è autorizzata alcuna promozione del codice nel repository `rumiai-os` senza consenso esplicito dell'utente.
