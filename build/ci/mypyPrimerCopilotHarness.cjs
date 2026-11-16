/*
 * mypyPrimerCopilotHarness.cjs
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

const { spawnSync } = require('child_process');
const { join } = require('path');
const { verifyMcpTools } = require('./mypyPrimerMcp.ts');

async function main() {
    const counts = await verifyMcpTools(
        process.env.GH_AW_MCP_CONFIG,
        8080,
        { file: process.argv[2], args: [] },
        '/tmp/gh-aw'
    );
    console.log(
        `[primer-mcp-preflight] Native discovery succeeded: ${counts.github} GitHub tools, ${counts.safeoutputs} safe-output tools`
    );
    const result = spawnSync(process.execPath, [join(__dirname, 'copilot_harness.cjs'), ...process.argv.slice(2)], {
        stdio: 'inherit',
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status === null) {
        throw new Error(`Copilot harness terminated by ${result.signal}`);
    }
    process.exitCode = result.status;
}

main().catch((error) => {
    console.error(`[primer-mcp-preflight] ${error.message}`);
    process.exitCode = 1;
});
