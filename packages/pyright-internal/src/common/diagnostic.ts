/*
 * diagnostics.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents errors and warnings.
 */

import { Commands } from '../commands/commands';
import { appendArray } from './collectionUtils';
import { DiagnosticLevel } from './configOptions';
import { Range, TextRange } from './textRange';
import { Uri } from './uri/uri';

export const defaultMaxDiagnosticDepth = 5;
export const defaultMaxDiagnosticLineCount = 8;
const maxRecursionCount = 64;

// Corresponds to the CommentTaskPriority enum at https://devdiv.visualstudio.com/DefaultCollection/DevDiv/_git/VS?path=src/env/shell/PackageFramework/Framework/CommentTaskPriority.cs
export enum TaskListPriority {
    High = 'High',
    Normal = 'Normal',
    Low = 'Low',
}

export interface TaskListToken {
    text: string;
    priority: TaskListPriority;
}

export const enum ActionKind {
    RenameShadowedFileAction = 'renameShadowedFile',
}

export const enum DiagnosticCategory {
    Error,
    Warning,
    Information,
    UnusedCode,
    UnreachableCode,
    Deprecated,
    TaskItem,
}

export function convertLevelToCategory(level: DiagnosticLevel) {
    switch (level) {
        case 'error':
            return DiagnosticCategory.Error;

        case 'warning':
            return DiagnosticCategory.Warning;

        case 'information':
            return DiagnosticCategory.Information;

        default:
            throw new Error(`${level} is not expected`);
    }
}

export interface DiagnosticAction {
    action: string;
}

export interface DiagnosticWithinFile {
    uri: Uri;
    diagnostic: Diagnostic;
}

export interface CreateTypeStubFileAction extends DiagnosticAction {
    action: Commands.createTypeStub;
    moduleName: string;
}

export interface RenameShadowedFileAction extends DiagnosticAction {
    action: ActionKind.RenameShadowedFileAction;
    oldUri: Uri;
    newUri: Uri;
}

export interface DiagnosticRelatedInfo {
    message: string;
    uri: Uri;
    range: Range;
    priority: TaskListPriority;
}

export namespace DiagnosticRelatedInfo {
    export function toJsonObj(info: DiagnosticRelatedInfo): any {
        return {
            message: info.message,
            uri: info.uri.toJsonObj(),
            range: info.range,
            priority: info.priority,
        };
    }

    export function fromJsonObj(obj: any): DiagnosticRelatedInfo {
        return {
            message: obj.message,
            uri: Uri.fromJsonObj(obj.uri),
            range: obj.range,
            priority: obj.priority,
        };
    }
}

// Represents a single error or warning.
export class Diagnostic {
    private _actions: DiagnosticAction[] | undefined;
    private _rule: string | undefined;
    private _relatedInfo: DiagnosticRelatedInfo[] = [];
    private _data: any | null = null;

    constructor(
        readonly category: DiagnosticCategory,
        readonly message: string,
        readonly range: Range,
        readonly priority: TaskListPriority = TaskListPriority.Normal
    ) {}

    toJsonObj() {
        return {
            category: this.category,
            message: this.message,
            range: this.range,
            priority: this.priority,
            actions: this._actions,
            rule: this._rule,
            data: this._data,
            relatedInfo: this._relatedInfo.map((info) => DiagnosticRelatedInfo.toJsonObj(info)),
        };
    }

    static fromJsonObj(obj: any) {
        const diag = new Diagnostic(obj.category, obj.message, obj.range, obj.priority);
        diag._actions = obj.actions;
        diag._rule = obj.rule;
        diag._relatedInfo = obj.relatedInfo.map((info: any) => DiagnosticRelatedInfo.fromJsonObj(info));
        diag._data = obj.data;
        return diag;
    }

    addAction(action: DiagnosticAction) {
        if (this._actions === undefined) {
            this._actions = [action];
        } else {
            this._actions.push(action);
        }
    }

    setData(data: any) {
        this._data = data;
    }

    getData(): any | null {
        return this._data;
    }

    getActions() {
        return this._actions;
    }

    setRule(rule: string) {
        this._rule = rule;
    }

    getRule() {
        return this._rule;
    }

    addRelatedInfo(message: string, fileUri: Uri, range: Range, priority: TaskListPriority = TaskListPriority.Normal) {
        this._relatedInfo.push({ uri: fileUri, message, range, priority });
    }

    getRelatedInfo() {
        return this._relatedInfo;
    }
}

