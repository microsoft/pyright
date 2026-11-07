import { expect, test } from '@playwright/test';
import assert from 'assert';
import { once } from 'events';
import { readFile } from 'fs/promises';
import { createServer } from 'http';
import * as path from 'path';

test('the static playground checks edits and restarts its worker without cross-origin isolation', async ({ page }) => {
    const root = path.resolve(__dirname, '../../dist/playground');
    const prefix = '/pyright/playground/';
    const requests: string[] = [];
    const errors: string[] = [];
    const unavailableAssets = new Set<string>();
    const server = createServer((request, response) => {
        if (request.url === '/favicon.ico') {
            response.writeHead(204).end();
            return;
        }
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (request.method !== 'GET' || !pathname.startsWith(prefix)) {
            errors.push(`Unexpected request: ${request.method} ${pathname}`);
            response.writeHead(404).end();
            return;
        }
        requests.push(pathname);
        if (unavailableAssets.has(pathname)) {
            response.writeHead(404).end();
            return;
        }
        const file = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
        if (!file.startsWith(root + path.sep)) {
            errors.push(`Request outside the distribution: ${pathname}`);
            response.writeHead(404).end();
            return;
        }
        const contentType =
            path.extname(file) === '.js'
                ? 'text/javascript'
                : path.extname(file) === '.html'
                ? 'text/html'
                : path.extname(file) === '.json'
                ? 'application/json'
                : 'text/plain';
        void readFile(file).then(
            (content) => {
                response.writeHead(200, { 'Content-Type': contentType }).end(content);
            },
            (error: unknown) => {
                errors.push(`${pathname}: ${String(error)}`);
                response.writeHead(500).end('Unable to read static test asset');
            }
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        assert(address && typeof address !== 'string');
        const origin = `http://127.0.0.1:${address.port}`;
        const url = origin + prefix;
        const workers: string[] = [];
        page.on('worker', (worker) => workers.push(worker.url()));
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/')) {
                errors.push(`Unexpected remote request: ${request.url()}`);
            }
        });

        const diagnostics = page.locator('#diagnostics');
        const status = page.locator('#status');
        const editor = page.locator('#source');
        const response = await page.goto(url);
        expect(response?.status()).toBe(200);
        expect(response?.headers()['cross-origin-opener-policy']).toBeUndefined();
        expect(response?.headers()['cross-origin-embedder-policy']).toBeUndefined();
        expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
        await expect(status).toHaveText('Checked main.py (version 1)');
        await expect(diagnostics).toContainText('reportAssignmentType');
        await expect(diagnostics).not.toContainText('reportMissingImports');
        expect(workers).toEqual([url + 'worker.js']);

        await editor.fill("from pathlib import Path\nname: int = Path('example.py').name\n");
        await expect(diagnostics).toContainText('Type "str" is not assignable');

        await editor.fill("from pathlib import Path\nname: str = Path('example.py').name\nanswer: int = 42\n");
        await expect(diagnostics).toHaveText('No errors.');
        await expect(status).toHaveText(/Checked main\.py \(version \d+\)/);

        const missingImport = 'import definitely_missing_playground_package\n';
        await editor.fill(missingImport);
        await expect(diagnostics).toContainText('reportMissingImports');

        await page.locator('#restart').click();
        await expect(status).toHaveText('Checked main.py (version 1)');
        await expect(diagnostics).toContainText('reportMissingImports');
        await expect(editor).toHaveValue(missingImport);
        expect(workers).toEqual([url + 'worker.js', url + 'worker.js']);
        expect(requests).toContain(prefix + 'typeshed-fallback/stdlib/builtins.pyi');
        expect(requests.some((request) => request.includes('/stdlib/pathlib'))).toBe(true);

        const unavailableAsset = prefix + 'typeshed-fallback/stdlib/json/__init__.pyi';
        unavailableAssets.add(unavailableAsset);
        await editor.fill('import json\nvalue: int = json.dumps({})\n');
        await expect.poll(() => requests).toContain(unavailableAsset);
        await expect(status).toContainText(`Unable to read ${origin}${unavailableAsset}: HTTP 404`);
        await expect(editor).toBeDisabled();
        await expect(diagnostics).toHaveText('Analysis unavailable.');
        expect(errors).toEqual([]);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
        });
    }
});
