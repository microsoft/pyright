/*
 * tooltipUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Tooltip helper methods that can be shared between multiple language server features such as
 * hover and completion tooltip.
 */

import { Declaration, DeclarationType, VariableDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { Symbol } from '../analyzer/symbol';
import {
    getClassDocString,
    getFunctionDocStringInherited,
    getModuleDocString,
    getModuleDocStringFromPaths,
    getOverloadedFunctionDocStringsInherited,
    getPropertyDocStringInherited,
    getVariableDocString,
} from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    ClassType,
    FunctionType,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloadedFunction,
    OverloadedFunctionType,
    Type,
} from '../analyzer/types';
import { isDefined } from '../common/core';
import { ParseNodeType } from '../parser/parseNodes';

// 70 is vscode's default hover width size.
export function getOverloadedFunctionTooltip(
    type: OverloadedFunctionType,
    evaluator: TypeEvaluator,
    columnThreshold = 70
) {
    let content = '';
    const overloads = OverloadedFunctionType.getOverloads(type).map((o) => o.details.name + evaluator.printType(o));

    for (let i = 0; i < overloads.length; i++) {
        if (i !== 0 && overloads[i].length > columnThreshold && overloads[i - 1].length <= columnThreshold) {
            content += '\n';
        }

        content += overloads[i];

        if (i < overloads.length - 1) {
            content += '\n';
            if (overloads[i].length > columnThreshold) {
                content += '\n';
            }
        }
    }

    return content;
}

export function getFunctionDocStringFromType(type: FunctionType, sourceMapper: SourceMapper, evaluator: TypeEvaluator) {
    const decl = type.details.declaration;
    const enclosingClass = decl ? ParseTreeUtils.getEnclosingClass(decl.node) : undefined;
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;

    return getFunctionDocStringInherited(type, decl, sourceMapper, classResults?.classType);
}

export function getOverloadedFunctionDocStringsFromType(
    type: OverloadedFunctionType,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator
) {
    if (type.overloads.length === 0) {
        return [];
    }

    const decl = type.overloads[0].details.declaration;
    const enclosingClass = decl ? ParseTreeUtils.getEnclosingClass(decl.node) : undefined;
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;

    return getOverloadedFunctionDocStringsInherited(
        type,
        type.overloads.map((o) => o.details.declaration).filter(isDefined),
        sourceMapper,
        evaluator,

        classResults?.classType
    );
}

function getDocumentationPartForTypeAlias(
    sourceMapper: SourceMapper,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator,
    symbol?: Symbol
) {
    if (resolvedDecl?.type === DeclarationType.Variable && resolvedDecl.typeAliasName && resolvedDecl.docString) {
        return resolvedDecl.docString;
    } else if (resolvedDecl?.type === DeclarationType.Variable) {
        const decl = (symbol?.getDeclarations().find((d) => d.type === DeclarationType.Variable && !!d.docString) ??
            resolvedDecl) as VariableDeclaration;
        const doc = getVariableDocString(decl, sourceMapper);
        if (doc) {
            return doc;
        }
    } else if (resolvedDecl?.type === DeclarationType.Function) {
        // @property functions
        const doc = getPropertyDocStringInherited(resolvedDecl, sourceMapper, evaluator);
        if (doc) {
            return doc;
        }
    }
    return undefined;
}

function getDocumentationPartForType(
    sourceMapper: SourceMapper,
    type: Type,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator,
    boundObjectOrClass?: ClassType | undefined
) {
    if (isModule(type)) {
        const doc = getModuleDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return doc;
        }
    } else if (isInstantiableClass(type)) {
        const doc = getClassDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return doc;
        }
    } else if (isFunction(type)) {
        const functionType = boundObjectOrClass
            ? evaluator.bindFunctionToClassOrObject(boundObjectOrClass, type)
            : type;
        if (functionType && isFunction(functionType)) {
            const doc = getFunctionDocStringFromType(functionType, sourceMapper, evaluator);
            if (doc) {
                return doc;
            }
        }
    } else if (isOverloadedFunction(type)) {
        const functionType = boundObjectOrClass
            ? evaluator.bindFunctionToClassOrObject(boundObjectOrClass, type)
            : type;
        if (functionType && isOverloadedFunction(functionType)) {
            const doc = getOverloadedFunctionDocStringsFromType(functionType, sourceMapper, evaluator).find((d) => d);

            if (doc) {
                return doc;
            }
        }
    }
    return undefined;
}

export function getDocumentationPartsForTypeAndDecl(
    sourceMapper: SourceMapper,
    type: Type | undefined,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator,
    optional?: {
        name?: string;
        symbol?: Symbol;
        boundObjectOrClass?: ClassType | undefined;
    }
): string | undefined {
    // Get the alias first
    const aliasDoc = getDocumentationPartForTypeAlias(sourceMapper, resolvedDecl, evaluator, optional?.symbol);

    // Combine this with the type doc
    let typeDoc: string | undefined;
    if (resolvedDecl?.type === DeclarationType.Alias) {
        // Handle another alias decl special case.
        // ex) import X.Y
        //     [X].Y
        // Asking decl for X gives us "X.Y" rather than "X" since "X" is not actually a symbol.
        // We need to get corresponding module name to use special code in type eval for this case.
        if (
            resolvedDecl.type === DeclarationType.Alias &&
            resolvedDecl.node &&
            resolvedDecl.node.nodeType === ParseNodeType.ImportAs &&
            !!optional?.name &&
            !resolvedDecl.node.alias
        ) {
            const name = resolvedDecl.node.module.nameParts.find((n) => n.value === optional.name);
            if (name) {
                const aliasDecls = evaluator.getDeclarationsForNameNode(name) ?? [resolvedDecl];
                resolvedDecl = aliasDecls.length > 0 ? aliasDecls[0] : resolvedDecl;
            }
        }

        typeDoc = getModuleDocStringFromPaths([resolvedDecl.path], sourceMapper);
    }

    typeDoc =
        typeDoc ??
        (type
            ? getDocumentationPartForType(sourceMapper, type, resolvedDecl, evaluator, optional?.boundObjectOrClass)
            : undefined);

    // Combine with a new line if they both exist
    return aliasDoc && typeDoc ? `${aliasDoc}\n\n${typeDoc}` : aliasDoc || typeDoc;
}

export function getAutoImportText(name: string, from?: string, alias?: string): string {
    let text: string | undefined;
    if (!from) {
        text = `import ${name}`;
    } else {
        text = `from ${from} import ${name}`;
    }

    if (alias) {
        text = `${text} as ${alias}`;
    }

    return text;
}
