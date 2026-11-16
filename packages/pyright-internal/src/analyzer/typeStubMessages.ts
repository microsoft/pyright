/*
 * typeStubMessages.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shared user-facing messages for type stub operations.
 */

export function getTypeStubSuccessMessage(kind: TypeStubOperationKind, importName: string): string {
    const prefix = kind === 'partial' ? 'Partial type stub' : 'Type stub';
    return `${prefix} was successfully created for '${importName}'.`;
}

export function getTypeStubCancellationMessage(kind: TypeStubOperationKind, importName: string): string {
    const prefix = kind === 'partial' ? 'Partial type stub creation' : 'Type stub creation';
    return `${prefix} for '${importName}' was canceled`;
}

export function getTypeStubErrorPrefix(kind: TypeStubOperationKind, importName: string): string {
    const stubKind = kind === 'partial' ? 'partial type stub' : 'type stub';
    return `An error occurred when creating ${stubKind} for '${importName}'`;
}

export type TypeStubOperationKind = 'full' | 'partial';
