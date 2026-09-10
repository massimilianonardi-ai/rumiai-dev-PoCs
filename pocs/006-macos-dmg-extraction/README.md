# PoC 006 — macOS DMG extraction

## Obiettivo

Verificare sul reference macOS se il DMG DBeaver corrente può essere materializzato in modo affidabile usando capability native dell'host, senza introdurre ancora alcuna modifica al contratto o all'implementazione stabile di `rumiai-os/bin/sys/extract`.

La domanda concreta nasce dal gate live DBeaver:

```text
DBeaver macOS range -> format=dmg
extract dmg         -> 7zz / 7z / 7za nel contratto corrente
reference macOS     -> nessuno dei tre backend osservato nel PATH
```

Il contratto autorevole corrente resta:

```text
rumiai-dev/decisions/rumiai-os/2026-09-09-digest-and-extract-system-utilities.md
```

Questo PoC **non** lo modifica e non promuove automaticamente `hdiutil` o `ditto` a backend di prodotto.

## Scope

Il PoC usa esclusivamente l'artifact reale corrente necessario al package DBeaver ARM64:

```text
release: 26.2.0
artifact: dbeaver-ce-26.2.0-macos-aarch64.dmg
size: 123190051 byte
sha256: 62a03aa88429d4eef3576550397aae75d2576a012deda0c83d4b44f5fbcd4a3f
```

Verifica:

```text
presenza dei tool nativi hdiutil e ditto
presenza/assenza dei backend 7zz, 7z, 7za
scaricamento e integrità dell'artifact reale
attach read-only e non browsable in mountpoint temporaneo esplicito
presenza di DBeaver.app/Contents/MacOS/dbeaver nel volume montato
copia del contenuto del volume con ditto in destination temporanea
smontaggio del DMG
presenza ed executable bit del target copiato
digest byte-identico del target executable prima e dopo la copia
cleanup automatico delle risorse temporanee
```

## Deliberatamente fuori scope

Il PoC non stabilisce ancora:

```text
semantica universale per DMG multi-volume
fallback generale fra hdiutil e 7-Zip
ordine definitivo dei backend extract
supporto DMG su host non-macOS
hardening/sandbox dell'estrazione
pkg install completo
pkg_default
launch GUI DBeaver
```

Il test è intenzionalmente limitato al bisogno reale che ha fatto emergere il problema, secondo la minimal-change rule.

## Candidato verificato

La sequenza candidata è:

```text
hdiutil attach -readonly -nobrowse -mountpoint <temporary-mount> <artifact>
        ↓
ditto <temporary-mount> <destination>
        ↓
hdiutil detach <temporary-mount>
```

`hdiutil` confina la semantica disk-image specifica di macOS; `ditto` è usato per copiare la gerarchia preservando il metadata filesystem supportato dal tool nativo.

La destination esiste già, coerentemente con il contratto corrente di `extract <format> <artifact> <destination>`.

## Esecuzione

Da un checkout aggiornato di `rumiai-dev-PoCs` sul reference Mac:

```sh
git pull --ff-only
sh pocs/006-macos-dmg-extraction/run-macos.sh
```

Il PoC scarica circa 123 MB, usa esclusivamente una directory temporanea sotto `${TMPDIR:-/tmp}` e la rimuove al termine. Il DMG non viene conservato.

Un risultato positivo termina con:

```text
dmg-native-extraction=PASS
```

## Risultato fisico

Il PoC è stato eseguito sul reference macOS ARM64 il 2026-09-10 e ha prodotto `PASS` con il DMG reale DBeaver 26.2.0.

Evidence:

```text
sessions/2026-09-10-reference-macos-arm64/result.md
```

Sono stati osservati `hdiutil=/usr/bin/hdiutil` e `ditto=/usr/bin/ditto`, mentre `7zz`, `7z` e `7za` risultavano assenti. Il target `DBeaver.app/Contents/MacOS/dbeaver` è rimasto executable e byte-identico dopo la copia dal volume montato alla destination.

## Criterio decisionale successivo

Il risultato dimostra che la sequenza nativa è tecnicamente praticabile per il DMG DBeaver corrente. Prima di modificare `rumiai-os` è comunque necessario:

1. proporre e fissare esplicitamente la modifica del mapping `dmg` nel contratto `extract`;
2. ottenere l'autorizzazione alla modifica prodotto;
3. riallineare implementazione e test permanenti;
4. rieseguire la physical validation proporzionata e infine il gate live DBeaver sui reference host.
