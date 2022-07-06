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
import { getFirstAncestorOrSelf } from '../analyzer/parseTreeUtils';
import { isPrivateName } from '../analyzer/symbolNameUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { TextRange } from '../common/textRange';
import { ParseNode, ParseNodeType, StatementNode, SuiteNode } from '../parser/parseNodes';
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

    const defaultInsertionPoint = TextRange.getEnd(module);
    if (module.statements.length === 0) {
        // Empty file.
        return defaultInsertionPoint;
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

    if (isPrivateName(symbolName)) {
        return Math.max(0, options?.insertBefore ?? defaultInsertionPoint);
    }

    const lastStatement = _getLastStatementWithPublicName(module.statements);
    return TextRange.getEnd(lastStatement);
}

export function getContainer(node: ParseNode, includeSelf = true): SuiteNode | undefined {
    return getFirstAncestorOrSelf(node, (n) => {
        if (!includeSelf && node === n) {
            return false;
        }

        return n.nodeType === ParseNodeType.Suite;
    }) as SuiteNode | undefined;
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

function _getLastStatementWithPublicName(statements: StatementNode[]) {
    let lastStatement = statements[0];
    for (let i = 1; i < statements.length; i++) {
        const statement = statements[i];
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
