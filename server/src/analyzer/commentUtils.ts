/*
 * commentUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility functions that parse comments and extract commands
 * or other directives from them.
 */

import {
    cloneDiagnosticSettings,
    DiagnosticLevel,
    DiagnosticSettings,
    getBooleanDiagnosticSettings,
    getDiagLevelSettings,
    getStrictDiagnosticSettings
} from '../common/configOptions';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Token } from '../parser/tokenizerTypes';

export function getFileLevelDirectives(
    tokens: TextRangeCollection<Token>,
    defaultSettings: DiagnosticSettings,
    useStrict: boolean
): DiagnosticSettings {
    let settings = cloneDiagnosticSettings(defaultSettings);

    if (useStrict) {
        _applyStrictSettings(settings);
    }

    for (let i = 0; i < tokens.count; i++) {
        const token = tokens.getItemAt(i);
        if (token.comments) {
            for (const comment of token.comments) {
                const value = comment.value.trim();

                settings = _parsePyrightComment(value, settings);
            }
        }
    }

    return settings;
}

function _applyStrictSettings(settings: DiagnosticSettings) {
    const strictSettings = getStrictDiagnosticSettings();
    const boolSettingNames = getBooleanDiagnosticSettings();
    const diagSettingNames = getDiagLevelSettings();

    // Enable the strict settings as appropriate.
    for (const setting of boolSettingNames) {
        if ((strictSettings as any)[setting]) {
            (settings as any)[setting] = true;
        }
    }

    for (const setting of diagSettingNames) {
        const strictValue: DiagnosticLevel = (strictSettings as any)[setting];
        const prevValue: DiagnosticLevel = (settings as any)[setting];

        if (strictValue === 'error' || (strictValue === 'warning' && prevValue !== 'error')) {
            (settings as any)[setting] = strictValue;
        }
    }
}

function _parsePyrightComment(commentValue: string, settings: DiagnosticSettings) {
    // Is this a pyright or mspython-specific comment?
    const validPrefixes = ['pyright:', 'mspython:'];
    const prefix = validPrefixes.find(p => commentValue.startsWith(p));
    if (prefix) {
        const operands = commentValue.substr(prefix.length).trim();
        const operandList = operands.split(',').map(s => s.trim());

        // If it contains a "strict" operand, replace the existing
        // diagnostic settings with their strict counterparts.
        if (operandList.some(s => s === 'strict')) {
            _applyStrictSettings(settings);
        }

        for (const operand of operandList) {
            settings = _parsePyrightOperand(operand, settings);
        }
    }

    return settings;
}

function _parsePyrightOperand(operand: string, settings: DiagnosticSettings) {
    const operandSplit = operand.split('=').map(s => s.trim());
    if (operandSplit.length !== 2) {
        return settings;
    }

    const settingName = operandSplit[0];
    const boolSettings = getBooleanDiagnosticSettings();
    const diagLevelSettings = getDiagLevelSettings();

    if (diagLevelSettings.find(s => s === settingName)) {
        const diagLevelValue = _parseDiagLevel(operandSplit[1]);
        if (diagLevelValue !== undefined) {
            (settings as any)[settingName] = diagLevelValue;
        }
    } else if (boolSettings.find(s => s === settingName)) {
        const boolValue = _parseBoolSetting(operandSplit[1]);
        if (boolValue !== undefined) {
            (settings as any)[settingName] = boolValue;
        }
    }

    return settings;
}

function _parseDiagLevel(value: string): DiagnosticLevel | undefined {
    if (value === 'false' || value === 'none') {
        return 'none';
    } else if (value === 'warning') {
        return 'warning';
    } else if (value === 'true' || value === 'error') {
        return 'error';
    }

    return undefined;
}

function _parseBoolSetting(value: string): boolean | undefined {
    if (value === 'false') {
        return false;
    } else if (value === 'true') {
        return true;
    }

    return undefined;
}
