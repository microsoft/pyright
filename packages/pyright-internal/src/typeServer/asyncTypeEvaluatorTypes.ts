/*
 * asyncTypeEvaluatorTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Async-shaped view of Pyright's type evaluator surface used by the type server.
 *
 * These interfaces mirror Pyright's synchronous `TypeEvaluator` but express every
 * type-query method as a `Promise`. The type server was originally written against an
 * asynchronous evaluator; for the standalone Pyright type server we keep the async
 * signatures and back them with Pyright's synchronous evaluator via
 * `SyncToAsyncEvaluatorAdapter` (see syncEvaluatorAdapter.ts). Keeping the async surface
 * lets the conversion layer stay unchanged while leaving room to layer in a truly
 * asynchronous evaluator later.
 *
 * `TypeResult`, `TypeResultWithNode`, and `ClassMemberLookup` are re-exported from
 * Pyright's own `typeEvaluatorTypes` so there is a single source of truth for those types.
 */

import { CancellationToken } from 'vscode-languageserver-protocol';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { Declaration } from '../analyzer/declaration';
import { SymbolWithScope } from '../analyzer/scope';
import { Symbol } from '../analyzer/symbol';
import { SpeculativeModeOptions } from '../analyzer/typeCacheUtils';
import {
    AbstractSymbol,
    Arg,
    ArgWithExpression,
    AssignTypeFlags,
    CallResult,
    CallSignatureInfo,
    CallSiteEvaluationInfo,
    ClassTypeResult,
    DeclaredSymbolTypeInfo,
    EvalFlags,
    EvaluatorUsage,
    ExpectedTypeOptions,
    ExpectedTypeResult,
    FunctionTypeResult,
    PrintTypeOptions,
    ResolveAliasOptions,
    SolveConstraintsOptions,
    SymbolDeclInfo,
    TypeResult,
    TypeResultWithNode,
    ValidateTypeArgsOptions,
} from '../analyzer/typeEvaluatorTypes';
import { PrintTypeFlags } from '../analyzer/typePrinter';
import {
    ClassType,
    FunctionType,
    OverloadedType,
    TupleTypeArg,
    Type,
    TypeCondition,
    TypeVarType,
} from '../analyzer/types';
import { ApplyTypeVarOptions, ClassMember, InferenceContext, MemberAccessFlags } from '../analyzer/typeUtils';
import {
    ArgumentNode,
    CallNode,
    ClassNode,
    ExpressionNode,
    FunctionNode,
    NameNode,
    ParseNode,
    StringNode,
} from '../parser/parseNodes';

import { IAsyncSymbolLookup } from './programTypes';

export { ClassMemberLookup, TypeResult, TypeResultWithNode } from '../analyzer/typeEvaluatorTypes';

export interface MapSubtypesAsyncOptions {
    conditionFilter?: TypeCondition[] | undefined;
    sortSubtypes?: boolean;
    expandCallback?: (type: Type) => Promise<Type>;
}

export interface IAsyncTypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;
    runWithCancellationToken<T>(token: CancellationToken, callback: () => Promise<T>): Promise<T>;

    getType: (node: ExpressionNode) => Promise<Type | undefined>;
    getTypeResult: (node: ExpressionNode) => Promise<TypeResult | undefined>;
    getTypeOfClass: (node: ClassNode) => Promise<ClassTypeResult | undefined>;
    getTypeOfFunction: (node: FunctionNode) => Promise<FunctionTypeResult | undefined>;
    getExpectedType: (node: ExpressionNode) => Promise<ExpectedTypeResult | undefined>;
    getDeclInfoForStringNode: (node: StringNode) => Promise<SymbolDeclInfo | undefined>;
    getDeclInfoForNameNode: (node: NameNode, skipUnreachableCode?: boolean) => Promise<SymbolDeclInfo | undefined>;
    getTypeForDeclaration: (declaration: Declaration) => Promise<DeclaredSymbolTypeInfo>;
    resolveAliasDeclaration: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ) => Promise<Declaration | undefined>;
    makeTopLevelTypeVarsConcrete: (type: Type, makeParamSpecsConcrete?: boolean) => Type;
    lookUpSymbolRecursive: (
        node: ParseNode,
        name: string,
        honorCodeFlow: boolean
    ) => Promise<SymbolWithScope | undefined>;
    getEffectiveTypeOfSymbol: (symbol: Symbol) => Promise<Type>;
    getInferredTypeOfDeclaration: (symbol: Symbol, decl: Declaration) => Promise<Type | undefined>;

    getDeclaredReturnType: (node: FunctionNode) => Promise<Type | undefined>;
    getInferredReturnType: (type: FunctionType, callSiteInfo?: CallSiteEvaluationInfo) => Promise<Type>;

    getBestOverloadForArgs: (
        errorNode: ExpressionNode,
        typeResult: TypeResult<OverloadedType>,
        argList: Arg[]
    ) => Promise<FunctionType | undefined>;
    getBuiltInType: (node: ParseNode, name: string) => Promise<Type>;
    warmupPrefetchedTypes: (node: ParseNode) => Promise<void>;
    getTypeOfMember: (member: ClassMember) => Promise<Type>;
    getTypeOfBoundMember(
        errorNode: ExpressionNode,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        flags?: MemberAccessFlags,
        selfType?: ClassType | TypeVarType
    ): Promise<TypeResult | undefined>;
    getBoundMagicMethod: (
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        recursionCount?: number
    ) => Promise<FunctionType | OverloadedType | undefined>;
    bindFunctionToClassOrObject: (
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedType,
        memberClass?: ClassType,
        treatConstructorAsClassMethod?: boolean,
        selfType?: ClassType | TypeVarType,
        recursionCount?: number
    ) => Promise<FunctionType | OverloadedType | undefined>;
    getCallSignatureInfo: (
        node: CallNode,
        activeIndex: number,
        activeOrFake: boolean
    ) => Promise<CallSignatureInfo | undefined>;
    getAbstractSymbols: (classType: ClassType) => Promise<AbstractSymbol[]>;
    getBuiltInObject: (node: ParseNode, name: string, typeArgs?: Type[]) => Promise<Type>;
    isExplicitTypeAliasDeclaration: (decl: Declaration) => Promise<boolean>;
    isFinalVariableDeclaration: (decl: Declaration) => boolean;
    stripLiteralValue: (type: Type) => Type;

    printType: (type: Type, options?: PrintTypeOptions) => Promise<string>;
    printFunctionParts: (type: FunctionType, extraFlags?: PrintTypeFlags) => Promise<[string[], string]>;
    getTypingType: (node: ParseNode, symbolName: string) => Promise<Type | undefined>;
    getSymbolLookup: () => IAsyncSymbolLookup;
}

