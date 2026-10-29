import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "experiments/**/*.test.ts"],
    environment: "node",
    // 测试不读真实用户主目录：每个用例用临时目录，禁止并发写同一临时根
    restoreMocks: true,
    clearMocks: true,
  },
});
