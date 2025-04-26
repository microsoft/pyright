/*
 * typedDicts.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of TypedDict
 * classes.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { LocAddendum, LocMessage } from '../localization/localize';
import {
    ArgCategory,
    ClassNode,
    DictionaryNode,
    ExpressionNode,
    IndexNode,
    ParamCategory,
    ParseNodeType,
} from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { ConstraintTracker } from './constraintTracker';
import { DeclarationType, VariableDeclaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { getLastTypedDeclarationForSymbol } from './symbolUtils';
import {
    Arg,
    AssignTypeFlags,
    EvaluatorUsage,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
} from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isNever,
    maxTypeRecursionCount,
    NeverType,
    OverloadedType,
    Type,
    TypedDictEntries,
    TypedDictEntry,
    TypeVarScopeType,
    TypeVarType,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    buildSolutionFromSpecializedClass,
    computeMroLinearization,
    convertToInstance,
    getTypeVarScopeId,
    isLiteralType,
    mapSubtypes,
    partiallySpecializeType,
    specializeTupleClass,
} from './typeUtils';

// Creates a new custom TypedDict "alternate syntax" factory class.
export function createTypedDictType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    typedDictClass: ClassType,
    argList: Arg[]
): ClassType {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);

    // TypedDict supports two different syntaxes:
    // Point2D = TypedDict('Point2D', {'x': int, 'y': int, 'label': str})
    // Point2D = TypedDict('Point2D', x=int, y=int, label=str)
    let className: string | undefined;
    if (argList.length === 0) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.typedDictFirstArg(), errorNode);
    } else {
        const nameArg = argList[0];
        if (
            nameArg.argCategory !== ArgCategory.Simple ||
            !nameArg.valueExpression ||
            nameArg.valueExpression.nodeType !== ParseNodeType.StringList
        ) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportArgumentType,
                LocMessage.typedDictFirstArg(),
                argList[0].valueExpression || errorNode
            );
        } else {
            className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        }
    }

    const effectiveClassName = className || 'TypedDict';
    const classType = ClassType.createInstantiable(
        effectiveClassName,
        ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, effectiveClassName),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.TypedDictClass | ClassTypeFlags.ValidTypeAliasClass,
        ParseTreeUtils.getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        typedDictClass.shared.effectiveMetaclass
    );
    classType.shared.baseClasses.push(typedDictClass);
    computeMroLinearization(classType);

    const classFields = ClassType.getSymbolTable(classType);
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );

    let usingDictSyntax = false;
    if (argList.length < 2) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.typedDictSecondArgDict(), errorNode);
    } else {
        const entriesArg = argList[1];

        if (
            entriesArg.argCategory === ArgCategory.Simple &&
            entriesArg.valueExpression &&
            entriesArg.valueExpression.nodeType === ParseNodeType.Dictionary
        ) {
            usingDictSyntax = true;

            getTypedDictFieldsFromDictSyntax(evaluator, entriesArg.valueExpression, classFields, /* isInline */ false);
        } else if (entriesArg.name) {
            const entrySet = new Set<string>();
            for (let i = 1; i < argList.length; i++) {
                const entry = argList[i];
                if (!entry.name || !entry.valueExpression) {
                    continue;
                }

                if (entrySet.has(entry.name.d.value)) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typedDictEntryUnique(),
                        entry.valueExpression
                    );
                    continue;
                }

                // Record names in a map to detect duplicates.
                entrySet.add(entry.name.d.value);

                const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: entry.name,
                    uri: fileInfo.fileUri,
                    typeAnnotationNode: entry.valueExpression,
                    isRuntimeTypeExpression: true,
                    range: convertOffsetsToRange(
                        entry.name.start,
                        TextRange.getEnd(entry.valueExpression),
                        fileInfo.lines
                    ),
                    moduleName: fileInfo.moduleName,
                    isInExceptSuite: false,
                };
                newSymbol.addDeclaration(declaration);

                classFields.set(entry.name.d.value, newSymbol);
            }
        } else {
            evaluator.addDiagnostic(DiagnosticRule.reportArgumentType, LocMessage.typedDictSecondArgDict(), errorNode);
        }
    }

    if (usingDictSyntax) {
        const argsToConsider = argList.slice(2);
        let sawClosedOrExtraItems = false;

        for (const arg of argsToConsider) {
            if (arg.name?.d.value === 'total' || arg.name?.d.value === 'closed') {
                if (
                    !arg.valueExpression ||
                    arg.valueExpression.nodeType !== ParseNodeType.Constant ||
                    !(
                        arg.valueExpression.d.constType === KeywordType.False ||
                        arg.valueExpression.d.constType === KeywordType.True
                    )
                ) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typedDictBoolParam().format({ name: arg.name.d.value }),
                        arg.valueExpression || errorNode
                    );
                } else if (arg.name.d.value === 'total' && arg.valueExpression.d.constType === KeywordType.False) {
                    classType.shared.flags |= ClassTypeFlags.CanOmitDictValues;
                } else if (
                    arg.name.d.value === 'closed' &&
                    AnalyzerNodeInfo.getFileInfo(errorNode).diagnosticRuleSet.enableExperimentalFeatures
                ) {
                    if (arg.valueExpression.d.constType === KeywordType.True) {
                        classType.shared.flags |=
                            ClassTypeFlags.TypedDictMarkedClosed | ClassTypeFlags.TypedDictEffectivelyClosed;
                    }

                    if (sawClosedOrExtraItems) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typedDictExtraItemsClosed(),
                            arg.valueExpression || errorNode
                        );
                    }

                    sawClosedOrExtraItems = true;
                }
            } else if (
                arg.name?.d.value === 'extra_items' &&
                AnalyzerNodeInfo.getFileInfo(errorNode).diagnosticRuleSet.enableExperimentalFeatures
            ) {
                classType.shared.typedDictExtraItemsExpr = arg.valueExpression;
                classType.shared.flags |= ClassTypeFlags.TypedDictEffectivelyClosed;

                if (sawClosedOrExtraItems) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typedDictExtraItemsClosed(),
                        arg.valueExpression || errorNode
                    );
                }

                sawClosedOrExtraItems = true;
            } else {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.typedDictExtraArgs(),
                    arg.valueExpression || errorNode
                );
            }
        }
    }

    synthesizeTypedDictClassMethods(evaluator, errorNode, classType);

    // Validate that the assigned variable name is consistent with the provided name.
    if (errorNode.parent?.nodeType === ParseNodeType.Assignment && className) {
        const target = errorNode.parent.d.leftExpr;
        const typedDictTarget = target.nodeType === ParseNodeType.TypeAnnotation ? target.d.valueExpr : target;

        if (typedDictTarget.nodeType === ParseNodeType.Name) {
            if (typedDictTarget.d.value !== className) {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typedDictAssignedName().format({
                        name: className,
                    }),
                    typedDictTarget
                );
            }
        }
    }

    return classType;
}

