import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["electron/main.ts", "electron/preload.ts", "electron/worker.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  removeNodeProtocol: false,
  external: ["electron", "node:sqlite"],
  outDir: "dist-electron",
  sourcemap: true,
  clean: false,
  splitting: false,
  outExtension: () => ({ js: ".cjs" }),
});
