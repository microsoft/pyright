/*
 * expressionEvaluation.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * expressionEvaluation implementation, using evaluator-owned dependencies and state.
 */

import { appendArray } from '../../common/collectionUtils';
import { assert } from '../../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { TextRange } from '../../common/textRange';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ArgCategory,
    ArgumentNode,
    CallNode,
    ClassNode,
    ConstantNode,
    ExpressionNode,
    FormatStringNode,
    FunctionNode,
    IndexNode,
    NameNode,
    ParamCategory,
    ParseNode,
    ParseNodeType,
    SliceNode,
    StringListNode,
    StringNode,
    UnpackNode,
    YieldFromNode,
    YieldNode,
} from '../../parser/parseNodes';
import { ParseOptions, Parser, ParseTextMode } from '../../parser/parser';
import { KeywordType, OperatorType, StringTokenFlags } from '../../parser/tokenizerTypes';
import { isAnnotationEvaluationPostponed } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { ConstraintTracker } from '../constraintTracker';
import { getFunctionInfoFromDecorators } from '../decorators';
import * as ParseTreeUtils from '../parseTreeUtils';
import { Scope, ScopeType, SymbolWithScope } from '../scope';
import { Symbol } from '../symbol';
import { getSlicedTupleType, makeTupleObject } from '../tuples';
import { SpeculativeModeOptions } from '../typeCacheUtils';
import { createTypedDictTypeInlined, getTypeOfIndexedTypedDict } from '../typedDicts';
import {
    Arg,
    ArgWithExpression,
    CallResult,
    ClassTypeResult,
    DeclaredSymbolTypeInfo,
    EffectiveTypeResult,
    EvalFlags,
    EvaluatorUsage,
    ExpectedTypeOptions,
    FunctionTypeResult,
    MagicMethodDeprecationInfo,
    MapSubtypesOptions,
    PrefetchedTypes,
    PrintTypeOptions,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
} from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    findSubtype,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    getInferredTupleLiteralBase,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isOverloaded,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    isUnpackedTypeVarTuple,
    LiteralValue,
    ModuleType,
    NeverType,
    OverloadedType,
    OverloadResultType,
    removeUnbound,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCondition,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
} from '../types';
import {
    addConditionToType,
    ClassMember,
    convertToInstance,
    derivesFromAnyOrUnknown,
    derivesFromClassRecursive,
    doForEachSubtype,
    getGeneratorTypeArgs,
    getGeneratorYieldType,
    getSpecializedTupleType,
    getTypeCondition,
    InferenceContext,
    isLiteralType,
    isMetaclassInstance,
    isNoneInstance,
    isNoneTypeClass,
    isOptionalType,
    isTupleClass,
    isTupleIndexUnambiguous,
    lookUpClassMember,
    lookUpObjectMember,
    makeInferenceContext,
    makeTypeVarsBound,
    mapSubtypes,
    MemberAccessFlags,
    partiallySpecializeType,
    removeNoneFromUnion,
    requiresSpecialization,
    selfSpecializeClass,
    specializeForBaseClass,
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
    readonly addInformation: (message: string, node: ParseNode, range?: TextRange) => Diagnostic | undefined;
    readonly cloneBuiltinClassWithLiteral: (
        node: ParseNode,
        literalClassType: ClassType,
        builtInName: string,
        value: LiteralValue
    ) => Type;
    readonly cloneBuiltinObjectWithLiteral: (node: ParseNode, builtInName: string, value: LiteralValue) => Type;
    readonly collectLiteralEnumClasses: (
        type: Type,
        literalEnumClasses?: ClassType[],
        recursively?: boolean,
        recursionCount?: number
    ) => ClassType[];
    readonly convertNodeToArg: (node: ArgumentNode) => ArgWithExpression;
    readonly evaluatorInterface: TypeEvaluator;
    readonly expectedTypeWantsTypeForm: (expectedType: Type) => boolean;
    readonly getBoundMagicMethod: (
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        diag?: DiagnosticAddendum,
        recursionCount?: number
    ) => FunctionType | OverloadedType | undefined;
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
    readonly getDeclaredTypeOfSymbol: (symbol: Symbol, usageNode?: NameNode) => DeclaredSymbolTypeInfo;
    readonly getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    readonly getEffectiveTypeOfSymbolForUsage: (
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl?: boolean
    ) => EffectiveTypeResult;
    readonly getIndexAccessMagicMethodName: (usage: EvaluatorUsage) => string;
    readonly getNoneType: () => Type;
    readonly getObjectType: () => Type;
    readonly getScopeForNode: (node: ParseNode) => Scope | undefined;
    readonly getTypeClassType: () => ClassType | undefined;
    readonly getTypeOfArgExpectingType: (arg: Arg, options?: ExpectedTypeOptions) => TypeResult;
    readonly getTypeOfAwaitable: (typeResult: TypeResult, errorNode?: ExpressionNode) => TypeResult;
    readonly getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    readonly getTypeOfExpression: (
        node: ExpressionNode,
        flags?: EvalFlags,
        inferenceContext?: InferenceContext
    ) => TypeResult;
    readonly getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    readonly getTypeVarScopesForNode: (node: ParseNode) => string[];
    readonly getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    readonly inferReturnTypeIfNecessary: (type: Type) => void;
    readonly isSpeculativeModeInUse: (node: ParseNode | undefined) => boolean;
    readonly lookUpSymbolRecursive: (
        node: ParseNode,
        name: string,
        honorCodeFlow: boolean,
        preferGlobalScope?: boolean
    ) => SymbolWithScope | undefined;
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
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly normalizeEnumTypes: (
        typeToNormalize: Type,
        literalEnumClasses: ClassType[],
        recursionCount?: number
    ) => Type;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly printSrcDestTypes: (
        srcType: Type,
        destType: Type,
        options?: PrintTypeOptions
    ) => { sourceType: string; destType: string };
    readonly printType: (type: Type, options?: PrintTypeOptions) => string;
    readonly resolveDeclaredMemberType: (
        symbol: Symbol,
        classOrObjectBase: ClassType | undefined,
        memberAccessClass: Type | undefined,
        useDescriptorSetterType: boolean,
        bindFunction: boolean,
        selfType: ClassType | TypeVarType | undefined
    ) => Type | undefined;
    readonly setTypeResultForNode: (node: ParseNode, typeResult: TypeResult, flags?: EvalFlags) => void;
    readonly stripTypeGuard: (type: Type) => Type;
    readonly useSpeculativeMode: <T>(
        speculativeNode: ParseNode | undefined,
        callback: () => T,
        options?: SpeculativeModeOptions
    ) => T;
    readonly validateCallArgs: (
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount?: number
    ) => CallResult;
    readonly validateSymbolIsTypeExpression: (node: ExpressionNode, type: Type, includesVarDecl: boolean) => Type;
}

