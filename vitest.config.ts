import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/extension-host/**/*.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/core/types.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        "src/core/documentSnapshot.ts": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90
        },
        "src/core/expressions.ts": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90
        }
      }
    }
  }
});
