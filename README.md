# RumiAI Development PoCs

Questo repository contiene i proof-of-concept e le sessioni di test eseguibili usati durante lo sviluppo di RumiAI.

Il repository canonico per regole, specifiche, decisioni e architettura è `rumiai-dev`; questo repository conserva invece evidenza sperimentale riproducibile: codice dei PoC, fixture, procedure, output, log significativi e risultati.

## Struttura

```text
pocs/
└── <id>-<nome>/
    ├── README.md
    ├── fixtures/
    ├── tests/
    └── sessions/
```

Ogni PoC deve distinguere chiaramente il materiale storico o di input dal codice di test e dai risultati delle singole sessioni.
