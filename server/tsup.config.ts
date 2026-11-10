import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/core/db/migrate-cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace package; keep real npm dependencies external.
  noExternal: ["@momentum/shared"],
});
