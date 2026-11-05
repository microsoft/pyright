/*
 * evaluatorCore.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * evaluatorCore implementation, using evaluator-owned dependencies and state.
 */

import { appendArray } from '../../common/collectionUtils';
import { DiagnosticLevel } from '../../common/configOptions';
import { assert } from '../../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { convertOffsetsToRange } from '../../common/positionUtils';
import { PythonVersion, pythonVersion3_9 } from '../../common/pythonVersion';
import { TextRange } from '../../common/textRange';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ArgCategory,
    ArgumentNode,
    AssignmentNode,
    ClassNode,
    ComprehensionForIfNode,
    ExpressionNode,
    FunctionNode,
    NameNode,
    ParamCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    StringListNode,
} from '../../parser/parseNodes';
import { ParseOptions, Parser, ParseTextMode } from '../../parser/parser';
import { KeywordType, OperatorType } from '../../parser/tokenizerTypes';
import { isAnnotationEvaluationPostponed } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { CodeFlowEngine } from '../codeFlowEngine';
import { ConstraintSolution } from '../constraintSolution';
import { solveConstraints } from '../constraintSolver';
import { ConstraintTracker } from '../constraintTracker';
import { validateConstructorArgs } from '../constructors';
import { Declaration, DeclarationType, FunctionDeclaration } from '../declaration';
import { FunctionDecoratorInfo, getFunctionInfoFromDecorators } from '../decorators';
import { getParamListDetails } from '../parameterUtils';
import * as ParseTreeUtils from '../parseTreeUtils';
import { Scope } from '../scope';
import * as ScopeUtils from '../scopeUtils';
import { Symbol, SymbolFlags } from '../symbol';
import { isPrivateOrProtectedName } from '../symbolNameUtils';
import { getLastTypedDeclarationForSymbol } from '../symbolUtils';
import { expandTuple, makeTupleObject } from '../tuples';
import { SpeculativeTypeTracker } from '../typeCacheUtils';
import {
    ReturnTypeInferenceContext,
    SymbolResolutionStackEntry,
    TypeCacheEntry,
    TypeFormTypeCacheEntry,
} from '../typeEvaluator/internals';
import {
    AbstractSymbol,
    Arg,
    ArgWithExpression,
    AssignTypeFlags,
    CallResult,
    CallSiteEvaluationInfo,
    ClassTypeResult,
    EvalFlags,
    EvaluatorUsage,
    ExpectedTypeOptions,
    FunctionTypeResult,
    MapSubtypesOptions,
    PrefetchedTypes,
    PrintTypeOptions,
    SolveConstraintsOptions,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
    ValidateTypeArgsOptions,
} from '../typeEvaluatorTypes';
import { enumerateLiteralsForType } from '../typeGuards';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    isUnpackedTypeVarTuple,
    LiteralValue,
    maxTypeRecursionCount,
    NeverType,
    OverloadedType,
    removeUnbound,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCondition,
    TypeVarScopeId,
    TypeVarScopeType,
    TypeVarTupleType,
    TypeVarType,
    UnknownType,
    Variance,
} from '../types';
import {
    addConditionToType,
    applySolvedTypeVars,
    ApplyTypeVarOptions,
    computeMroLinearization,
    containsLiteralType,
    convertToInstance,
    derivesFromClassRecursive,
    derivesFromStdlibClass,
    doForEachSubtype,
    explodeGenericClass,
    getTypeCondition,
    getTypeVarArgsRecursive,
    getTypeVarScopeId,
    getTypeVarScopeIds,
    getUnknownTypeForCallable,
    InferenceContext,
    isEffectivelyInstantiable,
    isEllipsisType,
    isInstantiableMetaclass,
    isLiteralType,
    isNoneInstance,
    isOptionalType,
    isPartlyUnknown,
    isSentinelLiteral,
    isTupleClass,
    isTypeAliasPlaceholder,
    isVarianceOfTypeArgCompatible,
    lookUpClassMember,
    lookUpObjectMember,
    mapSubtypes,
    MemberAccessFlags,
    requiresTypeArgs,
    stripTypeForm,
    synthesizeTypeVarForSelfCls,
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
    readonly codeFlowEngine: CodeFlowEngine;
    readonly convertTypeArgToInstance: (type: Type, flags: EvalFlags) => Type;
    readonly createAnnotatedType: (
        classType: ClassType,
        errorNode: ExpressionNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => TypeResult;
    readonly createCallableType: (
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        errorNode: ParseNode
    ) => FunctionType;
    readonly createClassVarType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createConcatenateType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createFinalType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createGenericType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createOptionalType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createRequiredOrReadOnlyType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => TypeResult;
    readonly createSpecialType: (
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        paramLimit?: number,
        allowParamSpec?: boolean,
        isSpecialForm?: boolean
    ) => Type;
    readonly createTypeFormType: (
        classType: ClassType,
        errorNode: ExpressionNode,
        typeArgs: TypeResultWithNode[] | undefined
    ) => Type;
    readonly createTypeGuardType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createUnionType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly createUnpackType: (
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) => Type;
    readonly evaluatorInterface: TypeEvaluator;
    readonly getBaseClassesFromTypeCall: (baseTupleType: ClassType) => Type[] | undefined;
    readonly getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    readonly getScopeForNode: (node: ParseNode) => Scope | undefined;
    readonly getScopeIdForNode: (node: ParseNode) => string;
    readonly getTypeOfAnnotation: (node: ExpressionNode, options?: ExpectedTypeOptions) => Type;
    readonly getTypeOfArg: (arg: Arg, inferenceContext: InferenceContext | undefined) => TypeResult;
    readonly getTypeOfBoundMember: (
        errorNode: ExpressionNode | undefined,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        diag?: DiagnosticAddendum | undefined,
        flags?: MemberAccessFlags,
        selfType?: ClassType | TypeVarType,
        recursionCount?: number
    ) => TypeResult | undefined;
    readonly getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    readonly getTypeOfExpression: (
        node: ExpressionNode,
        flags?: EvalFlags,
        inferenceContext?: InferenceContext
    ) => TypeResult;
    readonly getTypeOfExpressionExpectingType: (node: ExpressionNode, options?: ExpectedTypeOptions) => TypeResult;
    readonly getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    readonly getTypeOfIterator: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError?: boolean
    ) => TypeResult | undefined;
    readonly inferFunctionReturnType: (
        node: FunctionNode,
        isAbstract: boolean,
        callerNode: ExpressionNode | undefined
    ) => TypeResult | undefined;
    readonly inferReturnTypeIfNecessary: (type: Type) => void;
    readonly inferVarianceForClass: (classType: ClassType) => void;
    readonly isTypeFormClass: (type: ClassType) => boolean;
    readonly isTypePromotionRelated: (leftType: ClassType, rightType: ClassType) => boolean;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
    readonly mapSubtypesExpandTypeVars: (
        type: Type,
        options: MapSubtypesOptions | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type, isLastIteration: boolean) => Type | undefined,
        recursionCount?: number
    ) => Type;
    readonly maxCallSiteReturnTypeCacheSize: 8;
    readonly maxReturnCallSiteTypeInferenceCodeFlowComplexity: 8;
    readonly maxReturnTypeInferenceArgCount: 6;
    readonly maxReturnTypeInferenceStackSize: 2;
    readonly maxSingleOverloadArgTypeExpansionCount: 64;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly printType: (type: Type, options?: PrintTypeOptions) => string;
    readonly returnTypeInferenceContextStack: ReturnTypeInferenceContext[];
    returnTypeInferenceTypeCache: Map<number, TypeCacheEntry> | undefined;
    returnTypeInferenceTypeFormTypeCache: Map<number, TypeFormTypeCacheEntry[]> | undefined;
    readonly speculativeTypeTracker: SpeculativeTypeTracker;
    readonly stripLiteralValue: (type: Type) => Type;
    readonly suppressDiagnostics: <T>(
        node: ParseNode,
        callback: () => T,
        diagCallback?: (suppressedDiags: string[]) => void
    ) => T;
    readonly symbolResolutionStack: SymbolResolutionStackEntry[];
    readonly transformTypeArgsForParamSpec: (
        typeParams: TypeVarType[],
        typeArgs: TypeResultWithNode[] | undefined,
        errorNode: ExpressionNode
    ) => TypeResultWithNode[] | undefined;
    readonly validateCallArgs: (
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount?: number
    ) => CallResult;
    readonly validateTypeArg: (argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions) => boolean;
    readonly validateTypeVarTupleIsUnpacked: (type: TypeVarTupleType, node: ParseNode) => boolean;
    readonly writeTypeCache: (
        node: ParseNode,
        typeResult: TypeResult,
        flags: EvalFlags | undefined,
        inferenceContext?: InferenceContext,
        allowSpeculativeCaching?: boolean
    ) => void;
}

