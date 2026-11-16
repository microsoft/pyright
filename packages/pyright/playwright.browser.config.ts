import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    forbidOnly: !!process.env.CI,
    workers: 1,
    reporter: 'list',
    outputDir: './test-results/browser',
    use: {
        browserName: 'chromium',
        channel: process.env.PLAYWRIGHT_CHANNEL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
