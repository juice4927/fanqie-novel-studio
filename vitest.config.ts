import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules*/**", "**/*.scale.test.ts", "tests/e2e/**", "tests/electron/**"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/shared/**", "src/lib/**", "src/pages/**"],
      exclude: ["src/main.tsx", "**/*.test.ts", "**/*.test.tsx"],
      reporter: ["text", "html"],
      thresholds: { lines: 43, statements: 43, functions: 60, branches: 75 },
    },
  },
});
