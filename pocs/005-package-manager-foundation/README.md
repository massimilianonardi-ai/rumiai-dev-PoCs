# PoC 005 — Package manager foundation

## Obiettivo

Verificare il nucleo concettuale recuperato dalla genealogia `var/#_os` → `cmd/pkg`, prima di progettare provider, version resolver o dependency solver.

Il PoC dimostra che un package manager RumiAI può operare rispetto a una **root arbitraria** e mantenere distinti:

```text
package definition
artifact
resolution plan
materialization
integration
installation receipt
mutable target root
```

Design input:

```text
rumiai-dev/analysis/m-audit/2026-08-29-package-manager-lineage-design-input.md
```

## Scenario

```text
target root con stato preesistente
        ↓
resolve package definition dichiarativa
        ↓
nessun side effect sulla root
        ↓
install immutable plan
        ↓
materialize artifact in pkg/
        ↓
integrate command in bin/
        ↓
write receipt
        ↓
execute integrated command
        ↓
remove package definition + plan
        ↓
uninstall usando solo receipt
        ↓
root identica allo stato iniziale
```

## Deliberatamente fuori scope

- network;
- provider GitHub/Codeberg/Maven;
- `latest`;
- dependency graph;
- version constraint solver;
- cache;
- digest/signature verification;
- transactional rollback su failure intermedio;
- servizi;
- `sudo`;
- integrazione globale dell'host;
- container/image/device.

Questi elementi verranno introdotti solo dopo aver dimostrato il contratto che li precede.

## Definition format sperimentale

Il package definition usa file a una sola riga invece di shell sourced:

```text
fixtures/definitions/hello/
├── name
├── version
├── artifact
├── command-name
└── command-path
```

Il formato è intenzionalmente minimale e **non è una proposta definitiva del manifest RumiAI**. Serve esclusivamente a provare che metadata/configuration possono restare dati e non codice.

## Artifact

L'artifact è separato dalla definition:

```text
fixtures/artifacts/hello-1.0/bin/hello
```

Questa separazione riprende il principio storico package-skeleton/vendor-artifact senza copiarne l'implementazione.

## Plan

`pkg-poc resolve` produce una directory plan contenente soltanto dati risolti. La resolution non riceve la target root e non può quindi modificarla.

## Receipt

Dopo l'installazione il target contiene una receipt sperimentale sotto:

```text
.pkg-state/receipts/<name>/<version>/
```

Il pathname è provvisorio e non definisce il layout futuro di `rumiai-os`.

La receipt contiene i path relativi realmente materializzati/integrati. `uninstall` legge esclusivamente questa receipt.

Il test elimina definition e plan prima dell'uninstall per dimostrare che la rimozione non dipende dal manifest corrente.

## Esecuzione

Da un checkout di `rumiai-dev-PoCs`:

```sh
sh pocs/005-package-manager-foundation/tests/run
```

Il test crea e distrugge autonomamente una root temporanea sotto `${TMPDIR:-/tmp}` e non modifica `rumiai-os` né il sistema host.

Output atteso:

```text
resolve-side-effects=NONE
materialize=PASS
integrate=PASS
receipt=PASS
uninstall-without-definition=PASS
root-restored=PASS
package-manager-foundation=PASS
```

## Stato

Harness costruito e dry-run isolato PASS durante l'authoring. Non è ancora una specifica di prodotto né un test permanente.
