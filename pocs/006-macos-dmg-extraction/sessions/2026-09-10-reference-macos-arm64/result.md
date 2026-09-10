# PoC 006 — Reference macOS ARM64 result

Date: 2026-09-10  
Status: **PASS**

## Scope

Physical execution of:

```text
pocs/006-macos-dmg-extraction/run-macos.sh
```

on the current reference macOS ARM64 host.

The PoC validates only the native DMG materialization path for the real current DBeaver artifact. It does not modify the accepted `extract` contract and does not constitute `pkg install dbeaver` validation.

## Observed environment

```text
host=Darwin/arm64
curl=/usr/bin/curl
hdiutil=/usr/bin/hdiutil
ditto=/usr/bin/ditto
shasum=/usr/bin/shasum
current-7z-backend=absent
```

The current RumiAI 7-Zip candidates `7zz`, `7z`, and `7za` were therefore unavailable on this host, while the native `hdiutil` and `ditto` capabilities were available.

## Artifact

Observed and verified:

```text
artifact=dbeaver-ce-26.2.0-macos-aarch64.dmg
artifact-size=123190051
artifact-sha256=62a03aa88429d4eef3576550397aae75d2576a012deda0c83d4b44f5fbcd4a3f
```

## Observed extraction

The PoC successfully performed:

```text
hdiutil attach -readonly -nobrowse -mountpoint <temporary-mount> <artifact>
ditto <temporary-mount> <destination>
hdiutil detach <temporary-mount>
```

Mounted top-level entries observed:

```text
Applications
DBeaver.app
.background
.DS_Store
.VolumeIcon.icns
```

The expected executable existed and remained executable:

```text
DBeaver.app/Contents/MacOS/dbeaver
```

Digest before and after the `ditto` copy:

```text
source-target-sha256=86eb6671dba3d06fa63239cce88c556b99af23cab415073a0cac648e9f29cc48
destination-target-sha256=86eb6671dba3d06fa63239cce88c556b99af23cab415073a0cac648e9f29cc48
```

The copied executable was therefore byte-identical to the executable in the mounted DMG.

## Captured output

```text
host=Darwin/arm64
curl=/usr/bin/curl
hdiutil=/usr/bin/hdiutil
ditto=/usr/bin/ditto
shasum=/usr/bin/shasum
current-7z-backend=absent
download=START
download=PASS
artifact-size=123190051
artifact-sha256=62a03aa88429d4eef3576550397aae75d2576a012deda0c83d4b44f5fbcd4a3f
attach=START
attach=PASS
mounted-top-level:
  Applications
  DBeaver.app
  .background
  .DS_Store
  .VolumeIcon.icns
source-target-sha256=86eb6671dba3d06fa63239cce88c556b99af23cab415073a0cac648e9f29cc48
copy=START
copy=PASS
detach=PASS
destination-target-sha256=86eb6671dba3d06fa63239cce88c556b99af23cab415073a0cac648e9f29cc48
dmg-native-extraction=PASS
```

## Conclusion

The real DBeaver 26.2.0 ARM64 DMG can be materialized successfully on the current reference macOS host using the native pair `hdiutil` + `ditto` with a read-only explicit temporary mountpoint.

This evidence is sufficient to evaluate an explicit change to the `extract` DMG backend-selection contract. It does not by itself authorize or implement that product change.
