/*
 * pyrightWatch.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Exercises real filesystem events and displayed diagnostics in a CLI subprocess.
 */

import assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.setTimeout(60_000);

test.each(['file', 'directory'])('watch clears diagnostics after native %s deletion', async (kind) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-watch-'));
    const bundle = path.resolve(__dirname, '../../out/cliWatch.bundle.js');
    assert(fs.existsSync(bundle), 'Run webpack:testserver before the CLI watch tests');
    const deletedDir = path.join(root, 'deleted');
    fs.mkdirSync(deletedDir);
    const deletedFile = path.join(deletedDir, 'removed.py');
    const survivor = path.join(root, 'survivor.py');
    fs.writeFileSync(deletedFile, 'removed: int = "removed-marker"\n');
    fs.writeFileSync(survivor, 'survivor: int = "survivor-before"\n');
    fs.writeFileSync(
        path.join(root, 'pyrightconfig.json'),
        JSON.stringify({
            include: ['.'],
            pythonVersion: '3.13',
            typeCheckingMode: 'basic',
            typeshedPath: path.resolve(__dirname, '../../typeshed-fallback'),
        })
    );

    const child = spawn(process.execPath, [bundle, '--project', root, '--watch'], {
        cwd: root,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    assert(child.stdout && child.stderr);
    let output = '';
    let pending = '';
    let failure: Error | undefined;
    let sourceWatcherReady = false;
    child.on('message', (message: { kind?: string; paths?: string[] }) => {
        if (message.kind === 'watcher-ready' && message.paths?.some((item) => path.resolve(item) === root)) {
            sourceWatcherReady = true;
        }
    });
    const reports: string[] = [];
    child.stdout.on('data', (data: Buffer) => {
        pending += data.toString();
        const marker = 'Watching for file changes...';
        let index: number;
        while ((index = pending.indexOf(marker)) >= 0) {
            reports.push(pending.slice(0, index));
            pending = pending.slice(index + marker.length);
        }
    });
    child.stderr.on('data', (data: Buffer) => (output += data.toString()));
    child.on('error', (error) => (failure = error));
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));

    async function waitForReport(after: number, predicate: (report: string) => boolean) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
            if (failure || child.exitCode !== null || child.signalCode !== null) {
                throw failure ?? new Error(`CLI exited before the next report: ${output}`);
            }
            const match = reports.slice(after).find(predicate);
            if (match !== undefined && sourceWatcherReady) {
                return match;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`No matching watch report. Reports: ${JSON.stringify(reports)}; stderr: ${output}`);
    }

    try {
        await waitForReport(0, (report) => report.includes('2 errors') && report.includes('removed-marker'));
        const afterDelete = reports.length;
        if (kind === 'file') {
            fs.unlinkSync(deletedFile);
        } else {
            fs.rmSync(deletedDir, { recursive: true });
        }
        const report = await waitForReport(afterDelete, (item) => item.includes('1 error'));
        assert(!report.includes('removed.py'), report);
        assert(!report.includes('removed-marker'), report);
        assert(report.includes('survivor.py:1:17'), report);
        assert(report.includes('reportAssignmentType'), report);
        assert(report.includes('survivor-before'), report);

        const afterEdit = reports.length;
        fs.writeFileSync(survivor, 'survivor: int = "survivor-after"\n');
        const edited = await waitForReport(afterEdit, (item) => item.includes('survivor-after'));
        assert(edited.includes('1 error'), edited);
        assert(edited.includes('reportAssignmentType'), edited);
        assert(!edited.includes('removed.py'), edited);
    } finally {
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
        try {
            await closed;
        } finally {
            clearTimeout(timer);
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});