export function createExpressionEvaluation(context: Context) {
    const {
        addDiagnostic,
        addInformation,
        cloneBuiltinClassWithLiteral,
        cloneBuiltinObjectWithLiteral,
        collectLiteralEnumClasses,
        convertNodeToArg,
        evaluatorInterface,
        expectedTypeWantsTypeForm,
        getBoundMagicMethod,
        getBuiltInObject,
        getBuiltInType,
        getDeclaredTypeOfSymbol,
        getEffectiveTypeOfSymbol,
        getEffectiveTypeOfSymbolForUsage,
        getIndexAccessMagicMethodName,
        getNoneType,
        getObjectType,
        getScopeForNode,
        getTypeClassType,
        getTypeOfArgExpectingType,
        getTypeOfAwaitable,
        getTypeOfClass,
        getTypeOfExpression,
        getTypeOfFunction,
        getTypeVarScopesForNode,
        getTypingType,
        inferReturnTypeIfNecessary,
        isSpeculativeModeInUse,
        lookUpSymbolRecursive,
        makeTopLevelTypeVarsConcrete,
        mapSubtypesExpandTypeVars,
        nodeInfo,
        normalizeEnumTypes,
        printSrcDestTypes,
        printType,
        resolveDeclaredMemberType,
        setTypeResultForNode,
        stripTypeGuard,
        useSpeculativeMode,
        validateCallArgs,
        validateSymbolIsTypeExpression,
    } = context;

    function getTypeOfEllipsis(flags: EvalFlags, typeResult: TypeResult | undefined, node: ExpressionNode) {
        if ((flags & EvalFlags.ConvertEllipsisToAny) !== 0) {
            typeResult = { type: AnyType.create(/* isEllipsis */ true) };
        } else {
            if ((flags & EvalFlags.TypeExpression) !== 0 && (flags & EvalFlags.AllowEllipsis) === 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.ellipsisContext(), node);
                typeResult = { type: UnknownType.create() };
            } else {
                const ellipsisType =
                    getBuiltInObject(node, 'EllipsisType') ?? getBuiltInObject(node, 'ellipsis') ?? AnyType.create();
                typeResult = { type: ellipsisType };
            }
        }
        return typeResult;
    }

    function getTypeOfUnpackOperator(node: UnpackNode, flags: EvalFlags, inferenceContext?: InferenceContext) {
        let typeResult: TypeResult | undefined;
        let iterExpectedType: Type | undefined;

        if (inferenceContext) {
            const iterableType = getBuiltInType(node, 'Iterable');
            if (iterableType && isInstantiableClass(iterableType)) {
                iterExpectedType = ClassType.cloneAsInstance(
                    ClassType.specialize(iterableType, [inferenceContext.expectedType])
                );
            }
        }

        const iterTypeResult = getTypeOfExpression(node.d.expr, flags, makeInferenceContext(iterExpectedType));
        const iterType = iterTypeResult.type;
        if ((flags & EvalFlags.NoTypeVarTuple) === 0 && isTypeVarTuple(iterType) && !iterType.priv.isUnpacked) {
            typeResult = { type: TypeVarType.cloneForUnpacked(iterType) };
        } else if (
            (flags & EvalFlags.AllowUnpackedTuple) !== 0 &&
            isInstantiableClass(iterType) &&
            ClassType.isBuiltIn(iterType, 'tuple')
        ) {
            typeResult = { type: ClassType.cloneForUnpacked(iterType) };
        } else if ((flags & EvalFlags.TypeExpression) !== 0) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.unpackInAnnotation(),
                node,
                node.d.starToken
            );
            typeResult = { type: UnknownType.create() };
        } else {
            const iteratorTypeResult = getTypeOfIterator(iterTypeResult, /* isAsync */ false, node) ?? {
                type: UnknownType.create(!!iterTypeResult.isIncomplete),
                isIncomplete: iterTypeResult.isIncomplete,
            };
            typeResult = {
                type: iteratorTypeResult.type,
                typeErrors: iterTypeResult.typeErrors,
                unpackedType: iterType,
                isIncomplete: iteratorTypeResult.isIncomplete,
            };
        }

        return typeResult;
    }

    function getTypeOfStringListAsType(node: StringListNode, flags: EvalFlags): TypeResult {
        const reportTypeErrors = (flags & EvalFlags.StrLiteralAsType) !== 0;
        let updatedFlags = flags | EvalFlags.ForwardRefs | EvalFlags.InstantiableType;
        let typeResult: TypeResult | undefined;

        // In most cases, annotations within a string are not parsed by the interpreter.
        // There are a few exceptions (e.g. the "bound" value for a TypeVar constructor).
        if ((flags & EvalFlags.ParsesStringLiteral) === 0) {
            updatedFlags |= EvalFlags.NotParsed;
        }

        const annotation = nodeInfo.getStringAnnotation(node);
        if (annotation && (flags & EvalFlags.TypeExpression) !== 0) {
            return getTypeOfExpression(annotation, updatedFlags);
        }

        if (node.d.strings.length === 1) {
            const tokenFlags = node.d.strings[0].d.token.flags;

            if (tokenFlags & StringTokenFlags.Bytes) {
                if (reportTypeErrors) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.annotationBytesString(), node);
                }
                return { type: UnknownType.create() };
            }

            if (tokenFlags & StringTokenFlags.Raw) {
                if (reportTypeErrors) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.annotationRawString(), node);
                }
                return { type: UnknownType.create() };
            }

            if (tokenFlags & StringTokenFlags.Format) {
                if (reportTypeErrors) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.annotationFormatString(), node);
                }
                return { type: UnknownType.create() };
            }

            if (tokenFlags & StringTokenFlags.Template) {
                if (reportTypeErrors) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.annotationTemplateString(), node);
                }
                return { type: UnknownType.create() };
            }

            // We didn't know at parse time that this string node was going
            // to be evaluated as a forward-referenced type. We need
            // to re-invoke the parser at this stage.
            const expr = parseStringAsTypeAnnotation(node, reportTypeErrors);
            if (expr) {
                typeResult = useSpeculativeMode(reportTypeErrors ? undefined : node, () => {
                    return getTypeOfExpression(expr, updatedFlags);
                });
            }
        }

        if (!typeResult) {
            if (reportTypeErrors) {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.expectedTypeNotString(), node);
            }
            typeResult = { type: UnknownType.create() };
        }

        return typeResult;
    }

    function getTypeOfString(node: StringNode | FormatStringNode): TypeResult {
        const isBytes = (node.d.token.flags & StringTokenFlags.Bytes) !== 0;
        let typeResult: TypeResult | undefined;
        let isIncomplete = false;

        if (node.nodeType === ParseNodeType.String) {
            typeResult = {
                type: cloneBuiltinObjectWithLiteral(node, isBytes ? 'bytes' : 'str', node.d.value),
                isIncomplete,
            };
        } else {
            const isTemplateString = (node.d.token.flags & StringTokenFlags.Template) !== 0;
            let isLiteralString = true;

            // If all of the format expressions are of type LiteralString, then
            // the resulting formatted string is also LiteralString.
            node.d.fieldExprs.forEach((expr) => {
                const exprTypeResult = getTypeOfExpression(expr);
                const exprType = exprTypeResult.type;

                if (exprTypeResult.isIncomplete) {
                    isIncomplete = true;
                }

                doForEachSubtype(exprType, (exprSubtype) => {
                    if (!isClassInstance(exprSubtype)) {
                        isLiteralString = false;
                        return;
                    }

                    if (ClassType.isBuiltIn(exprSubtype, 'LiteralString')) {
                        return;
                    }

                    if (ClassType.isBuiltIn(exprSubtype, 'str') && exprSubtype.priv.literalValue !== undefined) {
                        return;
                    }

                    isLiteralString = false;
                });
            });

            if (isTemplateString) {
                const templateType =
                    context.prefetched?.templateClass && isInstantiableClass(context.prefetched?.templateClass)
                        ? ClassType.cloneAsInstance(context.prefetched.templateClass)
                        : UnknownType.create();

                typeResult = { type: templateType, isIncomplete };
            } else if (!isBytes && isLiteralString) {
                const literalStringType = getTypingType(node, 'LiteralString');
                if (literalStringType && isInstantiableClass(literalStringType)) {
                    typeResult = { type: ClassType.cloneAsInstance(literalStringType), isIncomplete };
                }
            }

            if (!typeResult) {
                typeResult = {
                    type: getBuiltInObject(node, isBytes ? 'bytes' : 'str'),
                    isIncomplete,
                };

                if (isClass(typeResult.type) && typeResult.type.priv.includePromotions) {
                    typeResult.type = ClassType.cloneRemoveTypePromotions(typeResult.type);
                }
            }
        }

        return typeResult;
    }

    function getDeclaredTypeForExpression(expression: ExpressionNode, usage?: EvaluatorUsage): Type | undefined {
        let symbol: Symbol | undefined;
        let selfType: ClassType | TypeVarType | undefined;
        let classOrObjectBase: ClassType | undefined;
        let memberAccessClass: Type | undefined;
        let bindFunction = true;
        let useDescriptorSetterType = false;

        switch (expression.nodeType) {
            case ParseNodeType.Name: {
                const symbolWithScope = lookUpSymbolRecursive(expression, expression.d.value, /* honorCodeFlow */ true);
                if (symbolWithScope) {
                    symbol = symbolWithScope.symbol;

                    // Handle the case where the symbol is a class-level variable
                    // where the type isn't declared in this class but is in
                    // a parent class.
                    if (
                        !getDeclaredTypeOfSymbol(symbol, expression)?.type &&
                        symbolWithScope.scope.type === ScopeType.Class
                    ) {
                        const enclosingClass = ParseTreeUtils.getEnclosingClassOrFunction(expression);
                        if (enclosingClass && enclosingClass.nodeType === ParseNodeType.Class) {
                            const classTypeInfo = getTypeOfClass(enclosingClass);
                            if (classTypeInfo) {
                                const classMemberInfo = lookUpClassMember(
                                    classTypeInfo.classType,
                                    expression.d.value,
                                    MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.DeclaredTypesOnly
                                );
                                if (classMemberInfo) {
                                    symbol = classMemberInfo.symbol;
                                }
                            }
                        }
                    }
                }
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                return getDeclaredTypeForExpression(expression.d.valueExpr, usage);
            }

            case ParseNodeType.MemberAccess: {
                const baseType = getTypeOfExpression(expression.d.leftExpr, EvalFlags.MemberAccessBaseDefaults).type;
                const baseTypeConcrete = makeTopLevelTypeVarsConcrete(baseType);
                const memberName = expression.d.member.d.value;

                if (isTypeVar(baseType)) {
                    selfType = baseType;
                }

                // Normally, baseType will not be a composite type (a union), but
                // this can occur. In this case, we compute the declared type of the
                // member for each subtype. If the subtypes declare the member with
                // the same generic class but different (invariant) type arguments
                // (e.g. "list[int]" vs. "list[str]"), there is no single declared
                // type that can serve as the expected type for bidirectional
                // inference of an assigned value. Committing to one subtype's
                // declared type produces a false positive when assigning a value
                // (such as an empty container) that is compatible with every
                // subtype, so in that case we return undefined and let the value be
                // evaluated without an expected type. We sort the subtypes for
                // determinism.
                //
                // This is deliberately limited to the "same class, differing type
                // arguments" case. When the subtypes declare the member with
                // unrelated types, we retain the previous behavior (use one
                // subtype's declared type) so that genuine assignment errors are
                // still reported at the same location and downstream inference is
                // unchanged.
                //
                // This handling is further limited to cases where the declared base
                // type is itself a union. We intentionally don't apply it when the
                // base is a type variable that merely concretizes to a union.
                const isUnionBase = isUnion(baseType);
                let firstMemberDeclaredType: Type | undefined;
                let sawMemberDeclaredType = false;
                let hasDivergentMemberDeclaredTypes = false;
                let divergesOnlyByTypeArgs = true;

                doForEachSubtype(
                    baseTypeConcrete,
                    (baseSubtype) => {
                        if (isClassInstance(baseSubtype)) {
                            const classMemberInfo = lookUpObjectMember(
                                baseSubtype,
                                memberName,
                                MemberAccessFlags.DeclaredTypesOnly
                            );

                            classOrObjectBase = baseSubtype;
                            memberAccessClass = classMemberInfo?.classType;
                            symbol = classMemberInfo?.symbol;
                            useDescriptorSetterType = true;

                            // If this is an instance member (e.g. a dataclass field), don't
                            // bind it to the object if it's a function.
                            bindFunction = !classMemberInfo?.isInstanceMember;
                        } else if (isInstantiableClass(baseSubtype)) {
                            const classMemberInfo = lookUpClassMember(
                                baseSubtype,
                                memberName,
                                MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.DeclaredTypesOnly
                            );

                            classOrObjectBase = baseSubtype;
                            memberAccessClass = classMemberInfo?.classType;
                            symbol = classMemberInfo?.symbol;
                            useDescriptorSetterType = false;
                            bindFunction = true;
                        } else if (isModule(baseSubtype)) {
                            classOrObjectBase = undefined;
                            memberAccessClass = undefined;
                            symbol = ModuleType.getField(baseSubtype, memberName);
                            if (symbol && !symbol.hasTypedDeclarations()) {
                                // Do not use inferred types for the declared type.
                                symbol = undefined;
                            }
                            useDescriptorSetterType = false;
                            bindFunction = false;
                        }

                        // If the base is a union, verify that the subtypes agree on a
                        // single declared type for the member.
                        if (isUnionBase) {
                            const subtypeDeclaredType = symbol
                                ? resolveDeclaredMemberType(
                                      symbol,
                                      classOrObjectBase,
                                      memberAccessClass,
                                      useDescriptorSetterType,
                                      bindFunction,
                                      selfType
                                  )
                                : undefined;

                            if (subtypeDeclaredType) {
                                if (!sawMemberDeclaredType) {
                                    firstMemberDeclaredType = subtypeDeclaredType;
                                    sawMemberDeclaredType = true;
                                } else if (
                                    !firstMemberDeclaredType ||
                                    !isTypeSame(firstMemberDeclaredType, subtypeDeclaredType)
                                ) {
                                    hasDivergentMemberDeclaredTypes = true;

                                    // The false positive we're addressing is specific
                                    // to invariant type arguments of the same generic
                                    // class. If the divergent types aren't instances of
                                    // the same generic class, don't treat this as an
                                    // ambiguous declared type.
                                    if (
                                        !firstMemberDeclaredType ||
                                        !isClassInstance(firstMemberDeclaredType) ||
                                        !isClassInstance(subtypeDeclaredType) ||
                                        !ClassType.isSameGenericClass(
                                            ClassType.cloneAsInstantiable(firstMemberDeclaredType),
                                            ClassType.cloneAsInstantiable(subtypeDeclaredType)
                                        )
                                    ) {
                                        divergesOnlyByTypeArgs = false;
                                    }
                                }
                            }
                        }
                    },
                    /* sortSubtypes */ true
                );

                if (hasDivergentMemberDeclaredTypes && divergesOnlyByTypeArgs) {
                    return undefined;
                }

                break;
            }

            case ParseNodeType.Index: {
                const baseType = makeTopLevelTypeVarsConcrete(
                    getTypeOfExpression(expression.d.leftExpr, EvalFlags.IndexBaseDefaults).type
                );

                if (baseType && isClassInstance(baseType)) {
                    if (ClassType.isTypedDictClass(baseType)) {
                        const typeFromTypedDict = getTypeOfIndexedTypedDict(
                            evaluatorInterface,
                            expression,
                            baseType,
                            usage || { method: 'get' }
                        );
                        if (typeFromTypedDict) {
                            return typeFromTypedDict.type;
                        }
                    }

                    let setItemType = getBoundMagicMethod(baseType, '__setitem__');
                    if (!setItemType) {
                        break;
                    }

                    if (isOverloaded(setItemType)) {
                        // Determine whether we need to use the slice overload.
                        const expectsSlice =
                            expression.d.items.length === 1 &&
                            expression.d.items[0].d.valueExpr.nodeType === ParseNodeType.Slice;
                        const overloads = OverloadedType.getOverloads(setItemType);
                        setItemType = overloads.find((overload) => {
                            if (overload.shared.parameters.length < 2) {
                                return false;
                            }

                            const keyType = FunctionType.getParamType(overload, 0);
                            const isSlice = isClassInstance(keyType) && ClassType.isBuiltIn(keyType, 'slice');
                            return expectsSlice === isSlice;
                        });

                        if (!setItemType) {
                            break;
                        }
                    }

                    if (isFunction(setItemType) && setItemType.shared.parameters.length >= 2) {
                        const paramType = FunctionType.getParamType(setItemType, 1);
                        if (!isAnyOrUnknown(paramType)) {
                            return paramType;
                        }
                    }
                }
                break;
            }

            case ParseNodeType.Tuple: {
                // If this is a tuple expression with at least one item and no
                // unpacked items, and all of the items have declared types,
                // we can assume a declared type for the resulting tuple. This
                // is needed to enable bidirectional type inference when assigning
                // to an unpacked tuple.
                if (
                    expression.d.items.length > 0 &&
                    !expression.d.items.some((item) => item.nodeType === ParseNodeType.Unpack)
                ) {
                    const itemTypes: Type[] = [];
                    expression.d.items.forEach((expr) => {
                        const itemType = getDeclaredTypeForExpression(expr, usage);
                        if (itemType) {
                            itemTypes.push(itemType);
                        }
                    });

                    if (itemTypes.length === expression.d.items.length) {
                        // If all items have a declared type, return a tuple of those types.
                        return makeTupleObject(
                            evaluatorInterface,
                            itemTypes.map((t) => {
                                return { type: t, isUnbounded: false };
                            })
                        );
                    }
                }
                break;
            }
        }

        if (symbol) {
            return resolveDeclaredMemberType(
                symbol,
                classOrObjectBase,
                memberAccessClass,
                useDescriptorSetterType,
                bindFunction,
                selfType
            );
        }

        return undefined;
    }

    function getTypeOfIterator(
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError = true
    ): TypeResult | undefined {
        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        let isValidIterator = true;
        let isIncomplete = typeResult.isIncomplete;

        let type = transformPossibleRecursiveTypeAlias(typeResult.type);
        type = makeTopLevelTypeVarsConcrete(type);
        type = removeUnbound(type);

        if (isOptionalType(type) && emitNotIterableError) {
            if (!typeResult.isIncomplete) {
                addDiagnostic(DiagnosticRule.reportOptionalIterable, LocMessage.noneNotIterable(), errorNode);
            }
            type = removeNoneFromUnion(type);
        }

        const iterableType = mapSubtypes(type, (subtype) => {
            subtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (isClass(subtype)) {
                // Handle an empty tuple specially.
                if (
                    TypeBase.isInstance(subtype) &&
                    isTupleClass(subtype) &&
                    subtype.priv.tupleTypeArgs &&
                    subtype.priv.tupleTypeArgs.length === 0
                ) {
                    return NeverType.createNever();
                }

                const iterReturnType = getTypeOfMagicMethodCall(subtype, iterMethodName, [], errorNode)?.type;

                if (!iterReturnType) {
                    // There was no callable __iter__. The legacy sequence protocol
                    // falls back to __getitem__, but CPython does that only when
                    // __iter__ is missing. An explicit `__iter__ = None` (or any
                    // non-callable __iter__) makes the object not iterable.
                    let hasExplicitIterMember = false;
                    if (!isAsync && isClassInstance(subtype)) {
                        hasExplicitIterMember = !!lookUpObjectMember(
                            subtype,
                            iterMethodName,
                            MemberAccessFlags.SkipInstanceMembers |
                                MemberAccessFlags.SkipAttributeAccessOverride |
                                MemberAccessFlags.SkipObjectBaseClass
                        );
                    }

                    if (!isAsync && isClassInstance(subtype) && !hasExplicitIterMember) {
                        const getItemReturnType = getTypeOfMagicMethodCall(
                            subtype,
                            '__getitem__',
                            [
                                {
                                    type:
                                        context.prefetched?.intClass && isInstantiableClass(context.prefetched.intClass)
                                            ? ClassType.cloneAsInstance(context.prefetched.intClass)
                                            : UnknownType.create(),
                                },
                            ],
                            errorNode
                        )?.type;
                        if (getItemReturnType) {
                            return getItemReturnType;
                        }
                    }

                    diag.addMessage(LocMessage.methodNotDefined().format({ name: iterMethodName }));
                } else {
                    const iterReturnTypeDiag = new DiagnosticAddendum();

                    const returnType = mapSubtypesExpandTypeVars(iterReturnType, /* options */ undefined, (subtype) => {
                        if (isAnyOrUnknown(subtype)) {
                            return subtype;
                        }

                        let nextReturnType = getTypeOfMagicMethodCall(subtype, nextMethodName, [], errorNode)?.type;

                        if (!nextReturnType) {
                            iterReturnTypeDiag.addMessage(
                                LocMessage.methodNotDefinedOnType().format({
                                    name: nextMethodName,
                                    type: printType(subtype),
                                })
                            );
                        } else {
                            // Convert any unpacked TypeVarTuples into object instances. We don't
                            // know anything more about them.
                            nextReturnType = mapSubtypes(nextReturnType, (returnSubtype) => {
                                if (isTypeVar(returnSubtype) && isUnpackedTypeVarTuple(returnSubtype)) {
                                    return getObjectType();
                                }

                                return returnSubtype;
                            });

                            if (!isAsync) {
                                return nextReturnType;
                            }

                            // If it's an async iteration, there's an implicit
                            // 'await' operator applied.
                            const awaitableResult = getTypeOfAwaitable(
                                { type: nextReturnType, isIncomplete: typeResult.isIncomplete },
                                errorNode
                            );
                            if (awaitableResult.isIncomplete) {
                                isIncomplete = true;
                            }
                            return awaitableResult.type;
                        }

                        return undefined;
                    });

                    if (iterReturnTypeDiag.isEmpty()) {
                        return returnType;
                    }

                    diag.addAddendum(iterReturnTypeDiag);
                }
            }

            if (!isIncomplete && emitNotIterableError) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeNotIterable().format({ type: printType(subtype) }) + diag.getString(),
                    errorNode
                );
            }

            isValidIterator = false;
            return undefined;
        });

        return isValidIterator ? { type: iterableType, isIncomplete } : undefined;
    }

    function getTypeOfIterable(
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError = true
    ): TypeResult | undefined {
        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        let isValidIterable = true;

        let type = makeTopLevelTypeVarsConcrete(typeResult.type);

        if (isOptionalType(type)) {
            if (!typeResult.isIncomplete && emitNotIterableError) {
                addDiagnostic(DiagnosticRule.reportOptionalIterable, LocMessage.noneNotIterable(), errorNode);
            }
            type = removeNoneFromUnion(type);
        }

        const iterableType = mapSubtypes(type, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isClass(subtype)) {
                const iterReturnType = getTypeOfMagicMethodCall(subtype, iterMethodName, [], errorNode)?.type;

                if (iterReturnType) {
                    return makeTopLevelTypeVarsConcrete(iterReturnType);
                }
            }

            if (emitNotIterableError) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeNotIterable().format({ type: printType(subtype) }),
                    errorNode
                );
            }

            isValidIterable = false;
            return undefined;
        });

        return isValidIterable ? { type: iterableType, isIncomplete: typeResult.isIncomplete } : undefined;
    }

    function getTypeOfIndexedObjectOrClass(
        node: IndexNode,
        baseType: ClassType,
        selfType: ClassType | TypeVarType | undefined,
        usage: EvaluatorUsage
    ): TypeResult {
        // Handle index operations for TypedDict classes specially.
        if (isClassInstance(baseType) && ClassType.isTypedDictClass(baseType)) {
            const typeFromTypedDict = getTypeOfIndexedTypedDict(evaluatorInterface, node, baseType, usage);
            if (typeFromTypedDict) {
                return typeFromTypedDict;
            }
        }

        const magicMethodName = getIndexAccessMagicMethodName(usage);
        // A full member lookup specializes tuple arguments even if a constant
        // index can select its answer directly.
        const nativeItemSymbol =
            usage.method === 'get' && !selfType && isClassInstance(baseType) && ClassType.isBuiltIn(baseType, 'tuple')
                ? ClassType.getSymbolTable(baseType).get(magicMethodName)
                : undefined;
        const nativeItemType = nativeItemSymbol?.isClassMember()
            ? getEffectiveTypeOfSymbol(nativeItemSymbol)
            : undefined;
        const nativeItemMethods =
            nativeItemType && isFunctionOrOverloaded(nativeItemType)
                ? isOverloaded(nativeItemType)
                    ? OverloadedType.getOverloads(nativeItemType)
                    : [nativeItemType]
                : [];
        const canDeferBinding =
            nativeItemMethods.length > 0 &&
            nativeItemMethods.every(
                (method) =>
                    FunctionType.isInstanceMethod(method) &&
                    method.shared.parameters.length > 0 &&
                    !FunctionParam.isTypeDeclared(method.shared.parameters[0])
            );
        let itemMethodType = canDeferBinding
            ? undefined
            : getBoundMagicMethod(baseType, magicMethodName, selfType, node.d.leftExpr);

        // Handle the special case where the object is a tuple and
        // the index is a constant number (integer) or a slice with integer
        // start and end values. In these cases, we can determine
        // the exact type by indexing into the tuple type array.
        if (
            (canDeferBinding || itemMethodType) &&
            node.d.items.length === 1 &&
            !node.d.trailingComma &&
            !node.d.items[0].d.name &&
            node.d.items[0].d.argCategory === ArgCategory.Simple &&
            isClassInstance(baseType)
        ) {
            const index0Expr = node.d.items[0].d.valueExpr;
            const valueType = getTypeOfExpression(index0Expr).type;

            if (
                isClassInstance(valueType) &&
                ClassType.isBuiltIn(valueType, 'int') &&
                isLiteralType(valueType) &&
                typeof valueType.priv.literalValue === 'number'
            ) {
                const indexValue = valueType.priv.literalValue;
                const tupleType = getSpecializedTupleType(baseType);

                if (tupleType && tupleType.priv.tupleTypeArgs) {
                    if (isTupleIndexUnambiguous(tupleType, indexValue)) {
                        if (indexValue >= 0 && indexValue < tupleType.priv.tupleTypeArgs.length) {
                            return { type: tupleType.priv.tupleTypeArgs[indexValue].type };
                        } else if (indexValue < 0 && tupleType.priv.tupleTypeArgs.length + indexValue >= 0) {
                            return {
                                type: tupleType.priv.tupleTypeArgs[tupleType.priv.tupleTypeArgs.length + indexValue]
                                    .type,
                            };
                        }
                    }
                }
            } else if (
                usage.method === 'get' &&
                index0Expr.nodeType === ParseNodeType.Slice &&
                isClassInstance(valueType) &&
                ClassType.isBuiltIn(valueType, 'slice')
            ) {
                const tupleType = getSpecializedTupleType(baseType);

                if (tupleType) {
                    // Skip this if a subclass overrides the tuple's __getitem__ method.
                    const getItemMember = lookUpObjectMember(
                        baseType,
                        '__getitem__',
                        MemberAccessFlags.SkipInstanceMembers
                    );
                    const isTupleGetItem =
                        !getItemMember ||
                        (isInstantiableClass(getItemMember.classType) &&
                            ClassType.isBuiltIn(getItemMember.classType, 'tuple'));

                    if (isTupleGetItem) {
                        const slicedTupleType = getSlicedTupleType(evaluatorInterface, tupleType, index0Expr);
                        if (slicedTupleType) {
                            return { type: slicedTupleType };
                        }
                    }
                }
            }
        }

        if (canDeferBinding) {
            const inferredBase = getInferredTupleLiteralBase(baseType);
            const tupleArgs = baseType.priv.tupleTypeArgs;
            if (
                inferredBase !== baseType &&
                isClassInstance(inferredBase) &&
                ClassType.isBuiltIn(inferredBase, 'tuple') &&
                tupleArgs &&
                tupleArgs.length > 1 &&
                tupleArgs.some(
                    (arg) => isUnion(arg.type) || (isClassInstance(arg.type) && ClassType.isBuiltIn(arg.type, 'tuple'))
                )
            ) {
                // Avoid structural union work for optional literals before native method binding.
                baseType = inferredBase;
            }
            itemMethodType = getBoundMagicMethod(baseType, magicMethodName, selfType, node.d.leftExpr);
        }
        if (!itemMethodType) {
            addDiagnostic(
                DiagnosticRule.reportIndexIssue,
                LocMessage.methodNotDefinedOnType().format({
                    name: magicMethodName,
                    type: printType(baseType),
                }),
                node.d.leftExpr
            );
            return { type: UnknownType.create() };
        }

        const positionalArgs = node.d.items.filter((item) => item.d.argCategory === ArgCategory.Simple);
        const unpackedListArgs = node.d.items.filter((item) => item.d.argCategory === ArgCategory.UnpackedList);

        let positionalIndexType: Type;
        let isPositionalIndexTypeIncomplete = false;

        if (positionalArgs.length === 1 && unpackedListArgs.length === 0 && !node.d.trailingComma) {
            // Handle the common case where there is a single positional argument.
            const typeResult = getTypeOfExpression(positionalArgs[0].d.valueExpr);
            positionalIndexType = typeResult.type;
            if (typeResult.isIncomplete) {
                isPositionalIndexTypeIncomplete = true;
            }
        } else {
            // Package up all of the positionals into a tuple.
            const tupleTypeArgs: TupleTypeArg[] = [];

            const getDeterministicTupleEntries = (type: Type): TupleTypeArg[] | undefined => {
                let aggregatedArgs: TupleTypeArg[] | undefined;
                let isDeterministic = true;

                doForEachSubtype(type, (subtype) => {
                    if (!isDeterministic) {
                        return;
                    }

                    const tupleType = getSpecializedTupleType(subtype);
                    const tupleTypeArgs = tupleType?.priv.tupleTypeArgs;

                    if (
                        !tupleTypeArgs ||
                        tupleTypeArgs.some((entry) => entry.isUnbounded || isTypeVarTuple(entry.type))
                    ) {
                        isDeterministic = false;
                        return;
                    }

                    if (!aggregatedArgs) {
                        aggregatedArgs = tupleTypeArgs.map((entry) => ({ type: entry.type, isUnbounded: false }));
                        return;
                    }

                    if (aggregatedArgs.length !== tupleTypeArgs.length) {
                        isDeterministic = false;
                        return;
                    }

                    for (let i = 0; i < aggregatedArgs.length; i++) {
                        aggregatedArgs[i] = {
                            type: combineTypes([aggregatedArgs[i].type, tupleTypeArgs[i].type]),
                            isUnbounded: false,
                        };
                    }
                });

                if (!isDeterministic || !aggregatedArgs) {
                    return undefined;
                }

                return aggregatedArgs;
            };

            node.d.items.forEach((arg) => {
                if (arg.d.argCategory === ArgCategory.Simple) {
                    const typeResult = getTypeOfExpression(arg.d.valueExpr);
                    tupleTypeArgs.push({ type: typeResult.type, isUnbounded: false });
                    if (typeResult.isIncomplete) {
                        isPositionalIndexTypeIncomplete = true;
                    }
                    return;
                }

                if (arg.d.argCategory === ArgCategory.UnpackedList) {
                    const typeResult = getTypeOfExpression(arg.d.valueExpr);
                    if (typeResult.isIncomplete) {
                        isPositionalIndexTypeIncomplete = true;
                    }

                    const deterministicEntries = getDeterministicTupleEntries(typeResult.type);
                    if (deterministicEntries) {
                        appendArray(tupleTypeArgs, deterministicEntries);
                        return;
                    }

                    const iterableType =
                        getTypeOfIterator(typeResult, /* isAsync */ false, arg.d.valueExpr)?.type ??
                        UnknownType.create();
                    tupleTypeArgs.push({ type: iterableType, isUnbounded: true });
                }
            });

            const unboundedCount = tupleTypeArgs.filter((typeArg) => typeArg.isUnbounded).length;
            if (unboundedCount > 1) {
                const firstUnboundedIndex = tupleTypeArgs.findIndex((typeArg) => typeArg.isUnbounded);
                const removedEntries = tupleTypeArgs.splice(firstUnboundedIndex);
                tupleTypeArgs.push({
                    type: combineTypes(removedEntries.map((entry) => entry.type)),
                    isUnbounded: true,
                });
            }

            positionalIndexType = makeTupleObject(evaluatorInterface, tupleTypeArgs);
        }

        const argList: Arg[] = [
            {
                argCategory: ArgCategory.Simple,
                typeResult: { type: positionalIndexType, isIncomplete: isPositionalIndexTypeIncomplete },
            },
        ];

        if (usage.method === 'set') {
            let setType = usage.setType?.type ?? AnyType.create();

            // Expand constrained type variables.
            if (isTypeVar(setType) && TypeVarType.hasConstraints(setType)) {
                const conditionFilter = isClassInstance(baseType) ? baseType.props?.condition : undefined;
                setType = makeTopLevelTypeVarsConcrete(
                    setType,
                    /* makeParamSpecsConcrete */ undefined,
                    conditionFilter
                );
            }

            argList.push({
                argCategory: ArgCategory.Simple,
                typeResult: {
                    type: setType,
                    isIncomplete: !!usage.setType?.isIncomplete,
                },
            });
        }

        const callResult = validateCallArgs(
            node,
            argList,
            { type: itemMethodType },
            /* constraints */ undefined,
            /* skipUnknownArgCheck */ true,
            /* inferenceContext */ undefined
        );

        return {
            type: callResult.returnType ?? UnknownType.create(),
            isIncomplete: !!callResult.isTypeIncomplete,
        };
    }

    function getTypeArg(node: ExpressionNode, flags: EvalFlags, supportsDictExpression: boolean): TypeResultWithNode {
        let typeResult: TypeResultWithNode;

        let adjustedFlags =
            flags | EvalFlags.InstantiableType | EvalFlags.ConvertEllipsisToAny | EvalFlags.StrLiteralAsType;

        const fileInfo = nodeInfo.getFileInfo(node);
        if (fileInfo.isStubFile) {
            adjustedFlags |= EvalFlags.ForwardRefs;
        }

        if (node.nodeType === ParseNodeType.List) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.d.items.map((entry) => {
                    return { ...getTypeOfExpression(entry, adjustedFlags), node: entry };
                }),
                node,
            };

            // Set the node's type so it isn't reevaluated later.
            setTypeResultForNode(node, { type: UnknownType.create() });
        } else if (node.nodeType === ParseNodeType.Dictionary && supportsDictExpression) {
            const inlinedTypeDict =
                context.prefetched?.typedDictClass && isInstantiableClass(context.prefetched.typedDictClass)
                    ? createTypedDictTypeInlined(evaluatorInterface, node, context.prefetched.typedDictClass, nodeInfo)
                    : undefined;
            const keyTypeFallback =
                context.prefetched?.strClass && isInstantiableClass(context.prefetched.strClass)
                    ? context.prefetched.strClass
                    : UnknownType.create();

            typeResult = {
                type: keyTypeFallback,
                inlinedTypeDict,
                node,
            };
        } else {
            typeResult = { ...getTypeOfExpression(node, adjustedFlags), node };

            if (node.nodeType === ParseNodeType.Dictionary) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.dictInAnnotation(), node);
            }

            if ((flags & EvalFlags.NoClassVar) !== 0) {
                // "ClassVar" is not allowed as a type argument.
                if (isClass(typeResult.type) && ClassType.isBuiltIn(typeResult.type, 'ClassVar')) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.classVarNotAllowed(), node);
                }
            }
        }

        return typeResult;
    }

    function getTypeOfLambdaForCall(node: CallNode, inferenceContext: InferenceContext | undefined): TypeResult {
        assert(node.d.leftExpr.nodeType === ParseNodeType.Lambda);

        const expectedType = FunctionType.createSynthesizedInstance('');
        expectedType.shared.declaredReturnType = inferenceContext
            ? inferenceContext.expectedType
            : UnknownType.create();

        let isArgTypeIncomplete = false;
        node.d.args.forEach((arg, index) => {
            const argTypeResult = getTypeOfExpression(arg.d.valueExpr);
            if (argTypeResult.isIncomplete) {
                isArgTypeIncomplete = true;
            }

            FunctionType.addParam(
                expectedType,
                FunctionParam.create(
                    ParamCategory.Simple,
                    argTypeResult.type,
                    FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                    `p${index.toString()}`
                )
            );
        });

        // If the lambda's param list ends with a "/" positional parameter separator,
        // add a corresponding separator to the expected type.
        const lambdaParams = node.d.leftExpr.d.params;
        if (lambdaParams.length > 0) {
            const lastParam = lambdaParams[lambdaParams.length - 1];
            if (lastParam.d.category === ParamCategory.Simple && !lastParam.d.name) {
                FunctionType.addPositionOnlyParamSeparator(expectedType);
            }
        }

        function getLambdaType() {
            return getTypeOfExpression(node.d.leftExpr, EvalFlags.CallBaseDefaults, makeInferenceContext(expectedType));
        }

        // If one or more of the arguments are incomplete, use speculative mode
        // for the lambda evaluation because it may need to be reevaluated once
        // the arg types are complete.
        let typeResult =
            isArgTypeIncomplete || isSpeculativeModeInUse(node) || inferenceContext?.isTypeIncomplete
                ? useSpeculativeMode(node.d.leftExpr, getLambdaType)
                : getLambdaType();

        // If bidirectional type inference failed, use normal type inference instead.
        if (typeResult.typeErrors) {
            typeResult = getTypeOfExpression(node.d.leftExpr, EvalFlags.CallBaseDefaults);
        }

        return typeResult;
    }

    function getTypeOfTypeForm(node: CallNode, typeFormClass: ClassType): TypeResult {
        if (
            node.d.args.length !== 1 ||
            node.d.args[0].d.argCategory !== ArgCategory.Simple ||
            node.d.args[0].d.name !== undefined
        ) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.typeFormArgs(), node);
            return { type: UnknownType.create() };
        }

        const typeFormResult = getTypeOfArgExpectingType(convertNodeToArg(node.d.args[0]), {
            typeFormArg: true,
            noNonTypeSpecialForms: true,
            typeExpression: true,
        });

        if (!typeFormResult.typeErrors && typeFormResult.type.props?.typeForm) {
            typeFormResult.type = convertToInstance(
                ClassType.specialize(typeFormClass, [convertToInstance(typeFormResult.type.props.typeForm)])
            );
        }

        return typeFormResult;
    }

    function getTypeOfAssertType(node: CallNode, inferenceContext: InferenceContext | undefined): TypeResult {
        if (
            node.d.args.length !== 2 ||
            node.d.args[0].d.argCategory !== ArgCategory.Simple ||
            node.d.args[0].d.name !== undefined ||
            node.d.args[0].d.argCategory !== ArgCategory.Simple ||
            node.d.args[1].d.name !== undefined
        ) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.assertTypeArgs(), node);
            return { type: UnknownType.create() };
        }

        const arg0TypeResult = getTypeOfExpression(node.d.args[0].d.valueExpr, /* flags */ undefined, inferenceContext);
        if (arg0TypeResult.isIncomplete) {
            return { type: UnknownType.create(/* isIncomplete */ true), isIncomplete: true };
        }

        const assertedType = convertToInstance(
            getTypeOfArgExpectingType(convertNodeToArg(node.d.args[1]), {
                typeExpression: true,
            }).type
        );

        // We'll replace TypeGuard and TypeIs with bool for purposes of assert_type testing.
        // The spec is unclear on whether this is the correct behavior, but it seems to be
        // what mypy does -- and what various library authors expect.
        const arg0Type = stripTypeGuard(arg0TypeResult.type);

        const typeSameOptions = {
            treatAnySameAsUnknown: true,
            ignorePseudoGeneric: true,
            ignoreConditions: true,
        };
        let typesMatch = isTypeSame(assertedType, arg0Type, typeSameOptions);

        if (!typesMatch) {
            // Unlike assignType, assert_type requires exact structural identity, so
            // normalize both types recursively. Keep this equivalence relation aligned
            // with expandEnumTypeForLiteralComparison, which assignType applies as it recurses.
            const literalEnumClasses = collectLiteralEnumClasses(assertedType, [], /* recursively */ true);
            collectLiteralEnumClasses(arg0Type, literalEnumClasses, /* recursively */ true);
            const normalizedAssertedType = normalizeEnumTypes(assertedType, literalEnumClasses);
            const normalizedArg0Type = normalizeEnumTypes(arg0Type, literalEnumClasses);
            typesMatch = isTypeSame(normalizedAssertedType, normalizedArg0Type, typeSameOptions);
        }

        if (!typesMatch) {
            const srcDestTypes = printSrcDestTypes(arg0TypeResult.type, assertedType, { expandTypeAlias: true });

            addDiagnostic(
                DiagnosticRule.reportAssertTypeFailure,
                LocMessage.assertTypeTypeMismatch().format({
                    expected: srcDestTypes.destType,
                    received: srcDestTypes.sourceType,
                }),
                node.d.args[0].d.valueExpr
            );
        }

        return { type: arg0TypeResult.type };
    }

    function getTypeOfRevealLocals(node: CallNode) {
        let curNode: ParseNode | undefined = node;
        let scope: Scope | undefined;

        while (curNode) {
            scope = getScopeForNode(curNode);

            // Stop when we get a valid scope that's not a list comprehension
            // scope. That includes lambdas, functions, classes, and modules.
            if (scope && scope.type !== ScopeType.Comprehension) {
                break;
            }

            curNode = curNode.parent;
        }

        const infoMessages: string[] = [];

        if (scope) {
            scope.symbolTable.forEach((symbol, name) => {
                if (!symbol.isIgnoredForProtocolMatch()) {
                    const typeOfSymbol = getEffectiveTypeOfSymbol(symbol);
                    infoMessages.push(
                        LocAddendum.typeOfSymbol().format({
                            name,
                            type: printType(typeOfSymbol, { expandTypeAlias: true }),
                        })
                    );
                }
            });
        }

        if (infoMessages.length > 0) {
            addInformation(infoMessages.join('\n'), node);
        } else {
            addInformation(LocMessage.revealLocalsNone(), node);
        }

        return getNoneType();
    }

    function getTypeOfSuperCall(node: CallNode): TypeResult {
        if (node.d.args.length > 2) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.superCallArgCount(), node.d.args[2]);
        }

        const enclosingFunction = ParseTreeUtils.getEnclosingFunctionEvaluationScope(node, nodeInfo);
        const enclosingClass = enclosingFunction ? ParseTreeUtils.getEnclosingClass(enclosingFunction) : undefined;
        const enclosingClassType = enclosingClass ? getTypeOfClass(enclosingClass)?.classType : undefined;

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.d.args.length > 0) {
            targetClassType = getTypeOfExpression(node.d.args[0].d.valueExpr).type;
            const concreteTargetClassType = makeTopLevelTypeVarsConcrete(targetClassType);

            if (
                !isAnyOrUnknown(concreteTargetClassType) &&
                !isInstantiableClass(concreteTargetClassType) &&
                !isMetaclassInstance(concreteTargetClassType)
            ) {
                addDiagnostic(
                    DiagnosticRule.reportArgumentType,
                    LocMessage.superCallFirstArg().format({ type: printType(targetClassType) }),
                    node.d.args[0].d.valueExpr
                );
            }
        } else {
            if (enclosingClassType) {
                targetClassType = enclosingClassType ?? UnknownType.create();

                const functionInfo = enclosingFunction
                    ? getFunctionInfoFromDecorators(
                          evaluatorInterface,
                          enclosingFunction,
                          /* isInClass */ true,
                          nodeInfo
                      )
                    : undefined;

                // Zero-argument forms of super are not allowed within static methods.
                // This results in a runtime exception.
                if (functionInfo !== undefined && (functionInfo.flags & FunctionTypeFlags.StaticMethod) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.superCallZeroArgFormStaticMethod(),
                        node.d.leftExpr
                    );
                } else if (
                    !ParseTreeUtils.isZeroArgSuperCallAllowed(
                        node,
                        nodeInfo.getFileInfo(node).executionEnvironment.pythonVersion,
                        nodeInfo
                    )
                ) {
                    // The evaluation scope cannot supply a first positional
                    // argument for the zero-argument form.
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.superCallZeroArgForm(),
                        node.d.leftExpr
                    );
                }
            } else {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.superCallZeroArgForm(),
                    node.d.leftExpr
                );
                targetClassType = UnknownType.create();
            }
        }

        const concreteTargetClassType = makeTopLevelTypeVarsConcrete(targetClassType);

        // Determine whether to further narrow the type.
        let secondArgType: Type | undefined;
        let bindToType: ClassType | undefined;

        if (node.d.args.length > 1) {
            secondArgType = getTypeOfExpression(node.d.args[1].d.valueExpr).type;
            const secondArgConcreteType = makeTopLevelTypeVarsConcrete(secondArgType);

            let reportError = false;

            doForEachSubtype(secondArgConcreteType, (secondArgSubtype) => {
                if (isAnyOrUnknown(secondArgSubtype)) {
                    // Ignore unknown or any types.
                } else if (isClassInstance(secondArgSubtype)) {
                    if (isInstantiableClass(concreteTargetClassType)) {
                        if (
                            !derivesFromClassRecursive(
                                ClassType.cloneAsInstantiable(secondArgSubtype),
                                concreteTargetClassType,
                                /* ignoreUnknown */ true
                            )
                        ) {
                            reportError = true;
                        }
                    }
                    bindToType = secondArgSubtype;
                } else if (isInstantiableClass(secondArgSubtype)) {
                    if (isInstantiableClass(concreteTargetClassType)) {
                        if (
                            !ClassType.isBuiltIn(concreteTargetClassType, 'type') &&
                            !derivesFromClassRecursive(
                                secondArgSubtype,
                                concreteTargetClassType,
                                /* ignoreUnknown */ true
                            )
                        ) {
                            reportError = true;
                        }
                    }
                    bindToType = secondArgSubtype;
                } else {
                    reportError = true;
                }
            });

            if (reportError) {
                addDiagnostic(
                    DiagnosticRule.reportArgumentType,
                    LocMessage.superCallSecondArg().format({ type: printType(targetClassType) }),
                    node.d.args[1].d.valueExpr
                );

                return { type: UnknownType.create() };
            }
        } else if (enclosingClassType) {
            bindToType = ClassType.cloneAsInstance(enclosingClassType);

            // Get the type from the self or cls parameter if it is explicitly annotated.
            // If it's a TypeVar, change the bindToType into a conditional type.
            const enclosingMethod = ParseTreeUtils.getEnclosingFunction(node);
            let implicitBindToType: Type | undefined;

            if (enclosingMethod) {
                const methodTypeInfo = getTypeOfFunction(enclosingMethod);
                if (methodTypeInfo) {
                    const methodType = methodTypeInfo.functionType;
                    if (
                        FunctionType.isClassMethod(methodType) ||
                        FunctionType.isConstructorMethod(methodType) ||
                        FunctionType.isInstanceMethod(methodType)
                    ) {
                        if (
                            methodType.shared.parameters.length > 0 &&
                            FunctionParam.isTypeDeclared(methodType.shared.parameters[0])
                        ) {
                            let paramType = FunctionType.getParamType(methodType, 0);
                            const liveScopeIds = getTypeVarScopesForNode(node);
                            paramType = makeTypeVarsBound(paramType, liveScopeIds);
                            implicitBindToType = makeTopLevelTypeVarsConcrete(paramType);
                        }
                    }
                }
            }

            if (bindToType && implicitBindToType) {
                const typeCondition = getTypeCondition(implicitBindToType);
                if (typeCondition) {
                    bindToType = addConditionToType(bindToType, typeCondition);
                } else if (isClass(implicitBindToType)) {
                    bindToType = implicitBindToType;
                }
            }
        }

        // Determine whether super() should return an instance of the class or
        // the class itself. It depends on whether the super() call is located
        // within an instance method or not.
        let resultIsInstance = true;
        if (node.d.args.length <= 1) {
            const enclosingMethod = ParseTreeUtils.getEnclosingFunction(node);
            if (enclosingMethod) {
                const methodType = getTypeOfFunction(enclosingMethod);
                if (methodType) {
                    if (
                        FunctionType.isStaticMethod(methodType.functionType) ||
                        FunctionType.isConstructorMethod(methodType.functionType) ||
                        FunctionType.isClassMethod(methodType.functionType)
                    ) {
                        resultIsInstance = false;
                    }
                }
            }
        }

        // Python docs indicate that super() isn't valid for
        // operations other than member accesses or attribute lookups.
        const parentNode = node.parent;
        if (parentNode?.nodeType === ParseNodeType.MemberAccess) {
            const memberName = parentNode.d.member.d.value;
            let effectiveTargetClass = isClass(concreteTargetClassType) ? concreteTargetClassType : undefined;

            // If the bind-to type is a protocol, don't use the effective target class.
            // This pattern is used for mixins, where the mixin type is a protocol class
            // that is used to decorate the "self" or "cls" parameter.
            let isProtocolClass = false;
            if (
                bindToType &&
                ClassType.isProtocolClass(bindToType) &&
                effectiveTargetClass &&
                !ClassType.isSameGenericClass(
                    TypeBase.isInstance(bindToType) ? ClassType.cloneAsInstantiable(bindToType) : bindToType,
                    effectiveTargetClass
                )
            ) {
                isProtocolClass = true;
                effectiveTargetClass = undefined;
            }

            if (bindToType) {
                bindToType = selfSpecializeClass(bindToType, { useBoundTypeVars: true });
            }

            const lookupResults = bindToType
                ? lookUpClassMember(bindToType, memberName, MemberAccessFlags.Default, effectiveTargetClass)
                : undefined;

            let resultType: Type;
            if (lookupResults && isInstantiableClass(lookupResults.classType)) {
                resultType = lookupResults.classType;

                if (isProtocolClass) {
                    // If the bindToType is a protocol class, set the "include subclasses" flag
                    // so we don't enforce that called methods are implemented within the protocol.
                    resultType = ClassType.cloneIncludeSubclasses(resultType);
                }
            } else if (
                effectiveTargetClass &&
                !isAnyOrUnknown(effectiveTargetClass) &&
                !derivesFromAnyOrUnknown(effectiveTargetClass)
            ) {
                resultType = context.prefetched?.objectClass ?? UnknownType.create();
            } else {
                resultType = UnknownType.create();
            }

            let bindToSelfType: ClassType | TypeVarType | undefined;
            if (bindToType) {
                if (secondArgType) {
                    // If a TypeVar was passed as the second argument, use it
                    // to derive the the self type.
                    if (isTypeVar(secondArgType)) {
                        bindToSelfType = convertToInstance(secondArgType);
                    }
                } else {
                    // If this is a zero-argument form of super(), synthesize
                    // a Self type to bind to.
                    bindToSelfType = TypeBase.cloneForCondition(
                        TypeVarType.cloneAsBound(
                            synthesizeTypeVarForSelfCls(
                                ClassType.cloneIncludeSubclasses(bindToType, /* includeSubclasses */ false),
                                /* isClsParam */ false
                            )
                        ),
                        bindToType.props?.condition
                    );
                }
            }

            const type = resultIsInstance ? convertToInstance(resultType, /* includeSubclasses */ false) : resultType;

            return { type, bindToSelfType };
        }

        // Handle the super() call when used outside of a member access expression.
        if (isInstantiableClass(concreteTargetClassType)) {
            // We don't know which member is going to be accessed, so we cannot
            // deterministically determine the correct type in this case. We'll
            // use a heuristic that produces the "correct" (desired) behavior in
            // most cases. If there's a bindToType and the targetClassType is one
            // of the base classes of the bindToType, we'll return the next base
            // class.
            if (bindToType) {
                let nextBaseClassType: Type | undefined;

                if (
                    ClassType.isSameGenericClass(
                        TypeBase.isInstance(bindToType) ? ClassType.cloneAsInstantiable(bindToType) : bindToType,
                        concreteTargetClassType
                    )
                ) {
                    if (bindToType.shared.baseClasses.length > 0) {
                        nextBaseClassType = bindToType.shared.baseClasses[0];
                    }
                } else {
                    const baseClassIndex = bindToType.shared.baseClasses.findIndex(
                        (baseClass) =>
                            isClass(baseClass) &&
                            ClassType.isSameGenericClass(baseClass, concreteTargetClassType as ClassType)
                    );

                    if (baseClassIndex >= 0 && baseClassIndex < bindToType.shared.baseClasses.length - 1) {
                        nextBaseClassType = bindToType.shared.baseClasses[baseClassIndex + 1];
                    }
                }

                if (nextBaseClassType) {
                    if (isInstantiableClass(nextBaseClassType)) {
                        nextBaseClassType = specializeForBaseClass(bindToType, nextBaseClassType);
                    }
                    return { type: resultIsInstance ? convertToInstance(nextBaseClassType) : nextBaseClassType };
                }

                // There's not much we can say about the type. Simply return object or type.
                if (context.prefetched?.typeClass && isInstantiableClass(context.prefetched.typeClass)) {
                    return {
                        type: resultIsInstance ? getObjectType() : convertToInstance(context.prefetched.typeClass),
                    };
                }
            } else {
                // If the class derives from one or more unknown classes,
                // return unknown here to prevent spurious errors.
                if (concreteTargetClassType.shared.mro.some((mroBase) => isAnyOrUnknown(mroBase))) {
                    return { type: UnknownType.create() };
                }

                const baseClasses = concreteTargetClassType.shared.baseClasses;
                if (baseClasses.length > 0) {
                    const baseClassType = baseClasses[0];
                    if (isInstantiableClass(baseClassType)) {
                        return {
                            type: resultIsInstance ? ClassType.cloneAsInstance(baseClassType) : baseClassType,
                        };
                    }
                }
            }
        }

        return { type: UnknownType.create() };
    }

    function evaluateCastCall(argList: Arg[], errorNode: ExpressionNode) {
        if (argList[0].argCategory !== ArgCategory.Simple && argList[0].valueExpression) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.unpackInAnnotation(),
                argList[0].valueExpression
            );
        }

        // Verify that the cast is necessary.
        let castToType = getTypeOfArgExpectingType(argList[0], { typeExpression: true }).type;

        const liveScopeIds = getTypeVarScopesForNode(errorNode);
        castToType = makeTypeVarsBound(castToType, liveScopeIds);

        let castFromType = getTypeOfArg(argList[1], /* inferenceContext */ undefined).type;

        if (castFromType.props?.specialForm) {
            castFromType = castFromType.props.specialForm;
        }

        if (TypeBase.isInstantiable(castToType) && !isUnknown(castToType)) {
            if (
                isTypeSame(convertToInstance(castToType), castFromType, {
                    ignorePseudoGeneric: true,
                })
            ) {
                addDiagnostic(
                    DiagnosticRule.reportUnnecessaryCast,
                    LocMessage.unnecessaryCast().format({
                        type: printType(castFromType),
                    }),
                    errorNode
                );
            }
        }

        return convertToInstance(castToType);
    }

    function getTypeOfConstant(node: ConstantNode, flags: EvalFlags): TypeResult {
        let type: Type | undefined;

        if (node.d.constType === KeywordType.None) {
            if (context.prefetched?.noneTypeClass) {
                type =
                    (flags & EvalFlags.InstantiableType) !== 0
                        ? context.prefetched.noneTypeClass
                        : convertToInstance(context.prefetched.noneTypeClass);

                type = TypeBase.cloneWithTypeForm(type, convertToInstance(type));
            }
        } else if (
            node.d.constType === KeywordType.True ||
            node.d.constType === KeywordType.False ||
            node.d.constType === KeywordType.Debug
        ) {
            type = getBuiltInObject(node, 'bool');

            // For True and False, we can create truthy and falsy
            // versions of 'bool'.
            if (type && isClassInstance(type)) {
                if (node.d.constType === KeywordType.True) {
                    type = ClassType.cloneWithLiteral(type, /* value */ true);
                } else if (node.d.constType === KeywordType.False) {
                    type = ClassType.cloneWithLiteral(type, /* value */ false);
                }
            }
        }

        return { type: type ?? UnknownType.create() };
    }

    function getTypeOfMagicMethodCall(
        objType: Type,
        methodName: string,
        argList: TypeResult[],
        errorNode: ExpressionNode,
        inferenceContext?: InferenceContext,
        diag?: DiagnosticAddendum
    ): TypeResult | undefined {
        let magicMethodSupported = true;
        let isIncomplete = false;
        let deprecationInfo: MagicMethodDeprecationInfo | undefined;
        const overloadsUsedForCall: FunctionType[] = [];

        // Create a helper lambda for object subtypes.
        const handleSubtype = (subtype: ClassType | TypeVarType) => {
            let magicMethodType: Type | undefined;
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isClass(concreteSubtype)) {
                magicMethodType = getBoundMagicMethod(concreteSubtype, methodName, subtype, errorNode, diag);
            }

            if (magicMethodType) {
                const functionArgs: Arg[] = argList.map((arg) => {
                    return {
                        argCategory: ArgCategory.Simple,
                        typeResult: arg,
                    };
                });

                let callResult: CallResult | undefined;

                callResult = useSpeculativeMode(errorNode, () => {
                    assert(magicMethodType !== undefined);
                    return validateCallArgs(
                        errorNode,
                        functionArgs,
                        { type: magicMethodType },
                        /* constraints */ undefined,
                        /* skipUnknownArgCheck */ true,
                        inferenceContext
                    );
                });

                // If there were errors with the expected type, try
                // to evaluate without the expected type.
                if (callResult.argumentErrors && inferenceContext) {
                    callResult = useSpeculativeMode(errorNode, () => {
                        assert(magicMethodType !== undefined);
                        return validateCallArgs(
                            errorNode,
                            functionArgs,
                            { type: magicMethodType },
                            /* constraints */ undefined,
                            /* skipUnknownArgCheck */ true,
                            /* inferenceContext */ undefined
                        );
                    });
                }

                if (callResult.argumentErrors) {
                    magicMethodSupported = false;
                } else if (callResult.overloadsUsedForCall) {
                    callResult.overloadsUsedForCall.forEach((overload) => {
                        overloadsUsedForCall.push(overload);

                        // If one of the overloads is deprecated, note the message.
                        if (overload.shared.deprecatedMessage && isClass(concreteSubtype)) {
                            deprecationInfo = {
                                deprecatedMessage: overload.shared.deprecatedMessage,
                                className: concreteSubtype.shared.name,
                                methodName,
                            };
                        }
                    });
                }

                if (callResult.isTypeIncomplete) {
                    isIncomplete = true;
                }

                return callResult.returnType;
            }

            magicMethodSupported = false;
            return undefined;
        };

        const returnType = mapSubtypes(objType, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isClassInstance(subtype) || isInstantiableClass(subtype) || isTypeVar(subtype)) {
                return handleSubtype(subtype);
            }

            if (isNoneInstance(subtype)) {
                if (context.prefetched?.objectClass && isInstantiableClass(context.prefetched.objectClass)) {
                    // Use 'object' for 'None'.
                    return handleSubtype(ClassType.cloneAsInstance(context.prefetched.objectClass));
                }
            }

            if (isNoneTypeClass(subtype)) {
                if (context.prefetched?.typeClass && isInstantiableClass(context.prefetched.typeClass)) {
                    // Use 'type' for 'type[None]'.
                    return handleSubtype(ClassType.cloneAsInstance(context.prefetched.typeClass));
                }
            }

            magicMethodSupported = false;
            return undefined;
        });

        if (!magicMethodSupported) {
            return undefined;
        }

        return { type: returnType, isIncomplete, magicMethodDeprecationInfo: deprecationInfo, overloadsUsedForCall };
    }

    function getTypeOfYield(node: YieldNode): TypeResult {
        let expectedYieldType: Type | undefined;
        let sentType: Type | undefined;
        let isIncomplete = false;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionTypeInfo = getTypeOfFunction(enclosingFunction);
            if (functionTypeInfo) {
                let returnType = FunctionType.getEffectiveReturnType(functionTypeInfo.functionType);
                if (returnType) {
                    const liveScopeIds = getTypeVarScopesForNode(node);
                    returnType = makeTypeVarsBound(returnType, liveScopeIds);

                    expectedYieldType = getGeneratorYieldType(returnType, !!enclosingFunction.d.isAsync);

                    const generatorTypeArgs = getGeneratorTypeArgs(returnType);
                    if (generatorTypeArgs && generatorTypeArgs.length >= 2) {
                        sentType = makeTypeVarsBound(generatorTypeArgs[1], liveScopeIds);
                    }
                }
            }
        }

        if (node.d.expr) {
            const exprResult = getTypeOfExpression(
                node.d.expr,
                /* flags */ undefined,
                makeInferenceContext(expectedYieldType)
            );
            if (exprResult.isIncomplete) {
                isIncomplete = true;
            }
        }

        return { type: sentType || UnknownType.create(), isIncomplete };
    }

    function getTypeOfYieldFrom(node: YieldFromNode): TypeResult {
        const yieldFromTypeResult = getTypeOfExpression(node.d.expr);
        const yieldFromType = yieldFromTypeResult.type;

        const returnedType = mapSubtypes(yieldFromType, (yieldFromSubtype) => {
            // Is the expression a Generator type?
            let generatorTypeArgs = getGeneratorTypeArgs(yieldFromSubtype);
            if (generatorTypeArgs) {
                return generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
            }

            // Handle old-style (pre-await) Coroutines as a special case.
            if (
                isClassInstance(yieldFromSubtype) &&
                ClassType.isBuiltIn(yieldFromSubtype, ['Coroutine', 'CoroutineType'])
            ) {
                return UnknownType.create();
            }

            // Handle simple iterables.
            const iterableType =
                getTypeOfIterable(yieldFromTypeResult, /* isAsync */ false, node)?.type ?? UnknownType.create();

            // Does the iterable return a Generator?
            generatorTypeArgs = getGeneratorTypeArgs(iterableType);
            return generatorTypeArgs && generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
        });

        return { type: returnedType };
    }

    function getTypeOfSlice(node: SliceNode): TypeResult {
        const noneType = getNoneType();
        let startType = noneType;
        let endType = noneType;
        let stepType = noneType;
        let isIncomplete = false;

        // Evaluate the expressions to report errors and record symbol
        // references.
        if (node.d.startValue) {
            const startTypeResult = getTypeOfExpression(node.d.startValue);
            startType = startTypeResult.type;
            if (startTypeResult.isIncomplete) {
                isIncomplete = true;
            }
        }

        if (node.d.endValue) {
            const endTypeResult = getTypeOfExpression(node.d.endValue);
            endType = endTypeResult.type;
            if (endTypeResult.isIncomplete) {
                isIncomplete = true;
            }
        }

        if (node.d.stepValue) {
            const stepTypeResult = getTypeOfExpression(node.d.stepValue);
            stepType = stepTypeResult.type;
            if (stepTypeResult.isIncomplete) {
                isIncomplete = true;
            }
        }

        const sliceType = getBuiltInObject(node, 'slice');

        if (!isClassInstance(sliceType)) {
            return { type: sliceType };
        }

        return { type: ClassType.specialize(sliceType, [startType, endType, stepType]), isIncomplete };
    }

    function createLiteralType(classType: ClassType, node: IndexNode, flags: EvalFlags): Type {
        if (node.d.items.length === 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalEmptyArgs(), node.d.leftExpr);
            return UnknownType.create();
        }

        // As per the specification, we support None, int, bool, str, bytes literals
        // plus enum values.
        const literalTypes: Type[] = [];
        let isValidTypeForm = true;

        for (const item of node.d.items) {
            let type: Type | undefined;
            const itemExpr = item.d.valueExpr;

            if (item.d.argCategory !== ArgCategory.Simple) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.unpackedArgInTypeArgument(),
                        itemExpr
                    );
                    type = UnknownType.create();
                    isValidTypeForm = false;
                }
            } else if (item.d.name) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.keywordArgInTypeArgument(),
                        itemExpr
                    );
                    type = UnknownType.create();
                    isValidTypeForm = false;
                }
            } else if (
                itemExpr.nodeType === ParseNodeType.StringList &&
                itemExpr.d.strings.every((stringNode) => stringNode.nodeType === ParseNodeType.String)
            ) {
                const isBytes = (itemExpr.d.strings[0].d.token.flags & StringTokenFlags.Bytes) !== 0;
                const value = itemExpr.d.strings.map((s) => s.d.value).join('');
                if (isBytes) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bytes', value);
                } else {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'str', value);
                }

                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    itemExpr.d.strings.forEach((stringNode) => {
                        if ((stringNode.d.token.flags & StringTokenFlags.NamedUnicodeEscape) !== 0) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.literalNamedUnicodeEscape(),
                                stringNode
                            );
                            isValidTypeForm = false;
                        }
                    });
                }
            } else if (itemExpr.nodeType === ParseNodeType.Number) {
                if (!itemExpr.d.isImaginary && itemExpr.d.isInteger) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'int', itemExpr.d.value);
                }
            } else if (itemExpr.nodeType === ParseNodeType.Constant) {
                if (itemExpr.d.constType === KeywordType.True) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bool', true);
                } else if (itemExpr.d.constType === KeywordType.False) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bool', false);
                } else if (itemExpr.d.constType === KeywordType.None) {
                    type = context.prefetched?.noneTypeClass ?? UnknownType.create();
                }
            } else if (itemExpr.nodeType === ParseNodeType.UnaryOperation) {
                if (itemExpr.d.operator === OperatorType.Subtract || itemExpr.d.operator === OperatorType.Add) {
                    if (itemExpr.d.expr.nodeType === ParseNodeType.Number) {
                        if (!itemExpr.d.expr.d.isImaginary && itemExpr.d.expr.d.isInteger) {
                            type = cloneBuiltinClassWithLiteral(
                                node,
                                classType,
                                'int',
                                itemExpr.d.operator === OperatorType.Subtract
                                    ? -itemExpr.d.expr.d.value
                                    : itemExpr.d.expr.d.value
                            );
                        }
                    }
                }
            }

            if (!type) {
                const exprType = getTypeOfExpression(
                    itemExpr,
                    (flags & (EvalFlags.ForwardRefs | EvalFlags.TypeExpression)) | EvalFlags.NoConvertSpecialForm
                );

                // Is this an enum type?
                if (
                    isClassInstance(exprType.type) &&
                    ClassType.isEnumClass(exprType.type) &&
                    exprType.type.priv.literalValue !== undefined
                ) {
                    type = ClassType.cloneAsInstantiable(exprType.type);
                } else {
                    // Is this a type alias to an existing literal type?
                    let isLiteralType = true;

                    doForEachSubtype(exprType.type, (subtype) => {
                        if (!isInstantiableClass(subtype) || subtype.priv.literalValue === undefined) {
                            if (!isNoneTypeClass(subtype)) {
                                isLiteralType = false;
                            }
                        }
                    });

                    if (isLiteralType) {
                        type = exprType.type;
                    }
                }
            }

            if (!type) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalUnsupportedType(), item);
                    type = UnknownType.create();
                    isValidTypeForm = false;
                } else {
                    return ClassType.cloneAsInstance(classType);
                }
            }

            literalTypes.push(type);
        }

        let result = combineTypes(literalTypes, { skipElideRedundantLiterals: true });

        if (
            isUnion(result) &&
            context.prefetched?.unionTypeClass &&
            isInstantiableClass(context.prefetched.unionTypeClass)
        ) {
            result = TypeBase.cloneAsSpecialForm(result, ClassType.cloneAsInstance(context.prefetched.unionTypeClass));
        }

        if (isValidTypeForm) {
            result = TypeBase.cloneWithTypeForm(result, convertToInstance(result));
        }

        return result;
    }

    function getTypeOfArg(arg: Arg, inferenceContext: InferenceContext | undefined): TypeResult {
        if (arg.typeResult) {
            const type = arg.typeResult.type;
            return { type: type?.props?.specialForm ?? type, isIncomplete: arg.typeResult.isIncomplete };
        }

        if (!arg.valueExpression) {
            // We shouldn't ever get here, but just in case.
            return { type: UnknownType.create() };
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeOfExpression(arg.valueExpression, /* flags */ undefined, inferenceContext);
    }

    function getTypeOfExpressionExpectingType(node: ExpressionNode, options?: ExpectedTypeOptions): TypeResult {
        let flags = EvalFlags.InstantiableType | EvalFlags.StrLiteralAsType;

        if (options?.allowTypeVarsWithoutScopeId) {
            flags |= EvalFlags.AllowTypeVarWithoutScopeId;
        }

        if (options?.typeVarGetsCurScope) {
            flags |= EvalFlags.TypeVarGetsCurScope;
        }

        if (options?.enforceClassTypeVarScope) {
            flags |= EvalFlags.EnforceClassTypeVarScope;
        }

        const fileInfo = nodeInfo.getFileInfo(node);
        if ((isAnnotationEvaluationPostponed(fileInfo) || options?.forwardRefs) && !options?.runtimeTypeExpression) {
            flags |= EvalFlags.ForwardRefs;
        } else if (options?.parsesStringLiteral) {
            flags |= EvalFlags.ParsesStringLiteral;
        }

        if (!options?.allowFinal) {
            flags |= EvalFlags.NoFinal;
        }

        if (options?.allowRequired) {
            flags |= EvalFlags.AllowRequired | EvalFlags.TypeExpression;
        }

        if (options?.allowReadOnly) {
            flags |= EvalFlags.AllowReadOnly | EvalFlags.TypeExpression;
        }

        if (options?.allowUnpackedTuple) {
            flags |= EvalFlags.AllowUnpackedTuple;
        } else {
            flags |= EvalFlags.NoTypeVarTuple;
        }

        if (options?.allowUnpackedTypedDict) {
            flags |= EvalFlags.AllowUnpackedTypedDict;
        }

        if (!options?.allowParamSpec) {
            flags |= EvalFlags.NoParamSpec;
        }

        if (options?.typeExpression) {
            flags |= EvalFlags.TypeExpression;
        }

        if (options?.convertEllipsisToAny) {
            flags |= EvalFlags.ConvertEllipsisToAny;
        }

        if (options?.allowEllipsis) {
            flags |= EvalFlags.AllowEllipsis;
        }

        if (options?.noNonTypeSpecialForms) {
            flags |= EvalFlags.NoNonTypeSpecialForms;
        }

        if (!options?.allowClassVar) {
            flags |= EvalFlags.NoClassVar;
        }

        if (options?.varTypeAnnotation) {
            flags |= EvalFlags.VarTypeAnnotation;
        }

        if (options?.notParsed) {
            flags |= EvalFlags.NotParsed;
        }

        if (options?.typeFormArg) {
            flags |= EvalFlags.TypeFormArg;
        }

        return getTypeOfExpression(node, flags);
    }

    function getTypeOfMember(member: ClassMember): Type {
        if (isInstantiableClass(member.classType)) {
            return partiallySpecializeType(
                getEffectiveTypeOfSymbol(member.symbol),
                member.classType,
                getTypeClassType(),
                /* selfClass */ undefined
            );
        }
        return UnknownType.create();
    }

    function getTypeOfMemberInternal(
        errorNode: ExpressionNode | undefined,
        member: ClassMember,
        selfClass: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags
    ): TypeResult | undefined {
        if (isAnyOrUnknown(member.classType)) {
            return {
                type: member.classType,
                isIncomplete: false,
            };
        }

        if (!isInstantiableClass(member.classType)) {
            return undefined;
        }

        const typeResult = getEffectiveTypeOfSymbolForUsage(member.symbol);

        if (!typeResult) {
            return undefined;
        }

        // Report inappropriate use of variables in type expressions.
        if ((flags & MemberAccessFlags.TypeExpression) !== 0 && errorNode) {
            typeResult.type = validateSymbolIsTypeExpression(
                errorNode,
                typeResult.type,
                !!typeResult.includesVariableDecl
            );
        }

        // If the type is a function or overloaded function, infer
        // and cache the return type if necessary. This needs to be done
        // prior to specializing.
        inferReturnTypeIfNecessary(typeResult.type);

        // Check for ambiguous accesses to attributes with generic types?
        if (
            errorNode &&
            selfClass &&
            isClass(selfClass) &&
            member.isInstanceMember &&
            isClass(member.unspecializedClassType) &&
            (flags & MemberAccessFlags.DisallowGenericInstanceVariableAccess) !== 0 &&
            requiresSpecialization(typeResult.type, { ignoreSelf: true, ignoreImplicitTypeArgs: true })
        ) {
            const specializedType = partiallySpecializeType(
                typeResult.type,
                member.unspecializedClassType,
                getTypeClassType(),
                selfSpecializeClass(selfClass, { overrideTypeArgs: true })
            );

            if (
                findSubtype(
                    specializedType,
                    (subtype) =>
                        !isFunctionOrOverloaded(subtype) &&
                        requiresSpecialization(subtype, { ignoreSelf: true, ignoreImplicitTypeArgs: true })
                )
            ) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.genericInstanceVariableAccess(),
                    errorNode
                );
            }
        }

        return {
            type: partiallySpecializeType(typeResult.type, member.classType, getTypeClassType(), selfClass),
            isIncomplete: !!typeResult.isIncomplete,
        };
    }

    // Calls back into the parser to parse the contents of a string literal.
    // This is unfortunately needed in some cases — specifically where the
    // parser couldn't determine that the string literal would be used in
    // a context where it should be treated as a forward-declared type. This
    // call produces an expression tree that is not attached to the main parse
    // expression tree because we don't want to mutate the latter; the
    // expression tree created by this function is therefore used only temporarily.
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

    function getTypeOfStringList(
        node: StringListNode,
        flags: EvalFlags,
        inferenceContext?: InferenceContext
    ): TypeResult {
        let typeResult: TypeResult | undefined;

        if (
            (flags & EvalFlags.StrLiteralAsType) !== 0 &&
            ((flags & EvalFlags.TypeFormArg) === 0 || (flags & EvalFlags.NoConvertSpecialForm) !== 0)
        ) {
            return getTypeOfStringListAsType(node, flags);
        }

        const isBytesNode = (node: StringNode | FormatStringNode) =>
            (node.d.token.flags & StringTokenFlags.Bytes) !== 0;
        const isTemplateNode = (node: StringNode | FormatStringNode) =>
            (node.d.token.flags & StringTokenFlags.Template) !== 0;

        // Check for mixing of t-string literals with str, bytes, or f-string
        // literals. CPython reports this as a SyntaxError (PEP 750).
        const firstTemplateIndex = node.d.strings.findIndex(isTemplateNode);
        const firstNonTemplateIndex = node.d.strings.findIndex((str) => !isTemplateNode(str));
        if (firstTemplateIndex >= 0 && firstNonTemplateIndex >= 0) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.mixingTemplateAndStr(),
                node.d.strings[Math.max(firstTemplateIndex, firstNonTemplateIndex)]
            );

            return { type: UnknownType.create() };
        }

        // Check for mixing of bytes and str, which is not allowed.
        const firstStrIndex = node.d.strings.findIndex((str) => !isBytesNode(str));
        const firstBytesIndex = node.d.strings.findIndex((str) => isBytesNode(str));
        if (firstStrIndex >= 0 && firstBytesIndex >= 0) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.mixingBytesAndStr(),
                node.d.strings[Math.max(firstBytesIndex, firstStrIndex)]
            );

            return { type: UnknownType.create() };
        }

        const isBytes = firstBytesIndex >= 0;
        let isLiteralString = true;
        let isIncomplete = false;
        let isTemplate = false;

        node.d.strings.forEach((expr) => {
            // Handle implicit concatenation.
            const typeResult = getTypeOfString(expr);

            if (typeResult.isIncomplete) {
                isIncomplete = true;
            }

            let isExprLiteralString = false;

            if (isClassInstance(typeResult.type)) {
                if (ClassType.isBuiltIn(typeResult.type, 'str') && typeResult.type.priv.literalValue !== undefined) {
                    isExprLiteralString = true;
                } else if (ClassType.isBuiltIn(typeResult?.type, 'LiteralString')) {
                    isExprLiteralString = true;
                }

                if (typeResult.type.shared.name === 'Template') {
                    isTemplate = true;
                }
            }

            if (!isExprLiteralString) {
                isLiteralString = false;
            }
        });

        if (isTemplate) {
            const templateType =
                context.prefetched?.templateClass && isInstantiableClass(context.prefetched?.templateClass)
                    ? ClassType.cloneAsInstance(context.prefetched.templateClass)
                    : UnknownType.create();

            typeResult = { type: templateType, isIncomplete };
        } else if (node.d.strings.some((str) => str.nodeType === ParseNodeType.FormatString)) {
            if (isLiteralString) {
                const literalStringType = getTypingType(node, 'LiteralString');
                if (literalStringType && isInstantiableClass(literalStringType)) {
                    typeResult = { type: ClassType.cloneAsInstance(literalStringType) };
                }
            }

            if (!typeResult) {
                typeResult = {
                    type: getBuiltInObject(node, isBytes ? 'bytes' : 'str'),
                    isIncomplete,
                };
            }
        } else {
            typeResult = {
                type: cloneBuiltinObjectWithLiteral(
                    node,
                    isBytes ? 'bytes' : 'str',
                    node.d.strings.map((s) => s.d.value).join('')
                ),
                isIncomplete,
            };
        }

        if (node.d.strings.length !== 1 || node.d.strings[0].nodeType !== ParseNodeType.String) {
            return typeResult;
        }

        // Only attempt to interpret the string as a TypeForm forward reference when
        // there's a signal that a TypeForm value is wanted in this context. Doing it
        // unconditionally can trigger expensive (and recursion-prone) type lookups
        // for plain string literals in non-type contexts.
        const wantsTypeForm =
            (flags & EvalFlags.TypeFormArg) !== 0 ||
            (inferenceContext !== undefined && expectedTypeWantsTypeForm(inferenceContext.expectedType));
        if (!wantsTypeForm) {
            return typeResult;
        }

        // For performance reasons, do not attempt to treat the string literal
        // as a TypeForm if it's going to fail anyway or is unlikely to be a
        // TypeForm (really long, triple-quoted, etc.).
        const stringNode = node.d.strings[0];
        const tokenFlags = stringNode.d.token.flags;
        const disallowedTokenFlags =
            StringTokenFlags.Bytes |
            StringTokenFlags.Raw |
            StringTokenFlags.Format |
            StringTokenFlags.Template |
            StringTokenFlags.Triplicate;
        const maxTypeFormStringLength = 256;

        if (
            (tokenFlags & disallowedTokenFlags) !== 0 ||
            stringNode.d.token.escapedValue.length >= maxTypeFormStringLength
        ) {
            return typeResult;
        }

        const typeFormResult = getTypeOfStringListAsType(node, flags);
        if (typeFormResult.type.props?.typeForm) {
            typeResult.type = TypeBase.cloneWithTypeForm(typeResult.type, typeFormResult.type.props.typeForm);
        }

        return typeResult;
    }

    return {
        getTypeOfEllipsis,
        getTypeOfUnpackOperator,
        getTypeOfString,
        getDeclaredTypeForExpression,
        getTypeOfIterator,
        getTypeOfIterable,
        getTypeOfIndexedObjectOrClass,
        getTypeArg,
        getTypeOfLambdaForCall,
        getTypeOfTypeForm,
        getTypeOfAssertType,
        getTypeOfRevealLocals,
        getTypeOfSuperCall,
        evaluateCastCall,
        getTypeOfConstant,
        getTypeOfMagicMethodCall,
        getTypeOfYield,
        getTypeOfYieldFrom,
        getTypeOfSlice,
        createLiteralType,
        getTypeOfArg,
        getTypeOfExpressionExpectingType,
        getTypeOfMember,
        getTypeOfMemberInternal,
        getTypeOfStringList,
    };
}
