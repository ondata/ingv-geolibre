import type { GeoLibrePlugin } from "./lib/geolibre/host-api";
import { PANEL_ID, PLUGIN_ID, PLUGIN_LABEL, PLUGIN_NAME, PLUGIN_VERSION, TABLE_ID } from "./ingv/constants";
import { Controller } from "./ingv/controller";
import type { IngvHost } from "./ingv/host";
import { renderPanel } from "./ingv/panel";
import { renderTable } from "./ingv/table";
import "./ingv/panel.css";

/**
 * ingv-geolibre: search the INGV earthquake catalogue from a GeoLibre right
 * panel and show the events on the map.
 *
 * No map control, so GeoLibre shows it as a plain toggle in the Plugins menu.
 * Toggling it on opens the right panel (search and event detail); a search
 * opens the results table in a floating panel at the bottom left of the map.
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
    const host = app as IngvHost;
    const ctl = new Controller(host);
    const unregister = app.registerRightPanel({
      id: PANEL_ID,
      title: PLUGIN_LABEL,
      defaultWidth: 380,
      // The panel is the plugin's whole UI: closing it with X turns the plugin
      // off, so the Plugins menu check mark follows (GeoLibre host option).
      deactivatePluginOnClose: true,
      render: (container: HTMLElement) => renderPanel(ctl, container),
    } as Parameters<NonNullable<typeof app.registerRightPanel>>[0]);
    const unregisterTable = host.registerFloatingPanel?.({
      id: TABLE_ID,
      title: "Results",
      defaultWidth: 600,
      defaultHeight: 300,
      position: "bottom-left",
      render: (container: HTMLElement) => renderTable(ctl, container),
      onOpen: () => ctl.update({ tableOpen: true }),
      onClose: () => ctl.update({ tableOpen: false }),
    });
    if (unregisterTable) {
      ctl.openTable = () => host.openFloatingPanel?.(TABLE_ID);
      ctl.closeTable = () => host.closeFloatingPanel?.(TABLE_ID);
    }
    app.openRightPanel?.(PANEL_ID);
    disposePanel = () => {
      unregisterTable?.();
      app.closeRightPanel?.(PANEL_ID);
      unregister();
      ctl.dispose();
    };
  },
  deactivate() {
    disposePanel?.();
    disposePanel = null;
  },
};

export default plugin;
