/*
* importSorter.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides code that sorts and formats import statements within a
* python source file.
*/

import { DiagnosticTextRange } from '../common/diagnostic';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ImportAsNode, ImportFromAsNode, ImportFromNode, ImportNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ImportType } from './importResult';
import { ImportStatement, ImportStatementUtils } from './importStatementUtils';

const MaxLineLength = 80;
const TabText = '    ';

export class ImportSorter {
    constructor(private _parseResults: ParseResults) {}

    sort(): TextEditAction[] {
        const actions: TextEditAction[] = [];
        const importStatements = ImportStatementUtils.getTopLevelImports(
            this._parseResults.parseTree);

        const sortedStatements = importStatements.orderedImports.
            map(s => s).sort((a, b) => {
                return this._compareImportStatements(a, b);
            });

        if (sortedStatements.length === 0) {
            // Nothing to do.
            return [];
        }

        const primaryRange = this._getPrimaryReplacementRange(
            importStatements.orderedImports);

        actions.push({
            range: primaryRange,
            replacementText: this._generateSortedImportText(sortedStatements)
        });

        this._addSecondaryReplacementRanges(
            importStatements.orderedImports, actions);

        return actions;
    }

    private _compareImportStatements(a: ImportStatement, b: ImportStatement) {
        const aImportType = this._getImportType(a);
        const bImportType = this._getImportType(b);

        if (aImportType < bImportType) {
            return -1;
        } else if (aImportType > bImportType) {
            return 1;
        }

        return (a.moduleName < b.moduleName) ? -1 : 1;
    }

    private _getImportType(statement: ImportStatement): ImportType {
        return statement.importResult ?
            statement.importResult.importType : ImportType.Local;
    }

    // Determines the text range for the existing primary block of import statements.
    // If there are other blocks of import statements separated by other statements,
    // we'll ignore these other blocks for now.
    private _getPrimaryReplacementRange(statements: ImportStatement[]): DiagnosticTextRange {
        let statementLimit = statements.findIndex(s => s.followsNonImportStatement);
        if (statementLimit < 0) {
            statementLimit = statements.length;
        }

        return {
            start: convertOffsetToPosition(
                statements[0].node.start, this._parseResults.lines),
            end: convertOffsetToPosition(
                statements[statementLimit - 1].node.end, this._parseResults.lines)
        };
    }

    // If import statements are separated by other statements, we will remove the old
    // secondary blocks.
    private _addSecondaryReplacementRanges(statements: ImportStatement[], actions: TextEditAction[]) {
        let secondaryBlockStart = statements.findIndex(s => s.followsNonImportStatement);
        if (secondaryBlockStart < 0) {
            return;
        }

        while (true) {
            let secondaryBlockEnd = statements.findIndex(
                (s, index) => index > secondaryBlockStart && s.followsNonImportStatement);
            if (secondaryBlockEnd < 0) {
                secondaryBlockEnd = statements.length - 1;
            }

            actions.push({
                range: {
                    start: convertOffsetToPosition(
                        statements[secondaryBlockStart].node.start,
                        this._parseResults.lines),
                    end: convertOffsetToPosition(
                        statements[secondaryBlockEnd].node.end,
                        this._parseResults.lines)
                },
                replacementText: ''
            });

            secondaryBlockStart = secondaryBlockEnd + 1;
            if (secondaryBlockStart >= statements.length) {
                break;
            }
        }
    }

    private _generateSortedImportText(sortedStatements: ImportStatement[]): string {
        let importText = '';
        let prevImportType = this._getImportType(sortedStatements[0]);

        for (let statement of sortedStatements) {
            // Insert a blank space between import type groups.
            const curImportType = this._getImportType(statement);
            if (prevImportType !== curImportType) {
                importText += '\n';
                prevImportType = curImportType;
            }

            let importLine: string;
            if (statement.node instanceof ImportNode) {
                importLine = this._formatImportNode(statement.subnode!,
                    statement.moduleName);
            } else {
                importLine = this._formatImportFromNode(statement.node,
                    statement.moduleName);
            }

            // If this isn't the last statement, add a newline.
            if (statement !== sortedStatements[sortedStatements.length - 1]) {
                importLine += '\n';
            }

            importText += importLine;
        }

        return importText;
    }

    private _formatImportNode(subnode: ImportAsNode, moduleName: string): string {
        let importText = `import ${ moduleName }`;
        if (subnode.alias) {
            importText += ` as ${ subnode.alias.nameToken.value }`;
        }

        return importText;
    }

    private _formatImportFromNode(node: ImportFromNode, moduleName: string): string {
        const symbols = node.imports.
            sort((a, b) => this._compareSymbols(a, b)).
            map(symbol => {
                let symbolText = symbol.name.nameToken.value;
                if (symbol.alias) {
                    symbolText += ` as ${ symbol.alias.nameToken.value }`;
                }

                return symbolText;
            });

        let cumulativeText = `from ${ moduleName } import `;
        let symbolText = symbols.join(', ');
        if (cumulativeText.length + symbolText.length <= MaxLineLength) {
            return cumulativeText + symbolText;
        }

        // We need to split across multiple lines with parens.
        cumulativeText += '(\n';

        let nextSymbolIndex = 0;
        while (nextSymbolIndex < symbols.length) {
            let curTextLine = TabText + symbols[nextSymbolIndex];
            if (nextSymbolIndex < symbols.length - 1) {
                curTextLine += ',';
            } else {
                curTextLine += ')';
            }
            nextSymbolIndex++;

            // See if we can add more.
            let potentialTextLine = curTextLine;
            while (nextSymbolIndex < symbols.length) {
                potentialTextLine += ' ' + symbols[nextSymbolIndex];
                if (nextSymbolIndex < symbols.length - 1) {
                    potentialTextLine += ',';
                } else {
                    potentialTextLine += ')';
                }

                // If the potential text line went beyond our allowed
                // max, break out of the inner loop.
                if (potentialTextLine.length > MaxLineLength) {
                    break;
                }

                // Commit the potential text to the current text since
                // we know that it fits.
                curTextLine = potentialTextLine;
                nextSymbolIndex++;
            }

            cumulativeText += curTextLine;
            if (nextSymbolIndex < symbols.length) {
                cumulativeText += '\n';
            }
        }

        return cumulativeText;
    }

    private _compareSymbols(a: ImportFromAsNode, b: ImportFromAsNode) {
        return a.name.nameToken.value < b.name.nameToken.value ? -1 : 1;
    }
}
