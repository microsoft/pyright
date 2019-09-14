/*
* declarationUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on declarations.
*/

import { NameNode, ParseNodeType } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { Declaration } from './declaration';
import { ParseTreeUtils } from './parseTreeUtils';
import { Symbol } from './symbol';
import { ClassType, ModuleType, ObjectType } from './types';
import { TypeUtils } from './typeUtils';

export namespace DeclarationUtils {
    export function getDeclarationsForNameNode(node: NameNode): Declaration[] | undefined {
        let declarations: Declaration[] | undefined;
        const nameValue = node.nameToken.value;

        if (node.parent && node.parent.nodeType === ParseNodeType.MemberAccess &&
                node === node.parent.memberName) {

            const baseType = AnalyzerNodeInfo.getExpressionType(node.parent.leftExpression);
            if (baseType) {
                const memberName = node.parent.memberName.nameToken.value;
                TypeUtils.doForSubtypes(baseType, subtype => {
                    let symbol: Symbol | undefined;

                    if (subtype instanceof ClassType) {
                        const member = TypeUtils.lookUpClassMember(subtype, memberName);
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (subtype instanceof ObjectType) {
                        const member = TypeUtils.lookUpObjectMember(subtype, memberName);
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (subtype instanceof ModuleType) {
                        symbol = subtype.fields.get(memberName);
                    }

                    if (symbol) {
                        declarations = symbol.getDeclarations();
                    }

                    return subtype;
                });
            }
        } else {
            const scopeNode = ParseTreeUtils.getScopeNodeForNode(node);
            if (scopeNode) {
                const scope = AnalyzerNodeInfo.getScopeRecursive(scopeNode);
                if (scope) {
                    const symbolInScope = scope.lookUpSymbolRecursive(nameValue);
                    if (!symbolInScope) {
                        return;
                    }

                    declarations = symbolInScope.symbol.getDeclarations();
                }
            }
        }

        return declarations;
    }
}
