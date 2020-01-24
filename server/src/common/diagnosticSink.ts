/*
* diagnostics.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that represents errors and warnings.
*/

import { Diagnostic, DiagnosticCategory } from './diagnostic';
import { convertOffsetsToRange } from './positionUtils';
import { TextRange, LineAndColumnRange } from './textRange';
import { TextRangeCollection } from './textRangeCollection';

// Represents a collection of diagnostics within a file.
export interface FileDiagnostics {
    filePath: string;
    diagnostics: Diagnostic[];
}

// Creates and tracks a list of diagnostics.
export class DiagnosticSink {
    private _diagnostics: Diagnostic[] = [];

    constructor(diagnostics?: Diagnostic[]) {
        this._diagnostics = diagnostics || [];
    }

    fetchAndClear() {
        const prevDiagnostics = this._diagnostics;
        this._diagnostics = [];
        return prevDiagnostics;
    }

    addError(message: string, range: LineAndColumnRange) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Error, message, range));
    }

    addWarning(message: string, range: LineAndColumnRange) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Warning, message, range));
    }

    addUnusedCode(message: string, range: LineAndColumnRange) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.UnusedCode, message, range));
    }

    addDiagnostic(diag: Diagnostic) {
        this._diagnostics.push(diag);
        return diag;
    }

    addDiagnostics(diagsToAdd: Diagnostic[]) {
        this._diagnostics.push(...diagsToAdd);
    }

    getErrors() {
        return this._diagnostics.filter(diag => diag.category === DiagnosticCategory.Error);
    }

    getWarnings() {
        return this._diagnostics.filter(diag => diag.category === DiagnosticCategory.Warning);
    }
}

// Specialized version of DiagnosticSink that works with TextRange objects
// and converts text ranges to line and column numbers.
export class TextRangeDiagnosticSink extends DiagnosticSink {
    private _lines: TextRangeCollection<TextRange>;

    constructor(lines: TextRangeCollection<TextRange>, diagnostics?: Diagnostic[]) {
        super(diagnostics);
        this._lines = lines;
    }

    addErrorWithTextRange(message: string, range: TextRange) {
        return this.addError(message, convertOffsetsToRange(range.start, range.start + range.length, this._lines));
    }

    addWarningWithTextRange(message: string, range: TextRange) {
        return this.addWarning(message, convertOffsetsToRange(range.start, range.start + range.length, this._lines));
    }

    addUnusedCodeWithTextRange(message: string, range: TextRange) {
        return this.addUnusedCode(message, convertOffsetsToRange(range.start, range.start + range.length, this._lines));
    }
}
