/*
 * collectionInference.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * collectionInference implementation, using evaluator-owned dependencies and state.
 */

import { assert } from '../../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { TextRange } from '../../common/textRange';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ComprehensionForIfNode,
    ComprehensionNode,
    DictionaryNode,
    ExpressionNode,
    isExpressionNode,
    ListNode,
    ParseNode,
    ParseNodeType,
    SetNode,
} from '../../parser/parseNodes';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { addConstraintsForExpectedType } from '../constraintSolver';
import { ConstraintTracker } from '../constraintTracker';
import * as ParseTreeUtils from '../parseTreeUtils';
import { makeTupleObject } from '../tuples';
import { assignToTypedDict, getTypedDictMembersForClass } from '../typedDicts';
import {
    AssignTypeFlags,
    EvalFlags,
    maxInferredContainerDepth,
    maxSubtypesForInferredType,
    PrefetchedTypes,
    PrintTypeOptions,
    SolveConstraintsOptions,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
} from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionType,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    ModuleType,
    NeverType,
    OverloadedType,
    OverloadResultType,
    Type,
    TypeBase,
    TypeCondition,
    TypedDictEntries,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
    Variance,
} from '../types';
import {
    ApplyTypeVarOptions,
    areTypesSame,
    containsLiteralType,
    getContainerDepth,
    InferenceContext,
    isLiteralType,
    isTupleClass,
    makeInferenceContext,
    mapSubtypes,
    selfSpecializeClass,
    stripTypeForm,
    transformExpectedType,
    transformPossibleRecursiveTypeAlias,
} from '../typeUtils';
interface Context {
    readonly addDiagnostic: (
        rule: DiagnosticRule,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) => Diagnostic | undefined;
    readonly assignType: (
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => boolean;
    readonly assignTypeToExpression: (
        target: ExpressionNode,
        typeResult: TypeResult,
        srcExpr: ExpressionNode,
        ignoreEmptyContainers?: boolean,
        allowAssignmentToFinalVar?: boolean,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) => void;
    readonly convertSpecialFormToRuntimeValue: (type: Type, flags: EvalFlags, convertModule?: boolean) => Type;
    readonly evaluatorInterface: TypeEvaluator;
    readonly getBuiltInObject: (
        node: ParseNode,
        name: string,
        typeArgs?: Type[]
    ) =>
        | UnboundType
        | UnknownType
        | AnyType
        | FunctionType
        | OverloadedType
        | ClassType
        | ModuleType
        | TypeVarType
        | OverloadResultType
        | NeverType
        | UnionType;
    readonly getBuiltInType: (node: ParseNode, name: string) => Type;
    readonly getNoneType: () => Type;
    readonly getObjectType: () => Type;
    readonly getTupleClassType: () => ClassType | undefined;
    readonly getTypeOfExpression: (
        node: ExpressionNode,
        flags?: EvalFlags,
        inferenceContext?: InferenceContext
    ) => TypeResult;
    readonly getTypeOfIterator: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError?: boolean
    ) => TypeResult | undefined;
    readonly getTypeVarScopesForNode: (node: ParseNode) => string[];
    readonly getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    readonly inferVarianceForClass: (classType: ClassType) => void;
    readonly isTypeHashable: (type: Type) => boolean;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
    readonly maxEntriesToUseForInference: 64;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly printType: (type: Type, options?: PrintTypeOptions) => string;
    readonly solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Type;
    readonly stripLiteralValue: (type: Type) => Type;
}

