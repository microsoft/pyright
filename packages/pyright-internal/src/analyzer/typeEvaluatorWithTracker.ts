/*
 * typeEvaluatorWithTracker.ts
 *
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * This wraps real type evaluator to track performance information such
 * as which type inferring takes most of time, what files are read most of times
 * and etc.
 */

import { LogLevel } from '../common/console';
import { isDebugMode } from '../common/core';
import { LogTracker } from '../common/logTracker';
import { timingStats } from '../common/timing';
import { ImportLookup } from './analyzerFileInfo';
import { TracePrinter } from './tracePrinter';
import { createTypeEvaluator, EvaluatorOptions } from './typeEvaluator';
import { TypeEvaluator } from './typeEvaluatorTypes';

// We don't want to track calls from the type evaluator itself, but only entry points.
export function createTypeEvaluatorWithTracker(
    importLookup: ImportLookup,
    evaluatorOptions: EvaluatorOptions,
    logger: LogTracker,
    printer?: TracePrinter
) {
    let evaluator: TypeEvaluator | undefined = undefined;
    function wrapWithLogger<T extends (...args: any[]) => any>(
        func: T,
        funcName: string = func.name
    ): (...args: Parameters<T>) => ReturnType<T> {
        // Only wrap the function if told to do so and the log level is high enough for it
        // to actually log something.
        if (evaluatorOptions.logCalls && logger.logLevel === LogLevel.Log) {
            return (...args: Parameters<T>): ReturnType<T> => {
                return logger.log(
                    funcName,
                    (s) => {
                        if (funcName === 'importLookup' && args.length > 0) {
                            // This is actually a filename, so special case it.
                            s.add(printer?.printFileOrModuleName(args[0]));
                        } else {
                            // Print all parameters.
                            args.forEach((a) => {
                                s.add(printer?.print(a));
                            });
                        }

                        return timingStats.typeEvaluationTime.timeOperation(func, ...args);
                    },
                    evaluator?.getState,
                    printer,
                    evaluatorOptions.minimumLoggingThreshold,
                    /* logParsingPerf */ true
                );
            };
        } else if (!isDebugMode()) {
            return timingStats.typeEvaluationTime.timeOperation.bind(timingStats.typeEvaluationTime, func);
        } else {
            return func;
        }
    }

    // Wrap all functions with either a logger or a timer.
    importLookup = wrapWithLogger(importLookup, 'importLookup');
    evaluator = createTypeEvaluator(importLookup, evaluatorOptions);
    const keys = Object.keys(evaluator);
    keys.forEach((k) => {
        const entry = (evaluator as any)[k];
        // Wrap all functions with a logger, except for getState as
        // that's used by the logging above.
        // Skip functions beginning with 'is' as they're not interesting to log
        if (typeof entry === 'function' && k !== 'getState' && !k.startsWith('is')) {
            (evaluator as any)[k] = wrapWithLogger(entry);
        }
    });

    return evaluator;
}
