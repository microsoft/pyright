/*
 * typeEvaluatorTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Abstract interface and other helper types for type evaluator module.
 */

import { CancellationToken } from 'vscode-languageserver-protocol';

import { ConsoleInterface } from '../common/console';
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { TextRange } from '../common/textRange';
import {
    ArgCategory,
    ArgumentNode,
    CallNode,
    CaseNode,
    ClassNode,
    DecoratorNode,
    ExpressionNode,
    FunctionNode,
    MatchNode,
    NameNode,
    ParamCategory,
    ParameterNode,
    ParseNode,
    StringNode,
} from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { CodeFlowReferenceExpressionNode, FlowNode } from './codeFlowTypes';
import { ConstraintTracker } from './constraintTracker';
import { Declaration } from './declaration';
import { ResolvedAliasInfo } from './declarationUtils';
import { SymbolWithScope } from './scope';
import { Symbol, SynthesizedTypeInfo } from './symbol';
import { SpeculativeModeOptions } from './typeCacheUtils';
import { PrintTypeFlags } from './typePrinter';
import {
    AnyType,
    ClassType,
    FunctionParam,
    FunctionType,
    OverloadedType,
    TupleTypeArg,
    Type,
    TypeCondition,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import { ApplyTypeVarOptions, ClassMember, InferenceContext, MemberAccessFlags } from './typeUtils';

// Maximum number of unioned subtypes for an inferred type (e.g.
// a list) before the type is considered an "Any".
export const maxSubtypesForInferredType = 64;

// In certain loops, it's possible to construct arbitrarily-deep containers
// (tuples, lists, sets, or dicts) which can lead to infinite type analysis.
// This limits the depth.
export const maxInferredContainerDepth = 8;

export const enum EvalFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1 << 0,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    NoSpecialize = 1 << 1,

    // Allow forward references. Don't report unbound errors.
    ForwardRefs = 1 << 2,

    // Treat string literal as a type.
    StrLiteralAsType = 1 << 3,

    // 'Final' is not allowed in this context.
    NoFinal = 1 << 4,

    // A ParamSpec isn't allowed in this context.
    NoParamSpec = 1 << 5,

    // A TypeVarTuple isn't allowed in this context.
    NoTypeVarTuple = 1 << 6,

    // Expression is expected to be an instantiable type rather
    // than an instance (object)
    InstantiableType = 1 << 7,

    // A type expression imposes grammatical and semantic limits on an
    // expression. If this flag is set, illegal type expressions are
    // flagged as errors.
    TypeExpression = 1 << 8,

    // Suppress the reportMissingTypeArgument diagnostic in this context.
    AllowMissingTypeArgs = 1 << 9,

    // The Generic class type is allowed in this context. It is
    // normally not allowed if ExpectingType is set.
    AllowGeneric = 1 << 10,

    // TypeVars within this expression must not refer to type vars
    // used in an outer scope.
    NoTypeVarWithScopeId = 1 << 11,

    // TypeVars within this expression do not need to refer to type vars
    // used in an outer scope.
    AllowTypeVarWithoutScopeId = 1 << 12,

    // TypeVars within this expression that are otherwise not
    // associated with an outer scope should be associated with
    // the containing function's scope.
    TypeVarGetsCurScope = 1 << 13,

    // When a new class-scoped TypeVar is used within a class
    // declaration, make sure that it is not used to parameterize
    // a base class whose TypeVar variance is inconsistent.
    EnforceVarianceConsistency = 1 << 14,

    // Used for PEP 526-style variable type annotations.
    VarTypeAnnotation = 1 << 15,

    // An ellipsis is allowed even if TypeExpression is set.
    AllowEllipsis = 1 << 16,

    // 'ClassVar' is not allowed in this context.
    NoClassVar = 1 << 17,

    // 'Generic' cannot be used without type arguments in this context.
    NoNakedGeneric = 1 << 18,

    // The node is not parsed by the interpreter because it is within
    // a comment or a string literal.
    NotParsed = 1 << 19,

    // Required and NotRequired are allowed in this context.
    AllowRequired = 1 << 20,

    // ReadOnly is allowed in this context.
    AllowReadOnly = 1 << 21,

    // Allow Unpack annotation for a tuple or TypeVarTuple.
    AllowUnpackedTuple = 1 << 22,

    // Allow Unpack annotation for TypedDict.
    AllowUnpackedTypedDict = 1 << 23,

    // Even though an expression is enclosed in a string literal,
    // the interpreter (within a source file, not a stub) still
    // parses the expression and generates parse errors.
    ParsesStringLiteral = 1 << 24,

    // Do not convert special forms to their corresponding runtime
    // objects even when expecting a type expression.
    NoConvertSpecialForm = 1 << 25,

    // Certain special forms (Protocol, TypedDict, etc.) are not allowed
    // in this context.
    NoNonTypeSpecialForms = 1 << 26,

    // Allow use of the Concatenate special form.
    AllowConcatenate = 1 << 27,

    // Do not infer literal types within a tuple (used for tuples nested within
    // other container classes).
    StripTupleLiterals = 1 << 28,

    // Interpret the expression using the specialized behaviors associated
    // with the second argument to isinstance and issubclass calls.
    IsinstanceArg = 1 << 29,

    // Interpret the expression using the behaviors associated with the first
    // argument to a TypeForm call.
    TypeFormArg = 1 << 30,

    // Enforce that any type variables referenced in this type are associated
    // with the enclosing class or an outer scope.
    EnforceClassTypeVarScope = 1 << 31,

    // Defaults used for evaluating the LHS of a call expression.
    CallBaseDefaults = NoSpecialize,

    // Defaults used for evaluating the LHS of a member access expression.
    IndexBaseDefaults = NoSpecialize,

    // Defaults used for evaluating the LHS of a member access expression.
    MemberAccessBaseDefaults = NoSpecialize,

    // Defaults used for evaluating the second argument of an 'isinstance'
    // or 'issubclass' call.
    IsInstanceArgDefaults = AllowMissingTypeArgs |
        StrLiteralAsType |
        NoParamSpec |
        NoTypeVarTuple |
        NoFinal |
        NoSpecialize |
        IsinstanceArg,
}

