/*
 * insertionPointUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides code to get position to inject generated code.
 */

import { getFileInfo, getScope } from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import { getNameNodeForDeclaration } from '../analyzer/declarationUtils';
import { getFirstAncestorOrSelf, isBlankLine } from '../analyzer/parseTreeUtils';
import { isPrivateName } from '../analyzer/symbolNameUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { containsOnlyWhitespace } from '../common/core';
import { convertOffsetToPosition, convertPositionToOffset, getLineEndOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { MatchNode, ParseNode, ParseNodeType, StatementNode, SuiteNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface InsertionOptions {
    insertBefore?: number;
    symbolDeclToIgnore?: string;
}

export function getInsertionPointForSymbolUnderModule(
    evaluator: TypeEvaluator,
    parseResults: ParseResults,
    symbolName: string,
    options?: InsertionOptions
): number | undefined {
    const module = parseResults.parseTree;

    // If it is an empty file with all whitespaces, return 0
    const defaultInsertionPoint = _getDefaultInsertionPoint(parseResults);
    if (module.statements.length === 0) {
        return containsOnlyWhitespace(parseResults.text) ? 0 : defaultInsertionPoint;
    }

    // See whether same name is already taken.
    const scope = getScope(module);
    if (!scope) {
        // No symbol is defined.
        return defaultInsertionPoint;
    }

    const fileInfo = getFileInfo(module);
    const symbol = scope.lookUpSymbol(symbolName);
    if (
        symbol &&
        _getDeclarationsDefinedInCurrentModule(evaluator, symbol.getDeclarations(), fileInfo.filePath, options).length >
            0
    ) {
        // Same name symbol is already defined in the module level.
        // We can't add another one.
        return undefined;
    }

    const insertBefore = options?.insertBefore ?? defaultInsertionPoint;
    if (isPrivateName(symbolName)) {
        return Math.max(0, insertBefore);
    }

    if (insertBefore < TextRange.getEnd(module.statements[0])) {
        return Math.max(0, Math.min(insertBefore, module.statements[0].start));
    }

    const lastStatement = _getLastStatementWithPublicName(
        module.statements,
        options?.insertBefore ?? defaultInsertionPoint
    );

    const position = convertOffsetToPosition(TextRange.getEnd(lastStatement), parseResults.tokenizerOutput.lines);
    return getLineEndOffset(parseResults.tokenizerOutput, parseResults.text, position.line);
}

export function getContainer(node: ParseNode, includeSelf = true): SuiteNode | MatchNode | undefined {
    return getFirstAncestorOrSelf(node, (n) => {
        if (!includeSelf && node === n) {
            return false;
        }

        return n.nodeType === ParseNodeType.Suite || n.nodeType === ParseNodeType.Match;
    }) as SuiteNode | undefined;
}

function _getDefaultInsertionPoint(parseResults: ParseResults) {
    const endOffset = TextRange.getEnd(parseResults.parseTree);
    const position = convertOffsetToPosition(endOffset, parseResults.tokenizerOutput.lines);
    if (position.character === 0) {
        return endOffset;
    }

    if (isBlankLine(parseResults, position.line)) {
        return (
            convertPositionToOffset({ line: position.line, character: 0 }, parseResults.tokenizerOutput.lines) ??
            endOffset
        );
    }

    return endOffset;
}

function _getDeclarationsDefinedInCurrentModule(
    evaluator: TypeEvaluator,
    declarations: Declaration[],
    moduleFilePath: string,
    options?: InsertionOptions
) {
    return declarations.filter((d) => {
        const resolved = evaluator.resolveAliasDeclaration(
            d,
            /*resolveLocalNames*/ true,
            /*allowExternallyHiddenAccess*/ true
        );

        if (!resolved) {
            return false;
        }

        if (options?.symbolDeclToIgnore && resolved.path === options.symbolDeclToIgnore) {
            // Even if the symbol is defined in current file, if it is something we are going to remove
            // we should ignore the symbol being exist in current file.
            // ex) inserting "myFunc" to a file that has "from lib import myFunc"
            return false;
        }

        if (d.type === DeclarationType.Alias) {
            const name = getNameNodeForDeclaration(d);
            if (!name) {
                return false;
            }

            // Check alias is defined in this module.
            const fileInfo = getFileInfo(name);
            return fileInfo.filePath === moduleFilePath;
        }

        return resolved.path === moduleFilePath;
    });
}

function _getLastStatementWithPublicName(statements: StatementNode[], insertBefore: number) {
    let lastStatement = statements[0];
    for (let i = 1; i < statements.length; i++) {
        const statement = statements[i];
        if (insertBefore < TextRange.getEnd(statement)) {
            return lastStatement;
        }

        switch (statement.nodeType) {
            case ParseNodeType.Class:
            case ParseNodeType.Function: {
                if (isPrivateName(statement.name.value)) {
                    return lastStatement;
                }

                lastStatement = statement;
                continue;
            }
            case ParseNodeType.StatementList: {
                if (
                    statement.statements.some(
                        (s) =>
                            s.nodeType === ParseNodeType.Assignment &&
                            s.leftExpression.nodeType === ParseNodeType.Name &&
                            isPrivateName(s.leftExpression.value)
                    )
                ) {
                    return lastStatement;
                }

                lastStatement = statement;
                continue;
            }
            default:
                lastStatement = statement;
                continue;
        }
    }

    return lastStatement;
}
