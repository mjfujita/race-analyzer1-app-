import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/e2e', timeout: 30000, use: { baseURL: 'http://127.0.0.1:4183', channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort', url: 'http://127.0.0.1:4183/market-preview.html', reuseExistingServer: true },
})
