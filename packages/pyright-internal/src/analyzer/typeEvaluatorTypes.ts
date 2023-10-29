/*
 * typeEvaluatorTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Abstract interface and other helper types for type evaluator module.
 */

import { CancellationToken } from 'vscode-languageserver-protocol';

import { DiagnosticLevel } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { TextRange } from '../common/textRange';
import {
    ArgumentCategory,
    ArgumentNode,
    CallNode,
    CaseNode,
    ClassNode,
    DecoratorNode,
    ExpressionNode,
    FunctionNode,
    MatchNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    RaiseNode,
    StringNode,
} from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { CodeFlowReferenceExpressionNode, FlowNode } from './codeFlowTypes';
import { Declaration } from './declaration';
import * as DeclarationUtils from './declarationUtils';
import { SymbolWithScope } from './scope';
import { Symbol } from './symbol';
import { PrintTypeFlags } from './typePrinter';
import {
    AnyType,
    ClassType,
    FunctionParameter,
    FunctionType,
    OverloadedFunctionType,
    Type,
    TypeCondition,
    TypeVarType,
    UnknownType,
} from './types';
import { AssignTypeFlags, ClassMember, InferenceContext } from './typeUtils';
import { TypeVarContext } from './typeVarContext';

// Maximum number of unioned subtypes for an inferred type (e.g.
// a list) before the type is considered an "Any".
export const maxSubtypesForInferredType = 64;

export const enum EvaluatorFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1 << 0,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 1 << 1,

    // Allow forward references. Don't report unbound errors.
    AllowForwardReferences = 1 << 2,

    // Treat string literal as a type.
    EvaluateStringLiteralAsType = 1 << 3,

    // 'Final' is not allowed in this context.
    DisallowFinal = 1 << 4,

    // A ParamSpec isn't allowed in this context.
    DisallowParamSpec = 1 << 5,

    // A TypeVarTuple isn't allowed in this context.
    DisallowTypeVarTuple = 1 << 6,

    // Expression is expected to be an instantiable type rather
    // than an instance (object)
    ExpectingInstantiableType = 1 << 7,

    // A type annotation restricts the types of expressions that are
    // allowed. If this flag is set, illegal type expressions are
    // flagged as errors.
    ExpectingTypeAnnotation = 1 << 8,

    // Suppress the reportMissingTypeArgument diagnostic in this context.
    AllowMissingTypeArgs = 1 << 9,

    // The Generic class type is allowed in this context. It is
    // normally not allowed if ExpectingType is set.
    AllowGenericClassType = 1 << 10,

    // TypeVars within this expression must not refer to type vars
    // used in an outer scope.
    DisallowTypeVarsWithScopeId = 1 << 11,

    // TypeVars within this expression do not need to refer to type vars
    // used in an outer scope.
    AllowTypeVarsWithoutScopeId = 1 << 12,

    // TypeVars within this expression that are otherwise not
    // associated with an outer scope should be associated with
    // the containing function's scope.
    AssociateTypeVarsWithCurrentScope = 1 << 13,

    // When a new class-scoped TypeVar is used within a class
    // declaration, make sure that it is not used to parameterize
    // a base class whose TypeVar variance is inconsistent.
    EnforceTypeVarVarianceConsistency = 1 << 14,

    // Used for PEP 526-style variable type annotations
    VariableTypeAnnotation = 1 << 15,

    // 'ClassVar' is not allowed in this context.
    DisallowClassVar = 1 << 17,

    // 'Generic' cannot be used without type arguments in this context.
    DisallowNakedGeneric = 1 << 18,

    // The node is not parsed by the interpreter because it is within
    // a comment or a string literal.
    NotParsedByInterpreter = 1 << 19,

    // Required and NotRequired are allowed in this context.
    AllowRequired = 1 << 20,

    // Allow Unpack annotation for a tuple or TypeVarTuple.
    AllowUnpackedTupleOrTypeVarTuple = 1 << 21,

    // Even though an expression is enclosed in a string literal,
    // the interpreter (within a source file, not a stub) still
    // parses the expression and generates parse errors.
    InterpreterParsesStringLiteral = 1 << 22,

    // Allow Unpack annotation for TypedDict.
    AllowUnpackedTypedDict = 1 << 23,

    // Disallow a type alias defined with a "type" statement.
    DisallowPep695TypeAlias = 1 << 24,

    // If evaluation is a TypeVarType that is a ParamSpec, do
    // not convert it to its corresponding ParamSpec runtime object.
    SkipConvertParamSpecToRuntimeObject = 1 << 25,

    // Defaults used for evaluating the LHS of a call expression.
    CallBaseDefaults = DoNotSpecialize | DisallowPep695TypeAlias,

    // Defaults used for evaluating the LHS of a member access expression.
    IndexBaseDefaults = DoNotSpecialize,

    // Defaults used for evaluating the LHS of a member access expression.
    MemberAccessBaseDefaults = DoNotSpecialize | DisallowPep695TypeAlias,
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
    bindToType?: ClassType | TypeVarType | undefined;

    unpackedType?: Type | undefined;
    typeList?: TypeResultWithNode[] | undefined;

    // For inlined TypedDict definitions.
    inlinedTypeDict?: ClassType;

    // Type consistency errors detected when evaluating this type.
    typeErrors?: boolean | undefined;

    // Used for getTypeOfObjectMember to indicate that class
    // that declares the member.
    classType?: ClassType | UnknownType | AnyType;

    // Variadic type arguments allow the shorthand "()" to
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

    // Is the type wrapped in a "Required", "NotRequired" or "ReadOnly" class?
    isRequired?: boolean;
    isNotRequired?: boolean;
    isReadOnly?: boolean;

    // If a call expression, which overloads were used to satisfy it?
    overloadsUsedForCall?: FunctionType[];

    // For member access expressions, deprecation messages related to
    // magic methods invoked via the member access
    memberAccessDeprecationInfo?: MemberAccessDeprecationInfo;
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
    deprecationMessage: string;
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
    activeParam?: FunctionParameter | undefined;
}

