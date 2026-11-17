/*
 * missingBindingMetadata.ts
 *
 * Error thrown when a parse tree that the program is tracking has no published
 * binder file info. Program.runWithBindingRecovery recognizes it to rebind the
 * same current tree once; any other caller sees an ordinary error.
 */

import { ParseNode } from '../parser/parseNodes';

export class MissingBindingMetadataError extends Error {
    constructor(readonly node: ParseNode) {
        super('Binding metadata is unavailable for a parse tree');
        this.name = 'MissingBindingMetadataError';
    }

    static is(e: unknown): e is MissingBindingMetadataError {
        return e instanceof MissingBindingMetadataError;
    }
}
