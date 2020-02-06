/*
 * debug.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various debug helper methods to show user friendly debugging info
*/

import { stableSort } from './collectionUtils';
import { AnyFunction, compareValues, hasProperty } from './core';

export function assert(expression: boolean, message?: string,
    verboseDebugInfo?: string | (() => string), stackCrawlMark?: AnyFunction): void {

    if (!expression) {
        if (verboseDebugInfo) {
            message += '\r\nVerbose Debug Information: ' + (typeof verboseDebugInfo === 'string' ? verboseDebugInfo : verboseDebugInfo());
        }
        fail(message ? 'False expression: ' + message : 'False expression.', stackCrawlMark || assert);
    }
}

export function fail(message?: string, stackCrawlMark?: AnyFunction): never {
    // debugger;
    const e = new Error(message ? `Debug Failure. ${ message }` : 'Debug Failure.');
    if ((Error as any).captureStackTrace) {
        (Error as any).captureStackTrace(e, stackCrawlMark || fail);
    }
    throw e;
}

export function assertDefined<T>(value: T | null | undefined, message?: string): T {
    if (value === undefined || value === null) { return fail(message); }
    return value;
}

export function assertEachDefined<T, A extends readonly T[]>(value: A, message?: string): A {
    for (const v of value) {
        assertDefined(v, message);
    }
    return value;
}

export function assertNever(member: never, message = 'Illegal value:', stackCrawlMark?: AnyFunction): never {
    const detail = JSON.stringify(member);
    return fail(`${ message } ${ detail }`, stackCrawlMark || assertNever);
}

export function getFunctionName(func: AnyFunction) {
    if (typeof func !== 'function') {
        return '';
    } else if (hasProperty(func, 'name')) {
        return (func as any).name;
    } else {
        const text = Function.prototype.toString.call(func);
        const match = /^function\s+([\w$]+)\s*\(/.exec(text);
        return match ? match[1] : '';
    }
}

/**
 * Formats an enum value as a string for debugging and debug assertions.
 */
export function formatEnum(value = 0, enumObject: any, isFlags?: boolean) {
    const members = getEnumMembers(enumObject);
    if (value === 0) {
        return members.length > 0 && members[0][0] === 0 ? members[0][1] : '0';
    }
    if (isFlags) {
        let result = '';
        let remainingFlags = value;
        for (const [enumValue, enumName] of members) {
            if (enumValue > value) {
                break;
            }
            if (enumValue !== 0 && enumValue & value) {
                result = `${ result }${ result ? '|' : '' }${ enumName }`;
                remainingFlags &= ~enumValue;
            }
        }
        if (remainingFlags === 0) {
            return result;
        }
    } else {
        for (const [enumValue, enumName] of members) {
            if (enumValue === value) {
                return enumName;
            }
        }
    }
    return value.toString();
}

function getEnumMembers(enumObject: any) {
    const result: [number, string][] = [];
    for (const name of Object.keys(enumObject)) {
        const value = enumObject[name];
        if (typeof value === 'number') {
            result.push([value, name]);
        }
    }

    return stableSort<[number, string]>(result, (x, y) => compareValues(x[0], y[0]));
}