// Infers collection entries and comprehension clauses, including assignment and diagnostic effects.
export function createCollectionInference(context: Context) {
    const {
        addDiagnostic,
        assignType,
        assignTypeToExpression,
        convertSpecialFormToRuntimeValue,
        evaluatorInterface,
        getBuiltInObject,
        getBuiltInType,
        getNoneType,
        getObjectType,
        getTupleClassType,
        getTypeOfExpression,
        getTypeOfIterator,
        getTypeVarScopesForNode,
        getTypingType,
        inferVarianceForClass,
        isTypeHashable,
        makeTopLevelTypeVarsConcrete,
        maxEntriesToUseForInference,
        nodeInfo,
        printType,
        solveAndApplyConstraints,
        stripLiteralValue,
    } = context;

    function getTypeOfDictionaryWithContext(
        node: DictionaryNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext,
        expectedDiagAddendum?: DiagnosticAddendum
    ): TypeResult | undefined {
        inferenceContext.expectedType = transformPossibleRecursiveTypeAlias(inferenceContext.expectedType);
        let concreteExpectedType = makeTopLevelTypeVarsConcrete(inferenceContext.expectedType);

        if (!isClassInstance(concreteExpectedType)) {
            return undefined;
        }

        const keyTypes: TypeResultWithNode[] = [];
        const valueTypes: TypeResultWithNode[] = [];
        let isIncomplete = false;
        let typeErrors = false;

        // Handle TypedDict's as a special case.
        if (ClassType.isTypedDictClass(concreteExpectedType)) {
            // Remove any conditions associated with the type so the resulting type isn't
            // considered compatible with a bound TypeVar.
            concreteExpectedType = TypeBase.cloneForCondition(concreteExpectedType, undefined);

            const expectedTypedDictEntries = getTypedDictMembersForClass(evaluatorInterface, concreteExpectedType);

            // Infer the key and value types if possible.
            const keyValueTypeResult = getKeyAndValueTypesFromDictionary(
                node,
                flags,
                keyTypes,
                valueTypes,
                /* forceStrictInference */ true,
                /* isValueTypeInvariant */ true,
                /* expectedKeyType */ undefined,
                /* expectedValueType */ undefined,
                expectedTypedDictEntries,
                expectedDiagAddendum
            );

            if (keyValueTypeResult.isIncomplete) {
                isIncomplete = true;
            }

            if (keyValueTypeResult.typeErrors) {
                typeErrors = true;
            }

            const resultTypedDict = assignToTypedDict(
                evaluatorInterface,
                concreteExpectedType,
                keyTypes,
                valueTypes,
                // Don't overwrite existing expectedDiagAddendum messages if they were
                // already provided by getKeyValueTypesFromDictionary.
                expectedDiagAddendum?.isEmpty() ? expectedDiagAddendum : undefined
            );
            if (resultTypedDict) {
                return {
                    type: resultTypedDict,
                    isIncomplete,
                };
            }

            return undefined;
        }

        let expectedKeyType: Type;
        let expectedValueType: Type;

        if (isAnyOrUnknown(inferenceContext.expectedType)) {
            expectedKeyType = inferenceContext.expectedType;
            expectedValueType = inferenceContext.expectedType;
        } else {
            const builtInDict = getBuiltInObject(node, 'dict');
            if (!isClassInstance(builtInDict)) {
                return undefined;
            }

            const dictConstraints = new ConstraintTracker();
            if (
                !addConstraintsForExpectedType(
                    evaluatorInterface,
                    builtInDict,
                    inferenceContext.expectedType,
                    dictConstraints,
                    getTypeVarScopesForNode(node),
                    node.start
                )
            ) {
                return undefined;
            }

            const specializedDict = solveAndApplyConstraints(
                ClassType.cloneAsInstantiable(builtInDict),
                dictConstraints
            ) as ClassType;
            if (!specializedDict.priv.typeArgs || specializedDict.priv.typeArgs.length !== 2) {
                return undefined;
            }

            expectedKeyType = specializedDict.priv.typeArgs[0];
            expectedValueType = specializedDict.priv.typeArgs[1];
        }

        // Dict and MutableMapping types have invariant value types, so they
        // cannot be narrowed further. Other super-types like Mapping, Collection,
        // and Iterable use covariant value types, so they can be narrowed.
        let isValueTypeInvariant = false;
        if (isClassInstance(inferenceContext.expectedType)) {
            if (inferenceContext.expectedType.shared.typeParams.length >= 2) {
                const valueTypeParam = inferenceContext.expectedType.shared.typeParams[1];
                if (TypeVarType.getVariance(valueTypeParam) === Variance.Invariant) {
                    isValueTypeInvariant = true;
                }
            }
        }

        // Infer the key and value types if possible.
        const keyValueResult = getKeyAndValueTypesFromDictionary(
            node,
            flags,
            keyTypes,
            valueTypes,
            /* forceStrictInference */ true,
            isValueTypeInvariant,
            expectedKeyType,
            expectedValueType,
            undefined,
            expectedDiagAddendum
        );

        if (keyValueResult.isIncomplete) {
            isIncomplete = true;
        }

        if (keyValueResult.typeErrors) {
            typeErrors = true;
        }

        const specializedKeyType = inferTypeArgFromExpectedEntryType(
            makeInferenceContext(expectedKeyType),
            keyTypes.map((result) => result.type),
            /* isNarrowable */ false
        );
        const specializedValueType = inferTypeArgFromExpectedEntryType(
            makeInferenceContext(expectedValueType),
            valueTypes.map((result) => result.type),
            !isValueTypeInvariant
        );
        if (!specializedKeyType || !specializedValueType) {
            return undefined;
        }

        const type = getBuiltInObject(node, 'dict', [specializedKeyType, specializedValueType]);
        return { type, isIncomplete, typeErrors };
    }

    function getTypeOfDictionaryInferred(node: DictionaryNode, flags: EvalFlags, hasExpectedType: boolean): TypeResult {
        const fallbackType = hasExpectedType ? AnyType.create() : UnknownType.create();
        let keyType: Type = fallbackType;
        let valueType: Type = fallbackType;

        const keyTypeResults: TypeResultWithNode[] = [];
        const valueTypeResults: TypeResultWithNode[] = [];

        let isEmptyContainer = false;
        let isIncomplete = false;
        let typeErrors = false;

        // Infer the key and value types if possible.
        const keyValueResult = getKeyAndValueTypesFromDictionary(
            node,
            flags,
            keyTypeResults,
            valueTypeResults,
            /* forceStrictInference */ hasExpectedType,
            /* isValueTypeInvariant */ false
        );

        if (keyValueResult.isIncomplete) {
            isIncomplete = true;
        }

        if (keyValueResult.typeErrors) {
            typeErrors = true;
        }

        // Strip any literal values and TypeForm types.
        const keyTypes = keyTypeResults.map((t) =>
            stripTypeForm(convertSpecialFormToRuntimeValue(stripLiteralValue(t.type), flags, !hasExpectedType))
        );
        const valueTypes = valueTypeResults.map((t) =>
            stripTypeForm(convertSpecialFormToRuntimeValue(stripLiteralValue(t.type), flags, !hasExpectedType))
        );

        if (keyTypes.length > 0) {
            if (nodeInfo.getFileInfo(node).diagnosticRuleSet.strictDictionaryInference || hasExpectedType) {
                keyType = combineTypes(keyTypes);
            } else {
                keyType = areTypesSame(keyTypes, { ignorePseudoGeneric: true }) ? keyTypes[0] : fallbackType;
            }
        } else {
            keyType = fallbackType;
        }

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (nodeInfo.getFileInfo(node).diagnosticRuleSet.strictDictionaryInference || hasExpectedType) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = areTypesSame(valueTypes, { ignorePseudoGeneric: true }) ? valueTypes[0] : fallbackType;
            }
        } else {
            valueType = fallbackType;
            isEmptyContainer = true;
        }

        const dictClass = getBuiltInType(node, 'dict');
        const type = isInstantiableClass(dictClass)
            ? ClassType.cloneAsInstance(
                  ClassType.specialize(
                      dictClass,
                      [keyType, valueType],
                      /* isTypeArgExplicit */ true,
                      /* includeSubclasses */ undefined,
                      /* tupleTypeArgs */ undefined,
                      isEmptyContainer
                  )
              )
            : UnknownType.create();

        if (isIncomplete) {
            if (getContainerDepth(type) > maxInferredContainerDepth) {
                return { type: UnknownType.create() };
            }
        }

        return { type, isIncomplete, typeErrors };
    }

    function getKeyAndValueTypesFromDictionary(
        node: DictionaryNode,
        flags: EvalFlags,
        keyTypes: TypeResultWithNode[],
        valueTypes: TypeResultWithNode[],
        forceStrictInference: boolean,
        isValueTypeInvariant: boolean,
        expectedKeyType?: Type,
        expectedValueType?: Type,
        expectedTypedDictEntries?: TypedDictEntries,
        expectedDiagAddendum?: DiagnosticAddendum
    ): TypeResult {
        let isIncomplete = false;
        let typeErrors = false;

        // Mask out some of the flags that are not applicable for a dictionary key
        // even if it appears within an inlined TypedDict annotation.
        const keyFlags = flags & ~(EvalFlags.TypeExpression | EvalFlags.StrLiteralAsType | EvalFlags.InstantiableType);

        // Infer the key and value types if possible.
        node.d.items.forEach((entryNode, index) => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                const keyTypeResult = getTypeOfExpression(
                    entryNode.d.keyExpr,
                    keyFlags | EvalFlags.StripTupleLiterals,
                    makeInferenceContext(
                        expectedKeyType ?? (forceStrictInference ? NeverType.createNever() : undefined)
                    )
                );

                if (keyTypeResult.isIncomplete) {
                    isIncomplete = true;
                }

                if (keyTypeResult.typeErrors) {
                    typeErrors = true;
                }

                const keyType = keyTypeResult.type;

                if (!keyTypeResult.isIncomplete && !keyTypeResult.typeErrors) {
                    verifySetEntryOrDictKeyIsHashable(entryNode.d.keyExpr, keyType, /* isDictKey */ true);
                }

                if (expectedDiagAddendum && keyTypeResult.expectedTypeDiagAddendum) {
                    expectedDiagAddendum.addAddendum(keyTypeResult.expectedTypeDiagAddendum);
                }

                let valueTypeResult: TypeResult;
                let entryInferenceContext: InferenceContext | undefined;

                if (
                    expectedTypedDictEntries &&
                    isClassInstance(keyType) &&
                    ClassType.isBuiltIn(keyType, 'str') &&
                    isLiteralType(keyType) &&
                    (expectedTypedDictEntries.knownItems.has(keyType.priv.literalValue as string) ||
                        expectedTypedDictEntries.extraItems)
                ) {
                    let effectiveValueType =
                        expectedTypedDictEntries.knownItems.get(keyType.priv.literalValue as string)?.valueType ??
                        expectedTypedDictEntries.extraItems?.valueType;
                    if (effectiveValueType) {
                        const liveTypeVarScopes = getTypeVarScopesForNode(node);
                        effectiveValueType = transformExpectedType(effectiveValueType, liveTypeVarScopes, node.start);
                    }
                    entryInferenceContext = makeInferenceContext(effectiveValueType);
                    valueTypeResult = getTypeOfExpression(
                        entryNode.d.valueExpr,
                        flags | EvalFlags.StripTupleLiterals,
                        entryInferenceContext
                    );
                } else {
                    let effectiveValueType =
                        expectedValueType ?? (forceStrictInference ? NeverType.createNever() : undefined);
                    if (effectiveValueType) {
                        const liveTypeVarScopes = getTypeVarScopesForNode(node);
                        effectiveValueType = transformExpectedType(effectiveValueType, liveTypeVarScopes, node.start);
                    }
                    entryInferenceContext = makeInferenceContext(effectiveValueType);
                    valueTypeResult = getTypeOfExpression(
                        entryNode.d.valueExpr,
                        flags | EvalFlags.StripTupleLiterals,
                        entryInferenceContext
                    );
                }

                if (entryInferenceContext && !valueTypeResult.typeErrors) {
                    const fromExpectedType = inferTypeArgFromExpectedEntryType(
                        entryInferenceContext,
                        [valueTypeResult.type],
                        !isValueTypeInvariant
                    );

                    if (fromExpectedType) {
                        valueTypeResult = { ...valueTypeResult, type: fromExpectedType };
                    }
                }

                if (expectedDiagAddendum && valueTypeResult.expectedTypeDiagAddendum) {
                    expectedDiagAddendum.addAddendum(valueTypeResult.expectedTypeDiagAddendum);
                }

                const valueType = valueTypeResult.type;
                if (valueTypeResult.isIncomplete) {
                    isIncomplete = true;
                }

                if (valueTypeResult.typeErrors) {
                    typeErrors = true;
                }

                if (forceStrictInference || index < maxEntriesToUseForInference) {
                    // If an existing key has the same literal type, delete the previous
                    // key since we're overwriting it here.
                    if (isClass(keyType) && isLiteralType(keyType)) {
                        const existingIndex = keyTypes.findIndex((kt) => isTypeSame(keyType, kt.type));
                        if (existingIndex >= 0) {
                            keyTypes.splice(existingIndex, 1);
                            valueTypes.splice(existingIndex, 1);
                        }
                    }

                    keyTypes.push({ node: entryNode.d.keyExpr, type: keyType });
                    valueTypes.push({ node: entryNode.d.valueExpr, type: valueType });
                }

                addUnknown = false;
            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                let expectedType: Type | undefined;
                if (expectedKeyType && expectedValueType) {
                    if (
                        context.prefetched?.supportsKeysAndGetItemClass &&
                        isInstantiableClass(context.prefetched.supportsKeysAndGetItemClass)
                    ) {
                        expectedType = ClassType.cloneAsInstance(
                            ClassType.specialize(context.prefetched.supportsKeysAndGetItemClass, [
                                expectedKeyType,
                                expectedValueType,
                            ])
                        );
                    }
                }

                const entryInferenceContext = makeInferenceContext(expectedType);
                let unexpandedTypeResult = getTypeOfExpression(
                    entryNode.d.expr,
                    flags | EvalFlags.StripTupleLiterals,
                    entryInferenceContext
                );

                if (entryInferenceContext && !unexpandedTypeResult.typeErrors) {
                    const fromExpectedType = inferTypeArgFromExpectedEntryType(
                        entryInferenceContext,
                        [unexpandedTypeResult.type],
                        !isValueTypeInvariant
                    );

                    if (fromExpectedType) {
                        unexpandedTypeResult = { ...unexpandedTypeResult, type: fromExpectedType };
                    }
                }

                if (unexpandedTypeResult.isIncomplete) {
                    isIncomplete = true;
                }

                if (unexpandedTypeResult.typeErrors) {
                    typeErrors = true;
                }

                const unexpandedType = unexpandedTypeResult.type;

                if (isAnyOrUnknown(unexpandedType)) {
                    if (forceStrictInference || index < maxEntriesToUseForInference) {
                        keyTypes.push({ node: entryNode, type: unexpandedType });
                        valueTypes.push({ node: entryNode, type: unexpandedType });
                    }
                    addUnknown = false;
                } else if (isClassInstance(unexpandedType) && ClassType.isTypedDictClass(unexpandedType)) {
                    // Handle dictionary expansion for a TypedDict.
                    if (context.prefetched?.strClass && isInstantiableClass(context.prefetched.strClass)) {
                        const strObject = ClassType.cloneAsInstance(context.prefetched.strClass);
                        const tdEntries = getTypedDictMembersForClass(
                            evaluatorInterface,
                            unexpandedType,
                            /* allowNarrowed */ true
                        );

                        tdEntries.knownItems.forEach((entry, name) => {
                            if (!expectedTypedDictEntries || entry.isRequired || entry.isProvided) {
                                keyTypes.push({
                                    node: entryNode,
                                    type: ClassType.cloneWithLiteral(strObject, name),
                                });
                                valueTypes.push({ node: entryNode, type: entry.valueType });
                            }
                        });

                        if (!expectedTypedDictEntries) {
                            // Open TypedDicts can contain extra items with arbitrary value types.
                            keyTypes.push({ node: entryNode, type: ClassType.cloneAsInstance(strObject) });
                            valueTypes.push({
                                node: entryNode,
                                type: tdEntries.extraItems?.valueType ?? getObjectType(),
                            });
                        }

                        addUnknown = false;
                    }
                } else if (
                    context.prefetched?.supportsKeysAndGetItemClass &&
                    isInstantiableClass(context.prefetched.supportsKeysAndGetItemClass)
                ) {
                    const mappingConstraints = new ConstraintTracker();

                    const supportsKeysAndGetItemClass = selfSpecializeClass(
                        context.prefetched.supportsKeysAndGetItemClass
                    );

                    if (
                        assignType(
                            ClassType.cloneAsInstance(supportsKeysAndGetItemClass),
                            unexpandedType,
                            /* diag */ undefined,
                            mappingConstraints,
                            AssignTypeFlags.RetainLiteralsForTypeVar
                        )
                    ) {
                        const specializedMapping = solveAndApplyConstraints(
                            supportsKeysAndGetItemClass,
                            mappingConstraints
                        ) as ClassType;
                        const typeArgs = specializedMapping.priv.typeArgs;
                        if (typeArgs && typeArgs.length >= 2) {
                            if (forceStrictInference || index < maxEntriesToUseForInference) {
                                keyTypes.push({ node: entryNode, type: typeArgs[0] });
                                valueTypes.push({ node: entryNode, type: typeArgs[1] });
                            }
                            addUnknown = false;
                        }
                    } else {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.dictUnpackIsNotMapping(),
                            entryNode
                        );
                    }
                }
            } else if (entryNode.nodeType === ParseNodeType.Comprehension) {
                const dictEntryTypeResult = getElementTypeFromComprehension(
                    entryNode,
                    flags | EvalFlags.StripTupleLiterals,
                    expectedValueType,
                    expectedKeyType
                );
                const dictEntryType = dictEntryTypeResult.type;
                if (dictEntryTypeResult.isIncomplete) {
                    isIncomplete = true;
                }

                if (dictEntryTypeResult.typeErrors) {
                    typeErrors = true;
                }

                // The result should be a tuple.
                if (isClassInstance(dictEntryType) && isTupleClass(dictEntryType)) {
                    const typeArgs = dictEntryType.priv.tupleTypeArgs?.map((t) => t.type);
                    if (typeArgs && typeArgs.length === 2) {
                        if (forceStrictInference || index < maxEntriesToUseForInference) {
                            keyTypes.push({ node: entryNode, type: typeArgs[0] });
                            valueTypes.push({ node: entryNode, type: typeArgs[1] });
                        }
                        addUnknown = false;
                    }
                }
            }

            if (addUnknown) {
                if (forceStrictInference || index < maxEntriesToUseForInference) {
                    keyTypes.push({ node: entryNode, type: UnknownType.create() });
                    valueTypes.push({ node: entryNode, type: UnknownType.create() });
                }
            }
        });

        return { type: AnyType.create(), isIncomplete, typeErrors };
    }

    function getTypeOfListOrSetWithContext(
        node: ListNode | SetNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext
    ): TypeResult | undefined {
        const builtInClassName = node.nodeType === ParseNodeType.List ? 'list' : 'set';
        inferenceContext.expectedType = transformPossibleRecursiveTypeAlias(inferenceContext.expectedType);

        let isIncomplete = false;
        let typeErrors = false;
        const verifyHashable = node.nodeType === ParseNodeType.Set;

        const expectedEntryType = getExpectedEntryTypeForIterable(
            node,
            getBuiltInType(node, builtInClassName),
            inferenceContext
        );
        if (!expectedEntryType) {
            return undefined;
        }

        const entryTypes: Type[] = [];
        const expectedTypeDiagAddendum = new DiagnosticAddendum();
        node.d.items.forEach((entry) => {
            let entryTypeResult: TypeResult;

            if (entry.nodeType === ParseNodeType.Comprehension) {
                entryTypeResult = getElementTypeFromComprehension(
                    entry,
                    flags | EvalFlags.StripTupleLiterals,
                    expectedEntryType
                );
            } else {
                entryTypeResult = getTypeOfExpression(
                    entry,
                    flags | EvalFlags.StripTupleLiterals,
                    makeInferenceContext(expectedEntryType)
                );
            }

            entryTypes.push(entryTypeResult.type);

            if (entryTypeResult.isIncomplete) {
                isIncomplete = true;
            }

            if (entryTypeResult.typeErrors) {
                typeErrors = true;
            }

            if (entryTypeResult.expectedTypeDiagAddendum) {
                expectedTypeDiagAddendum.addAddendum(entryTypeResult.expectedTypeDiagAddendum);
            }

            if (verifyHashable && !entryTypeResult.isIncomplete && !entryTypeResult.typeErrors) {
                verifySetEntryOrDictKeyIsHashable(entry, entryTypeResult.type, /* isDictKey */ false);
            }
        });

        let isTypeInvariant = false;

        if (isClassInstance(inferenceContext.expectedType)) {
            inferVarianceForClass(inferenceContext.expectedType);

            if (
                inferenceContext.expectedType.shared.typeParams.some(
                    (t) => TypeVarType.getVariance(t) === Variance.Invariant
                )
            ) {
                isTypeInvariant = true;
            }
        }

        const specializedEntryType = inferTypeArgFromExpectedEntryType(
            makeInferenceContext(expectedEntryType),
            entryTypes,
            !isTypeInvariant
        );
        if (!specializedEntryType) {
            return { type: UnknownType.create(), isIncomplete, typeErrors: true, expectedTypeDiagAddendum };
        }

        const type = getBuiltInObject(node, builtInClassName, [specializedEntryType]);
        return { type, isIncomplete, typeErrors, expectedTypeDiagAddendum };
    }

    function getExpectedEntryTypeForIterable(
        node: ListNode | SetNode | ComprehensionNode,
        expectedClassType: Type | undefined,
        inferenceContext?: InferenceContext
    ): Type | undefined {
        if (!inferenceContext) {
            return undefined;
        }

        if (!expectedClassType || !isInstantiableClass(expectedClassType)) {
            return undefined;
        }

        if (isAnyOrUnknown(inferenceContext.expectedType)) {
            return inferenceContext.expectedType;
        }

        if (!isClassInstance(inferenceContext.expectedType)) {
            return undefined;
        }

        const constraints = new ConstraintTracker();
        if (
            !addConstraintsForExpectedType(
                evaluatorInterface,
                ClassType.cloneAsInstance(expectedClassType),
                inferenceContext.expectedType,
                constraints,
                getTypeVarScopesForNode(node),
                node.start
            )
        ) {
            return undefined;
        }

        const specializedListOrSet = solveAndApplyConstraints(expectedClassType, constraints) as ClassType;
        if (!specializedListOrSet.priv.typeArgs) {
            return undefined;
        }

        return specializedListOrSet.priv.typeArgs[0];
    }

    function getTypeOfListOrSetInferred(
        node: ListNode | SetNode,
        flags: EvalFlags,
        hasExpectedType: boolean
    ): TypeResult {
        const builtInClassName = node.nodeType === ParseNodeType.List ? 'list' : 'set';
        const verifyHashable = node.nodeType === ParseNodeType.Set;
        let isEmptyContainer = false;
        let isIncomplete = false;
        let typeErrors = false;

        let entryTypes: Type[] = [];
        node.d.items.forEach((entry, index) => {
            let entryTypeResult: TypeResult;

            if (entry.nodeType === ParseNodeType.Comprehension && !entry.d.isGenerator) {
                entryTypeResult = getElementTypeFromComprehension(entry, flags | EvalFlags.StripTupleLiterals);
            } else {
                entryTypeResult = getTypeOfExpression(entry, flags | EvalFlags.StripTupleLiterals);
            }

            entryTypeResult.type = stripTypeForm(
                convertSpecialFormToRuntimeValue(entryTypeResult.type, flags, !hasExpectedType)
            );

            if (entryTypeResult.isIncomplete) {
                isIncomplete = true;
            }

            if (entryTypeResult.typeErrors) {
                typeErrors = true;
            }

            if (hasExpectedType || index < maxEntriesToUseForInference) {
                entryTypes.push(entryTypeResult.type);
            }

            if (verifyHashable && !entryTypeResult.isIncomplete && !entryTypeResult.typeErrors) {
                verifySetEntryOrDictKeyIsHashable(entry, entryTypeResult.type, /* isDictKey */ false);
            }
        });

        entryTypes = entryTypes.map((t) => stripLiteralValue(t));

        let inferredEntryType: Type = hasExpectedType ? AnyType.create() : UnknownType.create();
        if (entryTypes.length > 0) {
            const fileInfo = nodeInfo.getFileInfo(node);
            // If there was an expected type or we're using strict list inference,
            // combine the types into a union.
            if (
                (builtInClassName === 'list' && fileInfo.diagnosticRuleSet.strictListInference) ||
                (builtInClassName === 'set' && fileInfo.diagnosticRuleSet.strictSetInference) ||
                hasExpectedType
            ) {
                inferredEntryType = combineTypes(entryTypes, { maxSubtypeCount: maxSubtypesForInferredType });
            } else {
                // Is the list or set homogeneous? If so, use stricter rules. Otherwise relax the rules.
                inferredEntryType = areTypesSame(entryTypes, { ignorePseudoGeneric: true })
                    ? entryTypes[0]
                    : inferredEntryType;
            }
        } else {
            isEmptyContainer = true;
        }

        const listOrSetClass = getBuiltInType(node, builtInClassName);
        const type = isInstantiableClass(listOrSetClass)
            ? ClassType.cloneAsInstance(
                  ClassType.specialize(
                      listOrSetClass,
                      [inferredEntryType],
                      /* isTypeArgExplicit */ true,
                      /* includeSubclasses */ undefined,
                      /* tupleTypeArgs */ undefined,
                      isEmptyContainer
                  )
              )
            : UnknownType.create();

        if (isIncomplete) {
            if (getContainerDepth(type) > maxInferredContainerDepth) {
                return { type: UnknownType.create() };
            }
        }

        return { type, isIncomplete, typeErrors };
    }

    function getTypeOfComprehension(
        node: ComprehensionNode,
        flags: EvalFlags,
        inferenceContext?: InferenceContext
    ): TypeResult {
        let isIncomplete = false;
        let typeErrors = false;

        // If any of the "for" clauses are marked async or any of the "if" clauses
        // or any clause other than the leftmost "for" contain an "await" operator,
        // it is treated as an async generator.
        let isAsync = node.d.forIfNodes.some((comp, index) => {
            if (comp.nodeType === ParseNodeType.ComprehensionFor && comp.d.isAsync) {
                return true;
            }
            return index > 0 && ParseTreeUtils.containsAwaitNode(comp);
        });
        let type: Type = UnknownType.create();

        if (ParseTreeUtils.containsAwaitNode(node.d.expr)) {
            isAsync = true;
        }

        const builtInIteratorType = getTypingType(node, isAsync ? 'AsyncGenerator' : 'Generator');

        const expectedEntryType = getExpectedEntryTypeForIterable(node, builtInIteratorType, inferenceContext);
        const elementTypeResult = getElementTypeFromComprehension(
            node,
            flags | EvalFlags.StripTupleLiterals,
            expectedEntryType
        );

        if (elementTypeResult.isIncomplete) {
            isIncomplete = true;
        }

        if (elementTypeResult.typeErrors) {
            typeErrors = true;
        }

        let elementType = elementTypeResult.type;
        if (!expectedEntryType || !containsLiteralType(expectedEntryType)) {
            elementType = stripLiteralValue(elementType);
        }

        if (builtInIteratorType && isInstantiableClass(builtInIteratorType)) {
            type = ClassType.cloneAsInstance(
                ClassType.specialize(
                    builtInIteratorType,
                    isAsync ? [elementType, getNoneType()] : [elementType, getNoneType(), getNoneType()]
                )
            );
        }

        return { type, isIncomplete, typeErrors };
    }

    function getElementTypeFromComprehension(
        node: ComprehensionNode,
        flags: EvalFlags,
        expectedValueOrElementType?: Type,
        expectedKeyType?: Type
    ): TypeResult {
        let isIncomplete = false;
        let typeErrors = false;

        // "Execute" the list comprehensions from start to finish.
        for (const forIfNode of node.d.forIfNodes) {
            if (evaluateComprehensionForIf(forIfNode)) {
                isIncomplete = true;
            }
        }

        let type: Type = UnknownType.create();
        if (node.d.expr.nodeType === ParseNodeType.DictionaryKeyEntry) {
            // Create a tuple with the key/value types.
            const keyTypeResult = getTypeOfExpression(
                node.d.expr.d.keyExpr,
                flags,
                makeInferenceContext(expectedKeyType)
            );
            if (keyTypeResult.isIncomplete) {
                isIncomplete = true;
            }
            if (keyTypeResult.typeErrors) {
                typeErrors = true;
            }
            let keyType = keyTypeResult.type;
            if (!expectedKeyType || !containsLiteralType(expectedKeyType)) {
                keyType = stripLiteralValue(keyType);
            }

            const valueTypeResult = getTypeOfExpression(
                node.d.expr.d.valueExpr,
                flags,
                makeInferenceContext(expectedValueOrElementType)
            );
            if (valueTypeResult.isIncomplete) {
                isIncomplete = true;
            }
            if (valueTypeResult.typeErrors) {
                typeErrors = true;
            }
            let valueType = valueTypeResult.type;
            if (!expectedValueOrElementType || !containsLiteralType(expectedValueOrElementType)) {
                valueType = stripLiteralValue(valueType);
            }

            type = makeTupleObject(evaluatorInterface, [
                { type: keyType, isUnbounded: false },
                { type: valueType, isUnbounded: false },
            ]);
        } else if (node.d.expr.nodeType === ParseNodeType.DictionaryExpandEntry) {
            // The parser should have reported an error in this case because it's not allowed.
            getTypeOfExpression(node.d.expr.d.expr, flags, makeInferenceContext(expectedValueOrElementType));
        } else if (isExpressionNode(node)) {
            const exprTypeResult = getTypeOfExpression(
                node.d.expr as ExpressionNode,
                flags,
                makeInferenceContext(expectedValueOrElementType)
            );
            if (exprTypeResult.isIncomplete) {
                isIncomplete = true;
            }
            if (exprTypeResult.typeErrors) {
                typeErrors = true;
            }
            type = exprTypeResult.type;
        }

        return { type, isIncomplete, typeErrors };
    }

    function verifySetEntryOrDictKeyIsHashable(entry: ExpressionNode, type: Type, isDictKey: boolean) {
        // Verify that the type is hashable.
        if (!isTypeHashable(type)) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(LocAddendum.unhashableType().format({ type: printType(type) }));

            const message = isDictKey ? LocMessage.unhashableDictKey() : LocMessage.unhashableSetEntry();

            addDiagnostic(DiagnosticRule.reportUnhashable, message + diag.getString(), entry);
        }
    }

    function inferTypeArgFromExpectedEntryType(
        inferenceContext: InferenceContext,
        entryTypes: Type[],
        isNarrowable: boolean
    ): Type | undefined {
        // If the expected type is Any, the resulting type becomes Any.
        if (isAny(inferenceContext.expectedType)) {
            return inferenceContext.expectedType;
        }

        const constraints = new ConstraintTracker();
        const expectedType = inferenceContext.expectedType;
        let isCompatible = true;

        entryTypes.forEach((entryType) => {
            if (isCompatible && !assignType(expectedType, entryType, /* diag */ undefined, constraints)) {
                isCompatible = false;
            }
        });

        if (!isCompatible) {
            return undefined;
        }

        if (isNarrowable && entryTypes.length > 0) {
            const combinedTypes = combineTypes(entryTypes);
            return containsLiteralType(inferenceContext.expectedType)
                ? combinedTypes
                : stripLiteralValue(combinedTypes);
        }

        return mapSubtypes(
            solveAndApplyConstraints(inferenceContext.expectedType, constraints, {
                replaceUnsolved: {
                    scopeIds: [],
                    tupleClassType: getTupleClassType(),
                },
            }),
            (subtype) => {
                if (entryTypes.length !== 1) {
                    return subtype;
                }
                const entryType = entryTypes[0];

                // If the entry type is a TypedDict instance, clone it with additional information.
                if (
                    isTypeSame(subtype, entryType, { ignoreTypedDictNarrowEntries: true }) &&
                    isClass(subtype) &&
                    isClass(entryType) &&
                    ClassType.isTypedDictClass(entryType)
                ) {
                    return ClassType.cloneForNarrowedTypedDictEntries(subtype, entryType.priv.typedDictNarrowedEntries);
                }

                return subtype;
            }
        );
    }

    function evaluateComprehensionForIf(node: ComprehensionForIfNode) {
        let isIncomplete = false;

        if (node.nodeType === ParseNodeType.ComprehensionFor) {
            const iterableTypeResult = getTypeOfExpression(node.d.iterableExpr);
            if (iterableTypeResult.isIncomplete) {
                isIncomplete = true;
            }
            const iterableType = stripLiteralValue(iterableTypeResult.type);
            const itemTypeResult = getTypeOfIterator(
                { type: iterableType, isIncomplete: iterableTypeResult.isIncomplete },
                !!node.d.isAsync,
                node.d.iterableExpr
            ) ?? { type: UnknownType.create(), isIncomplete: iterableTypeResult.isIncomplete };

            const targetExpr = node.d.targetExpr;
            assignTypeToExpression(targetExpr, itemTypeResult, node.d.iterableExpr);
        } else {
            assert(node.nodeType === ParseNodeType.ComprehensionIf);

            // Evaluate the test expression to validate it and mark symbols
            // as referenced. This doesn't affect the type of the evaluated
            // comprehension, but it is important for evaluating intermediate
            // expressions such as assignment expressions that can affect other
            // subexpressions.
            getTypeOfExpression(node.d.testExpr);
        }

        return isIncomplete;
    }

    return {
        getTypeOfDictionaryWithContext,
        getTypeOfDictionaryInferred,
        getKeyAndValueTypesFromDictionary,
        getTypeOfListOrSetWithContext,
        getExpectedEntryTypeForIterable,
        getTypeOfListOrSetInferred,
        getTypeOfComprehension,
        getElementTypeFromComprehension,
        evaluateComprehensionForIf,
    };
}
