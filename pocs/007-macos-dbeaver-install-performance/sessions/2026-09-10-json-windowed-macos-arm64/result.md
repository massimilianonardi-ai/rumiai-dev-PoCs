# PoC 007 — windowed JSON parser result

Date: 2026-09-10
Host: Darwin/arm64 reference host

## Subject

Comparison of the windowed JSON parser candidate against the already-recorded current-parser baseline, using the real GitHub releases payload for `dbeaver/dbeaver`.

Product baseline:

```text
rumiai-os@a2531626b68e81c9df4e76a007e7f963b3f26343
```

Candidate:

```text
pocs/007-macos-dbeaver-install-performance/json-windowed.lib.sh
```

## Observed output

```text
semantic-smoke=PASS
host=Darwin/arm64
rumiai-os=a2531626b68e81c9df4e76a007e7f963b3f26343
awk=/usr/bin/awk
fetch=START
fetch-seconds=1.386539
fetch-bytes=2355841
payload-bytes= 2355841
awk-linear=START
awk-linear-bytes=2355841
awk-linear-real 0,05
awk-linear-user 0,05
awk-linear-sys 0,00
json-windowed=START
json-windowed-status=0
json-windowed-records=     100
json-windowed-real 5,23
json-windowed-user 5,19
json-windowed-sys 0,01
baseline-current-json-real-seconds=100.02
baseline-current-json-payload-bytes=2355841
probe=PASS
```

## Interpretation

The candidate preserves the deterministic semantic smoke outputs for all three currently supported structural extraction forms and successfully parses the real 2,355,841-byte GitHub payload into exactly 100 records.

On the same reference macOS host and same payload size, the previously recorded current-parser baseline was 100.02 s real. The windowed candidate completed in 5.23 s real, approximately 19.1x faster.

The linear `awk` control remained approximately 0.05 s, confirming that the remaining cost is parser work rather than file reading itself.

This is PoC evidence, not product validation. Promotion into `rumiai-os` creates a new product revision that requires its own permanent tests and revision-specific physical validation.
