/*
 * diagnostics.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents errors and warnings.
 */

import { appendArray } from './collectionUtils';
import { DiagnosticLevel } from './configOptions';
import { Diagnostic, DiagnosticAction, DiagnosticCategory, DiagnosticIdentifier } from './diagnostic';
import { convertOffsetsToRange } from './positionUtils';
import { hashString } from './stringUtils';
import { Range, TextRange } from './textRange';
import { TextRangeCollection } from './textRangeCollection';

// Represents a collection of diagnostics within a file.
export interface FileDiagnostics {
    filePath: string;
    version: number | undefined;
    diagnostics: Diagnostic[];
}

// Creates and tracks a list of diagnostics.
export class DiagnosticSink {
    private _diagnosticList: Diagnostic[];
    private _diagnosticMap: Map<string, Diagnostic>;

    constructor(diagnostics?: Diagnostic[]) {
        this._diagnosticList = diagnostics || [];
        this._diagnosticMap = new Map<string, Diagnostic>();
    }

    fetchAndClear() {
        const prevDiagnostics = this._diagnosticList;
        this._diagnosticList = [];
        this._diagnosticMap.clear();
        return prevDiagnostics;
    }

    addError(message: string, range: Range, id: DiagnosticIdentifier) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Error, message, range, id));
    }

    addWarning(message: string, range: Range, id: DiagnosticIdentifier) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Warning, message, range, id));
    }

    addInformation(message: string, range: Range, id: DiagnosticIdentifier) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Information, message, range, id));
    }

    addUnusedCode(message: string, range: Range, id: DiagnosticIdentifier, action?: DiagnosticAction) {
        const diag = new Diagnostic(DiagnosticCategory.UnusedCode, message, range, id);
        if (action) {
            diag.addAction(action);
        }
        return this.addDiagnostic(diag);
    }

    addUnreachableCode(message: string, range: Range, id: DiagnosticIdentifier, action?: DiagnosticAction) {
        const diag = new Diagnostic(DiagnosticCategory.UnreachableCode, message, range, id);
        if (action) {
            diag.addAction(action);
        }
        return this.addDiagnostic(diag);
    }

    addDeprecated(message: string, range: Range, id: DiagnosticIdentifier, action?: DiagnosticAction) {
        const diag = new Diagnostic(DiagnosticCategory.Deprecated, message, range, id);
        if (action) {
            diag.addAction(action);
        }
        return this.addDiagnostic(diag);
    }

    addDiagnostic(diag: Diagnostic) {
        // Create a unique key for the diagnostic to prevent
        // adding duplicates.
        const key =
            `${diag.range.start.line},${diag.range.start.character}-` +
            `${diag.range.end.line}-${diag.range.end.character}:${hashString(diag.message)}}`;
        if (!this._diagnosticMap.has(key)) {
            this._diagnosticList.push(diag);
            this._diagnosticMap.set(key, diag);
        }
        return diag;
    }

    addDiagnostics(diagsToAdd: Diagnostic[]) {
        appendArray(this._diagnosticList, diagsToAdd);
    }

    getErrors() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Error);
    }

    getWarnings() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Warning);
    }

    getInformation() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Information);
    }

    getUnusedCode() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.UnusedCode);
    }

    getUnreachableCode() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.UnreachableCode);
    }

    getDeprecated() {
        return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Deprecated);
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

    addDiagnosticWithTextRange(level: DiagnosticLevel, message: string, range: TextRange, id: DiagnosticIdentifier) {
        const positionRange = convertOffsetsToRange(range.start, range.start + range.length, this._lines);
        switch (level) {
            case 'error':
                return this.addError(message, positionRange, id);

            case 'warning':
                return this.addWarning(message, positionRange, id);

            case 'information':
                return this.addInformation(message, positionRange, id);

            default:
                throw new Error(`${level} is not expected value`);
        }
    }

    addUnusedCodeWithTextRange(message: string, range: TextRange, id: DiagnosticIdentifier, action?: DiagnosticAction) {
        return this.addUnusedCode(
            message,
            convertOffsetsToRange(range.start, range.start + range.length, this._lines),
            id,
            action
        );
    }

    addUnreachableCodeWithTextRange(
        message: string,
        range: TextRange,
        id: DiagnosticIdentifier,
        action?: DiagnosticAction
    ) {
        return this.addUnreachableCode(
            message,
            convertOffsetsToRange(range.start, range.start + range.length, this._lines),
            id,
            action
        );
    }

    addDeprecatedWithTextRange(message: string, range: TextRange, id: DiagnosticIdentifier, action?: DiagnosticAction) {
        return this.addDeprecated(
            message,
            convertOffsetsToRange(range.start, range.start + range.length, this._lines),
            id,
            action
        );
    }
}
