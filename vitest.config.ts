import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules*/**", "**/*.scale.test.ts", "tests/e2e/**", "tests/electron/**"],
    testTimeout: 30000,
  },
});
