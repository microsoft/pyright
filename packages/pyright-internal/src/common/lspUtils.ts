/*
 * lspUtils.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Helper functions related to the Language Server Protocol (LSP).
 */

import { LSPAny, SymbolKind, WorkDoneProgressReporter } from 'vscode-languageserver';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isMaybeDescriptorInstance } from '../analyzer/typeUtils';

// Converts an internal object to LSPAny to be sent out via LSP
export function toLSPAny(obj: any) {
    return obj as any as LSPAny;
}

// Converts an LSPAny object received via LSP to our internal representation.
export function fromLSPAny<T>(lspAny: LSPAny | undefined) {
    return lspAny as any as T;
}

export function getSymbolKind(declaration: Declaration, evaluator?: TypeEvaluator, name = ''): SymbolKind | undefined {
    switch (declaration.type) {
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
            return SymbolKind.Class;

        case DeclarationType.Function: {
            if (!declaration.isMethod) {
                return SymbolKind.Function;
            }

            const declType = evaluator?.getTypeForDeclaration(declaration)?.type;
            if (declType && isMaybeDescriptorInstance(declType, /* requireSetter */ false)) {
                return SymbolKind.Property;
            }

            return SymbolKind.Method;
        }

        case DeclarationType.Alias:
            return SymbolKind.Module;

        case DeclarationType.Param:
            if (name === 'self' || name === 'cls' || name === '_') {
                return undefined;
            }

            return SymbolKind.Variable;

        case DeclarationType.TypeParam:
            return SymbolKind.TypeParameter;

        case DeclarationType.Variable:
            if (name === '_') {
                return undefined;
            }

            return declaration.isConstant || declaration.isFinal ? SymbolKind.Constant : SymbolKind.Variable;

        default:
            return SymbolKind.Variable;
    }
}

export function isNullProgressReporter(reporter: WorkDoneProgressReporter) {
    // We can't tell if this is a NullProgressReporter (well because this type isn't exposed from vscode-languageserver),
    // but we're going to assume if the toString for the begin method is empty, then it's a NullProgressReporter.
    const beginStr = reporter.begin.toString();
    const contents = beginStr.substring(beginStr.indexOf('{') + 1, beginStr.lastIndexOf('}'));
    return contents.trim() === '';
}
