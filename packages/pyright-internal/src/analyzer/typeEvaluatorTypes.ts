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
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { TextRange } from '../common/textRange';
import {
    ArgumentCategory,
    ArgumentNode,
    CallNode,
    ClassNode,
    ExpressionNode,
    FunctionNode,
    NameNode,
    ParameterCategory,
    ParseNode,
    RaiseNode,
} from '../parser/parseNodes';
import * as DeclarationUtils from './aliasDeclarationUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { Declaration } from './declaration';
import { Symbol } from './symbol';
import {
    ClassType,
    FunctionParameter,
    FunctionType,
    OverloadedFunctionType,
    Type,
    TypeCondition,
    TypeVarType,
} from './types';
import { CanAssignFlags, ClassMember } from './typeUtils';
import { TypeVarMap } from './typeVarMap';

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
    GenericClassTypeAllowed = 1 << 9,

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

    // Do not emit an error if the symbol is potentially unbound
    SkipUnboundCheck = 1 << 14,

    // Used for PEP 526-style variable type annotations
    VariableTypeAnnotation = 1 << 15,

    // Emit an error if an incomplete recursive type alias is
    // used in this context.
    DisallowRecursiveTypeAliasPlaceholder = 1 << 16,

    // 'ClassVar' is not allowed in this context.
    ClassVarDisallowed = 1 << 17,
}

export interface TypeResult {
    type: Type;
    node: ParseNode;

    // Type consistency errors detected when evaluating this type.
    typeErrors?: boolean | undefined;

    // Variadic type arguments allow the shorthand "()" to
    // represent an empty tuple (i.e. Tuple[()]).
    isEmptyTupleShorthand?: boolean | undefined;

    // Is the type incomplete (i.e. not fully evaluated) because
    // some of the paths involve cyclical dependencies?
    isIncomplete?: boolean | undefined;

    unpackedType?: Type | undefined;
    typeList?: TypeResult[] | undefined;
    expectedTypeDiagAddendum?: DiagnosticAddendum | undefined;

    // Used for the output of "super" calls used on the LHS of
    // a member access. Normally the type of the LHS is the same
    // as the class or object used to bind the member, but the
    // "super" call can specify a different class or object to
    // bind.
    bindToType?: ClassType | TypeVarType | undefined;
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
    isAbstract: boolean;
}

export interface FunctionArgumentBase {
    argumentCategory: ArgumentCategory;
    node?: ArgumentNode | undefined;
    name?: NameNode | undefined;
    type?: Type | undefined;
    valueExpression?: ExpressionNode | undefined;
    active?: boolean | undefined;
}

export interface FunctionArgumentWithType extends FunctionArgumentBase {
    type: Type;
}

export interface FunctionArgumentWithExpression extends FunctionArgumentBase {
    valueExpression: ExpressionNode;
}

export type FunctionArgument = FunctionArgumentWithType | FunctionArgumentWithExpression;

export interface EffectiveTypeResult {
    type: Type;
    isIncomplete: boolean;
    includesVariableDecl: boolean;
    isRecursiveDefinition: boolean;
}

export interface ValidateArgTypeParams {
    paramCategory: ParameterCategory;
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: FunctionArgument;
    argType?: Type | undefined;
    errorNode: ExpressionNode;
    paramName?: string | undefined;
    mapsToVarArgList?: boolean | undefined;
}

export interface AnnotationTypeOptions {
    isVariableAnnotation?: boolean;
    allowFinal?: boolean;
    allowClassVar?: boolean;
    associateTypeVarsWithScope?: boolean;
    allowTypeVarTuple?: boolean;
    disallowRecursiveTypeAlias?: boolean;
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeOfExpression: (node: ExpressionNode, expectedType?: Type, flags?: EvaluatorFlags) => TypeResult;
    getTypeOfAnnotation: (node: ExpressionNode, options?: AnnotationTypeOptions) => Type;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    getTypeForExpressionExpectingType: (node: ExpressionNode, allowFinal: boolean) => Type;
    evaluateTypesForStatement: (node: ParseNode) => void;

