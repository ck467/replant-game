const { defineConfig } = require('@playwright/test');

// Tests run against their own server on port 3100 (with test hooks enabled and
// the plague timer off) so they never disturb a dev server on port 3000.
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'node server.js',
    port: 3100,
    reuseExistingServer: false,
    env: {
      PORT: '3100',
      TEST_MODE: '1',
      SPREAD_DISABLED: '1',
      ADMIN_KEY: 'test-key',
      STATE_FILE: '/tmp/replant-test-map.json'
    }
  }
});
