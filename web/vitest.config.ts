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
        "src/components/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/generated/**",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
      ],
      thresholds: {
        lines: 59,
        functions: 51,
        statements: 56,
        branches: 47,
        "src/lib/**/*.ts": {
          lines: 80,
          functions: 82,
          statements: 78,
          branches: 67,
        },
        "src/app/api/**/*.ts": {
          lines: 72,
          functions: 80,
          statements: 67,
          branches: 51,
        },
        "src/components/**/*.{ts,tsx}": {
          lines: 17,
          functions: 13,
          statements: 16,
          branches: 16,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
