# PoC 007 — macOS JSON parser performance baseline

Date: 2026-09-10
Host: reference macOS ARM64

Revisions:

```text
rumiai-os@a2531626b68e81c9df4e76a007e7f963b3f26343
```

Observed output:

```text
host=Darwin/arm64
rumiai-os=a2531626b68e81c9df4e76a007e7f963b3f26343
awk=/usr/bin/awk
fetch=START
fetch-seconds=1.408512
fetch-bytes=2355841
payload-bytes= 2355841
awk-linear=START
awk-linear-bytes=2355841
awk-linear-real 0,06
awk-linear-user 0,05
awk-linear-sys 0,00
json-parser=START
json-parser-status=0
json-parser-records=     100
json-parser-real 100,02
json-parser-user 99,67
json-parser-sys 0,32
probe=PASS
```

## Interpretation

The observed slowdown is inside the current JSON parser path, not in the HTTP fetch and not in `awk` as a simple linear file reader.

For the same 2,355,841-byte GitHub releases payload:

```text
HTTP fetch          1.408512 s
linear awk read     0.06 s real
current JSON parse  100.02 s real
                    99.67 s user
```

The parser completed correctly and emitted 100 records, so this is a performance defect rather than a functional failure.

This evidence does not by itself select an implementation change. The next PoC step compares a windowed cursor implementation that preserves the existing JSON API and parsing semantics while avoiding per-character `substr()` calls directly against the full multi-megabyte source string.
