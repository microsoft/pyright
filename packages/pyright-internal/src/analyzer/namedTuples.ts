/*
 * namedTuples.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of named tuple
 * classes with defined entry names and types.
 */

import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { LocMessage } from '../localization/localize';
import {
    ArgumentCategory,
    ExpressionNode,
    ParameterCategory,
    ParseNodeType,
    StringListNode,
} from '../parser/parseNodes';
import { Tokenizer } from '../parser/tokenizer';
import { getFileInfo } from './analyzerNodeInfo';
import { DeclarationType, VariableDeclaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import {
    computeMroLinearization,
    convertToInstance,
    getTypeVarScopeId,
    isLiteralType,
    isTupleClass,
    isUnboundedTupleClass,
    specializeTupleClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    TupleTypeArgument,
    Type,
    UnknownType,
    combineTypes,
    isClassInstance,
    isInstantiableClass,
} from './types';

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

    // The "rename" parameter is supported only in the untyped version.
    let allowRename = false;
    if (!includesTypes) {
        const renameArg = argList.find(
            (arg) => arg.argumentCategory === ArgumentCategory.Simple && arg.name?.value === 'rename'
        );

        if (renameArg?.valueExpression) {
            const renameValue = evaluateStaticBoolExpression(
                renameArg.valueExpression,
                fileInfo.executionEnvironment,
                fileInfo.definedConstants
            );
            if (renameValue === true) {
                allowRename = true;
            }
        }
    }

    if (argList.length === 0) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.namedTupleFirstArg(), errorNode);
    } else {
        const nameArg = argList[0];
        if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportArgumentType,
                LocMessage.namedTupleFirstArg(),
                argList[0].valueExpression || errorNode
            );
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
            !isUnboundedTupleClass(defaultsArgType) &&
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
        fileInfo.fileUri,
        ClassTypeFlags.ReadOnlyInstanceVariables | ClassTypeFlags.ValidTypeAliasClass,
        ParseTreeUtils.getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        isInstantiableClass(namedTupleType) ? namedTupleType.details.effectiveMetaclass : UnknownType.create()
    );
    classType.details.baseClasses.push(namedTupleType);
    classType.details.typeVarScopeId = ParseTreeUtils.getScopeIdForNode(errorNode);

    const classFields = ClassType.getSymbolTable(classType);
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );

    const classTypeVar = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ true);
    const constructorType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
    constructorType.details.declaredReturnType = convertToInstance(classTypeVar);
    constructorType.details.constructorTypeVarScopeId = getTypeVarScopeId(classType);
    if (ParseTreeUtils.isAssignmentToDefaultsFollowingNamedTuple(errorNode)) {
        constructorType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
    }
    constructorType.details.typeVarScopeId = classType.details.typeVarScopeId;
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
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.namedTupleSecondArg(), errorNode);
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
                        entryName = renameKeyword(
                            evaluator,
                            entryName,
                            allowRename,
                            entriesArg.valueExpression!,
                            index
                        );

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
                            isRuntimeTypeExpression: true,
                            uri: fileInfo.fileUri,
                            range: convertOffsetsToRange(
                                stringNode.start,
                                TextRange.getEnd(stringNode),
                                fileInfo.lines
                            ),
                            moduleName: fileInfo.moduleName,
                            isInExceptSuite: false,
                        };
                        newSymbol.addDeclaration(declaration);
                        classFields.set(entryName, newSymbol);
                        entryTypes.push(entryType);
                    }
                });
            } else if (
                entriesArg.valueExpression?.nodeType === ParseNodeType.List ||
                entriesArg.valueExpression?.nodeType === ParseNodeType.Tuple
            ) {
                const entryList = entriesArg.valueExpression;
                const entryMap = new Map<string, string>();
                const entryExpressions =
                    entriesArg.valueExpression?.nodeType === ParseNodeType.List
                        ? entriesArg.valueExpression.entries
                        : entriesArg.valueExpression.expressions;

                const firstParamWithDefaultIndex =
                    defaultArgCount === undefined ? 0 : Math.max(0, entryExpressions.length - defaultArgCount);

                entryExpressions.forEach((entry, index) => {
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
                                evaluator.getTypeOfExpressionExpectingType(entryTypeNode).type
                            );
                        } else {
                            evaluator.addDiagnostic(
                                DiagnosticRule.reportArgumentType,
                                LocMessage.namedTupleNameType(),
                                entry
                            );
                        }
                    } else {
                        entryNameNode = entry;
                        entryType = UnknownType.create();
                    }

                    if (entryNameNode) {
                        const nameTypeResult = evaluator.getTypeOfExpression(entryNameNode);
                        if (
                            isClassInstance(nameTypeResult.type) &&
                            ClassType.isBuiltIn(nameTypeResult.type, 'str') &&
                            isLiteralType(nameTypeResult.type)
                        ) {
                            entryName = nameTypeResult.type.literalValue as string;

                            if (!entryName) {
                                evaluator.addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.namedTupleEmptyName(),
                                    entryNameNode
                                );
                            } else {
                                entryName = renameKeyword(evaluator, entryName, allowRename, entryNameNode, index);
                            }
                        } else {
                            addGenericGetAttribute = true;
                        }
                    } else {
                        addGenericGetAttribute = true;
                    }

                    if (!entryName) {
                        entryName = `_${index.toString()}`;
                    }

                    if (entryMap.has(entryName)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.namedTupleNameUnique(),
                            entryNameNode || entry
                        );
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

                    const newSymbol = Symbol.createWithType(
                        SymbolFlags.InstanceMember | SymbolFlags.NamedTupleMember,
                        entryType
                    );
                    if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: entryNameNode,
                            uri: fileInfo.fileUri,
                            typeAnnotationNode: entryTypeNode,
                            range: convertOffsetsToRange(
                                entryNameNode.start,
                                TextRange.getEnd(entryNameNode),
                                fileInfo.lines
                            ),
                            moduleName: fileInfo.moduleName,
                            isInExceptSuite: false,
                        };
                        newSymbol.addDeclaration(declaration);
                    }
                    classFields.set(entryName, newSymbol);
                });

                // Set the type in the type cache for the dict node so it
                // doesn't get evaluated again.
                evaluator.setTypeResultForNode(entryList, { type: UnknownType.create() });
            } else {
                // A dynamic expression was used, so we can't evaluate
                // the named tuple statically.
                addGenericGetAttribute = true;
            }

            if (entriesArg.valueExpression && !addGenericGetAttribute) {
                // Set the type of the value expression node to Any so we don't attempt to
                // re-evaluate it later, potentially generating "partially unknown" errors
                // in strict mode.
                evaluator.setTypeResultForNode(entriesArg.valueExpression, { type: AnyType.create() });
            }
        }
    }

    if (addGenericGetAttribute) {
        constructorType.details.parameters = [];
        FunctionType.addDefaultParameters(constructorType);
        entryTypes.push(AnyType.create(/* isEllipsis */ false));
        entryTypes.push(AnyType.create(/* isEllipsis */ true));
    }

    // Always use generic parameters for __init__.
    const initType = FunctionType.createSynthesizedInstance('__init__');
    FunctionType.addParameter(initType, selfParameter);
    FunctionType.addDefaultParameters(initType);
    initType.details.declaredReturnType = evaluator.getNoneType();
    initType.details.constructorTypeVarScopeId = getTypeVarScopeId(classType);

    classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
    classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

    const lenType = FunctionType.createSynthesizedInstance('__len__');
    lenType.details.declaredReturnType = evaluator.getBuiltInObject(errorNode, 'int');
    FunctionType.addParameter(lenType, selfParameter);
    classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

    if (addGenericGetAttribute) {
        const getAttribType = FunctionType.createSynthesizedInstance('__getattribute__');
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
        const literalTypes: TupleTypeArgument[] = matchArgsNames.map((name) => {
            return { type: ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strType, name)), isUnbounded: false };
        });
        const matchArgsType = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, literalTypes));
        classFields.set('__match_args__', Symbol.createWithType(SymbolFlags.ClassMember, matchArgsType));
    }

    updateNamedTupleBaseClass(classType, entryTypes, !addGenericGetAttribute);

    computeMroLinearization(classType);

    return classType;
}

