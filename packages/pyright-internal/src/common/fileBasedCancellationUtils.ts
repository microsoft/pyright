/*
 * fileBasedCancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods relating to file-based cancellation.
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
    CancelledTokenId,
    FileBasedToken,
    getCancellationFolderName,
    setCancellationFolderName,
} from './cancellationUtils';
import { Uri } from './uri/uri';
import { UriEx } from './uri/uriUtils';

class StatSyncFromFs {
    statSync(uri: Uri) {
        return fs.statSync(uri.getFilePath());
    }
}

class OwningFileToken extends FileBasedToken {
    private _disposed = false;

    constructor(cancellationId: string) {
        super(cancellationId, new StatSyncFromFs());
    }

    override get isCancellationRequested(): boolean {
        // Since this object owns the file and it gets created when the
        // token is cancelled, there's no point in checking the pipe.
        return this.isCancelled;
    }

    override cancel() {
        if (!this._disposed && !this.isCancelled) {
            this._createPipe();
            super.cancel();
        }
    }

    override dispose(): void {
        this._disposed = true;

        super.dispose();
        this._removePipe();
    }

    private _createPipe() {
        try {
            fs.writeFileSync(this.cancellationFilePath.getFilePath(), '', { flag: 'w' });
        } catch {
            // Ignore the exception.
        }
    }

    private _removePipe() {
        try {
            fs.unlinkSync(this.cancellationFilePath.getFilePath());
        } catch {
            // Ignore the exception.
        }
    }
}

class FileBasedCancellationTokenSource implements AbstractCancellationTokenSource {
    private _token: CancellationToken | undefined;

    constructor(private _cancellationId: string, private _ownFile: boolean = false) {
        // Empty
    }

    get token(): CancellationToken {
        if (!this._token) {
            // Be lazy and create the token only when actually needed.
            this._token = this._ownFile
                ? new OwningFileToken(this._cancellationId)
                : new FileBasedToken(this._cancellationId, new StatSyncFromFs());
        }
        return this._token;
    }

    cancel(): void {
        if (!this._token) {
            // Save an object by returning the default
            // cancelled token when cancellation happens
            // before someone asks for the token.
            this._token = CancellationToken.Cancelled;
        } else if (this._token.isCancellationRequested) {
            // Already cancelled.
            return;
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

export function getCancellationFolderPath(folderName: string) {
    return path.join(os.tmpdir(), 'python-languageserver-cancellation', folderName);
}

function getCancellationFileUri(folderName: string, id: CancellationId): string {
    return UriEx.file(path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`)).toString();
}

// See this issue for why the implements is commented out:
// https://github.com/microsoft/vscode-languageserver-node/issues/1425
class FileCancellationReceiverStrategy {
    // implements IdCancellationReceiverStrategy {
    constructor(readonly folderName: string) {}

    createCancellationTokenSource(id: CancellationId): AbstractCancellationTokenSource {
        return new FileBasedCancellationTokenSource(getCancellationFileUri(this.folderName, id));
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

    if (cancellationId === CancelledTokenId) {
        return CancellationToken.Cancelled;
    }

    return new FileBasedToken(cancellationId, new StatSyncFromFs());
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
            getCancellationFileUri(folderName, `${this._prefix}-${String(cancellationSourceId++)}`),
            /* ownFile */ true
        );
    }
}
