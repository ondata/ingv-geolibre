import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/geolibre";
import type { GeoLibreAppAPI, GeoLibreRightPanelRegistration } from "../src/lib/geolibre/host-api";
import { PANEL_ID } from "../src/ingv/constants";

const manifest = JSON.parse(readFileSync(join(__dirname, "../geolibre-plugin/plugin.json"), "utf8"));

function createHost() {
  let panel: GeoLibreRightPanelRegistration | null = null;
  const unregister = vi.fn();
  const host = {
    addMapControl: vi.fn(),
    removeMapControl: vi.fn(),
    registerRightPanel: vi.fn((p: GeoLibreRightPanelRegistration) => {
      panel = p;
      return unregister;
    }),
    openRightPanel: vi.fn(() => true),
    closeRightPanel: vi.fn(),
  } as unknown as GeoLibreAppAPI;
  return { host, unregister, panel: () => panel };
}

describe("plugin", () => {
  it("matches its manifest", () => {
    expect(plugin.id).toBe(manifest.id);
    expect(plugin.name).toBe(manifest.name);
    expect(plugin.version).toBe(manifest.version);
  });

  it("opens its panel on activate and removes it on deactivate", () => {
    const { host, unregister, panel } = createHost();
    plugin.activate(host);
    expect(host.openRightPanel).toHaveBeenCalledWith(PANEL_ID);
    const container = document.createElement("div");
    panel()!.render(container);
    expect(container.querySelector(".ingq-panel")).not.toBeNull();
    plugin.deactivate(host);
    expect(host.closeRightPanel).toHaveBeenCalledWith(PANEL_ID);
    expect(unregister).toHaveBeenCalled();
  });

  it("does not activate on a host without right panels", () => {
    const { host } = createHost();
    expect(plugin.activate({ ...host, registerRightPanel: undefined })).toBe(false);
  });
});
