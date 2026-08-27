# Risultato — sessione 2026-08-27-linux-local-001

## Esito

La strategia candidata ha superato tutti i 10 casi su tutte le shell della matrice locale:

```text
dash         10/10
bash --posix 10/10
busybox sh   10/10
```

## Conclusioni tecniche

### 1. `realpath` elimina la necessità di parsing di `ls -ld`

Una volta ottenuto un pathname corretto dell'entrypoint, `realpath` risolve in un'unica operazione:

- target symlink relativi;
- target symlink assoluti;
- catene di symlink;
- symlink in componenti intermedi;
- `.` e `..`;
- canonicalizzazione fisica.

Il bootstrap non deve quindi reimplementare manualmente la traversal dei link.

### 2. `$0` deve essere risolto prima della canonicalizzazione

Quando `$0` non contiene `/`, l'entrypoint può essere stato trovato tramite `PATH`. In quel caso il pathname deve essere ottenuto tramite command lookup prima di chiamare `realpath`.

La strategia testata usa:

```text
command -v -- "$0"
```

Quando il risultato è relativo, viene trasformato in pathname assoluto usando la physical current working directory.

### 3. Il frammento storico di `m` resta un riferimento concettuale, non la soluzione finale

Il pattern storico basato su:

```text
ls -ld ...
```

e parsing di ` -> ` identifica correttamente la necessità di seguire il symlink, ma non offre da solo la stessa semantica di `realpath` per target relativi, catene e componenti intermedi.

### 4. Command substitution richiede attenzione per pathname con newline finale

La command substitution POSIX elimina i newline finali dall'output. Una cattura ingenua di `pwd`, `command -v` o `realpath` può quindi alterare un pathname valido che termini realmente con newline.

Il protocollo testato aggiunge un sentinel non-newline, cattura l'output, rimuove il sentinel e poi rimuove esattamente un newline di protocollo. Il caso `trailing-newline-path` è passato sulle tre shell.

### 5. `--` viene usato dove il contratto lo supporta ed elimina ambiguità

`command -v -- "$0"` applica la regola di separazione fra opzioni e nome del comando. Per `realpath` il PoC passa un pathname già assoluto, quindi non può iniziare con `-`; non introduce un `--` non ancora verificato runtime su macOS.

## Limiti ancora aperti

- La sessione non è stata eseguita su macOS.
- La sessione locale usa GNU `realpath` 9.7 e non il `realpath` specifico di Ubuntu 26.04 LTS.
- Rimane un limite intrinseco path-based/TOCTOU: dopo che l'interprete ha aperto lo script, un attore capace di modificare contemporaneamente il pathname o i link potrebbe alterare ciò che una successiva canonicalizzazione osserva. La POSIX shell non offre un modo portabile per recuperare il file descriptor del proprio sorgente. Il bootstrap deve quindi assumere che l'albero di installazione non venga mutato da un attore non trusted durante l'avvio.

## Stato

**PoC Linux locale riuscito.**

La strategia è candidata alla specifica di bootstrap, ma la certificazione cross-host richiede ancora una sessione macOS.

Nessun file viene promosso in `rumiai-os` senza consenso esplicito dell'utente.
