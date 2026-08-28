# RumiAI Development PoCs

Questo repository è il laboratorio sperimentale di RumiAI.

Il repository canonico per regole, specifiche, decisioni e architettura è `rumiai-dev`.

La suite permanente di test e validazione appartiene invece al repository separato `rumiai-tests`.

Questo repository conserva proof-of-concept, prototipi, fixture, procedure, input, output, log significativi e sessioni sperimentali usati per rispondere a domande ancora aperte durante lo sviluppo.

Un PoC può essere temporaneo, evolutivo, incompleto o specifico di una particolare indagine. Quando da un PoC emerge una proprietà che deve restare vera nel tempo, tale proprietà dovrebbe essere trasformata in un test permanente in `rumiai-tests` quando il costo è ragionevole.

## Struttura

```text
pocs/
└── <id>-<nome>/
    ├── README.md
    ├── fixtures/
    ├── tests/
    └── sessions/
```

La directory `tests/` interna a un singolo PoC contiene esclusivamente verifiche sperimentali necessarie a quel PoC e non costituisce la suite permanente di regressione di RumiAI.

Ogni PoC deve distinguere chiaramente il materiale storico o di input dal codice sperimentale e dai risultati delle singole sessioni.
