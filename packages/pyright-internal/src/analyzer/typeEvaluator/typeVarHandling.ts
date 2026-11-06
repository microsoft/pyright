/*
 * typeVarHandling.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * typeVarHandling implementation, using evaluator-owned dependencies and state.
 */

import { assert } from '../../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { PythonVersion, pythonVersion3_13 } from '../../common/pythonVersion';
import { TextRange } from '../../common/textRange';
import { Uri } from '../../common/uri/uri';
import { LocMessage } from '../../localization/localize';
import { ExpressionNode, ParamCategory, ParseNode, ParseNodeType } from '../../parser/parseNodes';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { ConstraintTracker } from '../constraintTracker';
import { makeTupleObject } from '../tuples';
import {
    Arg,
    AssignTypeFlags,
    EvalFlags,
    ExpectedTypeOptions,
    MapSubtypesOptions,
    PrefetchedTypes,
    TypeResult,
    TypeResultWithNode,
} from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    ParamSpecType,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeVarKind,
    TypeVarType,
    UnionType,
    UnknownType,
    Variance,
} from '../types';
import {
    addConditionToType,
    convertToInstance,
    convertToInstantiable,
    doForEachSubtype,
    getTypeCondition,
    getTypeVarArgsRecursive,
    makeTypeVarsBound,
    mapSubtypes,
    partiallySpecializeType,
    requiresSpecialization,
    selfSpecializeClass,
    simplifyFunctionToParamSpec,
    sortTypes,
    specializeWithDefaultTypeArgs,
    transformPossibleRecursiveTypeAlias,
} from '../typeUtils';

