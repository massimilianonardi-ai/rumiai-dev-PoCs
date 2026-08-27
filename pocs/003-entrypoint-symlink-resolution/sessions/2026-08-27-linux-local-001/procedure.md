# Procedura — sessione 2026-08-27-linux-local-001

## Scopo

Verificare che il resolver candidato determini sempre la directory fisica reale contenente l'entrypoint finale, indipendentemente dal modo di invocazione e da symlink nel pathname.

## Subject

```text
pocs/003-entrypoint-symlink-resolution/subject/rumiai-os
```

Il subject:

1. distingue `$0` con `/` da invocazione tramite `PATH`;
2. usa `command -v --` per la ricerca tramite `PATH`;
3. rende assoluto un pathname relativo tramite `pwd -P`;
4. canonicalizza il pathname con `realpath`;
5. verifica che il target finale sia un regular file;
6. deriva `RUMIAI_ROOT` tramite parameter expansion;
7. usa un protocollo con sentinel per non perdere newline finali appartenenti al pathname durante command substitution.

## Test

Eseguire:

```text
dash tests/run
bash --posix tests/run
busybox sh tests/run
```

Per ogni shell vengono verificati gli stessi dieci casi:

1. pathname relativo;
2. pathname assoluto;
3. invocazione tramite `PATH`;
4. symlink con target relativo;
5. symlink con target assoluto;
6. catena di symlink;
7. symlink in un componente intermedio;
8. pathname contenente spazi e ` -> `;
9. componente che inizia con `-`, protetto tramite pathname `./...`;
10. root il cui nome termina con newline.

## Criterio di successo

Ogni invocazione deve produrre esattamente la stessa root fisica prevista. Tutte le shell devono terminare con:

```text
SUMMARY pass=10 fail=0
```

## Limitazione della sessione

La sessione prova il comportamento su tre implementazioni shell nello stesso host Linux. La convalida runtime su macOS deve essere una sessione separata e non è sostituita dalla sola documentazione della utility `realpath`.
