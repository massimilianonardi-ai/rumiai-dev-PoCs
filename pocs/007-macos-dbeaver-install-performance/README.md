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

## Prima fase — causa localizzata

La prima fase ha isolato rete e parser sullo stesso payload reale GitHub `dbeaver/dbeaver` `releases?per_page=100&page=1`.

Evidence:

```text
sessions/2026-09-10-json-baseline-macos-arm64/result.md
```

Risultato fisico sul reference macOS ARM64:

```text
payload                    2,355,841 bytes
HTTP fetch                 1.408512 s
awk lineare                0.06 s real / 0.05 s user
parser JSON corrente       100.02 s real / 99.67 s user
record emessi              100
```

Il rallentamento è quindi nel percorso algoritmico del parser JSON corrente, non nel trasferimento HTTP e non nel costo di `awk` come lettore lineare del file.

Il parser corrente mantiene l'intero documento nella stringa `src` e durante la scansione usa ripetutamente `substr(src, pos, 1)`. Sul `/usr/bin/awk` del reference macOS questa modalità produce il costo dominante osservato.

## Seconda fase — candidato windowed

La seconda fase prova una modifica esclusivamente interna del cursore del parser:

```text
json-windowed.lib.sh
```

Il candidato mantiene invariati:

```text
API shell pubbliche
typed scalar output
strutture JSON accettate
validazione degli escape
policy Unicode corrente
rejection di TAB/CR/LF nelle stringhe selezionate
semantica dei campi mancanti e duplicati
```

Cambia soltanto l'accesso alla sorgente: invece di eseguire ogni `substr(...,1)` direttamente sulla stringa multi-megabyte, il cursore carica una finestra di 4096 byte e legge i singoli caratteri dalla finestra. Gli accessi che attraversano il confine della finestra ricadono sul `substr` della sorgente soltanto per il piccolo token richiesto.

`run-macos.sh`:

1. confronta parser corrente e candidato su fixture deterministiche per le tre forme API strutturali;
2. scarica una sola volta la pagina reale GitHub;
3. misura nuovamente un controllo `awk` lineare;
4. misura il candidato windowed sul payload reale;
5. richiede esattamente 100 record;
6. riporta come baseline fisica precedente `100.02 s` su `2,355,841` byte.

La prima misura lenta del parser corrente non viene ripetuta: è già evidence fisica conservata e ripeterla aggiungerebbe circa 100 secondi senza informazione nuova.

## Risultato della seconda fase

Evidence:

```text
sessions/2026-09-10-json-windowed-macos-arm64/result.md
```

Risultato fisico sul reference macOS ARM64:

```text
semantic-smoke             PASS
payload                    2,355,841 bytes
HTTP fetch                 1.386539 s
awk lineare                0.05 s real / 0.05 s user
parser windowed            5.23 s real / 5.19 s user
record emessi              100
probe                       PASS
```

Confronto con la baseline già registrata:

```text
parser corrente            100.02 s real
parser windowed              5.23 s real
miglioramento              circa 19.1x
```

Il candidato risponde positivamente alla domanda del PoC: il costo patologico osservato su macOS è eliminato in larga parte modificando soltanto l'accesso interno alla sorgente, senza cambiare il contratto JSON osservabile nelle verifiche sperimentali.

Il PoC è quindi concluso positivamente per la decisione di promozione. Al momento della conclusione del PoC questa evidence non costituiva validation del prodotto e richiedeva promozione, test permanenti e nuova physical validation revision-specific.

## Stato successivo alla promozione

Il candidato esatto del PoC è stato successivamente promosso in:

```text
rumiai-os@79cb5964428ca68c06c2f4eac98ac7350ae9561f
lib/sh/json.lib.sh blob 6b028e01bba06bd24f7af8fe26bff0d1a9bb29fe
```

con test permanenti sui boundary della finestra in `rumiai-os/json/structure.test`.

La coppia:

```text
rumiai-os@79cb5964428ca68c06c2f4eac98ac7350ae9561f
rumiai-tests@886bd7bee855e613bbaa20af4006c3e8f9477a4d
selection: rumiai-os
```

è stata fisicamente validata sui due reference host ARM64:

```text
Ubuntu ARM64  PASS 65 / FAIL 0 / SKIP 2 / ERROR 0
macOS ARM64   PASS 67 / FAIL 0 / SKIP 0 / ERROR 0
```

L'evidence autorevole è registrata in `rumiai-dev`:

```text
decisions/rumiai-os/2026-09-10-json-windowed-arm64-physical-validation.md
```

Il successivo gate revision-specific resta la riesecuzione di `external/dbeaver/install-live.test` sulla stessa revisione `79cb596`, che esercita il payload GitHub reale nel percorso package end-to-end.

## Esecuzione

Dal checkout `rumiai-dev-PoCs` sotto il workspace RumiAI corrente:

```sh
git pull --ff-only
sh pocs/007-macos-dbeaver-install-performance/run-macos.sh
```

È possibile passare esplicitamente la root `rumiai-os` come unico argomento se il checkout PoC non si trova nel layout workspace usuale.

Il PoC usa una directory temporanea e la ripulisce al termine. Non installa né lancia DBeaver e non modifica il checkout `rumiai-os`.
