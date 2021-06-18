/*
 * declarationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of static methods that operate on declarations.
 */

import { ParseNodeType } from '../parser/parseNodes';
import { Declaration, DeclarationType, isAliasDeclaration } from './declaration';
import { getFileInfoFromNode } from './parseTreeUtils';

export function hasTypeForDeclaration(declaration: Declaration): boolean {
    switch (declaration.type) {
        case DeclarationType.Intrinsic:
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
        case DeclarationType.Function:
            return true;

        case DeclarationType.Parameter: {
            if (declaration.node.typeAnnotation || declaration.node.typeAnnotationComment) {
                return true;
            }
            const parameterParent = declaration.node.parent;
            if (parameterParent?.nodeType === ParseNodeType.Function) {
                if (
                    parameterParent.functionAnnotationComment &&
                    !parameterParent.functionAnnotationComment.isParamListEllipsis
                ) {
                    const paramAnnotations = parameterParent.functionAnnotationComment.paramTypeAnnotations;
                    // Handle the case where the annotation comment is missing an
                    // annotation for the first parameter (self or cls).
                    if (
                        parameterParent.parameters.length > paramAnnotations.length &&
                        declaration.node === parameterParent.parameters[0]
                    ) {
                        return false;
                    }
                    return true;
                }
            }
            return false;
        }

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

    if (
        decl1.range.start.line !== decl2.range.start.line ||
        decl1.range.start.character !== decl2.range.start.character
    ) {
        return false;
    }

    // Alias declarations refer to the entire import statement.
    // We need to further differentiate.
    if (decl1.type === DeclarationType.Alias && decl2.type === DeclarationType.Alias) {
        if (
            decl1.symbolName !== decl2.symbolName ||
            decl1.firstNamePart !== decl2.firstNamePart ||
            decl1.usesLocalName !== decl2.usesLocalName
        ) {
            return false;
        }
    }

    return true;
}

export function isFinalVariableDeclaration(decl: Declaration) {
    return decl.type === DeclarationType.Variable && !!decl.isFinal;
}

export function isExplicitTypeAliasDeclaration(decl: Declaration) {
    return decl.type === DeclarationType.Variable && !!decl.typeAliasAnnotation;
}

export function isPossibleTypeAliasDeclaration(decl: Declaration) {
    if (decl.type !== DeclarationType.Variable || !decl.typeAliasName || decl.typeAnnotationNode) {
        return false;
    }

    if (decl.node.parent?.nodeType !== ParseNodeType.Assignment) {
        return false;
    }

    // Perform a sanity check on the RHS expression. Some expression
    // forms should never be considered legitimate for type aliases.
    const rhsOfAssignment = decl.node.parent.rightExpression;
    switch (rhsOfAssignment.nodeType) {
        case ParseNodeType.Error:
        case ParseNodeType.UnaryOperation:
        case ParseNodeType.AssignmentExpression:
        case ParseNodeType.TypeAnnotation:
        case ParseNodeType.Await:
        case ParseNodeType.Ternary:
        case ParseNodeType.Unpack:
        case ParseNodeType.Tuple:
        case ParseNodeType.Call:
        case ParseNodeType.ListComprehension:
        case ParseNodeType.Slice:
        case ParseNodeType.Yield:
        case ParseNodeType.YieldFrom:
        case ParseNodeType.Lambda:
        case ParseNodeType.Number:
        case ParseNodeType.Dictionary:
        case ParseNodeType.List:
        case ParseNodeType.Set:
            return false;
    }

    return true;
}

export function getNameFromDeclaration(declaration: Declaration) {
    switch (declaration.type) {
        case DeclarationType.Alias:
            return declaration.symbolName;

        case DeclarationType.Class:
        case DeclarationType.Function:
            return declaration.node.name.value;

        case DeclarationType.Parameter:
            return declaration.node.name?.value;

        case DeclarationType.Variable:
            return declaration.node.nodeType === ParseNodeType.Name ? declaration.node.value : undefined;

        case DeclarationType.Intrinsic:
        case DeclarationType.SpecialBuiltInClass:
            return undefined;
    }

    throw new Error(`Shouldn't reach here`);
}

export function isDefinedInFile(decl: Declaration, filePath: string) {
    if (isAliasDeclaration(decl)) {
        // Alias decl's path points to the original symbol
        // the alias is pointing to. So, we need to get the
        // filepath in that the alias is defined from the node.
        return getFileInfoFromNode(decl.node)?.filePath === filePath;
    }

    // Other decls, the path points to the file the symbol is defined in.
    return decl.path === filePath;
}
