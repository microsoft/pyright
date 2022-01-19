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
    getVariableDocString,
} from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    FunctionType,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloadedFunction,
    OverloadedFunctionType,
    Type,
} from '../analyzer/types';
import { isDefined } from '../common/core';

// 70 is vscode's default hover width size.
export function getOverloadedFunctionTooltip(
    type: OverloadedFunctionType,
    evaluator: TypeEvaluator,
    columnThreshold = 70
) {
    let content = '';
    const overloads = type.overloads
        .filter((o) => FunctionType.isOverloaded(o))
        .map((o) => o.details.name + evaluator.printType(o, /* expandTypeAlias */ false));

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

export function getDocumentationPartsForTypeAndDecl(
    sourceMapper: SourceMapper,
    type: Type,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator
): string[] {
    if (resolvedDecl?.type === DeclarationType.Variable && resolvedDecl.typeAliasName && resolvedDecl.docString) {
        return [resolvedDecl.docString];
    } else if (isModule(type)) {
        const doc = getModuleDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return [doc];
        }
    } else if (isInstantiableClass(type)) {
        const doc = getClassDocString(type, resolvedDecl, sourceMapper);
        if (doc) {
            return [doc];
        }
    } else if (isFunction(type)) {
        const doc = getFunctionDocStringFromType(type, sourceMapper, evaluator);
        if (doc) {
            return [doc];
        }
    } else if (isOverloadedFunction(type)) {
        return getOverloadedFunctionDocStringsFromType(type, sourceMapper, evaluator);
    } else if (resolvedDecl?.type === DeclarationType.Variable) {
        const doc = getVariableDocString(resolvedDecl, sourceMapper);
        if (doc) {
            return [doc];
        }
    } else if (resolvedDecl?.type === DeclarationType.Function) {
        // @property functions
        const doc = getPropertyDocStringInherited(resolvedDecl, sourceMapper, evaluator);
        if (doc) {
            return [doc];
        }
    }

    return [];
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
