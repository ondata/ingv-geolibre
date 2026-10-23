import type { GeoLibrePlugin } from "./lib/geolibre/host-api";
import { PANEL_ID, PLUGIN_ID, PLUGIN_LABEL, PLUGIN_NAME, PLUGIN_VERSION } from "./ingv/constants";
import "./ingv/panel.css";

/**
 * ingv-geolibre: search the INGV earthquake catalogue from a GeoLibre right
 * panel and show the events on the map.
 *
 * Panel-only plugin: no map control, so GeoLibre shows it as a plain toggle in
 * the Plugins menu. Toggling it on opens the panel; toggling it off removes it.
 */

/** `engines` is part of GeoLibre's plugin contract but not of the template's copy. */
type Plugin = GeoLibrePlugin & {
  engines?: ("maplibre" | "mapbox" | "cesium" | "arcgis")[];
};

let disposePanel: (() => void) | null = null;

export const plugin: Plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  engines: ["maplibre"],
  activate(app) {
    if (!app.registerRightPanel) return false;
    const registration = {
      id: PANEL_ID,
      title: PLUGIN_LABEL,
      defaultWidth: 380,
      // The panel is the plugin's whole UI: closing it with X turns the plugin
      // off, so the Plugins menu check mark follows (GeoLibre host option).
      deactivatePluginOnClose: true,
      render: (container: HTMLElement) => {
        const root = document.createElement("div");
        root.className = "ingq-panel";
        root.textContent = "INGV earthquake search: coming soon.";
        container.append(root);
        return () => root.remove();
      },
    };
    const unregister = app.registerRightPanel(registration);
    app.openRightPanel?.(PANEL_ID);
    disposePanel = () => {
      app.closeRightPanel?.(PANEL_ID);
      unregister();
    };
  },
  deactivate() {
    disposePanel?.();
    disposePanel = null;
  },
};

export default plugin;
