/*
* declarationUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on declarations.
*/

import { NameNode, ParseNodeType } from '../parser/parseNodes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol } from './symbol';
import { TypeCategory } from './types';
import * as TypeUtils from './typeUtils';

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
