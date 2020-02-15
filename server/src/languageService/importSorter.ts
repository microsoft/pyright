/*
* importSorter.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides code that sorts and formats import statements within a
* python source file.
*/

import { ImportType } from '../analyzer/importResult';
import * as ImportStatementUtils from '../analyzer/importStatementUtils';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { Range } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { ImportAsNode, ImportFromAsNode, ImportFromNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

const _maxLineLength = 80;

export const enum ImportGroup {
    // The ordering here is important because this is the order
    // in which PEP8 specifies that imports should be ordered.
    BuiltIn = 0,
    ThirdParty = 1,
    Local = 2,
    LocalRelative = 3
}

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

    private _compareImportStatements(a: ImportStatementUtils.ImportStatement,
            b: ImportStatementUtils.ImportStatement) {

        const aImportGroup = this._getImportGroup(a);
        const bImportGroup = this._getImportGroup(b);

        if (aImportGroup < bImportGroup) {
            return -1;
        } else if (aImportGroup > bImportGroup) {
            return 1;
        }

        return (a.moduleName < b.moduleName) ? -1 : 1;
    }

    private _getImportGroup(statement: ImportStatementUtils.ImportStatement): ImportGroup {
        if (statement.importResult) {
            if (statement.importResult.importType === ImportType.BuiltIn) {
                return ImportGroup.BuiltIn;
            } else if (statement.importResult.importType === ImportType.ThirdParty ||
                    statement.importResult.isLocalTypingsFile) {

                return ImportGroup.ThirdParty;
            }

            if (statement.importResult.isRelative) {
                return ImportGroup.LocalRelative;
            }

            return ImportGroup.Local;
        } else {
            return ImportGroup.Local;
        }
    }

    // Determines the text range for the existing primary block of import statements.
    // If there are other blocks of import statements separated by other statements,
    // we'll ignore these other blocks for now.
    private _getPrimaryReplacementRange(statements: ImportStatementUtils.ImportStatement[]):
            Range {

        let statementLimit = statements.findIndex(s => s.followsNonImportStatement);
        if (statementLimit < 0) {
            statementLimit = statements.length;
        }

        const lastStatement = statements[statementLimit - 1].node;
        return {
            start: convertOffsetToPosition(
                statements[0].node.start, this._parseResults.tokenizerOutput.lines),
            end: convertOffsetToPosition(
                TextRange.getEnd(lastStatement), this._parseResults.tokenizerOutput.lines)
        };
    }

    // If import statements are separated by other statements, we will remove the old
    // secondary blocks.
    private _addSecondaryReplacementRanges(statements: ImportStatementUtils.ImportStatement[],
            actions: TextEditAction[]) {

        let secondaryBlockStart = statements.findIndex(s => s.followsNonImportStatement);
        if (secondaryBlockStart < 0) {
            return;
        }

        while (true) {
            let secondaryBlockLimit = statements.findIndex(
                (s, index) => index > secondaryBlockStart && s.followsNonImportStatement);
            if (secondaryBlockLimit < 0) {
                secondaryBlockLimit = statements.length;
            }

            actions.push({
                range: {
                    start: convertOffsetToPosition(
                        statements[secondaryBlockStart].node.start,
                        this._parseResults.tokenizerOutput.lines),
                    end: convertOffsetToPosition(
                        TextRange.getEnd(statements[secondaryBlockLimit - 1].node),
                        this._parseResults.tokenizerOutput.lines)
                },
                replacementText: ''
            });

            secondaryBlockStart = secondaryBlockLimit;
            if (secondaryBlockStart >= statements.length) {
                break;
            }
        }
    }

    private _generateSortedImportText(sortedStatements: ImportStatementUtils.ImportStatement[]): string {
        let importText = '';
        let prevImportGroup = this._getImportGroup(sortedStatements[0]);

        for (const statement of sortedStatements) {
            // Insert a blank space between import type groups.
            const curImportType = this._getImportGroup(statement);
            if (prevImportGroup !== curImportType) {
                importText += this._parseResults.tokenizerOutput.predominantEndOfLineSequence;
                prevImportGroup = curImportType;
            }

            let importLine: string;
            if (statement.node.nodeType === ParseNodeType.Import) {
                importLine = this._formatImportNode(statement.subnode!,
                    statement.moduleName);
            } else {
                importLine = this._formatImportFromNode(statement.node,
                    statement.moduleName);
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
        let importText = `import ${ moduleName }`;
        if (subnode.alias) {
            importText += ` as ${ subnode.alias.value }`;
        }

        return importText;
    }

    private _formatImportFromNode(node: ImportFromNode, moduleName: string): string {
        const symbols = node.imports.
            sort((a, b) => this._compareSymbols(a, b)).
            map(symbol => {
                let symbolText = symbol.name.value;
                if (symbol.alias) {
                    symbolText += ` as ${ symbol.alias.value }`;
                }

                return symbolText;
            });

        let cumulativeText = `from ${ moduleName } import `;
        const symbolText = symbols.join(', ');
        if (cumulativeText.length + symbolText.length <= _maxLineLength) {
            return cumulativeText + symbolText;
        }

        // We need to split across multiple lines with parens.
        cumulativeText += '(\n';

        let nextSymbolIndex = 0;
        while (nextSymbolIndex < symbols.length) {
            let curTextLine = this._parseResults.tokenizerOutput.predominantTabSequence + symbols[nextSymbolIndex];
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
                if (potentialTextLine.length > _maxLineLength) {
                    break;
                }

                // Commit the potential text to the current text since
                // we know that it fits.
                curTextLine = potentialTextLine;
                nextSymbolIndex++;
            }

            cumulativeText += curTextLine;
            if (nextSymbolIndex < symbols.length) {
                cumulativeText += this._parseResults.tokenizerOutput.predominantEndOfLineSequence;
            }
        }

        return cumulativeText;
    }

    private _compareSymbols(a: ImportFromAsNode, b: ImportFromAsNode) {
        return a.name.value < b.name.value ? -1 : 1;
    }
}