interface Context {
    readonly addDiagnostic: (
        rule: DiagnosticRule,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) => Diagnostic | undefined;
    readonly applyConditionFilterToType: (
        type: Type,
        conditionFilter: TypeCondition[],
        recursionCount: number
    ) => Type | undefined;
    readonly assignClassToSelf: (
        destType: ClassType,
        srcType: ClassType,
        assumedVariance: Variance,
        ignoreBaseClassVariance?: boolean,
        recursionCount?: number
    ) => boolean;
    readonly assignType: (
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => boolean;
    readonly createSelfType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => UnknownType | TypeVarType;
    readonly createTypeFormType: (
        classType: ClassType,
        errorNode: ExpressionNode,
        typeArgs: TypeResultWithNode[] | undefined
    ) => Type;
    readonly getBooleanValue: (node: ExpressionNode) => boolean;
    readonly getBuiltInType: (node: ParseNode, name: string) => Type;
    readonly getObjectType: () => Type;
    readonly getTupleClassType: () => ClassType | undefined;
    readonly getTypeOfExpressionExpectingType: (node: ExpressionNode, options?: ExpectedTypeOptions) => TypeResult;
    readonly getTypeVarScopesForNode: (node: ParseNode) => string[];
    readonly getTypeVarTupleDefaultType: (node: ExpressionNode, isPep695Syntax: boolean) => Type | undefined;
    readonly isSymbolValidTypeExpression: (type: Type, includesVarDecl: boolean) => boolean;
    readonly isTypeFormClass: (type: ClassType) => boolean;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly rejectBareSpecialFormInTypeForm: (type: ClassType, node: ExpressionNode) => Type | undefined;
    readonly specializeTypeAliasWithDefaults: (type: Type, errorNode: ExpressionNode | undefined) => Type;
    readonly typePromotions: Map<string, string[]>;
    readonly updateUsageVariancesRecursive: (
        type: Type,
        typeAliasTypeParams: TypeVarType[],
        usageVariances: Variance[],
        varianceContext: Variance,
        pendingTypes?: { type: Type; key: string | undefined }[],
        recursionCount?: number
    ) => void;
    readonly verifyTypeVarDefaultIsCompatible: (typeVar: TypeVarType, defaultValueNode: ExpressionNode) => void;
}

// Builds and specializes type variables and ParamSpecs; scoped evaluation stays in the evaluator.
export function createTypeVarHandling(context: Context) {
    const {
        addDiagnostic,
        applyConditionFilterToType,
        assignClassToSelf,
        assignType,
        createSelfType,
        createTypeFormType,
        getBooleanValue,
        getBuiltInType,
        getObjectType,
        getTypeOfExpressionExpectingType,
        getTypeVarScopesForNode,
        getTypeVarTupleDefaultType,
        isSymbolValidTypeExpression,
        isTypeFormClass,
        nodeInfo,
        rejectBareSpecialFormInTypeForm,
        specializeTypeAliasWithDefaults,
        typePromotions,
        updateUsageVariancesRecursive,
        verifyTypeVarDefaultIsCompatible,
    } = context;

    function expandTypedKwargs(functionType: FunctionType): FunctionType {
        const kwargsIndex = functionType.shared.parameters.findIndex(
            (param) => param.category === ParamCategory.KwargsDict
        );
        if (kwargsIndex < 0) {
            return functionType;
        }
        assert(kwargsIndex === functionType.shared.parameters.length - 1);

        const kwargsType = FunctionType.getParamType(functionType, kwargsIndex);
        if (!isClassInstance(kwargsType) || !ClassType.isTypedDictClass(kwargsType) || !kwargsType.priv.isUnpacked) {
            return functionType;
        }

        const tdEntries = kwargsType.priv.typedDictNarrowedEntries ?? kwargsType.shared.typedDictEntries?.knownItems;
        if (!tdEntries) {
            return functionType;
        }

        const newFunction = FunctionType.clone(functionType);
        newFunction.shared.parameters.splice(kwargsIndex);
        if (newFunction.priv.specializedTypes) {
            newFunction.priv.specializedTypes.parameterTypes.splice(kwargsIndex);
        }

        const kwSeparatorIndex = functionType.shared.parameters.findIndex(
            (param) => param.category === ParamCategory.ArgsList
        );

        // Add a keyword separator if necessary.
        if (kwSeparatorIndex < 0 && tdEntries.size > 0) {
            FunctionType.addKeywordOnlyParamSeparator(newFunction);
        }

        tdEntries.forEach((tdEntry, name) => {
            // A TypedDict entry type may carry the TypedDict's own type parameters (e.g. an unpacked
            // generic TypedDict `**kwargs: Unpack[TD[int]]`), so specialize each entry against the
            // (possibly generic) TypedDict instance. Specializing an already-concrete type is a
            // no-op, so this is safe for non-generic TypedDicts.
            const specializedValueType = partiallySpecializeType(
                tdEntry.valueType,
                kwargsType,
                /* typeClassType */ undefined
            );

            FunctionType.addParam(
                newFunction,
                FunctionParam.create(
                    ParamCategory.Simple,
                    specializedValueType,
                    FunctionParamFlags.TypeDeclared,
                    name,
                    tdEntry.isRequired ? undefined : specializedValueType
                )
            );
        });

        const extraItemsType = kwargsType.shared.typedDictEntries?.extraItems?.valueType;

        if (extraItemsType && !isNever(extraItemsType)) {
            // Specialized for the same reason as the per-entry types above. This PEP 728
            // `extra_items` branch uses the identical mechanism and is intentionally not
            // separately tested.
            const specializedExtraItemsType = partiallySpecializeType(
                extraItemsType,
                kwargsType,
                /* typeClassType */ undefined
            );

            FunctionType.addParam(
                newFunction,
                FunctionParam.create(
                    ParamCategory.KwargsDict,
                    specializedExtraItemsType,
                    FunctionParamFlags.TypeDeclared,
                    'kwargs'
                )
            );
        }

        return newFunction;
    }

    function expandPromotionTypes(node: ParseNode, type: Type, excludeBytes = false): Type {
        return mapSubtypes(type, (subtype) => {
            if (!isClass(subtype) || !subtype.priv.includePromotions || subtype.priv.literalValue !== undefined) {
                return subtype;
            }

            if (excludeBytes && ClassType.isBuiltIn(subtype, 'bytes')) {
                return subtype;
            }

            const typesToCombine: Type[] = [ClassType.cloneRemoveTypePromotions(subtype)];

            const promotionTypeNames = typePromotions.get(subtype.shared.fullName);
            if (promotionTypeNames) {
                for (const promotionTypeName of promotionTypeNames) {
                    const nameSplit = promotionTypeName.split('.');
                    let promotionSubtype = getBuiltInType(node, nameSplit[nameSplit.length - 1]);

                    if (promotionSubtype && isInstantiableClass(promotionSubtype)) {
                        promotionSubtype = ClassType.cloneRemoveTypePromotions(promotionSubtype);

                        if (isClassInstance(subtype)) {
                            promotionSubtype = ClassType.cloneAsInstance(promotionSubtype);
                        }

                        promotionSubtype = addConditionToType(promotionSubtype, subtype.props?.condition);
                        typesToCombine.push(promotionSubtype);
                    }
                }
            }

            return combineTypes(typesToCombine);
        });
    }

    function makeTopLevelTypeVarsConcrete(
        type: Type,
        makeParamSpecsConcrete = false,
        conditionFilter?: TypeCondition[]
    ): Type {
        type = transformPossibleRecursiveTypeAlias(type);

        return mapSubtypes(type, (subtype) => {
            if (isParamSpec(subtype)) {
                if (subtype.priv.paramSpecAccess === 'args') {
                    return makeTupleObject(context, [{ type: getObjectType(), isUnbounded: true }]);
                } else if (subtype.priv.paramSpecAccess === 'kwargs') {
                    if (
                        context.prefetched?.dictClass &&
                        isInstantiableClass(context.prefetched.dictClass) &&
                        context.prefetched?.strClass &&
                        isInstantiableClass(context.prefetched.strClass)
                    ) {
                        return ClassType.cloneAsInstance(
                            ClassType.specialize(context.prefetched.dictClass, [
                                convertToInstance(context.prefetched.strClass),
                                getObjectType(),
                            ])
                        );
                    }

                    return UnknownType.create();
                }
            }

            // If this is a function that contains only a ParamSpec (no additional
            // parameters), convert it to a concrete type of (*args: Unknown, **kwargs: Unknown).
            if (makeParamSpecsConcrete && isFunction(subtype)) {
                const convertedType = simplifyFunctionToParamSpec(subtype);
                if (isParamSpec(convertedType)) {
                    return ParamSpecType.getUnknown();
                }
            }

            if (isTypeVarTuple(subtype)) {
                // If it's in a union, convert to type or object.
                if (subtype.priv.isInUnion) {
                    if (TypeBase.isInstantiable(subtype)) {
                        if (context.prefetched?.typeClass && isInstantiableClass(context.prefetched.typeClass)) {
                            return context.prefetched.typeClass;
                        }
                    } else {
                        return getObjectType();
                    }

                    return AnyType.create();
                }

                // Fall back to "*tuple[object, ...]".
                return makeTupleObject(context, [{ type: getObjectType(), isUnbounded: true }], /* isUnpacked */ true);
            }

            if (isTypeVar(subtype)) {
                // If this is a recursive type alias placeholder
                // that hasn't yet been resolved, return it as is.
                if (subtype.shared.recursiveAlias) {
                    return subtype;
                }

                if (TypeVarType.hasConstraints(subtype)) {
                    const typesToCombine: Type[] = [];

                    // Expand the list of constrained subtypes, filtering out any that are
                    // disallowed by the conditionFilter.
                    subtype.shared.constraints.forEach((constraintType, constraintIndex) => {
                        if (conditionFilter) {
                            const typeVarName = TypeVarType.getNameWithScope(subtype);
                            const applicableConstraint = conditionFilter.find(
                                (filter) => filter.typeVar.priv.nameWithScope === typeVarName
                            );

                            // If this type variable is being constrained to a single index,
                            // don't include the other indices.
                            if (applicableConstraint && applicableConstraint.constraintIndex !== constraintIndex) {
                                return;
                            }
                        }

                        if (TypeBase.isInstantiable(subtype)) {
                            constraintType = convertToInstantiable(constraintType);
                        }

                        typesToCombine.push(
                            addConditionToType(constraintType, [{ typeVar: subtype, constraintIndex }])
                        );
                    });

                    return combineTypes(typesToCombine);
                }

                if (subtype.shared.isExemptFromBoundCheck) {
                    return AnyType.create();
                }

                // Fall back to a bound of "object" if no bound is provided.
                let boundType = subtype.shared.boundType ?? getObjectType();

                // If this is a synthesized self/cls type var, self-specialize its type arguments.
                if (TypeVarType.isSelf(subtype) && isClass(boundType) && !ClassType.isPseudoGenericClass(boundType)) {
                    boundType = selfSpecializeClass(boundType, {
                        useBoundTypeVars: TypeVarType.isBound(subtype),
                    });
                }

                if (subtype.priv.isUnpacked && isClass(boundType)) {
                    boundType = ClassType.cloneForUnpacked(boundType);
                }

                boundType = TypeBase.isInstantiable(subtype) ? convertToInstantiable(boundType) : boundType;

                return addConditionToType(boundType, [{ typeVar: subtype, constraintIndex: 0 }]);
            }

            return subtype;
        });
    }

    function mapSubtypesExpandTypeVars(
        type: Type,
        options: MapSubtypesOptions | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type, isLastIteration: boolean) => Type | undefined,
        recursionCount = 0
    ): Type {
        const newSubtypes: Type[] = [];
        let typeChanged = false;

        function expandSubtype(unexpandedType: Type, isLastSubtype: boolean) {
            let expandedType = isUnion(unexpandedType) ? unexpandedType : makeTopLevelTypeVarsConcrete(unexpandedType);

            expandedType = transformPossibleRecursiveTypeAlias(expandedType);
            if (options?.expandCallback) {
                expandedType = options.expandCallback(expandedType);
            }

            doForEachSubtype(
                expandedType,
                (subtype, index, allSubtypes) => {
                    if (options?.conditionFilter) {
                        const filteredType = applyConditionFilterToType(
                            subtype,
                            options.conditionFilter,
                            recursionCount
                        );
                        if (!filteredType) {
                            return undefined;
                        }

                        subtype = filteredType;
                    }

                    let transformedType = callback(
                        subtype,
                        unexpandedType,
                        isLastSubtype && index === allSubtypes.length - 1
                    );

                    if (transformedType !== unexpandedType) {
                        typeChanged = true;
                    }

                    if (transformedType) {
                        // Apply the type condition if it's associated with a constrained TypeVar.
                        const typeCondition = getTypeCondition(subtype)?.filter((condition) =>
                            TypeVarType.hasConstraints(condition.typeVar)
                        );

                        if (typeCondition && typeCondition.length > 0) {
                            transformedType = addConditionToType(transformedType, typeCondition);
                        }

                        // This code path can often produce many duplicate subtypes. We can
                        // reduce the cost of the combineTypes call below by filtering out these
                        // duplicates proactively. Equal retained tuple literals can carry
                        // different inference fallbacks, which combineTypes must reconcile.
                        if (
                            newSubtypes.length === 0 ||
                            transformedType.props?.inferredTupleLiteral ||
                            newSubtypes[newSubtypes.length - 1].props?.inferredTupleLiteral ||
                            !isTypeSame(transformedType, newSubtypes[newSubtypes.length - 1])
                        ) {
                            newSubtypes.push(transformedType);
                        }
                    }
                    return undefined;
                },
                options?.sortSubtypes
            );
        }

        if (isUnion(type)) {
            const subtypes = options?.sortSubtypes ? sortTypes(type.priv.subtypes) : type.priv.subtypes;
            subtypes.forEach((subtype, index) => {
                expandSubtype(subtype, index === type.priv.subtypes.length - 1);
            });
        } else {
            expandSubtype(type, /* isLastSubtype */ true);
        }

        if (!typeChanged) {
            return type;
        }

        const newType = combineTypes(newSubtypes);

        // Do our best to retain type aliases.
        if (newType.category === TypeCategory.Union) {
            UnionType.addTypeAliasSource(newType, type);
        }
        return newType;
    }

