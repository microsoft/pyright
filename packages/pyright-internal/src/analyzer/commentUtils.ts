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
    getStandardDiagnosticRuleSet,
    getStrictDiagnosticRuleSet,
    getStrictModeNotOverriddenRules,
} from '../common/configOptions';
import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { LocAddendum, LocMessage } from '../localization/localize';
import { Token } from '../parser/tokenizerTypes';

const strictSetting = 'strict';
const standardSetting = 'standard';
const basicSetting = 'basic';

export interface CommentDiagnostic {
    message: string;
    range: TextRange;
}

export function getFileLevelDirectives(
    tokens: TextRangeCollection<Token>,
    lines: TextRangeCollection<TextRange>,
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
                const [value, textRange] = _trimTextWithRange(comment.value, {
                    start: comment.start,
                    length: comment.length,
                });

                const isCommentOnOwnLine = (): boolean => {
                    const curTokenLineOffset = convertOffsetToPosition(comment.start, lines).character;
                    return curTokenLineOffset <= 1;
                };

                ruleSet = _parsePyrightComment(value, textRange, isCommentOnOwnLine, ruleSet, diagnostics);
            }
        }
    }

    return ruleSet;
}

function _applyStrictRules(ruleSet: DiagnosticRuleSet) {
    _overrideRules(ruleSet, getStrictDiagnosticRuleSet(), getStrictModeNotOverriddenRules());
}

function _applyStandardRules(ruleSet: DiagnosticRuleSet) {
    _overwriteRules(ruleSet, getStandardDiagnosticRuleSet());
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
    isCommentOnOwnLine: () => boolean,
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

        if (!isCommentOnOwnLine()) {
            const diagAddendum = new DiagnosticAddendum();
            diagAddendum.addMessage(LocAddendum.pyrightCommentIgnoreTip());
            const diag: CommentDiagnostic = {
                message: LocMessage.pyrightCommentNotOnOwnLine() + diagAddendum.getString(),
                range: commentRange,
            };

            diagnostics.push(diag);
        }

        const operandList = operands.split(',');

        // If it contains a "strict" operand, replace the existing
        // diagnostic rules with their strict counterparts.
        if (operandList.some((s) => s.trim() === strictSetting)) {
            _applyStrictRules(ruleSet);
        } else if (operandList.some((s) => s.trim() === standardSetting)) {
            _applyStandardRules(ruleSet);
        } else if (operandList.some((s) => s.trim() === basicSetting)) {
            _applyBasicRules(ruleSet);
        }

        let rangeOffset = 0;
        for (const operand of operandList) {
            const [trimmedOperand, operandRange] = _trimTextWithRange(operand, {
                start: commentRange.start + commentPrefix.length + rangeOffset,
                length: operand.length,
            });

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
    const [trimmedRule, ruleRange] = _trimTextWithRange(operandSplit[0], {
        start: operandRange.start,
        length: operandSplit[0].length,
    });

    // Handle basic directives "basic", "standard" and "strict".
    if (operandSplit.length === 1) {
        if (trimmedRule && [strictSetting, standardSetting, basicSetting].some((setting) => trimmedRule === setting)) {
            return ruleSet;
        }
    }

    const diagLevelRules = getDiagLevelDiagnosticRules();
    const boolRules = getBooleanDiagnosticRules();

    const ruleValue = operandSplit.length > 0 ? operandSplit.slice(1).join('=') : '';
    const [trimmedRuleValue, ruleValueRange] = _trimTextWithRange(ruleValue, {
        start: operandRange.start + operandSplit[0].length + 1,
        length: ruleValue.length,
    });

    if (diagLevelRules.find((r) => r === trimmedRule)) {
        const diagLevelValue = _parseDiagLevel(trimmedRuleValue);
        if (diagLevelValue !== undefined) {
            (ruleSet as any)[trimmedRule] = diagLevelValue;
        } else {
            const diag: CommentDiagnostic = {
                message: LocMessage.pyrightCommentInvalidDiagnosticSeverityValue(),
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
                message: LocMessage.pyrightCommentInvalidDiagnosticBoolValue(),
                range: trimmedRuleValue ? ruleValueRange : ruleRange,
            };
            diagnostics.push(diag);
        }
    } else if (trimmedRule) {
        const diag: CommentDiagnostic = {
            message: trimmedRuleValue
                ? LocMessage.pyrightCommentUnknownDiagnosticRule().format({ rule: trimmedRule })
                : LocMessage.pyrightCommentUnknownDirective().format({ directive: trimmedRule }),
            range: ruleRange,
        };
        diagnostics.push(diag);
    } else {
        const diag: CommentDiagnostic = {
            message: LocMessage.pyrightCommentMissingDirective(),
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
function _trimTextWithRange(text: string, range: TextRange): [string, TextRange] {
    assert(text.length === range.length);
    const value1 = text.trimStart();

    let updatedRange = range;

    if (value1 !== text) {
        const delta = text.length - value1.length;
        updatedRange = { start: updatedRange.start + delta, length: updatedRange.length - delta };
    }

    const value2 = value1.trimEnd();
    if (value2 !== value1) {
        updatedRange = { start: updatedRange.start, length: updatedRange.length - value1.length + value2.length };
    }

    assert(value2.length === updatedRange.length);
    return [value2, updatedRange];
}
