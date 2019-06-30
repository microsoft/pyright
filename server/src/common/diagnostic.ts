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
    UnusedCode
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

// Helps to build additional information that can be appended to a diagnostic
// message. It supports hierarchical information and flexible formatting.
export class DiagnosticAddendum {
    private _messages: string[] = [];
    private _childAddenda: DiagnosticAddendum[] = [];

    addMessage(message: string) {
        this._messages.push(message);
    }

    // Create a new (nested) addendum to which messages can be added.
    createAddendum() {
        let newAddendum = new DiagnosticAddendum();
        this._addAddendum(newAddendum);
        return newAddendum;
    }

    getString(maxDepth = 5, maxLineCount = 5): string {
        let lines = this._getLinesRecursive(maxDepth);

        if (lines.length > maxLineCount) {
            lines = lines.slice(0, maxLineCount);
            lines.push('...');
        }

        let text = lines.join('\n');
        if (text.length > 0) {
            return '\n' + text;
        }

        return '';
    }

    private _addAddendum(addendum: DiagnosticAddendum) {
        this._childAddenda.push(addendum);
    }

    private _getLinesRecursive(maxDepth: number): string[] {
        if (maxDepth <= 0) {
            return [];
        }

        let childLines: string[] = [];
        for (let addendum of this._childAddenda) {
            childLines.push(...addendum._getLinesRecursive(maxDepth - 1));
        }

        // Prepend indentation for redability. Skip if there are no
        // messages at this level.
        const extraSpace = this._messages.length > 0 ? '  ' : '';
        return this._messages.concat(childLines).map(line => extraSpace + line);
    }
}
