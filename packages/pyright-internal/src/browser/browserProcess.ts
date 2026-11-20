// Browser shim for the global process object for use with webpack.

/* eslint-disable @typescript-eslint/no-var-requires */
const browserProcess: NodeJS.Process = require('process/browser');

browserProcess.execArgv = [];

type MemoryUsageFunc = (() => NodeJS.MemoryUsage) & { rss: () => number };

const memoryUsage: MemoryUsageFunc = (() => ({
    external: 0,
    heapTotal: 0,
    heapUsed: 0,
    rss: 0,
    arrayBuffers: 0,
})) as MemoryUsageFunc;

memoryUsage.rss = (): number => 0;

browserProcess.memoryUsage = memoryUsage;
module.exports = browserProcess;