// Creates a new anonymous TypedDict class from an inlined dict[{}] type annotation.
export function createTypedDictTypeInlined(
    evaluator: TypeEvaluator,
    dictNode: DictionaryNode,
    typedDictClass: ClassType
): ClassType {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(dictNode);
    const className = '<TypedDict>';

    const classType = ClassType.createInstantiable(
        className,
        ParseTreeUtils.getClassFullName(dictNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.TypedDictClass,
        ParseTreeUtils.getTypeSourceId(dictNode),
        /* declaredMetaclass */ undefined,
        typedDictClass.shared.effectiveMetaclass
    );
    classType.shared.baseClasses.push(typedDictClass);
    computeMroLinearization(classType);

    getTypedDictFieldsFromDictSyntax(evaluator, dictNode, ClassType.getSymbolTable(classType), /* isInline */ true);
    synthesizeTypedDictClassMethods(evaluator, dictNode, classType);

    return classType;
}

export function synthesizeTypedDictClassMethods(
    evaluator: TypeEvaluator,
    node: ClassNode | ExpressionNode,
    classType: ClassType
) {
    assert(ClassType.isTypedDictClass(classType));

    // Synthesize a __new__ method.
    const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
    FunctionType.addParam(
        newType,
        FunctionParam.create(ParamCategory.Simple, classType, FunctionParamFlags.TypeDeclared, 'cls')
    );
    FunctionType.addDefaultParams(newType);
    newType.shared.declaredReturnType = ClassType.cloneAsInstance(classType);
    newType.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

    // Synthesize an __init__ method with two overrides.
    const initOverride1 = FunctionType.createSynthesizedInstance('__init__', FunctionTypeFlags.Overloaded);
    FunctionType.addParam(
        initOverride1,
        FunctionParam.create(
            ParamCategory.Simple,
            ClassType.cloneAsInstance(classType),
            FunctionParamFlags.TypeDeclared,
            'self'
        )
    );
    initOverride1.shared.declaredReturnType = evaluator.getNoneType();
    initOverride1.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

    // The first parameter must be positional-only.
    FunctionType.addParam(
        initOverride1,
        FunctionParam.create(
            ParamCategory.Simple,
            ClassType.cloneAsInstance(classType),
            FunctionParamFlags.TypeDeclared,
            '__map'
        )
    );

    const entries = getTypedDictMembersForClass(evaluator, classType);
    const extraEntriesInfo = entries.extraItems ?? getEffectiveExtraItemsEntryType(evaluator, classType);
    let allEntriesAreReadOnly = entries.knownItems.size > 0;

    if (entries.knownItems.size > 0) {
        FunctionType.addPositionOnlyParamSeparator(initOverride1);

        // All subsequent parameters must be named, so insert an empty "*".
        FunctionType.addKeywordOnlyParamSeparator(initOverride1);
    }

    const initOverride2 = FunctionType.createSynthesizedInstance('__init__', FunctionTypeFlags.Overloaded);
    FunctionType.addParam(
        initOverride2,
        FunctionParam.create(
            ParamCategory.Simple,
            ClassType.cloneAsInstance(classType),
            FunctionParamFlags.TypeDeclared,
            'self'
        )
    );
    initOverride2.shared.declaredReturnType = evaluator.getNoneType();
    initOverride2.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

    if (entries.knownItems.size > 0) {
        // All parameters must be named, so insert an empty "*".
        FunctionType.addKeywordOnlyParamSeparator(initOverride2);
    }

    entries.knownItems.forEach((entry, name) => {
        FunctionType.addParam(
            initOverride1,
            FunctionParam.create(
                ParamCategory.Simple,
                entry.valueType,
                FunctionParamFlags.TypeDeclared,
                name,
                entry.valueType
            )
        );

        FunctionType.addParam(
            initOverride2,
            FunctionParam.create(
                ParamCategory.Simple,
                entry.valueType,
                FunctionParamFlags.TypeDeclared,
                name,
                entry.isRequired ? undefined : entry.valueType
            )
        );

        if (!entry.isReadOnly) {
            allEntriesAreReadOnly = false;
        }
    });

    if (entries.extraItems && !isNever(entries.extraItems.valueType)) {
        FunctionType.addParam(
            initOverride1,
            FunctionParam.create(
                ParamCategory.KwargsDict,
                entries.extraItems.valueType,
                FunctionParamFlags.TypeDeclared,
                'kwargs'
            )
        );

        FunctionType.addParam(
            initOverride2,
            FunctionParam.create(
                ParamCategory.KwargsDict,
                entries.extraItems.valueType,
                FunctionParamFlags.TypeDeclared,
                'kwargs'
            )
        );
    }

    const symbolTable = ClassType.getSymbolTable(classType);
    const initType = OverloadedType.create([initOverride1, initOverride2]);
    symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
    symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

    const strClass = evaluator.getBuiltInType(node, 'str');

    // Synthesize a "get", pop, and setdefault method for each named entry.
    if (isInstantiableClass(strClass)) {
        const selfParam = FunctionParam.create(
            ParamCategory.Simple,
            ClassType.cloneAsInstance(classType),
            FunctionParamFlags.TypeDeclared,
            'self'
        );

        function createDefaultTypeVar(func: FunctionType) {
            let defaultTypeVar = TypeVarType.createInstance(`__TDefault`);
            defaultTypeVar = TypeVarType.cloneForScopeId(
                defaultTypeVar,
                func.shared.typeVarScopeId!,
                classType.shared.name,
                TypeVarScopeType.Function
            );
            return defaultTypeVar;
        }

        function createGetMethod(
            keyType: Type,
            valueType: Type,
            includeDefault: boolean,
            isEntryRequired = false,
            defaultTypeMatchesField = false
        ) {
            const getOverload = FunctionType.createSynthesizedInstance('get', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(getOverload, selfParam);
            getOverload.shared.typeVarScopeId = ParseTreeUtils.getScopeIdForNode(node);
            FunctionType.addParam(
                getOverload,
                FunctionParam.create(ParamCategory.Simple, keyType, FunctionParamFlags.TypeDeclared, 'k')
            );

            if (includeDefault) {
                const defaultTypeVar = createDefaultTypeVar(getOverload);
                let defaultParamType: Type;
                let returnType: Type;

                if (isEntryRequired) {
                    // If the entry is required, the type of the default param doesn't matter
                    // because the type will always come from the value.
                    defaultParamType = AnyType.create();
                    returnType = valueType;
                } else {
                    if (defaultTypeMatchesField) {
                        defaultParamType = valueType;
                    } else {
                        defaultParamType = combineTypes([valueType, defaultTypeVar]);
                    }

                    returnType = defaultParamType;
                }

                FunctionType.addParam(
                    getOverload,
                    FunctionParam.create(
                        ParamCategory.Simple,
                        defaultParamType,
                        FunctionParamFlags.TypeDeclared,
                        'default'
                    )
                );
                getOverload.shared.declaredReturnType = returnType;
            } else {
                getOverload.shared.declaredReturnType = isEntryRequired
                    ? valueType
                    : combineTypes([valueType, evaluator.getNoneType()]);
            }
            return getOverload;
        }

        function createPopMethods(keyType: Type, valueType: Type, isEntryRequired: boolean) {
            const keyParam = FunctionParam.create(ParamCategory.Simple, keyType, FunctionParamFlags.TypeDeclared, 'k');

            const popOverload1 = FunctionType.createSynthesizedInstance('pop', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(popOverload1, selfParam);
            FunctionType.addParam(popOverload1, keyParam);
            popOverload1.shared.declaredReturnType = valueType;

            const popOverload2 = FunctionType.createSynthesizedInstance('pop', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(popOverload2, selfParam);
            FunctionType.addParam(popOverload2, keyParam);
            popOverload2.shared.typeVarScopeId = ParseTreeUtils.getScopeIdForNode(node);
            const defaultTypeVar = createDefaultTypeVar(popOverload2);

            let defaultParamType: Type;
            let returnType: Type;

            if (isEntryRequired) {
                // If the entry is required, the type of the default param doesn't matter
                // because the type will always come from the value.
                defaultParamType = AnyType.create();
                returnType = valueType;
            } else {
                defaultParamType = combineTypes([valueType, defaultTypeVar]);
                returnType = defaultParamType;
            }

            FunctionType.addParam(
                popOverload2,
                FunctionParam.create(
                    ParamCategory.Simple,
                    defaultParamType,
                    FunctionParamFlags.TypeDeclared,
                    'default',
                    defaultParamType
                )
            );
            popOverload2.shared.declaredReturnType = returnType;
            return [popOverload1, popOverload2];
        }

        function createSetDefaultMethod(keyType: Type, valueType: Type) {
            const setDefaultOverload = FunctionType.createSynthesizedInstance(
                'setdefault',
                FunctionTypeFlags.Overloaded
            );
            FunctionType.addParam(setDefaultOverload, selfParam);
            FunctionType.addParam(
                setDefaultOverload,
                FunctionParam.create(ParamCategory.Simple, keyType, FunctionParamFlags.TypeDeclared, 'k')
            );
            FunctionType.addParam(
                setDefaultOverload,
                FunctionParam.create(ParamCategory.Simple, valueType, FunctionParamFlags.TypeDeclared, 'default')
            );
            setDefaultOverload.shared.declaredReturnType = valueType;
            return setDefaultOverload;
        }

        function createDelItemMethod(keyType: Type) {
            const delItemOverload = FunctionType.createSynthesizedInstance('delitem', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(delItemOverload, selfParam);
            FunctionType.addParam(
                delItemOverload,
                FunctionParam.create(ParamCategory.Simple, keyType, FunctionParamFlags.TypeDeclared, 'k')
            );
            delItemOverload.shared.declaredReturnType = evaluator.getNoneType();
            return delItemOverload;
        }

        function createUpdateMethod() {
            // Overload 1: update(__m: Partial[<writable fields>], /)
            const updateMethod1 = FunctionType.createSynthesizedInstance('update', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(updateMethod1, selfParam);

            // Overload 2: update(__m: Iterable[tuple[<name>, <type>]], /)
            const updateMethod2 = FunctionType.createSynthesizedInstance('update', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(updateMethod2, selfParam);

            // Overload 3: update(*, <name>: <type>, ...)
            const updateMethod3 = FunctionType.createSynthesizedInstance('update', FunctionTypeFlags.Overloaded);
            FunctionType.addParam(updateMethod3, selfParam);

            // If all entries are read-only, don't allow updates.
            FunctionType.addParam(
                updateMethod1,
                FunctionParam.create(
                    ParamCategory.Simple,
                    allEntriesAreReadOnly
                        ? NeverType.createNever()
                        : ClassType.cloneAsInstance(ClassType.cloneForPartialTypedDict(classType)),
                    FunctionParamFlags.TypeDeclared,
                    '__m'
                )
            );

            if (entries.knownItems.size > 0) {
                FunctionType.addPositionOnlyParamSeparator(updateMethod1);
                FunctionType.addKeywordOnlyParamSeparator(updateMethod3);
            }

            updateMethod1.shared.declaredReturnType = evaluator.getNoneType();
            updateMethod2.shared.declaredReturnType = evaluator.getNoneType();
            updateMethod3.shared.declaredReturnType = evaluator.getNoneType();

            const tuplesToCombine: Type[] = [];
            const tupleClass = evaluator.getBuiltInType(node, 'tuple');

            entries.knownItems.forEach((entry, name) => {
                if (!entry.isReadOnly) {
                    // For writable entries, add a tuple entry.
                    if (tupleClass && isInstantiableClass(tupleClass) && strClass && isInstantiableClass(strClass)) {
                        const tupleType = specializeTupleClass(ClassType.cloneAsInstance(tupleClass), [
                            {
                                type: ClassType.cloneWithLiteral(ClassType.cloneAsInstance(strClass), name),
                                isUnbounded: false,
                            },
                            { type: entry.valueType, isUnbounded: false },
                        ]);

                        tuplesToCombine.push(tupleType);
                    }

                    // For writable entries, add a keyword argument.
                    FunctionType.addParam(
                        updateMethod3,
                        FunctionParam.create(
                            ParamCategory.Simple,
                            entry.valueType,
                            FunctionParamFlags.TypeDeclared,
                            name,
                            AnyType.create(/* isEllipsis */ true)
                        )
                    );
                }
            });

            const iterableClass = evaluator.getTypingType(node, 'Iterable');
            if (iterableClass && isInstantiableClass(iterableClass)) {
                const iterableType = ClassType.cloneAsInstance(iterableClass);

                FunctionType.addParam(
                    updateMethod2,
                    FunctionParam.create(
                        ParamCategory.Simple,
                        ClassType.specialize(iterableType, [combineTypes(tuplesToCombine)]),
                        FunctionParamFlags.TypeDeclared,
                        '__m'
                    )
                );
            }

            if (entries.knownItems.size > 0) {
                FunctionType.addPositionOnlyParamSeparator(updateMethod2);
            }

            // Note that the order of method1 and method2 is swapped. This is done so
            // the method1 signature is used in the error message when neither method2
            // or method1 match.
            return OverloadedType.create([updateMethod2, updateMethod1, updateMethod3]);
        }

        const getOverloads: FunctionType[] = [];
        const popOverloads: FunctionType[] = [];
        const setDefaultOverloads: FunctionType[] = [];

        entries.knownItems.forEach((entry, name) => {
            const nameLiteralType = ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, name));

            getOverloads.push(
                createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ false, entry.isRequired)
            );

            getOverloads.push(
                createGetMethod(
                    nameLiteralType,
                    entry.valueType,
                    /* includeDefault */ true,
                    /* isEntryRequired */ entry.isRequired,
                    /* defaultTypeMatchesField */ entry.isRequired
                )
            );

            // Add a pop method if the entry is not required.
            if (!entry.isRequired && !entry.isReadOnly) {
                appendArray(popOverloads, createPopMethods(nameLiteralType, entry.valueType, entry.isRequired));
            }

            if (!entry.isReadOnly) {
                setDefaultOverloads.push(createSetDefaultMethod(nameLiteralType, entry.valueType));
            }
        });

        const strType = ClassType.cloneAsInstance(strClass);

        // If the class is closed, we can assume that any other keys that
        // are present will return the default parameter value or the extra
        // entries value type.
        if (ClassType.isTypedDictEffectivelyClosed(classType)) {
            getOverloads.push(
                createGetMethod(
                    strType,
                    combineTypes([extraEntriesInfo.valueType, evaluator.getNoneType()]),
                    /* includeDefault */ false,
                    /* isEntryRequired */ true
                )
            );
            getOverloads.push(createGetMethod(strType, extraEntriesInfo.valueType, /* includeDefault */ true));
        } else {
            // Provide a final `get` overload that handles the general case where
            // the key is a str but the literal value isn't known.
            getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ false));
            getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ true));
        }

        // Add a catch-all pop method.
        if (ClassType.isTypedDictEffectivelyClosed(classType)) {
            if (!isNever(extraEntriesInfo.valueType)) {
                popOverloads.push(
                    ...createPopMethods(strType, extraEntriesInfo.valueType, /* isEntryRequired */ false)
                );
            }
        } else {
            popOverloads.push(...createPopMethods(strType, evaluator.getObjectType(), /* isEntryRequired */ false));
        }

        symbolTable.set('get', Symbol.createWithType(SymbolFlags.ClassMember, OverloadedType.create(getOverloads)));

        if (popOverloads.length > 0) {
            symbolTable.set('pop', Symbol.createWithType(SymbolFlags.ClassMember, OverloadedType.create(popOverloads)));
        }

        if (setDefaultOverloads.length > 0) {
            symbolTable.set(
                'setdefault',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedType.create(setDefaultOverloads))
            );
        }

        if (!allEntriesAreReadOnly) {
            symbolTable.set(
                '__delitem__',
                Symbol.createWithType(SymbolFlags.ClassMember, createDelItemMethod(strType))
            );
        }

        symbolTable.set('update', Symbol.createWithType(SymbolFlags.ClassMember, createUpdateMethod()));

        // If the TypedDict is closed and all of its entries are NotRequired and
        // not ReadOnly, add a "clear" and "popitem" method.
        const dictValueType = getTypedDictDictEquivalent(evaluator, classType);

        if (dictValueType) {
            const clearMethod = FunctionType.createSynthesizedInstance('clear');
            FunctionType.addParam(clearMethod, selfParam);
            clearMethod.shared.declaredReturnType = evaluator.getNoneType();
            symbolTable.set('clear', Symbol.createWithType(SymbolFlags.ClassMember, clearMethod));

            const popItemMethod = FunctionType.createSynthesizedInstance('popitem');
            FunctionType.addParam(popItemMethod, selfParam);
            let tupleType: Type | undefined = evaluator.getTupleClassType();

            if (tupleType && isInstantiableClass(tupleType)) {
                tupleType = specializeTupleClass(
                    ClassType.cloneAsInstance(tupleType),
                    [
                        { type: strType, isUnbounded: false },
                        { type: dictValueType, isUnbounded: false },
                    ],
                    /* isTypeArgExplicit */ true
                );
            } else {
                tupleType = UnknownType.create();
            }

            popItemMethod.shared.declaredReturnType = tupleType;
            symbolTable.set('popitem', Symbol.createWithType(SymbolFlags.ClassMember, popItemMethod));
        }

        // If the TypedDict is closed, we can provide a more accurate value type
        // for the "items", "keys" and "values" methods.
        const mappingValueType = getTypedDictMappingEquivalent(evaluator, classType);

        if (mappingValueType) {
            let keyValueType: Type = strType;

            // If we know that there can be no more items, we can provide
            // a more accurate key type consisting of all known keys.
            if (entries.extraItems && isNever(entries.extraItems.valueType)) {
                keyValueType = combineTypes(
                    Array.from(entries.knownItems.keys()).map((key) => ClassType.cloneWithLiteral(strType, key))
                );
            }

            ['items', 'keys', 'values'].forEach((methodName) => {
                const method = FunctionType.createSynthesizedInstance(methodName);
                FunctionType.addParam(method, selfParam);

                const returnTypeClass = evaluator.getTypingType(node, `dict_${methodName}`);
                if (
                    returnTypeClass &&
                    isInstantiableClass(returnTypeClass) &&
                    returnTypeClass.shared.typeParams.length === 2
                ) {
                    method.shared.declaredReturnType = ClassType.specialize(
                        ClassType.cloneAsInstance(returnTypeClass),
                        [keyValueType, mappingValueType]
                    );

                    symbolTable.set(methodName, Symbol.createWithType(SymbolFlags.ClassMember, method));
                }
            });
        }
    }
}

