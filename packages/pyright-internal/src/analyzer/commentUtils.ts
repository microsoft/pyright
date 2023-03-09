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
    cloneDiagnosticRuleSet,
    DiagnosticLevel,
    DiagnosticRuleSet,
    getBasicDiagnosticRuleSet,
    getBooleanDiagnosticRules,
    getDiagLevelDiagnosticRules,
    getStrictDiagnosticRuleSet,
    getStrictModeNotOverriddenRules,
} from '../common/configOptions';
import { assert } from '../common/debug';
import { DiagnosticRule } from '../common/diagnosticRules';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Localizer } from '../localization/localize';
import { Token } from '../parser/tokenizerTypes';

const strictSetting = 'strict';
const basicSetting = 'basic';

export interface CommentDiagnostic {
    message: string;
    range: TextRange;
}

export function getFileLevelDirectives(
    tokens: TextRangeCollection<Token>,
    defaultRuleSet: DiagnosticRuleSet,
    useStrict: boolean,
    diagnostics: CommentDiagnostic[]
): DiagnosticRuleSet {
    let ruleSet = cloneDiagnosticRuleSet(defaultRuleSet);

    if (useStrict) {
        _applyStrictRules(ruleSet);
    }

    for (let i = 0; i < tokens.count; i++) {
        const token = tokens.getItemAt(i);
        if (token.comments) {
            for (const comment of token.comments) {
                const textRange: TextRange = { start: comment.start, length: comment.length };
                const value = _trimTextWithRange(comment.value, textRange);

                ruleSet = _parsePyrightComment(value, textRange, ruleSet, diagnostics);
            }
        }
    }

    return ruleSet;
}

function _applyStrictRules(ruleSet: DiagnosticRuleSet) {
    _overrideRules(ruleSet, getStrictDiagnosticRuleSet(), getStrictModeNotOverriddenRules());
}

function _applyBasicRules(ruleSet: DiagnosticRuleSet) {
    _overwriteRules(ruleSet, getBasicDiagnosticRuleSet());
}

function _overrideRules(
    ruleSet: DiagnosticRuleSet,
    overrideRuleSet: DiagnosticRuleSet,
    skipRuleNames: DiagnosticRule[]
) {
    const boolRuleNames = getBooleanDiagnosticRules();
    const diagRuleNames = getDiagLevelDiagnosticRules();

    // Enable the strict rules as appropriate.
    for (const ruleName of boolRuleNames) {
        if (skipRuleNames.find((r) => r === ruleName)) {
            continue;
        }

        if ((overrideRuleSet as any)[ruleName]) {
            (ruleSet as any)[ruleName] = true;
        }
    }

    for (const ruleName of diagRuleNames) {
        if (skipRuleNames.find((r) => r === ruleName)) {
            continue;
        }

        const overrideValue: DiagnosticLevel = (overrideRuleSet as any)[ruleName];
        const prevValue: DiagnosticLevel = (ruleSet as any)[ruleName];

        // Override only if the new value is more strict than the existing value.
        if (
            overrideValue === 'error' ||
            (overrideValue === 'warning' && prevValue !== 'error') ||
            (overrideValue === 'information' && prevValue !== 'error' && prevValue !== 'warning')
        ) {
            (ruleSet as any)[ruleName] = overrideValue;
        }
    }
}

function _overwriteRules(ruleSet: DiagnosticRuleSet, overrideRuleSet: DiagnosticRuleSet) {
    const boolRuleNames = getBooleanDiagnosticRules();
    const diagRuleNames = getDiagLevelDiagnosticRules();

    for (const ruleName of boolRuleNames) {
        (ruleSet as any)[ruleName] = (overrideRuleSet as any)[ruleName];
    }

    for (const ruleName of diagRuleNames) {
        (ruleSet as any)[ruleName] = (overrideRuleSet as any)[ruleName];
    }
}