export function createEvaluatorCore(contextDependencies: Context) {
    const {
        addDiagnostic,
        assignType,
        assignTypeToExpression,
        codeFlowEngine,
        convertTypeArgToInstance,
        createAnnotatedType,
        createCallableType,
        createClassVarType,
        createConcatenateType,
        createFinalType,
        createGenericType,
        createOptionalType,
        createRequiredOrReadOnlyType,
        createSpecialType,
        createTypeFormType,
        createTypeGuardType,
        createUnionType,
        createUnpackType,
        evaluatorInterface,
        getBaseClassesFromTypeCall,
        getEffectiveTypeOfSymbol,
        getScopeForNode,
        getScopeIdForNode,
        getTypeOfAnnotation,
        getTypeOfArg,
        getTypeOfBoundMember,
        getTypeOfClass,
        getTypeOfExpression,
        getTypeOfExpressionExpectingType,
        getTypeOfFunction,
        getTypeOfIterator,
        inferFunctionReturnType,
        inferReturnTypeIfNecessary,
        inferVarianceForClass,
        isTypeFormClass,
        isTypePromotionRelated,
        makeTopLevelTypeVarsConcrete,
        mapSubtypesExpandTypeVars,
        maxCallSiteReturnTypeCacheSize,
        maxReturnCallSiteTypeInferenceCodeFlowComplexity,
        maxReturnTypeInferenceArgCount,
        maxReturnTypeInferenceStackSize,
        maxSingleOverloadArgTypeExpansionCount,
        nodeInfo,
        printType,
        returnTypeInferenceContextStack,
        speculativeTypeTracker,
        stripLiteralValue,
        suppressDiagnostics,
        symbolResolutionStack,
        transformTypeArgsForParamSpec,
        validateCallArgs,
        validateTypeArg,
        validateTypeVarTupleIsUnpacked,
        writeTypeCache,
    } = contextDependencies;

    function isNodeInReturnTypeInferenceContext(node: ParseNode) {
        const stackSize = returnTypeInferenceContextStack.length;
        if (stackSize === 0) {
            return false;
        }

        const contextNode = returnTypeInferenceContextStack[stackSize - 1];

        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (curNode === contextNode.functionNode) {
                return true;
            }
            curNode = curNode.parent;
        }

        return false;
    }

    function getCodeFlowAnalyzerForReturnTypeInferenceContext() {
        const stackSize = returnTypeInferenceContextStack.length;
        assert(stackSize > 0);
        const contextNode = returnTypeInferenceContextStack[stackSize - 1];
        return contextNode.codeFlowAnalyzer;
    }

    function getIndexOfSymbolResolution(symbol: Symbol, declaration: Declaration) {
        return symbolResolutionStack.findIndex(
            (entry) => entry.symbolId === symbol.id && entry.declaration === declaration
        );
    }

    function validateTypeIsInstantiable(typeResult: TypeResult, flags: EvalFlags, node: ExpressionNode) {
        // If the type is incomplete, don't log any diagnostics yet.
        if (typeResult.isIncomplete) {
            return;
        }

        if ((flags & EvalFlags.NoTypeVarTuple) !== 0) {
            if (isTypeVarTuple(typeResult.type) && !typeResult.type.priv.isInUnion) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeVarTupleContext(), node);
                typeResult.type = UnknownType.create();
            }
        }

        if (isEffectivelyInstantiable(typeResult.type, { honorTypeVarBounds: true })) {
            return;
        }

        // Exempt ellipses.
        if (isClassInstance(typeResult.type) && ClassType.isBuiltIn(typeResult.type, ['EllipsisType', 'ellipsis'])) {
            return;
        }

        // Emit these errors only if we know we're evaluating a type expression.
        if ((flags & EvalFlags.TypeExpression) !== 0) {
            const diag = new DiagnosticAddendum();
            if (isUnion(typeResult.type)) {
                doForEachSubtype(typeResult.type, (subtype) => {
                    if (!isEffectivelyInstantiable(subtype, { honorTypeVarBounds: true })) {
                        diag.addMessage(LocAddendum.typeNotClass().format({ type: printType(subtype) }));
                    }
                });
            }

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeExpectedClass().format({ type: printType(typeResult.type) }) + diag.getString(),
                node
            );

            typeResult.type = UnknownType.create();
        }

        typeResult.typeErrors = true;
    }

    function solveAndApplyConstraints(
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ): Type {
        const solution = solveConstraints(evaluatorInterface, constraints, solveOptions);
        return applySolvedTypeVars(type, solution, applyOptions);
    }

    function getBoundMagicMethod(
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        diag?: DiagnosticAddendum,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        const boundMethodResult = getTypeOfBoundMember(
            errorNode,
            classType,
            memberName,
            /* usage */ undefined,
            diag,
            MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipAttributeAccessOverride,
            selfType,
            recursionCount
        );

        if (!boundMethodResult || boundMethodResult.typeErrors) {
            return undefined;
        }

        if (isFunctionOrOverloaded(boundMethodResult.type)) {
            return boundMethodResult.type;
        }

        if (isClassInstance(boundMethodResult.type)) {
            if (recursionCount > maxTypeRecursionCount) {
                return undefined;
            }
            recursionCount++;

            return getBoundMagicMethod(
                boundMethodResult.type,
                '__call__',
                /* selfType */ undefined,
                errorNode,
                diag,
                recursionCount
            );
        }

        if (isAnyOrUnknown(boundMethodResult.type)) {
            return getUnknownTypeForCallable();
        }

        return undefined;
    }

    function getTypeOfAwaitable(typeResult: TypeResult, errorNode?: ExpressionNode): TypeResult {
        if (
            !contextDependencies.prefetched?.awaitableClass ||
            !isInstantiableClass(contextDependencies.prefetched.awaitableClass) ||
            contextDependencies.prefetched.awaitableClass.shared.typeParams.length !== 1
        ) {
            return { type: UnknownType.create(), isIncomplete: typeResult.isIncomplete };
        }

        const awaitableProtocolObj = ClassType.cloneAsInstance(contextDependencies.prefetched.awaitableClass);
        const isIncomplete = !!typeResult.isIncomplete;

        const type = mapSubtypes(typeResult.type, (subtype) => {
            subtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = errorNode ? new DiagnosticAddendum() : undefined;

            if (isClassInstance(subtype)) {
                const constraints = new ConstraintTracker();

                if (assignType(awaitableProtocolObj, subtype, diag, constraints)) {
                    const specializedType = solveAndApplyConstraints(awaitableProtocolObj, constraints);

                    if (
                        isClass(specializedType) &&
                        specializedType.priv.typeArgs &&
                        specializedType.priv.typeArgs.length > 0
                    ) {
                        return specializedType.priv.typeArgs[0];
                    }

                    return UnknownType.create();
                }
            }

            if (errorNode && !typeResult.isIncomplete) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeNotAwaitable().format({ type: printType(subtype) }) + diag?.getString(),
                    errorNode
                );
            }

            return UnknownType.create();
        });

        return { type, isIncomplete };
    }

    function isTypeHashable(type: Type): boolean {
        let isTypeHashable = true;

        doForEachSubtype(makeTopLevelTypeVarsConcrete(type), (subtype) => {
            if (isClassInstance(subtype)) {
                // Assume the class is hashable.
                let isObjectHashable = true;

                // Have we already computed and cached the hashability?
                if (subtype.shared.isInstanceHashable !== undefined) {
                    isObjectHashable = subtype.shared.isInstanceHashable;
                } else {
                    const hashMember = lookUpObjectMember(subtype, '__hash__', MemberAccessFlags.SkipObjectBaseClass);

                    if (hashMember && hashMember.isTypeDeclared) {
                        const decls = hashMember.symbol.getTypedDeclarations();
                        const synthesizedType = hashMember.symbol.getSynthesizedType();

                        // Handle the case where the type is synthesized (used for
                        // dataclasses).
                        if (synthesizedType) {
                            isObjectHashable = !isNoneInstance(synthesizedType.type);
                        } else {
                            // Assume that if '__hash__' is declared as a variable, it is
                            // not hashable. If it's declared as a function, it is. We'll
                            // skip evaluating its full type because that's not needed in
                            // this case.
                            if (decls.every((decl) => decl.type === DeclarationType.Variable)) {
                                isObjectHashable = false;
                            }
                        }
                    }

                    // Cache the hashability for next time.
                    subtype.shared.isInstanceHashable = isObjectHashable;
                }

                if (!isObjectHashable) {
                    isTypeHashable = false;
                }
            }
        });

        return isTypeHashable;
    }

    function getTypedDictClassType(): ClassType | undefined {
        return contextDependencies.prefetched?.typedDictPrivateClass &&
            isInstantiableClass(contextDependencies.prefetched.typedDictPrivateClass)
            ? contextDependencies.prefetched.typedDictPrivateClass
            : undefined;
    }

    function getTupleClassType(): ClassType | undefined {
        return contextDependencies.prefetched?.tupleClass &&
            isInstantiableClass(contextDependencies.prefetched.tupleClass)
            ? contextDependencies.prefetched.tupleClass
            : undefined;
    }

    function getDictClassType(): ClassType | undefined {
        return contextDependencies.prefetched?.dictClass &&
            isInstantiableClass(contextDependencies.prefetched.dictClass)
            ? contextDependencies.prefetched.dictClass
            : undefined;
    }

    function getStrClassType(): ClassType | undefined {
        return contextDependencies.prefetched?.strClass && isInstantiableClass(contextDependencies.prefetched.strClass)
            ? contextDependencies.prefetched.strClass
            : undefined;
    }

    function getObjectType(): Type {
        return contextDependencies.prefetched?.objectClass
            ? convertToInstance(contextDependencies.prefetched.objectClass)
            : UnknownType.create();
    }

    function getNoneType(): Type {
        return contextDependencies.prefetched?.noneTypeClass
            ? convertToInstance(contextDependencies.prefetched.noneTypeClass)
            : UnknownType.create();
    }

    function getUnionClassType(): Type {
        return contextDependencies.prefetched?.unionTypeClass ?? UnknownType.create();
    }

    function getTypeClassType(): ClassType | undefined {
        if (
            contextDependencies.prefetched?.typeClass &&
            isInstantiableClass(contextDependencies.prefetched.typeClass)
        ) {
            return contextDependencies.prefetched.typeClass;
        }
        return undefined;
    }

    function applyConditionFilterToType(
        type: Type,
        conditionFilter: TypeCondition[],
        recursionCount: number
    ): Type | undefined {
        if (recursionCount > maxTypeRecursionCount) {
            return type;
        }
        recursionCount++;

        // If the type has a condition associated with it, make sure it's compatible.
        if (!TypeCondition.isCompatible(getTypeCondition(type), conditionFilter)) {
            return undefined;
        }

        // If the type is generic, see if any of its type arguments should be filtered.
        // This is possible only in cases where the type parameter is covariant.

        // TODO - handle functions and tuples
        if (isClass(type) && type.priv.typeArgs && !type.priv.tupleTypeArgs) {
            inferVarianceForClass(type);

            let typeWasTransformed = false;

            const filteredTypeArgs = type.priv.typeArgs.map((typeArg, index) => {
                if (index >= type.shared.typeParams.length) {
                    return typeArg;
                }

                const variance = TypeVarType.getVariance(type.shared.typeParams[index]);
                if (variance !== Variance.Covariant) {
                    return typeArg;
                }

                // Don't expand recursive type aliases because they can
                // cause infinite recursion.
                if (isTypeVar(typeArg) && typeArg.shared.recursiveAlias) {
                    return typeArg;
                }

                const filteredTypeArg = mapSubtypesExpandTypeVars(
                    typeArg,
                    { conditionFilter },
                    (expandedSubtype) => {
                        return expandedSubtype;
                    },
                    recursionCount
                );

                if (filteredTypeArg !== typeArg) {
                    typeWasTransformed = true;
                }

                return filteredTypeArg;
            });

            if (typeWasTransformed) {
                return ClassType.specialize(type, filteredTypeArgs);
            }
        }

        return type;
    }

    function verifyRaiseExceptionType(node: ExpressionNode, allowNone: boolean) {
        const baseExceptionType = getBuiltInType(node, 'BaseException');
        const exceptionType = getTypeOfExpression(node).type;

        // Validate that the argument of "raise" is an exception object or class.
        // If it is a class, validate that the class's constructor accepts zero
        // arguments.
        if (exceptionType && baseExceptionType && isInstantiableClass(baseExceptionType)) {
            const diag = new DiagnosticAddendum();

            doForEachSubtype(exceptionType, (subtype) => {
                const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

                if (isAnyOrUnknown(concreteSubtype) || isNever(concreteSubtype)) {
                    return;
                }

                if (allowNone && isNoneInstance(concreteSubtype)) {
                    return;
                }

                if (isInstantiableClass(concreteSubtype) && concreteSubtype.priv.literalValue === undefined) {
                    if (!derivesFromClassRecursive(concreteSubtype, baseExceptionType, /* ignoreUnknown */ false)) {
                        diag.addMessage(
                            LocMessage.exceptionTypeIncorrect().format({
                                type: printType(subtype),
                            })
                        );
                    } else {
                        let callResult: CallResult | undefined;
                        suppressDiagnostics(node, () => {
                            callResult = validateConstructorArgs(
                                evaluatorInterface,
                                node,
                                [],
                                concreteSubtype,
                                /* skipUnknownArgCheck */ false,
                                /* inferenceContext */ undefined
                            );
                        });

                        if (callResult && callResult.argumentErrors) {
                            diag.addMessage(
                                LocMessage.exceptionTypeNotInstantiable().format({
                                    type: printType(subtype),
                                })
                            );
                        }
                    }
                } else if (isClassInstance(concreteSubtype)) {
                    if (
                        !derivesFromClassRecursive(
                            ClassType.cloneAsInstantiable(concreteSubtype),
                            baseExceptionType,
                            /* ignoreUnknown */ false
                        )
                    ) {
                        diag.addMessage(
                            LocMessage.exceptionTypeIncorrect().format({
                                type: printType(subtype),
                            })
                        );
                    }
                } else {
                    diag.addMessage(
                        LocMessage.exceptionTypeIncorrect().format({
                            type: printType(subtype),
                        })
                    );
                }
            });

            if (!diag.isEmpty()) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.expectedExceptionClass() + diag.getString(),
                    node
                );
            }
        }
    }

    function isSymbolValidTypeExpression(type: Type, includesVarDecl: boolean): boolean {
        // Verify that the name does not refer to a (non type alias) variable.
        if (!includesVarDecl || type.props?.typeAliasInfo) {
            return true;
        }

        if (isTypeAliasPlaceholder(type)) {
            return true;
        }

        if (isTypeVar(type)) {
            if (type.props?.specialForm || type.props?.typeAliasInfo) {
                return true;
            }
        }

        // Exempts class types that are created by calling NewType, NamedTuple, etc.
        if (isClass(type) && !type.priv.includeSubclasses && ClassType.isValidTypeAliasClass(type)) {
            return true;
        }

        if (isSentinelLiteral(type)) {
            return true;
        }

        return false;
    }

    function convertSpecialFormToRuntimeValue(type: Type, flags: EvalFlags, convertModule = false) {
        const exemptFlags = EvalFlags.TypeExpression | EvalFlags.InstantiableType | EvalFlags.NoConvertSpecialForm;

        if ((flags & exemptFlags) !== 0) {
            return type;
        }

        if (
            convertModule &&
            isModule(type) &&
            contextDependencies.prefetched?.moduleTypeClass &&
            isInstantiableClass(contextDependencies.prefetched.moduleTypeClass)
        ) {
            return ClassType.cloneAsInstance(contextDependencies.prefetched.moduleTypeClass);
        }

        // Isinstance treats traditional (non-PEP 695) type aliases that are unions
        // as tuples of classes rather than unions.
        if ((flags & EvalFlags.IsinstanceArg) !== 0) {
            if (isUnion(type) && type.props?.typeAliasInfo && !type.props.typeAliasInfo.shared.isTypeAliasType) {
                return type;
            }
        }

        if (!type.props?.specialForm) {
            return type;
        }

        // If this is a type alias and we are not supposed to specialize it, return it as is.
        if ((flags & EvalFlags.NoSpecialize) !== 0 && type.props?.typeAliasInfo) {
            // Special-case TypeAliasType which should be converted in this case.
            if (!ClassType.isBuiltIn(type.props.specialForm, 'TypeAliasType')) {
                return type;
            }
        }

        if (type.props?.typeForm) {
            return TypeBase.cloneWithTypeForm(type.props.specialForm, type.props.typeForm);
        }

        return type.props.specialForm;
    }

    function reportMissingTypeArgs(node: ExpressionNode, type: Type, flags: EvalFlags): Type {
        if ((flags & EvalFlags.NoSpecialize) !== 0) {
            return type;
        }

        // Is this a generic class that needs to be specialized?
        if (isInstantiableClass(type)) {
            if ((flags & EvalFlags.InstantiableType) !== 0 && (flags & EvalFlags.AllowMissingTypeArgs) === 0) {
                if (!type.props?.typeAliasInfo && !isTypeFormClass(type) && requiresTypeArgs(type)) {
                    if (!type.priv.typeArgs || !type.priv.isTypeArgExplicit) {
                        addDiagnostic(
                            DiagnosticRule.reportMissingTypeArgument,
                            LocMessage.typeArgsMissingForClass().format({
                                name: type.priv.aliasName || type.shared.name,
                            }),
                            node
                        );
                    }
                }
            }

            if (!type.priv.typeArgs) {
                type = createSpecializedClassType(type, /* typeArgs */ undefined, flags, node)?.type;
            }
        }

        // Is this a generic type alias that needs to be specialized?
        if ((flags & EvalFlags.InstantiableType) !== 0) {
            type = specializeTypeAliasWithDefaults(type, node);
        }

        return type;
    }

    function isClassWithAsymmetricAttributeAccessor(classType: ClassType): boolean {
        // If the value has already been cached in this type, return the cached value.
        if (classType.priv.isAsymmetricAttributeAccessor !== undefined) {
            return classType.priv.isAsymmetricAttributeAccessor;
        }

        let isAsymmetric = false;

        const getterSymbolResult = lookUpClassMember(classType, '__getattr__', MemberAccessFlags.SkipBaseClasses);
        const setterSymbolResult = lookUpClassMember(classType, '__setattr__', MemberAccessFlags.SkipBaseClasses);

        if (!getterSymbolResult || !setterSymbolResult) {
            isAsymmetric = false;
        } else {
            const getterType = getEffectiveTypeOfSymbol(getterSymbolResult.symbol);
            const setterType = getEffectiveTypeOfSymbol(setterSymbolResult.symbol);

            // If either the setter or getter is an overload (or some other non-function type),
            // conservatively assume that it's not asymmetric.
            if (isFunction(getterType) && isFunction(setterType)) {
                // If there's no declared return type on the getter, assume it's symmetric.
                if (setterType.shared.parameters.length >= 3 && getterType.shared.declaredReturnType) {
                    const setterValueType = FunctionType.getParamType(setterType, 2);
                    const getterReturnType = FunctionType.getEffectiveReturnType(getterType) ?? UnknownType.create();

                    if (!isTypeSame(setterValueType, getterReturnType)) {
                        isAsymmetric = true;
                    }
                }
            }
        }

        // Cache the value for next time.
        classType.priv.isAsymmetricAttributeAccessor = isAsymmetric;
        return isAsymmetric;
    }

    function specializeTypeAliasWithDefaults(type: Type, errorNode: ExpressionNode | undefined) {
        // Is this a type alias?
        const aliasInfo = type.props?.typeAliasInfo;
        if (!aliasInfo) {
            return type;
        }

        // Is this a generic type alias that needs specializing?
        if (!aliasInfo.shared.typeParams || aliasInfo.shared.typeParams.length === 0 || aliasInfo.typeArgs) {
            return type;
        }

        let reportDiag = false;
        const defaultTypeArgs: Type[] = [];
        const constraints = new ConstraintTracker();

        aliasInfo.shared.typeParams.forEach((param) => {
            if (!param.shared.isDefaultExplicit) {
                reportDiag = true;
            }

            let defaultType: Type;
            if (param.shared.isDefaultExplicit || isParamSpec(param)) {
                defaultType = solveAndApplyConstraints(param, constraints, {
                    replaceUnsolved: {
                        scopeIds: [aliasInfo.shared.typeVarScopeId],
                        tupleClassType: getTupleClassType(),
                    },
                });
            } else if (
                isTypeVarTuple(param) &&
                contextDependencies.prefetched?.tupleClass &&
                isInstantiableClass(contextDependencies.prefetched.tupleClass)
            ) {
                defaultType = makeTupleObject(
                    evaluatorInterface,
                    [{ type: UnknownType.create(), isUnbounded: true }],
                    /* isUnpacked */ true
                );
            } else {
                defaultType = UnknownType.create();
            }

            defaultTypeArgs.push(defaultType);
            constraints.setBounds(param, defaultType);
        });

        if (reportDiag && errorNode) {
            addDiagnostic(
                DiagnosticRule.reportMissingTypeArgument,
                LocMessage.typeArgsMissingForAlias().format({
                    name: aliasInfo.shared.name,
                }),
                errorNode
            );
        }

        type = TypeBase.cloneForTypeAlias(
            solveAndApplyConstraints(type, constraints, {
                replaceUnsolved: {
                    scopeIds: [aliasInfo.shared.typeVarScopeId],
                    tupleClassType: getTupleClassType(),
                },
            }),
            { ...aliasInfo, typeArgs: defaultTypeArgs }
        );

        return type;
    }

    function buildTupleTypesList(
        entryTypeResults: TypeResult[],
        stripLiterals: boolean,
        convertModule: boolean
    ): TupleTypeArg[] {
        const entryTypes: TupleTypeArg[] = [];

        for (const typeResult of entryTypeResults) {
            let possibleUnpackedTuple: Type | undefined;
            if (typeResult.unpackedType) {
                possibleUnpackedTuple = typeResult.unpackedType;
            } else if (isUnpacked(typeResult.type)) {
                possibleUnpackedTuple = typeResult.type;
            }

            // Is this an unpacked tuple? If so, we can append the individual
            // unpacked entries onto the new tuple. If it's not an upacked tuple
            // but some other iterator (e.g. a List), we won't know the number of
            // items, so we'll need to leave the Tuple open-ended.
            if (
                possibleUnpackedTuple &&
                isClassInstance(possibleUnpackedTuple) &&
                possibleUnpackedTuple.priv.tupleTypeArgs
            ) {
                const typeArgs = possibleUnpackedTuple.priv.tupleTypeArgs;

                if (!typeArgs) {
                    entryTypes.push({ type: UnknownType.create(), isUnbounded: true });
                } else {
                    appendArray(entryTypes, typeArgs);
                }
            } else if (isNever(typeResult.type) && typeResult.isIncomplete && !typeResult.unpackedType) {
                entryTypes.push({ type: UnknownType.create(/* isIncomplete */ true), isUnbounded: false });
            } else {
                let entryType = convertSpecialFormToRuntimeValue(typeResult.type, EvalFlags.None, convertModule);
                entryType = stripLiterals ? stripTypeForm(stripLiteralValue(entryType)) : entryType;
                entryTypes.push({ type: entryType, isUnbounded: !!typeResult.unpackedType });
            }
        }

        // If there are multiple unbounded entries, combine all of them into a single
        // unbounded entry to avoid violating the invariant that there can be at most
        // one unbounded entry in a tuple.
        if (entryTypes.filter((t) => t.isUnbounded).length > 1) {
            const firstUnboundedEntryIndex = entryTypes.findIndex((t) => t.isUnbounded);
            const removedEntries = entryTypes.splice(firstUnboundedEntryIndex);
            entryTypes.push({ type: combineTypes(removedEntries.map((t) => t.type)), isUnbounded: true });
        }

        return entryTypes;
    }

    function convertNodeToArg(node: ArgumentNode): ArgWithExpression {
        return {
            argCategory: node.d.argCategory,
            name: node.d.name,
            valueExpression: node.d.valueExpr,
        };
    }

    function getSpeculativeNodeForCall(errorNode: ExpressionNode): ParseNode {
        // If the error node is within an arg, expand to include the parent of the arg list.
        const argParent = ParseTreeUtils.getParentNodeOfType(errorNode, ParseNodeType.Argument);
        if (argParent?.parent) {
            return argParent.parent;
        }

        // If the error node is the name in a class declaration, expand to include the class node.
        if (
            errorNode.nodeType === ParseNodeType.Name &&
            errorNode.parent?.nodeType === ParseNodeType.Class &&
            errorNode.parent.d.name === errorNode
        ) {
            return errorNode.parent;
        }

        return errorNode;
    }

    function expandArgType(type: Type): Type[] | undefined {
        const expandedTypes: Type[] = [];

        // Expand any top-level type variables with constraints.
        type = makeTopLevelTypeVarsConcrete(type);

        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype)) {
                // Expand any bool or Enum literals.
                const expandedLiteralTypes = enumerateLiteralsForType(evaluatorInterface, subtype);
                if (expandedLiteralTypes && expandedLiteralTypes.length <= maxSingleOverloadArgTypeExpansionCount) {
                    appendArray(expandedTypes, expandedLiteralTypes);
                    return;
                }

                // Expand any fixed-size tuples.
                const expandedTuples = expandTuple(subtype, maxSingleOverloadArgTypeExpansionCount);
                if (expandedTuples) {
                    appendArray(expandedTypes, expandedTuples);
                    return;
                }
            }

            expandedTypes.push(subtype);
        });

        return expandedTypes.length > 1 ? expandedTypes : undefined;
    }

    function getAbstractSymbolInfo(classType: ClassType, symbolName: string): AbstractSymbol | undefined {
        const isProtocolClass = ClassType.isProtocolClass(classType);

        const symbol = ClassType.getSymbolTable(classType).get(symbolName);
        if (!symbol) {
            return undefined;
        }

        // Ignore instance variables. Also, ignore named tuple members, which are
        // modeled in pyright as instance variables, but their runtime implementation
        // uses a descriptor object.
        if (!symbol.isClassMember() && !symbol.isNamedTupleMemberMember()) {
            return undefined;
        }

        const lastDecl = getLastTypedDeclarationForSymbol(symbol);
        if (!lastDecl) {
            return undefined;
        }

        // Handle protocol variables specially.
        if (isProtocolClass && lastDecl.type === DeclarationType.Variable) {
            // If none of the declarations involve assignments, assume it's
            // not implemented in the protocol.
            const allDecls = symbol.getDeclarations();
            if (!allDecls.some((decl) => decl.type === DeclarationType.Variable && !!decl.inferredTypeSource)) {
                return { symbol, symbolName, classType, hasImplementation: false };
            }
        }

        if (lastDecl.type !== DeclarationType.Function) {
            return undefined;
        }

        let isAbstract = false;
        const lastFunctionInfo = getFunctionInfoFromDecorators(
            evaluatorInterface,
            lastDecl.node,
            /* isInClass */ true,
            nodeInfo
        );
        if ((lastFunctionInfo.flags & FunctionTypeFlags.AbstractMethod) !== 0) {
            isAbstract = true;
        }

        const isStubFile = nodeInfo.getFileInfo(lastDecl.node).isStubFile;

        // In an overloaded method, the first overload can also be marked abstract.
        // In stub files, there is no implementation, so this is the only way to mark
        // an overloaded method as abstract.
        const firstDecl = symbol.getDeclarations()[0];
        let firstFunctionInfo: FunctionDecoratorInfo | undefined;

        if (firstDecl !== lastDecl && firstDecl.type === DeclarationType.Function) {
            firstFunctionInfo = getFunctionInfoFromDecorators(
                evaluatorInterface,
                firstDecl.node,
                /* isInClass */ true,
                nodeInfo
            );
            if ((firstFunctionInfo.flags & FunctionTypeFlags.AbstractMethod) !== 0) {
                isAbstract = true;
            }

            // If there's no implementation, assume it's unimplemented.
            if (isProtocolClass && (lastFunctionInfo.flags & FunctionTypeFlags.Overloaded) !== 0) {
                // If this is a protocol class method defined in a stub file and
                // it's not marked abstract, assume it's not abstract and implemented.
                if (isProtocolClass && !isAbstract && isStubFile) {
                    return undefined;
                }

                return { symbol, symbolName, classType, hasImplementation: false };
            }
        }

        // In a non-protocol class, if the method isn't explicitly marked abstract,
        // then it's not abstract.
        if (!isProtocolClass && !isAbstract) {
            return undefined;
        }

        const hasImplementation =
            !ParseTreeUtils.isSuiteEmpty(lastDecl.node.d.suite) && !methodAlwaysRaisesNotImplemented(lastDecl);

        // If this is a protocol class, the method isn't explicitly marked
        // as abstract, and there is an implementation, then it's a default
        // implementation, and it's not considered abstract. If it's in a stub
        // file, assume it's implemented in this case.
        if (isProtocolClass && !isAbstract) {
            if (hasImplementation || isStubFile) {
                return undefined;
            }
        }

        return { symbol, symbolName, classType, hasImplementation };
    }

    function validateCallForClassInstance(
        errorNode: ExpressionNode,
        argList: Arg[],
        expandedCallType: ClassType,
        unexpandedCallType: Type,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount: number
    ): CallResult {
        const callDiag = new DiagnosticAddendum();
        const callMethodResult = getTypeOfBoundMember(
            errorNode,
            expandedCallType,
            '__call__',
            /* usage */ undefined,
            callDiag,
            MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipAttributeAccessOverride,
            /* selfType */ undefined,
            recursionCount
        );
        const callMethodType = callMethodResult?.type;

        if (!callMethodType || callMethodResult.typeErrors) {
            addDiagnostic(
                DiagnosticRule.reportCallIssue,
                LocMessage.objectNotCallable().format({
                    type: printType(expandedCallType),
                }) + callDiag.getString(),
                errorNode
            );

            return { returnType: UnknownType.create(), argumentErrors: true };
        }

        const callResult = validateCallArgs(
            errorNode,
            argList,
            { type: callMethodType },
            constraints,
            skipUnknownArgCheck,
            inferenceContext,
            recursionCount
        );

        let returnType = callResult.returnType ?? UnknownType.create();
        if (
            isTypeVar(unexpandedCallType) &&
            TypeBase.isInstantiable(unexpandedCallType) &&
            isClass(expandedCallType) &&
            ClassType.isBuiltIn(expandedCallType, 'type')
        ) {
            // Handle the case where a type[T] is being called. We presume this
            // will instantiate an object of type T.
            returnType = convertToInstance(unexpandedCallType);
        }

        return {
            returnType,
            argumentErrors: callResult.argumentErrors,
            overloadsUsedForCall: callResult.overloadsUsedForCall,
        };
    }

    function adjustCallableReturnType(
        callNode: ExpressionNode,
        returnType: Type,
        liveTypeVarScopes: TypeVarScopeId[]
    ): Type {
        if (!isFunction(returnType)) {
            return returnType;
        }

        // What type variables are referenced in the callable return type? Do not include any live type variables.
        const typeParams = getTypeVarArgsRecursive(returnType).filter(
            (t) => !liveTypeVarScopes.some((scopeId) => t.priv.scopeId === scopeId)
        );

        // If there are no unsolved type variables, we're done. If there are
        // unsolved type variables, rescope them to the callable.
        if (typeParams.length === 0) {
            return returnType;
        }

        inferReturnTypeIfNecessary(returnType);

        // Create a new scope ID based on the caller's position. This
        // will guarantee uniqueness. If another caller uses the same
        // call and arguments, the type vars will not conflict.
        const newScopeId = getScopeIdForNode(callNode);
        const solution = new ConstraintSolution();

        const newTypeParams = typeParams.map((typeVar) => {
            const newTypeParam = TypeVarType.cloneForScopeId(
                typeVar,
                newScopeId,
                typeVar.priv.scopeName,
                TypeVarScopeType.Function
            );
            solution.setType(typeVar, newTypeParam);
            return newTypeParam;
        });

        return applySolvedTypeVars(
            FunctionType.cloneWithNewTypeVarScopeId(
                returnType,
                newScopeId,
                /* constructorTypeVarScopeId */ undefined,
                newTypeParams
            ),
            solution
        );
    }

    function verifyTypeVarDefaultIsCompatible(typeVar: TypeVarType, defaultValueNode: ExpressionNode) {
        assert(typeVar.shared.isDefaultExplicit);

        const constraints = new ConstraintTracker();
        const concreteDefaultType = makeTopLevelTypeVarsConcrete(
            solveAndApplyConstraints(typeVar.shared.defaultType, constraints, {
                replaceUnsolved: {
                    scopeIds: getTypeVarScopeIds(typeVar),
                    tupleClassType: getTupleClassType(),
                },
            })
        );

        if (typeVar.shared.boundType) {
            if (!assignType(typeVar.shared.boundType, concreteDefaultType)) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarDefaultBoundMismatch(),
                    defaultValueNode
                );
            }
        } else if (TypeVarType.hasConstraints(typeVar)) {
            let isConstraintCompatible = true;

            // If the default type is a constrained TypeVar, make sure all of its constraints
            // are also constraints in typeVar. If the default type is not a constrained TypeVar,
            // use its concrete type to compare against the constraints.
            if (isTypeVar(typeVar.shared.defaultType) && TypeVarType.hasConstraints(typeVar.shared.defaultType)) {
                for (const constraint of typeVar.shared.defaultType.shared.constraints) {
                    if (!typeVar.shared.constraints.some((c) => isTypeSame(c, constraint))) {
                        isConstraintCompatible = false;
                    }
                }
            } else if (
                !typeVar.shared.constraints.some((constraint) =>
                    isTypeSame(constraint, concreteDefaultType, { ignoreConditions: true })
                )
            ) {
                isConstraintCompatible = false;
            }

            if (!isConstraintCompatible) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarDefaultConstraintMismatch(),
                    defaultValueNode
                );
            }
        }
    }

    function getTypeVarTupleDefaultType(node: ExpressionNode, isPep695Syntax: boolean): Type | undefined {
        const argType = getTypeOfExpressionExpectingType(node, {
            allowUnpackedTuple: true,
            allowTypeVarsWithoutScopeId: true,
            forwardRefs: isPep695Syntax,
            typeExpression: true,
        }).type;
        const isUnpackedTuple = isClass(argType) && isTupleClass(argType) && argType.priv.isUnpacked;
        const isUnpackedTypeVar = isUnpackedTypeVarTuple(argType);

        if (!isUnpackedTuple && !isUnpackedTypeVar) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.typeVarTupleDefaultNotUnpacked(), node);
            return undefined;
        }

        return convertToInstance(argType);
    }

    function getFunctionFullName(functionNode: ParseNode, moduleName: string, functionName: string): string {
        const nameParts: string[] = [functionName];

        let curNode: ParseNode | undefined = functionNode;

        // Walk the parse tree looking for classes or functions.
        while (curNode) {
            curNode = ParseTreeUtils.getEnclosingClassOrFunction(curNode);
            if (curNode) {
                nameParts.push(curNode.d.name.d.value);
            }
        }

        nameParts.push(moduleName);

        return nameParts.reverse().join('.');
    }

    function createNewType(errorNode: ExpressionNode, argList: Arg[]): ClassType | undefined {
        const fileInfo = nodeInfo.getFileInfo(errorNode);
        let className = '';

        if (argList.length !== 2) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.newTypeParamCount(), errorNode);
            return undefined;
        }

        const nameArg = argList[0];
        if (
            nameArg.argCategory === ArgCategory.Simple &&
            nameArg.valueExpression &&
            nameArg.valueExpression.nodeType === ParseNodeType.StringList
        ) {
            className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        }

        if (!className) {
            addDiagnostic(DiagnosticRule.reportArgumentType, LocMessage.newTypeBadName(), argList[0].node ?? errorNode);
            return undefined;
        }

        if (
            errorNode.parent?.nodeType === ParseNodeType.Assignment &&
            errorNode.parent.d.leftExpr.nodeType === ParseNodeType.Name &&
            errorNode.parent.d.leftExpr.d.value !== className
        ) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNameMismatch(),
                errorNode.parent.d.leftExpr
            );
            return undefined;
        }

        let baseClass = getTypeOfArgExpectingType(argList[1]).type;
        let isBaseClassAny = false;

        if (isAnyOrUnknown(baseClass)) {
            baseClass = contextDependencies.prefetched?.objectClass ?? UnknownType.create();

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeAnyOrUnknown(),
                argList[1].node ?? errorNode
            );

            isBaseClassAny = true;
        }

        // Specifically disallow Annotated.
        if (
            baseClass.props?.specialForm &&
            isClassInstance(baseClass.props.specialForm) &&
            ClassType.isBuiltIn(baseClass.props.specialForm, 'Annotated')
        ) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNotAClass(),
                argList[1].node || errorNode
            );
            return undefined;
        }

        if (!isInstantiableClass(baseClass)) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNotAClass(),
                argList[1].node || errorNode
            );
            return undefined;
        }

        if (ClassType.isProtocolClass(baseClass) || ClassType.isTypedDictClass(baseClass)) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeProtocolClass(),
                argList[1].node || errorNode
            );
        } else if (baseClass.priv.literalValue !== undefined) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeLiteral(),
                argList[1].node || errorNode
            );
        }

        const classType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.Final | ClassTypeFlags.NewTypeClass | ClassTypeFlags.ValidTypeAliasClass,
            ParseTreeUtils.getTypeSourceId(errorNode),
            /* declaredMetaclass */ undefined,
            baseClass.shared.effectiveMetaclass
        );
        classType.shared.baseClasses.push(isBaseClassAny ? AnyType.create() : baseClass);
        computeMroLinearization(classType);

        if (!isBaseClassAny) {
            // Synthesize an __init__ method that accepts only the specified type.
            const initType = FunctionType.createSynthesizedInstance('__init__');
            FunctionType.addParam(
                initType,
                FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
            );
            FunctionType.addParam(
                initType,
                FunctionParam.create(
                    ParamCategory.Simple,
                    ClassType.cloneAsInstance(baseClass),
                    FunctionParamFlags.TypeDeclared,
                    '_x'
                )
            );
            initType.shared.declaredReturnType = getNoneType();
            ClassType.getSymbolTable(classType).set(
                '__init__',
                Symbol.createWithType(SymbolFlags.ClassMember, initType)
            );

            // Synthesize a trivial __new__ method.
            const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
            FunctionType.addParam(
                newType,
                FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'cls')
            );
            FunctionType.addDefaultParams(newType);
            newType.shared.declaredReturnType = ClassType.cloneAsInstance(classType);
            newType.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);
            ClassType.getSymbolTable(classType).set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        }

        return classType;
    }

    function createClassFromMetaclass(
        errorNode: ExpressionNode,
        argList: Arg[],
        metaclass: ClassType
    ): ClassType | undefined {
        const fileInfo = nodeInfo.getFileInfo(errorNode);
        const arg0Type = getTypeOfArg(argList[0], /* inferenceContext */ undefined).type;
        if (!isClassInstance(arg0Type) || !ClassType.isBuiltIn(arg0Type, 'str')) {
            return undefined;
        }
        const className = (arg0Type.priv.literalValue as string) || '_';

        const baseTupleType = getTypeOfArg(argList[1], /* inferenceContext */ undefined).type;
        if (!isClassInstance(baseTupleType)) {
            return undefined;
        }

        const baseClasses = getBaseClassesFromTypeCall(baseTupleType);
        if (!baseClasses) {
            return undefined;
        }

        const classType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.ValidTypeAliasClass,
            ParseTreeUtils.getTypeSourceId(errorNode),
            metaclass,
            baseTupleType.shared.effectiveMetaclass
        );
        classType.shared.baseClasses.push(...baseClasses);

        if (!computeMroLinearization(classType)) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.methodOrdering(), errorNode);
        }

        return classType;
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

    function reportPossibleUnknownAssignment(
        diagLevel: DiagnosticLevel,
        rule: DiagnosticRule,
        target: NameNode,
        type: Type,
        errorNode: ExpressionNode,
        ignoreEmptyContainers: boolean
    ) {
        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.d.value;

        // Sometimes variables contain an "unbound" type if they're
        // assigned only within conditional statements. Remove this
        // to avoid confusion.
        const simplifiedType = removeUnbound(type);

        if (isUnknown(simplifiedType)) {
            addDiagnostic(rule, LocMessage.typeUnknown().format({ name: nameValue }), errorNode);
        } else if (isPartlyUnknown(simplifiedType)) {
            // If ignoreEmptyContainers is true, don't report the problem for
            // empty containers (lists or dictionaries). We'll report the problem
            // only if the assigned value is used later.
            if (!ignoreEmptyContainers || !isClassInstance(type) || !type.priv.isEmptyContainer) {
                const diagAddendum = new DiagnosticAddendum();
                diagAddendum.addMessage(
                    LocAddendum.typeOfSymbol().format({
                        name: nameValue,
                        type: printType(simplifiedType, { expandTypeAlias: true }),
                    })
                );
                addDiagnostic(
                    rule,
                    LocMessage.typePartiallyUnknown().format({ name: nameValue }) + diagAddendum.getString(),
                    errorNode
                );
            }
        }
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

    function cloneBuiltinObjectWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        const type = getBuiltInObject(node, builtInName);
        if (isClassInstance(type)) {
            return ClassType.cloneWithLiteral(ClassType.cloneRemoveTypePromotions(type), value);
        }

        return UnknownType.create();
    }

    function cloneBuiltinClassWithLiteral(
        node: ParseNode,
        literalClassType: ClassType,
        builtInName: string,
        value: LiteralValue
    ): Type {
        const type = getBuiltInType(node, builtInName);
        if (isInstantiableClass(type)) {
            const literalType = ClassType.cloneWithLiteral(type, value);
            TypeBase.setSpecialForm(literalType, literalClassType);
            return literalType;
        }

        return UnknownType.create();
    }

    function createSelfType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) {
        // Self doesn't support any type arguments.
        if (typeArgs && typeArgs.length > 0) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeArguments,
                LocMessage.typeArgsExpectingNone().format({
                    name: classType.shared.name,
                }),
                typeArgs[0].node ?? errorNode
            );
        }

        let enclosingClass = ParseTreeUtils.getEnclosingClass(errorNode);

        // If `Self` appears anywhere outside of the class body (e.g. a decorator,
        // base class list, metaclass argument, type parameter list), it is
        // considered illegal.
        if (enclosingClass && !ParseTreeUtils.isNodeContainedWithin(errorNode, enclosingClass.d.suite)) {
            enclosingClass = undefined;
        }

        const enclosingClassTypeResult = enclosingClass ? getTypeOfClass(enclosingClass) : undefined;
        if (!enclosingClassTypeResult) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.InstantiableType | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeContext(), errorNode);
            }

            return UnknownType.create();
        } else if (isInstantiableMetaclass(enclosingClassTypeResult.classType)) {
            // If `Self` appears within a metaclass, it is considered illegal.
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeMetaclass(), errorNode);

            return UnknownType.create();
        }

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(errorNode);
        if (enclosingFunction) {
            const functionInfo = getFunctionInfoFromDecorators(
                evaluatorInterface,
                enclosingFunction,
                /* isInClass */ true,
                nodeInfo
            );

            const isInnerFunction = !!ParseTreeUtils.getEnclosingFunction(enclosingFunction);
            if (!isInnerFunction) {
                // Check for static methods.
                if (functionInfo.flags & FunctionTypeFlags.StaticMethod) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeContext(), errorNode);

                    return UnknownType.create();
                }

                if (enclosingFunction.d.params.length > 0) {
                    const firstParamTypeAnnotation = ParseTreeUtils.getTypeAnnotationForParam(enclosingFunction, 0);
                    if (
                        firstParamTypeAnnotation &&
                        !ParseTreeUtils.isNodeContainedWithin(errorNode, firstParamTypeAnnotation)
                    ) {
                        const annotationType = getTypeOfAnnotation(firstParamTypeAnnotation, {
                            typeVarGetsCurScope: true,
                        });
                        if (!isTypeVar(annotationType) || !TypeVarType.isSelf(annotationType)) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.selfTypeWithTypedSelfOrCls(),
                                errorNode
                            );
                        }
                    }
                }
            }
        }

        let result = synthesizeTypeVarForSelfCls(enclosingClassTypeResult.classType, /* isClsParam */ true);

        if (enclosingClass) {
            // If "Self" is used as a type expression within a function suite, it needs
            // to be marked as bound.
            const enclosingSuite = ParseTreeUtils.getEnclosingClassOrFunctionSuite(errorNode);

            if (enclosingSuite && ParseTreeUtils.isNodeContainedWithin(enclosingSuite, enclosingClass)) {
                if (enclosingClass.d.suite !== enclosingSuite) {
                    result = TypeVarType.cloneAsBound(result);
                }
            }
        }

        return result;
    }

    function createSubclass(errorNode: ExpressionNode, type1: ClassType, type2: ClassType): ClassType {
        assert(isInstantiableClass(type1) && isInstantiableClass(type2));

        // If both classes are class objects (type[A] and type[B]), create a new
        // class object (type[A & B]) rather than "type[A] & type[B]".
        let createClassObject = false;
        if (TypeBase.getInstantiableDepth(type1) > 0 && TypeBase.getInstantiableDepth(type2) > 0) {
            type1 = ClassType.cloneAsInstance(type1);
            type2 = ClassType.cloneAsInstance(type2);
            createClassObject = true;
        }

        const className = `<subclass of ${printType(convertToInstance(type1), {
            omitTypeArgsIfUnknown: true,
        })} and ${printType(convertToInstance(type2), { omitTypeArgsIfUnknown: true })}>`;
        const fileInfo = nodeInfo.getFileInfo(errorNode);

        // The effective metaclass of the intersection is the narrower of the two metaclasses.
        let effectiveMetaclass = type1.shared.effectiveMetaclass;
        if (type2.shared.effectiveMetaclass) {
            if (!effectiveMetaclass || assignType(effectiveMetaclass, type2.shared.effectiveMetaclass)) {
                effectiveMetaclass = type2.shared.effectiveMetaclass;
            }
        }

        let newClassType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.None,
            ParseTreeUtils.getTypeSourceId(errorNode),
            /* declaredMetaclass */ undefined,
            effectiveMetaclass,
            type1.shared.docString
        );

        newClassType.shared.baseClasses = [type1, type2];
        computeMroLinearization(newClassType);

        newClassType = addConditionToType(newClassType, type1.props?.condition);
        newClassType = addConditionToType(newClassType, type2.props?.condition);

        if (createClassObject) {
            newClassType = ClassType.cloneAsInstantiable(newClassType);
        }

        return newClassType;
    }

    function buildTypeParamsFromTypeArgs(classType: ClassType): TypeVarType[] {
        const typeParams: TypeVarType[] = [];
        const typeArgs = classType.priv.typeArgs ?? [];

        typeArgs.forEach((typeArg, index) => {
            if (isTypeVar(typeArg)) {
                typeParams.push(typeArg);
                return;
            }

            // Synthesize a dummy type parameter.
            const typeVar = TypeVarType.createInstance(`__P${index}`);
            typeVar.shared.isSynthesized = true;
            typeParams.push(typeVar);
        });

        return typeParams;
    }

    function computeEffectiveMetaclass(classType: ClassType, errorNode: ParseNode) {
        let effectiveMetaclass = classType.shared.declaredMetaclass;
        let reportedMetaclassConflict = false;

        if (!effectiveMetaclass || isInstantiableClass(effectiveMetaclass)) {
            for (const baseClass of classType.shared.baseClasses) {
                if (isInstantiableClass(baseClass)) {
                    const baseClassMeta =
                        baseClass.shared.effectiveMetaclass ?? contextDependencies.prefetched?.typeClass;
                    if (baseClassMeta && isInstantiableClass(baseClassMeta)) {
                        // Make sure there is no metaclass conflict.
                        if (!effectiveMetaclass) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            derivesFromClassRecursive(baseClassMeta, effectiveMetaclass, /* ignoreUnknown */ false)
                        ) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            !derivesFromClassRecursive(effectiveMetaclass, baseClassMeta, /* ignoreUnknown */ false)
                        ) {
                            if (!reportedMetaclassConflict) {
                                const diag = new DiagnosticAddendum();

                                diag.addMessage(
                                    LocAddendum.metaclassConflict().format({
                                        metaclass1: printType(convertToInstance(effectiveMetaclass)),
                                        metaclass2: printType(convertToInstance(baseClassMeta)),
                                    })
                                );
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.metaclassConflict() + diag.getString(),
                                    errorNode
                                );

                                // Don't report more than once.
                                reportedMetaclassConflict = true;
                            }
                        }
                    } else {
                        effectiveMetaclass = baseClassMeta ? UnknownType.create() : undefined;
                        break;
                    }
                } else {
                    // If one of the base classes is unknown, then the effective
                    // metaclass is also unknowable.
                    effectiveMetaclass = UnknownType.create();
                    break;
                }
            }
        }

        // If we haven't found an effective metaclass, assume "type", which
        // is the metaclass for "object".
        if (!effectiveMetaclass) {
            const typeMetaclass = getBuiltInType(errorNode, 'type');
            effectiveMetaclass =
                typeMetaclass && isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create();
        }

        classType.shared.effectiveMetaclass = effectiveMetaclass;

        return effectiveMetaclass;
    }

    function adjustParamAnnotatedType(param: ParameterNode, type: Type): Type {
        // PEP 484 indicates that if a parameter has a default value of 'None'
        // the type checker should assume that the type is optional (i.e. a union
        // of the specified type and 'None'). Skip this step if the type is already
        // optional to avoid losing alias names when combining the types.
        if (
            param.d.defaultValue?.nodeType === ParseNodeType.Constant &&
            param.d.defaultValue.d.constType === KeywordType.None &&
            !isOptionalType(type) &&
            !nodeInfo.getFileInfo(param).diagnosticRuleSet.strictParameterNoneValue
        ) {
            return combineTypes([type, getNoneType()]);
        }

        return type;
    }

    function inferParamTypeFromDefaultValue(paramValueExpr: ExpressionNode) {
        const defaultValueType = getTypeOfExpression(paramValueExpr, EvalFlags.ConvertEllipsisToAny).type;

        let inferredParamType: Type | undefined;

        // Is the default value a "None", a sentinel, or an instance of some private
        // class (one whose name starts with an underscore)? If so, we will assume
        // that the value is a singleton sentinel. The actual supported type is
        // going to be a union of this type and Unknown.
        if (
            isNoneInstance(defaultValueType) ||
            isSentinelLiteral(defaultValueType) ||
            (isClassInstance(defaultValueType) && isPrivateOrProtectedName(defaultValueType.shared.name))
        ) {
            inferredParamType = combineTypes([defaultValueType, UnknownType.create()]);
        } else {
            let skipInference = false;

            if (isFunctionOrOverloaded(defaultValueType)) {
                // Do not infer parameter types that use a lambda or another function as a
                // default value. We're likely to generate false positives in this case.
                // It's not clear whether parameters should be positional-only or not.
                skipInference = true;
            } else if (
                isClassInstance(defaultValueType) &&
                ClassType.isBuiltIn(defaultValueType, ['tuple', 'list', 'set', 'dict'])
            ) {
                // Do not infer certain types like tuple because it's likely to be
                // more restrictive (narrower) than intended.
                skipInference = true;
            }

            if (!skipInference) {
                inferredParamType = convertSpecialFormToRuntimeValue(
                    defaultValueType,
                    EvalFlags.None,
                    /* convertModule */ true
                );
                inferredParamType = stripTypeForm(inferredParamType);
                inferredParamType = stripLiteralValue(inferredParamType);
            }
        }

        if (inferredParamType) {
            const fileInfo = nodeInfo.getFileInfo(paramValueExpr);
            if (fileInfo.isInPyTypedPackage && !fileInfo.isStubFile) {
                inferredParamType = TypeBase.cloneForAmbiguousType(inferredParamType);
            }
        }

        return inferredParamType;
    }

    function transformVariadicParamType(node: ParseNode, paramCategory: ParamCategory, type: Type): Type {
        switch (paramCategory) {
            case ParamCategory.Simple: {
                return type;
            }

            case ParamCategory.ArgsList: {
                if (isParamSpec(type) && type.priv.paramSpecAccess) {
                    return type;
                }

                if (isUnpackedClass(type)) {
                    return ClassType.cloneForPacked(type);
                }

                return makeTupleObject(evaluatorInterface, [{ type, isUnbounded: !isTypeVarTuple(type) }]);
            }

            case ParamCategory.KwargsDict: {
                // Leave a ParamSpec alone.
                if (isParamSpec(type) && type.priv.paramSpecAccess) {
                    return type;
                }

                // Is this an unpacked TypedDict? If so, return its packed version.
                if (isClassInstance(type) && ClassType.isTypedDictClass(type) && type.priv.isUnpacked) {
                    return ClassType.cloneForPacked(type);
                }

                // Wrap the type in a dict with str keys.
                const dictType = getBuiltInType(node, 'dict');
                const strType = getBuiltInObject(node, 'str');

                if (isInstantiableClass(dictType) && isClassInstance(strType)) {
                    return ClassType.cloneAsInstance(ClassType.specialize(dictType, [strType, type]));
                }

                return UnknownType.create();
            }
        }
    }

    function methodAlwaysRaisesNotImplemented(functionDecl?: FunctionDeclaration): boolean {
        if (
            !functionDecl ||
            !functionDecl.isMethod ||
            functionDecl.returnStatements ||
            functionDecl.yieldStatements ||
            !functionDecl.raiseStatements
        ) {
            return false;
        }

        const statements = functionDecl.node.d.suite.d.statements;
        if (statements.some((statement) => statement.nodeType !== ParseNodeType.StatementList)) {
            return false;
        }

        for (const raiseStatement of functionDecl.raiseStatements) {
            if (!raiseStatement.d.expr || raiseStatement.d.fromExpr) {
                return false;
            }
            const raiseType = getTypeOfExpression(raiseStatement.d.expr).type;
            const classType = isInstantiableClass(raiseType)
                ? raiseType
                : isClassInstance(raiseType)
                ? raiseType
                : undefined;
            if (!classType || !derivesFromStdlibClass(classType, 'NotImplementedError')) {
                return false;
            }
        }

        return true;
    }

    function createSpecializedClassType(
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags,
        errorNode: ExpressionNode
    ): TypeResult {
        let isValidTypeForm = true;

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (ClassType.isSpecialBuiltIn(classType)) {
            const aliasedName = classType.priv.aliasName || classType.shared.name;
            switch (aliasedName) {
                case 'Callable': {
                    return { type: createCallableType(classType, typeArgs, errorNode) };
                }

                case 'Never':
                case 'NoReturn': {
                    if (typeArgs && typeArgs.length > 0) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeArgsExpectingNone().format({ name: aliasedName }),
                            typeArgs[0].node
                        );
                    }

                    let resultType = aliasedName === 'Never' ? NeverType.createNever() : NeverType.createNoReturn();
                    resultType = TypeBase.cloneAsSpecialForm(resultType, classType);
                    resultType = TypeBase.cloneWithTypeForm(resultType, convertToInstance(resultType));

                    return { type: resultType };
                }

                case 'Optional': {
                    return { type: createOptionalType(classType, errorNode, typeArgs, flags) };
                }

                case 'Type': {
                    let typeType = createSpecialType(
                        classType,
                        typeArgs,
                        1,
                        /* allowParamSpec */ undefined,
                        /* isSpecialForm */ false
                    );

                    if (isInstantiableClass(typeType)) {
                        typeType = explodeGenericClass(typeType);
                    }

                    typeType = TypeBase.cloneWithTypeForm(typeType, convertToInstance(typeType));

                    return { type: typeType };
                }

                case 'ClassVar': {
                    return { type: createClassVarType(classType, errorNode, typeArgs, flags) };
                }

                case 'Protocol': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.protocolNotAllowed(), errorNode);
                    }

                    typeArgs?.forEach((typeArg) => {
                        if (typeArg.typeList || !isTypeVar(typeArg.type)) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.protocolTypeArgMustBeTypeParam(),
                                typeArg.node
                            );
                        }
                    });

                    return {
                        type: createSpecialType(
                            classType,
                            typeArgs,
                            /* paramLimit */ undefined,
                            /* allowParamSpec */ true
                        ),
                    };
                }

                case 'TypedDict': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        const isInlinedTypedDict =
                            nodeInfo.getFileInfo(errorNode).diagnosticRuleSet.enableExperimentalFeatures && !!typeArgs;

                        if (!isInlinedTypedDict) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.typedDictNotAllowed(),
                                errorNode
                            );
                        }
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'Literal': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalNotAllowed(), errorNode);
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'TypeAlias': {
                    if ((flags & EvalFlags.TypeFormArg) !== 0) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeAnnotationVariable(),
                            errorNode
                        );
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'Tuple': {
                    return {
                        type: createSpecialType(
                            classType,
                            typeArgs,
                            /* paramLimit */ undefined,
                            /* allowParamSpec */ false,
                            /* isSpecialForm */ false
                        ),
                    };
                }

                case 'Union': {
                    return { type: createUnionType(classType, errorNode, typeArgs, flags) };
                }

                case 'Generic': {
                    return { type: createGenericType(classType, errorNode, typeArgs, flags) };
                }

                case 'Final': {
                    return { type: createFinalType(classType, errorNode, typeArgs, flags) };
                }

                case 'Annotated': {
                    return createAnnotatedType(classType, errorNode, typeArgs, flags);
                }

                case 'Concatenate': {
                    return { type: createConcatenateType(classType, errorNode, typeArgs, flags) };
                }

                case 'TypeGuard':
                case 'TypeIs': {
                    return { type: createTypeGuardType(classType, errorNode, typeArgs, flags) };
                }

                case 'Unpack': {
                    return { type: createUnpackType(classType, errorNode, typeArgs, flags) };
                }

                case 'Required':
                case 'NotRequired': {
                    return createRequiredOrReadOnlyType(classType, errorNode, typeArgs, flags);
                }

                case 'ReadOnly': {
                    return createRequiredOrReadOnlyType(classType, errorNode, typeArgs, flags);
                }

                case 'Self': {
                    return { type: createSelfType(classType, errorNode, typeArgs, flags) };
                }

                case 'LiteralString': {
                    return { type: createSpecialType(classType, typeArgs, 0) };
                }

                case 'TypeForm': {
                    return { type: createTypeFormType(classType, errorNode, typeArgs) };
                }
            }
        }

        const fileInfo = nodeInfo.getFileInfo(errorNode);
        if (
            fileInfo.isStubFile ||
            PythonVersion.isGreaterOrEqualTo(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_9) ||
            isAnnotationEvaluationPostponed(nodeInfo.getFileInfo(errorNode)) ||
            (flags & EvalFlags.ForwardRefs) !== 0
        ) {
            // Handle "type" specially, since it needs to act like "Type"
            // in Python 3.9 and newer.
            if (ClassType.isBuiltIn(classType, 'type') && typeArgs) {
                if (typeArgs.length >= 1) {
                    // Treat type[function] as illegal.
                    if (isFunctionOrOverloaded(typeArgs[0].type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeAnnotationWithCallable(),
                            typeArgs[0].node
                        );

                        return { type: UnknownType.create() };
                    }
                }

                if (
                    contextDependencies.prefetched?.typeClass &&
                    isInstantiableClass(contextDependencies.prefetched.typeClass)
                ) {
                    let typeType = createSpecialType(
                        contextDependencies.prefetched.typeClass,
                        typeArgs,
                        1,
                        /* allowParamSpec */ undefined,
                        /* isSpecialForm */ false
                    );

                    if (isInstantiableClass(typeType)) {
                        typeType = explodeGenericClass(typeType);
                    }

                    typeType = TypeBase.cloneWithTypeForm(typeType, convertToInstance(typeType));

                    return { type: typeType };
                }
            }

            // Handle "tuple" specially, since it needs to act like "Tuple"
            // in Python 3.9 and newer.
            if (isTupleClass(classType)) {
                let specializedClass = createSpecialType(
                    classType,
                    typeArgs,
                    /* paramLimit */ undefined,
                    /* allowParamSpec */ undefined,
                    /* isSpecialForm */ false
                );

                specializedClass = TypeBase.cloneWithTypeForm(specializedClass, convertToInstance(specializedClass));

                return { type: specializedClass };
            }
        }

        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        const typeParams = ClassType.isPseudoGenericClass(classType) ? [] : ClassType.getTypeParams(classType);

        // If there are no type parameters or args, the class is already specialized.
        // No need to do any more work.
        if (typeParams.length === 0 && typeArgCount === 0) {
            return { type: classType };
        }

        const variadicTypeParamIndex = typeParams.findIndex((param) => isTypeVarTuple(param));

        if (typeArgs) {
            let minTypeArgCount = typeParams.length;
            const firstDefaultParamIndex = typeParams.findIndex((param) => !!param.shared.isDefaultExplicit);

            if (firstDefaultParamIndex >= 0) {
                minTypeArgCount = firstDefaultParamIndex;
            }

            // Classes that accept inlined type dict type args allow only one.
            if (typeArgs.length > 0 && typeArgs[0].inlinedTypeDict) {
                if (typeArgs.length > 1) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeArguments,
                        LocMessage.typeArgsTooMany().format({
                            name: classType.priv.aliasName || classType.shared.name,
                            expected: 1,
                            received: typeArgCount,
                        }),
                        typeArgs[1].node
                    );
                }

                let inlinedTypeDict: Type = typeArgs[0].inlinedTypeDict;
                if ((flags & EvalFlags.TypeFormArg) !== 0) {
                    inlinedTypeDict = TypeBase.cloneWithTypeForm(inlinedTypeDict, convertToInstance(inlinedTypeDict));
                }

                return { type: inlinedTypeDict };
            } else if (typeArgCount > typeParams.length) {
                if (!ClassType.isPartiallyEvaluated(classType) && !ClassType.isTupleClass(classType)) {
                    if (typeParams.length === 0) {
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeArgsExpectingNone().format({
                                name: classType.priv.aliasName || classType.shared.name,
                            }),
                            typeArgs[typeParams.length].node
                        );
                    } else if (typeParams.length !== 1 || !isParamSpec(typeParams[0])) {
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeArgsTooMany().format({
                                name: classType.priv.aliasName || classType.shared.name,
                                expected: typeParams.length,
                                received: typeArgCount,
                            }),
                            typeArgs[typeParams.length].node
                        );
                    }

                    typeArgCount = typeParams.length;
                }
            } else if (typeArgCount < minTypeArgCount) {
                isValidTypeForm = false;
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeArguments,
                    LocMessage.typeArgsTooFew().format({
                        name: classType.priv.aliasName || classType.shared.name,
                        expected: minTypeArgCount,
                        received: typeArgCount,
                    }),
                    typeArgs.length > 0 ? typeArgs[0].node.parent! : errorNode
                );
            }

            typeArgs.forEach((typeArg, index) => {
                if (!typeArg.type.props?.typeForm) {
                    isValidTypeForm = false;
                }

                if (index === variadicTypeParamIndex) {
                    // The types that make up the tuple that maps to the
                    // TypeVarTuple have already been validated when the tuple
                    // object was created in adjustTypeArgsForTypeVarTuple.
                    if (isClassInstance(typeArg.type) && isTupleClass(typeArg.type)) {
                        return;
                    }

                    if (isTypeVarTuple(typeArg.type)) {
                        if (!validateTypeVarTupleIsUnpacked(typeArg.type, typeArg.node)) {
                            isValidTypeForm = false;
                        }
                        return;
                    }
                }

                const typeParam = index < typeParams.length ? typeParams[index] : undefined;
                const isParamSpecTarget = typeParam && isParamSpec(typeParam);

                if (
                    !validateTypeArg(typeArg, {
                        allowParamSpec: true,
                        allowTypeArgList: isParamSpecTarget,
                    })
                ) {
                    isValidTypeForm = false;
                }
            });
        }

        // Handle ParamSpec arguments and fill in any missing type arguments with Unknown.
        let typeArgTypes: Type[] = [];
        const fullTypeParams = ClassType.getTypeParams(classType);

        typeArgs = transformTypeArgsForParamSpec(fullTypeParams, typeArgs, errorNode);
        if (!typeArgs) {
            isValidTypeForm = false;
        }

        const constraints = new ConstraintTracker();

        fullTypeParams.forEach((typeParam, index) => {
            if (typeArgs && index < typeArgs.length) {
                if (isParamSpec(typeParam)) {
                    const typeArg = typeArgs[index];
                    const functionType = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.ParamSpecValue);

                    if (isEllipsisType(typeArg.type)) {
                        FunctionType.addDefaultParams(functionType);
                        functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                        typeArgTypes.push(functionType);
                        constraints.setBounds(typeParam, functionType);
                        return;
                    }

                    if (typeArg.typeList) {
                        typeArg.typeList!.forEach((paramType, paramIndex) => {
                            FunctionType.addParam(
                                functionType,
                                FunctionParam.create(
                                    ParamCategory.Simple,
                                    convertToInstance(paramType.type),
                                    FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                    `__p${paramIndex}`
                                )
                            );
                        });

                        if (typeArg.typeList.length > 0) {
                            FunctionType.addPositionOnlyParamSeparator(functionType);
                        }

                        typeArgTypes.push(functionType);
                        constraints.setBounds(typeParam, functionType);
                        return;
                    }

                    if (isInstantiableClass(typeArg.type) && ClassType.isBuiltIn(typeArg.type, 'Concatenate')) {
                        const concatTypeArgs = typeArg.type.priv.typeArgs;
                        if (concatTypeArgs && concatTypeArgs.length > 0) {
                            concatTypeArgs.forEach((typeArg, index) => {
                                if (index === concatTypeArgs.length - 1) {
                                    if (isParamSpec(typeArg)) {
                                        FunctionType.addParamSpecVariadics(functionType, typeArg);
                                    } else if (isEllipsisType(typeArg)) {
                                        FunctionType.addDefaultParams(functionType);
                                        functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                                    }
                                } else {
                                    FunctionType.addParam(
                                        functionType,
                                        FunctionParam.create(
                                            ParamCategory.Simple,
                                            typeArg,
                                            FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                            `__p${index}`
                                        )
                                    );
                                }
                            });
                        }

                        typeArgTypes.push(functionType);
                        return;
                    }
                }

                const typeArgType = convertTypeArgToInstance(typeArgs[index].type, flags);
                typeArgTypes.push(typeArgType);
                constraints.setBounds(typeParam, typeArgType);
                return;
            }

            const solvedDefaultType = solveAndApplyConstraints(typeParam, constraints, {
                replaceUnsolved: {
                    scopeIds: getTypeVarScopeIds(classType),
                    tupleClassType: getTupleClassType(),
                },
            });
            typeArgTypes.push(solvedDefaultType);
            constraints.setBounds(typeParam, solvedDefaultType);
        });

        typeArgTypes = typeArgTypes.map((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                let adjustedTypeArgType = applyTypeArgToTypeVar(typeParams[index], typeArgType, diag);

                // Determine if the variance must match.
                if (adjustedTypeArgType && (flags & EvalFlags.EnforceVarianceConsistency) !== 0) {
                    const destType = typeParams[index];
                    const declaredVariance = destType.shared.declaredVariance;

                    if (!isVarianceOfTypeArgCompatible(adjustedTypeArgType, declaredVariance)) {
                        diag.addMessage(
                            LocAddendum.varianceMismatchForClass().format({
                                typeVarName: printType(adjustedTypeArgType),
                                className: classType.shared.name,
                            })
                        );
                        adjustedTypeArgType = undefined;
                    }
                }

                if (adjustedTypeArgType) {
                    typeArgType = adjustedTypeArgType;
                } else {
                    // Avoid emitting this error for a partially-constructed class.
                    if (!isClassInstance(typeArgType) || !ClassType.isPartiallyEvaluated(typeArgType)) {
                        assert(typeArgs !== undefined);
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeVarAssignmentMismatch().format({
                                type: printType(typeArgType),
                                name: TypeVarType.getReadableName(typeParams[index]),
                            }) + diag.getString(),
                            typeArgs[index].node
                        );
                    }
                }
            }

            return typeArgType;
        });

        // If the class is partially constructed and doesn't yet have
        // type parameters, assume that the number and types of supplied type
        // arguments are correct.
        if (typeArgs && classType.shared.typeParams.length === 0 && ClassType.isPartiallyEvaluated(classType)) {
            typeArgTypes = typeArgs.map((t) => convertToInstance(t.type));
        }

        let specializedClass = ClassType.specialize(classType, typeArgTypes, typeArgs !== undefined);

        specializedClass = TypeBase.cloneWithTypeForm(
            specializedClass,
            isValidTypeForm ? convertToInstance(specializedClass) : undefined
        );

        return { type: specializedClass };
    }

    function getTypeOfArgExpectingType(arg: Arg, options?: ExpectedTypeOptions): TypeResult {
        if (arg.typeResult) {
            return { type: arg.typeResult.type, isIncomplete: arg.typeResult.isIncomplete };
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        assert(arg.valueExpression !== undefined);
        return getTypeOfExpressionExpectingType(arg.valueExpression, options);
    }

    function getBuiltInType(node: ParseNode, name: string): Type {
        const scope = getScopeForNode(node);
        if (scope) {
            const builtInScope = ScopeUtils.getBuiltInScope(scope);
            const nameType = builtInScope.lookUpSymbol(name);
            if (nameType) {
                return getEffectiveTypeOfSymbol(nameType);
            }
        }

        return UnknownType.create();
    }

    function getBuiltInObject(node: ParseNode, name: string, typeArgs?: Type[]) {
        const nameType = getBuiltInType(node, name);
        if (isInstantiableClass(nameType)) {
            let classType = nameType;
            if (typeArgs) {
                classType = ClassType.specialize(classType, typeArgs);
            }

            return ClassType.cloneAsInstance(classType);
        }

        return nameType;
    }

    function getDeclarationFromKeywordParam(type: FunctionType, paramName: string): Declaration | undefined {
        if (isFunction(type)) {
            if (type.shared.declaration) {
                const functionDecl = type.shared.declaration;
                if (functionDecl.type === DeclarationType.Function) {
                    const functionNode = functionDecl.node;
                    const functionScope = nodeInfo.getScope(functionNode);
                    if (functionScope) {
                        const paramSymbol = functionScope.lookUpSymbol(paramName)!;
                        if (paramSymbol) {
                            return paramSymbol.getDeclarations().find((decl) => decl.type === DeclarationType.Param);
                        }

                        const parameterDetails = getParamListDetails(type);
                        if (parameterDetails.unpackedKwargsTypedDictType) {
                            const lookupResults = lookUpClassMember(
                                parameterDetails.unpackedKwargsTypedDictType,
                                paramName
                            );
                            if (lookupResults) {
                                return lookupResults.symbol
                                    .getDeclarations()
                                    .find((decl) => decl.type === DeclarationType.Variable);
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    function getAliasFromImport(node: NameNode): NameNode | undefined {
        if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFromAs &&
            node.parent.d.alias &&
            node === node.parent.d.name
        ) {
            return node.parent.d.alias;
        }
        return undefined;
    }

    function isUnambiguousInference(symbol: Symbol, decl: Declaration, inferredType: Type): boolean {
        const nonSlotsDecls = symbol.getDeclarations().filter((decl) => {
            return decl.type !== DeclarationType.Variable || !decl.isInferenceAllowedInPyTyped;
        });

        // Any symbol with more than one assignment is considered ambiguous.
        if (nonSlotsDecls.length > 1) {
            return false;
        }

        if (decl.type !== DeclarationType.Variable) {
            return false;
        }

        // If there are no non-slots declarations, don't mark the inferred type as ambiguous.
        if (nonSlotsDecls.length === 0) {
            return true;
        }

        // TypeVar definitions don't require a declaration.
        if (isTypeVar(inferredType)) {
            return true;
        }

        let assignmentNode: AssignmentNode | undefined;

        const parentNode = decl.node.parent;
        if (parentNode) {
            // Is this a simple assignment (x = y) or an assignment of an instance variable (self.x = y)?
            if (parentNode.nodeType === ParseNodeType.Assignment) {
                assignmentNode = parentNode;
            } else if (
                parentNode.nodeType === ParseNodeType.MemberAccess &&
                parentNode.parent?.nodeType === ParseNodeType.Assignment
            ) {
                assignmentNode = parentNode.parent;
            }
        }

        if (!assignmentNode) {
            return false;
        }

        const assignedType = getTypeOfExpression(assignmentNode.d.rightExpr).type;

        // Assume that literal values will always result in the same inferred type.
        if (isClassInstance(assignedType) && isLiteralType(assignedType)) {
            return true;
        }

        // If the assignment is a simple name corresponding to an unambiguous
        // type, we'll assume the resulting variable will receive the same
        // unambiguous type.
        if (assignmentNode.d.rightExpr.nodeType === ParseNodeType.Name && !TypeBase.isAmbiguous(assignedType)) {
            return true;
        }

        return false;
    }

    function inferReturnTypeForCallSite(type: FunctionType, callSiteInfo: CallSiteEvaluationInfo): Type | undefined {
        const args = callSiteInfo.args;
        let contextualReturnType: Type | undefined;

        if (!type.shared.declaration) {
            return undefined;
        }
        const functionNode = type.shared.declaration.node;
        const codeFlowComplexity = nodeInfo.getCodeFlowComplexity(functionNode);

        if (codeFlowComplexity >= maxReturnCallSiteTypeInferenceCodeFlowComplexity) {
            return undefined;
        }

        // If an arg hasn't been matched to a specific named parameter,
        // it's an unpacked value that corresponds to multiple parameters.
        // That's an edge case that we don't handle here.
        if (args.some((arg) => !arg.paramName)) {
            return undefined;
        }

        // Detect recurrence. If a function invokes itself either directly
        // or indirectly, we won't attempt to infer contextual return
        // types any further.
        if (returnTypeInferenceContextStack.some((context) => context.functionNode === functionNode)) {
            return undefined;
        }

        const functionTypeResult = getTypeOfFunction(functionNode);
        if (!functionTypeResult) {
            return undefined;
        }

        // Very complex functions with many arguments can take a long time to analyze,
        // so we'll use a heuristic and avoiding this inference technique for any
        // call site that involves too many arguments.
        if (args.length > maxReturnTypeInferenceArgCount) {
            return undefined;
        }

        // Don't explore arbitrarily deep in the call graph.
        if (returnTypeInferenceContextStack.length >= maxReturnTypeInferenceStackSize) {
            return undefined;
        }

        const paramTypes: Type[] = [];
        let isResultFromCache = false;

        // If the call is located in a loop, don't use literal argument types
        // for the same reason we don't do literal math in loops.
        const stripLiteralArgTypes = ParseTreeUtils.isWithinLoop(callSiteInfo.errorNode);

        // Suppress diagnostics because we don't want to generate errors.
        suppressDiagnostics(functionNode, () => {
            // Argument expressions belong to the caller's contextual cache.
            const argTypes = functionNode.d.params.map((param) => {
                const arg = args.find((arg) => param.d.name?.d.value === arg.paramName);
                return arg?.argument.valueExpression
                    ? getTypeOfExpression(arg.argument.valueExpression).type
                    : undefined;
            });

            // Allocate a new temporary type cache for the context of just
            // this function so we can analyze it separately without polluting
            // the main type cache.
            const prevTypeCache = contextDependencies.returnTypeInferenceTypeCache;
            const prevTypeFormTypeCache = contextDependencies.returnTypeInferenceTypeFormTypeCache;
            returnTypeInferenceContextStack.push({
                functionNode,
                codeFlowAnalyzer: codeFlowEngine.createCodeFlowAnalyzer(),
            });

            try {
                contextDependencies.returnTypeInferenceTypeCache = new Map<number, TypeCacheEntry>();
                contextDependencies.returnTypeInferenceTypeFormTypeCache = new Map<number, TypeFormTypeCacheEntry[]>();

                let allArgTypesAreUnknown = true;
                functionNode.d.params.forEach((param, index) => {
                    if (param.d.name) {
                        let paramType = argTypes[index];

                        if (paramType) {
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
                        } else if (param.d.defaultValue) {
                            paramType = getTypeOfExpression(param.d.defaultValue).type;
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
                        } else if (index === 0) {
                            // If this is an instance or class method, use the implied
                            // parameter type for the "self" or "cls" parameter.
                            if (
                                FunctionType.isInstanceMethod(functionTypeResult.functionType) ||
                                FunctionType.isClassMethod(functionTypeResult.functionType)
                            ) {
                                if (functionTypeResult.functionType.shared.parameters.length > 0) {
                                    if (functionNode.d.params[0].d.name) {
                                        paramType = FunctionType.getParamType(functionTypeResult.functionType, 0);
                                    }
                                }
                            }
                        }

                        if (!paramType) {
                            paramType = UnknownType.create();
                        }

                        if (stripLiteralArgTypes) {
                            paramType = stripTypeForm(
                                convertSpecialFormToRuntimeValue(
                                    stripLiteralValue(paramType),
                                    EvalFlags.None,
                                    /* convertModule */ true
                                )
                            );
                        }

                        paramTypes.push(paramType);
                        writeTypeCache(param.d.name, { type: paramType }, EvalFlags.None);
                    }
                });

                // Don't bother trying to determine the contextual return
                // type if none of the argument types are known.
                if (!allArgTypesAreUnknown) {
                    // See if the return type is already cached. If so, skip the
                    // inference step, which is potentially very expensive.
                    const cacheEntry = functionTypeResult.functionType.priv.callSiteReturnTypeCache?.find((entry) => {
                        return (
                            entry.paramTypes.length === paramTypes.length &&
                            entry.paramTypes.every((t, i) => isTypeSame(t, paramTypes[i]))
                        );
                    });

                    if (cacheEntry) {
                        contextualReturnType = cacheEntry.returnType;
                        isResultFromCache = true;
                    } else {
                        // Speculative results also depend on these temporary parameter bindings,
                        // not just the expected types used during overload resolution.
                        contextualReturnType = speculativeTypeTracker.useSpeculativeTypeCacheIsolation(() =>
                            inferFunctionReturnType(
                                functionNode,
                                FunctionType.isAbstractMethod(type),
                                callSiteInfo?.errorNode
                            )
                        )?.type;
                    }
                }
            } finally {
                returnTypeInferenceContextStack.pop();
                contextDependencies.returnTypeInferenceTypeCache = prevTypeCache;
                contextDependencies.returnTypeInferenceTypeFormTypeCache = prevTypeFormTypeCache;
            }
        });

        if (contextualReturnType) {
            contextualReturnType = removeUnbound(contextualReturnType);

            if (!isResultFromCache) {
                // Cache the resulting type.
                if (!functionTypeResult.functionType.priv.callSiteReturnTypeCache) {
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache = [];
                }
                if (
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache.length >=
                    maxCallSiteReturnTypeCacheSize
                ) {
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache =
                        functionTypeResult.functionType.priv.callSiteReturnTypeCache.slice(1);
                }
                functionTypeResult.functionType.priv.callSiteReturnTypeCache.push({
                    paramTypes,
                    returnType: contextualReturnType,
                });
            }

            return contextualReturnType;
        }

        return undefined;
    }

    function isSpecialFormClass(classType: ClassType, flags: AssignTypeFlags): boolean {
        if ((flags & AssignTypeFlags.AllowIsinstanceSpecialForms) !== 0) {
            return false;
        }

        return ClassType.isSpecialFormClass(classType);
    }

    function isTypeSubsumedByOtherType(type: Type, otherType: Type, allowAnyToSubsume: boolean, recursionCount = 0) {
        const concreteType = makeTopLevelTypeVarsConcrete(type);
        const otherSubtypes = isUnion(otherType) ? otherType.priv.subtypes : [otherType];

        for (const otherSubtype of otherSubtypes) {
            if (isTypeSame(otherSubtype, type)) {
                continue;
            }

            if (isAnyOrUnknown(otherSubtype)) {
                if (allowAnyToSubsume) {
                    return true;
                }
            } else if (isProperSubtype(otherSubtype, concreteType, recursionCount)) {
                return true;
            }
        }

        return false;
    }

    function isProperSubtype(destType: Type, srcType: Type, recursionCount: number) {
        // If the destType has a condition, don't consider the srcType a proper subtype.
        if (destType.props?.condition) {
            return false;
        }

        // Shortcut the check if either type is Any or Unknown.
        if (isAnyOrUnknown(destType) || isAnyOrUnknown(srcType)) {
            return true;
        }

        // Shortcut the check if either type is a class whose hierarchy contains an unknown type.
        if (isClass(destType) && destType.shared.mro.some((mro) => isAnyOrUnknown(mro))) {
            return true;
        }

        if (isClass(srcType) && srcType.shared.mro.some((mro) => isAnyOrUnknown(mro))) {
            return true;
        }

        return (
            assignType(
                destType,
                srcType,
                /* diag */ undefined,
                /* constraints */ undefined,
                AssignTypeFlags.Default,
                recursionCount
            ) &&
            !assignType(
                srcType,
                destType,
                /* diag */ undefined,
                /* constraints */ undefined,
                AssignTypeFlags.Default,
                recursionCount
            )
        );
    }

    function isTypeComparable(leftType: Type, rightType: Type, assumeIsOperator = false) {
        if (isAnyOrUnknown(leftType) || isAnyOrUnknown(rightType)) {
            return true;
        }

        if (isNever(leftType) || isNever(rightType)) {
            return false;
        }

        if (isModule(leftType) || isModule(rightType)) {
            return isTypeSame(leftType, rightType, { ignoreConditions: true });
        }

        const isLeftCallable = isFunctionOrOverloaded(leftType);
        const isRightCallable = isFunctionOrOverloaded(rightType);

        // If either type is a function, assume that it may be comparable. The other
        // operand might be a callable object, an 'object' instance, etc. We could
        // make this more precise for specific cases (e.g. if the other operand is
        // None or a literal or an instance of a nominal class that doesn't override
        // __call__ and is marked final, etc.), but coming up with a comprehensive
        // list is probably not feasible.
        if (isLeftCallable || isRightCallable) {
            return true;
        }

        if (isInstantiableClass(leftType) || (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'type'))) {
            if (
                isInstantiableClass(rightType) ||
                (isClassInstance(rightType) && ClassType.isBuiltIn(rightType, 'type'))
            ) {
                const genericLeftType = ClassType.specialize(leftType, /* typeArgs */ undefined);
                const genericRightType = ClassType.specialize(rightType, /* typeArgs */ undefined);

                if (assignType(genericLeftType, genericRightType) || assignType(genericRightType, genericLeftType)) {
                    return true;
                }
            }

            // Does the class have an operator overload for eq?
            const metaclass = leftType.shared.effectiveMetaclass;
            if (metaclass && isClass(metaclass)) {
                if (lookUpClassMember(metaclass, '__eq__', MemberAccessFlags.SkipObjectBaseClass)) {
                    return true;
                }
            }

            return false;
        }

        if (isClassInstance(leftType)) {
            if (isClass(rightType)) {
                const genericLeftType = ClassType.specialize(leftType, /* typeArgs */ undefined);
                const genericRightType = ClassType.specialize(rightType, /* typeArgs */ undefined);

                if (assignType(genericLeftType, genericRightType) || assignType(genericRightType, genericLeftType)) {
                    return true;
                }

                // Check for the "is None" or "is not None" case.
                if (assumeIsOperator && isNoneInstance(rightType)) {
                    if (isNoneInstance(leftType)) {
                        return true;
                    }

                    // The LHS could be a protocol or 'object', in which case None is
                    // potentially comparable to it. In other cases, None is not comparable
                    // because the types are disjoint.
                    return assignType(leftType, rightType);
                }

                // Assume that if the types are disjoint and built-in classes that they
                // will never be comparable.
                if (ClassType.isBuiltIn(leftType) && ClassType.isBuiltIn(rightType) && TypeBase.isInstance(rightType)) {
                    // We need to be careful with bool and int literals because
                    // they are comparable under certain circumstances.
                    let boolType: ClassType | undefined;
                    let intType: ClassType | undefined;
                    if (ClassType.isBuiltIn(leftType, 'bool') && ClassType.isBuiltIn(rightType, 'int')) {
                        boolType = leftType;
                        intType = rightType;
                    } else if (ClassType.isBuiltIn(rightType, 'bool') && ClassType.isBuiltIn(leftType, 'int')) {
                        boolType = rightType;
                        intType = leftType;
                    }

                    if (boolType && intType) {
                        const intVal = intType.priv?.literalValue as number | BigInt | undefined;
                        if (intVal === undefined) {
                            return true;
                        }
                        if (intVal !== 0 && intVal !== 1) {
                            return false;
                        }

                        const boolVal = boolType.priv?.literalValue as boolean | undefined;
                        if (boolVal === undefined) {
                            return true;
                        }

                        return boolVal === (intVal === 1);
                    }

                    // Distinct bytes-like classes support cross-type equality regardless
                    // of disableBytesTypePromotions. Don't apply this to the same class:
                    // different bytes literals must remain disjoint.
                    if (
                        !assumeIsOperator &&
                        !ClassType.isSameGenericClass(leftType, rightType) &&
                        isTypePromotionRelated(leftType, rightType)
                    ) {
                        return true;
                    }

                    return false;
                }
            }

            // Does the class have an operator overload for eq?
            const eqMethod = lookUpClassMember(
                ClassType.cloneAsInstantiable(leftType),
                '__eq__',
                MemberAccessFlags.SkipObjectBaseClass
            );

            if (eqMethod) {
                // If this is a synthesized method for a dataclass, we can assume
                // that other dataclass types will not be comparable.
                if (ClassType.isDataClass(leftType) && eqMethod.symbol.getSynthesizedType()) {
                    return false;
                }

                return true;
            }

            return false;
        }

        return true;
    }

    function applyTypeArgToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagnosticAddendum): Type | undefined {
        if (isAnyOrUnknown(srcType)) {
            return srcType;
        }

        let effectiveSrcType: Type = transformPossibleRecursiveTypeAlias(srcType);

        if (isTypeVar(srcType)) {
            if (isTypeSame(srcType, destType)) {
                return srcType;
            }

            effectiveSrcType = makeTopLevelTypeVarsConcrete(srcType);
        }

        // If this is a partially-evaluated class, don't perform any further
        // checks. Assume in this case that the type is compatible with the
        // bound or constraint.
        if (isClass(effectiveSrcType) && ClassType.isPartiallyEvaluated(effectiveSrcType)) {
            return srcType;
        }

        // If there's a bound type, make sure the source is derived from it.
        if (destType.shared.boundType && !isTypeAliasPlaceholder(effectiveSrcType)) {
            if (
                !assignType(
                    destType.shared.boundType,
                    effectiveSrcType,
                    diag.createAddendum(),
                    /* constraints */ undefined
                )
            ) {
                // Avoid adding a message that will confuse users if the TypeVar was
                // synthesized for internal purposes.
                if (!destType.shared.isSynthesized) {
                    diag.addMessage(
                        LocAddendum.typeBound().format({
                            sourceType: printType(effectiveSrcType),
                            destType: printType(destType.shared.boundType),
                            name: TypeVarType.getReadableName(destType),
                        })
                    );
                }
                return undefined;
            }
        }

        if (isParamSpec(destType)) {
            if (isParamSpec(srcType)) {
                return srcType;
            }

            if (isFunction(srcType) && FunctionType.isParamSpecValue(srcType)) {
                return srcType;
            }

            if (isClassInstance(srcType) && ClassType.isBuiltIn(srcType, 'Concatenate')) {
                return srcType;
            }

            diag.addMessage(
                LocAddendum.typeParamSpec().format({
                    type: printType(srcType),
                    name: TypeVarType.getReadableName(destType),
                })
            );

            return undefined;
        }

        if (isParamSpec(srcType)) {
            diag.addMessage(LocMessage.paramSpecContext());
            return undefined;
        }

        // If there are no constraints, we're done.
        const constraints = destType.shared.constraints;
        if (constraints.length === 0) {
            return srcType;
        }

        if (isTypeAliasPlaceholder(srcType)) {
            return srcType;
        }

        if (isTypeVar(srcType) && TypeVarType.hasConstraints(srcType)) {
            // Make sure all the source constraint types map to constraint types in the dest.
            if (
                srcType.shared.constraints.every((sourceConstraint) => {
                    return constraints.some((destConstraint) => assignType(destConstraint, sourceConstraint));
                })
            ) {
                return srcType;
            }
        } else {
            let bestConstraintSoFar: Type | undefined;

            // Try to find the best (narrowest) match among the constraints.
            for (const constraint of constraints) {
                if (assignType(constraint, effectiveSrcType)) {
                    // Don't allow Never to match unless the constraint is also explicitly Never.
                    if (!isNever(effectiveSrcType) || isNever(constraint)) {
                        if (!bestConstraintSoFar || assignType(bestConstraintSoFar, constraint)) {
                            bestConstraintSoFar = constraint;
                        }
                    }
                }
            }

            if (bestConstraintSoFar) {
                return bestConstraintSoFar;
            }
        }

        diag.addMessage(
            LocAddendum.typeConstrainedTypeVar().format({
                type: printType(srcType),
                name: TypeVarType.getReadableName(destType),
            })
        );

        return undefined;
    }

    function isFinalVariable(symbol: Symbol): boolean {
        return symbol.getDeclarations().some((decl) => isFinalVariableDeclaration(decl));
    }

    function isFinalVariableDeclaration(decl: Declaration): boolean {
        return decl.type === DeclarationType.Variable && !!decl.isFinal;
    }

    function isLegalTypeAliasExpressionForm(node: ExpressionNode, allowStrLiteral: boolean): boolean {
        switch (node.nodeType) {
            case ParseNodeType.Error:
            case ParseNodeType.UnaryOperation:
            case ParseNodeType.AssignmentExpression:
            case ParseNodeType.TypeAnnotation:
            case ParseNodeType.Await:
            case ParseNodeType.Ternary:
            case ParseNodeType.Unpack:
            case ParseNodeType.Tuple:
            case ParseNodeType.Call:
            case ParseNodeType.Comprehension:
            case ParseNodeType.Slice:
            case ParseNodeType.Yield:
            case ParseNodeType.YieldFrom:
            case ParseNodeType.Lambda:
            case ParseNodeType.Number:
            case ParseNodeType.Dictionary:
            case ParseNodeType.List:
            case ParseNodeType.Set:
                return false;

            case ParseNodeType.StringList:
            case ParseNodeType.String:
                return allowStrLiteral;

            case ParseNodeType.Constant:
                return node.d.constType === KeywordType.None;

            case ParseNodeType.BinaryOperation:
                return (
                    node.d.operator === OperatorType.BitwiseOr &&
                    isLegalTypeAliasExpressionForm(node.d.leftExpr, /* allowStrLiteral */ true) &&
                    isLegalTypeAliasExpressionForm(node.d.rightExpr, /* allowStrLiteral */ true)
                );

            case ParseNodeType.Index:
                return isLegalTypeAliasExpressionForm(node.d.leftExpr, allowStrLiteral);

            case ParseNodeType.MemberAccess:
                return isLegalTypeAliasExpressionForm(node.d.leftExpr, allowStrLiteral);
        }

        return true;
    }

    function isPossibleTypeDictFactoryCall(decl: Declaration) {
        if (
            decl.type !== DeclarationType.Variable ||
            !decl.node.parent ||
            decl.node.parent.nodeType !== ParseNodeType.Assignment ||
            decl.node.parent.d.rightExpr?.nodeType !== ParseNodeType.Call
        ) {
            return false;
        }

        const callLeftNode = decl.node.parent.d.rightExpr.d.leftExpr;

        // Use a simple heuristic to determine whether this is potentially
        // a call to the TypedDict call. This avoids the expensive (and potentially
        // recursive) call to getTypeOfExpression in cases where it's not needed.
        if (
            (callLeftNode.nodeType === ParseNodeType.Name && callLeftNode.d.value) === 'TypedDict' ||
            (callLeftNode.nodeType === ParseNodeType.MemberAccess &&
                callLeftNode.d.member.d.value === 'TypedDict' &&
                callLeftNode.d.leftExpr.nodeType === ParseNodeType.Name)
        ) {
            // See if this is a call to TypedDict. We want to support
            // recursive type references in a TypedDict call.
            const callType = getTypeOfExpression(callLeftNode, EvalFlags.CallBaseDefaults).type;

            if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'TypedDict')) {
                return true;
            }
        }

        return false;
    }

    function printSrcDestTypes(
        srcType: Type,
        destType: Type,
        options?: PrintTypeOptions
    ): { sourceType: string; destType: string } {
        const simpleSrcType = printType(srcType, options);
        const simpleDestType = printType(destType, options);

        if (simpleSrcType !== simpleDestType) {
            return { sourceType: simpleSrcType, destType: simpleDestType };
        }

        const fullSrcType = printType(srcType, { ...(options ?? {}), useFullyQualifiedNames: true });
        const fullDestType = printType(destType, { ...(options ?? {}), useFullyQualifiedNames: true });

        if (fullSrcType !== fullDestType) {
            return { sourceType: fullSrcType, destType: fullDestType };
        }

        return { sourceType: simpleSrcType, destType: simpleDestType };
    }

    function parseStringAsTypeAnnotation(node: StringListNode, reportErrors: boolean): ExpressionNode | undefined {
        const fileInfo = nodeInfo.getFileInfo(node);
        const parser = new Parser();
        const textValue = node.d.strings[0].d.value;

        // Determine the offset within the file where the string
        // literal's contents begin.
        let valueOffset = node.d.strings[0].start;
        if (node.d.strings[0].nodeType === ParseNodeType.String) {
            valueOffset += node.d.strings[0].d.token.prefixLength + node.d.strings[0].d.token.quoteMarkLength;
        }

        // Construct a temporary dummy string with the text value at the appropriate
        // offset so as to mimic the original file. This will keep all of the token
        // and diagnostic offsets correct.
        const dummyFileContents = ' '.repeat(valueOffset) + textValue;

        const parseOptions = new ParseOptions();
        parseOptions.isStubFile = fileInfo.isStubFile;
        parseOptions.pythonVersion = fileInfo.executionEnvironment.pythonVersion;
        parseOptions.reportErrorsForParsedStringContents = true;

        const parseResults = parser.parseTextExpression(
            dummyFileContents,
            valueOffset,
            textValue.length,
            parseOptions,
            ParseTextMode.Expression,
            /* initialParenDepth */ undefined,
            fileInfo.typingSymbolAliases,
            node.a
        );

        if (parseResults.parseTree) {
            // If there are errors but we are not reporting them, return
            // undefined to indicate that the parse failed.
            if (!reportErrors && parseResults.diagnostics.length > 0) {
                return undefined;
            }

            const fileInfo = nodeInfo.getFileInfo(node);
            parseResults.diagnostics.forEach((diag) => {
                fileInfo.diagnosticSink.addDiagnosticWithTextRange('error', diag.message, node);
            });

            parseResults.parseTree.parent = node;

            // Optionally add the new subtree to the parse tree so it can
            // participate in language server operations like find and replace.
            if (reportErrors) {
                nodeInfo.setStringAnnotation(node, parseResults.parseTree, parseResults.stringAnnotations);
            }

            return parseResults.parseTree;
        }

        return undefined;
    }

    function getLineNum(node: ParseNode) {
        const fileInfo = nodeInfo.getFileInfo(node);
        const range = convertOffsetsToRange(node.start, node.start + node.length, fileInfo.lines);
        return (range.start.line + 1).toString();
    }

    return {
        isNodeInReturnTypeInferenceContext,
        getCodeFlowAnalyzerForReturnTypeInferenceContext,
        getIndexOfSymbolResolution,
        validateTypeIsInstantiable,
        solveAndApplyConstraints,
        getBoundMagicMethod,
        getTypeOfAwaitable,
        isTypeHashable,
        getTypedDictClassType,
        getTupleClassType,
        getDictClassType,
        getStrClassType,
        getObjectType,
        getNoneType,
        getUnionClassType,
        getTypeClassType,
        applyConditionFilterToType,
        verifyRaiseExceptionType,
        isSymbolValidTypeExpression,
        convertSpecialFormToRuntimeValue,
        reportMissingTypeArgs,
        isClassWithAsymmetricAttributeAccessor,
        specializeTypeAliasWithDefaults,
        buildTupleTypesList,
        convertNodeToArg,
        getSpeculativeNodeForCall,
        expandArgType,
        getAbstractSymbolInfo,
        validateCallForClassInstance,
        adjustCallableReturnType,
        verifyTypeVarDefaultIsCompatible,
        getTypeVarTupleDefaultType,
        getFunctionFullName,
        createNewType,
        createClassFromMetaclass,
        verifySetEntryOrDictKeyIsHashable,
        inferTypeArgFromExpectedEntryType,
        reportPossibleUnknownAssignment,
        evaluateComprehensionForIf,
        cloneBuiltinObjectWithLiteral,
        cloneBuiltinClassWithLiteral,
        createSelfType,
        createSubclass,
        buildTypeParamsFromTypeArgs,
        computeEffectiveMetaclass,
        adjustParamAnnotatedType,
        inferParamTypeFromDefaultValue,
        transformVariadicParamType,
        methodAlwaysRaisesNotImplemented,
        createSpecializedClassType,
        getTypeOfArgExpectingType,
        getBuiltInType,
        getBuiltInObject,
        getDeclarationFromKeywordParam,
        getAliasFromImport,
        isUnambiguousInference,
        inferReturnTypeForCallSite,
        isSpecialFormClass,
        isTypeSubsumedByOtherType,
        isProperSubtype,
        isTypeComparable,
        applyTypeArgToTypeVar,
        isFinalVariable,
        isFinalVariableDeclaration,
        isLegalTypeAliasExpressionForm,
        isPossibleTypeDictFactoryCall,
        printSrcDestTypes,
        parseStringAsTypeAnnotation,
        getLineNum,
    };
}
