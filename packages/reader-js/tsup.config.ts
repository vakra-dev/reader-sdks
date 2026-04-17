import { defineConfig } from "tsup";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  entry: ["src/index.ts"],
  // Dual-publish ESM + CJS so both modern bundlers and legacy Node/CommonJS
  // consumers can import the SDK without transpilation hoops.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node18",
  sourcemap: true,
  // Copy README into dist so `npm publish` (which ships the `dist/` folder
  // via the `files` array) doesn't publish a package with no readme.
  async onSuccess() {
    await copyFile("README.md", "dist/README.md").catch(() => {});
  },
});
