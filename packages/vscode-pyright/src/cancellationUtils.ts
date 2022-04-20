/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods around cancellation
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CancellationId, MessageConnection } from 'vscode-jsonrpc';
import {
    CancellationReceiverStrategy,
    CancellationSenderStrategy,
    CancellationStrategy,
    Disposable,
} from 'vscode-languageserver';

import { randomBytesHex } from 'pyright-internal/common/crypto';

function getCancellationFolderPath(folderName: string) {
    return path.join(os.tmpdir(), 'python-languageserver-cancellation', folderName);
}

function getCancellationFilePath(folderName: string, id: CancellationId) {
    return path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`);
}

function tryRun(callback: () => void) {
    try {
        callback();
    } catch (e: any) {
        /* empty */
    }
}

class FileCancellationSenderStrategy implements CancellationSenderStrategy {
    constructor(readonly folderName: string) {
        const folder = getCancellationFolderPath(folderName)!;
        tryRun(() => fs.mkdirSync(folder, { recursive: true }));
    }

    sendCancellation(_: MessageConnection, id: CancellationId) {
        const file = getCancellationFilePath(this.folderName, id);
        tryRun(() => fs.writeFileSync(file, '', { flag: 'w' }));
        return Promise.resolve();
    }

    cleanup(id: CancellationId): void {
        tryRun(() => fs.unlinkSync(getCancellationFilePath(this.folderName, id)));
    }

    dispose(): void {
        const folder = getCancellationFolderPath(this.folderName);
        tryRun(() => rimraf(folder));

        function rimraf(location: string) {
            const stat = fs.lstatSync(location);
            if (stat) {
                if (stat.isDirectory() && !stat.isSymbolicLink()) {
                    for (const dir of fs.readdirSync(location)) {
                        rimraf(path.join(location, dir));
                    }

                    fs.rmdirSync(location);
                } else {
                    fs.unlinkSync(location);
                }
            }
        }
    }
}

export class FileBasedCancellationStrategy implements CancellationStrategy, Disposable {
    private _sender: FileCancellationSenderStrategy;

    constructor() {
        const folderName = randomBytesHex(21);
        this._sender = new FileCancellationSenderStrategy(folderName);
    }

    get receiver(): CancellationReceiverStrategy {
        return CancellationReceiverStrategy.Message;
    }

    get sender(): CancellationSenderStrategy {
        return this._sender;
    }

    getCommandLineArguments(): string[] {
        return [`--cancellationReceive=file:${this._sender.folderName}`];
    }

    dispose(): void {
        this._sender.dispose();
    }
}
