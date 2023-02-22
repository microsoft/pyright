/*
 * fileBasedCancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods relating to file based cancellation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CancellationId, CancellationTokenSource } from 'vscode-jsonrpc';
import {
    AbstractCancellationTokenSource,
    CancellationReceiverStrategy,
    CancellationSenderStrategy,
    CancellationStrategy,
    CancellationToken,
} from 'vscode-languageserver';

import {
    CancellationProvider,
    FileBasedToken,
    getCancellationFolderName,
    setCancellationFolderName,
} from './cancellationUtils';

class OwningFileToken extends FileBasedToken {
    private _disposed = false;

    constructor(cancellationFilePath: string) {
        super(cancellationFilePath, fs);
    }

    override cancel() {
        if (!this._disposed && !this.isCancelled) {
            this._createPipe();
            super.cancel();
        }
    }

    override get isCancellationRequested(): boolean {
        // Since this object owns the file and it gets created when the
        // token is cancelled, there's no point in checking the pipe.
        return this.isCancelled;
    }

    override dispose(): void {
        this._disposed = true;

        super.dispose();
        this._removePipe();
    }

    private _createPipe() {
        try {
            fs.writeFileSync(this.cancellationFilePath, '', { flag: 'w' });
        } catch {
            // Ignore the exception.
        }
    }

    private _removePipe() {
        try {
            fs.unlinkSync(this.cancellationFilePath);
        } catch {
            // Ignore the exception.
        }
    }
}

class FileBasedCancellationTokenSource implements AbstractCancellationTokenSource {
    private _token: CancellationToken | undefined;
    constructor(private _cancellationFilePath: string, private _ownFile: boolean = false) {}

    get token(): CancellationToken {
        if (!this._token) {
            // Be lazy and create the token only when actually needed.
            this._token = this._ownFile
                ? new OwningFileToken(this._cancellationFilePath)
                : new FileBasedToken(this._cancellationFilePath, fs);
        }
        return this._token;
    }

    cancel(): void {
        if (!this._token) {
            // Save an object by returning the default
            // cancelled token when cancellation happens
            // before someone asks for the token.
            this._token = CancellationToken.Cancelled;
        } else {
            (this._token as FileBasedToken).cancel();
        }
    }

    dispose(): void {
        if (!this._token) {
            // Make sure to initialize with an empty token if we had none.
            this._token = CancellationToken.None;
        } else if (this._token instanceof FileBasedToken) {
            // Actually dispose.
            this._token.dispose();
        }
    }
}

function getCancellationFolderPath(folderName: string) {
    return path.join(os.tmpdir(), 'python-languageserver-cancellation', folderName);
}

function getCancellationFilePath(folderName: string, id: CancellationId) {
    return path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`);
}

class FileCancellationReceiverStrategy implements CancellationReceiverStrategy {
    constructor(readonly folderName: string) {}

    createCancellationTokenSource(id: CancellationId): AbstractCancellationTokenSource {
        return new FileBasedCancellationTokenSource(getCancellationFilePath(this.folderName, id));
    }
}

export function getCancellationStrategyFromArgv(argv: string[]): CancellationStrategy {
    let receiver: CancellationReceiverStrategy | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--cancellationReceive') {
            receiver = createReceiverStrategyFromArgv(argv[i + 1]);
        } else {
            const args = arg.split('=');
            if (args[0] === '--cancellationReceive') {
                receiver = createReceiverStrategyFromArgv(args[1]);
            }
        }
    }

    if (receiver && !getCancellationFolderName()) {
        setCancellationFolderName((receiver as FileCancellationReceiverStrategy).folderName);
    }

    receiver = receiver ? receiver : CancellationReceiverStrategy.Message;
    return { receiver, sender: CancellationSenderStrategy.Message };

    function createReceiverStrategyFromArgv(arg: string): CancellationReceiverStrategy | undefined {
        const folderName = extractCancellationFolderName(arg);
        return folderName ? new FileCancellationReceiverStrategy(folderName) : undefined;
    }

    function extractCancellationFolderName(arg: string): string | undefined {
        const fileRegex = /^file:(.+)$/;
        const folderName = arg.match(fileRegex);
        return folderName ? folderName[1] : undefined;
    }
}

export function disposeCancellationToken(token: CancellationToken) {
    if (token instanceof FileBasedToken) {
        token.dispose();
    }
}

export function getCancellationTokenFromId(cancellationId: string) {
    if (!cancellationId) {
        return CancellationToken.None;
    }

    return new FileBasedToken(cancellationId, fs);
}

let cancellationSourceId = 0;
export class FileBasedCancellationProvider implements CancellationProvider {
    constructor(private _prefix: string) {
        // empty
    }

    createCancellationTokenSource(): AbstractCancellationTokenSource {
        const folderName = getCancellationFolderName();
        if (!folderName) {
            // File-based cancellation is not used.
            // Return regular cancellation token source.
            return new CancellationTokenSource();
        }

        return new FileBasedCancellationTokenSource(
            getCancellationFilePath(folderName, `${this._prefix}-${String(cancellationSourceId++)}`),
            /* ownFile */ true
        );
    }
}
