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
import { CancellationId } from 'vscode-jsonrpc';
import {
    AbstractCancellationTokenSource,
    CancellationReceiverStrategy,
    CancellationSenderStrategy,
    CancellationStrategy,
    CancellationToken,
    Emitter,
    ErrorCodes,
    Event,
    ResponseError
} from 'vscode-languageserver';

class GlobalCancellationToken implements CancellationToken {
    private _isCancelled = false;

    constructor(private _cancellationFolderPath: string) {}

    get isCancellationRequested(): boolean {
        if (this._isCancelled) {
            return true;
        }

        if (this._pipeExists()) {
            this._isCancelled = true;
        }

        return this._isCancelled;
    }

    get onCancellationRequested(): Event<any> {
        return Event.None;
    }

    private _pipeExists(): boolean {
        try {
            const result = fs.readdirSync(this._cancellationFolderPath);
            return result && result.length > 0;
        } catch (e) {
            return false;
        }
    }
}

class FileBasedToken implements CancellationToken {
    private _isCancelled = false;
    private _emitter: Emitter<any> | undefined;

    constructor(private _cancellationFilePath: string) {}

    public cancel() {
        if (!this._isCancelled) {
            this._isCancelled = true;
            if (this._emitter) {
                this._emitter.fire(undefined);
                this.dispose();
            }
        }
    }

    get isCancellationRequested(): boolean {
        if (this._isCancelled) {
            return true;
        }

        if (this._pipeExists()) {
            // the first time it encounters cancellation file, it will
            // cancel itself and raise cancellation event.
            // in this mode, cancel() might not be called explicitly by jsonrpc layer
            this.cancel();
        }

        return this._isCancelled;
    }

    get onCancellationRequested(): Event<any> {
        if (!this._emitter) {
            this._emitter = new Emitter<any>();
        }
        return this._emitter.event;
    }

    public dispose(): void {
        if (this._emitter) {
            this._emitter.dispose();
            this._emitter = undefined;
        }
    }

    private _pipeExists(): boolean {
        try {
            fs.statSync(this._cancellationFilePath);
            return true;
        } catch (e) {
            return false;
        }
    }
}

class FileBasedCancellationTokenSource implements AbstractCancellationTokenSource {
    private _token: CancellationToken;
    constructor(private _cancellationFilePath: string) {}

    get token(): CancellationToken {
        if (!this._token) {
            // be lazy and create the token only when
            // actually needed
            this._token = new FileBasedToken(this._cancellationFilePath);
        }
        return this._token;
    }

    cancel(): void {
        if (!this._token) {
            // save an object by returning the default
            // cancelled token when cancellation happens
            // before someone asks for the token
            this._token = CancellationToken.Cancelled;
        } else {
            (this._token as FileBasedToken).cancel();
        }
    }

    dispose(): void {
        if (!this._token) {
            // ensure to initialize with an empty token if we had none
            this._token = CancellationToken.None;
        } else if (this._token instanceof FileBasedToken) {
            // actually dispose
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
        return e.code == ErrorCodes.RequestCancelled;
    }
}

export function throwIfCancellationRequested(token: CancellationToken) {
    if (token.isCancellationRequested) {
        throw new OperationCanceledException();
    }
}

let cancellationFolderName: string;

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
        cancellationFolderName = (receiver as FileCancellationReceiverStrategy).folderName;
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

export function getGlobalCancellationToken() {
    if (!cancellationFolderName) {
        return CancellationToken.None;
    }

    return new GlobalCancellationToken(getCancellationFolderPath(cancellationFolderName));
}
