import { build } from "esbuild";

await build({
  entryPoints: ["src/workers/ferias-workbook-worker.ts"],
  outfile: "dist/ferias-workbook-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
  logLevel: "warning",
});
