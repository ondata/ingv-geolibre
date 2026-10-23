import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Generated output, local scratch files and dependencies are not linted.
    ignores: [
      "tmp/**",
      "dist/**",
      "geolibre-plugin/**",
      "geolibre-plugin-dev/**",
      "coverage/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plugin and config source.
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Node helper scripts (build/packaging/serve) and JS config files.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // Vitest exposes its API as globals (see vitest.config.ts `globals: true`).
    files: ["tests/**/*.ts", "**/*.{test,spec}.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
  },
);
