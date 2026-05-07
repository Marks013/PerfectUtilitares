import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nodeModules = path.resolve(root, "node_modules");
const optionalWasmPackages = [
  ["@emnapi", "core"],
  ["@emnapi", "runtime"],
  ["@emnapi", "wasi-threads"],
  ["@napi-rs", "wasm-runtime"],
  ["@tybys", "wasm-util"],
];

for (const segments of optionalWasmPackages) {
  const target = path.resolve(nodeModules, ...segments);

  if (!target.startsWith(`${nodeModules}${path.sep}`)) {
    throw new Error(`Unsafe cleanup target: ${target}`);
  }

  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${path.relative(root, target)}`);
  }
}
