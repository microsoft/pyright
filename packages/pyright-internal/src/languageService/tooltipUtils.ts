/*
 * tooltipUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Helper functions for formatting text that can appear in hover text,
 * completion suggestions, etc.
 */

import { getBoundCallMethod } from '../analyzer/constructors';
import { Declaration, DeclarationType, VariableDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { Symbol } from '../analyzer/symbol';
import {
    getClassDocString,
    getFunctionDocStringInherited,
    getModuleDocString,
    getModuleDocStringFromUris,
    getOverloadedDocStringsInherited,
    getPropertyDocStringInherited,
    getVariableDocString,
} from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { MemberAccessFlags, lookUpClassMember } from '../analyzer/typeUtils';
import {
    ClassType,
    FunctionType,
    OverloadedType,
    Type,
    TypeBase,
    TypeCategory,
    UnknownType,
    combineTypes,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloaded,
} from '../analyzer/types';
import { SignatureDisplayType } from '../common/configOptions';
import { isDefined } from '../common/core';
import { ExpressionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';

// The number of spaces to indent each parameter, after moving to a newline in tooltips.
const functionParamIndentOffset = 4;

export function getToolTipForType(
    type: Type,
    label: string,
    name: string,
    evaluator: TypeEvaluator,
    isProperty: boolean,
    functionSignatureDisplay: SignatureDisplayType,
    typeNode?: ExpressionNode
): string {
    // Support __call__ method for class instances to show the signature of the method
    if (type.category === TypeCategory.Class && isClassInstance(type) && typeNode) {
        const callMethodResult = getBoundCallMethod(evaluator, typeNode, type);
        if (
            callMethodResult?.type.category === TypeCategory.Function ||
            callMethodResult?.type.category === TypeCategory.Overloaded
        ) {
            // narrow down specific overload if possible
            const methodType = bindFunctionToClassOrObjectToolTip(evaluator, typeNode, type, callMethodResult.type);
            if (methodType) {
                type = methodType;
            }
        }
    }
    let signatureString = '';
    if (isOverloaded(type)) {
        signatureString = label.length > 0 ? `(${label})\n` : '';
        signatureString += `${getOverloadedTooltip(type, evaluator, functionSignatureDisplay)}`;
    } else if (isFunction(type)) {
        signatureString = `${getFunctionTooltip(label, name, type, evaluator, isProperty, functionSignatureDisplay)}`;
    } else {
        signatureString = label.length > 0 ? `(${label}) ` : '';
        signatureString += `${name}: ${evaluator.printType(type)}`;
    }

    return signatureString;
}

// 70 is vscode's default hover width size.
export function getOverloadedTooltip(
    type: OverloadedType,
    evaluator: TypeEvaluator,
    functionSignatureDisplay: SignatureDisplayType,
    columnThreshold = 70
) {
    let content = '';
    const overloads = OverloadedType.getOverloads(type).map((o) =>
        getFunctionTooltip(
            /* label */ '',
            o.shared.name,
            o,
            evaluator,
            /* isProperty */ false,
            functionSignatureDisplay
        )
    );

    for (let i = 0; i < overloads.length; i++) {
        if (i !== 0 && overloads[i].length > columnThreshold && overloads[i - 1].length <= columnThreshold) {
            content += '\n';
        }

        content += overloads[i] + `: ...`;

        if (i < overloads.length - 1) {
            content += '\n';
            if (overloads[i].length > columnThreshold) {
                content += '\n';
            }
        }
    }

    return content;
}

export function getFunctionTooltip(
    label: string,
    functionName: string,
    type: FunctionType,
    evaluator: TypeEvaluator,
    isProperty = false,
    functionSignatureDisplay: SignatureDisplayType
) {
    const labelFormatted = label.length === 0 ? '' : `(${label}) `;
    const indentStr =
        functionSignatureDisplay === SignatureDisplayType.formatted ? '\n' + ' '.repeat(functionParamIndentOffset) : '';
    const funcParts = evaluator.printFunctionParts(type);
    const paramSignature = `${formatSignature(funcParts, indentStr, functionSignatureDisplay)} -> ${funcParts[1]}`;

    if (TypeBase.isInstantiable(type)) {
        return `${labelFormatted}${functionName}: type[${paramSignature}]`;
    }

    const sep = isProperty ? ': ' : '';
    let defKeyword = '';
    if (!isProperty) {
        defKeyword = 'def ';

        if (FunctionType.isAsync(type)) {
            defKeyword = 'async ' + defKeyword;
        }
    }

    return `${labelFormatted}${defKeyword}${functionName}${sep}${paramSignature}`;
}

export function getConstructorTooltip(
    constructorName: string,
    type: Type,
    evaluator: TypeEvaluator,
    functionSignatureDisplay: SignatureDisplayType
) {
    const classText = `class `;
    let signature = '';

    if (isOverloaded(type)) {
        const overloads = OverloadedType.getOverloads(type).map((overload) =>
            getConstructorTooltip(constructorName, overload, evaluator, functionSignatureDisplay)
        );
        overloads.forEach((overload, index) => {
            signature += overload + ': ...' + '\n\n';
        });
    } else if (isFunction(type)) {
        const indentStr =
            functionSignatureDisplay === SignatureDisplayType.formatted
                ? '\n' + ' '.repeat(functionParamIndentOffset)
                : ' ';
        const funcParts = evaluator.printFunctionParts(type);
        const paramSignature = formatSignature(funcParts, indentStr, functionSignatureDisplay);
        signature += `${classText}${constructorName}${paramSignature}`;
    }
    return signature;
}

// Only formats signature if there is more than one parameter
function formatSignature(
    funcParts: [string[], string],
    indentStr: string,
    functionSignatureDisplay: SignatureDisplayType
) {
    return functionSignatureDisplay === SignatureDisplayType.formatted &&
        funcParts.length > 0 &&
        funcParts[0].length > 1
        ? `(${indentStr}${funcParts[0].join(',' + indentStr)}\n)`
        : `(${funcParts[0].join(', ')})`;
}

export function getFunctionDocStringFromType(type: FunctionType, sourceMapper: SourceMapper, evaluator: TypeEvaluator) {
    const decl = type.shared.declaration;
    const enclosingClass = decl ? ParseTreeUtils.getEnclosingClass(decl.node) : undefined;
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;

    return getFunctionDocStringInherited(type, decl, sourceMapper, classResults?.classType);
}

export function getOverloadedDocStringsFromType(
    type: OverloadedType,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator
) {
    const overloads = OverloadedType.getOverloads(type);
    if (overloads.length === 0) {
        return [];
    }

    const decl = overloads[0].shared.declaration;
    const enclosingClass = decl ? ParseTreeUtils.getEnclosingClass(decl.node) : undefined;
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;

    return getOverloadedDocStringsInherited(
        type,
        overloads.map((o) => o.shared.declaration).filter(isDefined),
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
    if (!resolvedDecl) {
        return undefined;
    }

    if (resolvedDecl.type === DeclarationType.TypeAlias) {
        return resolvedDecl.docString;
    }

    if (resolvedDecl.type === DeclarationType.Variable) {
        if (resolvedDecl.typeAliasName && resolvedDecl.docString) {
            return resolvedDecl.docString;
        }

        const decl = (symbol?.getDeclarations().find((d) => d.type === DeclarationType.Variable && !!d.docString) ??
            resolvedDecl) as VariableDeclaration;
        const doc = getVariableDocString(decl, sourceMapper);
        if (doc) {
            return doc;
        }
    }

    if (resolvedDecl.type === DeclarationType.Function) {
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
    } else if (isOverloaded(type)) {
        const functionType = boundObjectOrClass
            ? evaluator.bindFunctionToClassOrObject(boundObjectOrClass, type)
            : type;
        if (functionType && isOverloaded(functionType)) {
            const doc = getOverloadedDocStringsFromType(functionType, sourceMapper, evaluator).find((d) => d);

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
            !resolvedDecl.node.d.alias
        ) {
            const name = resolvedDecl.node.d.module.d.nameParts.find((n) => n.d.value === optional.name);
            if (name) {
                const aliasDecls = evaluator.getDeclInfoForNameNode(name)?.decls ?? [resolvedDecl];
                resolvedDecl = aliasDecls.length > 0 ? aliasDecls[0] : resolvedDecl;
            }
        }

        typeDoc = getModuleDocStringFromUris([resolvedDecl.uri], sourceMapper);
    }

    typeDoc =
        typeDoc ??
        (type
            ? getDocumentationPartForType(sourceMapper, type, resolvedDecl, evaluator, optional?.boundObjectOrClass)
            : undefined);

    // Combine with a new line if they both exist
    return aliasDoc && typeDoc && aliasDoc !== typeDoc ? `${aliasDoc}\n\n${typeDoc}` : aliasDoc || typeDoc;
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

export function combineExpressionTypes(typeNodes: ExpressionNode[], evaluator: TypeEvaluator): Type {
    const typeList = typeNodes.map((n) => evaluator.getType(n) || UnknownType.create());
    let result = combineTypes(typeList);

    // We're expecting a set of types, if there is only one and the outermost type is a list, take its inner type. This
    // is probably an expression that at runtime would turn into a list.
    if (
        typeList.length === 1 &&
        result.category === TypeCategory.Class &&
        ClassType.isBuiltIn(result, 'list') &&
        result.priv.typeArgs
    ) {
        result = result.priv.typeArgs[0];
    } else if (
        typeList.length === 1 &&
        result.category === TypeCategory.Class &&
        ClassType.isBuiltIn(result, 'range')
    ) {
        result = evaluator.getBuiltInObject(typeNodes[0], 'int');
    }
    return result;
}

export function getClassAndConstructorTypes(node: NameNode, evaluator: TypeEvaluator) {
    // If the class is used as part of a call (i.e. it is being
    // instantiated), include the constructor arguments within the
    // hover text.
    let callLeftNode: ParseNode | undefined = node;

    // Allow the left to be a member access chain (e.g. a.b.c) if the
    // node in question is the last item in the chain.
    if (callLeftNode?.parent?.nodeType === ParseNodeType.MemberAccess && node === callLeftNode.parent.d.member) {
        callLeftNode = node.parent;
        // Allow the left to be a generic class constructor (e.g. foo[int]())
    } else if (callLeftNode?.parent?.nodeType === ParseNodeType.Index) {
        callLeftNode = node.parent;
    }

    if (
        !callLeftNode ||
        !callLeftNode.parent ||
        callLeftNode.parent.nodeType !== ParseNodeType.Call ||
        callLeftNode.parent.d.leftExpr !== callLeftNode
    ) {
        return;
    }

    // Get the init method for this class.
    const classType = getTypeForToolTip(evaluator, node);
    if (!isInstantiableClass(classType)) {
        return;
    }

    const instanceType = getTypeForToolTip(evaluator, callLeftNode.parent);
    if (!isClassInstance(instanceType)) {
        return;
    }

    let methodType: Type | undefined;

    // Try to get the `__init__` method first because it typically has more type information than `__new__`.
    // Don't exclude `object.__init__` since in the plain case we want to show Foo().
    const initMember = lookUpClassMember(classType, '__init__', MemberAccessFlags.SkipInstanceMembers);

    if (initMember) {
        const functionType = evaluator.getTypeOfMember(initMember);

        if (isFunction(functionType) || isOverloaded(functionType)) {
            methodType = bindFunctionToClassOrObjectToolTip(evaluator, node, instanceType, functionType);
        }
    }

    // If there was no `__init__`, excluding `object` class `__init__`, or if `__init__` only had default params (*args: Any, **kwargs: Any) or no params (),
    // see if we can find a better `__new__` method.
    if (
        !methodType ||
        (methodType &&
            isFunction(methodType) &&
            (FunctionType.hasDefaultParams(methodType) || methodType.shared.parameters.length === 0))
    ) {
        const newMember = lookUpClassMember(
            classType,
            '__new__',
            MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.SkipInstanceMembers
        );

        if (newMember) {
            const newMemberType = evaluator.getTypeOfMember(newMember);

            // Prefer `__new__` if it doesn't have default params (*args: Any, **kwargs: Any) or no params ().
            if (isFunction(newMemberType) || isOverloaded(newMemberType)) {
                // Set `treatConstructorAsClassMethod` to true to exclude `cls` as a parameter.
                methodType = bindFunctionToClassOrObjectToolTip(
                    evaluator,
                    node,
                    instanceType,
                    newMemberType,
                    /* treatConstructorAsClassMethod */ true
                );
            }
        }
    }

    return { methodType, classType };
}

export function bindFunctionToClassOrObjectToolTip(
    evaluator: TypeEvaluator,
    node: ExpressionNode,
    baseType: ClassType | undefined,
    memberType: FunctionType | OverloadedType,
    treatConstructorAsClassMethod?: boolean
): FunctionType | OverloadedType | undefined {
    const methodType = evaluator.bindFunctionToClassOrObject(
        baseType,
        memberType,
        /* memberClass */ undefined,
        treatConstructorAsClassMethod
    );

    if (!methodType) {
        return undefined;
    }

    return limitOverloadBasedOnCall(evaluator, methodType, node);
}

export function limitOverloadBasedOnCall<T extends Type>(
    evaluator: TypeEvaluator,
    type: T,
    node: ExpressionNode
): T | FunctionType | OverloadedType {
    // If it's an overloaded function, see if it's part of a call expression.
    // If so, we may be able to eliminate some of the overloads based on
    // the overload resolution.
    if (!isOverloaded(type) || node.nodeType !== ParseNodeType.Name) {
        return type;
    }

    const callNode = ParseTreeUtils.getCallForName(node);
    if (!callNode) {
        return type;
    }

    const callTypeResult = evaluator.getTypeResult(callNode);
    if (!callTypeResult || !callTypeResult.overloadsUsedForCall || callTypeResult.overloadsUsedForCall.length === 0) {
        return type;
    }

    if (callTypeResult.overloadsUsedForCall.length === 1) {
        return callTypeResult.overloadsUsedForCall[0];
    }

    return OverloadedType.create(callTypeResult.overloadsUsedForCall);
}

export function getTypeForToolTip(evaluator: TypeEvaluator, node: ExpressionNode) {
    // It does common work necessary for hover for a type we got
    // from raw type evaluator.
    const type = evaluator.getType(node) ?? UnknownType.create();
    return limitOverloadBasedOnCall(evaluator, type, node);
}
