# PoC 007 — macOS DBeaver install performance

## Obiettivo

Localizzare il costo osservato nel gate live DBeaver sul reference macOS ARM64 senza modificare `rumiai-os`, il contratto package o i test permanenti.

Evidence che motiva il PoC:

```text
Linux/aarch64 live DBeaver:  17 s
Darwin/arm64 live DBeaver:   242 s
```

Entrambe le sessioni hanno prodotto `PASS` sulla stessa revisione prodotto:

```text
rumiai-os@a2531626b68e81c9df4e76a007e7f963b3f26343
rumiai-tests@80ea0e67d75d0b9e75a9f96575628c2b507edb02
pkg-catalog@514cb620075188ec9ad9090f6bd008fcec85913f
```

Il risultato funzionale è quindi già positivo; questo PoC riguarda esclusivamente la diagnosi prestazionale.

## Confini

Il PoC separa i costi principali del percorso macOS corrente:

```text
GitHub release discovery reale tramite pkg_repository_list_versions
GitHub latest release resolution
GitHub artifact resolution
artifact download tramite http-fetch
SHA-256 tramite digest
hdiutil attach senza verify, solo come confronto diagnostico
hdiutil attach con il comportamento corrente di prodotto
ditto del volume nella destination
hdiutil detach
```

La misura `attach-noverify` è esclusivamente diagnostica. Non modifica il contratto `extract` e non costituisce proposta automatica di usare `-noverify` nel prodotto.

Il parser JSON e l'adapter GitHub usati per le prime tre misure sono quelli della revisione `rumiai-os` indicata sopra. Repository descriptor e range descriptor temporanei riproducono i valori correnti di `pkg-catalog` per `dbeaver/catalog-macos-arm64/n0001=26.1.5`.

## Interpretazione

Il PoC permette di distinguere almeno tre famiglie di costo:

```text
github-list-versions elevato  -> percorso HTTP/JSON/release discovery
artifact-download/digest      -> trasferimento o hashing
attach/copy/detach elevato    -> backend DMG nativo
```

Non viene fissata alcuna soglia normativa di performance. I tempi sono evidence diagnostica host-specific.

## Esecuzione

Dal checkout `rumiai-dev-PoCs` collocato sotto il workspace RumiAI corrente:

```sh
git pull --ff-only
sh pocs/007-macos-dbeaver-install-performance/run-macos.sh
```

È possibile passare esplicitamente la root `rumiai-os` come unico argomento se il checkout PoC non si trova nel layout workspace usuale.

Il PoC usa una directory temporanea e la ripulisce al termine. Scarica una volta il DMG DBeaver corrente e non installa né lancia DBeaver.