export function getTypedDictMembersForClass(
    evaluator: TypeEvaluator,
    classType: ClassType,
    allowNarrowed = false
): TypedDictEntries {
    // Were the entries already calculated and cached?
    if (!classType.shared.typedDictEntries) {
        const entries: TypedDictEntries = {
            knownItems: new Map<string, TypedDictEntry>(),
            extraItems: undefined,
        };
        getTypedDictMembersForClassRecursive(evaluator, classType, entries);

        if (ClassType.isTypedDictMarkedClosed(classType) && !entries.extraItems) {
            entries.extraItems = {
                valueType: NeverType.createNever(),
                isReadOnly: false,
                isRequired: false,
                isProvided: false,
            };
        }

        // Cache the entries for next time.
        classType.shared.typedDictEntries = entries;
    }

    const solution = buildSolutionFromSpecializedClass(classType);

    // Create a specialized copy of the entries so the caller can mutate them.
    const entries = new Map<string, TypedDictEntry>();
    classType.shared.typedDictEntries!.knownItems.forEach((value, key) => {
        const tdEntry = { ...value };
        tdEntry.valueType = applySolvedTypeVars(tdEntry.valueType, solution);

        // If the class is "Partial", make all entries optional and convert all
        // read-only entries to Never.
        if (classType.priv.isTypedDictPartial) {
            tdEntry.isRequired = false;

            if (tdEntry.isReadOnly) {
                tdEntry.valueType = NeverType.createNever();
            } else {
                tdEntry.isReadOnly = true;
            }
        }

        entries.set(key, tdEntry);
    });

    // Apply narrowed types on top of existing entries if present.
    if (allowNarrowed && classType.priv.typedDictNarrowedEntries) {
        classType.priv.typedDictNarrowedEntries.forEach((value, key) => {
            const tdEntry = { ...value };
            tdEntry.valueType = applySolvedTypeVars(tdEntry.valueType, solution);
            entries.set(key, tdEntry);
        });
    }

    return {
        knownItems: entries,
        extraItems: classType.shared.typedDictEntries?.extraItems,
    };
}

