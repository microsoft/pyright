/*
 * namedTuples.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of named tuple
 * classes with defined entry names and types.
 */

import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    ExpressionNode,
    ParameterCategory,
    ParseNodeType,
    StringListNode,
} from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { DeclarationType, VariableDeclaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isClassInstance,
    isInstantiableClass,
    NoneType,
    Type,
    UnknownType,
} from './types';
import {
    computeMroLinearization,
    convertToInstance,
    isOpenEndedTupleClass,
    isTupleClass,
    specializeTupleClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';

// Creates a new custom tuple factory class with named values.
// Supports both typed and untyped variants.

export function createNamedTupleType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    includesTypes: boolean
): ClassType {
    const fileInfo = getFileInfo(errorNode);
    let className = 'namedtuple';

    if (argList.length === 0) {
        evaluator.addError(Localizer.Diagnostic.namedTupleFirstArg(), errorNode);
    } else {
        const nameArg = argList[0];
        if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
            evaluator.addError(Localizer.Diagnostic.namedTupleFirstArg(), argList[0].valueExpression || errorNode);
        } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
            className = nameArg.valueExpression.strings.map((s) => s.value).join('');
        }
    }

    // Is there is a default arg? If so, is it defined in a way that we
    // can determine its length statically?
    const defaultsArg = argList.find((arg) => arg.name?.value === 'defaults');
    let defaultArgCount: number | undefined = 0;
    if (defaultsArg && defaultsArg.valueExpression) {
        const defaultsArgType = evaluator.getTypeOfExpression(defaultsArg.valueExpression).type;
        if (
            isClassInstance(defaultsArgType) &&
            isTupleClass(defaultsArgType) &&
            !isOpenEndedTupleClass(defaultsArgType) &&
            defaultsArgType.tupleTypeArguments
        ) {
            defaultArgCount = defaultsArgType.tupleTypeArguments.length;
        } else {
            defaultArgCount = undefined;
        }
    }

    const namedTupleType = evaluator.getTypingType(errorNode, 'NamedTuple') || UnknownType.create();

    const classType = ClassType.createInstantiable(
        className,
        ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.filePath,
        ClassTypeFlags.None,
        ParseTreeUtils.getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        isInstantiableClass(namedTupleType) ? namedTupleType.details.effectiveMetaclass : UnknownType.create()
    );
    classType.details.baseClasses.push(namedTupleType);
    classType.details.typeVarScopeId = evaluator.getScopeIdForNode(errorNode);

    const classFields = classType.details.fields;
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );

    const classTypeVar = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ true);
    const constructorType = FunctionType.createInstance(
        '__new__',
        '',
        '',
        FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
    );
    constructorType.details.declaredReturnType = convertToInstance(classTypeVar);
    if (ParseTreeUtils.isAssignmentToDefaultsFollowingNamedTuple(errorNode)) {
        constructorType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
    }
    FunctionType.addParameter(constructorType, {
        category: ParameterCategory.Simple,
        name: 'cls',
        type: classTypeVar,
        hasDeclaredType: true,
    });

    const matchArgsNames: string[] = [];

    const selfParameter: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: 'self',
        type: synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        hasDeclaredType: true,
    };

    let addGenericGetAttribute = false;
    const entryTypes: Type[] = [];

    if (argList.length < 2) {
        evaluator.addError(Localizer.Diagnostic.namedTupleSecondArg(), errorNode);
        addGenericGetAttribute = true;
    } else {
        const entriesArg = argList[1];
        if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
            addGenericGetAttribute = true;
        } else {
            if (
                !includesTypes &&
                entriesArg.valueExpression &&
                entriesArg.valueExpression.nodeType === ParseNodeType.StringList
            ) {
                const entries = entriesArg.valueExpression.strings
                    .map((s) => s.value)
                    .join('')
                    .split(/[,\s]+/);
                const firstParamWithDefaultIndex =
                    defaultArgCount === undefined ? 0 : Math.max(0, entries.length - defaultArgCount);
                entries.forEach((entryName, index) => {
                    entryName = entryName.trim();
                    if (entryName) {
                        const entryType = UnknownType.create();
                        const paramInfo: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: entryName,
                            type: entryType,
                            hasDeclaredType: includesTypes,
                            hasDefault: index >= firstParamWithDefaultIndex,
                        };

                        FunctionType.addParameter(constructorType, paramInfo);
                        const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
                        matchArgsNames.push(entryName);

                        // We need to associate the declaration with a parse node.
                        // In this case it's just part of a string literal value.
                        // The definition provider won't necessarily take the
                        // user to the exact spot in the string, but it's close enough.
                        const stringNode = entriesArg.valueExpression!;
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: stringNode as StringListNode,
                            path: fileInfo.filePath,
                            range: convertOffsetsToRange(
                                stringNode.start,
                                TextRange.getEnd(stringNode),
                                fileInfo.lines
                            ),
                            moduleName: fileInfo.moduleName,
                        };
                        newSymbol.addDeclaration(declaration);
                        classFields.set(entryName, newSymbol);
                        entryTypes.push(entryType);
                    }
                });
            } else if (entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.List) {
                const entryList = entriesArg.valueExpression;
                const entryMap = new Map<string, string>();
                const firstParamWithDefaultIndex =
                    defaultArgCount === undefined ? 0 : Math.max(0, entryList.entries.length - defaultArgCount);

                entryList.entries.forEach((entry, index) => {
                    let entryTypeNode: ExpressionNode | undefined;
                    let entryType: Type | undefined;
                    let entryNameNode: ExpressionNode | undefined;
                    let entryName = '';

                    if (includesTypes) {
                        // Handle the variant that includes name/type tuples.
                        if (entry.nodeType === ParseNodeType.Tuple && entry.expressions.length === 2) {
                            entryNameNode = entry.expressions[0];
                            entryTypeNode = entry.expressions[1];
                            entryType = convertToInstance(
                                evaluator.getTypeForExpressionExpectingType(entryTypeNode, /* allowFinal */ false)
                            );
                        } else {
                            evaluator.addError(Localizer.Diagnostic.namedTupleNameType(), entry);
                        }
                    } else {
                        entryNameNode = entry;
                        entryType = UnknownType.create();
                    }

                    if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                        entryName = entryNameNode.strings.map((s) => s.value).join('');
                        if (!entryName) {
                            evaluator.addError(Localizer.Diagnostic.namedTupleEmptyName(), entryNameNode);
                        }
                    } else {
                        addGenericGetAttribute = true;
                    }

                    if (!entryName) {
                        entryName = `_${index.toString()}`;
                    }

                    if (entryMap.has(entryName)) {
                        evaluator.addError(Localizer.Diagnostic.namedTupleNameUnique(), entryNameNode || entry);
                    }

                    // Record names in a map to detect duplicates.
                    entryMap.set(entryName, entryName);

                    if (!entryType) {
                        entryType = UnknownType.create();
                    }

                    const paramInfo: FunctionParameter = {
                        category: ParameterCategory.Simple,
                        name: entryName,
                        type: entryType,
                        hasDeclaredType: includesTypes,
                        hasDefault: index >= firstParamWithDefaultIndex,
                    };

                    FunctionType.addParameter(constructorType, paramInfo);
                    entryTypes.push(entryType);
                    matchArgsNames.push(entryName);

                    const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
                    if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: entryNameNode,
                            path: fileInfo.filePath,
                            typeAnnotationNode: entryTypeNode,
                            range: convertOffsetsToRange(
                                entryNameNode.start,
                                TextRange.getEnd(entryNameNode),
                                fileInfo.lines
                            ),
                            moduleName: fileInfo.moduleName,
                        };
                        newSymbol.addDeclaration(declaration);
                    }
                    classFields.set(entryName, newSymbol);
                });
            } else {
                // A dynamic expression was used, so we can't evaluate
                // the named tuple statically.
                addGenericGetAttribute = true;
            }
        }
    }

    if (addGenericGetAttribute) {
        constructorType.details.parameters = [];
        FunctionType.addDefaultParameters(constructorType);
        entryTypes.push(AnyType.create(/* isEllipsis */ false));
        entryTypes.push(AnyType.create(/* isEllipsis */ true));
    }

    // Always use generic parameters for __init__. The __new__ method
    // will handle property type checking. We may need to disable default
    // parameter processing for __new__ (see isAssignmentToDefaultsFollowingNamedTuple),
    // and we don't want to do it for __init__ as well.
    const initType = FunctionType.createInstance(
        '__init__',
        '',
        '',
        FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.SkipConstructorCheck
    );
    FunctionType.addParameter(initType, selfParameter);
    FunctionType.addDefaultParameters(initType);
    initType.details.declaredReturnType = NoneType.createInstance();

    classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
    classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

    const keysItemType = FunctionType.createInstance('keys', '', '', FunctionTypeFlags.SynthesizedMethod);
    const itemsItemType = FunctionType.createInstance('items', '', '', FunctionTypeFlags.SynthesizedMethod);
    keysItemType.details.declaredReturnType = evaluator.getBuiltInObject(errorNode, 'list', [
        evaluator.getBuiltInObject(errorNode, 'str'),
    ]);
    itemsItemType.details.declaredReturnType = keysItemType.details.declaredReturnType;
    classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
    classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, itemsItemType));

    const lenType = FunctionType.createInstance('__len__', '', '', FunctionTypeFlags.SynthesizedMethod);
    lenType.details.declaredReturnType = evaluator.getBuiltInObject(errorNode, 'int');
    FunctionType.addParameter(lenType, selfParameter);
    classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

    if (addGenericGetAttribute) {
        const getAttribType = FunctionType.createInstance(
            '__getattribute__',
            '',
            '',
            FunctionTypeFlags.SynthesizedMethod
        );
        getAttribType.details.declaredReturnType = AnyType.create();
        FunctionType.addParameter(getAttribType, selfParameter);
        FunctionType.addParameter(getAttribType, {
            category: ParameterCategory.Simple,
            name: 'name',
            type: evaluator.getBuiltInObject(errorNode, 'str'),
        });
        classFields.set('__getattribute__', Symbol.createWithType(SymbolFlags.ClassMember, getAttribType));
    }

    const tupleClassType = evaluator.getBuiltInType(errorNode, 'tuple');

    // Synthesize the __match_args__ class variable.
    const strType = evaluator.getBuiltInType(errorNode, 'str');
    if (
        !addGenericGetAttribute &&
        strType &&
        isInstantiableClass(strType) &&
        tupleClassType &&
        isInstantiableClass(tupleClassType)
    ) {
        const literalTypes = matchArgsNames.map((name) => {
            return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strType, name));
        });
        const matchArgsType = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, literalTypes));
        classFields.set('__match_args__', Symbol.createWithType(SymbolFlags.ClassMember, matchArgsType));
    }

    computeMroLinearization(classType);

    updateNamedTupleBaseClass(classType, entryTypes, !addGenericGetAttribute);

    return classType;
}

