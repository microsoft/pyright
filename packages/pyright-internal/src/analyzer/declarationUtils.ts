/*
 * declarationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of static methods that operate on declarations.
 */

import { ParseNodeType } from '../parser/parseNodes';
import { Declaration, DeclarationType } from './declaration';

export function hasTypeForDeclaration(declaration: Declaration): boolean {
    switch (declaration.type) {
        case DeclarationType.Intrinsic:
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
        case DeclarationType.Function:
            return true;

        case DeclarationType.Parameter: {
            if (declaration.node.typeAnnotation) {
                return true;
            }
            const parameterParent = declaration.node.parent;
            if (parameterParent?.nodeType === ParseNodeType.Function) {
                if (
                    parameterParent.functionAnnotationComment &&
                    !parameterParent.functionAnnotationComment.isParamListEllipsis
                ) {
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
    return decl.type === DeclarationType.Variable && !!decl.typeAliasName;
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