// If the TypedDict class is consistent with Mapping[str, T] where T
// is some type other than object, it returns T. Otherwise it returns undefined.
export function getTypedDictMappingEquivalent(evaluator: TypeEvaluator, classType: ClassType): Type | undefined {
    assert(isInstantiableClass(classType));
    assert(ClassType.isTypedDictClass(classType));

    // If the TypedDict class isn't closed, it's just a normal Mapping[str, object].
    if (!ClassType.isTypedDictEffectivelyClosed(classType)) {
        return undefined;
    }

    const entries = getTypedDictMembersForClass(evaluator, classType);
    const typesToCombine: Type[] = [];

    entries.knownItems.forEach((entry) => {
        typesToCombine.push(entry.valueType);
    });

    if (entries.extraItems) {
        typesToCombine.push(entries.extraItems.valueType);
    }

    // Is the final value type 'object'?
    const valueType = combineTypes(typesToCombine);
    if (isClassInstance(valueType) && ClassType.isBuiltIn(valueType, 'object')) {
        return undefined;
    }

    return valueType;
}

// If the TypedDict class is consistent with dict[str, T], it returns T.
// Otherwise it returns undefined.
export function getTypedDictDictEquivalent(
    evaluator: TypeEvaluator,
    classType: ClassType,
    recursionCount = 0
): Type | undefined {
    assert(isInstantiableClass(classType));
    assert(ClassType.isTypedDictClass(classType));

    // If the TypedDict class isn't closed, it's not equivalent to a dict.
    if (!ClassType.isTypedDictEffectivelyClosed(classType)) {
        return undefined;
    }

    const entries = getTypedDictMembersForClass(evaluator, classType);

    // If there is no "extraItems" defined or it is read-only, it's not
    // equivalent to a dict.
    if (!entries.extraItems || entries.extraItems.isReadOnly) {
        return undefined;
    }

    let dictValueType = entries.extraItems.valueType;

    let isEquivalentToDict = true;
    entries.knownItems.forEach((entry) => {
        if (entry.isReadOnly || entry.isRequired) {
            isEquivalentToDict = false;
        }

        dictValueType = combineTypes([dictValueType, entry.valueType]);

        if (
            !evaluator.assignType(
                dictValueType,
                entry.valueType,
                /* diag */ undefined,
                /* constraints */ undefined,
                AssignTypeFlags.Invariant,
                recursionCount + 1
            )
        ) {
            isEquivalentToDict = false;
        }
    });

    if (!isEquivalentToDict) {
        return undefined;
    }

    return dictValueType;
}

