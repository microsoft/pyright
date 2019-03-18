/*
* diagnostics.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that represents errors and warnings.
*/

export enum DiagnosticCategory {
    Error,
    Warning,
    Informational
}

export interface DiagnosticTextPosition {
    // Both line and column are zero-based
    line: number;
    column: number;
}

export interface DiagnosticTextRange {
    start: DiagnosticTextPosition;
    end: DiagnosticTextPosition;
}

// Represents a range within a particular document.
export interface DocumentTextRange {
    path: string;
    range: DiagnosticTextRange;
}

// Represents a single error or warning.
export class Diagnostic {
    constructor(readonly category: DiagnosticCategory, readonly message: string,
        readonly range?: DiagnosticTextRange) {
    }
}
