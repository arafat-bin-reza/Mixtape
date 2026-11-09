import { defineConfig } from "@playwright/test";
// PORT lets the suite run when 8000 is taken by something else: PORT=8010 npx playwright test
const port = Number(process.env.PORT || 8000);
export default defineConfig({
  testDir: "tests",
  testIgnore: ["**/unit/**"],
  webServer: { command: `node scripts/serve.mjs ${port}`, port, reuseExistingServer: true },
  use: { baseURL: `http://localhost:${port}` },
});