function getTypedDictFieldsFromDictSyntax(
    evaluator: TypeEvaluator,
    entryDict: DictionaryNode,
    classFields: SymbolTable,
    isInline: boolean
) {
    const entrySet = new Set<string>();
    const fileInfo = AnalyzerNodeInfo.getFileInfo(entryDict);

    entryDict.d.items.forEach((entry) => {
        if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typedDictSecondArgDictEntry(),
                entry
            );
            return;
        }

        if (entry.d.keyExpr.nodeType !== ParseNodeType.StringList) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typedDictEntryName(),
                entry.d.keyExpr
            );
            return;
        }

        const entryName = entry.d.keyExpr.d.strings.map((s) => s.d.value).join('');
        if (!entryName) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typedDictEmptyName(),
                entry.d.keyExpr
            );
            return;
        }

        if (entrySet.has(entryName)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typedDictEntryUnique(),
                entry.d.keyExpr
            );
            return;
        }

        // Record names in a set to detect duplicates.
        entrySet.add(entryName);

        const newSymbol = new Symbol(SymbolFlags.InstanceMember);
        const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: entry.d.keyExpr,
            uri: fileInfo.fileUri,
            typeAnnotationNode: entry.d.valueExpr,
            isRuntimeTypeExpression: !isInline,
            range: convertOffsetsToRange(entry.d.keyExpr.start, TextRange.getEnd(entry.d.keyExpr), fileInfo.lines),
            moduleName: fileInfo.moduleName,
            isInExceptSuite: false,
            isInInlinedTypedDict: true,
        };
        newSymbol.addDeclaration(declaration);

        classFields.set(entryName, newSymbol);
    });

    // Set the type in the type cache for the dict node so it doesn't
    // get evaluated again.
    evaluator.setTypeResultForNode(entryDict, { type: UnknownType.create() });
}

