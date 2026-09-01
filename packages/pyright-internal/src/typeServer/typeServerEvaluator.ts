/*
 * typeServerEvaluator.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * The type server answers type queries with Pyright's ordinary synchronous `TypeEvaluator`.
 * It needs exactly one capability beyond the stock evaluator: access to the snapshot's symbol
 * lookup. This module defines that thin extension (`ITypeServerEvaluator`) and a factory that
 * layers it onto the program's current evaluator.
 *
 * Cancellation works exactly as it does everywhere else in Pyright: the evaluator polls the
 * active cancellation token via `runWithCancellationToken` / `throwIfCancellationRequested`,
 * so a long-running synchronous query can still be interrupted in the middle of a request.
 */

import { Program } from '../analyzer/program';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';

import { ISymbolLookup } from './programTypes';

export interface ITypeServerEvaluator extends TypeEvaluator {
    getSymbolLookup(): ISymbolLookup;
}

/**
 * Build an `ITypeServerEvaluator` backed by the `Program`'s synchronous `TypeEvaluator`.
 *
 * Pyright's evaluator is a closure-backed object whose methods don't depend on `this`, so we
 * can prototype-delegate to it and add `getSymbolLookup` without copying every method. The
 * evaluator is resolved from `program.evaluator` at creation time; callers create a fresh
 * evaluator per request (the program recreates its evaluator when configuration or imports
 * change), so the captured reference always matches the snapshot being queried.
 */
export function createTypeServerEvaluator(program: Program, symbolLookup: ISymbolLookup): ITypeServerEvaluator {
    const evaluator = program.evaluator;
    if (!evaluator) {
        throw new Error('Type evaluator is not available for the current program.');
    }

    const wrapper = Object.create(evaluator) as ITypeServerEvaluator;
    wrapper.getSymbolLookup = () => symbolLookup;
    return wrapper;
}
