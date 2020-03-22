/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods around cancellation
 */

import { CancellationToken, ErrorCodes, ResponseError } from 'vscode-languageserver';

export class OperationCanceledException extends ResponseError<void> {
    constructor() {
        super(ErrorCodes.RequestCancelled, 'request cancelled');
    }
}

export function throwIfCancellationRequested(token: CancellationToken) {
    if (token.isCancellationRequested) {
        throw new OperationCanceledException();
    }
}