function getTypedDictMembersForClassRecursive(
    evaluator: TypeEvaluator,
    classType: ClassType,
    entries: TypedDictEntries,
    recursionCount = 0
) {
    assert(ClassType.isTypedDictClass(classType));
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }
    recursionCount++;

    classType.shared.baseClasses.forEach((baseClassType) => {
        if (isInstantiableClass(baseClassType) && ClassType.isTypedDictClass(baseClassType)) {
            const specializedBaseClassType = partiallySpecializeType(
                baseClassType,
                classType,
                evaluator.getTypeClassType()
            );
            assert(isClass(specializedBaseClassType));

            // Recursively gather keys from parent classes. Don't report any errors
            // in these cases because they will be reported within that class.
            getTypedDictMembersForClassRecursive(evaluator, specializedBaseClassType, entries, recursionCount);
        }
    });

    const solution = buildSolutionFromSpecializedClass(classType);

    if (ClassType.isTypedDictMarkedClosed(classType)) {
        entries.extraItems = {
            valueType: NeverType.createNever(),
            isReadOnly: false,
            isRequired: false,
            isProvided: false,
        };
    } else if (classType.shared.typedDictExtraItemsExpr) {
        const extraItemsTypeResult = evaluator.getTypeOfExpressionExpectingType(
            classType.shared.typedDictExtraItemsExpr,
            { allowReadOnly: true }
        );

        entries.extraItems = {
            valueType: convertToInstance(extraItemsTypeResult.type),
            isReadOnly: !!extraItemsTypeResult.isReadOnly,
            isRequired: false,
            isProvided: true,
        };
    }

    // Add any new typed dict entries from this class.
    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            // Only variables (not functions, classes, etc.) are considered.
            const lastDecl = getLastTypedDeclarationForSymbol(symbol);

            if (lastDecl && lastDecl.type === DeclarationType.Variable) {
                let valueType = evaluator.getEffectiveTypeOfSymbol(symbol);
                valueType = applySolvedTypeVars(valueType, solution);

                let isRequired = !ClassType.isCanOmitDictValues(classType);
                let isReadOnly = false;

                if (isRequiredTypedDictVariable(evaluator, symbol)) {
                    isRequired = true;
                } else if (isNotRequiredTypedDictVariable(evaluator, symbol)) {
                    isRequired = false;
                }

                if (isReadOnlyTypedDictVariable(evaluator, symbol)) {
                    isReadOnly = true;
                }

                const tdEntry: TypedDictEntry = {
                    valueType,
                    isReadOnly,
                    isRequired,
                    isProvided: false,
                };

                entries.knownItems.set(name, tdEntry);
            }
        }
    });
}

export function getEffectiveExtraItemsEntryType(evaluator: TypeEvaluator, classType: ClassType): TypedDictEntry {
    assert(ClassType.isTypedDictClass(classType));

    // Missing entries in a non-closed TypedDict class are implicitly typed as
    // ReadOnly[NotRequired[object]].
    if (!ClassType.isTypedDictMarkedClosed(classType)) {
        return {
            valueType: evaluator.getObjectType(),
            isReadOnly: true,
            isRequired: false,
            isProvided: false,
        };
    }

    if (classType.shared.typedDictEntries?.extraItems) {
        return classType.shared.typedDictEntries.extraItems;
    }

    return {
        valueType: NeverType.createNever(),
        isReadOnly: true,
        isRequired: false,
        isProvided: false,
    };
}

