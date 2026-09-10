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

`run-macos.sh` ora:

1. confronta parser corrente e candidato su fixture deterministiche per le tre forme API strutturali;
2. scarica una sola volta la pagina reale GitHub;
3. misura nuovamente un controllo `awk` lineare;
4. misura il candidato windowed sul payload reale;
5. richiede esattamente 100 record;
6. riporta come baseline fisica precedente `100.02 s` su `2,355,841` byte.

La prima misura lenta del parser corrente non viene ripetuta: è già evidence fisica conservata e ripeterla aggiungerebbe circa 100 secondi senza informazione nuova.

Il candidato è ancora materiale sperimentale. Nessuna modifica è stata promossa in `rumiai-os`.

## Esecuzione

Dal checkout `rumiai-dev-PoCs` sotto il workspace RumiAI corrente:

```sh
git pull --ff-only
sh pocs/007-macos-dbeaver-install-performance/run-macos.sh
```

È possibile passare esplicitamente la root `rumiai-os` come unico argomento se il checkout PoC non si trova nel layout workspace usuale.

Il PoC usa una directory temporanea e la ripulisce al termine. Non installa né lancia DBeaver e non modifica il checkout `rumiai-os`.