export interface CallSignatureInfo {
    signatures: CallSignature[];
    callNode: CallNode;
}

// Used to determine whether an abstract method has been
// overridden by a non-abstract method.
export interface AbstractMethod {
    symbol: Symbol;
    symbolName: string;
    classType: Type;
}

export interface FunctionArgumentBase {
    argumentCategory: ArgumentCategory;
    node?: ArgumentNode | undefined;
    name?: NameNode | undefined;
    typeResult?: TypeResult | undefined;
    valueExpression?: ExpressionNode | undefined;
    active?: boolean | undefined;
}

export interface FunctionArgumentWithType extends FunctionArgumentBase {
    typeResult: TypeResult;
}

export interface FunctionArgumentWithExpression extends FunctionArgumentBase {
    valueExpression: ExpressionNode;
}

export type FunctionArgument = FunctionArgumentWithType | FunctionArgumentWithExpression;

export interface EffectiveTypeResult {
    type: Type;
    isIncomplete: boolean;
    includesVariableDecl: boolean;
    includesIllegalTypeAliasDecl: boolean;
    includesSpeculativeResult: boolean;
    isRecursiveDefinition: boolean;
    evaluationAttempts?: number;
}

export interface ValidateArgTypeParams {
    paramCategory: ParameterCategory;
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: FunctionArgument;
    argType?: Type | undefined;
    errorNode: ExpressionNode;
    paramName?: string | undefined;
    isParamNameSynthesized?: boolean;
    mapsToVarArgList?: boolean | undefined;
    isinstanceParam?: boolean;
}

export interface AnnotationTypeOptions {
    isVariableAnnotation?: boolean;
    allowFinal?: boolean;
    allowClassVar?: boolean;
    associateTypeVarsWithScope?: boolean;
    allowTypeVarTuple?: boolean;
    allowParamSpec?: boolean;
    allowRequired?: boolean;
    allowUnpackedTypedDict?: boolean;
    allowUnpackedTuple?: boolean;
    notParsedByInterpreter?: boolean;
}