export function assignTypedDictToTypedDict(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount = 0
) {
    let typesAreConsistent = true;
    const destEntries = getTypedDictMembersForClass(evaluator, destType);
    const srcEntries = getTypedDictMembersForClass(evaluator, srcType, /* allowNarrowed */ true);
    const extraSrcEntries = srcEntries.extraItems ?? getEffectiveExtraItemsEntryType(evaluator, srcType);

    destEntries.knownItems.forEach((destEntry, name) => {
        // If we've already determined that the types are inconsistent and
        // the caller isn't interested in detailed diagnostics, skip the remainder.
        if (!typesAreConsistent && !diag) {
            return;
        }

        const srcEntry = srcEntries.knownItems.get(name);
        if (!srcEntry) {
            if (destEntry.isRequired || !destEntry.isReadOnly) {
                diag?.createAddendum().addMessage(
                    LocAddendum.typedDictFieldMissing().format({
                        name,
                        type: evaluator.printType(ClassType.cloneAsInstance(srcType)),
                    })
                );
                typesAreConsistent = false;
            } else {
                if (isClassInstance(extraSrcEntries.valueType)) {
                    const subDiag = diag?.createAddendum();
                    if (
                        !evaluator.assignType(
                            destEntry.valueType,
                            extraSrcEntries.valueType,
                            subDiag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        subDiag?.addMessage(LocAddendum.memberTypeMismatch().format({ name }));
                        typesAreConsistent = false;
                    }
                }
            }
        } else {
            if (destEntry.isRequired !== srcEntry.isRequired && !destEntry.isReadOnly) {
                const message = destEntry.isRequired
                    ? LocAddendum.typedDictFieldRequired()
                    : LocAddendum.typedDictFieldNotRequired();
                diag?.createAddendum().addMessage(
                    message.format({
                        name,
                        type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                    })
                );
                typesAreConsistent = false;
            }

            if (!destEntry.isReadOnly && srcEntry.isReadOnly) {
                diag?.createAddendum().addMessage(
                    LocAddendum.typedDictFieldNotReadOnly().format({
                        name,
                        type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                    })
                );
                typesAreConsistent = false;
            }

            const subDiag = diag?.createAddendum();

            if (
                !evaluator.assignType(
                    destEntry.valueType,
                    srcEntry.valueType,
                    subDiag?.createAddendum(),
                    constraints,
                    destEntry.isReadOnly ? flags : flags | AssignTypeFlags.Invariant,
                    recursionCount
                )
            ) {
                subDiag?.addMessage(LocAddendum.memberTypeMismatch().format({ name }));
                typesAreConsistent = false;
            }
        }
    });

    // If the types are not consistent and the caller isn't interested
    // in detailed diagnostics, don't do additional work.
    if (!typesAreConsistent && !diag) {
        return false;
    }

    // If the destination TypedDict is closed, check any extra entries in the source
    // TypedDict to ensure that they don't violate the "extra items" type.
    if (ClassType.isTypedDictEffectivelyClosed(destType)) {
        const extraDestEntries = destEntries.extraItems ?? getEffectiveExtraItemsEntryType(evaluator, destType);

        srcEntries.knownItems.forEach((srcEntry, name) => {
            // Have we already checked this item in the loop above?
            if (destEntries.knownItems.has(name)) {
                return;
            }

            if (!destEntries.extraItems) {
                const subDiag = diag?.createAddendum();
                subDiag?.addMessage(
                    LocAddendum.typedDictExtraFieldNotAllowed().format({
                        name,
                        type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                    })
                );
                typesAreConsistent = false;
            } else {
                if (srcEntry.isRequired && !destEntries.extraItems.isReadOnly) {
                    diag?.createAddendum().addMessage(
                        LocAddendum.typedDictFieldNotRequired().format({
                            name,
                            type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                        })
                    );
                    typesAreConsistent = false;
                }

                const subDiag = diag?.createAddendum();

                if (
                    !evaluator.assignType(
                        destEntries.extraItems.valueType,
                        srcEntry.valueType,
                        subDiag?.createAddendum(),
                        constraints,
                        destEntries.extraItems.isReadOnly ? flags : flags | AssignTypeFlags.Invariant,
                        recursionCount
                    )
                ) {
                    subDiag?.addMessage(
                        LocAddendum.typedDictExtraFieldTypeMismatch().format({
                            name,
                            type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                        })
                    );
                    typesAreConsistent = false;
                } else if (!destEntries.extraItems.isReadOnly && srcEntry.isReadOnly) {
                    diag?.createAddendum().addMessage(
                        LocAddendum.typedDictFieldNotReadOnly().format({
                            name,
                            type: evaluator.printType(ClassType.cloneAsInstance(srcType)),
                        })
                    );
                    typesAreConsistent = false;
                }
            }
        });

        const subDiag = diag?.createAddendum();
        if (
            !evaluator.assignType(
                extraDestEntries.valueType,
                extraSrcEntries.valueType,
                subDiag?.createAddendum(),
                constraints,
                extraDestEntries.isReadOnly ? flags : flags | AssignTypeFlags.Invariant,
                recursionCount
            )
        ) {
            subDiag?.addMessage(
                LocAddendum.typedDictExtraFieldTypeMismatch().format({
                    name: 'extra_items',
                    type: evaluator.printType(ClassType.cloneAsInstance(srcType)),
                })
            );
            typesAreConsistent = false;
        } else if (!extraDestEntries.isReadOnly && extraSrcEntries.isReadOnly) {
            diag?.createAddendum().addMessage(
                LocAddendum.typedDictFieldNotReadOnly().format({
                    name: 'extra_items',
                    type: evaluator.printType(ClassType.cloneAsInstance(destType)),
                })
            );
            typesAreConsistent = false;
        }
    }

    return typesAreConsistent;
}

// Determines whether the specified keys and values can be assigned to
// a typed dictionary class. The caller should have already validated
// that the class is indeed a typed dict. If the types are compatible,
// the typed dict class or a narrowed form of the class is returned.
// Narrowing is possible when not-required keys are provided. If the
// types are not compatible, the function returns undefined.
export function assignToTypedDict(
    evaluator: TypeEvaluator,
    classType: ClassType,
    keyTypes: TypeResultWithNode[],
    valueTypes: TypeResultWithNode[],
    diagAddendum?: DiagnosticAddendum
): ClassType | undefined {
    assert(isClassInstance(classType));
    assert(ClassType.isTypedDictClass(classType));
    assert(keyTypes.length === valueTypes.length);

    let isMatch = true;
    const narrowedEntries = new Map<string, TypedDictEntry>();

    let constraints: ConstraintTracker | undefined;
    let genericClassType = classType;

    if (classType.shared.typeParams.length > 0) {
        constraints = new ConstraintTracker();

        // Create a generic (nonspecialized version) of the class.
        if (classType.priv.typeArgs) {
            genericClassType = ClassType.specialize(classType, /* typeArgs */ undefined);
        }
    }

    const tdEntries = getTypedDictMembersForClass(evaluator, genericClassType);

    keyTypes.forEach((keyTypeResult, index) => {
        const keyType = keyTypeResult.type;
        if (!isClassInstance(keyType) || !ClassType.isBuiltIn(keyType, 'str') || !isLiteralType(keyType)) {
            isMatch = false;
        } else {
            const keyValue = keyType.priv.literalValue as string;
            const symbolEntry = tdEntries.knownItems.get(keyValue);

            if (!symbolEntry) {
                if (tdEntries.extraItems) {
                    const subDiag = diagAddendum?.createAddendum();
                    if (
                        !evaluator.assignType(
                            tdEntries.extraItems.valueType,
                            valueTypes[index].type,
                            subDiag?.createAddendum(),
                            constraints,
                            AssignTypeFlags.RetainLiteralsForTypeVar
                        )
                    ) {
                        if (subDiag) {
                            subDiag.addMessage(
                                LocAddendum.typedDictFieldTypeMismatch().format({
                                    name: 'extra_items',
                                    type: evaluator.printType(valueTypes[index].type),
                                })
                            );

                            subDiag.addTextRange(keyTypeResult.node);
                        }
                        isMatch = false;
                    }
                } else {
                    // The provided key name doesn't exist.
                    isMatch = false;
                    if (diagAddendum) {
                        const subDiag = diagAddendum?.createAddendum();
                        subDiag.addMessage(
                            LocAddendum.typedDictFieldUndefined().format({
                                name: keyType.priv.literalValue as string,
                                type: evaluator.printType(ClassType.cloneAsInstance(classType)),
                            })
                        );

                        subDiag.addTextRange(keyTypeResult.node);
                    }
                }
            } else {
                // Can we assign the value to the declared type?
                const subDiag = diagAddendum?.createAddendum();
                if (
                    !evaluator.assignType(
                        symbolEntry.valueType,
                        valueTypes[index].type,
                        subDiag?.createAddendum(),
                        constraints,
                        AssignTypeFlags.RetainLiteralsForTypeVar
                    )
                ) {
                    if (subDiag) {
                        subDiag.addMessage(
                            LocAddendum.typedDictFieldTypeMismatch().format({
                                name: keyType.priv.literalValue as string,
                                type: evaluator.printType(valueTypes[index].type),
                            })
                        );

                        subDiag.addTextRange(keyTypeResult.node);
                    }
                    isMatch = false;
                }

                if (!symbolEntry.isRequired) {
                    narrowedEntries.set(keyValue, {
                        valueType: valueTypes[index].type,
                        isReadOnly: !!valueTypes[index].isReadOnly,
                        isRequired: false,
                        isProvided: true,
                    });
                }

                symbolEntry.isProvided = true;
            }
        }
    });

    if (!isMatch) {
        return undefined;
    }

    // See if any required keys are missing.
    tdEntries.knownItems.forEach((entry, name) => {
        if (entry.isRequired && !entry.isProvided) {
            if (diagAddendum) {
                diagAddendum.addMessage(
                    LocAddendum.typedDictFieldRequired().format({
                        name,
                        type: evaluator.printType(classType),
                    })
                );
            }
            isMatch = false;
        }
    });

    if (!isMatch) {
        return undefined;
    }

    const specializedClassType = constraints
        ? (evaluator.solveAndApplyConstraints(genericClassType, constraints) as ClassType)
        : classType;

    return narrowedEntries.size === 0
        ? specializedClassType
        : ClassType.cloneForNarrowedTypedDictEntries(specializedClassType, narrowedEntries);
}

export function getTypeOfIndexedTypedDict(
    evaluator: TypeEvaluator,
    node: IndexNode,
    baseType: ClassType,
    usage: EvaluatorUsage
): TypeResult | undefined {
    if (node.d.items.length !== 1) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.typeArgsMismatchOne().format({ received: node.d.items.length }),
            node
        );
        return { type: UnknownType.create() };
    }

    // Look for subscript types that are not supported by TypedDict.
    if (node.d.trailingComma || node.d.items[0].d.name || node.d.items[0].d.argCategory !== ArgCategory.Simple) {
        return undefined;
    }

    const entries = getTypedDictMembersForClass(evaluator, baseType, /* allowNarrowed */ usage.method === 'get');

    const indexTypeResult = evaluator.getTypeOfExpression(node.d.items[0].d.valueExpr);
    const indexType = indexTypeResult.type;
    let diag = new DiagnosticAddendum();
    let allDiagsInvolveNotRequiredKeys = true;

    const resultingType = mapSubtypes(indexType, (subtype) => {
        if (isAnyOrUnknown(subtype)) {
            return subtype;
        }

        if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'str')) {
            if (subtype.priv.literalValue === undefined) {
                // If it's a plain str with no literal value, we can't
                // make any determination about the resulting type.
                return UnknownType.create();
            }

            // Look up the entry in the typed dict to get its type.
            const entryName = subtype.priv.literalValue as string;
            const entry = entries.knownItems.get(entryName) ?? entries.extraItems;
            if (!entry || isNever(entry.valueType)) {
                diag.addMessage(
                    LocAddendum.keyUndefined().format({
                        name: entryName,
                        type: evaluator.printType(baseType),
                    })
                );
                allDiagsInvolveNotRequiredKeys = false;
                return UnknownType.create();
            } else if (!(entry.isRequired || entry.isProvided) && usage.method === 'get') {
                diag.addMessage(
                    LocAddendum.keyNotRequired().format({
                        name: entryName,
                        type: evaluator.printType(baseType),
                    })
                );
            } else if (entry.isReadOnly && usage.method !== 'get') {
                diag.addMessage(
                    LocAddendum.keyReadOnly().format({
                        name: entryName,
                        type: evaluator.printType(baseType),
                    })
                );
            }

            if (usage.method === 'set') {
                if (!evaluator.assignType(entry.valueType, usage.setType?.type ?? AnyType.create(), diag)) {
                    allDiagsInvolveNotRequiredKeys = false;
                }
            } else if (usage.method === 'del' && entry.isRequired) {
                diag.addMessage(
                    LocAddendum.keyRequiredDeleted().format({
                        name: entryName,
                    })
                );
                allDiagsInvolveNotRequiredKeys = false;
            }

            return entry.valueType;
        }

        diag.addMessage(LocAddendum.typeNotStringLiteral().format({ type: evaluator.printType(subtype) }));
        allDiagsInvolveNotRequiredKeys = false;
        return UnknownType.create();
    });

    // If we have an "expected type" diagnostic addendum (used for assignments),
    // use that rather than the local diagnostic information because it will
    // be more informative.
    if (usage.setExpectedTypeDiag && !diag.isEmpty() && !usage.setExpectedTypeDiag.isEmpty()) {
        diag = usage.setExpectedTypeDiag;
    }

    if (!diag.isEmpty()) {
        let typedDictDiag: string;
        if (usage.method === 'set') {
            typedDictDiag = LocMessage.typedDictSet();
        } else if (usage.method === 'del') {
            typedDictDiag = LocMessage.typedDictDelete();
        } else {
            typedDictDiag = LocMessage.typedDictAccess();
        }

        evaluator.addDiagnostic(
            allDiagsInvolveNotRequiredKeys
                ? DiagnosticRule.reportTypedDictNotRequiredAccess
                : DiagnosticRule.reportGeneralTypeIssues,
            typedDictDiag + diag.getString(),
            node
        );
    }

    return { type: resultingType, isIncomplete: !!indexTypeResult.isIncomplete };
}

