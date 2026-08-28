# Construction check — 2026-08-28

Questa non è una sessione di validazione del prodotto.

Durante la costruzione del PoC sono stati eseguiti:

- syntax check del runner, dei test, della libreria helper e delle fixture con `dash -n` e `bash --posix -n` nel runtime di sviluppo disponibile;
- dry-run di `tests/status-map` contro un subject locale minimale costruito per replicare i rami `1..10`.

Il primo dry-run ha evidenziato che GNU `realpath --` può canonicalizzare un pathname con solo il final component inesistente, producendo il ramo `9` anziché `8`. Il forcing dello status `8` è stato corretto usando un componente intermedio inesistente.

Risultato del secondo dry-run del mapping:

```text
PASS status-1-path-resolution
PASS status-2-realpath
PASS status-3-bootstrap-bin
PASS status-4-root
PASS status-5-i18n-load
PASS status-6-log-load
PASS status-7-shell-load
PASS status-8-command-resolution
PASS status-9-invalid-entry
PASS status-10-shell-launch
SUMMARY pass=10 fail=0 skip=0
```

Limite: il runtime di sviluppo della sessione non dispone di accesso di rete shell verso GitHub, quindi il checkout reale `rumiai-os` non è stato materializzato ed eseguito qui. Nessun PASS di questa nota deve essere interpretato come nuova evidenza fisica sul prodotto.
