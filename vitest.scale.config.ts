import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.scale.test.ts"],
    testTimeout: 300000,
  },
});
