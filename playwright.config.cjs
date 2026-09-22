const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', timeout: 45000, workers: 1,
  use: {
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      // The test page uses a synthetic public origin and a loopback signaling server.
      args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--disable-features=LocalNetworkAccessChecks']
    }
  },
  webServer: {command: 'node tests/signaling.cjs', port: 9000, reuseExistingServer: false}
});
