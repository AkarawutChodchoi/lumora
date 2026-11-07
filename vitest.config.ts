import { defineConfig } from "vite";
import path from "node:path";
import { testDatabaseUrl } from "./tests/test-db-url";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside React Server Components; tests call services directly
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // Tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      AI_PROVIDER: "dev",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      PAYMENT_GATEWAY: "mock",
      ALLOW_MOCK_GATEWAY: "1",
      MOCK_WEBHOOK_SECRET: "mock-webhook-secret-for-tests",
      ADMIN_2FA_OPTIONAL: "",
    },
  },
});