export interface ExpectedTypeOptions {
    allowFinal?: boolean;
    allowRequired?: boolean;
    allowUnpackedTuple?: boolean;
    allowParamSpec?: boolean;
    allowForwardReference?: boolean;
    allowTypeVarsWithoutScopeId?: boolean;
    enforceTypeAnnotationRules?: boolean;
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
    skippedOverloadArg?: boolean;
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
    anyOrUnknownArgument?: UnknownType | AnyType;

    // The parameter associated with the "active" argument (used
    // for signature help provider)
    activeParam?: FunctionParameter | undefined;

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

    // True if access violates the type (used only for 'set' usage).
    isSetTypeError: boolean;

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

    // Deprecation messages related to magic methods invoked via the member access.
    memberAccessDeprecationInfo?: MemberAccessDeprecationInfo;
}

export interface PrintTypeOptions {
    expandTypeAlias?: boolean;
    enforcePythonSyntax?: boolean;
    useFullyQualifiedNames?: boolean;
    useTypingUnpack?: boolean;
    printUnknownWithAny?: boolean;
    printTypeVarVariance?: boolean;
    omitTypeArgumentsIfUnknown?: boolean;
}

export interface DeclaredSymbolTypeInfo {
    type: Type | undefined;
    isTypeAlias?: boolean;
}

export interface ResolveAliasOptions {
    allowExternallyHiddenAccess?: boolean;
    skipFileNeededCheck?: boolean;
}

export const enum MemberAccessFlags {
    None = 0,

    // By default, member accesses are assumed to access the attributes
    // of a class instance. By setting this flag, only attributes of
    // the class are considered.
    AccessClassMembersOnly = 1 << 0,

    // Consider only instance members, not members that could be
    // class members.
    AccessInstanceMembersOnly = 1 << 1,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 1 << 2,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 1 << 3,

    // Consider writes to symbols flagged as ClassVars as an error.
    DisallowClassVarWrites = 1 << 4,

    // Normally __new__ is treated as a static method, but when
    // it is invoked implicitly through a constructor call, it
    // acts like a class method instead.
    TreatConstructorAsClassMethod = 1 << 5,

    // By default, class member lookups start with the class itself
    // and fall back on the metaclass if it's not found. This option
    // skips the first check.
    ConsiderMetaclassOnly = 1 << 6,

    // If an attribute cannot be found when looking for instance
    // members, normally an attribute access override method
    // (__getattr__, etc.) may provide the missing attribute type.
    // This disables this check.
    SkipAttributeAccessOverride = 1 << 7,

    // Do not include the class itself, only base classes.
    SkipOriginalClass = 1 << 8,

    // Do not include the "type" base class in the search.
    SkipTypeBaseClass = 1 << 9,
}

export interface ValidateTypeArgsOptions {
    allowEmptyTuple?: boolean;
    allowVariadicTypeVar?: boolean;
    allowParamSpec?: boolean;
    allowTypeArgList?: boolean;
    allowUnpackedTuples?: boolean;
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeResult: (node: ExpressionNode) => TypeResult | undefined;
    getTypeResultForDecorator: (node: DecoratorNode) => TypeResult | undefined;
    getCachedType: (node: ExpressionNode) => Type | undefined;
    getTypeOfExpression: (node: ExpressionNode, flags?: EvaluatorFlags, context?: InferenceContext) => TypeResult;
    getTypeOfAnnotation: (node: ExpressionNode, options?: AnnotationTypeOptions) => Type;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    getTypeOfExpressionExpectingType: (node: ExpressionNode, options?: ExpectedTypeOptions) => TypeResult;
    evaluateTypeForSubnode: (subnode: ParseNode, callback: () => void) => TypeResult | undefined;
    evaluateTypesForStatement: (node: ParseNode) => void;
    evaluateTypesForMatchStatement: (node: MatchNode) => void;
    evaluateTypesForCaseStatement: (node: CaseNode) => void;
    evaluateTypeOfParameter: (node: ParameterNode) => void;

