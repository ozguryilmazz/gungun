import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Entegrasyon testleri aynı veritabanını paylaşır
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
