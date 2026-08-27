# Provenienza delle fixture

Le fixture di questa directory sono copie letterali dei file del repository storico:

```text
massimilianonardi/m@e4faae1c1d9b27cc5503b987ba5e7bf2874c906c
```

| Fixture | Sorgente | Git blob SHA |
|---|---|---|
| `arg.lib.sh` | `cmd/lib/arg.lib.sh` | `4454c5641dead5628810dbfa5dfbc0e04463f31b` |
| `array.lib.sh` | `cmd/lib/array.lib.sh` | `ce344d6ecf28f2c5e32234426e3456574016b21d` |
| `enc.lib.sh` | `cmd/lib/enc.lib.sh` | `1105c2d9a825968943a5a82e7cce7625c9b82b85` |

Gli SHA dei blob nel repository PoC coincidono con quelli dei file sorgente allo snapshot indicato. Questo consente di verificare che le fixture non siano state corrette, adattate o riscritte prima dell'esecuzione dei test.

Questi file sono materiale storico sotto test e non costituiscono codice candidato automaticamente all'integrazione in `rumiai-os`.
