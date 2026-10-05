# PoC 056 — GeoServer package state mapping

## Question

For the current RumiAI GeoServer package, which paths below the platform-independent binary installation root are changed by a real server startup, and which supported GeoServer/Jetty environment or command-line controls can relocate those writes?

This PoC supports `rumiai-dev/handoff/geoserver-package-state-mapping.md`.

## Scope

- GeoServer 3.0.1 platform-independent binary as the direct upstream probe anchor;
- Java 21, satisfying the current package dependency `java >=17 <22`;
- current `pkg-analyze`;
- GitHub Actions Linux runner for repeatable Internet-enabled execution;
- real bundled `bin/startup.sh` execution;
- fresh extracted root for every direct probe;
- real RumiAI composed installation in a separate job.

## Direct probe cases

1. baseline startup using the bundled `data_dir`;
2. startup with an external copy of `data_dir` through `GEOSERVER_DATA_DIR`;
3. startup with external `GEOSERVER_DATA_DIR` and `GEOSERVER_LOG_LOCATION`;
4. startup with external data/log and an explicit external Java temporary directory through `JAVA_OPTS=-Djava.io.tmpdir=...`.

Every case combines `pkg-analyze` path discovery with SHA-256 before/after manifests, so modifications of existing files are visible.

The evidence also captures the exact startup/shutdown scripts and relevant configuration references from the probed binary distribution.

## Classification rule

Observed writes are not automatically package `var/` state. Each write is classified according to the current RumiAI state model and whether upstream provides a supported relocation mechanism. Operator-supplied configuration/content is kept distinct from regenerable runtime cache or temporary state.