    function addTypeFormForSymbol(node: ExpressionNode, type: Type, flags: EvalFlags, includesVarDecl: boolean): Type {
        const isIndexBase = node.parent?.nodeType === ParseNodeType.Index && node.parent.d.leftExpr === node;
        if ((flags & EvalFlags.TypeFormArg) !== 0 && isTypeVar(type) && TypeVarType.isSelf(type)) {
            type = TypeBase.cloneWithTypeForm(type, convertToInstance(type));
        }

        if ((flags & EvalFlags.TypeFormArg) !== 0 && isInstantiableClass(type) && !isIndexBase) {
            if (isTypeFormClass(type)) {
                return createTypeFormType(type, node, /* typeArgs */ undefined);
            }

            const rejectedType = rejectBareSpecialFormInTypeForm(type, node);
            if (rejectedType) {
                return rejectedType;
            }

            if (ClassType.isBuiltIn(type, 'Self')) {
                type = createSelfType(type, node, /* typeArgs */ undefined, flags);
                if (isTypeVar(type)) {
                    type = TypeBase.cloneWithTypeForm(type, convertToInstance(type));
                }
            }
        }

        const isValid = isSymbolValidTypeExpression(type, includesVarDecl);

        // If the type already has type information associated with it, don't replace.
        if (type.props?.typeForm) {
            // If the NoConvertSpecialForm flag is set, we are evaluating in
            // the interior of a type expression, so variables are not allowed.
            // Clear any existing type form type for this symbol in this case.
            if ((flags & EvalFlags.NoConvertSpecialForm) !== 0 && !isValid) {
                type = TypeBase.cloneWithTypeForm(type, undefined);
            }
            return type;
        }

        // If the symbol is not valid for a type expression (e.g. it's a variable),
        // don't add TypeForm info.
        if (!isValid) {
            return type;
        }

        if (isTypeVar(type) && type.priv.scopeId && !type.shared.isSynthesized) {
            if (!isTypeVarTuple(type) || !type.priv.isInUnion) {
                const liveScopeIds = getTypeVarScopesForNode(node);
                type = TypeBase.cloneWithTypeForm(type, convertToInstance(makeTypeVarsBound(type, liveScopeIds)));
            }
        } else if (isInstantiableClass(type) && !type.priv.includeSubclasses && !ClassType.isSpecialBuiltIn(type)) {
            if (ClassType.isBuiltIn(type, 'Any')) {
                type = TypeBase.cloneWithTypeForm(type, AnyType.create());
            } else {
                type = TypeBase.cloneWithTypeForm(type, ClassType.cloneAsInstance(specializeWithDefaultTypeArgs(type)));
            }
        }

        if (type.props?.typeAliasInfo && TypeBase.isInstantiable(type)) {
            let typeFormType = type;
            if ((flags & EvalFlags.NoSpecialize) === 0) {
                typeFormType = specializeTypeAliasWithDefaults(typeFormType, /* errorNode */ undefined);
            }

            type = TypeBase.cloneWithTypeForm(type, convertToInstance(typeFormType));
        }

        return type;
    }

