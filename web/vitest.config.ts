import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/components/**/*.ts",
      ],
      exclude: [
        "src/generated/**",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 80,
        statements: 70,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
