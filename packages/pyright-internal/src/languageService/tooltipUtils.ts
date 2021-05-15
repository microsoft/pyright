/*
 * tooltipUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Tooltip helper methods that can be shared between multiple language server features such as
 * hover and completion tooltip.
 */

import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import {
    getClassDocString,
    getFunctionDocStringInherited,
    getModuleDocString,
    getOverloadedFunctionDocStringsInherited,
    getPropertyDocStringInherited,
    getVariableInStubFileDocStrings,
} from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import {
    FunctionType,
    isClass,
    isFunction,
    isModule,
    isOverloadedFunction,
    OverloadedFunctionType,
    Type,
} from '../analyzer/types';

// 70 is vscode's default hover width size.
export function getOverloadedFunctionTooltip(
    type: OverloadedFunctionType,
    evaluator: TypeEvaluator,
    columnThreshold = 70
) {
    let content = '';
    const overloads = type.overloads.map((o) => o.details.name + evaluator.printType(o, /* expandTypeAlias */ false));

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

export function getDocumentationPartsForTypeAndDecl(
    sourceMapper: SourceMapper,
    type: Type,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator
): string[] {
    if (isModule(type)) {
        const doc = getModuleDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return [doc];
        }
    } else if (isClass(type)) {
        const doc = getClassDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return [doc];
        }
    } else if (isFunction(type)) {
        if (resolvedDecl?.type === DeclarationType.Function || resolvedDecl?.type === DeclarationType.Class) {
            const doc = getFunctionDocStringFromType(type, sourceMapper, evaluator);
            if (doc) {
                return [doc];
            }
        }
    } else if (isOverloadedFunction(type)) {
        const enclosingClass = resolvedDecl ? ParseTreeUtils.getEnclosingClass(resolvedDecl.node) : undefined;
        const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;

        return getOverloadedFunctionDocStringsInherited(
            type,
            resolvedDecl,
            sourceMapper,
            evaluator,
            classResults?.classType
        );
    } else if (resolvedDecl?.type === DeclarationType.Variable) {
        // See whether a variable symbol on the stub is actually a variable. If not, take the doc string.
        return getVariableInStubFileDocStrings(resolvedDecl, sourceMapper);
    } else if (resolvedDecl?.type === DeclarationType.Function) {
        // @property functions
        const doc = getPropertyDocStringInherited(resolvedDecl, sourceMapper, evaluator);
        if (doc) {
            return [doc];
        }
    }

    return [];
}
