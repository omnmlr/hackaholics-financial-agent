import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["deploy/crypto/aws/tests/**/*.test.ts"],
    fileParallelism: false,
    maxConcurrency: 4,
    hookTimeout: 60000,
    testTimeout: 180000,
  },
});
