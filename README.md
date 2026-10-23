# INGV Earthquakes for GeoLibre

**The earthquakes of the last hour, day, week or year, on the map, from the Italian national catalogue.**

INGV (Istituto Nazionale di Geofisica e Vulcanologia) locates every earthquake recorded by the Italian seismic network and publishes it in its catalogue. This plugin brings that catalogue into [GeoLibre](https://github.com/opengeos/GeoLibre), the free GIS that runs in the browser and on the desktop: pick a period and a magnitude range, and the events appear on the map, coloured by depth and sized by magnitude.

![The earthquakes of the last 24 hours north of Sicily, magnitude 2 and above, coloured by depth](docs/images/1-search.webp)

Status: **beta**, open for testing.

## What it does

- **Search**: period (1 hour to 1 year, or a custom range with time), magnitude range, area (the map view, around a point, the whole world, or one of 173 countries), depth classes, order and limit. Every change runs a new search on the INGV service.
- **Map**: one circle per event, colour by depth (0-10, 10-30, 30-100, over 100 km), size by magnitude. A click opens the event. **Live zoom** fits the map to the results at every change.
- **Results table**: sortable, hover to find the event on the map, export to CSV or GeoJSON, **Add to layers** to keep a search in the project.
- **Event detail**: time in Italy and UTC, position, depth, magnitude type; the ShakeMap maps when INGV made one; the felt reports map; how location and magnitude changed after the first estimate; a search of the seismicity around the event; a link to the event page on [terremoti.ingv.it](https://terremoti.ingv.it).
- **Small screens**: below 768 px, where GeoLibre docks the panel under the map, the results become a list with Results and Filters tabs.

![The results table under the map, sorted by magnitude, and the event under the pointer ringed on the map](docs/images/2-table.webp)

![An event's detail: summary, felt reports, how location and magnitude changed after the first estimate, seismicity around](docs/images/3-detail.webp)

## Install it in GeoLibre

You need [GeoLibre](https://github.com/opengeos/GeoLibre/releases) 3.4.0 or later.

1. In GeoLibre open **Settings > Manage Plugins**.
2. Find **INGV Earthquakes** and choose **Install**.
3. Turn the plugin on from **Plugins > INGV Earthquakes**: the panel opens with the earthquakes of the last 7 days, magnitude 2 and above, in the map view.

## Good to know

- **Coverage**: the catalogue is detailed for Italy and its seas, down to the smallest events. Elsewhere INGV lists only the stronger earthquakes. Over the 30 days before 23 October 2026 the smallest event listed was M 0.1 in Italy, M 4.5 in the rest of Europe and the Mediterranean, M 5.5 in the rest of the world.
- **Web or Desktop**: the event search works in both. The ShakeMap layers (contours and stations as GeoJSON) are served without CORS headers, so only GeoLibre Desktop can add them to the map; the ShakeMap images show in both.

## Data and citation

Events come from the INGV [FDSN event web service](https://webservices.ingv.it/fdsnws/event/1/), described on the [INGV web services page](https://terremoti.ingv.it/webservices_and_software). ShakeMap from [shakemap.ingv.it](https://shakemap.ingv.it), felt reports from [hsit.it](https://www.hsit.it), country boxes from [Natural Earth](https://www.naturalearthdata.com) 1:110m. The data are released by INGV under the [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) licence.

Cite the catalogue as: ISIDe Working Group (2007). Italian Seismological Instrumental and Parametric Database (ISIDe). Istituto Nazionale di Geofisica e Vulcanologia (INGV). [doi:10.13127/ISIDE](https://doi.org/10.13127/ISIDE)

## Development

```bash
npm install
npm test
npm run build              # geolibre-plugin/dist
npm run build:geolibre:dev # development copy, id ingv-geolibre-dev, in geolibre-plugin-dev/
npm run package:geolibre   # zip in geolibre-plugin/
```

The build, packaging and install scripts come from [openrndt-geolibre](https://github.com/ondata/openrndt-geolibre). The design notes are in [docs/ui-design.md](docs/ui-design.md), the history in [LOG.md](LOG.md).

## Licence

Code: MIT, see [LICENSE](LICENSE). Data: INGV, CC BY 4.0.
