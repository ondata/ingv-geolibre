# Interface design

Proposal of 2026-10-23, then drawn as the "INGV Panel" design and implemented the same day. Goal: show the earthquakes on the map and open the rest of INGV's information step by step, without a crowded panel.

## Contents

- What GeoLibre lets a plugin place
- Layout
- Level 1: search
- Level 2: results table
- Level 3: event detail
- Information available per event
- Open questions

## What GeoLibre lets a plugin place

Checked in `docs/plugin-api.md` of opengeos/GeoLibre on 2026-10-23.

- **Right panel**: one plugin panel at a time, docked at one of four positions (either side of Layers or of Style) or sharing the Style rail. The plugin owns the body.
- **Floating panel**: a draggable, closeable card over the map, opening at a corner (`top-left`, `top-right`, `bottom-left`, `bottom-right`). Several can be open. It does not shrink the map.
- **No bottom dock** for plugins: a table under the map can only be a floating panel opened at a bottom corner, wide, and movable by the user.
- **Popup**: GeoLibre's own; a plugin cannot configure it. Only a `description` field holding `<a>` markup renders as a link.
- **Map**: `fitBounds` and `getViewBounds`; `getMap` gives the MapLibre map for a fly-to on one point.

## Layout

```
+---------+------------------------------+-------------+
| Layers  |            map               | INGV panel  |
|         |                              |  search     |
|         |                              |  or         |
|         |  +------------------------+  |  event      |
|         |  | results table (float)  |  |  detail     |
|         |  +------------------------+  |             |
+---------+------------------------------+-------------+
```

- The right panel holds the search, and the detail of one event when one is chosen (with a "Back to search" link).
- The table is a floating panel opened at the bottom left after a search, closeable, reopened from a "Show table" link in the panel.

## Level 1: search

Always visible at the top of the panel, two direct filters:

- **Time, steps back from now**, as one row of chips: 1 h, 24 h, 3 days, 7 days (default), 30 days, 1 year, and "Custom" (two dates).
- **Magnitude range**, a double slider with two handles (min and max) from 0 to 8 in steps of 0.5, default 2 to 8, with the two values written beside it and editable.

Then:

- Area: a menu you can type in, with map view (default), around a point (centre that follows the map until a map click fixes it, radius), world, and 173 countries from Natural Earth 1:110m, found by name or ISO code. A country moves the map to its box; one across the 180° meridian is searched on its latitude band. Outside Italy the INGV catalogue lists mostly the stronger earthquakes: in Greece's box, 59 events in 2026, the smallest M 2.6, against 13,025 in Italy's (2026-10-23).
- Search button, then one line: "121 earthquakes, strongest M 5.5".

Behind a "More filters" disclosure, closed by default: depth range (same double slider), order of results, limit.

Changing a chip or releasing a slider handle runs the search again, so the button is only needed for the area.

## Level 2: results table

Columns as on terremoti.ingv.it: time (Italy), magnitude with type, place, depth. Latitude and longitude left out: the map shows them.

- Sort by clicking a header (time, magnitude, depth).
- Click a row: the map flies to the event, the panel opens its detail.
- Export of the list (CSV, GeoJSON) from the table header.

## Level 3: event detail

In the right panel, in sections that open on click. The first one is open; the others load their data only when opened, so a click costs one request.

1. **Summary** (open): magnitude and type, time UTC and Italy, depth, place, who located it, link to the INGV page.
2. **Shaking (ShakeMap)**: the three images (intensity, acceleration, velocity) as thumbnails; buttons "Add intensity contours to map" and "Add stations to map" (GeoJSON).
3. **Felt reports**: the "Hai sentito il terremoto?" (HSIT) map image and the link to the questionnaire.
4. **Location and magnitude history**: the table of origins and magnitudes over time (automatic, revised, Mw).
5. **Seismicity around**: the INGV maps of the 3 days, 90 days, since 1985, historical; or, better, a button "Search around this event" that runs the plugin's own search in a 30 km radius.

A section is shown only when its product exists for the event (a small event has no ShakeMap).

## Information available per event

Checked live on 2026-10-23 on the M 5.5 of 10:19 UTC in the Southern Tyrrhenian (event 47606532) and the M 4.1 of 15:32 UTC (47612622).

| Information | Where | CORS | Note |
|---|---|---|---|
| Events, filters | `webservices.ingv.it/fdsnws/event/1/query?format=geojson` | yes | in use |
| Origins and magnitudes history | same service, `includeallorigins`, `includeallmagnitudes`, QuakeML | yes | 1.7 MB for the M 5.5 |
| ShakeMap images | `shakemap.ingv.it/data/<id>/current/products/{intensity,pga,pgv}.jpg` | images, no need | 404 for the M 4.1 |
| ShakeMap contours and stations | same folder, `cont_mi.json`, `cont_pga.json`, `stationlist.json` (GeoJSON) | **no** | the web version cannot read them; Desktop to try |
| Felt reports map | `e.hsit.it/<id>/<id>_mcs_municipality.jpg` | yes | |
| Seismicity and hazard maps | `terremoti.ingv.it/ws/geoserver/1/query?map=<name>&eventid=<id>` | images | names: `map_seismicity_3d`, `map_seismicity_90d`, `map_seismicity_1985`, `map_historical`, `map_hazard` |

Not available as data: the towns within 20 km and the nearest city, which the event page computes itself.

## Open questions

- ShakeMap contours as map layers only in Desktop, because of CORS: acceptable, or ask INGV for the header?
- Detail links on Desktop: do `_blank` links open in the system browser?