export function updateNamedTupleBaseClass(classType: ClassType, typeArgs: Type[], isTypeArgumentExplicit: boolean) {
    // Search for the NamedTuple base class.
    const namedTupleIndex = classType.details.mro.findIndex(
        (c) => isInstantiableClass(c) && ClassType.isBuiltIn(c, 'NamedTuple')
    );
    if (namedTupleIndex < 0 || classType.details.mro.length < namedTupleIndex + 2) {
        return;
    }

    const namedTupleClass = classType.details.mro[namedTupleIndex] as ClassType;
    const typedTupleClass = classType.details.mro[namedTupleIndex + 1];

    if (!isInstantiableClass(typedTupleClass) || !isTupleClass(typedTupleClass)) {
        return;
    }

    const updatedTupleClass = specializeTupleClass(typedTupleClass, typeArgs, isTypeArgumentExplicit);

    // Create a copy of the NamedTuple class that overrides the normal MRO
    // entries with a version of Tuple that is specialized appropriately.
    const clonedNamedTupleClass = ClassType.cloneForSpecialization(namedTupleClass, [], isTypeArgumentExplicit);
    clonedNamedTupleClass.details = { ...clonedNamedTupleClass.details };
    clonedNamedTupleClass.details.mro = [...clonedNamedTupleClass.details.mro];
    clonedNamedTupleClass.details.mro[1] = updatedTupleClass.details.mro[0];

    clonedNamedTupleClass.details.baseClasses = clonedNamedTupleClass.details.baseClasses.map((baseClass) => {
        if (isInstantiableClass(baseClass) && isTupleClass(baseClass)) {
            return updatedTupleClass;
        }
        return baseClass;
    });

    classType.details.mro[namedTupleIndex] = clonedNamedTupleClass;
    classType.details.mro[namedTupleIndex + 1] = updatedTupleClass;

    classType.details.baseClasses = classType.details.baseClasses.map((baseClass) => {
        if (isInstantiableClass(baseClass) && ClassType.isBuiltIn(baseClass, 'NamedTuple')) {
            return clonedNamedTupleClass;
        }
        return baseClass;
    });
}
