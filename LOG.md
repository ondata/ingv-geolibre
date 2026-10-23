# Log

## 2026-10-23

- **Phase 0**: repo created from the skeleton of openrndt-geolibre (build, dev copy with CSS prefix `ingq-`/`ingqdev-`, packaging, install, serve scripts, host API types). Plugin `ingv-geolibre` 0.0.0 with an empty right panel. `tsc`, 3 tests, lint, build, dev build and zip pass.
- **INGV FDSN event service checked**: CORS `*`, native `format=geojson`, filters on time, magnitude, depth, box and radius; 13,521 events from 2026-01-01 in one response; CC BY 4.0. Event page `terremoti.ingv.it/event/<id>` answers 200.
