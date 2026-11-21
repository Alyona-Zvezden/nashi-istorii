import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  workers: 1,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:48971' + (process.env.BASE_PATH || '/nashi-istorii/'),
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run preview -- --host 0.0.0.0 --port 48971 --strictPort',
    url: 'http://127.0.0.1:48971' + (process.env.BASE_PATH || '/nashi-istorii/'),
    reuseExistingServer: !process.env.CI,
  },
});