    function inferVarianceForTypeAlias(type: Type): Variance[] | undefined {
        const aliasInfo = type.props?.typeAliasInfo;

        // If this isn't a generic type alias, there's nothing to do.
        if (!aliasInfo || !aliasInfo.shared.typeParams) {
            return undefined;
        }

        // Is the computed variance info already cached?
        if (aliasInfo.shared.computedVariance) {
            return aliasInfo.shared.computedVariance;
        }

        const typeParams = aliasInfo.shared.typeParams;

        // Start with all of the usage variances unknown.
        const usageVariances: Variance[] = typeParams.map(() => Variance.Unknown);

        // Prepopulate the cached value for the type alias to handle
        // recursive type aliases.
        aliasInfo.shared.computedVariance = usageVariances;

        // Traverse the type alias type definition and adjust the usage
        // variances accordingly.
        updateUsageVariancesRecursive(type, typeParams, usageVariances, Variance.Covariant);

        return usageVariances;
    }

    function getUnknownExemptTypeVarsForReturnType(functionType: FunctionType, returnType: Type): TypeVarType[] {
        if (isFunction(returnType) && !returnType.shared.name) {
            const returnTypeScopeId = returnType.shared.typeVarScopeId;

            // If one or more type vars found within the return type are scoped to
            // the functionType but don't appear anywhere else within the functionType's
            // input parameters, rescope them to the return type callable so they are
            // not replaced with Unknown.
            if (returnTypeScopeId && functionType.shared.typeVarScopeId) {
                let typeVarsInReturnType = getTypeVarArgsRecursive(returnType);

                // Remove any type variables that appear in the function's input parameters.
                functionType.shared.parameters.forEach((param, index) => {
                    if (FunctionParam.isTypeDeclared(param)) {
                        const typeVarsInInputParam = getTypeVarArgsRecursive(
                            FunctionType.getParamType(functionType, index)
                        );
                        typeVarsInReturnType = typeVarsInReturnType.filter(
                            (returnTypeVar) =>
                                !typeVarsInInputParam.some((inputTypeVar) => isTypeSame(returnTypeVar, inputTypeVar))
                        );
                    }
                });

                return typeVarsInReturnType;
            }
        }

        return [];
    }

