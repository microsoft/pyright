// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* A child-process inspector capture. No ports, source patches, or external debugger service. */
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const report = { id: manifest.id, mapped_breakpoints: [], hits: [], errors: [] };

process.on('exit', () => {
    fs.writeFileSync(manifest.artifact, JSON.stringify(report, null, 2));
});

async function main() {
    const disconnect = await require('./issue_review_inspector.cjs').capture(
        { ...manifest, bundle: path.join(manifest.runtime, 'pyright-internal.js') },
        report
    );
    process.on('beforeExit', disconnect);
    global.__rootDirectory = manifest.runtime;
    process.argv = [
        process.execPath,
        path.join(manifest.runtime, 'pyright.js'),
        '--project',
        manifest.config,
        '--outputjson',
    ];
    require(path.join(manifest.runtime, 'pyright.js'));
}

main().catch((error) => {
    report.errors.push(String(error));
    console.error(error);
    process.exitCode = 2;
});
