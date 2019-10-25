/*
* declarationUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on declarations.
*/

import * as assert from 'assert';

import { getEmptyRange } from '../common/diagnostic';
import { FunctionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ImportLookup, ImportLookupResult } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType, ModuleLoaderActions } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol } from './symbol';
import { ClassType, FunctionType, ModuleType, ObjectType, Type, TypeCategory } from './types';
import * as TypeUtils from './typeUtils';

export function getDeclarationsForNameNode(node: NameNode): Declaration[] | undefined {
    const declarations: Declaration[] = [];
    const nameValue = node.nameToken.value;

    // If the node is part of a "from X import Y as Z" statement and the node
    // is the "Y" (non-aliased) name, don't return any declarations for it
    // because this name isn't in the symbol table.
    if (node.parent && node.parent.nodeType === ParseNodeType.ImportFromAs &&
            node.parent.alias && node === node.parent.name) {

        return undefined;
    }

    if (node.parent && node.parent.nodeType === ParseNodeType.MemberAccess &&
            node === node.parent.memberName) {

        const baseType = AnalyzerNodeInfo.getExpressionType(node.parent.leftExpression);
        if (baseType) {
            const memberName = node.parent.memberName.nameToken.value;
            TypeUtils.doForSubtypes(baseType, subtype => {
                let symbol: Symbol | undefined;

                if (subtype.category === TypeCategory.Class) {
                    // Try to find a member that has a declared type. If so, that
                    // overrides any inferred types.
                    let member = TypeUtils.lookUpClassMember(subtype, memberName,
                        TypeUtils.ClassMemberLookupFlags.DeclaredTypesOnly);
                    if (!member) {
                        member = TypeUtils.lookUpClassMember(subtype, memberName);
                    }
                    if (member) {
                        symbol = member.symbol;
                    }
                } else if (subtype.category === TypeCategory.Object) {
                    // Try to find a member that has a declared type. If so, that
                    // overrides any inferred types.
                    let member = TypeUtils.lookUpObjectMember(subtype, memberName,
                        TypeUtils.ClassMemberLookupFlags.DeclaredTypesOnly);
                    if (!member) {
                        member = TypeUtils.lookUpObjectMember(subtype, memberName);
                    }
                    if (member) {
                        symbol = member.symbol;
                    }
                } else if (subtype.category === TypeCategory.Module) {
                    symbol = ModuleType.getField(subtype, memberName);
                }

                if (symbol) {
                    const typedDecls = symbol.getTypedDeclarations();
                    if (typedDecls.length > 0) {
                        declarations.push(...typedDecls);
                    } else {
                        declarations.push(...symbol.getDeclarations());
                    }
                }

                return subtype;
            });
        }
    } else if (node.parent && node.parent.nodeType === ParseNodeType.ModuleName) {
        const namePartIndex = node.parent.nameParts.findIndex(part => part === node);
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.parent);
        if (namePartIndex >= 0 && importInfo && namePartIndex < importInfo.resolvedPaths.length) {
            if (importInfo.resolvedPaths[namePartIndex]) {
                // Synthesize an alias declaration for this name part. The only
                // time this case is used is for the hover provider.
                const aliasDeclaration: AliasDeclaration = {
                    type: DeclarationType.Alias,
                    node: undefined!,
                    path: importInfo.resolvedPaths[namePartIndex],
                    range: getEmptyRange(),
                    implicitImports: new Map<string, ModuleLoaderActions>()
                };
                declarations.push(aliasDeclaration);
            }
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

                declarations.push(...symbolInScope.symbol.getDeclarations());
            }
        }
    }

    return declarations;
}

export function isFunctionOrMethodDeclaration(declaration: Declaration) {
    return declaration.type === DeclarationType.Method || declaration.type === DeclarationType.Function;
}

// If the specified declaration is an alias declaration that points
// to a symbol, it resolves the alias and looks up the symbol, then
// returns the first declaration associated with that symbol. It does
// this recursively if necessary. If a symbol lookup fails, undefined
// is returned.
export function resolveAliasDeclaration(declaration: Declaration, importLookup: ImportLookup):
        Declaration | undefined {

    let curDeclaration: Declaration | undefined = declaration;
    const alreadyVisited: Declaration[] = [];

    while (true) {
        if (curDeclaration.type !== DeclarationType.Alias) {
            return curDeclaration;
        }

        if (!curDeclaration.symbolName) {
            return curDeclaration;
        }

        let lookupResult: ImportLookupResult | undefined;
        if (curDeclaration.path) {
            lookupResult = importLookup(curDeclaration.path);
            if (!lookupResult) {
                return undefined;
            }
        }

        const symbol: Symbol | undefined = lookupResult ?
            lookupResult.symbolTable.get(curDeclaration.symbolName) :
            undefined;
        if (!symbol) {
            if (curDeclaration.submoduleFallback) {
                return resolveAliasDeclaration(curDeclaration.submoduleFallback, importLookup);
            }
            return undefined;
        }

        const declarations = symbol.getDeclarations();
        if (declarations.length === 0) {
            return undefined;
        }

        curDeclaration = declarations[0];

        // Make sure we don't follow a circular list indefinitely.
        if (alreadyVisited.find(decl => decl === curDeclaration)) {
            return declaration;
        }
        alreadyVisited.push(curDeclaration);
    }
}

export function getTypeForDeclaration(declaration: Declaration): Type | undefined {
    switch (declaration.type) {
        case DeclarationType.BuiltIn:
            return declaration.declaredType;

        case DeclarationType.Class:
            return AnalyzerNodeInfo.getExpressionType(declaration.node.name);

        case DeclarationType.Function:
        case DeclarationType.Method:
            return AnalyzerNodeInfo.getExpressionType(declaration.node.name);

        case DeclarationType.Parameter: {
            let typeAnnotationNode = declaration.node.typeAnnotation;
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
            let typeAnnotationNode = declaration.typeAnnotationNode;
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

        case DeclarationType.Alias: {
            return undefined;
        }
    }
}

export function hasTypeForDeclaration(declaration: Declaration): boolean {
    switch (declaration.type) {
        case DeclarationType.BuiltIn:
        case DeclarationType.Class:
        case DeclarationType.Function:
        case DeclarationType.Method:
            return true;

        case DeclarationType.Parameter:
            return !!declaration.node.typeAnnotation;

        case DeclarationType.Variable:
            return !!declaration.typeAnnotationNode;

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

export function getFunctionDeclaredReturnType(node: FunctionNode): Type | undefined {
    const functionType = AnalyzerNodeInfo.getExpressionType(node) as FunctionType;

    if (functionType) {
        assert(functionType.category === TypeCategory.Function);

        // Ignore this check for abstract methods, which often
        // don't actually return any value.
        if (FunctionType.isAbstractMethod(functionType)) {
            return undefined;
        }

        if (FunctionType.isGenerator(functionType)) {
            return TypeUtils.getDeclaredGeneratorReturnType(functionType);
        } else {
            return FunctionType.getDeclaredReturnType(functionType);
        }
    }

    return undefined;
}
