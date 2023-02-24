/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods relating to cancellation.
 */

import { AbstractCancellationTokenSource, CancellationTokenSource, Emitter, Event } from 'vscode-jsonrpc';
import { CancellationToken, Disposable, LSPErrorCodes, ResponseError } from 'vscode-languageserver';

import { isDebugMode } from './core';

export interface CancellationProvider {
    createCancellationTokenSource(): AbstractCancellationTokenSource;
}

let cancellationFolderName: string | undefined;

export function getCancellationFolderName() {
    return cancellationFolderName;
}

export function setCancellationFolderName(folderName?: string) {
    cancellationFolderName = folderName;
}

export class OperationCanceledException extends ResponseError<void> {
    constructor() {
        super(LSPErrorCodes.RequestCancelled, 'request cancelled');
    }

    static is(e: any) {
        return e.code === LSPErrorCodes.RequestCancelled;
    }
}

export function throwIfCancellationRequested(token: CancellationToken) {
    // Don't use cancellation in debug mode because it interferes with
    // debugging if requests are cancelled.
    if (!isDebugMode() && token.isCancellationRequested) {
        throw new OperationCanceledException();
    }
}

export function CancelAfter(provider: CancellationProvider, ...tokens: CancellationToken[]) {
    const source = provider.createCancellationTokenSource();
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

export class DefaultCancellationProvider implements CancellationProvider {
    createCancellationTokenSource(): AbstractCancellationTokenSource {
        return new CancellationTokenSource();
    }
}

export function getCancellationTokenId(token: CancellationToken) {
    return token instanceof FileBasedToken ? token.cancellationFilePath : undefined;
}

export class FileBasedToken implements CancellationToken {
    protected isCancelled = false;
    private _emitter: Emitter<any> | undefined;

    constructor(readonly cancellationFilePath: string, private _fs: { statSync(filePath: string): void }) {
        // empty
    }

    cancel() {
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

    dispose(): void {
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
            this._fs.statSync(this.cancellationFilePath);
            return true;
        } catch (e: any) {
            return false;
        }
    }
}

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
