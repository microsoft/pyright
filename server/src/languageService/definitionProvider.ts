/*
* definitionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a "definition" of the item that is referred to at that position.
* For example, if the location is within an import name, the
* definition is the top of the resolved import file.
*/

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { Symbol } from '../analyzer/symbol';
import { TypeCategory } from '../analyzer/types';
import * as TypeUtils from '../analyzer/typeUtils';
import { DiagnosticTextPosition, DiagnosticTextRange, DocumentTextRange } from '../common/diagnostic';
import { isFile } from '../common/pathUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { MemberAccessExpressionNode, ModuleNameNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

const _startOfFilePosition: DiagnosticTextPosition = { line: 0, column: 0 };
const _startOfFileRange: DiagnosticTextRange = { start: _startOfFilePosition, end: _startOfFilePosition };

export class DefinitionProvider {
    static getDefinitionsForPosition(parseResults: ParseResults,
            position: DiagnosticTextPosition): DocumentTextRange[] | undefined {

        const offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const definitions: DocumentTextRange[] = [];

        if (node.nodeType === ParseNodeType.ModuleName) {
            this._addDefinitionsForModuleNameNode(definitions, node, offset);
        } else if (node.nodeType === ParseNodeType.Name) {
            // Is the user hovering over a member name? If so, we need to search
            // in the scope of that type rather than the current node's scope.
            if (node.parent && node.parent.nodeType === ParseNodeType.MemberAccess &&
                    node === node.parent.memberName) {

                this._addDefinitionsForMemberAccessNode(definitions, node.parent);
            } else {
                this._addDefinitionsForNameNode(definitions, node);
            }
        }

        return definitions.length > 0 ? definitions : undefined;
    }

    private static _addDefinitionsForMemberAccessNode(definitions: DocumentTextRange[],
            node: MemberAccessExpressionNode) {

        const baseType = AnalyzerNodeInfo.getExpressionType(node.leftExpression);
        if (!baseType) {
            return;
        }

        const memberName = node.memberName.nameToken.value;
        TypeUtils.doForSubtypes(baseType, subtype => {
            let symbol: Symbol | undefined;

            if (subtype.category === TypeCategory.Class) {
                const member = TypeUtils.lookUpClassMember(subtype, memberName);
                if (member) {
                    symbol = member.symbol;
                }
            } else if (subtype.category === TypeCategory.Object) {
                const member = TypeUtils.lookUpObjectMember(subtype, memberName);
                if (member) {
                    symbol = member.symbol;
                }
            } else if (subtype.category === TypeCategory.Module) {
                symbol = subtype.fields.get(memberName);
            }

            if (symbol) {
                const declarations = symbol.getDeclarations();
                this._addResultsForDeclarations(definitions, declarations);
            }

            return subtype;
        });
    }

    private static _addDefinitionsForNameNode(definitions: DocumentTextRange[], node: NameNode) {
        const scopeNode = ParseTreeUtils.getScopeNodeForNode(node);
        if (!scopeNode) {
            return;
        }

        const scope = AnalyzerNodeInfo.getScopeRecursive(scopeNode);
        if (!scope) {
            return;
        }

        const symbolWithScope = scope.lookUpSymbolRecursive(node.nameToken.value);
        if (!symbolWithScope) {
            return;
        }

        const declarations = symbolWithScope.symbol.getDeclarations();
        if (declarations) {
            this._addResultsForDeclarations(definitions, declarations);
        }
    }

    private static _addResultsForDeclarations(definitions: DocumentTextRange[],
            declarations: Declaration[]) {

        declarations.forEach(decl => {
            definitions.push({
                path: decl.path,
                range: decl.range
            });
        });
    }

    private static _addDefinitionsForModuleNameNode(definitions: DocumentTextRange[],
            node: ModuleNameNode, offset: number) {

        // If this is an imported module name, try to map the position
        // to the resolved import path.
        const importInfo = AnalyzerNodeInfo.getImportInfo(node);
        if (!importInfo) {
            return;
        }

        const pathOffset = node.nameParts.findIndex(range => {
            return offset >= range.start && offset < TextRange.getEnd(range);
        });

        if (pathOffset < 0) {
            return;
        }

        // Handle imports that were resolved partially.
        if (pathOffset >= importInfo.resolvedPaths.length) {
            return;
        }

        // If it's a directory, don't return it. The caller expects
        // the path to point to files only.
        const path = importInfo.resolvedPaths[pathOffset];
        if (!isFile(path)) {
            return;
        }

        definitions.push({
            path,
            range: _startOfFileRange
        });
    }
}
