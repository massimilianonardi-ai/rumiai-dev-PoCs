# PoC 008 — `var/` system-scope routing

## Obiettivo

Verificare una conseguenza del futuro state model senza modificarlo nel prodotto:

```text
var/
= compatibility routing per pathname mutabili che l'upstream mantiene nel proprio installation tree
= routing statico package-local
= solo state system-scoped
```

Lo user state non viene instradato tramite `var/`.

Quando il software supporta nativamente una destinazione esterna tramite environment, argomenti o altra interfaccia propria, tale state può invece essere risolto per POSIX principal senza modificare la package installation condivisa.

La PoC è sperimentale e non normativa. Non modifica `rumiai-os`, `rumiai-tests` o `pkg-catalog`.

## Design input

Il modello corrente già distingue:

```text
environment/native routing
    per state che l'upstream permette di collocare esternamente

var/
    per state che l'upstream raggiunge tramite pathname nel proprio installation tree
```

Il catalogo DBeaver corrente costituisce un esempio concreto del primo caso: il command materializzato passa destinazioni esplicite tramite `-configuration` e `-data` e non richiede una `var/` package-local.

Il futuro redesign aggiunge una dimensione `system` / `user`. La domanda della PoC è se `var/` possa restare statico senza diventare un router per-user.

## Ipotesi verificata

La forma sperimentale è:

```text
shared package installation
    root/<path>
        -> var/<area>/<path>
            -> state/system/current/pkg/<package>/<area>/<path>

user-native state
    -> state/user/<principal>/pkg/<package>/<area>/...
```

Quindi:

```text
var-backed state     = condiviso nel system profile attivo
user-native state    = separato per POSIX principal
```

Le due forme possono coesistere nello stesso package quando rappresentano porzioni distinte dello state.

## Proprietà esercitate

Il test dimostra che:

```text
1. una sola package installation può mantenere routing var statico;
2. var può attraversare il selector del system profile senza conoscere il POSIX user;
3. due user state distinti restano indipendenti dalla package installation;
4. var non deve puntare dentro state/user;
5. un cambio quiescente di system profile cambia il backing state visto tramite var;
6. lo user state non cambia quando cambia il system profile;
7. un package completamente native-routed non richiede una var sintetica.
```

## Limite intenzionale

La PoC **non** valida un meccanismo portabile e atomico per sostituire il selector `state/system/current` quando esso è un symbolic link a directory.

Durante l'authoring è emerso che una semplice sostituzione tramite `mv` può essere interpretata come move dentro la directory referenziata dal symlink, invece che come replacement della directory entry.

Per il test il cambio profile viene quindi effettuato soltanto in stato quiescente tramite:

```text
create new selector
remove old selector
move new selector in place
```

Questo è sufficiente a verificare il rapporto fra `var/` e system profile, ma **non** chiude il contratto di atomicità/recovery del selector. Tale problema resta separato dal routing multi-user di `var/`.

## Conseguenza progettuale

Se questa direzione verrà adottata normativamente nel futuro modello:

```text
var non richiede alcun routing dinamico per-user
```

Un package che possiede state user-private non redirigibile nativamente non può ottenere isolamento multi-user tramite `var/` condiviso. In quel caso il relativo state resta system-scoped, oppure il package non è idoneo a un uso multi-user isolato con una singola installazione condivisa.

Questo è un limite del software upstream da normalizzare esplicitamente, non un motivo per rendere `var/` dinamico.

## Esecuzione

Da un checkout di `rumiai-dev-PoCs`:

```sh
sh pocs/008-var-system-scope-routing/tests/run
```

Output atteso:

```text
var-system-routing=PASS
native-user-routing=PASS
var-never-user=PASS
profile-switch=PASS
native-no-var=PASS
var-system-scope-model=PASS
```

## Stato

Dry-run isolato PASS durante l'authoring del 2026-09-13.

La PoC supporta il modello `var = system-scope compatibility routing`; non costituisce specifica di prodotto né test permanente.