// Compares two diagnostics by location for sorting.
export function compareDiagnostics(d1: Diagnostic, d2: Diagnostic) {
    if (d1.range.start.line < d2.range.start.line) {
        return -1;
    } else if (d1.range.start.line > d2.range.start.line) {
        return 1;
    }

    if (d1.range.start.character < d2.range.start.character) {
        return -1;
    } else if (d1.range.start.character > d2.range.start.character) {
        return 1;
    }

    return 0;
}

// Helps to build additional information that can be appended to a diagnostic
// message. It supports hierarchical information and flexible formatting.
export class DiagnosticAddendum {
    private _messages: string[] = [];
    private _childAddenda: DiagnosticAddendum[] = [];

    // The nest level is accurate only for the common case where all
    // addendum are created using createAddendum. This is an upper bound.
    // The actual nest level may be smaller.
    private _nestLevel: number | undefined;

    // Addenda normally don't have their own ranges, but there are cases
    // where we want to track ranges that can influence the range of the
    // diagnostic.
    private _range: TextRange | undefined;

    addMessage(message: string) {
        this._messages.push(message);
    }

    addMessageMultiline(message: string) {
        message.split('\n').forEach((line) => {
            this._messages.push(line);
        });
    }

    addTextRange(range: TextRange) {
        this._range = range;
    }

    // Create a new (nested) addendum to which messages can be added.
    createAddendum() {
        const newAddendum = new DiagnosticAddendum();
        newAddendum._nestLevel = (this._nestLevel ?? 0) + 1;
        this.addAddendum(newAddendum);
        return newAddendum;
    }

    getString(maxDepth = defaultMaxDiagnosticDepth, maxLineCount = defaultMaxDiagnosticLineCount): string {
        let lines = this._getLinesRecursive(maxDepth, maxLineCount);

        if (lines.length > maxLineCount) {
            lines = lines.slice(0, maxLineCount);
            lines.push('  ...');
        }

        const text = lines.join('\n');
        if (text.length > 0) {
            return '\n' + text;
        }

        return '';
    }

    isEmpty() {
        return this._getMessageCount() === 0;
    }

    addAddendum(addendum: DiagnosticAddendum) {
        this._childAddenda.push(addendum);
    }

    getChildren() {
        return this._childAddenda;
    }

    getMessages() {
        return this._messages;
    }

    getNestLevel() {
        return this._nestLevel ?? 0;
    }

    // Returns undefined if no range is associated with this addendum
    // or its children. Returns a non-empty range if there is a single range
    // associated.
    getEffectiveTextRange(): TextRange | undefined {
        const range = this._getTextRangeRecursive();

        // If we received an empty range, it means that there were multiple
        // non-overlapping ranges associated with this addendum.
        if (range?.length === 0) {
            return undefined;
        }

        return range;
    }

    private _getTextRangeRecursive(recursionCount = 0): TextRange | undefined {
        if (recursionCount > maxRecursionCount) {
            return undefined;
        }
        recursionCount++;

        const childRanges = this._childAddenda
            .map((child) => child._getTextRangeRecursive(recursionCount))
            .filter((r) => !!r);

        if (childRanges.length > 1) {
            return { start: 0, length: 0 };
        }

        if (childRanges.length === 1) {
            return childRanges[0];
        }

        if (this._range) {
            return this._range;
        }

        return undefined;
    }

    private _getMessageCount(recursionCount = 0) {
        if (recursionCount > maxRecursionCount) {
            return 0;
        }

        // Get the nested message count.
        let messageCount = this._messages.length;

        for (const diag of this._childAddenda) {
            messageCount += diag._getMessageCount(recursionCount + 1);
        }

        return messageCount;
    }

    private _getLinesRecursive(maxDepth: number, maxLineCount: number, recursionCount = 0): string[] {
        if (maxDepth <= 0 || recursionCount > maxRecursionCount) {
            return [];
        }

        let childLines: string[] = [];
        for (const addendum of this._childAddenda) {
            const maxDepthRemaining = this._messages.length > 0 ? maxDepth - 1 : maxDepth;
            appendArray(childLines, addendum._getLinesRecursive(maxDepthRemaining, maxLineCount, recursionCount + 1));

            // If the number of lines exceeds our max line count, don't bother adding more.
            if (childLines.length >= maxLineCount) {
                childLines = childLines.slice(0, maxLineCount);
                break;
            }
        }

        // Prepend indentation for readability. Skip if there are no
        // messages at this level.
        const extraSpace = this._messages.length > 0 ? '  ' : '';
        return this._messages.concat(childLines).map((line) => extraSpace + line);
    }
}
