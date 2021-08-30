/*
 * diagnostics.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents errors and warnings.
 */

import { Commands } from '../commands/commands';
import { DiagnosticLevel } from './configOptions';
import { Range } from './textRange';

const defaultMaxDepth = 5;
const defaultMaxLineCount = 8;
const maxRecursionCount = 64;

export const enum DiagnosticCategory {
    Error,
    Warning,
    Information,
    UnusedCode,
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
    filePath: string;
    diagnostic: Diagnostic;
}

export interface CreateTypeStubFileAction extends DiagnosticAction {
    action: Commands.createTypeStub;
    moduleName: string;
}

export interface AddMissingOptionalToParamAction extends DiagnosticAction {
    action: Commands.addMissingOptionalToParam;
    offsetOfTypeNode: number;
}

export interface DiagnosticRelatedInfo {
    message: string;
    filePath: string;
    range: Range;
}

// Represents a single error or warning.
export class Diagnostic {
    private _actions: DiagnosticAction[] | undefined;
    private _rule: string | undefined;
    private _relatedInfo: DiagnosticRelatedInfo[] = [];

    constructor(readonly category: DiagnosticCategory, readonly message: string, readonly range: Range) {}

    addAction(action: DiagnosticAction) {
        if (this._actions === undefined) {
            this._actions = [action];
        } else {
            this._actions.push(action);
        }
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

    addRelatedInfo(message: string, filePath: string, range: Range) {
        this._relatedInfo.push({ filePath, message, range });
    }

    getRelatedInfo() {
        return this._relatedInfo;
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
        const newAddendum = new DiagnosticAddendum();
        this.addAddendum(newAddendum);
        return newAddendum;
    }

    getString(maxDepth = defaultMaxDepth, maxLineCount = defaultMaxLineCount): string {
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
            childLines.push(...addendum._getLinesRecursive(maxDepthRemaining, maxLineCount, recursionCount + 1));

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