// Types whose definitions are prefetched and cached by the type evaluator
export interface PrefetchedTypes {
    noneTypeClass: Type;
    objectClass: Type;
    typeClass: Type;
    unionTypeClass: Type;
    awaitableClass: Type;
    functionClass: Type;
    tupleClass: Type;
    boolClass: Type;
    intClass: Type;
    strClass: Type;
    dictClass: Type;
    moduleTypeClass: Type;
    typedDictClass: Type;
    typedDictPrivateClass: Type;
    supportsKeysAndGetItemClass: Type;
    mappingClass: Type;
}

export interface TypeResult<T extends Type = Type> {
    type: T;

    // Is the type incomplete (i.e. not fully evaluated) because
    // some of the paths involve cyclical dependencies?
    isIncomplete?: boolean | undefined;

    // Used for the output of "super" calls used on the LHS of
    // a member access. Normally the type of the LHS is the same
    // as the class or object used to bind the member, but the
    // "super" call can specify a different class or object to
    // bind.
    bindToSelfType?: ClassType | TypeVarType | undefined;

    unpackedType?: Type | undefined;
    typeList?: TypeResultWithNode[] | undefined;

    // Type consistency errors detected when evaluating this type.
    typeErrors?: boolean | undefined;

    // For inlined TypedDict definitions.
    inlinedTypeDict?: ClassType;

    // Used for getTypeOfBoundMember to indicate that class
    // that declares the member.
    classType?: ClassType | UnknownType | AnyType;

    // Tuple type arguments allow the shorthand "()" to
    // represent an empty tuple (i.e. Tuple[()]).
    isEmptyTupleShorthand?: boolean | undefined;

    // Additional diagnostic information that explains why the expression
    // type is incompatible with the expected type.
    expectedTypeDiagAddendum?: DiagnosticAddendum | undefined;

    // Is member a descriptor object that is asymmetric with respect
    // to __get__ and __set__ types? Or is the member accessed through
    // a __setattr__ method that is asymmetric with respect to the
    // corresponding __getattr__?
    isAsymmetricAccessor?: boolean;

