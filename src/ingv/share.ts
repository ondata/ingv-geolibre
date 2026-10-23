import type { Controller } from "./controller";
import { el } from "./dom";
import { shareUrl } from "./url-params";

/**
 * A button that shares the search on screen, or the event open, as a GeoLibre
 * web link: through the system share sheet where the browser offers one, else
 * copied to the clipboard. A share sheet closed without sharing is not an error.
 */
export function shareButton(ctl: Controller): HTMLElement {
  const button = el("button", { type: "button", class: "ingq-share", title: "Share this search as a link" }, "Share");
  const show = (text: string) => {
    button.textContent = text;
    setTimeout(() => (button.textContent = "Share"), 3000);
  };
  button.addEventListener("click", async () => {
    const shared = ctl.shared();
    const url = shareUrl(shared);
    const selected = shared.eventId ? ctl.state.selected : null;
    const title = selected ? `INGV: ${selected.properties.place}` : `INGV earthquakes: ${ctl.describe()}`;
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ title, url }))) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Refused (no user gesture, a policy): fall back to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      show("Link copied");
    } catch {
      show("Could not copy");
    }
  });
  return button;
}
