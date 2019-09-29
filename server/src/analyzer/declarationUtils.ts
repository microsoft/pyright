/*
* declarationUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on declarations.
*/

import * as assert from 'assert';

import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationType } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol } from './symbol';
import { ClassType, ObjectType, Type, TypeCategory, UnknownType } from './types';
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

export function isFunctionOrMethodDeclaration(declaration: Declaration) {
    return declaration.type === DeclarationType.Method || declaration.type === DeclarationType.Function;
}

export function resolveDeclarationAliases(declaration: Declaration) {
    let resolvedDeclaration: Declaration | undefined = declaration;
    while (resolvedDeclaration && resolvedDeclaration.type === DeclarationType.Alias) {
        resolvedDeclaration = resolvedDeclaration.resolvedDeclarations ?
            resolvedDeclaration.resolvedDeclarations[0] : undefined;
    }

    return resolvedDeclaration;
}

export function getTypeForDeclaration(declaration: Declaration): Type | undefined {
    const resolvedDeclaration = resolveDeclarationAliases(declaration);

    if (!resolvedDeclaration) {
        return undefined;
    }

    switch (resolvedDeclaration.type) {
        case DeclarationType.BuiltIn:
            return resolvedDeclaration.declaredType;

        case DeclarationType.Class:
            return AnalyzerNodeInfo.getExpressionType(resolvedDeclaration.node.name);

        case DeclarationType.Function:
        case DeclarationType.Method:
            return AnalyzerNodeInfo.getExpressionType(resolvedDeclaration.node.name);

        case DeclarationType.Parameter: {
            let typeAnnotationNode = resolvedDeclaration.node.typeAnnotation;
            if (typeAnnotationNode && typeAnnotationNode.nodeType === ParseNodeType.StringList) {
                typeAnnotationNode = typeAnnotationNode.typeAnnotation;
            }
            if (typeAnnotationNode) {
                const declaredType = AnalyzerNodeInfo.getExpressionType(typeAnnotationNode);

                if (declaredType) {
                    return TypeUtils.convertClassToObject(declaredType);
                }
            }
            return undefined;
        }

        case DeclarationType.Variable: {
            let typeAnnotationNode = resolvedDeclaration.typeAnnotationNode;
            if (typeAnnotationNode && typeAnnotationNode.nodeType === ParseNodeType.StringList) {
                typeAnnotationNode = typeAnnotationNode.typeAnnotation;
            }
            if (typeAnnotationNode) {
                let declaredType = AnalyzerNodeInfo.getExpressionType(typeAnnotationNode);
                if (declaredType) {
                    // Apply enum transform if appropriate.
                    declaredType = transformTypeForPossibleEnumClass(typeAnnotationNode, declaredType);
                    return TypeUtils.convertClassToObject(declaredType);
                }
            }
            return undefined;
        }

        case DeclarationType.Module:
            return resolvedDeclaration.moduleType;
    }
}

export function hasTypeForDeclaration(declaration: Declaration, resolveAliases = true): boolean {
    const resolvedDeclaration = resolveAliases ?
        resolveDeclarationAliases(declaration) : declaration;

    if (!resolvedDeclaration) {
        return false;
    }

    switch (resolvedDeclaration.type) {
        case DeclarationType.BuiltIn:
        case DeclarationType.Class:
        case DeclarationType.Function:
        case DeclarationType.Method:
            return true;

        case DeclarationType.Parameter:
            return !!resolvedDeclaration.node.typeAnnotation;

        case DeclarationType.Variable:
            return !!resolvedDeclaration.typeAnnotationNode;

        case DeclarationType.Module:
            return true;

        case DeclarationType.Alias:
            return false;
    }
}

export function areDeclarationsSame(decl1: Declaration, decl2: Declaration): boolean {
    if (decl1.type !== decl2.type) {
        return false;
    }

    if (decl1.path !== decl2.path) {
        return false;
    }

    if (decl1.range.start.line !== decl2.range.start.line ||
            decl1.range.start.column !== decl2.range.start.column) {
        return false;
    }

    return true;
}

export function transformTypeForPossibleEnumClass(node: ParseNode, typeOfExpr: Type): Type {
    const enumClass = _getEnclosingEnumClass(node);

    if (enumClass) {
        // The type of each enumerated item is an instance of the enum class.
        return ObjectType.create(enumClass);
    }

    return typeOfExpr;
}

// If the node is within a class that derives from the metaclass
// "EnumMeta", we need to treat assignments differently.
function _getEnclosingEnumClass(node: ParseNode): ClassType | undefined {
    const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
    if (enclosingClassNode) {
        const enumClass = AnalyzerNodeInfo.getExpressionType(enclosingClassNode) as ClassType;
        assert(enumClass.category === TypeCategory.Class);

        // Handle several built-in classes specially. We don't
        // want to interpret their class variables as enumerations.
        if (ClassType.isBuiltIn(enumClass)) {
            const className = ClassType.getClassName(enumClass);
            const builtInEnumClasses = ['Enum', 'IntEnum', 'Flag', 'IntFlag'];
            if (builtInEnumClasses.find(c => c === className)) {
                return undefined;
            }
        }

        if (TypeUtils.isEnumClass(enumClass)) {
            return enumClass;
        }
    }

    return undefined;
}
