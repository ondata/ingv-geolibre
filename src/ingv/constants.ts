/**
 * The development copy, built with `--mode dev`: its own id and name, so it
 * installs next to the copy from the registry. Every other name the plugin
 * registers under is derived from the id.
 */
const DEV_COPY = import.meta.env.MODE === "dev";

/** Plugin id; must match the bundle's `plugin.json`. */
export const PLUGIN_ID = DEV_COPY ? "ingv-geolibre-dev" : "ingv-geolibre";
export const PLUGIN_NAME = DEV_COPY ? "INGV earthquakes (dev)" : "INGV earthquakes";
/** Title of the panel. */
export const PLUGIN_LABEL = DEV_COPY ? "INGV (dev)" : "INGV";
export const PLUGIN_VERSION = "0.0.0";

/** Right-panel id, unique across plugins. */
export const PANEL_ID = `${PLUGIN_ID}-search`;

/** INGV FDSN event web service. */
export const FDSN_EVENT_URL = "https://webservices.ingv.it/fdsnws/event/1/query";
