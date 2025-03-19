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
import { Uri } from './uri/uri';
import { UriEx } from './uri/uriUtils';

export interface CancellationProvider {
    createCancellationTokenSource(): AbstractCancellationTokenSource;
}

export namespace CancellationProvider {
    export function is(value: any): value is CancellationProvider {
        return value && !!value.createCancellationTokenSource;
    }
}

let cancellationFolderName: string | undefined;

export function getCancellationFolderName() {
    return cancellationFolderName;
}

export function setCancellationFolderName(folderName?: string) {
    cancellationFolderName = folderName;
}

export function invalidateTypeCacheIfCanceled<T>(cb: () => T): T {
    try {
        return cb();
    } catch (e: any) {
        if (OperationCanceledException.is(e)) {
            // If the work was canceled before the function type was updated, the
            // function type in the type cache is in an invalid, partially-constructed state.
            e.isTypeCacheInvalid = true;
        }

        throw e;
    }
}

export class OperationCanceledException extends ResponseError<void> {
    // If true, indicates that the cancellation may have left the type cache
    // in an invalid state.
    isTypeCacheInvalid = false;

    constructor() {
        super(LSPErrorCodes.RequestCancelled, 'request cancelled');
    }

    static is(e: any): e is OperationCanceledException {
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

const nullDisposable = Disposable.create(() => {});

export function onCancellationRequested(token: CancellationToken, func: (i: any) => void): Disposable {
    try {
        return token.onCancellationRequested(func);
    } catch {
        // Certain cancellation token implementations, like SharedArrayCancellation
        // (https://github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/src/common/sharedArrayCancellation.ts#L70),
        // do not support the `onCancellationRequested` method. In such cases, proceed to the next token.
        return nullDisposable;
    }
}

export function CancelAfter(provider: CancellationProvider, ...tokens: CancellationToken[]) {
    const source = provider.createCancellationTokenSource();
    setupCombinedTokensFor(source, ...tokens);
    return source;
}

export function createCombinedToken(...tokens: CancellationToken[]): CancellationToken {
    const source = new CancellationTokenSource();
    setupCombinedTokensFor(source, ...tokens);
    return source.token;
}

export function setupCombinedTokensFor(source: AbstractCancellationTokenSource, ...tokens: CancellationToken[]) {
    // If any token is already cancelled, cancel immediately.
    for (const token of tokens) {
        if (!token.isCancellationRequested) {
            continue;
        }

        source.cancel();
        return;
    }

    const disposables: Disposable[] = [];
    for (const token of tokens) {
        disposables.push(
            onCancellationRequested(token, () => {
                source.cancel();
            })
        );
    }

    disposables.push(
        onCancellationRequested(source.token, () => {
            disposables.forEach((d) => d.dispose());
        })
    );
}

export class DefaultCancellationProvider implements CancellationProvider {
    createCancellationTokenSource(): AbstractCancellationTokenSource {
        return new CancellationTokenSource();
    }
}

export const CancelledTokenId = 'cancelled';

export function getCancellationTokenId(token: CancellationToken): string | undefined {
    if (token === CancellationToken.Cancelled) {
        // Ensure the token is recognized as already cancelled. Returning `undefined` would be interpreted as CancellationToken.None.
        return CancelledTokenId;
    }

    return token instanceof FileBasedToken ? token.id : undefined;
}

export class FileBasedToken implements CancellationToken {
    protected readonly cancellationFilePath: Uri;

    protected isCancelled = false;
    private _emitter: Emitter<any> | undefined;

    constructor(cancellationId: string, private _fs: { statSync(fileUri: Uri): void }) {
        // Normally, `UriEx` is intended for use in tests only. However, this is a special case
        // because we construct the cancellationId and control the file casing.
        this.cancellationFilePath = UriEx.file(cancellationId);
    }

    get id(): string {
        return this.cancellationFilePath.toString();
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

    cancel() {
        if (!this.isCancelled) {
            this.isCancelled = true;
            if (this._emitter) {
                this._emitter.fire(undefined);
                this._disposeEmitter();
            }
        }
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

export class CancellationThrottle {
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

export async function raceCancellation<T>(token?: CancellationToken, ...promises: Promise<T>[]): Promise<T> {
    if (!token) {
        return Promise.race(promises);
    }
    if (token.isCancellationRequested) {
        throw new OperationCanceledException();
    }

    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            return reject(new OperationCanceledException());
        }
        const disposable = onCancellationRequested(token, () => {
            disposable.dispose();
            reject(new OperationCanceledException());
        });
        Promise.race(promises)
            .then(resolve, reject)
            .finally(() => disposable.dispose());
    });
}