    getDeclaredTypeForExpression: (expression: ExpressionNode) => Type | undefined;
    verifyRaiseExceptionType: (node: RaiseNode) => void;
    verifyDeleteExpression: (node: ExpressionNode) => void;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode) => boolean;
    suppressDiagnostics: (node: ParseNode, callback: () => void) => void;

    getDeclarationsForNameNode: (node: NameNode) => Declaration[] | undefined;
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
    getTypeFromIterable: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
    getTypeFromIterator: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
    getGetterTypeFromProperty: (propertyClass: ClassType, inferTypeIfNeeded: boolean) => Type | undefined;
    markNamesAccessed: (node: ParseNode, names: string[]) => void;
    getScopeIdForNode: (node: ParseNode) => string;
    makeTopLevelTypeVarsConcrete: (type: Type) => Type;
    mapSubtypesExpandTypeVars: (
        type: Type,
        conditionFilter: TypeCondition[] | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type) => Type | undefined
    ) => Type;
    getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    getEffectiveTypeOfSymbolForUsage: (
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl?: boolean
    ) => EffectiveTypeResult;
    getFunctionDeclaredReturnType: (node: FunctionNode) => Type | undefined;
    getFunctionInferredReturnType: (type: FunctionType, args?: ValidateArgTypeParams[]) => Type;
    getBestOverloadForArguments: (
        errorNode: ExpressionNode,
        type: OverloadedFunctionType,
        argList: FunctionArgument[]
    ) => FunctionType | undefined;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    getTypeFromObjectMember(
        errorNode: ExpressionNode,
        objectType: ClassType,
        memberName: string
    ): TypeResult | undefined;
    getBoundMethod: (
        classType: ClassType,
        memberName: string,
        treatConstructorAsClassMember?: boolean
    ) => FunctionType | OverloadedFunctionType | undefined;
    getTypeFromMagicMethodReturn: (
        objType: Type,
        args: Type[],
        magicMethodName: string,
        errorNode: ExpressionNode,
        expectedType: Type | undefined
    ) => Type | undefined;
    bindFunctionToClassOrObject: (
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedFunctionType
    ) => FunctionType | OverloadedFunctionType | undefined;
    getCallSignatureInfo: (node: CallNode, activeIndex: number, activeOrFake: boolean) => CallSignatureInfo | undefined;
    getTypeAnnotationForParameter: (node: FunctionNode, paramIndex: number) => ExpressionNode | undefined;
    getAbstractMethods: (classType: ClassType) => AbstractMethod[];

    canAssignType: (
        destType: Type,
        srcType: Type,
        diag: DiagnosticAddendum,
        typeVarMap?: TypeVarMap,
        flags?: CanAssignFlags
    ) => boolean;
    canOverrideMethod: (
        baseMethod: Type,
        overrideMethod: FunctionType,
        diag: DiagnosticAddendum,
        enforceParamNames?: boolean
    ) => boolean;
    canAssignProtocolClassToSelf: (destType: ClassType, srcType: ClassType) => boolean;
    assignTypeToExpression: (
        target: ExpressionNode,
        type: Type,
        isTypeIncomplete: boolean,
        srcExpr: ExpressionNode
    ) => void;
    getBuiltInObject: (node: ParseNode, name: string, typeArguments?: Type[]) => Type;
    getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;

    addError: (message: string, node: ParseNode) => Diagnostic | undefined;
    addWarning: (message: string, node: ParseNode) => Diagnostic | undefined;
    addInformation: (message: string, node: ParseNode) => Diagnostic | undefined;
    addUnusedCode: (node: ParseNode, textRange: TextRange) => void;

    addDiagnostic: (
        diagLevel: DiagnosticLevel,
        rule: string,
        message: string,
        node: ParseNode
    ) => Diagnostic | undefined;
    addDiagnosticForTextRange: (
        fileInfo: AnalyzerFileInfo,
        diagLevel: DiagnosticLevel,
        rule: string,
        message: string,
        range: TextRange
    ) => Diagnostic | undefined;

    printType: (type: Type, expandTypeAlias?: boolean) => string;
    printFunctionParts: (type: FunctionType) => [string[], string];

    getTypeCacheSize: () => number;
    useSpeculativeMode: <T>(speculativeNode: ParseNode, callback: () => T) => T;
}