    function createTypeVarType(errorNode: ExpressionNode, classType: ClassType, argList: Arg[]): Type | undefined {
        let typeVarName = '';
        let firstConstraintArg: Arg | undefined;
        let defaultValueNode: ExpressionNode | undefined;

        if (argList.length === 0) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.typeVarFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        } else {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarFirstArg(),
                firstArg.valueExpression || errorNode
            );
        }

        const typeVar = TypeBase.cloneAsSpecialForm(
            TypeVarType.createInstantiable(typeVarName),
            ClassType.cloneAsInstance(classType)
        );

        // Parse the remaining parameters.
        const paramNameMap = new Map<string, string>();
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.d.value : undefined;

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        LocMessage.duplicateParam().format({ name: paramName }),
                        argList[i].valueExpression || errorNode
                    );
                }

                if (paramName === 'bound') {
                    if (TypeVarType.hasConstraints(typeVar)) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarBoundAndConstrained(),
                            argList[i].valueExpression || errorNode
                        );
                    } else {
                        const argType =
                            argList[i].typeResult?.type ??
                            getTypeOfExpressionExpectingType(argList[i].valueExpression!, {
                                noNonTypeSpecialForms: true,
                                typeExpression: true,
                                parsesStringLiteral: true,
                            }).type;
                        if (
                            requiresSpecialization(argType, { ignorePseudoGeneric: true, ignoreImplicitTypeArgs: true })
                        ) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typeVarBoundGeneric(),
                                argList[i].valueExpression || errorNode
                            );
                        }
                        typeVar.shared.boundType = convertToInstance(argType);
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (
                            typeVar.shared.declaredVariance === Variance.Contravariant ||
                            typeVar.shared.declaredVariance === Variance.Auto
                        ) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typeVarVariance(),
                                argList[i].valueExpression!
                            );
                        } else {
                            typeVar.shared.declaredVariance = Variance.Covariant;
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (
                            typeVar.shared.declaredVariance === Variance.Covariant ||
                            typeVar.shared.declaredVariance === Variance.Auto
                        ) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typeVarVariance(),
                                argList[i].valueExpression!
                            );
                        } else {
                            typeVar.shared.declaredVariance = Variance.Contravariant;
                        }
                    }
                } else if (paramName === 'infer_variance') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (
                            typeVar.shared.declaredVariance === Variance.Covariant ||
                            typeVar.shared.declaredVariance === Variance.Contravariant
                        ) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typeVarVariance(),
                                argList[i].valueExpression!
                            );
                        } else {
                            typeVar.shared.declaredVariance = Variance.Auto;
                        }
                    }
                } else if (paramName === 'default') {
                    defaultValueNode = argList[i].valueExpression;
                    const argType =
                        argList[i].typeResult?.type ??
                        getTypeOfExpressionExpectingType(defaultValueNode!, {
                            allowTypeVarsWithoutScopeId: true,
                            typeExpression: true,
                        }).type;
                    typeVar.shared.defaultType = convertToInstance(argType);
                    typeVar.shared.isDefaultExplicit = true;

                    const fileInfo = nodeInfo.getFileInfo(errorNode);
                    if (
                        !fileInfo.isStubFile &&
                        PythonVersion.isLessThan(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_13) &&
                        classType.shared.moduleName !== 'typing_extensions'
                    ) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarDefaultIllegal(),
                            defaultValueNode!
                        );
                    }
                } else {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        LocMessage.typeVarUnknownParam().format({ name: paramName }),
                        argList[i].node?.d.name || argList[i].valueExpression || errorNode
                    );
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (TypeVarType.hasBound(typeVar)) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeVarBoundAndConstrained(),
                        argList[i].valueExpression || errorNode
                    );
                } else {
                    const argType =
                        argList[i].typeResult?.type ??
                        getTypeOfExpressionExpectingType(argList[i].valueExpression!, {
                            typeExpression: true,
                        }).type;

                    if (requiresSpecialization(argType, { ignorePseudoGeneric: true })) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarConstraintGeneric(),
                            argList[i].valueExpression || errorNode
                        );
                    }
                    TypeVarType.addConstraint(typeVar, convertToInstance(argType));
                    if (firstConstraintArg === undefined) {
                        firstConstraintArg = argList[i];
                    }
                }
            }
        }

        if (typeVar.shared.constraints.length === 1 && firstConstraintArg) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarSingleConstraint(),
                firstConstraintArg.valueExpression || errorNode
            );
        }

        // If a default is provided, make sure it is compatible with the bound
        // or constraint.
        if (typeVar.shared.isDefaultExplicit && defaultValueNode) {
            verifyTypeVarDefaultIsCompatible(typeVar, defaultValueNode);
        }

        return typeVar;
    }

    function createTypeVarTupleType(errorNode: ExpressionNode, classType: ClassType, argList: Arg[]): Type | undefined {
        let typeVarName = '';

        if (argList.length === 0) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.typeVarFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        } else {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarFirstArg(),
                firstArg.valueExpression || errorNode
            );
        }

        const typeVar = TypeBase.cloneAsSpecialForm(
            TypeVarType.createInstantiable(typeVarName, TypeVarKind.TypeVarTuple),
            ClassType.cloneAsInstance(classType)
        );
        typeVar.shared.defaultType = makeTupleObject(context, [{ type: UnknownType.create(), isUnbounded: true }]);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.d.value : undefined;

            if (paramName) {
                if (paramName === 'default') {
                    const expr = argList[i].valueExpression;
                    if (expr) {
                        const defaultType = getTypeVarTupleDefaultType(expr, /* isPep695Syntax */ false);
                        if (defaultType) {
                            typeVar.shared.defaultType = defaultType;
                            typeVar.shared.isDefaultExplicit = true;
                        }
                    }

                    const fileInfo = nodeInfo.getFileInfo(errorNode);
                    if (
                        !fileInfo.isStubFile &&
                        PythonVersion.isLessThan(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_13) &&
                        classType.shared.moduleName !== 'typing_extensions'
                    ) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarDefaultIllegal(),
                            expr!
                        );
                    }
                } else {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeVarTupleUnknownParam().format({ name: argList[i].name?.d.value || '?' }),
                        argList[i].node?.d.name || argList[i].valueExpression || errorNode
                    );
                }
            } else {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarTupleConstraints(),
                    argList[i].valueExpression || errorNode
                );
            }
        }

        return typeVar;
    }

    function getPseudoGenericTypeVarName(paramName: string) {
        return `__type_of_${paramName}`;
    }

    function inferVarianceForClass(classType: ClassType): void {
        if (!classType.shared.requiresVarianceInference) {
            return;
        }

        // Presumptively mark the variance inference as complete. This
        // prevents potential recursion.
        classType.shared.requiresVarianceInference = false;

        // Presumptively mark the computed variance to "unknown". We'll
        // replace this below once the variance has been inferred.
        classType.shared.typeParams.forEach((param) => {
            if (param.shared.declaredVariance === Variance.Auto) {
                param.priv.computedVariance = Variance.Unknown;
            }
        });

        const dummyTypeObject = ClassType.createInstantiable(
            '__varianceDummy',
            '',
            '',
            Uri.empty(),
            0,
            0,
            undefined,
            undefined
        );

        classType.shared.typeParams.forEach((param, paramIndex) => {
            // Skip TypeVarTuples and ParamSpecs.
            if (isTypeVarTuple(param) || isParamSpec(param)) {
                return;
            }

            // Skip type variables without auto-variance.
            if (param.shared.declaredVariance !== Variance.Auto) {
                return;
            }

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with an object instance.
            const srcTypeArgs = classType.shared.typeParams.map((p, i) => {
                if (isTypeVarTuple(p)) {
                    return p;
                }
                return i === paramIndex ? getObjectType() : dummyTypeObject;
            });

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with itself.
            const destTypeArgs = classType.shared.typeParams.map((p, i) => {
                return i === paramIndex || isTypeVarTuple(p) ? p : dummyTypeObject;
            });

            const srcType = ClassType.specialize(classType, srcTypeArgs);
            const destType = ClassType.specialize(classType, destTypeArgs);

            const isDestSubtypeOfSrc = assignClassToSelf(
                srcType,
                destType,
                Variance.Covariant,
                /* ignoreBaseClassVariance */ false
            );

            let inferredVariance: Variance;
            if (isDestSubtypeOfSrc) {
                inferredVariance = Variance.Covariant;
            } else {
                const isSrcSubtypeOfDest = assignClassToSelf(
                    destType,
                    srcType,
                    Variance.Contravariant,
                    /* ignoreBaseClassVariance */ false
                );
                if (isSrcSubtypeOfDest) {
                    inferredVariance = Variance.Contravariant;
                } else {
                    inferredVariance = Variance.Invariant;
                }
            }

            // We assume here that we don't need to clone the type var object
            // because it was already cloned when it was associated with this
            // class scope.
            classType.shared.typeParams[paramIndex].priv.computedVariance = inferredVariance;
        });
    }

    function convertToTypeFormType(expectedType: Type, srcType: Type): Type {
        // Is the source is a TypeForm type?
        if (!srcType.props?.typeForm) {
            return srcType;
        }

        let srcTypeFormType: Type | undefined;

        // Is the source is a TypeForm type?
        if (srcType.props?.typeForm) {
            srcTypeFormType = srcType.props.typeForm;
        } else if (isClass(srcType)) {
            if (TypeBase.isInstantiable(srcType)) {
                if (!ClassType.isSpecialBuiltIn(srcType)) {
                    srcTypeFormType = ClassType.cloneAsInstance(srcType);
                }
            } else if (ClassType.isBuiltIn(srcType, 'type')) {
                srcTypeFormType =
                    srcType.priv.typeArgs?.length && srcType.priv.typeArgs.length > 0
                        ? srcType.priv.typeArgs[0]
                        : UnknownType.create();
            }
        } else if (isTypeVar(srcType) && TypeBase.isInstantiable(srcType)) {
            if (!isTypeVarTuple(srcType) || !srcType.priv.isInUnion) {
                srcTypeFormType = convertToInstance(srcType);
            }
        }

        if (!srcTypeFormType) {
            return srcType;
        }

        let resultType: Type | undefined;

        doForEachSubtype(expectedType, (subtype) => {
            if (resultType || !isClassInstance(subtype) || !ClassType.isBuiltIn(subtype, 'TypeForm')) {
                return;
            }

            const destTypeFormType =
                subtype.priv.typeArgs && subtype.priv.typeArgs.length > 0 ? subtype.priv.typeArgs[0] : AnyType.create();

            if (assignType(destTypeFormType, srcTypeFormType)) {
                resultType = ClassType.specialize(subtype, [srcTypeFormType]);
            }
        });

        return resultType ?? srcType;
    }

    function setConstraintsForFreeTypeVars(
        destType: Type,
        srcType: UnknownType | AnyType,
        constraints: ConstraintTracker
    ) {
        const typeVars = getTypeVarArgsRecursive(destType);
        typeVars.forEach((typeVar) => {
            if (!TypeVarType.isBound(typeVar) && !constraints.getMainConstraintSet().getTypeVar(typeVar)) {
                // Don't set ParamSpecs or TypeVarTuples.
                if (!isParamSpec(srcType) && !isTypeVarTuple(srcType)) {
                    constraints.setBounds(typeVar, srcType);
                }
            }
        });
    }

    return {
        expandTypedKwargs,
        expandPromotionTypes,
        makeTopLevelTypeVarsConcrete,
        mapSubtypesExpandTypeVars,
        addTypeFormForSymbol,
        inferVarianceForTypeAlias,
        getUnknownExemptTypeVarsForReturnType,
        createTypeVarType,
        createTypeVarTupleType,
        getPseudoGenericTypeVarName,
        inferVarianceForClass,
        convertToTypeFormType,
        setConstraintsForFreeTypeVars,
    };
}