    // For member access operations that are 'set', this is the narrowed
    // type when considering the declared type of the member.
    narrowedTypeForSet?: Type | undefined;

    // Is the type wrapped in a "Required", "NotRequired" or "ReadOnly" class?
    isRequired?: boolean;
    isNotRequired?: boolean;
    isReadOnly?: boolean;

    // If a call expression, which overloads were used to satisfy it?
    overloadsUsedForCall?: FunctionType[];

    // For member access expressions, deprecation messages related to
    // magic methods invoked via the member access
    memberAccessDeprecationInfo?: MemberAccessDeprecationInfo;

    // Deprecation messages related to magic methods.
    magicMethodDeprecationInfo?: MagicMethodDeprecationInfo;
}

export interface TypeResultWithNode extends TypeResult {
    node: ParseNode;
}

// Describes deprecation details about a symbol accessed via a member
// access expression, perhaps through a property or descriptor accessor
// method.
export interface MemberAccessDeprecationInfo {
    accessType: 'property' | 'descriptor';
    accessMethod: 'get' | 'set' | 'del';
    deprecatedMessage: string;
}

export interface MagicMethodDeprecationInfo {
    className: string;
    methodName: string;
    deprecatedMessage: string;
}

export interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: TypeResult | undefined;
    setErrorNode?: ExpressionNode | undefined;
    setExpectedTypeDiag?: DiagnosticAddendum | undefined;
}

export interface ClassTypeResult {
    classType: ClassType;
    decoratedType: Type;
}

export interface FunctionTypeResult {
    functionType: FunctionType;
    decoratedType: Type;
}

export interface CallSignature {
    type: FunctionType;
    activeParam?: FunctionParam | undefined;
}

export interface CallSignatureInfo {
    signatures: CallSignature[];
    callNode: CallNode;
}

// Used to determine whether an abstract method has been
// overridden by a non-abstract method.
export interface AbstractSymbol {
    symbol: Symbol;
    symbolName: string;
    classType: Type;
    hasImplementation: boolean;
}

export interface ArgBase {
    argCategory: ArgCategory;
    node?: ArgumentNode | undefined;
    name?: NameNode | undefined;
    typeResult?: TypeResult | undefined;
    valueExpression?: ExpressionNode | undefined;
    active?: boolean | undefined;
}

export interface ArgWithType extends ArgBase {
    typeResult: TypeResult;
}

export interface ArgWithExpression extends ArgBase {
    valueExpression: ExpressionNode;
}

export type Arg = ArgWithType | ArgWithExpression;

export interface EffectiveTypeResult {
    type: Type;
    isIncomplete: boolean;
    includesVariableDecl?: boolean;
    includesIllegalTypeAliasDecl?: boolean;
    includesSpeculativeResult?: boolean;
    isRecursiveDefinition?: boolean;
    evaluationAttempts?: number;
}

export interface ValidateArgTypeParams {
    paramCategory: ParamCategory;
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: Arg;
    isDefaultArg?: boolean;
    argType?: Type | undefined;
    errorNode: ExpressionNode;
    paramName?: string | undefined;
    isParamNameSynthesized?: boolean;
    mapsToVarArgList?: boolean | undefined;
    isinstanceParam?: boolean;
}

export interface ExpectedTypeOptions {
    allowFinal?: boolean;
    allowRequired?: boolean;
    allowReadOnly?: boolean;
    allowUnpackedTuple?: boolean;
    allowUnpackedTypedDict?: boolean;
    allowParamSpec?: boolean;
    allowClassVar?: boolean;
    varTypeAnnotation?: boolean;
    typeVarGetsCurScope?: boolean;
    allowTypeVarsWithoutScopeId?: boolean;
    enforceClassTypeVarScope?: boolean;
    parsesStringLiteral?: boolean;
    notParsed?: boolean;
    noNonTypeSpecialForms?: boolean;
    typeFormArg?: boolean;
    forwardRefs?: boolean;
    typeExpression?: boolean;
    convertEllipsisToAny?: boolean;
    allowEllipsis?: boolean;
}

