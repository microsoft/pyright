/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods relating to cancellation.
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
    Disposable,
    Emitter,
    ErrorCodes,
    Event,
    ResponseError,
} from 'vscode-languageserver';

class CancellationThrottle {
    private static _lastCheckTimestamp = 0;

    static shouldCheck() {
        // Throttle cancellation checks to one every 5ms. This value
        // was selected through empirical testing. If we call the
        // file system more often than this, type analysis performance
        // is affected. If we call it less often, performance doesn't
        // improve much, but responsiveness suffers.
        const minTimeBetweenChecksInMs = 5;
        const curTimestamp = Date.now().valueOf();
        const timeSinceLastCheck = curTimestamp - this._lastCheckTimestamp;

        if (timeSinceLastCheck >= minTimeBetweenChecksInMs) {
            this._lastCheckTimestamp = curTimestamp;
            return true;
        }

        return false;
    }
}

class FileBasedToken implements CancellationToken {
    protected isCancelled = false;
    private _emitter: Emitter<any> | undefined;

    constructor(readonly cancellationFilePath: string) {}

    public cancel() {
        if (!this.isCancelled) {
            this.isCancelled = true;
            if (this._emitter) {
                this._emitter.fire(undefined);
                this._disposeEmitter();
            }
        }
    }

    get isCancellationRequested(): boolean {
        if (this.isCancelled) {
            return true;
        }

        if (CancellationThrottle.shouldCheck() && this._pipeExists()) {
            // The first time it encounters the cancellation file, it will
            // cancel itself and raise a cancellation event.
            // In this mode, cancel() might not be called explicitly by
            // jsonrpc layer.
            this.cancel();
        }

        return this.isCancelled;
    }

    get onCancellationRequested(): Event<any> {
        if (!this._emitter) {
            this._emitter = new Emitter<any>();
        }
        return this._emitter.event;
    }

    public dispose(): void {
        this._disposeEmitter();
    }

    private _disposeEmitter() {
        if (this._emitter) {
            this._emitter.dispose();
            this._emitter = undefined;
        }
    }

    private _pipeExists(): boolean {
        try {
            fs.statSync(this.cancellationFilePath);
            return true;
        } catch (e) {
            return false;
        }
    }
}

class OwningFileToken extends FileBasedToken {
    private _disposed = false;

    constructor(cancellationFilePath: string) {
        super(cancellationFilePath);
    }

    public cancel() {
        if (!this._disposed && !this.isCancelled) {
            this._createPipe();
            super.cancel();
        }
    }

    get isCancellationRequested(): boolean {
        // Since this object owns the file and it gets created when the
        // token is cancelled, there's no point in checking the pipe.
        return this.isCancelled;
    }

    public dispose(): void {
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
                : new FileBasedToken(this._cancellationFilePath);
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

export class OperationCanceledException extends ResponseError<void> {
    constructor() {
        super(ErrorCodes.RequestCancelled, 'request cancelled');
    }

    static is(e: any) {
        return e.code === ErrorCodes.RequestCancelled;
    }
}

export function throwIfCancellationRequested(token: CancellationToken) {
    if (token.isCancellationRequested) {
        throw new OperationCanceledException();
    }
}

let cancellationFolderName: string | undefined;

export function getCancellationFolderName() {
    return cancellationFolderName;
}

export function setCancellationFolderName(folderName?: string) {
    cancellationFolderName = folderName;
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

    if (receiver && !cancellationFolderName) {
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

let cancellationSourceId = 0;
export function createBackgroundThreadCancellationTokenSource(): AbstractCancellationTokenSource {
    if (!cancellationFolderName) {
        // File-based cancellation is not used.
        // Return regular cancellation token source.
        return new CancellationTokenSource();
    }

    return new FileBasedCancellationTokenSource(
        getCancellationFilePath(cancellationFolderName, `source-${String(cancellationSourceId++)}`),
        true
    );
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

    return new FileBasedToken(cancellationId);
}

export function getCancellationTokenId(token: CancellationToken) {
    return token instanceof FileBasedToken ? token.cancellationFilePath : undefined;
}

export function CancelAfter(...tokens: CancellationToken[]) {
    const source = new CancellationTokenSource();
    const disposables: Disposable[] = [];

    for (const token of tokens) {
        disposables.push(
            token.onCancellationRequested((_) => {
                source.cancel();
            })
        );
    }

    disposables.push(
        source.token.onCancellationRequested((_) => {
            disposables.forEach((d) => d.dispose());
        })
    );

    return source;
}
