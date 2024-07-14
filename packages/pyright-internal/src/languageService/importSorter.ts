/*
 * importSorter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides code that sorts and formats import statements within a
 * Python source file.
 */

import { CancellationToken } from 'vscode-languageserver';

import {
    compareImportStatements,
    getImportGroup,
    getTopLevelImports,
    ImportStatement,
} from '../analyzer/importStatementUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { Range, TextRange } from '../common/textRange';
import { ImportAsNode, ImportFromAsNode, ImportFromNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';

// We choose a line length that matches the default for the popular
// "black" formatter used in many Python projects.
const _maxLineLength = 88;

export class ImportSorter {
    constructor(private _parseResults: ParseFileResults, private _cancellationToken: CancellationToken) {}

    sort(): TextEditAction[] {
        throwIfCancellationRequested(this._cancellationToken);

        const actions: TextEditAction[] = [];
        const importStatements = getTopLevelImports(this._parseResults.parserOutput.parseTree);

        const sortedStatements = importStatements.orderedImports
            .map((s) => s)
            .sort((a, b) => {
                return compareImportStatements(a, b);
            });

        if (sortedStatements.length === 0) {
            // Nothing to do.
            return [];
        }

        const primaryRange = this._getPrimaryReplacementRange(importStatements.orderedImports);

        actions.push({
            range: primaryRange,
            replacementText: this._generateSortedImportText(sortedStatements),
        });

        this._addSecondaryReplacementRanges(importStatements.orderedImports, actions);

        return actions;
    }

    // Determines the text range for the existing primary block of import statements.
    // If there are other blocks of import statements separated by other statements,
    // we'll ignore these other blocks for now.
    private _getPrimaryReplacementRange(statements: ImportStatement[]): Range {
        let statementLimit = statements.findIndex((s) => s.followsNonImportStatement);
        if (statementLimit < 0) {
            statementLimit = statements.length;
        }

        const lastStatement = statements[statementLimit - 1].node;
        return {
            start: convertOffsetToPosition(statements[0].node.start, this._parseResults.tokenizerOutput.lines),
            end: convertOffsetToPosition(TextRange.getEnd(lastStatement), this._parseResults.tokenizerOutput.lines),
        };
    }

    // If import statements are separated by other statements, we will remove the old
    // secondary blocks.
    private _addSecondaryReplacementRanges(statements: ImportStatement[], actions: TextEditAction[]) {
        let secondaryBlockStart = statements.findIndex((s) => s.followsNonImportStatement);
        if (secondaryBlockStart < 0) {
            return;
        }

        while (true) {
            let secondaryBlockLimit = statements.findIndex(
                (s, index) => index > secondaryBlockStart && s.followsNonImportStatement
            );
            if (secondaryBlockLimit < 0) {
                secondaryBlockLimit = statements.length;
            }

            actions.push({
                range: {
                    start: convertOffsetToPosition(
                        statements[secondaryBlockStart].node.start,
                        this._parseResults.tokenizerOutput.lines
                    ),
                    end: convertOffsetToPosition(
                        TextRange.getEnd(statements[secondaryBlockLimit - 1].node),
                        this._parseResults.tokenizerOutput.lines
                    ),
                },
                replacementText: '',
            });

            secondaryBlockStart = secondaryBlockLimit;
            if (secondaryBlockStart >= statements.length) {
                break;
            }
        }
    }

    private _generateSortedImportText(sortedStatements: ImportStatement[]): string {
        let importText = '';
        let prevImportGroup = getImportGroup(sortedStatements[0]);

        for (const statement of sortedStatements) {
            // Insert a blank space between import type groups.
            const curImportType = getImportGroup(statement);
            if (prevImportGroup !== curImportType) {
                importText += this._parseResults.tokenizerOutput.predominantEndOfLineSequence;
                prevImportGroup = curImportType;
            }

            let importLine: string;
            if (statement.node.nodeType === ParseNodeType.Import) {
                importLine = this._formatImportNode(statement.subnode!, statement.moduleName);
            } else {
                importLine = this._formatImportFromNode(statement.node, statement.moduleName);
            }

            // If this isn't the last statement, add a newline.
            if (statement !== sortedStatements[sortedStatements.length - 1]) {
                importLine += this._parseResults.tokenizerOutput.predominantEndOfLineSequence;
            }

            importText += importLine;
        }

        return importText;
    }

    private _formatImportNode(subnode: ImportAsNode, moduleName: string): string {
        let importText = `import ${moduleName}`;
        if (subnode.d.alias) {
            importText += ` as ${subnode.d.alias.d.value}`;
        }

        return importText;
    }

    private _formatImportFromNode(node: ImportFromNode, moduleName: string): string {
        const symbols = node.d.imports
            .sort((a, b) => this._compareSymbols(a, b))
            .map((symbol) => {
                let symbolText = symbol.d.name.d.value;
                if (symbol.d.alias) {
                    symbolText += ` as ${symbol.d.alias.d.value}`;
                }

                return symbolText;
            });

        let cumulativeText = `from ${moduleName} import `;
        if (node.d.isWildcardImport) {
            return cumulativeText + '*';
        }

        const symbolText = symbols.join(', ');
        if (cumulativeText.length + symbolText.length <= _maxLineLength) {
            return cumulativeText + symbolText;
        }

        // We need to split across multiple lines with parens.
        cumulativeText += '(' + this._parseResults.tokenizerOutput.predominantEndOfLineSequence;

        for (const symbol of symbols) {
            cumulativeText +=
                this._parseResults.tokenizerOutput.predominantTabSequence +
                symbol +
                ',' +
                this._parseResults.tokenizerOutput.predominantEndOfLineSequence;
        }

        cumulativeText += ')';

        return cumulativeText;
    }

    private _compareSymbols(a: ImportFromAsNode, b: ImportFromAsNode) {
        return a.d.name.d.value < b.d.name.d.value ? -1 : 1;
    }
}
