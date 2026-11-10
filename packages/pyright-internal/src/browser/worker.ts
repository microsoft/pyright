/// <reference lib="webworker" />

import { ensureTomlModuleLoaded } from '../common/tomlUtils';
import { UriEx } from '../common/uri/uriUtils';
import { createBrowserConnection } from './browserConnection';
import { BrowserFileSystem } from './browserFileSystem';
import { BrowserPyrightServer } from './browserServer';

declare const self: DedicatedWorkerGlobalScope;

async function main() {
    await ensureTomlModuleLoaded();
    const connection = createBrowserConnection(self, 'url');
    const distUrl = new URL('./', self.location.href).toString();
    let isReady = false;
    const fileSystem = new BrowserFileSystem('/', [distUrl], [], {
        onReadError: (error) => {
            if (isReady) {
                void connection.sendNotification('pyright/assetLoadFailed', { message: error.message });
            }
        },
        throwOnReadError: true,
    });
    if (!fileSystem.readFileSync(UriEx.file('/typeshed-fallback/stdlib/builtins.pyi'), 'utf8')) {
        throw new Error('The browser distribution is missing builtins.pyi');
    }
    new BrowserPyrightServer(connection, fileSystem);
    await connection.sendNotification('pyright/ready');
    isReady = true;
}

void main().catch((error: unknown) => {
    console.error('Unable to start Pyright browser worker', error);
    self.postMessage({ jsonrpc: '2.0', method: 'pyright/startupFailed', params: { message: String(error) } });
});
