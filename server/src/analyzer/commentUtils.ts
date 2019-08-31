/*
* commentUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility functions that parse comments and extract commands
* or other directives from them.
*/

import { cloneDiagnosticSettings, DiagnosticLevel, DiagnosticSettings,
    getBooleanDiagnosticSettings, getDiagLevelSettings, getStrictDiagnosticSettings } from '../common/configOptions';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Token } from '../parser/tokenizerTypes';

export class CommentUtils {
    static getFileLevelDirectives(tokens: TextRangeCollection<Token>,
            defaultSettings: DiagnosticSettings, useStrict: boolean): DiagnosticSettings {

        let settings = cloneDiagnosticSettings(defaultSettings);

        if (useStrict) {
            this._applyStrictSettings(settings);
        }

        for (let i = 0; i < tokens.count; i++) {
            const token = tokens.getItemAt(i);
            if (token.comments) {
                for (const comment of token.comments) {
                    const value = comment.value.trim();

                    settings = this._parsePyrightComment(value, settings);
                }
            }
        }

        return settings;
    }

    private static _applyStrictSettings(settings: DiagnosticSettings) {
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

    private static _parsePyrightComment(commentValue: string, settings: DiagnosticSettings) {
        // Is this a pyright-specific comment?
        const pyrightPrefix = 'pyright:';
        if (commentValue.startsWith(pyrightPrefix)) {
            const operands = commentValue.substr(pyrightPrefix.length).trim();
            const operandList = operands.split(',').map(s => s.trim());

            // If it contains a "strict" operand, replace the existing
            // diagnostic settings with their strict counterparts.
            if (operandList.some(s => s === 'strict')) {
                this._applyStrictSettings(settings);
            }

            for (const operand of operandList) {
                settings = this._parsePyrightOperand(operand, settings);
            }
        }

        return settings;
    }

    private static _parsePyrightOperand(operand: string, settings: DiagnosticSettings) {
        const operandSplit = operand.split('=').map(s => s.trim());
        if (operandSplit.length !== 2) {
            return settings;
        }

        const settingName = operandSplit[0];
        const boolSettings = getBooleanDiagnosticSettings();
        const diagLevelSettings = getDiagLevelSettings();

        if (diagLevelSettings.find(s => s === settingName)) {
            const diagLevelValue = this._parseDiagLevel(operandSplit[1]);
            if (diagLevelValue !== undefined) {
                (settings as any)[settingName] = diagLevelValue;
            }
        } else if (boolSettings.find(s => s === settingName)) {
            const boolValue = this._parseBoolSetting(operandSplit[1]);
            if (boolValue !== undefined) {
                (settings as any)[settingName] = boolValue;
            }
        }

        return settings;
    }

    private static _parseDiagLevel(value: string): DiagnosticLevel | undefined {
        if (value === 'false' || value === 'none') {
            return 'none';
        } else if (value === 'warning') {
            return 'warning';
        } else if (value === 'true' || value === 'error') {
            return 'error';
        }

        return undefined;
    }

    private static _parseBoolSetting(value: string): boolean | undefined {
        if (value === 'false') {
            return false;
        } else if (value === 'true') {
            return true;
        }

        return undefined;
    }
}
