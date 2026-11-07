import { build } from "esbuild";

await build({
  entryPoints: ["src/workers/unimed-workbook-worker.ts"],
  outfile: "dist/unimed-workbook-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
  logLevel: "warning",
});
