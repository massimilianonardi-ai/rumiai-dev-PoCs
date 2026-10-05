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
4. startup with external data/log and an explicit external Java temporary directory through `JAVA_OPTS=-Djava.io.tmpdir=...`;
5. startup with data, log, Java temporary storage and GeoWebCache cache all relocated externally through `GEOWEBCACHE_CACHE_DIR`.

Every case combines `pkg-analyze` path discovery with SHA-256 before/after manifests, so modifications of existing files are visible.

The evidence also captures the exact startup/shutdown scripts and relevant configuration references from the probed binary distribution.

## Classification rule

Observed writes are not automatically package `var/` state. Each write is classified according to the current RumiAI state model and whether upstream provides a supported relocation mechanism. Operator-supplied configuration/content is kept distinct from regenerable runtime cache or temporary state.

## Findings

The baseline startup changes only paths below the bundled `data_dir`; no other package-root path changed in the observed startup/shutdown cycle.

Setting `GEOSERVER_DATA_DIR` to an external copy of the factory data directory makes the package-root delta empty and relocates the observed configuration, security, sample-database and GeoWebCache metadata writes with it. `GEOSERVER_LOG_LOCATION` independently relocates the active log file, `JAVA_OPTS=-Djava.io.tmpdir=...` relocates the GeoTools EPSG HSQL temporary database, and `GEOWEBCACHE_CACHE_DIR` relocates GeoWebCache cache state. With all four controls active, the package root remains unchanged.

For the RumiAI package, the robust static compatibility mapping is therefore the official factory `data_dir` as package `data`. The finer log/cache/tmp relocation controls remain available upstream but are not required to preserve package-root immutability.
