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

## Prima ipotesi da verificare

L'indagine parte dal parser JSON perché i rallentamenti osservati in precedenza nel percorso GitHub sono stati attribuiti a `awk`, mentre il download del DMG DBeaver era già stato osservato separatamente nell'ordine di pochi secondi.

La prima fase del PoC risponde quindi esclusivamente alla domanda:

```text
il parsing della pagina reale GitHub releases?per_page=100 è il costo dominante su macOS?
```

Non vengono ancora profilati download artifact, digest o backend DMG. Questi verranno misurati soltanto se la prima fase non spiega il rallentamento.

## Misure della prima fase

`run-macos.sh`:

1. verifica di essere sul reference macOS e di usare `rumiai-os@a2531626b68e81c9df4e76a007e7f963b3f26343`;
2. scarica una sola volta la pagina reale `dbeaver/dbeaver` `releases?per_page=100&page=1` con gli header GitHub correnti;
3. registra tempo e dimensione del solo trasferimento HTTP;
4. sul payload locale misura un controllo `awk` lineare che legge l'intero file;
5. sullo stesso payload locale misura la vera `json_array_object_fields tag_name draft prerelease created_at published_at` della `json.lib.sh` corrente;
6. registra `real`, `user`, `sys` tramite `/usr/bin/time -p`.

In questo modo rete e parser non vengono confusi nella stessa misura. Nessuna soglia prestazionale diventa parte del contratto: i tempi sono evidence diagnostica host-specific.

## Esecuzione

Dal checkout `rumiai-dev-PoCs` sotto il workspace RumiAI corrente:

```sh
git pull --ff-only
sh pocs/007-macos-dbeaver-install-performance/run-macos.sh
```

È possibile passare esplicitamente la root `rumiai-os` come unico argomento se il checkout PoC non si trova nel layout workspace usuale.

Il PoC usa una directory temporanea e la ripulisce al termine. Non installa né lancia DBeaver e non modifica il checkout `rumiai-os`.