export interface TypeEvaluatorInternal extends IAsyncTypeEvaluator {
    getSymbolLookup(): IAsyncSymbolLookup;
    getTypedDictClassType: () => ClassType | undefined;
    getTupleClassType: () => ClassType | undefined;
    getDictClassType: () => ClassType | undefined;
    getStrClassType: () => ClassType | undefined;
    getObjectType: () => Type;
    getNoneType: () => Type;
    getUnionClassType(): Type;
    getTypeClassType(): ClassType | undefined;

    getTypeOfExpression: (node: ExpressionNode, flags?: EvalFlags, context?: InferenceContext) => Promise<TypeResult>;
    getTypeOfAnnotation: (node: ExpressionNode, options?: ExpectedTypeOptions) => Promise<Type>;
    getGetterTypeFromProperty: (propertyClass: ClassType) => Promise<Type | undefined>;

    createSubclass: (errorNode: ExpressionNode, type1: ClassType, type2: ClassType) => Promise<ClassType>;
    getTypeOfExpressionExpectingType: (node: ExpressionNode, options?: ExpectedTypeOptions) => Promise<TypeResult>;

    canBeTruthy: (type: Type) => Promise<boolean>;
    canBeFalsy: (type: Type) => Promise<boolean>;
    removeTruthinessFromType: (type: Type) => Promise<Type>;
    removeFalsinessFromType: (type: Type) => Promise<Type>;

    solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Promise<Type>;

    isSpecialFormClass: (classType: ClassType, flags: AssignTypeFlags) => boolean;

    getTypeOfIterator: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError?: boolean
    ) => Promise<TypeResult | undefined>;
    getTypeOfArg: (arg: Arg, inferenceContext: InferenceContext | undefined) => Promise<TypeResult>;
    convertNodeToArg: (node: ArgumentNode) => ArgWithExpression;
    buildTupleTypesList: (
        entryTypeResults: TypeResult[],
        stripLiterals: boolean,
        convertModules: boolean
    ) => TupleTypeArg[];
    expandPromotionTypes: (node: ParseNode, type: Type) => Promise<Type>;
    mapSubtypesExpandTypeVarsAsync: (
        type: Type,
        options: MapSubtypesAsyncOptions | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type) => Promise<Type | undefined>
    ) => Promise<Type>;
    getDeclaredTypeOfSymbol: (symbol: Symbol) => Promise<DeclaredSymbolTypeInfo>;

    getTypeOfMagicMethodCall: (
        objType: Type,
        methodName: string,
        argList: TypeResult[],
        errorNode: ExpressionNode,
        inferenceContext: InferenceContext | undefined
    ) => Promise<TypeResult | undefined>;
    getCallbackProtocolType: (
        objType: ClassType,
        recursionCount?: number
    ) => Promise<FunctionType | OverloadedType | undefined>;
    isTypeComparable: (leftType: Type, rightType: Type, assumeIsOperator?: boolean) => Promise<boolean>;

    assignType: (
        destType: Type,
        srcType: Type,
        constraints?: ConstraintTracker,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => Promise<boolean>;

    validateCallArgs: (
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined
    ) => Promise<CallResult>;
    validateTypeArg: (argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions) => boolean;
    assignTypeToExpression: (target: ExpressionNode, typeResult: TypeResult, srcExpr: ExpressionNode) => Promise<void>;
    inferReturnTypeIfNecessary: (type: Type) => Promise<void>;
    inferVarianceForClass: (type: ClassType) => Promise<void>;
    assignTypeArgs: (
        destType: ClassType,
        srcType: ClassType,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => Promise<boolean>;

    useSpeculativeModeAsync: <T>(
        speculativeNode: ParseNode | undefined,
        callback: () => Promise<T>,
        options?: SpeculativeModeOptions
    ) => Promise<T>;
    isSpeculativeModeInUse: (node: ParseNode | undefined) => boolean;
    setTypeResultForNode: (node: ParseNode, typeResult: TypeResult, flags?: EvalFlags) => void;
}
