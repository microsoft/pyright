/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods relating to cancellation.
 */

import { AbstractCancellationTokenSource, CancellationTokenSource } from 'vscode-jsonrpc';
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

export class DefaultCancellationProvider implements CancellationProvider {
    createCancellationTokenSource(): AbstractCancellationTokenSource {
        return new CancellationTokenSource();
    }
}
