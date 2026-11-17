/*
 * collectionInference.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * collectionInference implementation, using evaluator-owned dependencies and state.
 */

import { assert } from '../../common/debug';
import { DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ComprehensionForIfNode,
    ComprehensionNode,
    DictionaryExpandEntryNode,
    DictionaryKeyEntryNode,
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

interface DictionaryInferenceOptions {
    readonly forceStrictInference: boolean;
    readonly isValueTypeInvariant: boolean;
    readonly expectedKeyType?: Type;
    readonly expectedValueType?: Type;
    readonly expectedTypedDictEntries?: TypedDictEntries;
    readonly expectedDiagAddendum?: DiagnosticAddendum;
}

interface DictionaryEntryTypeResults {
    readonly keyTypes: TypeResultWithNode[];
    readonly valueTypes: TypeResultWithNode[];
    isIncomplete: boolean;
    typeErrors: boolean;
}

interface Context {
    readonly addDiagnostic: TypeEvaluator['addDiagnostic'];
    readonly assignType: TypeEvaluator['assignType'];
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
    readonly getTypeOfExpression: TypeEvaluator['getTypeOfExpression'];
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
    readonly printType: TypeEvaluator['printType'];
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

        // Handle TypedDict's as a special case.
        if (ClassType.isTypedDictClass(concreteExpectedType)) {
            // Remove any conditions associated with the type so the resulting type isn't
            // considered compatible with a bound TypeVar.
            concreteExpectedType = TypeBase.cloneForCondition(concreteExpectedType, undefined);

            const expectedTypedDictEntries = getTypedDictMembersForClass(evaluatorInterface, concreteExpectedType);

            const { keyTypes, valueTypes, isIncomplete } = inferDictionaryEntries(node, flags, {
                forceStrictInference: true,
                isValueTypeInvariant: true,
                expectedTypedDictEntries,
                expectedDiagAddendum,
            });

            const resultTypedDict = assignToTypedDict(
                evaluatorInterface,
                concreteExpectedType,
                keyTypes,
                valueTypes,
                // Don't overwrite existing expectedDiagAddendum messages if they were
                // already provided by inferDictionaryEntries.
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

        const { keyTypes, valueTypes, isIncomplete, typeErrors } = inferDictionaryEntries(node, flags, {
            forceStrictInference: true,
            isValueTypeInvariant,
            expectedKeyType,
            expectedValueType,
            expectedDiagAddendum,
        });

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

        let isEmptyContainer = false;
        const {
            keyTypes: keyTypeResults,
            valueTypes: valueTypeResults,
            isIncomplete,
            typeErrors,
        } = inferDictionaryEntries(node, flags, {
            forceStrictInference: hasExpectedType,
            isValueTypeInvariant: false,
        });

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

    function inferDictionaryEntries(
        node: DictionaryNode,
        flags: EvalFlags,
        options: DictionaryInferenceOptions
    ): DictionaryEntryTypeResults {
        const results: DictionaryEntryTypeResults = {
            keyTypes: [],
            valueTypes: [],
            isIncomplete: false,
            typeErrors: false,
        };

        // The sampling limit restricts retained types, not evaluation or diagnostics.
        node.d.items.forEach((entryNode, index) => {
            const retainEntryTypes = options.forceStrictInference || index < maxEntriesToUseForInference;
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                inferDictionaryKeyEntry(node, entryNode, flags, options, results, retainEntryTypes);
                addUnknown = false;
            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                addUnknown = !tryInferDictionaryExpansion(entryNode, flags, options, results, retainEntryTypes);
            } else if (entryNode.nodeType === ParseNodeType.Comprehension) {
                const dictEntryTypeResult = getElementTypeFromComprehension(
                    entryNode,
                    flags | EvalFlags.StripTupleLiterals,
                    options.expectedValueType,
                    options.expectedKeyType
                );
                const dictEntryType = dictEntryTypeResult.type;
                if (dictEntryTypeResult.isIncomplete) {
                    results.isIncomplete = true;
                }

                if (dictEntryTypeResult.typeErrors) {
                    results.typeErrors = true;
                }

                // The result should be a tuple.
                if (isClassInstance(dictEntryType) && isTupleClass(dictEntryType)) {
                    const typeArgs = dictEntryType.priv.tupleTypeArgs?.map((t) => t.type);
                    if (typeArgs && typeArgs.length === 2) {
                        if (retainEntryTypes) {
                            results.keyTypes.push({ node: entryNode, type: typeArgs[0] });
                            results.valueTypes.push({ node: entryNode, type: typeArgs[1] });
                        }
                        addUnknown = false;
                    }
                }
            }

            if (addUnknown && retainEntryTypes) {
                results.keyTypes.push({ node: entryNode, type: UnknownType.create() });
                results.valueTypes.push({ node: entryNode, type: UnknownType.create() });
            }
        });

        return results;
    }

    function inferDictionaryKeyEntry(
        node: DictionaryNode,
        entryNode: DictionaryKeyEntryNode,
        flags: EvalFlags,
        options: DictionaryInferenceOptions,
        results: DictionaryEntryTypeResults,
        retainEntryTypes: boolean
    ) {
        const { expectedKeyType, expectedValueType, expectedTypedDictEntries, expectedDiagAddendum } = options;
        // Keys aren't type expressions, even within an inlined TypedDict annotation.
        const keyFlags = flags & ~(EvalFlags.TypeExpression | EvalFlags.StrLiteralAsType | EvalFlags.InstantiableType);
        const keyTypeResult = getTypeOfExpression(
            entryNode.d.keyExpr,
            keyFlags | EvalFlags.StripTupleLiterals,
            makeInferenceContext(
                expectedKeyType ?? (options.forceStrictInference ? NeverType.createNever() : undefined)
            )
        );

        if (keyTypeResult.isIncomplete) {
            results.isIncomplete = true;
        }
        if (keyTypeResult.typeErrors) {
            results.typeErrors = true;
        }

        const keyType = keyTypeResult.type;
        if (!keyTypeResult.isIncomplete && !keyTypeResult.typeErrors) {
            verifySetEntryOrDictKeyIsHashable(entryNode.d.keyExpr, keyType, /* isDictKey */ true);
        }
        if (expectedDiagAddendum && keyTypeResult.expectedTypeDiagAddendum) {
            expectedDiagAddendum.addAddendum(keyTypeResult.expectedTypeDiagAddendum);
        }

        let effectiveValueType: Type | undefined;
        if (
            expectedTypedDictEntries &&
            isClassInstance(keyType) &&
            ClassType.isBuiltIn(keyType, 'str') &&
            isLiteralType(keyType) &&
            (expectedTypedDictEntries.knownItems.has(keyType.priv.literalValue as string) ||
                expectedTypedDictEntries.extraItems)
        ) {
            effectiveValueType =
                expectedTypedDictEntries.knownItems.get(keyType.priv.literalValue as string)?.valueType ??
                expectedTypedDictEntries.extraItems?.valueType;
        } else {
            effectiveValueType =
                expectedValueType ?? (options.forceStrictInference ? NeverType.createNever() : undefined);
        }
        if (effectiveValueType) {
            const liveTypeVarScopes = getTypeVarScopesForNode(node);
            effectiveValueType = transformExpectedType(effectiveValueType, liveTypeVarScopes, node.start);
        }

        const entryInferenceContext = makeInferenceContext(effectiveValueType);
        let valueTypeResult = getTypeOfExpression(
            entryNode.d.valueExpr,
            flags | EvalFlags.StripTupleLiterals,
            entryInferenceContext
        );
        if (entryInferenceContext && !valueTypeResult.typeErrors) {
            const fromExpectedType = inferTypeArgFromExpectedEntryType(
                entryInferenceContext,
                [valueTypeResult.type],
                !options.isValueTypeInvariant
            );
            if (fromExpectedType) {
                valueTypeResult = { ...valueTypeResult, type: fromExpectedType };
            }
        }
        if (expectedDiagAddendum && valueTypeResult.expectedTypeDiagAddendum) {
            expectedDiagAddendum.addAddendum(valueTypeResult.expectedTypeDiagAddendum);
        }
        if (valueTypeResult.isIncomplete) {
            results.isIncomplete = true;
        }
        if (valueTypeResult.typeErrors) {
            results.typeErrors = true;
        }

        if (retainEntryTypes) {
            // A later literal key replaces its earlier key/value pair.
            if (isClass(keyType) && isLiteralType(keyType)) {
                const existingIndex = results.keyTypes.findIndex((kt) => isTypeSame(keyType, kt.type));
                if (existingIndex >= 0) {
                    results.keyTypes.splice(existingIndex, 1);
                    results.valueTypes.splice(existingIndex, 1);
                }
            }
            results.keyTypes.push({ node: entryNode.d.keyExpr, type: keyType });
            results.valueTypes.push({ node: entryNode.d.valueExpr, type: valueTypeResult.type });
        }
    }

    // Returns whether the expansion has a usable key/value shape, even beyond the sampling limit.
    function tryInferDictionaryExpansion(
        entryNode: DictionaryExpandEntryNode,
        flags: EvalFlags,
        options: DictionaryInferenceOptions,
        results: DictionaryEntryTypeResults,
        retainEntryTypes: boolean
    ): boolean {
        let expectedType: Type | undefined;
        if (options.expectedKeyType && options.expectedValueType) {
            if (
                context.prefetched?.supportsKeysAndGetItemClass &&
                isInstantiableClass(context.prefetched.supportsKeysAndGetItemClass)
            ) {
                expectedType = ClassType.cloneAsInstance(
                    ClassType.specialize(context.prefetched.supportsKeysAndGetItemClass, [
                        options.expectedKeyType,
                        options.expectedValueType,
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
                !options.isValueTypeInvariant
            );
            if (fromExpectedType) {
                unexpandedTypeResult = { ...unexpandedTypeResult, type: fromExpectedType };
            }
        }
        if (unexpandedTypeResult.isIncomplete) {
            results.isIncomplete = true;
        }
        if (unexpandedTypeResult.typeErrors) {
            results.typeErrors = true;
        }

        const unexpandedType = unexpandedTypeResult.type;
        if (isAnyOrUnknown(unexpandedType)) {
            if (retainEntryTypes) {
                results.keyTypes.push({ node: entryNode, type: unexpandedType });
                results.valueTypes.push({ node: entryNode, type: unexpandedType });
            }
            return true;
        }

        if (isClassInstance(unexpandedType) && ClassType.isTypedDictClass(unexpandedType)) {
            if (context.prefetched?.strClass && isInstantiableClass(context.prefetched.strClass)) {
                const strObject = ClassType.cloneAsInstance(context.prefetched.strClass);
                const tdEntries = getTypedDictMembersForClass(
                    evaluatorInterface,
                    unexpandedType,
                    /* allowNarrowed */ true
                );
                tdEntries.knownItems.forEach((entry, name) => {
                    if (!options.expectedTypedDictEntries || entry.isRequired || entry.isProvided) {
                        results.keyTypes.push({
                            node: entryNode,
                            type: ClassType.cloneWithLiteral(strObject, name),
                        });
                        results.valueTypes.push({ node: entryNode, type: entry.valueType });
                    }
                });

                if (!options.expectedTypedDictEntries) {
                    // Open TypedDicts can contain extra items with arbitrary value types.
                    results.keyTypes.push({ node: entryNode, type: ClassType.cloneAsInstance(strObject) });
                    results.valueTypes.push({
                        node: entryNode,
                        type: tdEntries.extraItems?.valueType ?? getObjectType(),
                    });
                }
                return true;
            }
        } else if (
            context.prefetched?.supportsKeysAndGetItemClass &&
            isInstantiableClass(context.prefetched.supportsKeysAndGetItemClass)
        ) {
            const mappingConstraints = new ConstraintTracker();
            const supportsKeysAndGetItemClass = selfSpecializeClass(context.prefetched.supportsKeysAndGetItemClass);
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
                    if (retainEntryTypes) {
                        results.keyTypes.push({ node: entryNode, type: typeArgs[0] });
                        results.valueTypes.push({ node: entryNode, type: typeArgs[1] });
                    }
                    return true;
                }
            } else {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.dictUnpackIsNotMapping(), entryNode);
            }
        }
        return false;
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
        getTypeOfListOrSetWithContext,
        getTypeOfListOrSetInferred,
        getTypeOfComprehension,
        evaluateComprehensionForIf,
    };
}
