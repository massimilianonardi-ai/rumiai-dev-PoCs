# Risultato — sessione 2026-08-27-local-001

## Esito

La sessione conferma sperimentalmente tre problemi distinti nelle primitive storiche analizzate.

### 1. Dipendenza non POSIX da `$RANDOM`

`rand()` e `randint()` dichiarano comportamento POSIX ma inizializzano `awk` tramite `$RANDOM`.

Su `dash`, dove `$RANDOM` non è disponibile, due invocazioni indipendenti di `rand()` hanno restituito lo stesso valore (`0.840188`), riproducendo il comportamento deterministico indesiderato.

Bash in modalità POSIX e BusyBox `sh` espongono comunque una propria estensione `$RANDOM`, quindi in quelle due shell il difetto non si manifesta nella stessa forma. Questo non rimuove il problema di portabilità: l'esistenza di almeno una shell POSIX-compatible senza quella estensione dimostra che la primitiva non può assumere `$RANDOM` come parte del contratto.

### 2. Interpretazione del dato come format string

`a2o()` contiene:

```sh
printf "$1"
```

Il test passa la stringa letterale `%s`. Il risultato storico è vuoto, mentre l'encoding atteso del testo `%s` è:

```text
045 163
```

Il problema è stato riprodotto su tutte e tre le shell della matrice.

### 3. Seconda valutazione del valore tramite `eval`

L'operazione `array add` costruisce un'assegnazione tramite `eval` incorporando direttamente il valore ricevuto.

Il test inserisce come dato una stringa contenente una command substitution che crea un file marker. Il marker viene effettivamente creato: il valore non rimane semplice dato, ma viene interpretato nuovamente come sintassi shell.

Il problema è stato riprodotto su `dash`, Bash POSIX mode e BusyBox `sh`.

## Conclusione

Le tre primitive non devono essere migrate direttamente in `rumiai-os`.

L'audit fornisce però requisiti utili per la futura reimplementazione:

- una primitiva dichiarata POSIX non deve dipendere da variabili o feature opzionali specifiche di una shell;
- input arbitrario passato a `printf` deve essere dato tramite un formato costante, ad esempio `printf '%s' "$value"`;
- dati applicativi non devono essere interpolati in stringhe successivamente passate a `eval`;
- la compatibilità deve essere verificata su più shell, perché una estensione presente in Bash può mascherare una violazione del contratto POSIX.

## Stato

**PoC riuscito:** i finding dell'audit sono stati trasformati in test riproducibili e in evidenza archiviata.

Il passo successivo non è correggere queste fixture storiche, ma progettare e testare primitive sostitutive conformi alle regole correnti di `rumiai-os`.
