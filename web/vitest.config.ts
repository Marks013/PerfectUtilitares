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
        lines: 65,
        functions: 59,
        statements: 63,
        branches: 56,
        "src/lib/**/*.ts": {
          lines: 87,
          functions: 90,
          statements: 85,
          branches: 77,
        },
        "src/app/api/**/*.ts": {
          lines: 78,
          functions: 84,
          statements: 72,
          branches: 58,
        },
        "src/components/**/*.{ts,tsx}": {
          lines: 30,
          functions: 28,
          statements: 30,
          branches: 30,
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