export interface ExpectedTypeResult {
    type: Type;
    node: ParseNode;
}

export interface FunctionResult {
    returnType: Type;
    argumentErrors: boolean;
    isTypeIncomplete: boolean;
}

export interface ArgResult {
    isCompatible: boolean;
    argType: Type;
    isTypeIncomplete?: boolean | undefined;
    condition?: TypeCondition[];
    skippedBareTypeVarExpectedType?: boolean;
}

export interface CallResult {
    // Specialized return type of call
    returnType?: Type | undefined;

    // Is return type incomplete?
    isTypeIncomplete?: boolean | undefined;

    // Were any errors discovered when evaluating argument types?
    argumentErrors?: boolean;

    // Did one or more arguments evaluated to Any or Unknown?
    anyOrUnknownArg?: UnknownType | AnyType;

    // The parameter associated with the "active" argument (used
    // for signature help provider)
    activeParam?: FunctionParam | undefined;

    // If the call is to an __init__ with an annotated self parameter,
    // this field indicates the specialized type of that self type; this
    // is used for overloaded constructors where the arguments to the
    // constructor influence the specialized type of the constructed object.
    specializedInitSelfType?: Type | undefined;

    // The overload or overloads used to satisfy the call. There can
    // be multiple overloads in the case where the call type is a union
    // or we have used union expansion for arguments.
    overloadsUsedForCall?: FunctionType[];

    // Types of individual arguments.
    argResults?: ArgResult[];
}

export interface ClassMemberLookup {
    symbol: Symbol | undefined;

    // Type of symbol.
    type: Type;
    isTypeIncomplete: boolean;

    // True if binding or descriptor access failed.
    isDescriptorError: boolean;

    // True if class member, false otherwise.
    isClassMember: boolean;

    // The class that declares the accessed member.
    classType?: ClassType | UnknownType | AnyType;

    // True if the member is explicitly declared as ClassVar
    // within a Protocol.
    isClassVar: boolean;

    // Is member a descriptor object that is asymmetric with respect
    // to __get__ and __set__ types?
    isAsymmetricAccessor: boolean;

    // For member access operations that are 'set', this is the narrowed
    // type when considering the declared type of the member.
    narrowedTypeForSet?: Type;

    // Deprecation messages related to magic methods invoked via the member access.
    memberAccessDeprecationInfo?: MemberAccessDeprecationInfo;
}

export interface SolveConstraintsOptions {
    useLowerBoundOnly?: boolean;
}

export enum Reachability {
    Reachable,
    UnreachableAlways,
    UnreachableByAnalysis,
}

export interface PrintTypeOptions {
    expandTypeAlias?: boolean;
    enforcePythonSyntax?: boolean;
    useFullyQualifiedNames?: boolean;
    useTypingUnpack?: boolean;
    printUnknownWithAny?: boolean;
    printTypeVarVariance?: boolean;
    omitTypeArgsIfUnknown?: boolean;
}

export interface DeclaredSymbolTypeInfo {
    type: Type | undefined;
    isTypeAlias?: boolean;
    exceedsMaxDecls?: boolean;
}

export interface ResolveAliasOptions {
    allowExternallyHiddenAccess?: boolean;
    skipFileNeededCheck?: boolean;
}

export interface ValidateTypeArgsOptions {
    allowEmptyTuple?: boolean;
    allowTypeVarTuple?: boolean;
    allowParamSpec?: boolean;
    allowTypeArgList?: boolean;
    allowUnpackedTuples?: boolean;
}

export interface MapSubtypesOptions {
    conditionFilter?: TypeCondition[] | undefined;
    sortSubtypes?: boolean;
    expandCallback?: (type: Type) => Type;
}

export interface CallSiteEvaluationInfo {
    errorNode: ExpressionNode;
    args: ValidateArgTypeParams[];
}

export interface SymbolDeclInfo {
    decls: Declaration[];
    synthesizedTypes: SynthesizedTypeInfo[];
}

