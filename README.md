# INGV earthquakes for GeoLibre

A [GeoLibre](https://geolibre.app) plugin to search the earthquake catalogue of INGV (Istituto Nazionale di Geofisica e Vulcanologia) and show the events on the map.

Status: **in development**, not usable yet.

## Data source

Events come from the INGV [FDSN event web service](https://webservices.ingv.it/fdsnws/event/1/), described on the [INGV web services page](https://terremoti.ingv.it/webservices_and_software). The data are released by INGV under the [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) licence.

## Development

```bash
npm install
npm test
npm run build              # geolibre-plugin/dist
npm run build:geolibre:dev # development copy, id ingv-geolibre-dev, in geolibre-plugin-dev/
npm run package:geolibre   # zip in geolibre-plugin/
```

The build, packaging and install scripts come from [openrndt-geolibre](https://github.com/ondata/openrndt-geolibre).

## Licence

MIT, see [LICENSE](LICENSE).