export function updateNamedTupleBaseClass(
    classType: ClassType,
    typeArgs: Type[],
    isTypeArgumentExplicit: boolean
): boolean {
    let isUpdateNeeded = false;

    classType.details.baseClasses = classType.details.baseClasses.map((baseClass) => {
        if (!isInstantiableClass(baseClass) || !ClassType.isBuiltIn(baseClass, 'NamedTuple')) {
            return baseClass;
        }

        const tupleTypeArgs: TupleTypeArgument[] = [];

        if (!isTypeArgumentExplicit) {
            tupleTypeArgs.push({
                type: typeArgs.length > 0 ? combineTypes(typeArgs) : UnknownType.create(),
                isUnbounded: true,
            });
        } else {
            typeArgs.forEach((t) => {
                tupleTypeArgs.push({ type: t, isUnbounded: false });
            });
        }

        // Create a copy of the NamedTuple class that replaces the tuple base class.
        const clonedNamedTupleClass = ClassType.cloneForSpecialization(
            baseClass,
            /* typeArguments */ undefined,
            isTypeArgumentExplicit
        );
        clonedNamedTupleClass.details = { ...clonedNamedTupleClass.details };

        clonedNamedTupleClass.details.baseClasses = clonedNamedTupleClass.details.baseClasses.map(
            (namedTupleBaseClass) => {
                if (!isInstantiableClass(namedTupleBaseClass) || !ClassType.isBuiltIn(namedTupleBaseClass, 'tuple')) {
                    return namedTupleBaseClass;
                }

                return specializeTupleClass(namedTupleBaseClass, tupleTypeArgs, isTypeArgumentExplicit);
            }
        );

        computeMroLinearization(clonedNamedTupleClass);

        isUpdateNeeded = true;
        return clonedNamedTupleClass;
    });

    return isUpdateNeeded;
}

function renameKeyword(
    evaluator: TypeEvaluator,
    name: string,
    allowRename: boolean,
    errorNode: ExpressionNode,
    index: number
): string {
    // Determine whether the name is a keyword in python.
    const isKeyword = Tokenizer.isPythonKeyword(name);

    if (!isKeyword) {
        // No rename necessary.
        return name;
    }

    if (allowRename) {
        // Rename based on index.
        return `_${index}`;
    }

    evaluator.addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.namedTupleNameKeyword(), errorNode);
    return name;
}
