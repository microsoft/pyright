/*
 * typeEvaluatorTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Abstract interface and other helper types for type evaluator module.
 *
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
import * as DeclarationUtils from './aliasDeclarationUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { CodeFlowReferenceExpressionNode, FlowNode } from './codeFlowTypes';
import { Declaration } from './declaration';
import { SymbolWithScope } from './scope';
import { Symbol } from './symbol';
import {
    ClassType,
    FunctionParameter,
    FunctionType,
    OverloadedFunctionType,
    Type,
    TypeCondition,
    TypeVarType,
    UnknownType,
} from './types';
import { AssignTypeFlags, ClassMember } from './typeUtils';
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
    FinalDisallowed = 1 << 4,

    // A ParamSpec isn't allowed in this context.
    ParamSpecDisallowed = 1 << 5,

    // Expression is expected to be a type (class) rather
    // than an instance (object)
    ExpectingType = 1 << 6,

    // A TypeVarTuple isn't allowed in this context.
    TypeVarTupleDisallowed = 1 << 7,

    // Interpret an ellipsis type annotation to mean "Unknown".
    ConvertEllipsisToUnknown = 1 << 8,

    // The Generic class type is allowed in this context. It is
    // normally not allowed if ExpectingType is set.
    AllowGenericClassType = 1 << 9,

    // A type annotation restricts the types of expressions that are
    // allowed. If this flag is set, illegal type expressions are
    // flagged as errors.
    ExpectingTypeAnnotation = 1 << 10,

    // TypeVars within this expression must not refer to type vars
    // used in an outer scope that.
    DisallowTypeVarsWithScopeId = 1 << 11,

    // TypeVars within this expression must refer to type vars
    // used in an outer scope that.
    DisallowTypeVarsWithoutScopeId = 1 << 12,

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

    // Emit an error if an incomplete recursive type alias is
    // used in this context.
    DisallowRecursiveTypeAliasPlaceholder = 1 << 16,

    // 'ClassVar' is not allowed in this context.
    ClassVarDisallowed = 1 << 17,

    // 'Generic' cannot be used without type arguments in this context.
    DisallowNakedGeneric = 1 << 18,

    // The node is not parsed by the interpreter because it is within
    // a comment or a string literal.
    NotParsedByInterpreter = 1 << 19,

    // Required and NotRequired are allowed in this context.
    RequiredAllowed = 1 << 20,

    // Allow Unpack annotation for a tuple or TypeVarTuple.
    AllowUnpackedTupleOrTypeVarTuple = 1 << 21,

    // Even though an expression is enclosed in a string literal,
    // the interpreter (within a source file, not a stub) still
    // parses the expression and generates parse errors.
    InterpreterParsesStringLiteral = 1 << 22,

    // Allow Unpack annotation for TypedDict.
    AllowUnpackedTypedDict = 1 << 23,
}

export interface TypeResult {
    type: Type;

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

    // Type consistency errors detected when evaluating this type.
    typeErrors?: boolean | undefined;

    // Used for getTypeOfObjectMember to indicate that class
    // that declares the member.
    classType?: ClassType | UnknownType;

    // Variadic type arguments allow the shorthand "()" to
    // represent an empty tuple (i.e. Tuple[()]).
    isEmptyTupleShorthand?: boolean | undefined;

    expectedTypeDiagAddendum?: DiagnosticAddendum | undefined;

    // Is member a descriptor object that is asymmetric with respect
    // to __get__ and __set__ types?
    isAsymmetricDescriptor?: boolean;

    // Is the type wrapped in a "Required" or "NotRequired" class?
    isRequired?: boolean;
    isNotRequired?: boolean;
}

export interface TypeResultWithNode extends TypeResult {
    node: ParseNode;
}

export interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: Type | undefined;
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
    expectingType?: boolean;
}

export interface AnnotationTypeOptions {
    isVariableAnnotation?: boolean;
    allowFinal?: boolean;
    allowClassVar?: boolean;
    associateTypeVarsWithScope?: boolean;
    allowTypeVarTuple?: boolean;
    allowParamSpec?: boolean;
    disallowRecursiveTypeAlias?: boolean;
    allowUnpackedTypedDict?: boolean;
    allowUnpackedTuple?: boolean;
    notParsedByInterpreter?: boolean;
}

export interface ExpectedTypeOptions {
    allowFinal?: boolean;
    allowRequired?: boolean;
    allowUnpackedTuple?: boolean;
    allowParamSpec?: boolean;
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

export interface CallResult {
    // Specialized return type of call
    returnType?: Type | undefined;

    // Is return type incomplete?
    isTypeIncomplete?: boolean | undefined;

    // Were any errors discovered when evaluating argument types?
    argumentErrors: boolean;

    // Did one or more arguments evaluated to Any or Unknown?
    isArgumentAnyOrUnknown?: boolean;

    // The parameter associated with the "active" argument (used
    // for signature help provider)
    activeParam?: FunctionParameter | undefined;

    // If the call is to an __init__ with an annotated self parameter,
    // this field indicates the specialized type of that self type; this
    // is used for overloaded constructors where the arguments to the
    // constructor influence the specialized type of the constructed object.
    specializedInitSelfType?: Type | undefined;
}

export interface PrintTypeOptions {
    expandTypeAlias?: boolean;
    enforcePythonSyntax?: boolean;
    useTypingUnpack?: boolean;
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeResult: (node: ExpressionNode) => TypeResult | undefined;
    getCachedType: (node: ExpressionNode) => Type | undefined;
    getTypeOfExpression: (node: ExpressionNode, flags?: EvaluatorFlags, expectedType?: Type) => TypeResult;
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
        type: OverloadedFunctionType,
        typeVarContext: TypeVarContext | undefined,
        skipUnknownArgCheck: boolean,
        expectedType: Type | undefined
    ) => CallResult;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode, sourceNode: ParseNode | undefined) => boolean;
    isAsymmetricDescriptorAssignment: (node: ParseNode) => boolean;
    suppressDiagnostics: (node: ParseNode, callback: () => void) => void;

    getDeclarationsForStringNode: (node: StringNode) => Declaration[] | undefined;
    getDeclarationsForNameNode: (node: NameNode, skipUnreachableCode?: boolean) => Declaration[] | undefined;
    getTypeForDeclaration: (declaration: Declaration) => Type | undefined;
    resolveAliasDeclaration: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        allowExternallyHiddenAccess?: boolean
    ) => Declaration | undefined;
    resolveAliasDeclarationWithInfo: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        allowExternallyHiddenAccess?: boolean
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
    getScopeIdForNode: (node: ParseNode) => string;
    makeTopLevelTypeVarsConcrete: (type: Type) => Type;
    mapSubtypesExpandTypeVars: (
        type: Type,
        conditionFilter: TypeCondition[] | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type) => Type | undefined
    ) => Type;
    lookUpSymbolRecursive: (node: ParseNode, name: string, honorCodeFlow: boolean) => SymbolWithScope | undefined;
    getDeclaredTypeOfSymbol: (symbol: Symbol) => Type | undefined;
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
        type: OverloadedFunctionType,
        argList: FunctionArgument[]
    ) => FunctionType | undefined;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    getTypeOfObjectMember(errorNode: ExpressionNode, objectType: ClassType, memberName: string): TypeResult | undefined;
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
        expectedType: Type | undefined
    ) => Type | undefined;
    bindFunctionToClassOrObject: (
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedFunctionType,
        memberClass?: ClassType,
        errorNode?: ParseNode,
        recursionCount?: number,
        treatConstructorAsClassMember?: boolean,
        firstParamType?: ClassType | TypeVarType
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
        diag: DiagnosticAddendum,
        enforceParamNames?: boolean
    ) => boolean;
    validateInitSubclassArgs: (node: ClassNode, classType: ClassType, argList: FunctionArgument[]) => void;
    assignTypeToExpression: (
        target: ExpressionNode,
        type: Type,
        isTypeIncomplete: boolean,
        srcExpr: ExpressionNode
    ) => void;
    assignClassToSelf: (destType: ClassType, srcType: ClassType) => boolean;
    getBuiltInObject: (node: ParseNode, name: string, typeArguments?: Type[]) => Type;
    getTypedDictClassType: () => Type | undefined;
    getTupleClassType: () => Type | undefined;
    getObjectType: () => Type | undefined;
    getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    inferReturnTypeIfNecessary: (type: Type) => void;
    inferTypeParameterVarianceForClass: (type: ClassType) => void;
    verifyTypeArgumentsAssignable: (
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        destTypeVarContext: TypeVarContext | undefined,
        srcTypeVarContext: TypeVarContext | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => boolean;
    addError: (message: string, node: ParseNode) => Diagnostic | undefined;
    addWarning: (message: string, node: ParseNode) => Diagnostic | undefined;
    addInformation: (message: string, node: ParseNode) => Diagnostic | undefined;
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
    printFunctionParts: (type: FunctionType) => [string[], string];

    getTypeCacheEntryCount: () => number;
    disposeEvaluator: () => void;
    useSpeculativeMode: <T>(speculativeNode: ParseNode, callback: () => T) => T;
    setTypeForNode: (node: ParseNode, type?: Type, flags?: EvaluatorFlags) => void;

    checkForCancellation: () => void;
    printControlFlowGraph: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) => void;
}
