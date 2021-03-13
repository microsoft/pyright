/*
 * symbolNameUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Static methods that apply to symbols or symbol names.
 */

const _constantRegEx = /^[A-Z0-9_]+$/;
const _underscoreOnlyRegEx = /^[_]+$/;
const _camelCaseRegEx = /^_{0,2}[A-Z][A-Za-z0-9_]+$/;

// Private symbol names start with a double underscore.
export function isPrivateName(name: string) {
    return name.length > 2 && name.startsWith('__') && !name.endsWith('__');
}

// Protected symbol names start with a single underscore.
export function isProtectedName(name: string) {
    return name.length > 1 && name.startsWith('_') && !name.startsWith('__');
}

export function isPrivateOrProtectedName(name: string) {
    return isPrivateName(name) || isProtectedName(name);
}

// "Dunder" names start and end with two underscores.
export function isDunderName(name: string) {
    return name.length > 4 && name.startsWith('__') && name.endsWith('__');
}

// "Single Dunder" names start and end with single underscores.
export function isSingleDunderName(name: string) {
    return name.length > 2 && name.startsWith('_') && name.endsWith('_');
}

// Constants are all-caps with possible numbers and underscores.
export function isConstantName(name: string) {
    return !!name.match(_constantRegEx) && !name.match(_underscoreOnlyRegEx);
}

// Type aliases are CamelCase with possible numbers and underscores.
export function isTypeAliasName(name: string) {
    return !!name.match(_camelCaseRegEx);
}

export function isPublicConstantOrTypeAlias(name: string) {
    return !isPrivateOrProtectedName(name) && (isConstantName(name) || isTypeAliasName(name));
}
