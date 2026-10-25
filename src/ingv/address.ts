import type { Controller } from "./controller";
import { SHARE_PLUGIN_ID, shareUrl, URL_PARAMETER_NAMES } from "./url-params";

/** GeoLibre's startup view, which a shared link carries when it has no box. */
const VIEW_PARAMS = ["lat", "lon", "zoom"];

/**
 * The address with the plugin's parameters replaced by `ours`, or removed when
 * `ours` is null. The other parameters (`?url=` of a project, other plugins')
 * stay as they are.
 */
export function addressWith(href: string, ours: URLSearchParams | null): string {
  const url = new URL(href);
  for (const name of URL_PARAMETER_NAMES) url.searchParams.delete(name);
  if (url.searchParams.get("plugin") === SHARE_PLUGIN_ID) url.searchParams.delete("plugin");
  if (ours) {
    for (const name of VIEW_PARAMS) url.searchParams.delete(name);
    for (const [name, value] of ours) url.searchParams.set(name, value);
  }
  // Commas are valid in a query string: `ingvMag=3,8` reads better than `3%2C8`.
  return url.toString().replace(/%2C/g, ",");
}

/** The address with `plugin=ingv-geolibre`, which `setUrlParameters` cannot write: a copied address turns the plugin on. */
export function addressWithPlugin(href: string): string {
  const url = new URL(href);
  if (url.searchParams.get("plugin") === SHARE_PLUGIN_ID) return href;
  url.searchParams.set("plugin", SHARE_PLUGIN_ID);
  return url.toString().replace(/%2C/g, ",");
}

/**
 * Keep the browser's address on the search shown, as Share would write it, so
 * the address can be copied as it is. GeoLibre 3.5.0 writes the plugin's own
 * parameters through `setUrlParameters` and keeps `lat`, `lon`, `zoom` on the
 * map itself; on older hosts the plugin replaces the history entry itself: no
 * new entry, Back is unchanged. Returns the function that stops it and takes
 * the parameters out again.
 */
export function syncAddress(ctl: Controller): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (ctl.state.status !== "done") return;
      const ours = new URL(shareUrl(ctl.shared())).searchParams;
      if (ctl.app.setUrlParameters) {
        ctl.app.setUrlParameters(new URLSearchParams([...ours].filter(([name]) => URL_PARAMETER_NAMES.includes(name))));
        const next = addressWithPlugin(location.href);
        if (next !== location.href) history.replaceState(history.state, "", next);
        return;
      }
      const next = addressWith(location.href, ours);
      if (next !== location.href) history.replaceState(history.state, "", next);
    }, 500);
  };
  const unsubscribe = ctl.subscribe(write);
  const map = ctl.app.getMap?.();
  map?.on("moveend", write);
  write();
  return () => {
    clearTimeout(timer);
    unsubscribe();
    map?.off("moveend", write);
    history.replaceState(history.state, "", addressWith(location.href, null));
  };
}
