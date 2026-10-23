import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Recipe: bundle plugin-local assets into the GeoLibre dist/ folder
// ---------------------------------------------------------------------------
// If your plugin ships static assets (sample datasets, icons, JSON, etc.) that
// it loads over HTTP at runtime, copy them into the built bundle so a baked-in
// or URL-served GeoLibre install can fetch them next to the plugin entry. At
// runtime, resolve their URL with the host's `resolvePluginAssetUrl(pluginId,
// relativePath)` capability (see src/lib/geolibre/host-api.ts) and degrade
// gracefully when it returns null/undefined (e.g. a desktop filesystem install
// where the assets are not reachable over HTTP).
//
// To enable it, uncomment the imports and plugin below, point ASSET_SRC at your
// source directory, and add `bundlePluginAssets()` to the `plugins` array. Set
// `publicDir: false` so Vite does not also copy unrelated public/ files (e.g.
// robots.txt) into the plugin bundle.
//
// import { cp, rm } from "node:fs/promises";
// import type { Plugin } from "vite";
//
// const ASSET_SRC = resolve(__dirname, "public/sample-data");
// const ASSET_DEST = resolve(__dirname, "geolibre-plugin/dist/sample-data");
//
// function bundlePluginAssets(): Plugin {
//   return {
//     name: "geolibre-plugin:bundle-assets",
//     async closeBundle() {
//       await rm(ASSET_DEST, { recursive: true, force: true });
//       await cp(ASSET_SRC, ASSET_DEST, { recursive: true });
//     },
//   };
// }

// The development copy (`--mode dev`) is built in its own folder, with a
// manifest written from the official one: `geolibre-plugin/` is never touched.
// Its id and name must be the ones `src/ingv/constants.ts` takes in that mode.
// GeoLibre injects a plugin's stylesheet globally, so the CSS prefix changes
// too (`ingq-` to `ingqdev-`, classes and variables, in script and stylesheet):
// with the same prefix the rules of the installed registry copy apply to the
// development panel as well.
const DEV_BUNDLE_DIR = resolve(__dirname, "geolibre-plugin-dev");

function writeDevManifest(): Plugin {
  return {
    name: "geolibre-plugin:dev-manifest",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk") file.code = file.code.replaceAll("ingq-", "ingqdev-");
      }
    },
    async closeBundle() {
      const manifest = JSON.parse(await readFile(resolve(__dirname, "geolibre-plugin/plugin.json"), "utf8"));
      const dev = { ...manifest, id: `${manifest.id}-dev`, name: `${manifest.name} (dev)` };
      await mkdir(DEV_BUNDLE_DIR, { recursive: true });
      await writeFile(resolve(DEV_BUNDLE_DIR, "plugin.json"), `${JSON.stringify(dev, null, 2)}\n`);
      // The stylesheet is written after generateBundle: its prefix is changed on disk.
      const stylePath = resolve(DEV_BUNDLE_DIR, "dist/style.css");
      await writeFile(stylePath, (await readFile(stylePath, "utf8")).replaceAll("ingq-", "ingqdev-"));
    },
  };
}

export default defineConfig(({ mode }) => ({
  // publicDir: false, // enable with the bundlePluginAssets() recipe above
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/geolibre.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: mode === "dev" ? "geolibre-plugin-dev/dist" : "geolibre-plugin/dist",
    emptyOutDir: true,
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: () => "style.css",
        // Vite leaves whitespace in an "es" library build; the registry serves the bundle as built.
        minify: true,
      },
    },
    cssCodeSplit: false,
    sourcemap: false,
    minify: true,
  },
  // add bundlePluginAssets() here to enable the recipe above
  plugins: mode === "dev" ? [writeDevManifest()] : [],
}));
