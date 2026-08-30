// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/contract/**/*.test.ts",
    ],
    exclude: ["tests/slow/**", "tests/regression/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/commands/**", "src/output/**", "src/mcp/**"],
      thresholds: {
        lines: 60,
        "src/compat/**": { lines: 80 },
      },
    },
  },
});