export const enum AssignTypeFlags {
    Default = 0,

    // Require invariance with respect to class matching? Normally
    // subclasses are allowed.
    Invariant = 1 << 0,

    // The caller has swapped the source and dest types because
    // the types are contravariant. Perform type var matching
    // on dest type vars rather than source type var.
    Contravariant = 1 << 1,

    // We're comparing type compatibility of two distinct recursive types.
    // This has the potential of recursing infinitely. This flag allows us
    // to detect the recursion after the first level of checking.
    SkipRecursiveTypeCheck = 1 << 2,

    // During TypeVar solving for a function call, this flag is set if
    // this is the first of multiple passes. It adjusts certain heuristics
    // for constraint solving.
    ArgAssignmentFirstPass = 1 << 3,

    // If the dest is not Any but the src is Any, treat it
    // as incompatible. Also, treat all source TypeVars as their
    // concrete counterparts. This option is used for validating
    // whether overload signatures overlap.
    OverloadOverlap = 1 << 4,

    // When used in conjunction with OverloadOverlapCheck, look
    // for partial overlaps. For example, `int | list` overlaps
    // partially with `int | str`.
    PartialOverloadOverlap = 1 << 5,

    // For function types, skip the return type check.
    SkipReturnTypeCheck = 1 << 6,

    // In most cases, literals are stripped when assigning to a
    // type variable. This overrides the standard behavior.
    RetainLiteralsForTypeVar = 1 << 8,

    // When validating the type of a self or cls parameter, allow
    // a type mismatch. This is used in overload consistency validation
    // because overloads can provide explicit type annotations for self
    // or cls.
    SkipSelfClsTypeCheck = 1 << 9,

    // We're initially populating the constraints with an expected type,
    // so TypeVars should match the specified type exactly rather than
    // employing narrowing or widening. The variance context determines
    // whether the upper bound, lower bound, or both are established.
    PopulateExpectedType = 1 << 11,

    // Used with PopulatingExpectedType, this flag indicates that a TypeVar
    // constraint that is Unknown should be ignored.
    SkipPopulateUnknownExpectedType = 1 << 12,

    // Normally, when a class type is assigned to a TypeVar and that class
    // hasn't previously been specialized, it will be specialized with
    // default type arguments (typically "Unknown"). This flag skips
    // this step.
    AllowUnspecifiedTypeArgs = 1 << 13,

    // Normally all special form classes are incompatible with type[T],
    // but a few of them are allowed in the context of an isinstance
    // or issubclass call.
    AllowIsinstanceSpecialForms = 1 << 14,

    // When comparing two methods, skip the type check for the "self" or "cls"
    // parameters. This is used for variance inference and validation.
    SkipSelfClsParamCheck = 1 << 15,

    // Normally a protocol class object cannot be used as a source type. This
    // option overrides this behavior.
    AllowProtocolClassSource = 1 << 16,
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeResult: (node: ExpressionNode) => TypeResult | undefined;
    getTypeResultForDecorator: (node: DecoratorNode) => TypeResult | undefined;
    getCachedType: (node: ExpressionNode) => Type | undefined;
    getTypeOfExpression: (node: ExpressionNode, flags?: EvalFlags, context?: InferenceContext) => TypeResult;
    getTypeOfAnnotation: (node: ExpressionNode, options?: ExpectedTypeOptions) => Type;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    createSubclass: (errorNode: ExpressionNode, type1: ClassType, type2: ClassType) => ClassType;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    getTypeOfExpressionExpectingType: (node: ExpressionNode, options?: ExpectedTypeOptions) => TypeResult;
    evaluateTypeForSubnode: (subnode: ParseNode, callback: () => void) => TypeResult | undefined;
    evaluateTypesForStatement: (node: ParseNode) => void;
    evaluateTypesForMatchStatement: (node: MatchNode) => void;
    evaluateTypesForCaseStatement: (node: CaseNode) => void;
    evaluateTypeOfParam: (node: ParameterNode) => void;

    canBeTruthy: (type: Type) => boolean;
    canBeFalsy: (type: Type) => boolean;
    stripLiteralValue: (type: Type) => Type;
    removeTruthinessFromType: (type: Type) => Type;
    removeFalsinessFromType: (type: Type) => Type;
    stripTypeGuard: (type: Type) => Type;

    solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Type;

    getExpectedType: (node: ExpressionNode) => ExpectedTypeResult | undefined;
    verifyRaiseExceptionType: (node: ExpressionNode, allowNone: boolean) => void;
    verifyDeleteExpression: (node: ExpressionNode) => void;
    validateOverloadedArgTypes: (
        errorNode: ExpressionNode,
        argList: Arg[],
        typeResult: TypeResult<OverloadedType>,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean,
        inferenceContext: InferenceContext | undefined
    ) => CallResult;
    validateInitSubclassArgs: (node: ClassNode, classType: ClassType) => void;

    isNodeReachable: (node: ParseNode, sourceNode?: ParseNode | undefined) => boolean;
    isAfterNodeReachable: (node: ParseNode) => boolean;
    getNodeReachability: (node: ParseNode, sourceNode?: ParseNode | undefined) => Reachability;
    getAfterNodeReachability: (node: ParseNode) => Reachability;

    isAsymmetricAccessorAssignment: (node: ParseNode) => boolean;
    suppressDiagnostics: (node: ParseNode, callback: () => void) => void;
    isSpecialFormClass: (classType: ClassType, flags: AssignTypeFlags) => boolean;

    getDeclInfoForStringNode: (node: StringNode) => SymbolDeclInfo | undefined;
    getDeclInfoForNameNode: (node: NameNode, skipUnreachableCode?: boolean) => SymbolDeclInfo | undefined;
    getTypeForDeclaration: (declaration: Declaration) => DeclaredSymbolTypeInfo;
    resolveAliasDeclaration: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ) => Declaration | undefined;
    resolveAliasDeclarationWithInfo: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ) => ResolvedAliasInfo | undefined;
    getTypeOfIterable: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError?: boolean
    ) => TypeResult | undefined;
    getTypeOfIterator: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError?: boolean
    ) => TypeResult | undefined;
    getGetterTypeFromProperty: (propertyClass: ClassType) => Type | undefined;
    getTypeOfArg: (arg: Arg, inferenceContext: InferenceContext | undefined) => TypeResult;
    convertNodeToArg: (node: ArgumentNode) => ArgWithExpression;
    buildTupleTypesList: (entryTypeResults: TypeResult[], stripLiterals: boolean) => TupleTypeArg[];
    markNamesAccessed: (node: ParseNode, names: string[]) => void;
    expandPromotionTypes: (node: ParseNode, type: Type) => Type;
    makeTopLevelTypeVarsConcrete: (type: Type, makeParamSpecsConcrete?: boolean) => Type;
    mapSubtypesExpandTypeVars: (
        type: Type,
        options: MapSubtypesOptions | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type) => Type | undefined
    ) => Type;
    isTypeSubsumedByOtherType: (type: Type, otherType: Type, allowAnyToSubsume: boolean) => boolean;
    lookUpSymbolRecursive: (node: ParseNode, name: string, honorCodeFlow: boolean) => SymbolWithScope | undefined;
    getDeclaredTypeOfSymbol: (symbol: Symbol) => DeclaredSymbolTypeInfo;
    getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    getEffectiveTypeOfSymbolForUsage: (
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl?: boolean
    ) => EffectiveTypeResult;
    getInferredTypeOfDeclaration: (symbol: Symbol, decl: Declaration) => Type | undefined;
    getDeclaredTypeForExpression: (expression: ExpressionNode, usage?: EvaluatorUsage) => Type | undefined;
    getDeclaredReturnType: (node: FunctionNode) => Type | undefined;
    getInferredReturnType: (type: FunctionType, callSiteInfo?: CallSiteEvaluationInfo) => Type;
    getBestOverloadForArgs: (
        errorNode: ExpressionNode,
        typeResult: TypeResult<OverloadedType>,
        argList: Arg[]
    ) => FunctionType | undefined;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    getTypeOfBoundMember(
        errorNode: ExpressionNode,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        diag?: DiagnosticAddendum | undefined,
        flags?: MemberAccessFlags,
        selfType?: ClassType | TypeVarType
    ): TypeResult | undefined;
    getBoundMagicMethod: (
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        diag?: DiagnosticAddendum,
        recursionCount?: number
    ) => FunctionType | OverloadedType | undefined;
    getTypeOfMagicMethodCall: (
        objType: Type,
        methodName: string,
        argList: TypeResult[],
        errorNode: ExpressionNode,
        inferenceContext: InferenceContext | undefined
    ) => TypeResult | undefined;
    bindFunctionToClassOrObject: (
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedType,
        memberClass?: ClassType,
        treatConstructorAsClassMethod?: boolean,
        selfType?: ClassType | TypeVarType,
        diag?: DiagnosticAddendum,
        recursionCount?: number
    ) => FunctionType | OverloadedType | undefined;
    getCallbackProtocolType: (objType: ClassType, recursionCount?: number) => FunctionType | OverloadedType | undefined;
    getCallSignatureInfo: (node: CallNode, activeIndex: number, activeOrFake: boolean) => CallSignatureInfo | undefined;
    getAbstractSymbols: (classType: ClassType) => AbstractSymbol[];
    narrowConstrainedTypeVar: (node: ParseNode, typeVar: TypeVarType) => Type | undefined;

    assignType: (
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => boolean;
    validateOverrideMethod: (
        baseMethod: Type,
        overrideMethod: FunctionType | OverloadedType,
        baseClass: ClassType | undefined,
        diag: DiagnosticAddendum,
        enforceParamNames?: boolean
    ) => boolean;
    validateCallArgs: (
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined
    ) => CallResult;
    validateTypeArg: (argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions) => boolean;
    assignTypeToExpression: (target: ExpressionNode, typeResult: TypeResult, srcExpr: ExpressionNode) => void;
    assignClassToSelf: (destType: ClassType, srcType: ClassType, assumedVariance: Variance) => boolean;
    getBuiltInObject: (node: ParseNode, name: string, typeArgs?: Type[]) => Type;
    getTypedDictClassType: () => ClassType | undefined;
    getTupleClassType: () => ClassType | undefined;
    getDictClassType: () => ClassType | undefined;
    getStrClassType: () => ClassType | undefined;
    getObjectType: () => Type;
    getNoneType: () => Type;
    getUnionClassType(): Type;
    getTypeClassType(): ClassType | undefined;
    getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    inferReturnTypeIfNecessary: (type: Type) => void;
    inferVarianceForClass: (type: ClassType) => void;
    assignTypeArgs: (
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => boolean;
    reportMissingTypeArgs: (node: ExpressionNode, type: Type, flags: EvalFlags) => Type;

    isFinalVariable: (symbol: Symbol) => boolean;
    isFinalVariableDeclaration: (decl: Declaration) => boolean;
    isExplicitTypeAliasDeclaration: (decl: Declaration) => boolean;

    addInformation: (message: string, node: ParseNode, range?: TextRange) => Diagnostic | undefined;
    addUnusedCode: (node: ParseNode, textRange: TextRange) => void;
    addUnreachableCode: (node: ParseNode, reachability: Reachability, textRange: TextRange) => void;
    addDeprecated: (message: string, node: ParseNode) => void;

    addDiagnostic: (
        rule: DiagnosticRule,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) => Diagnostic | undefined;
    addDiagnosticForTextRange: (
        fileInfo: AnalyzerFileInfo,
        rule: DiagnosticRule,
        message: string,
        range: TextRange
    ) => Diagnostic | undefined;

    printType: (type: Type, options?: PrintTypeOptions) => string;
    printSrcDestTypes: (srcType: Type, destType: Type) => { sourceType: string; destType: string };
    printFunctionParts: (type: FunctionType, extraFlags?: PrintTypeFlags) => [string[], string];

    getTypeCacheEntryCount: () => number;
    disposeEvaluator: () => void;
    useSpeculativeMode: <T>(
        speculativeNode: ParseNode | undefined,
        callback: () => T,
        options?: SpeculativeModeOptions
    ) => T;
    isSpeculativeModeInUse: (node: ParseNode | undefined) => boolean;
    setTypeResultForNode: (node: ParseNode, typeResult: TypeResult, flags?: EvalFlags) => void;

    checkForCancellation: () => void;
    printControlFlowGraph: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) => void;
}
