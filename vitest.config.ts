import { defineConfig } from "vite";
import path from "node:path";
import { testDatabaseUrl, testDirectUrl } from "./tests/test-db-url";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // Tests share one database schema; run files sequentially.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      DIRECT_URL: testDirectUrl(),
      SESSION_SECRET: "test-secret-test-secret-test-secret-0123456789",
      AI_PROVIDER: "dev",
      ANTHROPIC_API_KEY: "",
      PAYMENT_PROVIDER: "testpay",
      PAYMENT_WEBHOOK_SECRET: "whsec_test_secret",
    },
  },
});