function _parsePyrightComment(
    commentValue: string,
    commentRange: TextRange,
    ruleSet: DiagnosticRuleSet,
    diagnostics: CommentDiagnostic[]
) {
    // Is this a pyright comment?
    const commentPrefix = 'pyright:';
    if (commentValue.startsWith(commentPrefix)) {
        const operands = commentValue.substring(commentPrefix.length);

        // Handle (actual ignore) "ignore" directives.
        if (operands.trim().startsWith('ignore')) {
            return ruleSet;
        }

        const operandList = operands.split(',');

        // If it contains a "strict" operand, replace the existing
        // diagnostic rules with their strict counterparts.
        if (operandList.some((s) => s.trim() === strictSetting)) {
            _applyStrictRules(ruleSet);
        } else if (operandList.some((s) => s.trim() === basicSetting)) {
            _applyBasicRules(ruleSet);
        }

        let rangeOffset = 0;
        for (const operand of operandList) {
            const operandRange: TextRange = {
                start: commentRange.start + commentPrefix.length + rangeOffset,
                length: operand.length,
            };
            const trimmedOperand = _trimTextWithRange(operand, operandRange);

            ruleSet = _parsePyrightOperand(trimmedOperand, operandRange, ruleSet, diagnostics);
            rangeOffset += operand.length + 1;
        }
    }

    return ruleSet;
}

function _parsePyrightOperand(
    operand: string,
    operandRange: TextRange,
    ruleSet: DiagnosticRuleSet,
    diagnostics: CommentDiagnostic[]
) {
    const operandSplit = operand.split('=');
    const ruleRange: TextRange = {
        start: operandRange.start,
        length: operandSplit[0].length,
    };
    const trimmedRule = _trimTextWithRange(operandSplit[0], ruleRange);

    // Handle basic directives "basic" and "strict".
    if (operandSplit.length === 1) {
        if (trimmedRule && [strictSetting, basicSetting].some((setting) => trimmedRule === setting)) {
            return ruleSet;
        }
    }

    const diagLevelRules = getDiagLevelDiagnosticRules();
    const boolRules = getBooleanDiagnosticRules();

    const ruleValue = operandSplit.length > 0 ? operandSplit.slice(1).join('=') : '';
    const ruleValueRange: TextRange = {
        start: operandRange.start + operandSplit[0].length + 1,
        length: ruleValue.length,
    };
    const trimmedRuleValue = _trimTextWithRange(ruleValue, ruleValueRange);

    if (diagLevelRules.find((r) => r === trimmedRule)) {
        const diagLevelValue = _parseDiagLevel(trimmedRuleValue);
        if (diagLevelValue !== undefined) {
            (ruleSet as any)[trimmedRule] = diagLevelValue;
        } else {
            const diag: CommentDiagnostic = {
                message: Localizer.Diagnostic.pyrightCommentInvalidDiagnosticSeverityValue(),
                range: trimmedRuleValue ? ruleValueRange : ruleRange,
            };
            diagnostics.push(diag);
        }
    } else if (boolRules.find((r) => r === trimmedRule)) {
        const boolValue = _parseBoolSetting(trimmedRuleValue);
        if (boolValue !== undefined) {
            (ruleSet as any)[trimmedRule] = boolValue;
        } else {
            const diag: CommentDiagnostic = {
                message: Localizer.Diagnostic.pyrightCommentInvalidDiagnosticBoolValue(),
                range: trimmedRuleValue ? ruleValueRange : ruleRange,
            };
            diagnostics.push(diag);
        }
    } else if (trimmedRule) {
        const diag: CommentDiagnostic = {
            message: trimmedRuleValue
                ? Localizer.Diagnostic.pyrightCommentUnknownDiagnosticRule().format({ rule: trimmedRule })
                : Localizer.Diagnostic.pyrightCommentUnknownDirective().format({ directive: trimmedRule }),
            range: ruleRange,
        };
        diagnostics.push(diag);
    } else {
        const diag: CommentDiagnostic = {
            message: Localizer.Diagnostic.pyrightCommentMissingDirective(),
            range: ruleRange,
        };
        diagnostics.push(diag);
    }

    return ruleSet;
}

function _parseDiagLevel(value: string): DiagnosticLevel | undefined {
    switch (value) {
        case 'false':
        case 'none':
            return 'none';

        case 'true':
        case 'error':
            return 'error';

        case 'warning':
            return 'warning';

        case 'information':
            return 'information';

        default:
            return undefined;
    }
}

function _parseBoolSetting(value: string): boolean | undefined {
    if (value === 'false') {
        return false;
    } else if (value === 'true') {
        return true;
    }

    return undefined;
}

// Calls "trim" on the text and adjusts the corresponding range
// if characters are trimmed from the beginning or end.
function _trimTextWithRange(text: string, range: TextRange): string {
    assert(text.length === range.length);
    const value1 = text.trimStart();

    if (value1 !== text) {
        const delta = text.length - value1.length;
        range.start += delta;
        range.length -= delta;
    }

    const value2 = value1.trimEnd();
    if (value2 !== value1) {
        range.length -= value1.length - value2.length;
    }

    assert(value2.length === range.length);
    return value2;
}
