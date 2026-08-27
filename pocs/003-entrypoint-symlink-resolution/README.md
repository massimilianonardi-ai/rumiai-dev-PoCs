# PoC 003 — Entrypoint and symlink resolution

## Obiettivo

Validare una strategia robusta e minimale per determinare il path fisico reale dell'entrypoint `rumiai-os` e quindi la root del sistema, senza scrivere nulla nel repository prodotto `rumiai-os`.

Il PoC confronta concettualmente il resolver storico presente in `massimilianonardi/m` con una strategia basata sulle primitive disponibili nel profilo POSIX moderno adottato dal progetto.

## Strategia candidata

1. Se `$0` contiene `/`, trattarlo come pathname di invocazione.
2. Se `$0` non contiene `/`, risolverlo attraverso `command -v --` perché l'invocazione è avvenuta tramite `PATH`.
3. Se il pathname ottenuto è relativo, trasformarlo in pathname assoluto usando la physical current working directory (`pwd -P`).
4. Canonicalizzare il pathname assoluto con `realpath`.
5. Verificare che il risultato sia un regular file.
6. Derivare `RUMIAI_ROOT` dal pathname fisico finale senza usare `dirname` o parsing di `ls`.

`realpath` è preferito a un parser artigianale di `ls -ld` perché gestisce nativamente symlink relativi, catene, componenti intermedi, `.` e `..` e rilevazione degli errori di risoluzione.

## Standard e host di riferimento

POSIX.1-2024 / Issue 8 ha introdotto la utility standard `realpath`.

Gli host di riferimento correnti verificati documentalmente sono:

- Ubuntu 26.04 LTS, che fornisce `realpath` nel core system;
- macOS Tahoe 26, il cui sistema fornisce `realpath` con canonicalizzazione fisica dei symlink.

Il PoC locale non costituisce ancora esecuzione runtime su macOS: la sessione archiviata è una validazione Linux cross-shell. Un run su macOS resta necessario prima di considerare il comportamento runtime certificato su entrambi gli host.

## Pathname e command substitution

Le utility line-oriented aggiungono un newline di terminazione. La normale command substitution POSIX rimuove tutti i newline finali, quindi può perdere newline che appartengono realmente a un pathname.

Il PoC usa un sentinel non-newline durante la cattura, poi rimuove:

1. il sentinel aggiunto dal protocollo;
2. esattamente un newline, quello prodotto dalla utility come delimitatore di linea.

In questo modo eventuali newline finali appartenenti al pathname restano intatti.

## Casi testati

- invocazione relativa;
- invocazione assoluta;
- invocazione tramite `PATH`;
- symlink con target relativo;
- symlink con target assoluto;
- catena di symlink;
- symlink in un componente intermedio;
- pathname con spazi e testo ` -> `;
- componente pathname che inizia con `-` (invocato tramite `./`);
- root il cui ultimo componente termina con newline.

## Shell della sessione locale

- `dash`;
- `bash --posix`;
- `busybox sh`.

## Stato

**PoC Linux locale riuscito.**

Non è autorizzata alcuna promozione del codice nel repository `rumiai-os` senza consenso esplicito dell'utente.
