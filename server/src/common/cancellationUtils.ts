/*
 * cancellationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper methods around cancellation
 */

import { CancellationToken, ErrorCodes, ResponseError } from 'vscode-languageserver';

export function throwIfCancellationRequested(token: CancellationToken) {
    if (token.isCancellationRequested) {
        throw new ResponseError(ErrorCodes.RequestCancelled, 'request cancelled');
    }
}
