import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  webServer: { command: "python3 -m http.server 8000", port: 8000, reuseExistingServer: true },
  use: { baseURL: "http://localhost:8000" },
});