    canBeTruthy: (type: Type) => boolean;
    canBeFalsy: (type: Type) => boolean;
    stripLiteralValue: (type: Type) => Type;
    removeTruthinessFromType: (type: Type) => Type;
    removeFalsinessFromType: (type: Type) => Type;

    getExpectedType: (node: ExpressionNode) => ExpectedTypeResult | undefined;
    verifyRaiseExceptionType: (node: RaiseNode) => void;
    verifyDeleteExpression: (node: ExpressionNode) => void;
    validateOverloadedFunctionArguments: (
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        typeResult: TypeResult<OverloadedFunctionType>,
        typeVarContext: TypeVarContext | undefined,
        skipUnknownArgCheck: boolean,
        inferenceContext: InferenceContext | undefined
    ) => CallResult;
    validateInitSubclassArgs: (node: ClassNode, classType: ClassType) => void;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode, sourceNode?: ParseNode | undefined) => boolean;
    isAsymmetricAccessorAssignment: (node: ParseNode) => boolean;
    suppressDiagnostics: (node: ParseNode, callback: () => void) => void;

    getDeclarationsForStringNode: (node: StringNode) => Declaration[] | undefined;
    getDeclarationsForNameNode: (node: NameNode, skipUnreachableCode?: boolean) => Declaration[] | undefined;
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
    ) => DeclarationUtils.ResolvedAliasInfo | undefined;
    getTypeOfIterable: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode | undefined
    ) => TypeResult | undefined;
    getTypeOfIterator: (
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode | undefined
    ) => TypeResult | undefined;
    getGetterTypeFromProperty: (propertyClass: ClassType, inferTypeIfNeeded: boolean) => Type | undefined;
    getTypeOfArgument: (arg: FunctionArgument) => TypeResult;
    markNamesAccessed: (node: ParseNode, names: string[]) => void;
    expandPromotionTypes: (node: ParseNode, type: Type) => Type;
    makeTopLevelTypeVarsConcrete: (type: Type, makeParamSpecsConcrete?: boolean) => Type;
    mapSubtypesExpandTypeVars: (
        type: Type,
        conditionFilter: TypeCondition[] | undefined,
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
    getFunctionDeclaredReturnType: (node: FunctionNode) => Type | undefined;
    getFunctionInferredReturnType: (type: FunctionType, args?: ValidateArgTypeParams[]) => Type;
    getBestOverloadForArguments: (
        errorNode: ExpressionNode,
        typeResult: TypeResult<OverloadedFunctionType>,
        argList: FunctionArgument[]
    ) => FunctionType | undefined;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    getTypeOfObjectMember(
        errorNode: ExpressionNode,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        diag?: DiagnosticAddendum | undefined,
        memberAccessFlags?: MemberAccessFlags,
        bindToType?: ClassType | TypeVarType
    ): TypeResult | undefined;
    getTypeOfClassMemberName: (
        errorNode: ExpressionNode,
        classType: ClassType,
        isAccessedThroughObject: boolean,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum | undefined,
        flags: MemberAccessFlags,
        bindToType?: ClassType | TypeVarType
    ) => ClassMemberLookup | undefined;
    getBoundMethod: (
        classType: ClassType,
        memberName: string,
        recursionCount?: number,
        treatConstructorAsClassMember?: boolean
    ) => FunctionType | OverloadedFunctionType | undefined;
    getTypeOfMagicMethodReturn: (
        objType: Type,
        args: TypeResult[],
        magicMethodName: string,
        errorNode: ExpressionNode,
        inferenceContext: InferenceContext | undefined
    ) => Type | undefined;
    bindFunctionToClassOrObject: (
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedFunctionType,
        memberClass?: ClassType,
        treatConstructorAsClassMember?: boolean,
        firstParamType?: ClassType | TypeVarType,
        diag?: DiagnosticAddendum,
        recursionCount?: number
    ) => FunctionType | OverloadedFunctionType | undefined;
    getCallSignatureInfo: (node: CallNode, activeIndex: number, activeOrFake: boolean) => CallSignatureInfo | undefined;
    getAbstractMethods: (classType: ClassType) => AbstractMethod[];
    narrowConstrainedTypeVar: (node: ParseNode, typeVar: TypeVarType) => Type | undefined;

    assignType: (
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        destTypeVarContext?: TypeVarContext,
        srcTypeVarContext?: TypeVarContext,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => boolean;
    validateOverrideMethod: (
        baseMethod: Type,
        overrideMethod: FunctionType | OverloadedFunctionType,
        baseClass: ClassType | undefined,
        diag: DiagnosticAddendum,
        enforceParamNames?: boolean
    ) => boolean;
    validateCallArguments: (
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callTypeResult: TypeResult,
        typeVarContext?: TypeVarContext,
        skipUnknownArgCheck?: boolean,
        inferenceContext?: InferenceContext
    ) => CallResult;
    validateTypeArg: (argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions) => boolean;
    assignTypeToExpression: (
        target: ExpressionNode,
        type: Type,
        isTypeIncomplete: boolean,
        srcExpr: ExpressionNode
    ) => void;
    assignClassToSelf: (destType: ClassType, srcType: ClassType) => boolean;
    getBuiltInObject: (node: ParseNode, name: string, typeArguments?: Type[]) => Type;
    getTypedDictClassType: () => ClassType | undefined;
    getTupleClassType: () => ClassType | undefined;
    getObjectType: () => Type;
    getNoneType: () => Type;
    getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    inferReturnTypeIfNecessary: (type: Type) => void;
    inferTypeParameterVarianceForClass: (type: ClassType) => void;
    assignTypeArguments: (
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        destTypeVarContext: TypeVarContext | undefined,
        srcTypeVarContext: TypeVarContext | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => boolean;
    reportMissingTypeArguments: (node: ExpressionNode, type: Type, flags: EvaluatorFlags) => Type;

    isFinalVariable: (symbol: Symbol) => boolean;
    isFinalVariableDeclaration: (decl: Declaration) => boolean;
    isExplicitTypeAliasDeclaration: (decl: Declaration) => boolean;

    addError: (message: string, node: ParseNode, range?: TextRange) => Diagnostic | undefined;
    addWarning: (message: string, node: ParseNode, range?: TextRange) => Diagnostic | undefined;
    addInformation: (message: string, node: ParseNode, range?: TextRange) => Diagnostic | undefined;
    addUnusedCode: (node: ParseNode, textRange: TextRange) => void;
    addUnreachableCode: (node: ParseNode, textRange: TextRange) => void;
    addDeprecated: (message: string, node: ParseNode) => void;

    addDiagnostic: (
        diagLevel: DiagnosticLevel,
        rule: string,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) => Diagnostic | undefined;
    addDiagnosticForTextRange: (
        fileInfo: AnalyzerFileInfo,
        diagLevel: DiagnosticLevel,
        rule: string,
        message: string,
        range: TextRange
    ) => Diagnostic | undefined;

    printType: (type: Type, options?: PrintTypeOptions) => string;
    printSrcDestTypes: (srcType: Type, destType: Type) => { sourceType: string; destType: string };
    printFunctionParts: (type: FunctionType, extraFlags?: PrintTypeFlags) => [string[], string];

    getTypeCacheEntryCount: () => number;
    disposeEvaluator: () => void;
    useSpeculativeMode: <T>(speculativeNode: ParseNode | undefined, callback: () => T) => T;
    isSpeculativeModeInUse: (node: ParseNode | undefined) => boolean;
    setTypeResultForNode: (node: ParseNode, typeResult: TypeResult, flags?: EvaluatorFlags) => void;

    checkForCancellation: () => void;
    printControlFlowGraph: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) => void;
    printTypeVarContext: (typeVarContext: TypeVarContext) => void;
}