// If the specified type has a non-required key, this method marks the
// key as present.
export function narrowForKeyAssignment(classType: ClassType, key: string) {
    // We should never be called if the classType is not a TypedDict or if typedDictEntries
    // is empty, but this can theoretically happen in the presence of certain circular
    // dependencies.
    if (!ClassType.isTypedDictClass(classType) || !classType.shared.typedDictEntries) {
        return classType;
    }

    const tdEntry = classType.shared.typedDictEntries.knownItems.get(key);
    if (!tdEntry || tdEntry.isRequired) {
        return classType;
    }

    const narrowedTdEntry = classType.priv.typedDictNarrowedEntries?.get(key);
    if (narrowedTdEntry?.isProvided) {
        return classType;
    }

    const narrowedEntries = classType.priv.typedDictNarrowedEntries
        ? new Map<string, TypedDictEntry>(classType.priv.typedDictNarrowedEntries)
        : new Map<string, TypedDictEntry>();
    narrowedEntries.set(key, {
        isProvided: true,
        isRequired: false,
        isReadOnly: tdEntry.isReadOnly,
        valueType: tdEntry.valueType,
    });

    return ClassType.cloneForNarrowedTypedDictEntries(classType, narrowedEntries);
}

function isRequiredTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
            allowReadOnly: true,
        });

        return !!annotatedType.isRequired;
    });
}

function isNotRequiredTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
            allowReadOnly: true,
        });

        return !!annotatedType.isNotRequired;
    });
}

function isReadOnlyTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
            allowReadOnly: true,
        });

        return !!annotatedType.isReadOnly;
    });
}
