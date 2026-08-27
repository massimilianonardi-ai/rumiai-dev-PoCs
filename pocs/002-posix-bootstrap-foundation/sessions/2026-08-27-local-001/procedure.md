# Procedura — sessione 2026-08-27-local-001

## Preparazione

Il PoC è stato costruito in una directory relocatable e senza dipendenze da path locali specifici.

Sono stati predisposti:

- `subject/rumiai-os`: entrypoint candidato minimale;
- `subject/lib/data.sh`: primitive di output dati;
- test di data preservation;
- test di root discovery;
- linter statico minimale;
- fixture intenzionalmente non conformi.

## Esecuzione

Dalla root del PoC:

```sh
sh tests/run-matrix.sh
```

Il runner individua le shell configurate disponibili localmente ed esegue per ciascuna:

```text
test-data.sh
test-root.sh
test-lint.sh
```

## Test data

Vengono verificati almeno:

```text
empty
%s
$(...)-looking text
spazi
quote
backslash
leading dash
newline interno
newline finale
UTF-8
```

Il confronto usa file e `cmp`, evitando di usare command substitution per validare dati che possono contenere newline finali.

## Test root

Sono verificate:

1. invocazione relativa;
2. invocazione assoluta;
3. invocazione da una CWD differente;
4. invocazione tramite `PATH`;
5. rifiuto esplicito dell'invocazione tramite symlink.

## Test statico

Il linter deve accettare `subject/` e rifiutare le fixture che contengono intenzionalmente:

- shebang Bash;
- `$RANDOM`;
- `printf` con format operand variabile;
- path host-specific;
- `readlink -f` GNU.

## Criterio di successo

La sessione riesce soltanto se tutti i test completano con exit status 0 su tutte le shell della matrice disponibili.
