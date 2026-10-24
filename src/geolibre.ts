import type { GeoLibrePlugin } from "./lib/geolibre/host-api";
import { PANEL_ID, PLUGIN_ID, PLUGIN_LABEL, PLUGIN_NAME, PLUGIN_VERSION, TABLE_ID } from "./ingv/constants";
import { Controller } from "./ingv/controller";
import type { IngvHost } from "./ingv/host";
import { renderPanel } from "./ingv/panel";
import { renderTable } from "./ingv/table";
import { linkFrom, URL_PARAMETER_NAMES } from "./ingv/url-params";
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
let activeCtl: Controller | null = null;
/** The link already followed: GeoLibre gives its parameters again at every project it opens. */
let followedLink: string | null = null;

export const plugin: Plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  engines: ["maplibre"],
  // `?ingvTime=24h&ingvArea=world…` in a GeoLibre link: the panel's Share button writes them.
  urlParameterNames: URL_PARAMETER_NAMES,
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
    // The catalogue is regional: a flat map reads better than the globe GeoLibre opens on.
    const map = host.getMap?.();
    if (map?.getProjection?.()?.type === "globe") map.setProjection?.({ type: "mercator" });
    // A sequence is often seen at zoom 10-11: a wider overview shows the region
    // around it. Not on a phone, where the panel already covers the bottom of the map.
    const openedMinimap = window.innerWidth >= 768 && host.isControlPanelVisible?.("minimap") === false;
    if (window.innerWidth >= 768) host.openControlPanel?.("minimap", { zoomOffset: -6 });
    app.openRightPanel?.(PANEL_ID);
    // A first search with the defaults, so the panel opens on the earthquakes.
    void ctl.run();
    activeCtl = ctl;
    disposePanel = () => {
      activeCtl = null;
      if (openedMinimap) host.closeControlPanel?.("minimap");
      unregisterTable?.();
      app.closeRightPanel?.(PANEL_ID);
      unregister();
      ctl.dispose();
    };
  },
  handleUrlParameters(_app, params) {
    const link = linkFrom(params, new Date());
    if (!link || !activeCtl) return;
    const key = URL_PARAMETER_NAMES.map((name) => params.get(name)).join("|");
    if (key === followedLink) return;
    followedLink = key;
    void activeCtl.followLink(link);
  },
  deactivate() {
    disposePanel?.();
    disposePanel = null;
  },
};

export default plugin;
