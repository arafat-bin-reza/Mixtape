import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testIgnore: ["**/unit/**"],
  webServer: { command: "node scripts/serve.mjs 8000", port: 8000, reuseExistingServer: true },
  use: { baseURL: "http://localhost:8000" },
});
