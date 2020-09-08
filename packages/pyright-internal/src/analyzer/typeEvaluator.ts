/*
 * typeEvaluator.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module that evaluates types of parse tree nodes within
 * a program.
 *
 * Note: This is a gargantuan module - much larger than I would
 * normally create. It is written this way primarily for performance,
 * with the internal methods having access to the full closure of
 * the createTypeEvaluator function. This is the same approach
 * taken by the TypeScript compiler.
 */

import { CancellationToken } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { DiagnosticLevel } from '../common/configOptions';
import { assert, fail } from '../common/debug';
import { AddMissingOptionalToParamAction, Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { getEmptyRange, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    AssignmentNode,
    AugmentedAssignmentNode,
    BinaryOperationNode,
    CallNode,
    ClassNode,
    ConstantNode,
    DecoratorNode,
    DictionaryNode,
    ExceptNode,
    ExpressionNode,
    ForNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    IndexItemsNode,
    IndexNode,
    isExpressionNode,
    LambdaNode,
    ListComprehensionNode,
    ListNode,
    MemberAccessNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    RaiseNode,
    SetNode,
    SliceNode,
    StringListNode,
    TernaryNode,
    TupleNode,
    TypeAnnotationNode,
    UnaryOperationNode,
    WithItemNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';
import { ParseOptions, Parser } from '../parser/parser';
import { KeywordType, OperatorType, StringTokenFlags, Token, TokenType } from '../parser/tokenizerTypes';
import * as DeclarationUtils from './aliasDeclarationUtils';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import {
    createKeyForReference,
    FlowAssignment,
    FlowAssignmentAlias,
    FlowCall,
    FlowCondition,
    FlowFlags,
    FlowLabel,
    FlowNode,
    FlowPostFinally,
    FlowPreFinallyGate,
    FlowWildcardImport,
    isCodeFlowSupportedForReference,
} from './codeFlow';
import {
    AliasDeclaration,
    ClassDeclaration,
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    ModuleLoaderActions,
    VariableDeclaration,
} from './declaration';
import { isExplicitTypeAliasDeclaration, isPossibleTypeAliasDeclaration } from './declarationUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName } from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable } from './symbolUtils';
import {
    CachedType,
    IncompleteType,
    IncompleteTypeTracker,
    isIncompleteType,
    SpeculativeTypeTracker,
    TypeCache,
} from './typeCache';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    DataClassEntry,
    EnumLiteral,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    isAnyOrUnknown,
    isClass,
    isModule,
    isNever,
    isNone,
    isObject,
    isPossiblyUnbound,
    isSameWithoutLiteralValue,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnionableType,
    isUnknown,
    LiteralValue,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    ObjectType,
    OverloadedFunctionType,
    ParamSpecEntry,
    removeNoneFromUnion,
    removeUnboundFromUnion,
    Type,
    TypeBase,
    TypeCategory,
    TypedDictEntry,
    TypeSourceId,
    TypeVarType,
    UnboundType,
    UnknownType,
} from './types';
import {
    addTypeVarsToListIfUnique,
    areTypesSame,
    buildTypeVarMapFromSpecializedClass,
    CanAssignFlags,
    canBeFalsy,
    canBeTruthy,
    ClassMember,
    ClassMemberLookupFlags,
    computeMroLinearization,
    convertToInstance,
    convertToInstantiable,
    derivesFromClassRecursive,
    doForSubtypes,
    enumerateLiteralsForType,
    getConcreteTypeFromTypeVar,
    getDeclaredGeneratorReturnType,
    getDeclaredGeneratorSendType,
    getSpecializedTupleType,
    getTypeVarArgumentsRecursive,
    isEllipsisType,
    isLiteralType,
    isNoReturnType,
    isOptionalType,
    isParamSpecType,
    isPartlyUnknown,
    isProperty,
    isTypeAliasRecursive,
    lookUpClassMember,
    lookUpObjectMember,
    makeTypeVarsConcrete,
    partiallySpecializeType,
    printLiteralType,
    printLiteralValue,
    removeFalsinessFromType,
    removeTruthinessFromType,
    requiresSpecialization,
    requiresTypeArguments,
    selfSpecializeClassType,
    setTypeArgumentsRecursive,
    specializeType,
    stripFirstParameter,
    stripLiteralTypeArgsValue,
    stripLiteralValue,
    transformPossibleRecursiveTypeAlias,
    transformTypeObjectToClass,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

interface TypeResult {
    type: Type;
    node: ExpressionNode;

    unpackedType?: Type;
    typeList?: TypeResult[];
    isResolutionCyclical?: boolean;
    expectedTypeDiagAddendum?: DiagnosticAddendum;
}

interface EffectiveTypeResult {
    type: Type;
    isResolutionCyclical: boolean;
}

interface FunctionArgument {
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    type?: Type;
    valueExpression?: ExpressionNode;
    active?: boolean;
}

interface ValidateArgTypeParams {
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: FunctionArgument;
    errorNode: ExpressionNode;
    paramName?: string;
}

interface ClassMemberLookup {
    // Type of value.
    type: Type;

    // True if class member, false otherwise.
    isClassMember: boolean;
}

// Used to determine whether an abstract method has been
// overridden by a non-abstract method.
interface AbstractMethod {
    symbol: Symbol;
    symbolName: string;
    classType: Type;
    isAbstract: boolean;
}

type TypeNarrowingCallback = (type: Type) => Type | undefined;

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

    // Skip the check for unknown arguments.
    DoNotCheckForUnknownArgs = 1 << 4,

    // Treat string literal as a type.
    EvaluateStringLiteralAsType = 1 << 5,

    // 'Final' is not allowed in this context.
    FinalDisallowed = 1 << 6,

    // A ParamSpec isn't allowed in this context.
    ParamSpecDisallowed = 1 << 7,

    // Expression is expected to be a type (class) rather
    // than an instance (object)
    ExpectingType = 1 << 8,

    // The Tuple type allows the use of a tuple literal
    // expression "()" as a type argument. When this appears
    // as a type argument in other contexts, it's illegal.
    AllowEmptyTupleAsType = 1 << 9,

    // Interpret an ellipsis type annotation to mean "Unknown".
    ConvertEllipsisToUnknown = 1 << 10,

    // The Generic class type is allowed in this context. It is
    // normally not allowed if ExpectingType is set.
    GenericClassTypeAllowed = 1 << 11,

    // In most cases where ExpectingType is set, generic classes
    // with missing type args are reported to the user, but there
    // are cases where it is legitimate to leave off missing
    // type args, such as with the "bound" parameter in a TypeArg.
    AllowMissingTypeArgs = 1 << 12,

    // TypeVars within this expression must not refer to type vars
    // used in an outer scope that.
    DisallowTypeVarsWithScopeId = 1 << 13,

    // TypeVars within this expression must refer to type vars
    // used in an outer scope that.
    DisallowTypeVarsWithoutScopeId = 1 << 14,

    // TypeVars within this expression that are otherwise not
    // associated with an outer scope should be associated with
    // the containing function's scope.
    AssociateTypeVarsWithCurrentScope = 1 << 15,
}

interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: Type;
    setErrorNode?: ExpressionNode;
    setExpectedTypeDiag?: DiagnosticAddendum;
}

interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections' | 'self';
}

export const enum MemberAccessFlags {
    None = 0,

    // By default, both class and instance members are considered.
    // Set this flag to skip the instance members.
    SkipInstanceMembers = 1 << 0,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 1 << 1,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 1 << 2,

    // By default, if the class has a __getattribute__ or __getattr__
    // magic method, it is assumed to have any member.
    SkipGetAttributeCheck = 1 << 3,

    // Consider writes to symbols flagged as ClassVars as an error.
    DisallowClassVarWrites = 1 << 4,

    // This set of flags is appropriate for looking up methods.
    SkipForMethodLookup = SkipInstanceMembers | SkipGetAttributeCheck,
}

export const enum PrintTypeFlags {
    None = 0,

    // Avoid printing "Unknown" and always use "Any" instead.
    PrintUnknownWithAny = 1 << 0,

    // Omit type arguments for generic classes if they are "Any".
    OmitTypeArgumentsIfAny = 1 << 1,

    // Omit printing type for param if type is not specified.
    OmitUnannotatedParamType = 1 << 2,

    // Print Union and Optional in PEP 604 format.
    PEP604 = 1 << 3,
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type SetAnalysisChangedCallback = (reason: string) => void;

const arithmeticOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Add]: ['__add__', '__radd__'],
    [OperatorType.Subtract]: ['__sub__', '__rsub__'],
    [OperatorType.Multiply]: ['__mul__', '__rmul__'],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__'],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__'],
    [OperatorType.Mod]: ['__mod__', '__rmod__'],
    [OperatorType.Power]: ['__pow__', '__rpow__'],
    [OperatorType.MatrixMultiply]: ['__matmul__', '__rmatmul__'],
};

const bitwiseOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__'],
};

const comparisonOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Equals]: ['__eq__', '__ne__'],
    [OperatorType.NotEquals]: ['__ne__', '__eq__'],
    [OperatorType.LessThan]: ['__lt__', '__gt__'],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__'],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__'],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__'],
};

const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true,
};

// This table contains the names of several built-in types that
// are not subscriptable at runtime on older versions of Python.
// It lists the first version of Python where subscripting is
// allowed.
const nonSubscriptableBuiltinTypes: { [builtinName: string]: PythonVersion } = {
    'asyncio.futures.Future': PythonVersion.V3_9,
    'builtins.dict': PythonVersion.V3_9,
    'builtins.frozenset': PythonVersion.V3_9,
    'builtins.list': PythonVersion.V3_9,
    'builtins._PathLike': PythonVersion.V3_9,
    'builtins.set': PythonVersion.V3_9,
    'collections.ChainMap': PythonVersion.V3_9,
    'collections.Counter': PythonVersion.V3_9,
    'collections.DefaultDict': PythonVersion.V3_9,
    'collections.deque': PythonVersion.V3_9,
    'collections.OrderedDict': PythonVersion.V3_9,
    'queue.Queue': PythonVersion.V3_9,
};

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
    activeParam?: FunctionParameter;
}

export interface CallSignatureInfo {
    signatures: CallSignature[];
    callNode: CallNode | DecoratorNode;
}

export interface CallResult {
    returnType?: Type;
    argumentErrors: boolean;
    activeParam?: FunctionParameter;
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    evaluateTypesForStatement: (node: ParseNode) => void;

    getDeclaredTypeForExpression: (expression: ExpressionNode) => Type | undefined;
    verifyRaiseExceptionType: (node: RaiseNode) => void;
    verifyDeleteExpression: (node: ExpressionNode) => void;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode) => boolean;
    suppressDiagnostics: (callback: () => void) => void;

    getDeclarationsForNameNode: (node: NameNode) => Declaration[] | undefined;
    getTypeForDeclaration: (declaration: Declaration) => Type | undefined;
    resolveAliasDeclaration: (declaration: Declaration, resolveLocalNames: boolean) => Declaration | undefined;
    getTypeFromIterable: (
        type: Type,
        isAsync: boolean,
        errorNode: ParseNode | undefined,
        supportGetItem: boolean
    ) => Type;
    getTypedDictMembersForClass: (classType: ClassType) => Map<string, TypedDictEntry>;

    getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    getFunctionDeclaredReturnType: (node: FunctionNode) => Type | undefined;
    getFunctionInferredReturnType: (type: FunctionType) => Type;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    bindFunctionToClassOrObject: (
        baseType: ClassType | ObjectType | undefined,
        memberType: Type,
        treatAsClassMember: boolean
    ) => Type | undefined;
    getBoundMethod: (
        classType: ClassType,
        memberName: string,
        treatAsClassMember: boolean
    ) => FunctionType | OverloadedFunctionType | undefined;
    getCallSignatureInfo: (
        node: ParseNode,
        insertionOffset: number,
        tokens: TextRangeCollection<Token>
    ) => CallSignatureInfo | undefined;
    getTypeAnnotationForParameter: (node: FunctionNode, paramIndex: number) => ExpressionNode | undefined;

    canAssignType: (
        destType: Type,
        srcType: Type,
        diag: DiagnosticAddendum,
        typeVarMap?: TypeVarMap,
        flags?: CanAssignFlags
    ) => boolean;
    canOverrideMethod: (baseMethod: Type, overrideMethod: FunctionType, diag: DiagnosticAddendum) => boolean;

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

    printType: (type: Type, expandTypeAlias: boolean) => string;
    printFunctionParts: (type: FunctionType) => [string[], string];

    getTypeCacheSize: () => number;
}

interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        reference: NameNode | MemberAccessNode,
        targetSymbolId: number,
        initialType: Type | undefined
    ) => FlowNodeTypeResult;
}

interface FlowNodeTypeResult {
    type: Type | undefined;
    isIncomplete: boolean;
    generationCount?: number;
    incompleteType?: Type;
    incompleteSubtypes?: (Type | undefined)[];
}

interface SymbolResolutionStackEntry {
    // The symbol ID and declaration being resolved.
    symbolId: number;
    declaration: Declaration;

    // Initially true, it's set to false if a recursion
    // is detected.
    isResultValid: boolean;

    // Some limited forms of recursion are allowed. In these
    // cases, a partially-constructed type can be registered.
    partialType?: Type;
}

interface ReturnTypeInferenceContext {
    functionNode: FunctionNode;
    codeFlowAnalyzer: CodeFlowAnalyzer;
}

// How many levels deep should we attempt to infer return
// types based on call-site argument types? The deeper we go,
// the more types we may be able to infer, but the worse the
// performance.
const maxReturnTypeInferenceStackSize = 3;

export function createTypeEvaluator(importLookup: ImportLookup, printTypeFlags: PrintTypeFlags): TypeEvaluator {
    const symbolResolutionStack: SymbolResolutionStackEntry[] = [];
    const isReachableRecursionMap = new Map<number, true>();
    const functionRecursionMap = new Map<number, true>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzer>();
    const typeCache: TypeCache = new Map<number, CachedType>();
    const speculativeTypeTracker = new SpeculativeTypeTracker();
    const incompleteTypeTracker = new IncompleteTypeTracker();
    let cancellationToken: CancellationToken | undefined;
    let isDiagnosticSuppressed = false;
    let flowIncompleteGeneration = 1;

    const returnTypeInferenceContextStack: ReturnTypeInferenceContext[] = [];
    let returnTypeInferenceTypeCache: TypeCache | undefined;

    function runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T {
        try {
            cancellationToken = token;
            return callback();
        } finally {
            cancellationToken = undefined;
        }
    }

    function checkForCancellation() {
        if (cancellationToken) {
            throwIfCancellationRequested(cancellationToken);
        }
    }

    function getTypeCacheSize(): number {
        return typeCache.size;
    }

    function readTypeCache(node: ParseNode): Type | undefined {
        let cachedType: CachedType | undefined;

        // Should we use a temporary cache associated with a contextual
        // analysis of a function, contextualized based on call-site argument types?
        if (returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)) {
            cachedType = returnTypeInferenceTypeCache.get(node.id);
        } else {
            cachedType = typeCache.get(node.id);
        }

        if (cachedType === undefined) {
            return undefined;
        }

        assert(!isIncompleteType(cachedType));
        return cachedType as Type;
    }

    function writeTypeCache(node: ParseNode, type: Type) {
        // Should we use a temporary cache associated with a contextual
        // analysis of a function, contextualized based on call-site argument types?
        const typeCacheToUse =
            returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)
                ? returnTypeInferenceTypeCache
                : typeCache;

        typeCacheToUse.set(node.id, type);

        // If the entry is located within a part of the parse tree that is currently being
        // "speculatively" evaluated, track it so we delete the cached entry when we leave
        // this speculative context.
        const speculativeNode = speculativeTypeTracker.getSpeculativeRootNode();
        if (speculativeNode && ParseTreeUtils.isNodeContainedWithin(node, speculativeNode)) {
            speculativeTypeTracker.trackEntry(typeCacheToUse, node.id);
        }

        incompleteTypeTracker.trackEntry(typeCacheToUse, node.id);
    }

    // Determines whether the specified node is contained within
    // the function node corresponding to the function that we
    // are currently analyzing in the context of parameter types
    // defined by a call site.
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

    function pushSymbolResolution(symbol: Symbol, declaration: Declaration) {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            // Mark all of the entries between these two as invalid.
            for (let i = index + 1; i < symbolResolutionStack.length; i++) {
                symbolResolutionStack[i].isResultValid = false;
            }
            return false;
        }

        symbolResolutionStack.push({
            symbolId: symbol.id,
            declaration,
            isResultValid: true,
        });
        return true;
    }

    function popSymbolResolution(symbol: Symbol) {
        const poppedEntry = symbolResolutionStack.pop()!;
        assert(poppedEntry.symbolId === symbol.id);
        return poppedEntry.isResultValid;
    }

    function setSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration, type: Type) {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            symbolResolutionStack[index].partialType = type;
        }
    }

    function getSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration): Type | undefined {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            return symbolResolutionStack[index].partialType;
        }

        return undefined;
    }

    // Determines the type of the specified node by evaluating it in
    // context, logging any errors in the process. This may require the
    // type of surrounding statements to be evaluated.
    function getType(node: ExpressionNode): Type | undefined {
        evaluateTypesForExpressionInContext(node);

        // We assume here that the type for the node in question
        // will be populated in the cache. Some nodes don't have
        // defined types (e.g. a raw list comprehension outside
        // of its containing list), so we'll return undefined in those
        // cases.
        return readTypeCache(node);
    }

    function getTypeOfExpression(node: ExpressionNode, expectedType?: Type, flags = EvaluatorFlags.None): TypeResult {
        // Is this type already cached?
        const cachedType = readTypeCache(node);
        if (cachedType) {
            return { type: cachedType, node };
        }

        // This is a frequently-called routine, so it's a good place to call
        // the cancellation check. If the operation is canceled, an exception
        // will be thrown at this point.
        checkForCancellation();

        let typeResult: TypeResult | undefined;
        let reportExpectingTypeErrors = (flags & EvaluatorFlags.ExpectingType) !== 0;

        switch (node.nodeType) {
            case ParseNodeType.Name: {
                typeResult = getTypeFromName(node, flags);
                break;
            }

            case ParseNodeType.MemberAccess: {
                typeResult = getTypeFromMemberAccess(node, flags);
                break;
            }

            case ParseNodeType.Index: {
                typeResult = getTypeFromIndex(node, flags);
                break;
            }

            case ParseNodeType.Call: {
                typeResult = getTypeFromCall(node, expectedType, flags);
                break;
            }

            case ParseNodeType.Tuple: {
                typeResult = getTypeFromTuple(node, expectedType);
                break;
            }

            case ParseNodeType.Constant: {
                typeResult = getTypeFromConstant(node, flags);
                break;
            }

            case ParseNodeType.StringList: {
                const expectingType =
                    (flags & EvaluatorFlags.EvaluateStringLiteralAsType) !== 0 && !isAnnotationLiteralValue(node);

                if (expectingType) {
                    if (node.typeAnnotation) {
                        typeResult = getTypeOfExpression(
                            node.typeAnnotation,
                            undefined,
                            flags | EvaluatorFlags.AllowForwardReferences | EvaluatorFlags.ExpectingType
                        );
                    } else if (!node.typeAnnotation && node.strings.length === 1) {
                        // We didn't know at parse time that this string node was going
                        // to be evaluated as a forward-referenced type. We need
                        // to re-invoke the parser at this stage.
                        const expr = parseStringAsTypeAnnotation(node);
                        if (expr) {
                            typeResult = getTypeOfExpression(
                                expr,
                                undefined,
                                flags | EvaluatorFlags.AllowForwardReferences | EvaluatorFlags.ExpectingType
                            );
                        }
                    }

                    if (!typeResult) {
                        const fileInfo = getFileInfo(node);
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.expectedTypeNotString(),
                            node
                        );
                        typeResult = { node, type: UnknownType.create() };
                    }

                    // Don't report expecting type errors again. We will have already
                    // reported them when analyzing the contents of the string.
                    reportExpectingTypeErrors = false;
                } else {
                    // Evaluate the format string expressions in this context.
                    node.strings.forEach((str) => {
                        if (str.nodeType === ParseNodeType.FormatString) {
                            str.expressions.forEach((expr) => {
                                getTypeOfExpression(expr);
                            });
                        }
                    });

                    const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;

                    // Don't create a literal type if it's an f-string.
                    if (node.strings.some((str) => str.nodeType === ParseNodeType.FormatString)) {
                        typeResult = {
                            node,
                            type: getBuiltInObject(node, isBytes ? 'bytes' : 'str'),
                        };
                    } else {
                        typeResult = {
                            node,
                            type: cloneBuiltinObjectWithLiteral(
                                node,
                                isBytes ? 'bytes' : 'str',
                                node.strings.map((s) => s.value).join('')
                            ),
                        };
                    }
                }
                break;
            }

            case ParseNodeType.Number: {
                let builtInType = 'float';
                if (node.isImaginary) {
                    builtInType = 'complex';
                } else if (node.isInteger) {
                    builtInType = 'int';
                }
                typeResult = { node, type: cloneBuiltinObjectWithLiteral(node, builtInType, node.value) };
                break;
            }

            case ParseNodeType.Ellipsis: {
                if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                    typeResult = { type: AnyType.create(true), node };
                } else if ((flags & EvaluatorFlags.ConvertEllipsisToUnknown) !== 0) {
                    typeResult = { type: UnknownType.create(), node };
                } else {
                    const ellipsisType = getBuiltInObject(node, 'ellipsis') || AnyType.create();
                    typeResult = { type: ellipsisType, node };
                }
                break;
            }

            case ParseNodeType.UnaryOperation: {
                typeResult = getTypeFromUnaryOperation(node, expectedType);
                break;
            }

            case ParseNodeType.BinaryOperation: {
                typeResult = getTypeFromBinaryOperation(node, expectedType, flags);
                break;
            }

            case ParseNodeType.AugmentedAssignment: {
                const type = getTypeFromAugmentedAssignment(node, expectedType);
                assignTypeToExpression(node.destExpression, type, node.rightExpression);
                typeResult = { type, node };
                break;
            }

            case ParseNodeType.List: {
                typeResult = getTypeFromList(node, expectedType);
                break;
            }

            case ParseNodeType.Slice: {
                typeResult = getTypeFromSlice(node);
                break;
            }

            case ParseNodeType.Await: {
                typeResult = getTypeOfExpression(node.expression, undefined, flags);
                typeResult = {
                    type: getTypeFromAwaitable(typeResult.type, node.expression),
                    node,
                };
                break;
            }

            case ParseNodeType.Ternary: {
                typeResult = getTypeFromTernary(node, flags, expectedType);
                break;
            }

            case ParseNodeType.ListComprehension: {
                typeResult = getTypeFromListComprehension(node);
                break;
            }

            case ParseNodeType.Dictionary: {
                typeResult = getTypeFromDictionary(node, expectedType);
                break;
            }

            case ParseNodeType.Lambda: {
                typeResult = getTypeFromLambda(node, expectedType);
                break;
            }

            case ParseNodeType.Set: {
                typeResult = getTypeFromSet(node, expectedType);
                break;
            }

            case ParseNodeType.Assignment: {
                typeResult = getTypeOfExpression(node.rightExpression);
                assignTypeToExpression(node.leftExpression, typeResult.type, node.rightExpression);
                break;
            }

            case ParseNodeType.AssignmentExpression: {
                typeResult = getTypeOfExpression(node.rightExpression);
                assignTypeToExpression(node.name, typeResult.type, node.rightExpression);
                break;
            }

            case ParseNodeType.Yield: {
                typeResult = getTypeFromYield(node);
                break;
            }

            case ParseNodeType.YieldFrom: {
                typeResult = getTypeFromYieldFrom(node);
                break;
            }

            case ParseNodeType.Unpack: {
                const iterType = getTypeOfExpression(node.expression, expectedType).type;
                const type = getTypeFromIterable(iterType, /* isAsync */ false, node, /* supportGetItem */ false);
                typeResult = { type, unpackedType: iterType, node };
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                typeResult = getTypeOfExpression(
                    node.typeAnnotation,
                    undefined,
                    EvaluatorFlags.EvaluateStringLiteralAsType |
                        EvaluatorFlags.ParamSpecDisallowed |
                        EvaluatorFlags.ExpectingType
                );
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                suppressDiagnostics(() => {
                    if (node.child) {
                        getTypeOfExpression(node.child);
                    }
                });
                typeResult = { type: UnknownType.create(), node };
                break;
            }
        }

        if (!typeResult) {
            // We shouldn't get here. If we do, report an error.
            fail(`Unhandled expression type '${ParseTreeUtils.printExpression(node)}'`);
        }

        if (reportExpectingTypeErrors) {
            const resultType = transformTypeObjectToClass(typeResult.type);
            if (!TypeBase.isInstantiable(resultType)) {
                const isEmptyTuple =
                    isObject(resultType) &&
                    ClassType.isBuiltIn(resultType.classType, 'Tuple') &&
                    resultType.classType.typeArguments?.length === 0;

                if ((flags & EvaluatorFlags.AllowEmptyTupleAsType) === 0 || !isEmptyTuple) {
                    addExpectedClassDiagnostic(typeResult.type, node);
                }
            }
        }

        // Don't update the type cache with an unbound type that results from
        // a resolution cycle. The cache will be updated when the stack unwinds
        // and the type is fully evaluated.
        if (!typeResult.isResolutionCyclical) {
            writeTypeCache(node, typeResult.type);
        }

        return typeResult;
    }

    function isAnnotationEvaluationPostponed(fileInfo: AnalyzerFileInfo) {
        return fileInfo.futureImports.get('annotations') !== undefined || fileInfo.isStubFile;
    }

    function getTypeOfAnnotation(node: ExpressionNode, allowFinal = false, associateTypeVarsWithScope = false): Type {
        const fileInfo = getFileInfo(node);

        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
            const specialType = handleTypingStubTypeAnnotation(node);
            if (specialType) {
                writeTypeCache(node, specialType);
                return specialType;
            }
        }

        let evaluatorFlags =
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.ConvertEllipsisToAny |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.ParamSpecDisallowed;

        if (isAnnotationEvaluationPostponed(fileInfo)) {
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        if (associateTypeVarsWithScope) {
            evaluatorFlags |= EvaluatorFlags.AssociateTypeVarsWithCurrentScope;
        } else {
            evaluatorFlags |= EvaluatorFlags.DisallowTypeVarsWithoutScopeId;
        }

        // If the annotation is part of a comment, allow forward references
        // even if it's not enclosed in quotes.
        if (node?.parent?.nodeType === ParseNodeType.Assignment && node.parent.typeAnnotationComment === node) {
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        if (!allowFinal) {
            evaluatorFlags |= EvaluatorFlags.FinalDisallowed;
        }

        const classType = getTypeOfExpression(node, /* expectedType */ undefined, evaluatorFlags).type;

        return convertToInstance(classType);
    }

    function getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        const baseTypeResult = getTypeOfExpression(
            node.leftExpression,
            /* expectedType */ undefined,
            EvaluatorFlags.DoNotSpecialize
        );

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map((arg) => {
                const functionArg: FunctionArgument = {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name,
                };
                return functionArg;
            });

            // Evaluate the decorator. Don't check for unknown arguments
            // because these errors will already be reported as unknown
            // parameters.
            decoratorCall = getTypeFromCallWithBaseType(
                node,
                argList,
                decoratorCall,
                undefined,
                EvaluatorFlags.DoNotCheckForUnknownArgs
            );
        }

        const argList = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: functionOrClassType,
            },
        ];

        return getTypeFromCallWithBaseType(
            node,
            argList,
            decoratorCall,
            undefined,
            EvaluatorFlags.DoNotCheckForUnknownArgs | EvaluatorFlags.DoNotSpecialize
        ).type;
    }

    // Gets a member type from an object and if it's a function binds
    // it to the object. If bindToClass is undefined, the binding is done
    // using the objectType parameter. Callers can specify these separately
    // to handle the case where we're fetching the object member from a
    // metaclass but binding to the class.
    function getTypeFromObjectMember(
        errorNode: ExpressionNode,
        objectType: ObjectType,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum,
        memberAccessFlags = MemberAccessFlags.None,
        bindToClass?: ClassType
    ): Type | undefined {
        const memberInfo = getTypeFromClassMemberName(
            errorNode,
            objectType.classType,
            memberName,
            usage,
            diag,
            memberAccessFlags | MemberAccessFlags.DisallowClassVarWrites
        );

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (
                resultType.category === TypeCategory.Function ||
                resultType.category === TypeCategory.OverloadedFunction
            ) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(
                        bindToClass || objectType,
                        resultType,
                        !!bindToClass,
                        errorNode
                    );
                }
            }
        }

        return resultType;
    }

    // Gets a member type from a class and if it's a function binds
    // it to the object.
    function getTypeFromClassMember(
        errorNode: ExpressionNode,
        classType: ClassType,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum,
        memberAccessFlags = MemberAccessFlags.None
    ): Type | undefined {
        let memberInfo = getTypeFromClassMemberName(
            errorNode,
            classType,
            memberName,
            usage,
            diag,
            memberAccessFlags | MemberAccessFlags.SkipInstanceMembers
        );
        let isMetaclassMember = false;

        // If it wasn't found on the class, see if it's part of the metaclass.
        if (!memberInfo) {
            const metaclass = classType.details.effectiveMetaclass;
            if (metaclass && isClass(metaclass)) {
                memberInfo = getTypeFromClassMemberName(
                    errorNode,
                    metaclass,
                    memberName,
                    usage,
                    new DiagnosticAddendum(),
                    memberAccessFlags | MemberAccessFlags.SkipInstanceMembers,
                    classType
                );
                isMetaclassMember = true;
            }
        }

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (
                resultType.category === TypeCategory.Function ||
                resultType.category === TypeCategory.OverloadedFunction
            ) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(
                        classType,
                        resultType,
                        /* treatAsClassMember */ isMetaclassMember,
                        errorNode
                    );
                }
            }
        }

        return resultType;
    }

    function getBoundMethod(
        classType: ClassType,
        memberName: string,
        treatAsClassMember: boolean
    ): FunctionType | OverloadedFunctionType | undefined {
        const aliasClass = classType.details.aliasClass;
        if (aliasClass) {
            classType = aliasClass;
        }

        const memberInfo = lookUpClassMember(
            classType,
            memberName,
            ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
        );

        if (memberInfo) {
            const unboundMethodType = getTypeOfMember(memberInfo);
            if (
                unboundMethodType.category === TypeCategory.Function ||
                unboundMethodType.category === TypeCategory.OverloadedFunction
            ) {
                const boundMethod = bindFunctionToClassOrObject(
                    ObjectType.create(classType),
                    unboundMethodType,
                    treatAsClassMember
                );

                if (boundMethod) {
                    if (
                        boundMethod.category === TypeCategory.Function ||
                        boundMethod.category === TypeCategory.OverloadedFunction
                    ) {
                        return boundMethod;
                    }
                }
            }
        }

        return undefined;
    }

    function getTypeAnnotationForParameter(node: FunctionNode, paramIndex: number): ExpressionNode | undefined {
        if (paramIndex >= node.parameters.length) {
            return undefined;
        }

        const param = node.parameters[paramIndex];
        if (param.typeAnnotation) {
            return param.typeAnnotation;
        }

        if (!node.functionAnnotationComment || node.functionAnnotationComment.isParamListEllipsis) {
            return undefined;
        }

        // We may need to skip the first parameter if this is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const functionFlags = getFunctionFlagsFromDecorators(node, !!containingClassNode);

        let firstCommentAnnotationIndex = 0;
        if (containingClassNode && (functionFlags & FunctionTypeFlags.StaticMethod) === 0) {
            firstCommentAnnotationIndex = 1;
        }

        const paramAnnotations = node.functionAnnotationComment.paramTypeAnnotations;
        const adjIndex = paramIndex - firstCommentAnnotationIndex;
        if (adjIndex < 0 || adjIndex >= paramAnnotations.length) {
            return undefined;
        }

        return paramAnnotations[adjIndex];
    }

    // Returns the signature(s) associated with a call node that contains
    // the specified node. It also returns the index of the argument
    // that contains the node.
    function getCallSignatureInfo(
        node: ParseNode,
        insertionOffset: number,
        tokens: TextRangeCollection<Token>
    ): CallSignatureInfo | undefined {
        // Find the call node that contains the specified node.
        let curNode: ParseNode | undefined = node;
        let callNode: CallNode | DecoratorNode | undefined;
        while (curNode !== undefined) {
            if (curNode.nodeType === ParseNodeType.Call || curNode.nodeType === ParseNodeType.Decorator) {
                callNode = curNode;
                break;
            }
            curNode = curNode.parent;
        }

        if (!callNode || !callNode.arguments) {
            return undefined;
        }

        if (insertionOffset >= TextRange.getEnd(callNode)) {
            return undefined;
        }

        const exprNode = callNode.leftExpression;
        const callType = getType(exprNode);
        if (callType === undefined) {
            return undefined;
        }

        const argList: FunctionArgument[] = [];
        let addedActive = false;
        let previousCategory = ArgumentCategory.Simple;

        // Empty arguments do not enter the AST as nodes, but instead are left blank.
        // Instead, we detect when we appear to be between two known arguments or at the
        // end of the argument list and insert a fake argument of an unknown type to have
        // something to match later.
        function addFakeArg() {
            argList.push({
                argumentCategory: previousCategory,
                type: UnknownType.create(),
                active: true,
            });
        }

        callNode.arguments.forEach((arg) => {
            let active = false;

            if (!addedActive) {
                // Calculate the argument's bounds including whitespace and colons.
                let start = arg.start;
                const startTokenIndex = tokens.getItemAtPosition(start);
                if (startTokenIndex >= 0) {
                    start = TextRange.getEnd(tokens.getItemAt(startTokenIndex - 1));
                }

                let end = TextRange.getEnd(arg);
                const endTokenIndex = tokens.getItemAtPosition(end);
                if (endTokenIndex >= 0) {
                    // Find the true end of the argument by searching for the
                    // terminating comma or parenthesis.
                    for (let i = endTokenIndex; i < tokens.count; i++) {
                        const tok = tokens.getItemAt(i);

                        switch (tok.type) {
                            case TokenType.Comma:
                            case TokenType.CloseParenthesis:
                                break;
                            default:
                                continue;
                        }

                        end = TextRange.getEnd(tok);
                        break;
                    }
                }

                if (insertionOffset < end) {
                    if (insertionOffset >= start) {
                        active = true;
                    } else {
                        addFakeArg();
                    }
                    addedActive = true;
                }
            }

            previousCategory = arg.argumentCategory;

            argList.push({
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name,
                active: active,
            });
        });

        if (!addedActive) {
            addFakeArg();
        }

        const signatures: CallSignature[] = [];

        function addOneFunctionToSignature(type: FunctionType) {
            let callResult: CallResult | undefined;

            useSpeculativeMode(callNode!, () => {
                callResult = validateFunctionArguments(
                    exprNode,
                    argList,
                    type,
                    new TypeVarMap(),
                    /* skipUnknownArgCheck */ true,
                    /* inferReturnTypeIfNeeded */ true,
                    undefined
                );
            });

            signatures.push({
                type,
                activeParam: callResult?.activeParam,
            });
        }

        function addFunctionToSignature(type: FunctionType | OverloadedFunctionType) {
            if (type.category === TypeCategory.Function) {
                addOneFunctionToSignature(type);
            } else {
                type.overloads.forEach(addOneFunctionToSignature);
            }
        }

        doForSubtypes(callType, (subtype) => {
            switch (subtype.category) {
                case TypeCategory.Function:
                case TypeCategory.OverloadedFunction: {
                    addFunctionToSignature(subtype);
                    break;
                }

                case TypeCategory.Class: {
                    let methodType: FunctionType | OverloadedFunctionType | undefined;

                    // Try to get the __init__ method first because it typically has
                    // more type information than __new__.
                    methodType = getBoundMethod(subtype, '__init__', /* treatAsClassMember */ false);

                    if (!methodType) {
                        // If there was no __init__ method, use the __new__ method
                        // instead.
                        methodType = getBoundMethod(subtype, '__new__', /* treatAsClassMember */ true);
                    }

                    if (methodType) {
                        addFunctionToSignature(methodType);
                    }
                    break;
                }

                case TypeCategory.Object: {
                    const methodType = getBoundMethod(subtype.classType, '__call__', /* treatAsClassMember */ false);
                    if (methodType) {
                        addFunctionToSignature(methodType);
                    }
                    break;
                }
            }

            return undefined;
        });

        if (signatures.length === 0) {
            return undefined;
        }

        return {
            callNode,
            signatures,
        };
    }

    // Determines whether the specified expression is an explicit TypeAlias declaration.
    function isDeclaredTypeAlias(expression: ExpressionNode): boolean {
        if (expression.nodeType === ParseNodeType.TypeAnnotation) {
            if (expression.valueExpression.nodeType === ParseNodeType.Name) {
                const symbolWithScope = lookUpSymbolRecursive(
                    expression,
                    expression.valueExpression.value,
                    /* honorCodeFlow */ false
                );
                if (symbolWithScope) {
                    const symbol = symbolWithScope.symbol;
                    return symbol.getDeclarations().find((decl) => isExplicitTypeAliasDeclaration(decl)) !== undefined;
                }
            }
        }

        return false;
    }

    // Determines whether the specified expression is possibly an implicit type alias.
    // In Python, type aliases look the same as simple assignments, but we use some heuristics
    // to tell them apart.
    function isPossibleImplicitTypeAlias(expression: ExpressionNode): boolean {
        if (expression.nodeType === ParseNodeType.Name) {
            const symbolWithScope = lookUpSymbolRecursive(expression, expression.value, /* honorCodeFlow */ false);
            if (symbolWithScope) {
                const symbol = symbolWithScope.symbol;
                return symbol.getDeclarations().find((decl) => isPossibleTypeAliasDeclaration(decl)) !== undefined;
            }
        }

        return false;
    }

    // Determines whether the specified expression is a symbol with a declared type
    // (either a simple name or a member variable). If so, the type is returned.
    function getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
        let symbol: Symbol | undefined;
        let classOrObjectBase: ClassType | ObjectType | undefined;

        switch (expression.nodeType) {
            case ParseNodeType.Name: {
                const symbolWithScope = lookUpSymbolRecursive(expression, expression.value, /* honorCodeFlow */ true);
                if (symbolWithScope) {
                    symbol = symbolWithScope.symbol;
                }
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                return getDeclaredTypeForExpression(expression.valueExpression);
            }

            case ParseNodeType.MemberAccess: {
                const baseType = makeTypeVarsConcrete(getTypeOfExpression(expression.leftExpression).type);
                let classMemberInfo: ClassMember | undefined;

                if (isObject(baseType)) {
                    classMemberInfo = lookUpObjectMember(
                        baseType,
                        expression.memberName.value,
                        ClassMemberLookupFlags.DeclaredTypesOnly
                    );
                    classOrObjectBase = baseType;
                } else if (isClass(baseType)) {
                    classMemberInfo = lookUpClassMember(
                        baseType,
                        expression.memberName.value,
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.DeclaredTypesOnly
                    );
                    classOrObjectBase = baseType;
                }

                if (classMemberInfo) {
                    symbol = classMemberInfo.symbol;
                }
                break;
            }

            case ParseNodeType.Index: {
                const baseType = getDeclaredTypeForExpression(expression.baseExpression);
                if (baseType && isObject(baseType)) {
                    const setItemMember = lookUpClassMember(baseType.classType, '__setitem__');
                    if (setItemMember) {
                        const setItemType = getTypeOfMember(setItemMember);
                        if (setItemType.category === TypeCategory.Function) {
                            const boundFunction = bindFunctionToClassOrObject(
                                baseType,
                                setItemType,
                                /* treatAsClassMember */ false,
                                expression
                            );
                            if (boundFunction && boundFunction.category === TypeCategory.Function) {
                                if (boundFunction.details.parameters.length === 2) {
                                    const paramType = FunctionType.getEffectiveParameterType(boundFunction, 1);
                                    if (!isAnyOrUnknown(paramType)) {
                                        return paramType;
                                    }
                                }
                            }
                        }
                    }
                }
                break;
            }
        }

        if (symbol) {
            let declaredType = getDeclaredTypeOfSymbol(symbol);
            if (declaredType) {
                // If it's a property, we need to get the fset type.
                if (isProperty(declaredType)) {
                    const setterInfo = lookUpClassMember((declaredType as ObjectType).classType, 'fset');
                    const setter = setterInfo ? getTypeOfMember(setterInfo) : undefined;
                    if (!setter || setter.category !== TypeCategory.Function || setter.details.parameters.length < 2) {
                        return undefined;
                    }

                    declaredType = setter.details.parameters[1].type;
                }

                if (classOrObjectBase) {
                    declaredType = bindFunctionToClassOrObject(
                        classOrObjectBase,
                        declaredType,
                        /* treatAsClassMember */ false,
                        expression
                    );
                }

                return declaredType;
            }
        }

        return undefined;
    }

    // Applies an "await" operation to the specified type and returns
    // the result. According to PEP 492, await operates on:
    // 1) a generator object
    // 2) an Awaitable (object that provides an __await__ that
    //    returns a generator object)
    // If errorNode is undefined, no errors are reported.
    function getTypeFromAwaitable(type: Type, errorNode?: ParseNode): Type {
        return doForSubtypes(type, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const generatorReturnType = getReturnTypeFromGenerator(subtype);
            if (generatorReturnType) {
                return generatorReturnType;
            }

            if (isObject(subtype)) {
                const awaitReturnType = getSpecializedReturnType(subtype, '__await__', errorNode);
                if (awaitReturnType) {
                    if (isAnyOrUnknown(awaitReturnType)) {
                        return awaitReturnType;
                    }

                    if (isObject(awaitReturnType)) {
                        const iterReturnType = getSpecializedReturnType(awaitReturnType, '__iter__', errorNode);

                        if (iterReturnType) {
                            const generatorReturnType = getReturnTypeFromGenerator(awaitReturnType);
                            if (generatorReturnType) {
                                return generatorReturnType;
                            }
                        }
                    }
                }
            }

            if (errorNode) {
                const fileInfo = getFileInfo(errorNode);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotAwaitable().format({ type: printType(subtype) }),
                    errorNode
                );
            }

            return UnknownType.create();
        });
    }

    // Validates that the type is iterable and returns the iterated type.
    // If errorNode is undefined, no errors are reported.
    function getTypeFromIterable(
        type: Type,
        isAsync: boolean,
        errorNode: ParseNode | undefined,
        supportGetItem: boolean
    ): Type {
        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        const getItemMethodName = supportGetItem ? '__getitem__' : '';

        type = makeTypeVarsConcrete(type);

        if (type.category === TypeCategory.Union && type.subtypes.some((t) => isNone(t))) {
            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticRuleSet.reportOptionalIterable,
                    DiagnosticRule.reportOptionalIterable,
                    Localizer.Diagnostic.noneNotIterable(),
                    errorNode
                );
            }
            type = removeNoneFromUnion(type);
        }

        const getIteratorReturnType = (
            objType: ObjectType,
            metaclass: ClassType | undefined,
            diag: DiagnosticAddendum
        ): Type | undefined => {
            const iterReturnType = metaclass
                ? getSpecializedReturnTypeForMetaclassMethod(metaclass, objType.classType, iterMethodName, errorNode)
                : getSpecializedReturnType(objType, iterMethodName, errorNode);
            if (!iterReturnType) {
                // There was no __iter__. See if we can fall back to
                // the __getitem__ method instead.
                if (getItemMethodName) {
                    const getItemReturnType = getSpecializedReturnType(objType, getItemMethodName, errorNode);
                    if (getItemReturnType) {
                        return getItemReturnType;
                    }
                }

                diag.addMessage(Localizer.Diagnostic.methodNotDefined().format({ name: iterMethodName }));
            } else {
                if (isAnyOrUnknown(iterReturnType)) {
                    return iterReturnType;
                }

                if (isObject(iterReturnType)) {
                    const nextReturnType = getSpecializedReturnType(iterReturnType, nextMethodName, errorNode);

                    if (!nextReturnType) {
                        diag.addMessage(
                            Localizer.Diagnostic.methodNotDefinedOnType().format({
                                name: nextMethodName,
                                type: printType(iterReturnType),
                            })
                        );
                    } else {
                        if (!isAsync) {
                            return nextReturnType;
                        }

                        // If it's an async iteration, there's an implicit
                        // 'await' operator applied.
                        return getTypeFromAwaitable(nextReturnType, errorNode);
                    }
                } else {
                    diag.addMessage(Localizer.Diagnostic.methodReturnsNonObject().format({ name: iterMethodName }));
                }
            }

            return undefined;
        };

        return doForSubtypes(type, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            } else if (isObject(subtype)) {
                const returnType = getIteratorReturnType(subtype, undefined, diag);
                if (returnType) {
                    return returnType;
                }
            } else if (isClass(subtype)) {
                // Handle the case where the class itself is iterable.
                // This is true for classes that derive from Enum, for example.
                const metaclassType = subtype.details.effectiveMetaclass;
                if (metaclassType && isClass(metaclassType)) {
                    const returnType = getIteratorReturnType(ObjectType.create(subtype), metaclassType, diag);
                    if (returnType) {
                        return returnType;
                    }
                }
            }

            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotIterable().format({ type: printType(subtype) }) + diag.getString(),
                    errorNode
                );
            }

            return UnknownType.create();
        });
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods plus a __dataclass_fields__
    // class variable.
    function synthesizeDataClassMethods(node: ClassNode, classType: ClassType, skipSynthesizeInit: boolean) {
        assert(ClassType.isDataClass(classType));

        const newType = FunctionType.createInstance(
            '__new__',
            '',
            FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
        );
        const initType = FunctionType.createInstance('__init__', '', FunctionTypeFlags.SynthesizedMethod);

        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType,
        });
        FunctionType.addDefaultParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
        });
        initType.details.declaredReturnType = NoneType.createInstance();

        // Maintain a list of all dataclass entries (including
        // those from inherited classes) plus a list of only those
        // entries added by this class.
        const localDataClassEntries: DataClassEntry[] = [];
        const fullDataClassEntries: DataClassEntry[] = [];
        const allAncestorsKnown = addInheritedDataClassEntries(classType, fullDataClassEntries);

        if (!allAncestorsKnown) {
            // If one or more ancestor classes have an unknown type, we cannot
            // safely determine the parameter list, so we'll accept any parameters
            // to avoid a false positive.
            FunctionType.addDefaultParameters(initType);
        }

        // Maintain a list of "type evaluators".
        type TypeEvaluator = () => Type;
        const localEntryTypeEvaluator: { entry: DataClassEntry; evaluator: TypeEvaluator }[] = [];

        node.suite.statements.forEach((statementList) => {
            if (statementList.nodeType === ParseNodeType.StatementList) {
                statementList.statements.forEach((statement) => {
                    let variableNameNode: NameNode | undefined;
                    let variableTypeEvaluator: TypeEvaluator | undefined;
                    let hasDefaultValue = false;
                    let includeInInit = true;

                    if (statement.nodeType === ParseNodeType.Assignment) {
                        if (
                            statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                            statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name
                        ) {
                            variableNameNode = statement.leftExpression.valueExpression;
                            variableTypeEvaluator = () =>
                                getTypeOfAnnotation(
                                    (statement.leftExpression as TypeAnnotationNode).typeAnnotation,
                                    /* allowFinal */ true
                                );
                        }

                        hasDefaultValue = true;

                        // If the RHS of the assignment is assigning a field instance where the
                        // "init" parameter is set to false, do not include it in the init method.
                        if (statement.rightExpression.nodeType === ParseNodeType.Call) {
                            const callType = getTypeOfExpression(statement.rightExpression.leftExpression).type;
                            if (
                                callType.category === TypeCategory.OverloadedFunction &&
                                callType.overloads[0].details.builtInName === 'field'
                            ) {
                                const initArg = statement.rightExpression.arguments.find(
                                    (arg) => arg.name?.value === 'init'
                                );
                                if (initArg && initArg.valueExpression) {
                                    const value = evaluateStaticBoolExpression(
                                        initArg.valueExpression,
                                        getFileInfo(node).executionEnvironment
                                    );
                                    if (value === false) {
                                        includeInInit = false;
                                    }
                                }

                                hasDefaultValue = statement.rightExpression.arguments.some(
                                    (arg) => arg.name?.value === 'default' || arg.name?.value === 'default_factory'
                                );
                            }
                        }
                    } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                        if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.valueExpression;
                            variableTypeEvaluator = () =>
                                getTypeOfAnnotation(statement.typeAnnotation, /* allowFinal */ true);
                        }
                    }

                    if (variableNameNode && variableTypeEvaluator) {
                        const variableName = variableNameNode.value;

                        // Don't include class vars. PEP 557 indicates that they shouldn't
                        // be considered data class entries.
                        const variableSymbol = classType.details.fields.get(variableName);
                        if (!variableSymbol?.isClassVar()) {
                            // Create a new data class entry, but defer evaluation of the type until
                            // we've compiled the full list of data class entries for this class. This
                            // allows us to handle circular references in types.
                            const dataClassEntry: DataClassEntry = {
                                name: variableName,
                                hasDefault: hasDefaultValue,
                                includeInInit,
                                type: UnknownType.create(),
                            };
                            localEntryTypeEvaluator.push({ entry: dataClassEntry, evaluator: variableTypeEvaluator });

                            // Add the new entry to the local entry list.
                            let insertIndex = localDataClassEntries.findIndex((e) => e.name === variableName);
                            if (insertIndex >= 0) {
                                localDataClassEntries[insertIndex] = dataClassEntry;
                            } else {
                                localDataClassEntries.push(dataClassEntry);
                            }

                            // Add the new entry to the full entry list.
                            insertIndex = fullDataClassEntries.findIndex((p) => p.name === variableName);
                            if (insertIndex >= 0) {
                                fullDataClassEntries[insertIndex] = dataClassEntry;
                            } else {
                                fullDataClassEntries.push(dataClassEntry);
                                insertIndex = fullDataClassEntries.length - 1;
                            }

                            // If we've already seen a entry with a default value defined,
                            // all subsequent entries must also have default values.
                            const firstDefaultValueIndex = fullDataClassEntries.findIndex(
                                (p) => p.hasDefault && p.includeInInit
                            );
                            if (
                                includeInInit &&
                                !hasDefaultValue &&
                                firstDefaultValueIndex >= 0 &&
                                firstDefaultValueIndex < insertIndex
                            ) {
                                addError(Localizer.Diagnostic.dataClassFieldWithDefault(), variableNameNode);
                            }
                        }
                    }
                });
            }
        });

        classType.details.dataClassEntries = localDataClassEntries;

        // Now that the dataClassEntries field has been set with a complete list
        // of local data class entries for this class, perform deferred type
        // evaluations. This could involve circular type dependencies, so it's
        // required that the list be complete (even if types are not yet accurate)
        // before we perform the type evaluations.
        localEntryTypeEvaluator.forEach((entryEvaluator) => {
            entryEvaluator.entry.type = entryEvaluator.evaluator();
        });

        const symbolTable = classType.details.fields;
        if (!skipSynthesizeInit && allAncestorsKnown) {
            fullDataClassEntries.forEach((entry) => {
                if (entry.includeInInit) {
                    const functionParam: FunctionParameter = {
                        category: ParameterCategory.Simple,
                        name: entry.name,
                        hasDefault: entry.hasDefault,
                        hasDeclaredType: true,
                        type: entry.type,
                    };

                    FunctionType.addParameter(initType, functionParam);
                }
            });

            symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
            symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        }

        let dictType = getBuiltInType(node, 'Dict');
        if (isClass(dictType)) {
            dictType = ObjectType.create(
                ClassType.cloneForSpecialization(
                    dictType,
                    [getBuiltInObject(node, 'str'), AnyType.create()],
                    /* isTypeArgumentExplicit */ false
                )
            );
        }
        symbolTable.set('__dataclass_fields__', Symbol.createWithType(SymbolFlags.ClassMember, dictType));

        // If this dataclass derived from a NamedTuple, update the NamedTuple with
        // the specialized entry types.
        updateNamedTupleBaseClass(
            classType,
            fullDataClassEntries.map((entry) => entry.type),
            /* isTypeArgumentExplicit */ true
        );
    }

    function synthesizeTypedDictClassMethods(node: ClassNode | ExpressionNode, classType: ClassType) {
        assert(ClassType.isTypedDictClass(classType));

        // Synthesize a __new__ method.
        const newType = FunctionType.createInstance(
            '__new__',
            '',
            FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
        );
        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType,
        });
        FunctionType.addDefaultParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        // Synthesize an __init__ method.
        const initType = FunctionType.createInstance('__init__', '', FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
        });
        initType.details.declaredReturnType = NoneType.createInstance();

        // All parameters must be named, so insert an empty "*".
        FunctionType.addParameter(initType, {
            category: ParameterCategory.VarArgList,
            type: AnyType.create(),
        });

        const entries = getTypedDictMembersForClass(classType);
        entries.forEach((entry, name) => {
            FunctionType.addParameter(initType, {
                category: ParameterCategory.Simple,
                name,
                hasDefault: !entry.isRequired,
                type: entry.valueType,
            });
        });

        const symbolTable = classType.details.fields;
        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

        const strClass = getBuiltInType(node, 'str');
        // Synthesize a "get" method for each named entry.
        if (isClass(strClass)) {
            const createGetFunction = (keyType: Type, valueType: Type) => {
                const getOverload = FunctionType.createInstance(
                    'get',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'self',
                    type: ObjectType.create(classType),
                });
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    hasDeclaredType: true,
                    type: keyType,
                });
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    hasDeclaredType: true,
                    type: valueType,
                    hasDefault: true,
                });
                getOverload.details.declaredReturnType = valueType;
                return getOverload;
            };

            const getOverloads: FunctionType[] = [];

            entries.forEach((entry, name) => {
                const getOverload = createGetFunction(
                    ObjectType.create(ClassType.cloneWithLiteral(strClass, name)),
                    entry.valueType
                );
                getOverloads.push(getOverload);
            });

            // Provide a final overload for 'get' that handles the general case
            // where the key is a str but the literal value isn't known.
            const getOverload = createGetFunction(ObjectType.create(strClass), UnknownType.create());
            getOverloads.push(getOverload);

            const getMethod = OverloadedFunctionType.create(getOverloads);
            symbolTable.set('get', Symbol.createWithType(SymbolFlags.ClassMember, getMethod));
        }
    }

    function getTypingType(node: ParseNode, symbolName: string): Type | undefined {
        const fileInfo = getFileInfo(node);
        const typingImportPath = fileInfo.typingModulePath;
        if (!typingImportPath) {
            return undefined;
        }

        const lookupResult = importLookup(typingImportPath);
        if (!lookupResult) {
            return undefined;
        }

        const symbol = lookupResult.symbolTable.get(symbolName);
        if (!symbol) {
            return undefined;
        }

        return getEffectiveTypeOfSymbol(symbol);
    }

    function isNodeReachable(node: ParseNode): boolean {
        const flowNode = AnalyzerNodeInfo.getFlowNode(node);
        if (!flowNode) {
            return true;
        }

        return isFlowNodeReachable(flowNode);
    }

    function isAfterNodeReachable(node: ParseNode): boolean {
        const returnFlowNode = AnalyzerNodeInfo.getAfterFlowNode(node);
        if (!returnFlowNode) {
            return false;
        }

        return isFlowNodeReachable(returnFlowNode);
    }

    // Determines whether there is a code flow path from sourceNode to sinkNode.
    function isFlowPathBetweenNodes(sourceNode: ParseNode, sinkNode: ParseNode) {
        const sourceFlowNode = AnalyzerNodeInfo.getFlowNode(sourceNode);
        const sinkFlowNode = AnalyzerNodeInfo.getFlowNode(sinkNode);
        if (!sourceFlowNode || !sinkFlowNode) {
            return false;
        }
        if (sourceFlowNode === sinkFlowNode) {
            return true;
        }

        return isFlowNodeReachable(sinkFlowNode, sourceFlowNode);
    }

    // Determines whether the specified string literal is part
    // of a Literal['xxx'] statement. If so, we will not treat
    // the string as a normal forward-declared type annotation.
    function isAnnotationLiteralValue(node: StringListNode): boolean {
        if (node.parent && node.parent.nodeType === ParseNodeType.IndexItems) {
            const indexItemsNode = node.parent;
            if (indexItemsNode.parent && indexItemsNode.parent.nodeType === ParseNodeType.Index) {
                const indexNode = indexItemsNode.parent;
                const baseType = getTypeOfExpression(indexNode.baseExpression).type;
                if (baseType && isClass(baseType)) {
                    if (ClassType.isSpecialBuiltIn(baseType, 'Literal')) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function addInformation(message: string, node: ParseNode, range?: TextRange) {
        return addDiagnosticWithSuppressionCheck('information', message, node, range);
    }

    function addWarning(message: string, node: ParseNode, range?: TextRange) {
        return addDiagnosticWithSuppressionCheck('warning', message, node, range);
    }

    function addError(message: string, node: ParseNode, range?: TextRange) {
        return addDiagnosticWithSuppressionCheck('error', message, node, range);
    }

    function addUnusedCode(node: ParseNode, textRange: TextRange) {
        if (!isDiagnosticSuppressedForNode(node)) {
            const fileInfo = getFileInfo(node);
            fileInfo.diagnosticSink.addUnusedCodeWithTextRange(Localizer.Diagnostic.unreachableCode(), textRange);
        }
    }

    function addDiagnosticWithSuppressionCheck(
        diagLevel: DiagnosticLevel,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) {
        if (!isDiagnosticSuppressedForNode(node)) {
            const fileInfo = getFileInfo(node);
            return fileInfo.diagnosticSink.addDiagnosticWithTextRange(diagLevel, message, range || node);
        }

        return undefined;
    }

    function isDiagnosticSuppressedForNode(node: ParseNode) {
        return isDiagnosticSuppressed || isSpeculativeMode(node) || incompleteTypeTracker.isIncompleteTypeMode();
    }

    function addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, node: ParseNode) {
        if (diagLevel === 'none') {
            return undefined;
        }

        const diagnostic = addDiagnosticWithSuppressionCheck(diagLevel, message, node);
        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    function addDiagnosticForTextRange(
        fileInfo: AnalyzerFileInfo,
        diagLevel: DiagnosticLevel,
        rule: string,
        message: string,
        range: TextRange
    ) {
        if (diagLevel === 'none') {
            return undefined;
        }

        const diagnostic = fileInfo.diagnosticSink.addDiagnosticWithTextRange(diagLevel, message, range);
        diagnostic.setRule(rule);

        return diagnostic;
    }

    function addExpectedClassDiagnostic(type: Type, node: ParseNode) {
        const fileInfo = getFileInfo(node);
        const diag = new DiagnosticAddendum();
        if (type.category === TypeCategory.Union) {
            type.subtypes.forEach((subtype) => {
                if (!TypeBase.isInstantiable(subtype)) {
                    diag.addMessage(Localizer.DiagnosticAddendum.typeNotClass().format({ type: printType(subtype) }));
                }
            });
        }

        addDiagnostic(
            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.Diagnostic.typeExpectedClass().format({ type: printType(type) }) + diag.getString(),
            node
        );
    }

    function assignTypeToNameNode(
        nameNode: NameNode,
        type: Type,
        srcExpression?: ParseNode,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        const nameValue = nameNode.value;

        const symbolWithScope = lookUpSymbolRecursive(nameNode, nameValue, /* honorCodeFlow */ false);
        if (!symbolWithScope) {
            // This can happen when we are evaluating a piece of code that was
            // determined to be unreachable by the binder.
            return;
        }

        const declarations = symbolWithScope.symbol.getDeclarations();
        const declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol);
        const fileInfo = getFileInfo(nameNode);

        // We found an existing declared type. Make sure the type is assignable.
        let destType = type;
        if (declaredType && srcExpression) {
            let diagAddendum = new DiagnosticAddendum();

            if (!canAssignType(declaredType, type, diagAddendum)) {
                // If there was an expected type mismatch, use that diagnostic
                // addendum because it will be more informative.
                if (expectedTypeDiagAddendum) {
                    diagAddendum = expectedTypeDiagAddendum;
                }

                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeAssignmentMismatch().format({
                        sourceType: printType(type),
                        destType: printType(declaredType),
                    }) + diagAddendum.getString(),
                    srcExpression || nameNode
                );

                // If the user has requested that no general type issues be
                // reported, don't replace the destType with the declaredType
                // because they won't understand why subsequent errors are
                // generated.
                if (fileInfo.diagnosticRuleSet.reportGeneralTypeIssues !== 'none') {
                    destType = declaredType;
                }
            } else {
                // Constrain the resulting type to match the declared type.
                destType = narrowDeclaredTypeBasedOnAssignedType(declaredType, type);
            }
        } else {
            // If this is a member name (within a class scope) and the member name
            // appears to be a constant, use the strict source type. If it's a member
            // variable that can be overridden by a child class, use the more general
            // version by stripping off the literal.
            const scope = ScopeUtils.getScopeForNode(nameNode);
            if (scope?.type === ScopeType.Class) {
                const isConstant = isConstantName(nameValue);
                const isPrivate = isPrivateOrProtectedName(nameValue);

                if (
                    !isConstant &&
                    (!isPrivate || getFileInfo(nameNode).diagnosticRuleSet.reportPrivateUsage === 'none')
                ) {
                    destType = stripLiteralValue(destType);
                }
            }
        }

        const varDecl: Declaration | undefined = declarations.find((decl) => decl.type === DeclarationType.Variable);

        if (varDecl && varDecl.type === DeclarationType.Variable && srcExpression) {
            if (varDecl.isConstant) {
                // A constant variable can be assigned only once. If this
                // isn't the first assignment, generate an error.
                if (nameNode !== declarations[0].node) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportConstantRedefinition,
                        DiagnosticRule.reportConstantRedefinition,
                        Localizer.Diagnostic.constantRedefinition().format({ name: nameValue }),
                        nameNode
                    );
                }
            }
        }

        writeTypeCache(nameNode, destType);
    }

    function assignTypeToMemberAccessNode(
        target: MemberAccessNode,
        type: Type,
        srcExpr?: ExpressionNode,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        const baseTypeResult = getTypeOfExpression(target.leftExpression);
        const baseType = makeTypeVarsConcrete(baseTypeResult.type);

        // Handle member accesses (e.g. self.x or cls.y).
        if (target.leftExpression.nodeType === ParseNodeType.Name) {
            // Determine whether we're writing to a class or instance member.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

            if (enclosingClassNode) {
                const classTypeResults = getTypeOfClass(enclosingClassNode);

                if (classTypeResults && isClass(classTypeResults.classType)) {
                    if (isObject(baseType)) {
                        if (ClassType.isSameGenericClass(baseType.classType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, true, srcExpr);
                        }
                    } else if (isClass(baseType)) {
                        if (ClassType.isSameGenericClass(baseType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, false, srcExpr);
                        }
                    }

                    // Assignments to instance or class variables through "self" or "cls" is not
                    // allowed for protocol classes.
                    if (ClassType.isProtocolClass(classTypeResults.classType)) {
                        addError(Localizer.Diagnostic.assignmentInProtocol(), target.memberName);
                    }
                }
            }
        }

        getTypeFromMemberAccessWithBaseType(
            target,
            baseTypeResult,
            { method: 'set', setType: type, setErrorNode: srcExpr, setExpectedTypeDiag: expectedTypeDiagAddendum },
            EvaluatorFlags.None
        );

        writeTypeCache(target.memberName, type);
        writeTypeCache(target, type);
    }

    function assignTypeToMemberVariable(
        node: MemberAccessNode,
        srcType: Type,
        isInstanceMember: boolean,
        srcExprNode?: ExpressionNode
    ) {
        const memberName = node.memberName.value;
        const fileInfo = getFileInfo(node);

        const classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        const classTypeInfo = getTypeOfClass(classDef);
        if (classTypeInfo && isClass(classTypeInfo.classType)) {
            let memberInfo = lookUpClassMember(
                classTypeInfo.classType,
                memberName,
                isInstanceMember ? ClassMemberLookupFlags.Default : ClassMemberLookupFlags.SkipInstanceVariables
            );

            const memberFields = classTypeInfo.classType.details.fields;
            if (memberInfo) {
                // Are we accessing an existing member on this class, or is
                // it a member on a parent class?
                const isThisClass =
                    isClass(memberInfo.classType) &&
                    ClassType.isSameGenericClass(classTypeInfo.classType, memberInfo.classType);

                if (isThisClass && memberInfo.isInstanceMember === isInstanceMember) {
                    const symbol = memberFields.get(memberName)!;
                    assert(symbol !== undefined);

                    const typedDecls = symbol.getDeclarations();
                    let isFinalVar = isFinalVariable(symbol);

                    // Check for an attempt to overwrite a constant or final member variable.
                    if (
                        typedDecls.length > 0 &&
                        typedDecls[0].type === DeclarationType.Variable &&
                        srcExprNode &&
                        node.memberName !== typedDecls[0].node
                    ) {
                        if (typedDecls[0].isConstant) {
                            addDiagnostic(
                                fileInfo.diagnosticRuleSet.reportConstantRedefinition,
                                DiagnosticRule.reportConstantRedefinition,
                                Localizer.Diagnostic.constantRedefinition().format({ name: node.memberName.value }),
                                node.memberName
                            );
                        }

                        // If a Final instance variable is declared in the class body but is
                        // being assigned within an __init__ method, it's allowed.
                        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
                        if (enclosingFunctionNode && enclosingFunctionNode.name.value === '__init__') {
                            isFinalVar = false;
                        }

                        if (isFinalVar) {
                            addError(
                                Localizer.Diagnostic.finalReassigned().format({ name: node.memberName.value }),
                                node.memberName
                            );
                        }
                    }
                } else {
                    // Is the target a property?
                    const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol);
                    if (declaredType && !isProperty(declaredType)) {
                        // Handle the case where there is a class variable defined with the same
                        // name, but there's also now an instance variable introduced. Combine the
                        // type of the class variable with that of the new instance variable.
                        if (!memberInfo.isInstanceMember && isInstanceMember) {
                            // The class variable is accessed in this case.
                            setSymbolAccessed(fileInfo, memberInfo.symbol, node.memberName);
                            const memberType = getTypeOfMember(memberInfo);
                            srcType = combineTypes([srcType, memberType]);
                        }
                    }
                }
            }

            // Look up the member info again, now that we've potentially updated it.
            memberInfo = lookUpClassMember(
                classTypeInfo.classType,
                memberName,
                ClassMemberLookupFlags.DeclaredTypesOnly
            );

            if (!memberInfo && srcExprNode) {
                reportPossibleUnknownAssignment(
                    fileInfo.diagnosticRuleSet.reportUnknownMemberType,
                    DiagnosticRule.reportUnknownMemberType,
                    node.memberName,
                    srcType,
                    node
                );
            }
        }
    }

    function assignTypeToTupleNode(target: TupleNode, type: Type, srcExpr?: ExpressionNode) {
        // Initialize the array of target types, one for each target.
        const targetTypes: Type[][] = new Array(target.expressions.length);
        for (let i = 0; i < target.expressions.length; i++) {
            targetTypes[i] = [];
        }

        // Do any of the targets use an unpack operator? If so, it will consume all of the
        // entries at that location.
        const unpackIndex = target.expressions.findIndex((expr) => expr.nodeType === ParseNodeType.Unpack);

        doForSubtypes(type, (subtype) => {
            // Is this subtype a tuple?
            const tupleType = getSpecializedTupleType(subtype);
            if (tupleType && tupleType.typeArguments) {
                const sourceEntryTypes = tupleType.typeArguments;
                const sourceEntryCount = sourceEntryTypes.length;

                // Is this a homogenous tuple of indeterminate length?
                if (sourceEntryCount === 2 && isEllipsisType(sourceEntryTypes[1])) {
                    for (let index = 0; index < target.expressions.length; index++) {
                        targetTypes[index].push(sourceEntryTypes[0]);
                    }
                } else {
                    let sourceIndex = 0;
                    let targetIndex = 0;
                    for (targetIndex = 0; targetIndex < target.expressions.length; targetIndex++) {
                        if (targetIndex === unpackIndex) {
                            // Consume as many source entries as necessary to
                            // make the remaining tuple entry counts match.
                            const remainingTargetEntries = target.expressions.length - targetIndex - 1;
                            const remainingSourceEntries = sourceEntryCount - sourceIndex;
                            let entriesToPack = Math.max(remainingSourceEntries - remainingTargetEntries, 0);
                            while (entriesToPack > 0) {
                                targetTypes[targetIndex].push(sourceEntryTypes[sourceIndex]);
                                sourceIndex++;
                                entriesToPack--;
                            }
                        } else {
                            if (sourceIndex >= sourceEntryCount) {
                                // No more source entries to assign.
                                break;
                            }

                            targetTypes[targetIndex].push(sourceEntryTypes[sourceIndex]);
                            sourceIndex++;
                        }
                    }

                    // Have we accounted for all of the targets and sources? If not, we have a size mismatch.
                    if (targetIndex < target.expressions.length || sourceIndex < sourceEntryCount) {
                        const fileInfo = getFileInfo(target);
                        const expectedEntryCount =
                            unpackIndex >= 0 ? target.expressions.length - 1 : target.expressions.length;
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.tupleSizeMismatch().format({
                                expected: expectedEntryCount,
                                received: sourceEntryCount,
                            }),
                            target
                        );
                    }
                }
            } else {
                // The assigned expression isn't a tuple, so it had better
                // be some iterable type.
                const iterableType = getTypeFromIterable(
                    subtype,
                    /* isAsync */ false,
                    srcExpr,
                    /* supportGetItem */ false
                );
                for (let index = 0; index < target.expressions.length; index++) {
                    targetTypes[index].push(iterableType);
                }
            }

            // We need to return something to satisfy doForSubtypes.
            return undefined;
        });

        // Assign the resulting types to the individual names in the tuple target expression.
        target.expressions.forEach((expr, index) => {
            const typeList = targetTypes[index];
            let targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);

            // If the target uses an unpack operator, wrap the target type in a list.
            if (index === unpackIndex) {
                const listType = getBuiltInType(expr, 'List');
                if (isClass(listType)) {
                    targetType = ObjectType.create(
                        ClassType.cloneForSpecialization(listType, [targetType], /* isTypeArgumentExplicit */ false)
                    );
                }
            }

            assignTypeToExpression(expr, targetType, srcExpr);
        });

        writeTypeCache(target, type);
    }

    function assignTypeToExpression(
        target: ExpressionNode,
        type: Type,
        srcExpr?: ExpressionNode,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        // Is the source expression a TypeVar() call?
        if (isTypeVar(type)) {
            if (srcExpr && srcExpr.nodeType === ParseNodeType.Call) {
                const callType = getTypeOfExpression(srcExpr.leftExpression).type;
                if (
                    isClass(callType) &&
                    (ClassType.isBuiltIn(callType, 'TypeVar') || ClassType.isBuiltIn(callType, 'ParamSpec'))
                ) {
                    if (target.nodeType !== ParseNodeType.Name || target.value !== type.details.name) {
                        addError(
                            type.details.isParamSpec
                                ? Localizer.Diagnostic.paramSpecAssignedName().format({ name: type.details.name })
                                : Localizer.Diagnostic.typeVarAssignedName().format({ name: type.details.name }),
                            target
                        );
                    }
                }
            }
        }

        // If the type was partially unbound, an error will have already been logged.
        // Remove the unbound before assigning to the target expression so the unbound
        // error doesn't propagate.
        type = removeUnboundFromUnion(type);

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target;
                // Handle '__all__' as a special case in the module scope.
                if (name.value === '__all__' && srcExpr) {
                    const scope = ScopeUtils.getScopeForNode(target);
                    if (scope?.type === ScopeType.Module) {
                        // It's common for modules to include the expression
                        // __all__ = ['a', 'b', 'c']
                        // We will mark the symbols referenced by these strings as accessed.
                        if (srcExpr.nodeType === ParseNodeType.List) {
                            const fileInfo = getFileInfo(target);
                            srcExpr.entries.forEach((entryExpr) => {
                                if (
                                    entryExpr.nodeType === ParseNodeType.StringList ||
                                    entryExpr.nodeType === ParseNodeType.String
                                ) {
                                    const symbolName =
                                        entryExpr.nodeType === ParseNodeType.String
                                            ? entryExpr.value
                                            : entryExpr.strings.map((s) => s.value).join('');
                                    const symbolInScope = scope.lookUpSymbolRecursive(symbolName);
                                    if (symbolInScope) {
                                        setSymbolAccessed(fileInfo, symbolInScope.symbol, target);
                                    }
                                }
                            });
                        }
                    }
                }

                reportPossibleUnknownAssignment(
                    getFileInfo(target).diagnosticRuleSet.reportUnknownVariableType,
                    DiagnosticRule.reportUnknownVariableType,
                    target,
                    type,
                    target
                );

                assignTypeToNameNode(target, type, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.MemberAccess: {
                assignTypeToMemberAccessNode(target, type, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(
                    target.baseExpression,
                    undefined,
                    EvaluatorFlags.DoNotSpecialize
                );

                const indexTypeResult = getTypeFromIndexWithBaseType(
                    target,
                    baseTypeResult.type,
                    {
                        method: 'set',
                        setType: type,
                        setErrorNode: srcExpr,
                        setExpectedTypeDiag: expectedTypeDiagAddendum,
                    },
                    EvaluatorFlags.None
                );

                writeTypeCache(target, indexTypeResult.type);
                break;
            }

            case ParseNodeType.Tuple: {
                assignTypeToTupleNode(target, type, srcExpr);
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                const typeHintType = getTypeOfAnnotation(
                    target.typeAnnotation,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(target.valueExpression)
                );
                const diagAddendum = new DiagnosticAddendum();
                if (canAssignType(typeHintType, type, diagAddendum)) {
                    // Don't attempt to narrow based on the annotated type if the type
                    // is a enum because the annotated type in an enum doesn't reflect
                    // the type of the symbol.
                    if (!isObject(type) || !ClassType.isEnumClass(type.classType)) {
                        type = narrowDeclaredTypeBasedOnAssignedType(typeHintType, type);
                    }
                }

                assignTypeToExpression(target.valueExpression, type, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.Unpack: {
                if (target.expression.nodeType === ParseNodeType.Name) {
                    assignTypeToNameNode(target.expression, type, srcExpr);
                }
                break;
            }

            case ParseNodeType.List: {
                // The assigned expression had better be some iterable type.
                const iteratedType = getTypeFromIterable(
                    type,
                    /* isAsync */ false,
                    srcExpr,
                    /* supportGetItem */ false
                );

                target.entries.forEach((entry) => {
                    assignTypeToExpression(entry, iteratedType, srcExpr);
                });
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                suppressDiagnostics(() => {
                    if (target.child) {
                        getTypeOfExpression(target.child);
                    }
                });
                break;
            }

            default: {
                const fileInfo = getFileInfo(target);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.assignmentTargetExpr(),
                    target
                );
                break;
            }
        }
    }

    function verifyRaiseExceptionType(node: RaiseNode) {
        const baseExceptionType = getBuiltInType(node, 'BaseException');

        if (node.typeExpression) {
            const exceptionType = getType(node.typeExpression);

            // Validate that the argument of "raise" is an exception object or class.
            // If it is a class, validate that the class's constructor accepts zero
            // arguments.
            if (exceptionType && baseExceptionType && isClass(baseExceptionType)) {
                const diagAddendum = new DiagnosticAddendum();

                doForSubtypes(exceptionType, (subtype) => {
                    if (!isAnyOrUnknown(subtype)) {
                        if (isClass(subtype)) {
                            if (!derivesFromClassRecursive(subtype, baseExceptionType, /* ignoreUnknown */ false)) {
                                diagAddendum.addMessage(
                                    Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                        type: printType(subtype, /* expandTypeAlias */ false),
                                    })
                                );
                            } else {
                                let callResult: CallResult | undefined;
                                suppressDiagnostics(() => {
                                    callResult = validateConstructorArguments(
                                        node.typeExpression!,
                                        [],
                                        subtype,
                                        /* skipUnknownArgCheck */ false,
                                        /* expectedType */ undefined
                                    );
                                });

                                if (callResult && callResult.argumentErrors) {
                                    diagAddendum.addMessage(
                                        Localizer.Diagnostic.exceptionTypeNotInstantiable().format({
                                            type: printType(subtype, /* expandTypeAlias */ false),
                                        })
                                    );
                                }
                            }
                        } else if (isObject(subtype)) {
                            if (
                                !derivesFromClassRecursive(
                                    subtype.classType,
                                    baseExceptionType,
                                    /* ignoreUnknown */ false
                                )
                            ) {
                                diagAddendum.addMessage(
                                    Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                        type: printType(subtype, /* expandTypeAlias */ false),
                                    })
                                );
                            }
                        } else {
                            diagAddendum.addMessage(
                                Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                    type: printType(subtype, /* expandTypeAlias */ false),
                                })
                            );
                        }
                    }

                    return subtype;
                });

                if (!diagAddendum.isEmpty()) {
                    const fileInfo = getFileInfo(node);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.expectedExceptionClass() + diagAddendum.getString(),
                        node.typeExpression
                    );
                }
            }
        }
    }

    function verifyDeleteExpression(node: ExpressionNode) {
        switch (node.nodeType) {
            case ParseNodeType.Name: {
                // Get the type to evaluate whether it's bound
                // and to mark it accessed.
                getTypeOfExpression(node);
                break;
            }

            case ParseNodeType.MemberAccess: {
                const baseTypeResult = getTypeOfExpression(node.leftExpression);
                const memberType = getTypeFromMemberAccessWithBaseType(
                    node,
                    baseTypeResult,
                    { method: 'del' },
                    EvaluatorFlags.None
                );
                writeTypeCache(node.memberName, memberType.type);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(
                    node.baseExpression,
                    undefined,
                    EvaluatorFlags.DoNotSpecialize
                );
                getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'del' }, EvaluatorFlags.None);
                writeTypeCache(node, UnboundType.create());
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                suppressDiagnostics(() => {
                    if (node.child) {
                        getTypeOfExpression(node.child);
                    }
                });
                break;
            }

            default: {
                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.delTargetExpr(),
                    node
                );
                break;
            }
        }
    }

    function setSymbolAccessed(fileInfo: AnalyzerFileInfo, symbol: Symbol, node: ParseNode) {
        if (!isSpeculativeMode(node) && !incompleteTypeTracker.isIncompleteTypeMode()) {
            fileInfo.accessedSymbolMap.set(symbol.id, true);
        }
    }

    // Builds a sorted list of dataclass entries that are inherited by
    // the specified class. These entries must be unique and in reverse-MRO
    // order. Returns true if all of the class types in the hierarchy are
    // known, false if one or more are unknown.
    function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
        let allAncestorsAreKnown = true;

        for (let i = classType.details.mro.length - 1; i >= 0; i--) {
            const mroClass = classType.details.mro[i];

            if (isClass(mroClass)) {
                const dataClassEntries = ClassType.getDataClassEntries(mroClass);

                // Add the entries to the end of the list, replacing same-named
                // entries if found.
                dataClassEntries.forEach((entry) => {
                    const existingIndex = entries.findIndex((e) => e.name === entry.name);
                    if (existingIndex >= 0) {
                        entries[existingIndex] = entry;
                    } else {
                        entries.push(entry);
                    }
                });
            } else {
                allAncestorsAreKnown = false;
            }
        }
        return allAncestorsAreKnown;
    }

    function getReturnTypeFromGenerator(type: Type): Type | undefined {
        if (isAnyOrUnknown(type)) {
            return type;
        }

        if (isObject(type)) {
            // Is this a Generator? If so, return the third
            // type argument, which is the await response type.
            const classType = type.classType;
            if (ClassType.isBuiltIn(classType, 'Generator')) {
                const typeArgs = classType.typeArguments;
                if (typeArgs && typeArgs.length >= 3) {
                    return typeArgs[2];
                }
            }
        }

        return undefined;
    }

    function getSpecializedReturnType(objType: ObjectType, memberName: string, errorNode: ParseNode | undefined) {
        const classMember = lookUpObjectMember(objType, memberName, ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (memberType.category === TypeCategory.Function) {
            const methodType = bindFunctionToClassOrObject(
                objType,
                memberType,
                /* treatAsClassMember */ false,
                errorNode
            );
            if (methodType) {
                return getFunctionEffectiveReturnType(methodType as FunctionType);
            }
        }

        return undefined;
    }

    // This is similar to _getSpecializedReturnType except that
    // the method lookup occurs on a metaclass rather than
    // the object that derives from it.
    function getSpecializedReturnTypeForMetaclassMethod(
        metaclass: ClassType,
        classType: ClassType,
        memberName: string,
        errorNode: ParseNode | undefined
    ) {
        const classMember = lookUpObjectMember(
            ObjectType.create(metaclass),
            memberName,
            ClassMemberLookupFlags.SkipInstanceVariables
        );
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (memberType.category === TypeCategory.Function) {
            const methodType = bindFunctionToClassOrObject(
                classType,
                memberType,
                /* treatAsClassMember */ true,
                errorNode
            );
            if (methodType) {
                return getFunctionEffectiveReturnType(methodType as FunctionType);
            }
        }

        return undefined;
    }

    function getTypeFromName(node: NameNode, flags: EvaluatorFlags): TypeResult {
        const fileInfo = getFileInfo(node);
        const name = node.value;
        let type: Type | undefined;
        let isResolutionCyclical = false;
        const allowForwardReferences = (flags & EvaluatorFlags.AllowForwardReferences) !== 0;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = lookUpSymbolRecursive(node, name, !allowForwardReferences);

        if (symbolWithScope) {
            let useCodeFlowAnalysis = !allowForwardReferences;

            // If the symbol is implicitly imported from the builtin
            // scope, there's no need to use code flow analysis.
            if (symbolWithScope.scope.type === ScopeType.Builtin) {
                useCodeFlowAnalysis = false;
            }

            if (fileInfo.isStubFile) {
                // Type stubs allow forward references of classes, so
                // don't use code flow analysis in this case.
                const decl = getLastTypedDeclaredForSymbol(symbolWithScope.symbol);
                if (decl && decl.type === DeclarationType.Class) {
                    useCodeFlowAnalysis = false;
                }
            }

            const symbol = symbolWithScope.symbol;

            // Get the effective type (either the declared type or the inferred type).
            // If we're using code flow analysis, pass the usage node so we consider
            // only the assignment nodes that are reachable from this usage.
            const effectiveTypeInfo = getEffectiveTypeOfSymbolForUsage(symbol, useCodeFlowAnalysis ? node : undefined);
            const effectiveType = effectiveTypeInfo.type;

            if (effectiveTypeInfo.isResolutionCyclical) {
                isResolutionCyclical = true;
            }

            const isSpecialBuiltIn =
                !!effectiveType && isClass(effectiveType) && ClassType.isSpecialBuiltIn(effectiveType);

            type = effectiveType;
            if (useCodeFlowAnalysis && !isSpecialBuiltIn) {
                // See if code flow analysis can tell us anything more about the type.
                // If the symbol is declared outside of our execution scope, use its effective
                // type. If it's declared inside our execution scope, it generally starts
                // as unbound at the start of the code flow.
                const typeAtStart =
                    symbolWithScope.isBeyondExecutionScope || !symbol.isInitiallyUnbound()
                        ? effectiveType
                        : UnboundType.create();
                const codeFlowType = getFlowTypeOfReference(node, symbol.id, typeAtStart);
                if (codeFlowType) {
                    type = codeFlowType;
                }
            }

            if (!(flags & EvaluatorFlags.DoNotSpecialize)) {
                if (isClass(type)) {
                    if (
                        (flags & EvaluatorFlags.ExpectingType) !== 0 &&
                        (flags & EvaluatorFlags.AllowMissingTypeArgs) === 0
                    ) {
                        if (requiresTypeArguments(type) && !type.typeArguments) {
                            addDiagnostic(
                                fileInfo.diagnosticRuleSet.reportMissingTypeArgument,
                                DiagnosticRule.reportMissingTypeArgument,
                                Localizer.Diagnostic.typeArgsMissingForClass().format({
                                    name: type.details.name,
                                }),
                                node
                            );
                        }
                    }
                    if (!type.typeArguments) {
                        type = createSpecializedClassType(type, undefined, flags, node);
                    }
                } else if (isObject(type)) {
                    // If this is an object that contains a Type[X], transform it
                    // into class X.
                    const typeType = getClassFromPotentialTypeObject(type);
                    if (typeType) {
                        type = typeType;
                    }
                } else if (
                    (flags & EvaluatorFlags.ExpectingType) !== 0 &&
                    type.typeAliasInfo &&
                    type.typeAliasInfo.typeParameters &&
                    type.typeAliasInfo.typeParameters.length > 0 &&
                    !type.typeAliasInfo.typeArguments
                ) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportMissingTypeArgument,
                        DiagnosticRule.reportMissingTypeArgument,
                        Localizer.Diagnostic.typeArgsMissingForAlias().format({
                            name: type.typeAliasInfo.aliasName,
                        }),
                        node
                    );
                }
            }

            // If there is a resolution cycle, don't report it as an unbound symbol
            // at this time. It will be re-evaluated as the call stack unwinds, and
            // its actual type will be known then.
            if (!isResolutionCyclical) {
                if (isUnbound(type)) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUnboundVariable,
                        DiagnosticRule.reportUnboundVariable,
                        Localizer.Diagnostic.symbolIsUnbound().format({ name }),
                        node
                    );
                } else if (isPossiblyUnbound(type)) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUnboundVariable,
                        DiagnosticRule.reportUnboundVariable,
                        Localizer.Diagnostic.symbolIsPossiblyUnbound().format({ name }),
                        node
                    );
                }
            }

            setSymbolAccessed(fileInfo, symbol, node);
        } else {
            // Handle the special case of "reveal_type".
            if (name !== 'reveal_type') {
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportUndefinedVariable,
                    DiagnosticRule.reportUndefinedVariable,
                    Localizer.Diagnostic.symbolIsUndefined().format({ name }),
                    node
                );
            }
            type = UnknownType.create();
        }

        if (isTypeVar(type) && type.details.isParamSpec) {
            if (flags & EvaluatorFlags.ParamSpecDisallowed) {
                addError(Localizer.Diagnostic.paramSpecContext(), node);
            }
        }

        if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
            if ((flags & EvaluatorFlags.GenericClassTypeAllowed) === 0) {
                if (isClass(type) && ClassType.isBuiltIn(type, 'Generic')) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.genericNotAllowed(),
                        node
                    );
                }
            }
        }

        // If this is a TypeVar, try to match it against a TypeVar
        // defined by an enclosing scope (either a class or function).
        if (isTypeVar(type) && TypeBase.isInstantiable(type)) {
            type = findScopedTypeVar(node, type);
            if ((flags & EvaluatorFlags.DisallowTypeVarsWithScopeId) !== 0 && type.scopeId) {
                if (!type.details.isSynthesized && !type.details.isParamSpec) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeVarUsedByOuterScope().format({ name: type.details.name }),
                        node
                    );
                }
            } else if ((flags & EvaluatorFlags.AssociateTypeVarsWithCurrentScope) !== 0) {
                if (!type.scopeId) {
                    const enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(node);
                    if (enclosingScope) {
                        type = TypeVarType.cloneForScopeId(type, enclosingScope.id);
                    } else {
                        fail('AssociateTypeVarsWithCurrentScope flag was set but enclosing scope not found');
                    }
                }
            } else if ((flags & EvaluatorFlags.DisallowTypeVarsWithoutScopeId) !== 0) {
                if (!type.scopeId && !type.details.isSynthesized && !type.details.isParamSpec) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeVarNotUsedByOuterScope().format({ name: type.details.name }),
                        node
                    );
                }
            }
        }

        return { type, node, isResolutionCyclical };
    }

    // Walks up the parse tree to find a function or class that provides
    // the context for a type variable.
    function findScopedTypeVar(node: NameNode, type: TypeVarType): TypeVarType {
        let curNode: ParseNode | undefined = node;

        assert(TypeBase.isInstantiable(type));

        while (curNode) {
            curNode = ParseTreeUtils.getTypeVarScopeNode(curNode);
            if (!curNode) {
                break;
            }

            let typeVarsForScope: TypeVarType[] | undefined;

            if (curNode.nodeType === ParseNodeType.Class) {
                const classTypeInfo = getTypeOfClass(curNode);
                if (classTypeInfo) {
                    typeVarsForScope = classTypeInfo.classType.details.typeParameters;
                }
            } else if (curNode.nodeType === ParseNodeType.Function) {
                const functionTypeInfo = getTypeOfFunction(curNode);
                if (functionTypeInfo) {
                    typeVarsForScope = [];
                    functionTypeInfo.functionType.details.parameters.forEach((param) => {
                        if (param.hasDeclaredType) {
                            addTypeVarsToListIfUnique(typeVarsForScope!, getTypeVarArgumentsRecursive(param.type));
                        }
                    });
                }
            } else if (curNode.nodeType === ParseNodeType.Module) {
                break;
            }

            if (typeVarsForScope) {
                const match = typeVarsForScope.find((typeVar) => typeVar.details.name === type.details.name);

                if (match) {
                    return convertToInstantiable(match) as TypeVarType;
                }
            }

            curNode = curNode.parent;
        }

        // Return the original type.
        return type;
    }

    function getTypeFromMemberAccess(node: MemberAccessNode, flags: EvaluatorFlags): TypeResult {
        const baseTypeFlags =
            EvaluatorFlags.DoNotSpecialize |
            (flags & (EvaluatorFlags.ExpectingType | EvaluatorFlags.AllowForwardReferences));
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, baseTypeFlags);
        const memberTypeResult = getTypeFromMemberAccessWithBaseType(node, baseTypeResult, { method: 'get' }, flags);

        if (isCodeFlowSupportedForReference(node)) {
            // Before performing code flow analysis, update the cache to prevent recursion.
            writeTypeCache(node, memberTypeResult.type);
            writeTypeCache(node.memberName, memberTypeResult.type);

            // If the type is initially unbound, see if there's a parent class that
            // potentially initialized the value.
            let initialType = memberTypeResult.type;
            if (isUnbound(initialType)) {
                const baseType = makeTypeVarsConcrete(baseTypeResult.type);

                let classMemberInfo: ClassMember | undefined;
                if (isClass(baseType)) {
                    classMemberInfo = lookUpClassMember(
                        baseType,
                        node.memberName.value,
                        ClassMemberLookupFlags.SkipOriginalClass
                    );
                } else if (isObject(baseType)) {
                    classMemberInfo = lookUpObjectMember(
                        baseType,
                        node.memberName.value,
                        ClassMemberLookupFlags.SkipOriginalClass
                    );
                }

                if (classMemberInfo) {
                    initialType = getTypeOfMember(classMemberInfo);
                }
            }

            // See if we can refine the type based on code flow analysis.
            const codeFlowType = getFlowTypeOfReference(node, indeterminateSymbolId, initialType);
            if (codeFlowType) {
                memberTypeResult.type = codeFlowType;
            }
        }

        // Cache the type information in the member name node as well.
        writeTypeCache(node.memberName, memberTypeResult.type);

        return memberTypeResult;
    }

    function getTypeFromMemberAccessWithBaseType(
        node: MemberAccessNode,
        baseTypeResult: TypeResult,
        usage: EvaluatorUsage,
        flags: EvaluatorFlags
    ): TypeResult {
        const baseType = baseTypeResult.type;
        const memberName = node.memberName.value;
        let diag = new DiagnosticAddendum();
        const fileInfo = getFileInfo(node);
        let type: Type | undefined;

        switch (baseType.category) {
            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                type = baseType;
                break;
            }

            case TypeCategory.Class: {
                type = getTypeFromClassMember(node.memberName, baseType, memberName, usage, diag);
                break;
            }

            case TypeCategory.TypeVar: {
                if (baseType.details.isParamSpec) {
                    if (memberName === 'args' || memberName === 'kwargs') {
                        return { type: AnyType.create(), node };
                    }
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.paramSpecUnknownMember().format({ name: memberName }),
                        node.memberName
                    );
                    return { type: UnknownType.create(), node };
                }

                return getTypeFromMemberAccessWithBaseType(
                    node,
                    {
                        type: specializeType(baseType, /* typeVarMap */ undefined, /* makeConcrete */ true),
                        node,
                    },
                    usage,
                    EvaluatorFlags.None
                );
            }

            case TypeCategory.Object: {
                const classFromTypeObject = getClassFromPotentialTypeObject(baseType);
                if (classFromTypeObject) {
                    // Handle the case where the object is a 'Type' object, which
                    // represents a class.
                    return getTypeFromMemberAccessWithBaseType(
                        node,
                        { type: classFromTypeObject, node: baseTypeResult.node },
                        usage,
                        flags
                    );
                }

                type = getTypeFromObjectMember(node.memberName, baseType, memberName, usage, diag);
                break;
            }

            case TypeCategory.Module: {
                const symbol = ModuleType.getField(baseType, memberName);
                if (symbol) {
                    if (usage.method === 'get') {
                        setSymbolAccessed(getFileInfo(node), symbol, node.memberName);
                    }

                    type = getEffectiveTypeOfSymbol(symbol);

                    // If the type resolved to "unbound", treat it as "unknown" in
                    // the case of a module reference because if it's truly unbound,
                    // that error will be reported within the module and should not
                    // leak into other modules that import it.
                    if (isUnbound(type)) {
                        type = UnknownType.create();
                    }
                } else {
                    // Does the stub file export a top-level __getattr__ function?
                    if (usage.method === 'get') {
                        const getAttrSymbol = ModuleType.getField(baseType, '__getattr__');
                        if (getAttrSymbol) {
                            const decls = getAttrSymbol.getDeclarations();

                            // Only honor the __getattr__ if it's in a stub file.
                            if (decls.some((decl) => decl.path.toLowerCase().endsWith('.pyi'))) {
                                const getAttrType = getEffectiveTypeOfSymbol(getAttrSymbol);
                                if (getAttrType.category === TypeCategory.Function) {
                                    type = getFunctionEffectiveReturnType(getAttrType);
                                }
                            }
                        }
                    }

                    if (!type) {
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.moduleUnknownMember().format({ name: memberName }),
                            node.memberName
                        );
                        type = UnknownType.create();
                    }
                }
                break;
            }

            case TypeCategory.Union: {
                type = doForSubtypes(baseType, (subtype) => {
                    if (isNone(subtype)) {
                        addDiagnostic(
                            getFileInfo(node).diagnosticRuleSet.reportOptionalMemberAccess,
                            DiagnosticRule.reportOptionalMemberAccess,
                            Localizer.Diagnostic.noneUnknownMember().format({ name: memberName }),
                            node.memberName
                        );
                        return undefined;
                    } else if (isUnbound(subtype)) {
                        // Don't do anything if it's unbound. The error will already
                        // be reported elsewhere.
                        return undefined;
                    } else {
                        const typeResult = getTypeFromMemberAccessWithBaseType(
                            node,
                            {
                                type: subtype,
                                node,
                            },
                            usage,
                            EvaluatorFlags.None
                        );
                        return typeResult.type;
                    }
                });
                break;
            }

            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                // TODO - not yet sure what to do about members of functions,
                // which have associated dictionaries.
                type = AnyType.create();
                break;
            }

            default:
                diag.addMessage(Localizer.DiagnosticAddendum.typeUnsupported().format({ type: printType(baseType) }));
                break;
        }

        if (!type) {
            let diagMessage = Localizer.Diagnostic.memberAccess();
            if (usage.method === 'set') {
                diagMessage = Localizer.Diagnostic.memberSet();
            } else if (usage.method === 'del') {
                diagMessage = Localizer.Diagnostic.memberDelete();
            }

            // If there is an expected type diagnostic addendum (used for assignments),
            // use that rather than the local diagnostic addendum because it will be
            // more informative.
            if (usage.setExpectedTypeDiag) {
                diag = usage.setExpectedTypeDiag;
            }

            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                diagMessage.format({ name: memberName, type: printType(baseType) }) + diag.getString(),
                node.memberName
            );
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (isClass(type) && !type.typeArguments) {
                type = createSpecializedClassType(type, undefined, flags, node);
            }
        }

        if (usage.method === 'get') {
            reportPossibleUnknownAssignment(
                fileInfo.diagnosticRuleSet.reportUnknownMemberType,
                DiagnosticRule.reportUnknownMemberType,
                node.memberName,
                type,
                node
            );
        }

        return { type, node };
    }

    // If the object type is a 'Type' object, converts it to the corresponding
    // class that it represents and returns that class. Otherwise returns undefined.
    function getClassFromPotentialTypeObject(potentialTypeObject: ObjectType): Type | undefined {
        const objectClass = potentialTypeObject.classType;
        if (ClassType.isBuiltIn(objectClass, 'Type')) {
            const typeArgs = objectClass.typeArguments;

            if (typeArgs && typeArgs.length > 0) {
                let firstTypeArg = typeArgs[0];

                // If the type arg is a type var itself, specialize it in case it's bound.
                if (isTypeVar(firstTypeArg)) {
                    firstTypeArg = getConcreteTypeFromTypeVar(firstTypeArg);
                }

                if (isObject(firstTypeArg)) {
                    return firstTypeArg.classType;
                }
            }

            return AnyType.create();
        }

        return undefined;
    }

    function getTypeFromClassMemberName(
        errorNode: ExpressionNode,
        classType: ClassType,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum,
        flags: MemberAccessFlags,
        bindToClass?: ClassType
    ): ClassMemberLookup | undefined {
        // If this is a special type (like "List") that has an alias
        // class (like "list"), switch to the alias, which defines
        // the members.
        if (classType.details.aliasClass) {
            classType = classType.details.aliasClass;
        }

        let classLookupFlags = ClassMemberLookupFlags.Default;
        if (flags & MemberAccessFlags.SkipInstanceMembers) {
            classLookupFlags |= ClassMemberLookupFlags.SkipInstanceVariables;
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classLookupFlags |= ClassMemberLookupFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classLookupFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
        }

        // Always look for a member with a declared type first.
        let memberInfo = lookUpClassMember(
            classType,
            memberName,
            classLookupFlags | ClassMemberLookupFlags.DeclaredTypesOnly
        );

        // If we couldn't find a symbol with a declared type, use
        // a symbol with an inferred type.
        if (!memberInfo) {
            memberInfo = lookUpClassMember(classType, memberName, classLookupFlags);
        }

        if (memberInfo) {
            let type: Type;
            if (usage.method === 'get') {
                type = getTypeOfMember(memberInfo);
            } else {
                // If the usage indicates a 'set' or 'delete', use
                // only the declared type to avoid circular
                // type evaluation.
                type = getDeclaredTypeOfSymbol(memberInfo.symbol) || UnknownType.create();
            }

            if (usage.method === 'set' && memberInfo.symbol.isClassVar()) {
                if (flags & MemberAccessFlags.DisallowClassVarWrites) {
                    diag.addMessage(Localizer.DiagnosticAddendum.memberSetClassVar().format({ name: memberName }));
                    return undefined;
                }
            }

            // Don't include variables within typed dict classes.
            if (ClassType.isTypedDictClass(classType)) {
                const typedDecls = memberInfo.symbol.getTypedDeclarations();
                if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable) {
                    diag.addMessage(Localizer.DiagnosticAddendum.memberUnknown().format({ name: memberName }));
                    return undefined;
                }
            }

            if (usage.method === 'get') {
                // Mark the member accessed if it's not coming from a parent class.
                if (isClass(memberInfo.classType) && ClassType.isSameGenericClass(memberInfo.classType, classType)) {
                    setSymbolAccessed(getFileInfo(errorNode), memberInfo.symbol, errorNode);
                }
            }

            // Apply special access methods "__get__", "__set__", or "__delete__".
            let isTypeValid = true;
            type = doForSubtypes(type, (subtype) => {
                if (isObject(subtype)) {
                    let accessMethodName: string;

                    if (usage.method === 'get') {
                        accessMethodName = '__get__';
                    } else if (usage.method === 'set') {
                        accessMethodName = '__set__';
                    } else {
                        accessMethodName = '__delete__';
                    }

                    const memberClassType = subtype.classType;
                    const accessMethod = lookUpClassMember(
                        memberClassType,
                        accessMethodName,
                        ClassMemberLookupFlags.SkipInstanceVariables
                    );

                    // Handle properties specially.
                    if (ClassType.isPropertyClass(subtype.classType)) {
                        if (usage.method === 'set') {
                            if (!accessMethod) {
                                diag.addMessage(
                                    Localizer.DiagnosticAddendum.propertyMissingSetter().format({ name: memberName })
                                );
                                isTypeValid = false;
                                return undefined;
                            }
                        } else if (usage.method === 'del') {
                            if (!accessMethod) {
                                diag.addMessage(
                                    Localizer.DiagnosticAddendum.propertyMissingDeleter().format({ name: memberName })
                                );
                                isTypeValid = false;
                                return undefined;
                            }
                        }
                    }

                    if (accessMethod) {
                        let accessMethodType = getTypeOfMember(accessMethod);

                        // If it's an overloaded function, determine which overload to use.
                        if (accessMethodType.category === TypeCategory.OverloadedFunction) {
                            const argList: FunctionArgument[] = [
                                {
                                    argumentCategory: ArgumentCategory.Simple,
                                    type: ObjectType.create(memberClassType),
                                },
                                {
                                    argumentCategory: ArgumentCategory.Simple,
                                    type:
                                        flags & MemberAccessFlags.SkipInstanceMembers
                                            ? NoneType.createInstance()
                                            : ObjectType.create(classType),
                                },
                                {
                                    argumentCategory: ArgumentCategory.Simple,
                                    type: AnyType.create(),
                                },
                            ];

                            const overload = findOverloadedFunctionType(
                                errorNode,
                                argList,
                                accessMethodType,
                                /* expectedType */ undefined
                            );
                            if (overload) {
                                accessMethodType = overload;
                            }
                        }

                        if (accessMethodType && accessMethodType.category === TypeCategory.Function) {
                            // Bind the accessor to the base object type.
                            const boundMethodType = bindFunctionToClassOrObject(
                                bindToClass || ObjectType.create(classType),
                                accessMethodType,
                                bindToClass !== undefined,
                                errorNode
                            );

                            if (boundMethodType) {
                                accessMethodType = boundMethodType as FunctionType;

                                if (usage.method === 'get') {
                                    const returnType = getFunctionEffectiveReturnType(accessMethodType);
                                    if (isClass(memberInfo!.classType)) {
                                        return partiallySpecializeType(returnType, memberInfo!.classType);
                                    }
                                    return returnType;
                                } else {
                                    if (usage.method === 'set') {
                                        // Verify that the setter's parameter type matches
                                        // the type of the value being assigned.
                                        if (accessMethodType.details.parameters.length >= 2) {
                                            const setValueType = accessMethodType.details.parameters[1].type;
                                            if (!canAssignType(setValueType, usage.setType!, diag)) {
                                                isTypeValid = false;
                                                return undefined;
                                            }
                                        }
                                    }

                                    // The type isn't important for set or delete usage.
                                    // We just need to return some defined type.
                                    return AnyType.create();
                                }
                            }
                        }
                    }
                }

                if (usage.method === 'set') {
                    let enforceTargetType = false;

                    if (memberInfo!.symbol.hasTypedDeclarations()) {
                        // If the member has a declared type, we will enforce it.
                        enforceTargetType = true;
                    } else {
                        // If the member has no declared type, we will enforce it
                        // if this assignment isn't within the enclosing class. If
                        // it is within the enclosing class, the assignment is used
                        // to infer the type of the member.
                        if (!memberInfo!.symbol.getDeclarations().some((decl) => decl.node === errorNode)) {
                            enforceTargetType = true;
                        }
                    }

                    if (enforceTargetType) {
                        let effectiveType = subtype;

                        // If the code is patching a method (defined on the class)
                        // with an object-level function, strip the "self" parameter
                        // off the original type. This is sometimes done for test
                        // purposes to override standard behaviors of specific methods.
                        if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                            if (!memberInfo!.isInstanceMember && subtype.category === TypeCategory.Function) {
                                if (FunctionType.isClassMethod(subtype) || FunctionType.isInstanceMethod(subtype)) {
                                    effectiveType = stripFirstParameter(subtype);
                                }
                            }
                        }

                        return effectiveType;
                    }
                }

                return subtype;
            });

            if (!isTypeValid) {
                return undefined;
            }

            if (usage.method === 'set') {
                // Verify that the assigned type is compatible.
                if (!canAssignType(type, usage.setType!, diag.createAddendum())) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.memberAssignment().format({
                            type: printType(usage.setType!),
                            name: memberName,
                            classType: printObjectTypeForClass(classType),
                        })
                    );
                    isTypeValid = false;
                    return undefined;
                }
            }

            return {
                type,
                isClassMember: !memberInfo.isInstanceMember,
            };
        }

        if (!(flags & MemberAccessFlags.SkipGetAttributeCheck)) {
            if (usage.method === 'get') {
                // See if the class has a "__getattribute__" or "__getattr__" method.
                // If so, arbitrary members are supported.
                const getAttribType = getTypeFromClassMember(
                    errorNode,
                    classType,
                    '__getattribute__',
                    { method: 'get' },
                    new DiagnosticAddendum(),
                    MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
                );

                if (getAttribType && getAttribType.category === TypeCategory.Function) {
                    return {
                        type: getFunctionEffectiveReturnType(getAttribType),
                        isClassMember: false,
                    };
                }

                const getAttrType = getTypeFromClassMember(
                    errorNode,
                    classType,
                    '__getattr__',
                    { method: 'get' },
                    new DiagnosticAddendum(),
                    MemberAccessFlags.SkipForMethodLookup
                );
                if (getAttrType && getAttrType.category === TypeCategory.Function) {
                    return {
                        type: getFunctionEffectiveReturnType(getAttrType),
                        isClassMember: false,
                    };
                }
            } else if (usage.method === 'set') {
                const setAttrType = getTypeFromClassMember(
                    errorNode,
                    classType,
                    '__setattr__',
                    { method: 'get' },
                    new DiagnosticAddendum(),
                    MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
                );
                if (setAttrType) {
                    // The type doesn't matter for a set usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false,
                    };
                }
            } else {
                assert(usage.method === 'del');
                const delAttrType = getTypeFromClassMember(
                    errorNode,
                    classType,
                    '__detattr__',
                    { method: 'get' },
                    new DiagnosticAddendum(),
                    MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
                );
                if (delAttrType) {
                    // The type doesn't matter for a delete usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false,
                    };
                }
            }
        }

        diag.addMessage(Localizer.DiagnosticAddendum.memberUnknown().format({ name: memberName }));
        return undefined;
    }

    function getTypeFromIndex(node: IndexNode, flags = EvaluatorFlags.None): TypeResult {
        const baseTypeResult = getTypeOfExpression(
            node.baseExpression,
            undefined,
            flags | EvaluatorFlags.DoNotSpecialize
        );

        // Check for builtin classes that will generate runtime exceptions if subscripted.
        if ((flags & EvaluatorFlags.AllowForwardReferences) === 0) {
            const fileInfo = getFileInfo(node);
            if (isClass(baseTypeResult.type) && ClassType.isBuiltIn(baseTypeResult.type)) {
                const minPythonVersion = nonSubscriptableBuiltinTypes[baseTypeResult.type.details.fullName];
                if (minPythonVersion !== undefined && fileInfo.executionEnvironment.pythonVersion < minPythonVersion) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.classNotRuntimeSubscriptable().format({
                            name: baseTypeResult.type.details.name,
                        }),
                        node.baseExpression
                    );
                }
            }
        }

        return getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'get' }, flags);
    }

    function getTypeFromIndexWithBaseType(
        node: IndexNode,
        baseType: Type,
        usage: EvaluatorUsage,
        flags: EvaluatorFlags
    ): TypeResult {
        // Handle the case where we're specializing a generic union
        // of classes, a callable, or a specialized class.
        if (
            baseType.category === TypeCategory.Union ||
            baseType.category === TypeCategory.Function ||
            (isClass(baseType) && baseType.typeArguments)
        ) {
            const isUnionOfClasses = isUnionableType([baseType]);

            if (isUnionOfClasses) {
                const typeParameters: TypeVarType[] = [];
                doForSubtypes(baseType, (subtype) => {
                    addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(subtype));
                    return undefined;
                });

                if (typeParameters.length > 0) {
                    const typeArgs = getTypeArgs(node.items, flags);

                    if (typeArgs.length > typeParameters.length) {
                        addError(
                            Localizer.Diagnostic.typeArgsTooMany().format({
                                expected: typeParameters.length,
                                received: typeArgs.length,
                            }),
                            typeArgs[typeParameters.length].node
                        );
                    }

                    const typeVarMap = new TypeVarMap();
                    const diag = new DiagnosticAddendum();
                    typeParameters.forEach((param, index) => {
                        assignTypeToTypeVar(
                            param,
                            index < typeArgs.length ? convertToInstance(typeArgs[index].type) : UnknownType.create(),
                            /* canNarrowType */ false,
                            diag,
                            typeVarMap
                        );
                    });

                    if (!diag.isEmpty()) {
                        addError(
                            Localizer.Diagnostic.typeNotSpecializable().format({ type: printType(baseType) }) +
                                diag.getString(),
                            node.items
                        );
                    }

                    let type = specializeType(baseType, typeVarMap);
                    if (baseType.typeAliasInfo && type !== baseType) {
                        const typeArgs: Type[] = [];
                        baseType.typeAliasInfo.typeParameters?.forEach((typeParam) => {
                            typeArgs.push(typeVarMap.getTypeVar(typeParam) || UnknownType.create());
                        });

                        type = TypeBase.cloneForTypeAlias(
                            type,
                            baseType.typeAliasInfo.aliasName,
                            baseType.typeAliasInfo.typeParameters,
                            typeArgs
                        );
                    }

                    return { type, node };
                }
            }
        }

        const type = doForSubtypes(baseType, (subtype) => {
            subtype = makeTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isClass(subtype)) {
                // Setting the value of an indexed class will always result
                // in an exception.
                if (usage.method === 'set') {
                    addError(Localizer.Diagnostic.genericClassAssigned(), node.baseExpression);
                } else if (usage.method === 'del') {
                    addError(Localizer.Diagnostic.genericClassDeleted(), node.baseExpression);
                }

                if (ClassType.isSpecialBuiltIn(subtype, 'Literal')) {
                    // Special-case Literal types.
                    return createLiteralType(node);
                }

                if (ClassType.isBuiltIn(subtype, 'InitVar')) {
                    // Special-case InitVar, used in data classes.
                    const typeArgs = getTypeArgs(node.items, flags);
                    if (typeArgs.length === 1) {
                        return typeArgs[0].type;
                    } else {
                        addError(
                            Localizer.Diagnostic.typeArgsMismatchOne().format({ received: typeArgs.length }),
                            node.baseExpression
                        );
                        return UnknownType.create();
                    }
                }

                if (ClassType.isEnumClass(subtype)) {
                    // Special-case Enum types.
                    // TODO - validate that there's only one index entry
                    // that is a str type.
                    // TODO - validate that literal strings are referencing
                    // a known enum member.
                    return ObjectType.create(subtype);
                }

                // Handle the case where the base type is "Tuple". We need to
                // perform special processing of the type args in this case to permit
                // empty tuples.
                let adjustedFlags = flags;
                if (isClass(subtype) && ClassType.isBuiltIn(subtype, 'Tuple')) {
                    adjustedFlags |= EvaluatorFlags.AllowEmptyTupleAsType;
                }

                const isAnnotatedClass = isClass(subtype) && ClassType.isBuiltIn(subtype, 'Annotated');

                const typeArgs = getTypeArgs(node.items, adjustedFlags, isAnnotatedClass);
                return createSpecializedClassType(subtype, typeArgs, flags, node);
            }

            if (isObject(subtype)) {
                return getTypeFromIndexedObject(node, subtype, usage);
            }

            if (isNever(subtype)) {
                return UnknownType.create();
            }

            if (isNone(subtype)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticRuleSet.reportOptionalSubscript,
                    DiagnosticRule.reportOptionalSubscript,
                    Localizer.Diagnostic.noneNotSubscriptable(),
                    node.baseExpression
                );

                return UnknownType.create();
            }

            if (!isUnbound(subtype)) {
                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotSubscriptable().format({ type: printType(subtype) }),
                    node.baseExpression
                );
            }

            return UnknownType.create();
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.items.forEach((item) => {
            getTypeOfExpression(item, /* expectedType */ undefined, flags & EvaluatorFlags.AllowForwardReferences);
        });

        return { type, node };
    }

    function getTypeFromIndexedObject(node: IndexNode, baseType: ObjectType, usage: EvaluatorUsage): Type {
        // Handle index operations for TypedDict classes specially.
        if (ClassType.isTypedDictClass(baseType.classType)) {
            if (node.items.items.length !== 1) {
                addError(
                    Localizer.Diagnostic.typeArgsMismatchOne().format({ received: node.items.items.length }),
                    node
                );
                return UnknownType.create();
            }

            const entries = getTypedDictMembersForClass(baseType.classType);

            const indexType = getTypeOfExpression(node.items.items[0]).type;
            let diag = new DiagnosticAddendum();
            const resultingType = doForSubtypes(indexType, (subtype) => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                }

                if (isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'str')) {
                    if (subtype.classType.literalValue === undefined) {
                        // If it's a plain str with no literal value, we can't
                        // make any determination about the resulting type.
                        return UnknownType.create();
                    }

                    // Look up the entry in the typed dict to get its type.
                    const entryName = subtype.classType.literalValue as string;
                    const entry = entries.get(entryName);
                    if (!entry) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.keyUndefined().format({
                                name: entryName,
                                type: printType(baseType),
                            })
                        );
                        return UnknownType.create();
                    }

                    if (usage.method === 'set') {
                        canAssignType(entry.valueType, usage.setType!, diag);
                    } else if (usage.method === 'del' && entry.isRequired) {
                        const fileInfo = getFileInfo(node);
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.keyRequiredDeleted().format({ name: entryName }),
                            node
                        );
                    }

                    return entry.valueType;
                }

                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeNotStringLiteral().format({ type: printType(subtype) })
                );
                return UnknownType.create();
            });

            // If we have an "expected type" diagnostic addendum (used for assignments),
            // use that rather than the local diagnostic information because it will
            // be more informative.
            if (usage.setExpectedTypeDiag) {
                diag = usage.setExpectedTypeDiag;
            }

            if (!diag.isEmpty()) {
                let typedDictDiag: string;
                if (usage.method === 'set') {
                    typedDictDiag = Localizer.Diagnostic.typedDictSet();
                } else if (usage.method === 'del') {
                    typedDictDiag = Localizer.Diagnostic.typedDictDelete();
                } else {
                    typedDictDiag = Localizer.Diagnostic.typedDictAccess();
                }

                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    typedDictDiag + diag.getString(),
                    node
                );
            }

            return resultingType;
        }

        let magicMethodName: string;
        if (usage.method === 'get') {
            magicMethodName = '__getitem__';
        } else if (usage.method === 'set') {
            magicMethodName = '__setitem__';
        } else {
            assert(usage.method === 'del');
            magicMethodName = '__delitem__';
        }

        const itemMethodType = getTypeFromObjectMember(
            node,
            baseType,
            magicMethodName,
            { method: 'get' },
            new DiagnosticAddendum(),
            MemberAccessFlags.SkipForMethodLookup
        );

        if (!itemMethodType) {
            const fileInfo = getFileInfo(node);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.methodNotDefinedOnType().format({
                    name: magicMethodName,
                    type: printType(baseType),
                }),
                node.baseExpression
            );
            return UnknownType.create();
        }

        const indexTypeList = node.items.items.map((item) => getTypeOfExpression(item).type);

        let indexType: Type;
        if (indexTypeList.length === 1) {
            indexType = indexTypeList[0];

            // Handle the special case where the object is a Tuple and
            // the index is a constant number. In such case, we can determine
            // the exact type by indexing into the tuple type array.
            const baseTypeClass = baseType.classType;

            if (
                node.items.items[0].nodeType === ParseNodeType.Number &&
                node.items.items[0].isInteger &&
                !node.items.items[0].isImaginary
            ) {
                const tupleType = getSpecializedTupleType(baseTypeClass);
                if (tupleType && tupleType.typeArguments && tupleType.typeArguments.length > 0) {
                    const numberNode = node.items.items[0];

                    if (numberNode.isInteger && numberNode.value >= 0) {
                        if (tupleType.typeArguments.length === 2 && isEllipsisType(tupleType.typeArguments[1])) {
                            return tupleType.typeArguments[0];
                        } else if (numberNode.value < tupleType.typeArguments.length) {
                            return tupleType.typeArguments[numberNode.value];
                        }
                    }
                }
            }
        } else {
            // Handle the case where the index expression is a tuple. This
            // isn't used in most cases, but it is supported by the language.
            const builtInTupleType = getBuiltInType(node, 'Tuple');
            if (isClass(builtInTupleType)) {
                indexType = convertToInstance(
                    cloneTupleForSpecialization(builtInTupleType, indexTypeList, /* isTypeArgumentExplicit */ false)
                );
            } else {
                indexType = UnknownType.create();
            }
        }

        const argList: FunctionArgument[] = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: indexType,
            },
        ];

        if (usage.method === 'set') {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                type: usage.setType || AnyType.create(),
            });
        }

        const callResult = validateCallArguments(
            node,
            argList,
            itemMethodType,
            new TypeVarMap(),
            /* skipUnknownArgCheck */ false,
            /* inferReturnTypeIfNeeded */ true,
            /* expectedType */ undefined
        );

        return callResult.returnType || UnknownType.create();
    }

    function getTypeArgs(node: IndexItemsNode, flags: EvaluatorFlags, isAnnotatedClass = false): TypeResult[] {
        const typeArgs: TypeResult[] = [];
        const adjFlags = flags & ~EvaluatorFlags.ParamSpecDisallowed;

        node.items.forEach((expr, index) => {
            // If it's an Annotated[a, b, c], only the first index should be treated
            // as a type. The others can be regular (non-type) objects.
            if (isAnnotatedClass && index > 0) {
                typeArgs.push(
                    getTypeOfExpression(
                        expr,
                        /* expectedType */ undefined,
                        EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.DoNotSpecialize
                    )
                );
            } else {
                typeArgs.push(getTypeArg(expr, adjFlags));
            }
        });

        return typeArgs;
    }

    function getTypeArg(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        let typeResult: TypeResult;

        let adjustedFlags =
            flags |
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.ConvertEllipsisToAny |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.FinalDisallowed;

        const fileInfo = getFileInfo(node);
        if (isAnnotationEvaluationPostponed(fileInfo)) {
            adjustedFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        if (node.nodeType === ParseNodeType.List) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map((entry) => getTypeOfExpression(entry, undefined, adjustedFlags)),
                node,
            };
        } else {
            typeResult = getTypeOfExpression(node, /* expectedType */ undefined, adjustedFlags);
        }

        return typeResult;
    }

    function getTypeFromTuple(node: TupleNode, expectedType: Type | undefined): TypeResult {
        // Build an array of expected types.
        const expectedTypes: Type[] = [];
        if (expectedType && isObject(expectedType)) {
            const tupleClass = expectedType.classType;

            if (ClassType.isBuiltIn(tupleClass, 'Tuple') && tupleClass.typeArguments) {
                // Is this a homogeneous tuple of indeterminate length? If so,
                // match the number of expected types to the number of entries
                // in the tuple expression.
                if (tupleClass.typeArguments.length === 2 && isEllipsisType(tupleClass.typeArguments[1])) {
                    for (let i = 0; i < node.expressions.length; i++) {
                        expectedTypes.push(transformPossibleRecursiveTypeAlias(tupleClass.typeArguments[0]));
                    }
                } else {
                    tupleClass.typeArguments.forEach((typeArg) => {
                        expectedTypes.push(transformPossibleRecursiveTypeAlias(typeArg));
                    });
                }
            }
        }

        const entryTypeResults = node.expressions.map((expr, index) =>
            getTypeOfExpression(expr, index < expectedTypes.length ? expectedTypes[index] : undefined)
        );

        let type: Type = UnknownType.create();
        const builtInTupleType = getBuiltInType(node, 'Tuple');

        if (isClass(builtInTupleType)) {
            let tupleTypes: Type[] = [];
            for (const typeResult of entryTypeResults) {
                if (typeResult.unpackedType) {
                    // Is this an unpacked tuple? If so, we can append the individual
                    // unpacked entries onto the new tuple. If it's not an upacked tuple
                    // but some other iterator (e.g. a List), we won't know the number of
                    // items, so we'll need to leave the Tuple open-ended.
                    if (
                        isObject(typeResult.unpackedType) &&
                        ClassType.isBuiltIn(typeResult.unpackedType.classType, 'Tuple')
                    ) {
                        const typeArgs = typeResult.unpackedType.classType.typeArguments;

                        // If the Tuple wasn't specialized or has a "..." type parameter, we can't
                        // make any determination about its contents.
                        if (!typeArgs || typeArgs.some((t) => isEllipsisType(t))) {
                            tupleTypes = [AnyType.create(false), AnyType.create(true)];
                            break;
                        }

                        for (const typeArg of typeArgs) {
                            tupleTypes.push(typeArg);
                        }
                    } else {
                        tupleTypes = [AnyType.create(false), AnyType.create(true)];
                        break;
                    }
                } else {
                    tupleTypes.push(typeResult.type);
                }
            }

            type = convertToInstance(
                cloneTupleForSpecialization(builtInTupleType, tupleTypes, /* isTypeArgumentExplicit */ true)
            );
        }

        return { type, node };
    }

    function cloneTupleForSpecialization(tupleClass: ClassType, typeArgs: Type[], isTypeArgumentExplicit: boolean) {
        // Verify our assumptions in case typing.pyi changes its definition of Tuple.
        if (
            tupleClass.details.mro.length < 2 ||
            !isClass(tupleClass.details.mro[0]) ||
            !ClassType.isBuiltIn(tupleClass.details.mro[0], 'Tuple') ||
            !isClass(tupleClass.details.mro[1]) ||
            !ClassType.isBuiltIn(tupleClass.details.mro[1], 'tuple')
        ) {
            return tupleClass;
        }

        // Create a copy of the Tuple class that overrides the normal MRO
        // entries with a version of Tuple and tuple that are specialized
        // appropriately.
        let combinedTupleType: Type = AnyType.create(false);
        if (typeArgs.length === 2 && isEllipsisType(typeArgs[1])) {
            combinedTupleType = typeArgs[0];
        } else {
            combinedTupleType = combineTypes(typeArgs);
        }

        const specializedTuple = ClassType.cloneForSpecialization(tupleClass, typeArgs, isTypeArgumentExplicit);
        specializedTuple.details = { ...specializedTuple.details };
        specializedTuple.details.mro = [...specializedTuple.details.mro];
        specializedTuple.details.mro[0] = specializedTuple;
        specializedTuple.details.mro[1] = ClassType.cloneForSpecialization(
            specializedTuple.details.mro[1] as ClassType,
            [combinedTupleType],
            isTypeArgumentExplicit
        );

        return specializedTuple;
    }

    function updateNamedTupleBaseClass(classType: ClassType, typeArgs: Type[], isTypeArgumentExplicit: boolean) {
        // Search for the NamedTuple base class.
        const namedTupleIndex = classType.details.mro.findIndex(
            (c) => isClass(c) && ClassType.isBuiltIn(c, 'NamedTuple')
        );
        if (namedTupleIndex < 0 || classType.details.mro.length < namedTupleIndex + 2) {
            return;
        }

        const namedTupleClass = classType.details.mro[namedTupleIndex] as ClassType;
        const typedTupleClass = classType.details.mro[namedTupleIndex + 1];
        const tupleClass = classType.details.mro[namedTupleIndex + 2];

        if (
            !isClass(typedTupleClass) ||
            !ClassType.isBuiltIn(typedTupleClass, 'Tuple') ||
            !isClass(tupleClass) ||
            !ClassType.isBuiltIn(tupleClass, 'tuple')
        ) {
            return;
        }

        const updatedTupleClass = cloneTupleForSpecialization(typedTupleClass, typeArgs, isTypeArgumentExplicit);

        // Create a copy of the NamedTuple class that overrides the normal MRO
        // entries with a version of Tuple and tuple that are specialized
        // appropriately.
        const clonedNamedTupleClass = ClassType.cloneForSpecialization(namedTupleClass, [], isTypeArgumentExplicit);
        clonedNamedTupleClass.details = { ...clonedNamedTupleClass.details };
        clonedNamedTupleClass.details.mro = [...clonedNamedTupleClass.details.mro];
        clonedNamedTupleClass.details.mro[1] = updatedTupleClass.details.mro[0];
        clonedNamedTupleClass.details.mro[2] = updatedTupleClass.details.mro[1];

        classType.details.mro[namedTupleIndex] = clonedNamedTupleClass;
        classType.details.mro[namedTupleIndex + 1] = updatedTupleClass.details.mro[0];
        classType.details.mro[namedTupleIndex + 2] = updatedTupleClass.details.mro[1];
    }

    function getTypeFromCall(node: CallNode, expectedType: Type | undefined, flags: EvaluatorFlags): TypeResult {
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, EvaluatorFlags.DoNotSpecialize);

        // Handle the built-in "super" call specially.
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'super') {
            return {
                type: getTypeFromSuperCall(node),
                node,
            };
        }

        // Handle the special-case "reveal_type" call.
        if (
            isAnyOrUnknown(baseTypeResult.type) &&
            node.leftExpression.nodeType === ParseNodeType.Name &&
            node.leftExpression.value === 'reveal_type' &&
            node.arguments.length === 1 &&
            node.arguments[0].argumentCategory === ArgumentCategory.Simple &&
            node.arguments[0].name === undefined
        ) {
            const type = getTypeOfExpression(node.arguments[0].valueExpression).type;
            const exprString = ParseTreeUtils.printExpression(node.arguments[0].valueExpression);
            addWarning(`Type of "${exprString}" is "${printType(type)}"`, node.arguments[0]);
            return { type: AnyType.create(), node };
        }

        const argList = node.arguments.map((arg) => {
            const functionArg: FunctionArgument = {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name,
            };
            return functionArg;
        });

        return getTypeFromCallWithBaseType(
            node,
            argList,
            baseTypeResult,
            expectedType,
            flags & ~EvaluatorFlags.DoNotSpecialize
        );
    }

    function getTypeFromSuperCall(node: CallNode): Type {
        if (node.arguments.length > 2) {
            addError(Localizer.Diagnostic.superCallArgCount(), node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = getTypeOfExpression(node.arguments[0].valueExpression).type;

            if (!isAnyOrUnknown(targetClassType) && !isClass(targetClassType)) {
                addError(
                    Localizer.Diagnostic.superCallFirstArg().format({ type: printType(targetClassType) }),
                    node.arguments[0].valueExpression
                );
            }
        } else {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                const classTypeInfo = getTypeOfClass(enclosingClass);
                targetClassType = classTypeInfo ? classTypeInfo.classType : UnknownType.create();
            } else {
                addError(Localizer.Diagnostic.superCallZeroArgForm(), node.leftExpression);
                targetClassType = UnknownType.create();
            }
        }

        // Determine whether there is a further constraint.
        let constrainedClassType: Type;
        if (node.arguments.length > 1) {
            constrainedClassType = specializeType(
                getTypeOfExpression(node.arguments[1].valueExpression).type,
                /* typeVarMap */ undefined
            );

            let reportError = false;

            if (isAnyOrUnknown(constrainedClassType)) {
                // Ignore unknown or any types.
            } else if (isObject(constrainedClassType)) {
                const childClassType = constrainedClassType.classType;
                if (isClass(targetClassType)) {
                    if (!derivesFromClassRecursive(childClassType, targetClassType, /* ignoreUnknown */ true)) {
                        reportError = true;
                    }
                }
            } else if (isClass(constrainedClassType)) {
                if (isClass(targetClassType)) {
                    if (!derivesFromClassRecursive(constrainedClassType, targetClassType, /* ignoreUnknown */ true)) {
                        reportError = true;
                    }
                }
            } else {
                reportError = true;
            }

            if (reportError) {
                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.superCallSecondArg().format({ type: printType(targetClassType) }),
                    node.arguments[1].valueExpression
                );
            }
        }

        // Python docs indicate that super() isn't valid for
        // operations other than member accesses or attribute lookups.
        const parentNode = node.parent!;
        if (parentNode.nodeType === ParseNodeType.MemberAccess) {
            const memberName = parentNode.memberName.value;
            const lookupResults = lookUpClassMember(
                targetClassType,
                memberName,
                ClassMemberLookupFlags.SkipOriginalClass
            );
            if (lookupResults && isClass(lookupResults.classType)) {
                return ObjectType.create(lookupResults.classType);
            }
        }

        // If the lookup failed, try to return the first base class. An error
        // will be reported by the member lookup logic at a later time.
        if (isClass(targetClassType)) {
            // If the class derives from one or more unknown classes,
            // return unknown here to prevent spurious errors.
            if (targetClassType.details.mro.some((mroBase) => isAnyOrUnknown(mroBase))) {
                return UnknownType.create();
            }

            const baseClasses = targetClassType.details.baseClasses;
            if (baseClasses.length > 0) {
                const baseClassType = baseClasses[0];
                if (isClass(baseClassType)) {
                    return ObjectType.create(baseClassType);
                }
            }
        }

        return UnknownType.create();
    }

    function getTypeFromCallWithBaseType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        baseTypeResult: TypeResult,
        expectedType: Type | undefined,
        flags: EvaluatorFlags
    ): TypeResult {
        let type: Type | undefined;
        const callType = makeTypeVarsConcrete(baseTypeResult.type);
        const skipUnknownArgCheck = (flags & EvaluatorFlags.DoNotCheckForUnknownArgs) !== 0;

        switch (callType.category) {
            case TypeCategory.Class: {
                if (ClassType.isBuiltIn(callType)) {
                    const className = callType.details.name;

                    if (className === 'type') {
                        // Validate the constructor arguments.
                        validateConstructorArguments(errorNode, argList, callType, skipUnknownArgCheck, expectedType);

                        // Handle the 'type' call specially.
                        if (argList.length === 1) {
                            // The one-parameter form of "type" returns the class
                            // for the specified object.
                            const argType = getTypeForArgument(argList[0]);
                            if (isObject(argType)) {
                                type = argType.classType;
                            } else if (argType.category === TypeCategory.None) {
                                type = NoneType.createType();
                            }
                        } else if (argList.length >= 2) {
                            // The two-parameter form of "type" returns a new class type
                            // built from the specified base types.
                            type = createType(errorNode, argList);
                        }

                        // If the parameter to type() is not statically known,
                        // fall back to Any.
                        if (!type) {
                            type = AnyType.create();
                        }
                    } else if (className === 'TypeVar') {
                        type = createTypeVarType(errorNode, argList, /* isParamSpec */ false);
                    } else if (className === 'ParamSpec') {
                        type = createTypeVarType(errorNode, argList, /* isParamSpec */ true);
                    } else if (className === 'NamedTuple') {
                        type = createNamedTupleType(errorNode, argList, true);
                    } else if (
                        className === 'Protocol' ||
                        className === 'Generic' ||
                        className === 'Callable' ||
                        className === 'Concatenate' ||
                        className === 'Type'
                    ) {
                        const fileInfo = getFileInfo(errorNode);
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typeNotIntantiable().format({ type: className }),
                            errorNode
                        );
                    } else if (
                        className === 'Enum' ||
                        className === 'IntEnum' ||
                        className === 'Flag' ||
                        className === 'IntFlag'
                    ) {
                        type = createEnumType(errorNode, callType, argList);
                    } else if (className === 'TypedDict') {
                        type = createTypedDictType(errorNode, callType, argList);
                    } else if (className === 'auto' && argList.length === 0) {
                        type = getBuiltInObject(errorNode, 'int');
                    }
                } else if (isClass(baseTypeResult.type) && ClassType.hasAbstractMethods(callType)) {
                    // If the class is abstract, it can't be instantiated.
                    const abstractMethods = getAbstractMethods(callType);

                    const diagAddendum = new DiagnosticAddendum();
                    const errorsToDisplay = 2;

                    abstractMethods.forEach((abstractMethod, index) => {
                        if (index === errorsToDisplay) {
                            diagAddendum.addMessage(
                                Localizer.DiagnosticAddendum.memberIsAbstractMore().format({
                                    count: abstractMethods.length - errorsToDisplay,
                                })
                            );
                        } else if (index < errorsToDisplay) {
                            if (isClass(abstractMethod.classType)) {
                                const className = abstractMethod.classType.details.name;
                                diagAddendum.addMessage(
                                    Localizer.DiagnosticAddendum.memberIsAbstract().format({
                                        type: className,
                                        name: abstractMethod.symbolName,
                                    })
                                );
                            }
                        }
                    });

                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeAbstract().format({ type: callType.details.name }) +
                            diagAddendum.getString(),
                        errorNode
                    );
                }

                // Assume this is a call to the constructor.
                if (!type) {
                    type = validateConstructorArguments(errorNode, argList, callType, skipUnknownArgCheck, expectedType)
                        .returnType;
                }
                break;
            }

            case TypeCategory.Function: {
                // The stdlib collections/__init__.pyi stub file defines namedtuple
                // as a function rather than a class, so we need to check for it here.
                if (callType.details.builtInName === 'namedtuple') {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportUntypedNamedTuple,
                        DiagnosticRule.reportUntypedNamedTuple,
                        Localizer.Diagnostic.namedTupleNoTypes(),
                        errorNode
                    );
                    type = createNamedTupleType(errorNode, argList, false);
                } else if (callType.details.builtInName === 'NewType') {
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        callType,
                        new TypeVarMap(),
                        skipUnknownArgCheck,
                        /* inferReturnTypeIfNeeded */ true,
                        expectedType
                    );

                    // If the call's arguments were validated, replace the
                    // type with a new synthesized subclass.
                    type = callResult.argumentErrors ? callResult.returnType : createNewType(errorNode, argList);
                } else {
                    type = validateCallArguments(
                        errorNode,
                        argList,
                        callType,
                        new TypeVarMap(),
                        skipUnknownArgCheck,
                        /* inferReturnTypeIfNeeded */ true,
                        expectedType
                    ).returnType;

                    if (callType.details.builtInName === '__import__') {
                        // For the special __import__ type, we'll override the return type to be "Any".
                        // This is required because we don't know what module was imported, and we don't
                        // want to fail type checks when accessing members of the resulting module type.
                        type = AnyType.create();
                    }
                }

                if (!type) {
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.OverloadedFunction: {
                // Determine which of the overloads (if any) match.
                const functionType = findOverloadedFunctionType(errorNode, argList, callType, expectedType);

                if (functionType) {
                    if (functionType.details.builtInName === 'cast' && argList.length === 2) {
                        // Verify that the cast is necessary.
                        const castToType = getTypeForArgumentExpectingType(argList[0], getFileInfo(errorNode));
                        const castFromType = getTypeForArgument(argList[1]);
                        if (isClass(castToType) && isObject(castFromType)) {
                            if (isTypeSame(castToType, castFromType.classType)) {
                                addDiagnostic(
                                    getFileInfo(errorNode).diagnosticRuleSet.reportUnnecessaryCast,
                                    DiagnosticRule.reportUnnecessaryCast,
                                    Localizer.Diagnostic.unnecessaryCast().format({ type: printType(castFromType) }),
                                    errorNode
                                );
                            }
                        }

                        type = convertToInstance(castToType);
                    } else {
                        type = validateCallArguments(
                            errorNode,
                            argList,
                            functionType,
                            new TypeVarMap(),
                            skipUnknownArgCheck,
                            /* inferReturnTypeIfNeeded */ true,
                            expectedType
                        ).returnType;
                        if (!type) {
                            type = UnknownType.create();
                        }
                    }
                } else {
                    const exprString = ParseTreeUtils.printExpression(errorNode);
                    const diagAddendum = new DiagnosticAddendum();
                    const argTypes = argList.map((t) => printType(getTypeForArgument(t)));

                    if (errorNode.nodeType !== ParseNodeType.Call && callType.overloads[0].details.name) {
                        // If the expression isn't an explicit call, it is probably an implicit
                        // call to a magic method. Provide additional information in this case
                        // to make it clear that a call was being evaluated.
                        diagAddendum.addMessage(
                            Localizer.DiagnosticAddendum.overloadCallName().format({
                                name: callType.overloads[0].details.name,
                            })
                        );
                    }

                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.argumentTypes().format({ types: argTypes.join(', ') })
                    );
                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.noOverload().format({ expression: exprString }) + diagAddendum.getString(),
                        errorNode
                    );
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.Object: {
                // Handle the "Type" object specially.
                const classFromTypeObject = getClassFromPotentialTypeObject(callType);
                if (classFromTypeObject) {
                    if (isAnyOrUnknown(classFromTypeObject)) {
                        type = classFromTypeObject;
                    } else if (isClass(classFromTypeObject)) {
                        type = validateConstructorArguments(
                            errorNode,
                            argList,
                            classFromTypeObject,
                            skipUnknownArgCheck,
                            expectedType
                        ).returnType;
                    }
                } else {
                    const memberType = getTypeFromObjectMember(
                        errorNode,
                        callType,
                        '__call__',
                        { method: 'get' },
                        new DiagnosticAddendum(),
                        MemberAccessFlags.SkipForMethodLookup
                    );
                    if (memberType) {
                        type = validateCallArguments(
                            errorNode,
                            argList,
                            memberType,
                            new TypeVarMap(),
                            skipUnknownArgCheck,
                            /* inferReturnTypeIfNeeded */ true,
                            expectedType
                        ).returnType;
                        if (!type) {
                            type = UnknownType.create();
                        }
                    }
                }
                break;
            }

            case TypeCategory.Union: {
                const returnTypes: Type[] = [];
                callType.subtypes.forEach((typeEntry) => {
                    if (isNone(typeEntry)) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportOptionalCall,
                            DiagnosticRule.reportOptionalCall,
                            Localizer.Diagnostic.noneNotCallable(),
                            errorNode
                        );
                    } else {
                        const typeResult = getTypeFromCallWithBaseType(
                            errorNode,
                            argList,
                            {
                                type: typeEntry,
                                node: baseTypeResult.node,
                            },
                            expectedType,
                            flags
                        );
                        if (typeResult) {
                            returnTypes.push(typeResult.type);
                        }
                    }
                });

                if (returnTypes.length > 0) {
                    type = combineTypes(returnTypes);
                }
                break;
            }

            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                // Mark the arguments accessed.
                argList.forEach((arg) => getTypeForArgument(arg));
                type = callType;
                break;
            }
        }

        if (!type) {
            const fileInfo = getFileInfo(errorNode);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotCallable().format({
                    expression: ParseTreeUtils.printExpression(errorNode),
                    type: printType(callType),
                }),
                errorNode
            );
            type = UnknownType.create();

            // Evaluate the arguments to generate errors and mark
            // symbols as referenced.
            argList.forEach((arg) => {
                if (!arg.type && arg.valueExpression) {
                    getTypeOfExpression(arg.valueExpression);
                }
            });
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (isClass(type)) {
                type = createSpecializedClassType(type, undefined, flags, errorNode);
            }
        }

        return { type, node: baseTypeResult.node };
    }

    function findOverloadedFunctionType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: OverloadedFunctionType,
        expectedType: Type | undefined
    ): FunctionType | undefined {
        let validOverload: FunctionType | undefined;

        for (const overload of callType.overloads) {
            // Only iterate through the functions that have the @overload
            // decorator, not the final function that omits the overload.
            // This is the intended behavior according to PEP 484.
            if (FunctionType.isOverloaded(overload)) {
                // Temporarily disable diagnostic output.
                useSpeculativeMode(errorNode, () => {
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        overload,
                        new TypeVarMap(),
                        /* skipUnknownArgCheck */ true,
                        /* inferReturnTypeIfNeeded */ false,
                        expectedType
                    );
                    if (!callResult.argumentErrors) {
                        validOverload = overload;
                    }
                });

                if (validOverload) {
                    break;
                }
            }
        }

        return validOverload;
    }

    // Tries to match the arguments of a call to the constructor for a class.
    // If successful, it returns the resulting (specialized) object type that
    // is allocated by the constructor. If unsuccessful, it records diagnostic
    // information and returns undefined.
    function validateConstructorArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        type: ClassType,
        skipUnknownArgCheck: boolean,
        expectedType: Type | undefined
    ): CallResult {
        let validatedTypes = false;
        let returnType: Type | undefined;
        let reportedErrors = false;

        // Create a helper function that determines whether we should skip argument
        // validation for either __init__ or __new__. This is required for certain
        // synthesized constructor types, namely NamedTuples.
        const skipConstructorCheck = (type: Type) => {
            if (type.category !== TypeCategory.Function) {
                return false;
            }
            return FunctionType.isSkipConstructorCheck(type);
        };

        // Validate __init__
        // We validate __init__ before __new__ because the former typically has
        // more specific type annotations, and we want to evaluate the arguments
        // in the context of these types. The __new__ method often uses generic
        // vargs and kwargs.
        const initMethodType = getTypeFromObjectMember(
            errorNode,
            ObjectType.create(type),
            '__init__',
            { method: 'get' },
            new DiagnosticAddendum(),
            MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
        );

        if (initMethodType && !skipConstructorCheck(initMethodType)) {
            const typeVarMap = new TypeVarMap();

            if (expectedType) {
                populateTypeVarMapBasedOnExpectedType(ObjectType.create(type), expectedType, typeVarMap);
            }

            const callResult = validateCallArguments(
                errorNode,
                argList,
                initMethodType,
                typeVarMap,
                skipUnknownArgCheck,
                /* inferReturnTypeIfNeeded */ true,
                NoneType.createInstance()
            );
            if (!callResult.argumentErrors) {
                const specializedClassType = applyExpectedTypeForConstructor(
                    specializeType(type, typeVarMap, /* makeConcrete */ true) as ClassType,
                    expectedType
                );
                returnType = ObjectType.create(specializedClassType);
            } else {
                reportedErrors = true;
            }
            validatedTypes = true;
            skipUnknownArgCheck = true;
        }

        // Validate __new__
        // Don't report errors for __new__ if __init__ already generated errors. They're
        // probably going to be entirely redundant anyway.
        if (!reportedErrors) {
            const constructorMethodInfo = getTypeFromClassMemberName(
                errorNode,
                type,
                '__new__',
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
            );
            if (constructorMethodInfo && !skipConstructorCheck(constructorMethodInfo.type)) {
                const constructorMethodType = bindFunctionToClassOrObject(
                    type,
                    constructorMethodInfo.type,
                    /* treatAsClassMember */ true,
                    errorNode
                );
                const typeVarMap = new TypeVarMap();

                if (constructorMethodType) {
                    // Skip the unknown argument check if we've already checked for __init__.
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        constructorMethodType,
                        typeVarMap,
                        skipUnknownArgCheck,
                        /* inferReturnTypeIfNeeded */ true,
                        expectedType
                    );
                    if (callResult.argumentErrors) {
                        reportedErrors = true;
                    } else {
                        const newReturnType = callResult.returnType;

                        // If the constructor returned an object whose type matches the class of
                        // the original type being constructed, use the return type in case it was
                        // specialized.If it doesn't match, we'll fall back on the assumption that
                        // the constructed type is an instance of the class type. We need to do this
                        // in cases where we're inferring the return type based on a call to
                        // super().__new__().
                        if (newReturnType) {
                            if (
                                isObject(newReturnType) &&
                                ClassType.isSameGenericClass(newReturnType.classType, type)
                            ) {
                                // If the specialized return type derived from the __init__
                                // method is "better" than the return type provided by the
                                // __new__ method (where "better" means that the type arguments
                                // are all known), stick with the __init__ result.
                                if (
                                    (!isPartlyUnknown(newReturnType) && !requiresSpecialization(newReturnType)) ||
                                    returnType === undefined
                                ) {
                                    returnType = newReturnType;
                                }
                            }
                        }
                    }

                    if (!returnType) {
                        const specializedClassType = applyExpectedTypeForConstructor(
                            specializeType(type, typeVarMap, /* makeConcrete */ true) as ClassType,
                            expectedType
                        );
                        returnType = ObjectType.create(specializedClassType);
                    }
                    validatedTypes = true;
                }
            }
        }

        // If we weren't able to validate the args, analyze the expressions
        // here to mark symbols as referenced and report expression-level errors.
        if (!validatedTypes) {
            argList.forEach((arg) => {
                if (arg.valueExpression) {
                    getTypeOfExpression(arg.valueExpression);
                }
            });
        }

        if (!validatedTypes && argList.length > 0) {
            const fileInfo = getFileInfo(errorNode);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.constructorNoArgs().format({ type: type.details.name }),
                errorNode
            );
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            const specializedClassType = applyExpectedTypeForConstructor(type, expectedType);
            returnType = ObjectType.create(specializedClassType);
        }

        return { argumentErrors: reportedErrors, returnType };
    }

    function applyExpectedTypeForConstructor(type: ClassType, expectedType: Type | undefined): ClassType {
        if (!expectedType) {
            return type;
        }

        // It's common for the expected type to contain a None. Strip
        // this out because we're trying to match the non-optional part.
        const expectedTypeWithoutNone = removeNoneFromUnion(expectedType);
        if (!isObject(expectedTypeWithoutNone)) {
            return type;
        }
        const expectedClass = expectedTypeWithoutNone.classType;

        const typeVarMap = new TypeVarMap();
        if (canAssignType(expectedClass, type, new DiagnosticAddendum(), typeVarMap)) {
            return specializeType(expectedClass, typeVarMap) as ClassType;
        }

        // If it's the same generic class, see if we can assign the type arguments
        // without the variance rules that canAssignType uses.
        if (
            ClassType.isSameGenericClass(type, expectedClass) &&
            expectedClass.typeArguments &&
            type.typeArguments &&
            !type.isTypeArgumentExplicit &&
            expectedClass.typeArguments.length === type.typeArguments.length
        ) {
            let isAssignable = true;
            expectedClass.typeArguments.forEach((expectedTypeArg, index) => {
                const typeTypeArg = type.typeArguments![index];
                if (!canAssignType(expectedTypeArg, typeTypeArg, new DiagnosticAddendum(), typeVarMap)) {
                    isAssignable = false;
                }
            });

            if (isAssignable) {
                return specializeType(expectedClass, typeVarMap) as ClassType;
            }
        }

        return type;
    }

    // In cases where the expected type is a specialized base class of the
    // source type, we need to determine which type arguments in the derived
    // class will make it compatible with the specialized base class. This method
    // performs this reverse mapping of type arguments and populates the type var
    // map for the target type.
    function populateTypeVarMapBasedOnExpectedType(type: ObjectType, expectedType: Type, typeVarMap: TypeVarMap) {
        // It's common for the expected type to be Optional. Remove the None
        // to see if the resulting type is an object.
        const expectedTypeWithoutNone = removeNoneFromUnion(expectedType);

        // If the resulting type isn't an object, we can't proceed.
        if (!isObject(expectedTypeWithoutNone)) {
            return;
        }

        // If the target type isn't generic, there's nothing for us to do.
        if (!requiresSpecialization(type)) {
            return;
        }

        // If the expected type is generic (not specialized), we can't proceed.
        const expectedTypeArgs = expectedTypeWithoutNone.classType.typeArguments;
        if (expectedTypeArgs === undefined) {
            return;
        }

        // If the expected type is the same as the target type (commonly the case),
        // we can use a faster method.
        if (ClassType.isSameGenericClass(expectedTypeWithoutNone.classType, type.classType)) {
            canAssignType(type, expectedTypeWithoutNone, new DiagnosticAddendum(), typeVarMap);
            return;
        }

        // Create a generic (not specialized) version of the expected type.
        const genericExpectedType = ClassType.cloneForSpecialization(
            expectedTypeWithoutNone.classType,
            undefined,
            /* isTypeArgumentExplicit */ false
        );

        // For each type param in the target type, create a placeholder type variable.
        const typeArgs = type.classType.details.typeParameters.map((_, index) => {
            const typeVar = TypeVarType.createInstance(`__${index}`, /* isParamSpec */ false, /* isSynthesized */ true);
            typeVar.details.synthesizedIndex = index;
            return typeVar;
        });

        const specializedType = ClassType.cloneForSpecialization(
            type.classType,
            typeArgs,
            /* isTypeArgumentExplicit */ true
        );
        const syntheticTypeVarMap = new TypeVarMap();
        if (canAssignType(genericExpectedType, specializedType, new DiagnosticAddendum(), syntheticTypeVarMap)) {
            genericExpectedType.details.typeParameters.forEach((typeVar, index) => {
                const synthTypeVar = syntheticTypeVarMap.getTypeVar(typeVar);

                // Is this one of the synthesized type vars we allocated above? If so,
                // the type arg that corresponds to this type var maps back to the target type.
                if (
                    synthTypeVar &&
                    isTypeVar(synthTypeVar) &&
                    synthTypeVar.details.isSynthesized &&
                    synthTypeVar.details.synthesizedIndex !== undefined
                ) {
                    const targetTypeVar = specializedType.details.typeParameters[synthTypeVar.details.synthesizedIndex];
                    if (index < expectedTypeArgs.length) {
                        typeVarMap.setTypeVar(targetTypeVar, expectedTypeArgs[index], /* isNarrowable */ false);
                    }
                }
            });
        }
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    function validateCallArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: Type,
        typeVarMap: TypeVarMap,
        skipUnknownArgCheck: boolean,
        inferReturnTypeIfNeeded = true,
        expectedType: Type | undefined
    ): CallResult {
        let callResult: CallResult = { argumentErrors: false };

        switch (callType.category) {
            case TypeCategory.Unknown:
            case TypeCategory.Any: {
                // Touch all of the args so they're marked accessed.
                argList.forEach((arg) => getTypeForArgument(arg));
                callResult.returnType = callType;
                break;
            }

            case TypeCategory.Function: {
                callResult = validateFunctionArguments(
                    errorNode,
                    argList,
                    callType,
                    typeVarMap,
                    skipUnknownArgCheck,
                    inferReturnTypeIfNeeded,
                    expectedType
                );
                break;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedFunctionType = findOverloadedFunctionType(errorNode, argList, callType, expectedType);
                if (overloadedFunctionType) {
                    callResult = validateFunctionArguments(
                        errorNode,
                        argList,
                        overloadedFunctionType,
                        typeVarMap,
                        skipUnknownArgCheck,
                        inferReturnTypeIfNeeded,
                        expectedType
                    );
                } else {
                    const exprString = ParseTreeUtils.printExpression(errorNode);
                    const diagAddendum = new DiagnosticAddendum();
                    const argTypes = argList.map((t) => printType(getTypeForArgument(t)));

                    if (errorNode.nodeType !== ParseNodeType.Call && callType.overloads[0].details.name) {
                        // If the expression isn't an explicit call, it is probably an implicit
                        // call to a magic method. Provide additional information in this case
                        // to make it clear that a call was being evaluated.
                        diagAddendum.addMessage(
                            Localizer.DiagnosticAddendum.overloadCallName().format({
                                name: callType.overloads[0].details.name,
                            })
                        );
                    }

                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.argumentTypes().format({ types: argTypes.join(', ') })
                    );
                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.noOverload().format({ expression: exprString }) + diagAddendum.getString(),
                        errorNode
                    );
                }
                break;
            }

            case TypeCategory.Class: {
                if (!ClassType.isSpecialBuiltIn(callType)) {
                    callResult = validateConstructorArguments(
                        errorNode,
                        argList,
                        callType,
                        skipUnknownArgCheck,
                        expectedType
                    );
                } else {
                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeNotIntantiable().format({ type: callType.details.name }),
                        errorNode
                    );
                }
                break;
            }

            case TypeCategory.Object: {
                const memberType = getTypeFromObjectMember(
                    errorNode,
                    callType,
                    '__call__',
                    { method: 'get' },
                    new DiagnosticAddendum(),
                    MemberAccessFlags.SkipForMethodLookup
                );

                if (memberType && memberType.category === TypeCategory.Function) {
                    const callMethodType = stripFirstParameter(memberType);
                    callResult = validateCallArguments(
                        errorNode,
                        argList,
                        callMethodType,
                        typeVarMap,
                        skipUnknownArgCheck,
                        inferReturnTypeIfNeeded,
                        expectedType
                    );
                } else {
                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.objectNotCallable().format({ type: printType(callType) }),
                        errorNode
                    );
                }
                break;
            }

            case TypeCategory.Union: {
                const returnTypes: Type[] = [];

                for (const type of callType.subtypes) {
                    if (isNone(type)) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportOptionalCall,
                            DiagnosticRule.reportOptionalCall,
                            Localizer.Diagnostic.noneNotCallable(),
                            errorNode
                        );
                    } else {
                        const subtypeCallResult = validateCallArguments(
                            errorNode,
                            argList,
                            type,
                            typeVarMap,
                            skipUnknownArgCheck,
                            inferReturnTypeIfNeeded,
                            expectedType
                        );
                        if (subtypeCallResult.returnType) {
                            returnTypes.push(subtypeCallResult.returnType);
                        }
                    }
                }

                if (returnTypes.length > 0) {
                    callResult.returnType = combineTypes(returnTypes);
                }
                break;
            }
        }

        if (!callResult.returnType) {
            // Touch all of the args so they're marked accessed.
            argList.forEach((arg) => getTypeForArgument(arg));
        }

        return callResult;
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    function validateFunctionArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        type: FunctionType,
        typeVarMap: TypeVarMap,
        skipUnknownArgCheck: boolean,
        inferReturnTypeIfNeeded = true,
        expectedType: Type | undefined
    ): CallResult {
        let argIndex = 0;
        const typeParams = type.details.parameters;

        if (expectedType && !requiresSpecialization(expectedType) && type.details.declaredReturnType) {
            // Prepopulate the typeVarMap based on the specialized expected type if the callee has a declared
            // return type. This will allow us to more closely match the expected type if possible.
            canAssignType(type.details.declaredReturnType, expectedType, new DiagnosticAddendum(), typeVarMap);
        }

        // The last parameter might be a var arg dictionary. If so, strip it off.
        const varArgDictParam = typeParams.find((param) => param.category === ParameterCategory.VarArgDictionary);
        let reportedArgError = false;

        // Build a map of parameters by name.
        const paramMap = new Map<string, ParamAssignmentInfo>();
        typeParams.forEach((param) => {
            if (param.name) {
                paramMap.set(param.name, {
                    argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
                    argsReceived: 0,
                });
            }
        });

        // Is there a bare (nameless) "*" parameter? If so, it signifies the end
        // of the positional parameter list.
        let positionalParamCount = typeParams.findIndex(
            (param) => param.category === ParameterCategory.VarArgList && !param.name
        );

        // Is there a positional-only "/" parameter? If so, it separates the
        // positional-only from positional or keyword parameters.
        const positionalOnlyIndex = typeParams.findIndex(
            (param) => param.category === ParameterCategory.Simple && !param.name
        );

        // Is there a var-arg (named "*") parameter? If so, it is the last of
        // the positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex((param) => param.category === ParameterCategory.VarArgList);
            if (positionalParamCount >= 0) {
                positionalParamCount++;
            }
        }

        // Is there a keyword var-arg ("**") parameter? If so, it's not included
        // in the list of positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(
                (param) => param.category === ParameterCategory.VarArgDictionary
            );
        }

        // If we didn't see any special cases, then all parameters are positional.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.length;
        }

        // Determine how many positional args are being passed before
        // we see a named arg.
        let positionalArgCount = argList.findIndex(
            (arg) => arg.argumentCategory === ArgumentCategory.UnpackedDictionary || arg.name !== undefined
        );
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        // If there weren't enough positional arguments to populate all of
        // the positional-only parameters, force the named parameters
        // into positional-only slots so we can report errors for them.
        if (positionalOnlyIndex >= 0 && positionalArgCount < positionalOnlyIndex) {
            const firstParamWithDefault = typeParams.findIndex((param) => param.hasDefault);
            const positionOnlyWithoutDefaultsCount =
                firstParamWithDefault >= 0 && firstParamWithDefault < positionalOnlyIndex
                    ? firstParamWithDefault
                    : positionalOnlyIndex;
            positionalArgCount = Math.min(positionOnlyWithoutDefaultsCount, argList.length);
        }

        const validateArgTypeParams: ValidateArgTypeParams[] = [];

        let activeParam: FunctionParameter | undefined;
        function trySetActive(arg: FunctionArgument, param: FunctionParameter) {
            if (arg.active) {
                activeParam = param;
            }
        }

        let foundUnpackedListArg =
            argList.find((arg) => arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

        // Map the positional args to parameters.
        let paramIndex = 0;
        let unpackedArgIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex === positionalOnlyIndex) {
                paramIndex++;
                continue;
            }

            if (argIndex < positionalOnlyIndex && argList[argIndex].name) {
                const fileInfo = getFileInfo(argList[argIndex].name!);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.argPositional(),
                    argList[argIndex].name!
                );
            }

            if (paramIndex >= positionalParamCount) {
                if (!foundUnpackedListArg || argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    const adjustedCount = positionalParamCount;
                    const fileInfo = getFileInfo(errorNode);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        adjustedCount === 1
                            ? Localizer.Diagnostic.argPositionalExpectedOne()
                            : Localizer.Diagnostic.argPositionalExpectedCount().format({ expected: adjustedCount }),
                        argList[argIndex].valueExpression || errorNode
                    );
                    reportedArgError = true;
                }
                break;
            }

            const paramType = FunctionType.getEffectiveParameterType(type, paramIndex);
            if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedList) {
                if (!argList[argIndex].valueExpression) {
                    break;
                }

                const argType = getTypeForArgument(argList[argIndex]);
                let listElementType: Type;
                let advanceToNextArg = false;

                // If this is a tuple with specified element types, use those
                // specified types rather than using the more generic iterator
                // type which will be a union of all element types.
                if (
                    isObject(argType) &&
                    ClassType.isBuiltIn(argType.classType, 'Tuple') &&
                    argType.classType.typeArguments &&
                    argType.classType.typeArguments.length > 0 &&
                    !isEllipsisType(argType.classType.typeArguments[argType.classType.typeArguments.length - 1])
                ) {
                    listElementType = argType.classType.typeArguments[unpackedArgIndex];

                    // Determine if there are any more unpacked list arguments after
                    // this one. If not, we'll clear this flag because this unpacked
                    // list arg is bounded in length.
                    foundUnpackedListArg =
                        argList.find(
                            (arg, index) => index > argIndex && arg.argumentCategory === ArgumentCategory.UnpackedList
                        ) !== undefined;

                    unpackedArgIndex++;
                    if (unpackedArgIndex >= argType.classType.typeArguments.length) {
                        unpackedArgIndex = 0;
                        advanceToNextArg = true;
                    }
                } else {
                    listElementType = getTypeFromIterable(
                        argType,
                        /* isAsync */ false,
                        argList[argIndex].valueExpression!,
                        /* supportGetItem */ false
                    );
                }

                const funcArg: FunctionArgument = {
                    argumentCategory: ArgumentCategory.Simple,
                    type: listElementType,
                };

                const paramName = typeParams[paramIndex].name;
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: funcArg,
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].isNameSynthesized ? undefined : paramName,
                });

                trySetActive(argList[argIndex], typeParams[paramIndex]);

                // Note that the parameter has received an argument.
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                if (advanceToNextArg || typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                    argIndex++;
                }

                if (typeParams[paramIndex].category !== ParameterCategory.VarArgList) {
                    paramIndex++;
                }
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].name,
                });
                trySetActive(argList[argIndex], typeParams[paramIndex]);

                argIndex++;
            } else {
                const paramName = typeParams[paramIndex].name;
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].isNameSynthesized ? undefined : paramName,
                });
                trySetActive(argList[argIndex], typeParams[paramIndex]);

                // Note that the parameter has received an argument.
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                argIndex++;
                paramIndex++;
            }
        }

        if (!reportedArgError) {
            let foundUnpackedDictionaryArg = false;

            // Now consume any named parameters.
            while (argIndex < argList.length) {
                if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedDictionary) {
                    // Mark the arg as accessed.
                    getTypeForArgument(argList[argIndex]);
                    foundUnpackedDictionaryArg = true;
                } else {
                    // Protect against the case where a non-named argument appears after
                    // a named argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = argList[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.value;
                        const paramEntry = paramMap.get(paramNameValue);
                        if (paramEntry) {
                            if (paramEntry.argsReceived > 0) {
                                addDiagnostic(
                                    getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    Localizer.Diagnostic.paramAlreadyAssigned().format({ name: paramNameValue }),
                                    paramName
                                );
                                reportedArgError = true;
                            } else {
                                paramMap.get(paramName.value)!.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex((param) => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);

                                validateArgTypeParams.push({
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramNameValue,
                                });
                                trySetActive(argList[argIndex], typeParams[paramInfoIndex]);
                            }
                        } else if (varArgDictParam) {
                            validateArgTypeParams.push({
                                paramType: varArgDictParam.type,
                                requiresTypeVarMatching: requiresSpecialization(varArgDictParam.type),
                                argument: argList[argIndex],
                                errorNode: argList[argIndex].valueExpression || errorNode,
                                paramName: paramNameValue,
                            });
                            trySetActive(argList[argIndex], varArgDictParam);
                        } else {
                            addDiagnostic(
                                getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.paramNameMissing().format({ name: paramName.value }),
                                paramName
                            );
                            reportedArgError = true;
                        }
                    }
                }

                argIndex++;
            }

            // Determine whether there are any parameters that require arguments
            // but have not yet received them. If we received a dictionary argument
            // (i.e. an arg starting with a "**") or a list argument (i.e. an arg
            // starting with a "*"), we will assume that all parameters are matched.
            if (
                !foundUnpackedDictionaryArg &&
                !foundUnpackedListArg &&
                !FunctionType.isDefaultParameterCheckDisabled(type)
            ) {
                const unassignedParams = [...paramMap.keys()].filter((name) => {
                    const entry = paramMap.get(name)!;
                    return entry.argsReceived < entry.argsNeeded;
                });

                if (unassignedParams.length > 0) {
                    const missingParamNames = unassignedParams.map((p) => `"${p}"`).join(', ');
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        unassignedParams.length === 1
                            ? Localizer.Diagnostic.argMissingForParam().format({ name: missingParamNames })
                            : Localizer.Diagnostic.argMissingForParams().format({ names: missingParamNames }),
                        errorNode
                    );
                    reportedArgError = true;
                }

                // Add any implicit (default) arguments that are needed for resolving
                // generic types. For example, if the function is defined as
                // def foo(v1: _T = 'default')
                // and _T is a TypeVar, we need to match the TypeVar to the default
                // value's type if it's not provided by the caller.
                typeParams.forEach((param) => {
                    if (param.category === ParameterCategory.Simple && param.name) {
                        const entry = paramMap.get(param.name)!;
                        if (entry.argsNeeded === 0 && entry.argsReceived === 0) {
                            if (param.defaultType && requiresSpecialization(param.type)) {
                                validateArgTypeParams.push({
                                    paramType: param.type,
                                    requiresTypeVarMatching: true,
                                    argument: {
                                        argumentCategory: ArgumentCategory.Simple,
                                        type: param.defaultType,
                                    },
                                    errorNode: errorNode,
                                    paramName: param.isNameSynthesized ? undefined : param.name,
                                });
                            }
                        }
                    }
                });
            }
        }

        // Special-case a few built-in calls that are often used for
        // casting or checking for unknown types.
        if (['cast', 'isinstance', 'issubclass'].some((name) => name === type.details.builtInName)) {
            skipUnknownArgCheck = true;
        }

        // Run through all args and validate them against their matched parameter.
        // We'll do two passes. The first one will match any type arguments. The second
        // will perform the actual validation. We can skip the first pass if there
        // are no type vars to match.
        const typeVarMatchingCount = validateArgTypeParams.filter((arg) => arg.requiresTypeVarMatching).length;
        if (typeVarMatchingCount > 0) {
            // In theory, we may need to do up to n passes where n is the number of
            // arguments that need type var matching. That's because later matches
            // can provide bidirectional type hints for earlier matches. The best
            // example of this is the built-in "map" method whose first parameter is
            // a lambda and second parameter indicates what type the lambda should accept.
            // In practice, we will limit the number of passes to 2 because it can get
            // very expensive to go beyond this, and we don't see generally see cases
            // where more than two passes are needed.
            const passCount = Math.min(typeVarMatchingCount, 2);
            for (let i = 0; i < passCount; i++) {
                useSpeculativeMode(errorNode, () => {
                    validateArgTypeParams.forEach((argParam) => {
                        if (argParam.requiresTypeVarMatching) {
                            validateArgType(argParam, typeVarMap, type.details.name, skipUnknownArgCheck);
                        }
                    });
                });
            }

            // Lock the type var map so it cannot be modified and revalidate the
            // arguments in a second pass.
            typeVarMap.lock();
        }

        validateArgTypeParams.forEach((argParam) => {
            if (!validateArgType(argParam, typeVarMap, type.details.name, skipUnknownArgCheck)) {
                reportedArgError = true;
            }
        });

        // Run through all the args that were not validated and evaluate their types
        // to ensure that we haven't missed any (due to arg/param mismatches). This will
        // ensure that referenced symbols are not reported as unaccessed.
        if (!isSpeculativeMode(undefined) && !incompleteTypeTracker.isIncompleteTypeMode()) {
            argList.forEach((arg) => {
                if (arg.valueExpression) {
                    if (!validateArgTypeParams.some((validatedArg) => validatedArg.argument === arg)) {
                        getTypeOfExpression(arg.valueExpression);
                    }
                }
            });
        }

        // Calculate the return type. If there was an error matching arguments to
        // parameters, don't bother attempting to infer the return type.
        const returnType = getFunctionEffectiveReturnType(
            type,
            validateArgTypeParams,
            inferReturnTypeIfNeeded && !reportedArgError
        );
        const specializedReturnType = specializeType(returnType, typeVarMap);

        return { argumentErrors: reportedArgError, returnType: specializedReturnType, activeParam };
    }

    function validateArgType(
        argParam: ValidateArgTypeParams,
        typeVarMap: TypeVarMap,
        functionName: string,
        skipUnknownCheck: boolean
    ): boolean {
        let argType: Type | undefined;
        let expectedTypeDiag: DiagnosticAddendum | undefined;

        if (argParam.argument.valueExpression) {
            let expectedType: Type | undefined = specializeType(argParam.paramType, typeVarMap);

            // If the expected type is unknown, don't use an expected type. Instead,
            // use default rules for evaluating the expression type.
            if (isUnknown(expectedType)) {
                expectedType = undefined;
            }

            const exprType = getTypeOfExpression(argParam.argument.valueExpression, expectedType);
            argType = exprType.type;
            expectedTypeDiag = exprType.expectedTypeDiagAddendum;

            if (argParam.argument && argParam.argument.name && !isSpeculativeMode(argParam.errorNode)) {
                writeTypeCache(argParam.argument.name, expectedType || argType);
            }
        } else {
            argType = getTypeForArgument(argParam.argument);
        }

        let diag = new DiagnosticAddendum();

        if (!canAssignType(argParam.paramType, argType, diag.createAddendum(), typeVarMap)) {
            if (!isDiagnosticSuppressedForNode(argParam.errorNode)) {
                const fileInfo = getFileInfo(argParam.errorNode);
                const argTypeText = printType(argType);
                const paramTypeText = printType(argParam.paramType);

                let message: string;
                if (argParam.paramName) {
                    if (functionName) {
                        message = Localizer.Diagnostic.argAssignmentParamFunction().format({
                            argType: argTypeText,
                            paramType: paramTypeText,
                            functionName,
                            paramName: argParam.paramName,
                        });
                    } else {
                        message = Localizer.Diagnostic.argAssignmentParam().format({
                            argType: argTypeText,
                            paramType: paramTypeText,
                            paramName: argParam.paramName,
                        });
                    }
                } else {
                    if (functionName) {
                        message = Localizer.Diagnostic.argAssignmentFunction().format({
                            argType: argTypeText,
                            paramType: paramTypeText,
                            functionName,
                        });
                    } else {
                        message = Localizer.Diagnostic.argAssignment().format({
                            argType: argTypeText,
                            paramType: paramTypeText,
                        });
                    }
                }

                // If we have an expected type diagnostic addendum, use that
                // instead of the local diagnostic addendum because it will
                // be more informative.
                if (expectedTypeDiag) {
                    diag = expectedTypeDiag;
                }

                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    message + diag.getString(),
                    argParam.errorNode
                );
            }
            return false;
        } else if (!skipUnknownCheck) {
            const simplifiedType = removeUnboundFromUnion(argType);
            const fileInfo = getFileInfo(argParam.errorNode);

            const diagAddendum = new DiagnosticAddendum();
            if (argParam.paramName) {
                diagAddendum.addMessage(
                    (functionName
                        ? Localizer.DiagnosticAddendum.argParamFunction().format({
                              paramName: argParam.paramName,
                              functionName,
                          })
                        : Localizer.DiagnosticAddendum.argParam().format({ paramName: argParam.paramName })) +
                        diagAddendum.getString()
                );
            }

            if (isUnknown(simplifiedType)) {
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportUnknownArgumentType,
                    DiagnosticRule.reportUnknownArgumentType,
                    Localizer.Diagnostic.argTypeUnknown() + diagAddendum.getString(),
                    argParam.errorNode
                );
            } else if (isPartlyUnknown(simplifiedType, true)) {
                // Don't report an error if the type is a partially-specialized
                // class. This comes up frequently in cases where a type is passed
                // as an argument (e.g. "defaultdict(list)").

                // If the parameter type is also partially unknown, don't report
                // the error because it's likely that the partially-unknown type
                // arose due to bidirectional type matching.
                if (!isPartlyUnknown(argParam.paramType) && !isClass(simplifiedType)) {
                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.argumentType().format({
                            type: printType(simplifiedType, /* expandTypeAlias */ true),
                        })
                    );
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUnknownArgumentType,
                        DiagnosticRule.reportUnknownArgumentType,
                        Localizer.Diagnostic.argTypePartiallyUnknown() + diagAddendum.getString(),
                        argParam.errorNode
                    );
                }
            }
        }

        return true;
    }

    function createTypeVarType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        isParamSpec: boolean
    ): Type | undefined {
        let typeVarName = '';
        let firstConstraintArg: FunctionArgument | undefined;

        if (isParamSpec) {
            const fileInfo = getFileInfo(errorNode);
            if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_9) {
                addError(Localizer.Diagnostic.paramSpecIllegal(), errorNode);
            }
        }

        if (argList.length === 0) {
            addError(
                isParamSpec ? Localizer.Diagnostic.paramSpecFirstArg() : Localizer.Diagnostic.typeVarFirstArg(),
                errorNode
            );
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map((s) => s.value).join('');
        } else {
            addError(
                isParamSpec ? Localizer.Diagnostic.paramSpecFirstArg() : Localizer.Diagnostic.typeVarFirstArg(),
                firstArg.valueExpression || errorNode
            );
        }

        const typeVar = TypeVarType.createInstantiable(typeVarName, isParamSpec);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.value : undefined;
            const paramNameMap = new Map<string, string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    addError(
                        Localizer.Diagnostic.duplicateParam().format({ name: paramName }),
                        argList[i].valueExpression || errorNode
                    );
                }

                if (paramName === 'bound' && !isParamSpec) {
                    if (typeVar.details.constraints.length > 0) {
                        addError(
                            Localizer.Diagnostic.typeVarBoundAndConstrained(),
                            argList[i].valueExpression || errorNode
                        );
                    } else {
                        const argType = getTypeForArgumentExpectingType(
                            argList[i],
                            getFileInfo(errorNode),
                            /* allowMissingTypeArgs */ true
                        );
                        if (requiresSpecialization(argType)) {
                            addError(Localizer.Diagnostic.typeVarGeneric(), argList[i].valueExpression || errorNode);
                        }
                        typeVar.details.boundType = convertToInstance(argType);
                    }
                } else if (paramName === 'covariant' && !isParamSpec) {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.details.isContravariant) {
                            addError(Localizer.Diagnostic.typeVarVariance(), argList[i].valueExpression!);
                        } else {
                            typeVar.details.isCovariant = true;
                        }
                    }
                } else if (paramName === 'contravariant' && !isParamSpec) {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.details.isContravariant) {
                            addError(Localizer.Diagnostic.typeVarVariance(), argList[i].valueExpression!);
                        } else {
                            typeVar.details.isContravariant = true;
                        }
                    }
                } else {
                    addError(
                        isParamSpec
                            ? Localizer.Diagnostic.paramSpecUnknownParam().format({ name: paramName })
                            : Localizer.Diagnostic.typeVarUnknownParam().format({ name: paramName }),
                        argList[i].valueExpression || errorNode
                    );
                }

                paramNameMap.set(paramName, paramName);
            } else if (!isParamSpec) {
                if (typeVar.details.boundType) {
                    addError(
                        Localizer.Diagnostic.typeVarBoundAndConstrained(),
                        argList[i].valueExpression || errorNode
                    );
                } else {
                    const argType = getTypeForArgumentExpectingType(argList[i], getFileInfo(errorNode));
                    if (requiresSpecialization(argType)) {
                        addError(Localizer.Diagnostic.typeVarGeneric(), argList[i].valueExpression || errorNode);
                    }
                    TypeVarType.addConstraint(typeVar, convertToInstance(argType));
                    if (firstConstraintArg === undefined) {
                        firstConstraintArg = argList[i];
                    }
                }
            } else {
                addError(Localizer.Diagnostic.paramSpecUnknownArg(), argList[i].valueExpression || errorNode);
                break;
            }
        }

        if (!isParamSpec && typeVar.details.constraints.length === 1 && firstConstraintArg) {
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeVarSingleConstraint(),
                firstConstraintArg.valueExpression || errorNode
            );
        }

        return typeVar;
    }

    function getBooleanValue(node: ExpressionNode): boolean {
        if (node.nodeType === ParseNodeType.Constant) {
            if (node.constType === KeywordType.False) {
                return false;
            } else if (node.constType === KeywordType.True) {
                return true;
            }
        }

        addError(Localizer.Diagnostic.expectedBoolLiteral(), node);
        return false;
    }

    function getClassFullName(classNode: ParseNode, moduleName: string, className: string): string {
        const nameParts: string[] = [className];

        let curNode: ParseNode | undefined = classNode;

        // Walk the parse tree looking for classes.
        while (curNode) {
            curNode = ParseTreeUtils.getEnclosingClass(curNode);
            if (curNode) {
                nameParts.push(curNode.name.value);
            }
        }

        nameParts.push(moduleName);

        return nameParts.reverse().join('.');
    }

    // Creates a new custom enum class with named values.
    function createEnumType(errorNode: ExpressionNode, enumClass: ClassType, argList: FunctionArgument[]): ClassType {
        const fileInfo = getFileInfo(errorNode);
        let className = 'enum';
        if (argList.length === 0) {
            addError(Localizer.Diagnostic.enumFirstArg(), errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError(Localizer.Diagnostic.enumFirstArg(), argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map((s) => s.value).join('');
            }
        }

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            ClassTypeFlags.EnumClass,
            errorNode.id,
            /* declaredMetaclass */ undefined,
            enumClass.details.effectiveMetaclass
        );
        classType.details.baseClasses.push(enumClass);
        computeMroLinearization(classType);

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        if (argList.length < 2) {
            addError(Localizer.Diagnostic.enumSecondArg(), errorNode);
        } else {
            const entriesArg = argList[1];
            if (
                entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                !entriesArg.valueExpression ||
                entriesArg.valueExpression.nodeType !== ParseNodeType.StringList
            ) {
                // Technically, the Enum constructor supports a bunch of different
                // ways to specify the items: space-delimited string, a string
                // iterator, an iterator of name/value tuples, and a dictionary
                // of name/value pairs. We support only the simple space-delimited
                // string here. For users who are interested in type checking, we
                // recommend using the more standard class declaration syntax.
                // This diagnostic is part of the reportGeneralTypeIssues since
                // it is of interest only to those who care about types.
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.enumSecondArg(),
                    argList[1].valueExpression || errorNode
                );
            } else {
                const entries = entriesArg.valueExpression.strings
                    .map((s) => s.value)
                    .join('')
                    .split(' ');
                entries.forEach((entryName) => {
                    entryName = entryName.trim();
                    if (entryName) {
                        const entryType = UnknownType.create();
                        const newSymbol = Symbol.createWithType(SymbolFlags.ClassMember, entryType);

                        // We need to associate the declaration with a parse node.
                        // In this case it's just part of a string literal value.
                        // The definition provider won't necessarily take the
                        // user to the exact spot in the string, but it's close enough.
                        const stringNode = entriesArg.valueExpression!;
                        assert(stringNode.nodeType === ParseNodeType.StringList);
                        const fileInfo = getFileInfo(errorNode);
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: stringNode as StringListNode,
                            path: fileInfo.filePath,
                            range: convertOffsetsToRange(
                                stringNode.start,
                                TextRange.getEnd(stringNode),
                                fileInfo.lines
                            ),
                            moduleName: fileInfo.moduleName,
                        };
                        newSymbol.addDeclaration(declaration);
                        classFields.set(entryName, newSymbol);
                    }
                });
            }
        }

        return classType;
    }

    // Implements the semantics of the NewType call as documented
    // in the Python specification: The static type checker will treat
    // the new type as if it were a subclass of the original type.
    function createNewType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
        const fileInfo = getFileInfo(errorNode);
        let className = '_';
        if (argList.length >= 1) {
            const nameArg = argList[0];
            if (nameArg.argumentCategory === ArgumentCategory.Simple) {
                if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                    className = nameArg.valueExpression.strings.map((s) => s.value).join('');
                }
            }
        }

        if (argList.length >= 2) {
            const baseClass = getTypeForArgumentExpectingType(argList[1], getFileInfo(errorNode));

            if (isClass(baseClass)) {
                const classFlags =
                    baseClass.details.flags & ~(ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn);
                const classType = ClassType.create(
                    className,
                    getClassFullName(errorNode, fileInfo.moduleName, className),
                    fileInfo.moduleName,
                    classFlags,
                    errorNode.id,
                    /* declaredMetaclass */ undefined,
                    baseClass.details.effectiveMetaclass
                );
                classType.details.baseClasses.push(baseClass);
                computeMroLinearization(classType);

                // Synthesize an __init__ method that accepts only the specified type.
                const initType = FunctionType.createInstance('__init__', '', FunctionTypeFlags.SynthesizedMethod);
                FunctionType.addParameter(initType, {
                    category: ParameterCategory.Simple,
                    name: 'self',
                    type: ObjectType.create(classType),
                });
                FunctionType.addParameter(initType, {
                    category: ParameterCategory.Simple,
                    name: '_x',
                    type: ObjectType.create(baseClass),
                });
                initType.details.declaredReturnType = NoneType.createInstance();
                classType.details.fields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

                // Synthesize a trivial __new__ method.
                const newType = FunctionType.createInstance(
                    '__new__',
                    '',
                    FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
                );
                FunctionType.addParameter(newType, {
                    category: ParameterCategory.Simple,
                    name: 'cls',
                    type: classType,
                });
                FunctionType.addDefaultParameters(newType);
                newType.details.declaredReturnType = ObjectType.create(classType);
                classType.details.fields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
                return classType;
            }
        }

        return undefined;
    }

    // Implements the semantics of the multi-parameter variant of the "type" call.
    function createType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
        const fileInfo = getFileInfo(errorNode);
        const arg0Type = getTypeForArgument(argList[0]);
        if (!isObject(arg0Type) || !ClassType.isBuiltIn(arg0Type.classType, 'str')) {
            return undefined;
        }
        const className = (arg0Type.classType.literalValue as string) || '_';

        const arg1Type = getTypeForArgument(argList[1]);
        if (
            !isObject(arg1Type) ||
            !ClassType.isBuiltIn(arg1Type.classType, 'Tuple') ||
            arg1Type.classType.typeArguments === undefined
        ) {
            return undefined;
        }

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            ClassTypeFlags.None,
            errorNode.id,
            /* declaredMetaclass */ undefined,
            arg1Type.classType.details.effectiveMetaclass
        );
        arg1Type.classType.typeArguments.forEach((baseClass) => {
            if (isClass(baseClass) || isAnyOrUnknown(baseClass)) {
                classType.details.baseClasses.push(baseClass);
            } else {
                addExpectedClassDiagnostic(baseClass, argList[1].valueExpression || errorNode);
            }
        });

        if (!computeMroLinearization(classType)) {
            addError(Localizer.Diagnostic.methodOrdering(), errorNode);
        }

        return classType;
    }

    // Creates a new custom TypedDict factory class.
    function createTypedDictType(
        errorNode: ExpressionNode,
        typedDictClass: ClassType,
        argList: FunctionArgument[]
    ): ClassType {
        const fileInfo = getFileInfo(errorNode);

        // TypedDict supports two different syntaxes:
        // Point2D = TypedDict('Point2D', {'x': int, 'y': int, 'label': str})
        // Point2D = TypedDict('Point2D', x=int, y=int, label=str)
        let className = 'TypedDict';
        if (argList.length === 0) {
            addError(Localizer.Diagnostic.typedDictFirstArg(), errorNode);
        } else {
            const nameArg = argList[0];
            if (
                nameArg.argumentCategory !== ArgumentCategory.Simple ||
                !nameArg.valueExpression ||
                nameArg.valueExpression.nodeType !== ParseNodeType.StringList
            ) {
                addError(Localizer.Diagnostic.typedDictFirstArg(), argList[0].valueExpression || errorNode);
            } else {
                className = nameArg.valueExpression.strings.map((s) => s.value).join('');
            }
        }

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            ClassTypeFlags.TypedDictClass,
            errorNode.id,
            /* declaredMetaclass */ undefined,
            typedDictClass.details.effectiveMetaclass
        );
        classType.details.baseClasses.push(typedDictClass);
        computeMroLinearization(classType);

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        let usingDictSyntax = false;
        if (argList.length < 2) {
            addError(Localizer.Diagnostic.typedDictSecondArgDict(), errorNode);
        } else {
            const entriesArg = argList[1];
            const entryMap = new Map<string, boolean>();

            if (
                entriesArg.argumentCategory === ArgumentCategory.Simple &&
                entriesArg.valueExpression &&
                entriesArg.valueExpression.nodeType === ParseNodeType.Dictionary
            ) {
                usingDictSyntax = true;
                const entryDict = entriesArg.valueExpression;

                entryDict.entries.forEach((entry) => {
                    if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                        addError(Localizer.Diagnostic.typedDictSecondArgDictEntry(), entry);
                        return;
                    }

                    if (entry.keyExpression.nodeType !== ParseNodeType.StringList) {
                        addError(Localizer.Diagnostic.typedDictEntryName(), entry.keyExpression);
                        return;
                    }

                    const entryName = entry.keyExpression.strings.map((s) => s.value).join('');
                    if (!entryName) {
                        addError(Localizer.Diagnostic.typedDictEmptyName(), entry.keyExpression);
                        return;
                    }

                    if (entryMap.has(entryName)) {
                        addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.keyExpression);
                        return;
                    }

                    // Record names in a map to detect duplicates.
                    entryMap.set(entryName, true);

                    // Cache the annotation type.
                    getTypeOfAnnotation(entry.valueExpression, /* allowFinal */ true);

                    const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: entry.keyExpression,
                        path: fileInfo.filePath,
                        typeAnnotationNode: entry.valueExpression,
                        range: convertOffsetsToRange(
                            entry.keyExpression.start,
                            TextRange.getEnd(entry.keyExpression),
                            fileInfo.lines
                        ),
                        moduleName: fileInfo.moduleName,
                    };
                    newSymbol.addDeclaration(declaration);

                    classFields.set(entryName, newSymbol);
                });
            } else if (entriesArg.name) {
                for (let i = 1; i < argList.length; i++) {
                    const entry = argList[i];
                    if (!entry.name || !entry.valueExpression) {
                        continue;
                    }

                    if (entryMap.has(entry.name.value)) {
                        addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.valueExpression);
                        continue;
                    }

                    // Record names in a map to detect duplicates.
                    entryMap.set(entry.name.value, true);

                    // Cache the annotation type.
                    getTypeOfAnnotation(entry.valueExpression, /* allowFinal */ true);

                    const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                    const fileInfo = getFileInfo(errorNode);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: entry.name,
                        path: fileInfo.filePath,
                        typeAnnotationNode: entry.valueExpression,
                        range: convertOffsetsToRange(
                            entry.name.start,
                            TextRange.getEnd(entry.valueExpression),
                            fileInfo.lines
                        ),
                        moduleName: fileInfo.moduleName,
                    };
                    newSymbol.addDeclaration(declaration);

                    classFields.set(entry.name.value, newSymbol);
                }
            } else {
                addError(Localizer.Diagnostic.typedDictSecondArgDict(), errorNode);
            }
        }

        if (usingDictSyntax) {
            if (argList.length >= 3) {
                if (
                    !argList[2].name ||
                    argList[2].name.value !== 'total' ||
                    !argList[2].valueExpression ||
                    argList[2].valueExpression.nodeType !== ParseNodeType.Constant ||
                    !(
                        argList[2].valueExpression.constType === KeywordType.False ||
                        argList[2].valueExpression.constType === KeywordType.True
                    )
                ) {
                    addError(Localizer.Diagnostic.typedDictTotalParam(), argList[2].valueExpression || errorNode);
                } else if (argList[2].valueExpression.constType === KeywordType.False) {
                    classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
                }
            }

            if (argList.length > 3) {
                addError(Localizer.Diagnostic.typedDictExtraArgs(), argList[3].valueExpression || errorNode);
            }
        }

        synthesizeTypedDictClassMethods(errorNode, classType);

        return classType;
    }

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    function createNamedTupleType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        includesTypes: boolean
    ): ClassType {
        const fileInfo = getFileInfo(errorNode);
        let className = 'namedtuple';
        if (argList.length === 0) {
            addError(Localizer.Diagnostic.namedTupleFirstArg(), errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError(Localizer.Diagnostic.namedTupleFirstArg(), argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map((s) => s.value).join('');
            }
        }

        const namedTupleType = getTypingType(errorNode, 'NamedTuple') || UnknownType.create();

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            ClassTypeFlags.None,
            errorNode.id,
            /* declaredMetaclass */ undefined,
            isClass(namedTupleType) ? namedTupleType.details.effectiveMetaclass : UnknownType.create()
        );
        classType.details.baseClasses.push(namedTupleType);

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        const constructorType = FunctionType.createInstance(
            '__new__',
            '',
            FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
        );
        constructorType.details.declaredReturnType = ObjectType.create(classType);
        if (ParseTreeUtils.isAssignmentToDefaultsFollowingNamedTuple(errorNode)) {
            constructorType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
        }
        FunctionType.addParameter(constructorType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType,
        });

        const selfParameter: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
        };

        let addGenericGetAttribute = false;
        const entryTypes: Type[] = [];

        if (argList.length < 2) {
            addError(Localizer.Diagnostic.namedTupleSecondArg(), errorNode);
            addGenericGetAttribute = true;
        } else {
            const entriesArg = argList[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
                addGenericGetAttribute = true;
            } else {
                if (
                    !includesTypes &&
                    entriesArg.valueExpression &&
                    entriesArg.valueExpression.nodeType === ParseNodeType.StringList
                ) {
                    const entries = entriesArg.valueExpression.strings
                        .map((s) => s.value)
                        .join('')
                        .split(/[,\s]+/);
                    entries.forEach((entryName) => {
                        entryName = entryName.trim();
                        if (entryName) {
                            const entryType = UnknownType.create();
                            const paramInfo: FunctionParameter = {
                                category: ParameterCategory.Simple,
                                name: entryName,
                                hasDeclaredType: includesTypes,
                                type: entryType,
                            };

                            FunctionType.addParameter(constructorType, paramInfo);
                            const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);

                            // We need to associate the declaration with a parse node.
                            // In this case it's just part of a string literal value.
                            // The definition provider won't necessarily take the
                            // user to the exact spot in the string, but it's close enough.
                            const stringNode = entriesArg.valueExpression!;
                            const declaration: VariableDeclaration = {
                                type: DeclarationType.Variable,
                                node: stringNode as StringListNode,
                                path: fileInfo.filePath,
                                range: convertOffsetsToRange(
                                    stringNode.start,
                                    TextRange.getEnd(stringNode),
                                    fileInfo.lines
                                ),
                                moduleName: fileInfo.moduleName,
                            };
                            newSymbol.addDeclaration(declaration);
                            classFields.set(entryName, newSymbol);
                            entryTypes.push(entryType);
                        }
                    });
                } else if (entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.List) {
                    const entryList = entriesArg.valueExpression;
                    const entryMap = new Map<string, string>();

                    entryList.entries.forEach((entry, index) => {
                        let entryTypeNode: ExpressionNode | undefined;
                        let entryType: Type | undefined;
                        let entryNameNode: ExpressionNode | undefined;
                        let entryName = '';

                        if (includesTypes) {
                            // Handle the variant that includes name/type tuples.
                            if (entry.nodeType === ParseNodeType.Tuple && entry.expressions.length === 2) {
                                entryNameNode = entry.expressions[0];
                                entryTypeNode = entry.expressions[1];
                                const entryTypeInfo = getTypeOfExpression(
                                    entryTypeNode,
                                    undefined,
                                    EvaluatorFlags.ExpectingType |
                                        EvaluatorFlags.EvaluateStringLiteralAsType |
                                        EvaluatorFlags.ParamSpecDisallowed
                                );
                                if (entryTypeInfo) {
                                    entryType = convertToInstance(entryTypeInfo.type);
                                }
                            } else {
                                addError(Localizer.Diagnostic.namedTupleNameType(), entry);
                            }
                        } else {
                            entryNameNode = entry;
                            entryType = UnknownType.create();
                        }

                        if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                            entryName = entryNameNode.strings.map((s) => s.value).join('');
                            if (!entryName) {
                                addError(Localizer.Diagnostic.namedTupleEmptyName(), entryNameNode);
                            }
                        } else {
                            addError(Localizer.Diagnostic.namedTupleNameString(), entryNameNode || entry);
                        }

                        if (!entryName) {
                            entryName = `_${index.toString()}`;
                        }

                        if (entryMap.has(entryName)) {
                            addError(Localizer.Diagnostic.namedTupleNameUnique(), entryNameNode || entry);
                        }

                        // Record names in a map to detect duplicates.
                        entryMap.set(entryName, entryName);

                        if (!entryType) {
                            entryType = UnknownType.create();
                        }

                        const paramInfo: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: entryName,
                            hasDeclaredType: includesTypes,
                            type: entryType,
                        };

                        FunctionType.addParameter(constructorType, paramInfo);
                        entryTypes.push(entryType);

                        const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
                        if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                            const declaration: VariableDeclaration = {
                                type: DeclarationType.Variable,
                                node: entryNameNode,
                                path: fileInfo.filePath,
                                typeAnnotationNode: entryTypeNode,
                                range: convertOffsetsToRange(
                                    entryNameNode.start,
                                    TextRange.getEnd(entryNameNode),
                                    fileInfo.lines
                                ),
                                moduleName: fileInfo.moduleName,
                            };
                            newSymbol.addDeclaration(declaration);
                        }
                        classFields.set(entryName, newSymbol);
                    });
                } else {
                    // A dynamic expression was used, so we can't evaluate
                    // the named tuple statically.
                    addGenericGetAttribute = true;
                }
            }
        }

        if (addGenericGetAttribute) {
            FunctionType.addDefaultParameters(constructorType);
            entryTypes.push(AnyType.create(/* isEllipsis */ false));
            entryTypes.push(AnyType.create(/* isEllipsis */ true));
        }

        // Always use generic parameters for __init__. The __new__ method
        // will handle property type checking. We may need to disable default
        // parameter processing for __new__ (see isAssignmentToDefaultsFollowingNamedTuple),
        // and we don't want to do it for __init__ as well.
        const initType = FunctionType.createInstance(
            '__init__',
            '',
            FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.SkipConstructorCheck
        );
        FunctionType.addParameter(initType, selfParameter);
        FunctionType.addDefaultParameters(initType);
        initType.details.declaredReturnType = NoneType.createInstance();

        classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
        classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

        const keysItemType = FunctionType.createInstance('keys', '', FunctionTypeFlags.SynthesizedMethod);
        const itemsItemType = FunctionType.createInstance('items', '', FunctionTypeFlags.SynthesizedMethod);
        keysItemType.details.declaredReturnType = getBuiltInObject(errorNode, 'List', [
            getBuiltInObject(errorNode, 'str'),
        ]);
        itemsItemType.details.declaredReturnType = keysItemType.details.declaredReturnType;
        classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
        classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, itemsItemType));

        const lenType = FunctionType.createInstance('__len__', '', FunctionTypeFlags.SynthesizedMethod);
        lenType.details.declaredReturnType = getBuiltInObject(errorNode, 'int');
        FunctionType.addParameter(lenType, selfParameter);
        classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

        if (addGenericGetAttribute) {
            const getAttribType = FunctionType.createInstance(
                '__getattribute__',
                '',
                FunctionTypeFlags.SynthesizedMethod
            );
            getAttribType.details.declaredReturnType = AnyType.create();
            FunctionType.addParameter(getAttribType, selfParameter);
            FunctionType.addParameter(getAttribType, {
                category: ParameterCategory.Simple,
                name: 'name',
                type: getBuiltInObject(errorNode, 'str'),
            });
            classFields.set('__getattribute__', Symbol.createWithType(SymbolFlags.ClassMember, getAttribType));
        }

        computeMroLinearization(classType);

        updateNamedTupleBaseClass(classType, entryTypes, !addGenericGetAttribute);

        return classType;
    }

    function getTypeFromConstant(node: ConstantNode, flags: EvaluatorFlags): TypeResult | undefined {
        let type: Type | undefined;

        if (node.constType === KeywordType.None) {
            type = (flags & EvaluatorFlags.ExpectingType) !== 0 ? NoneType.createType() : NoneType.createInstance();
        } else if (
            node.constType === KeywordType.True ||
            node.constType === KeywordType.False ||
            node.constType === KeywordType.Debug
        ) {
            type = getBuiltInObject(node, 'bool');

            // For True and False, we can create truthy and falsy
            // versions of 'bool'.
            if (type && isObject(type)) {
                if (node.constType === KeywordType.True) {
                    type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, true));
                } else if (node.constType === KeywordType.False) {
                    type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, false));
                }
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    function getTypeFromUnaryOperation(node: UnaryOperationNode, expectedType: Type | undefined): TypeResult {
        let exprType = makeTypeVarsConcrete(getTypeOfExpression(node.expression).type);

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '__pos__',
            [OperatorType.Subtract]: '__neg__',
            [OperatorType.BitwiseInvert]: '__invert__',
        };

        let type: Type | undefined;

        if (node.operator !== OperatorType.Not) {
            if (isOptionalType(exprType)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticRuleSet.reportOptionalOperand,
                    DiagnosticRule.reportOptionalOperand,
                    Localizer.Diagnostic.noneOperator().format({
                        operator: ParseTreeUtils.printOperator(node.operator),
                    }),
                    node.expression
                );
                exprType = removeNoneFromUnion(exprType);
            }
        }

        // __not__ always returns a boolean.
        if (node.operator === OperatorType.Not) {
            type = getBuiltInObject(node, 'bool');
            if (!type) {
                type = UnknownType.create();
            }
        } else {
            if (isAnyOrUnknown(exprType)) {
                type = exprType;
            } else {
                const magicMethodName = unaryOperatorMap[node.operator];
                type = getTypeFromMagicMethodReturn(exprType, [], magicMethodName, node, expectedType);
            }

            if (!type) {
                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotSupportUnaryOperator().format({
                        operator: ParseTreeUtils.printOperator(node.operator),
                        type: printType(exprType),
                    }),
                    node
                );
                type = UnknownType.create();
            }
        }

        // Handle the special case where the unary operator is + or -, the operand
        // is a literal int, and the resulting type is an int. In these cases, we'll
        // want to interpret the resulting type as a literal.
        if (node.operator === OperatorType.Add || node.operator === OperatorType.Subtract) {
            if (
                isObject(type) &&
                ClassType.isBuiltIn(type.classType, 'int') &&
                isObject(exprType) &&
                ClassType.isBuiltIn(exprType.classType, 'int') &&
                typeof exprType.classType.literalValue === 'number'
            ) {
                const value =
                    node.operator === OperatorType.Add
                        ? exprType.classType.literalValue
                        : -exprType.classType.literalValue;
                type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, value));
            }
        }

        return { type, node };
    }

    function getTypeFromBinaryOperation(
        node: BinaryOperationNode,
        expectedType: Type | undefined,
        flags: EvaluatorFlags
    ): TypeResult {
        let leftExpression = node.leftExpression;

        // If this is a comparison and the left expression is also a comparison,
        // we need to change the behavior to accommodate python's "chained
        // comparisons" feature.
        if (comparisonOperatorMap[node.operator]) {
            if (
                node.leftExpression.nodeType === ParseNodeType.BinaryOperation &&
                !node.leftExpression.parenthesized &&
                comparisonOperatorMap[node.leftExpression.operator]
            ) {
                // Evaluate the left expression so it is type checked.
                getTypeFromBinaryOperation(node.leftExpression, expectedType, flags);

                // Use the right side of the left expression for comparison purposes.
                leftExpression = node.leftExpression.rightExpression;
            }
        }

        let leftType = makeTypeVarsConcrete(getTypeOfExpression(leftExpression).type);
        let rightType = makeTypeVarsConcrete(getTypeOfExpression(node.rightExpression).type);

        // Is this a "|" operator used in a context where it is supposed to be
        // interpreted as a union operator?
        if (node.operator === OperatorType.BitwiseOr) {
            let adjustedRightType = rightType;
            if (!isNone(leftType) && isNone(rightType) && TypeBase.isInstance(rightType)) {
                // Handle the special case where "None" is being added to the union
                // with something else. Even though "None" will normally be interpreted
                // as the None singleton object in contexts where a type annotation isn't
                // assumed, we'll allow it here.
                adjustedRightType = NoneType.createType();
            }

            if (isUnionableType([leftType, adjustedRightType])) {
                const fileInfo = getFileInfo(node);
                const unionNotationSupported =
                    fileInfo.isStubFile || fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_10;
                if (!unionNotationSupported) {
                    addError(Localizer.Diagnostic.unionSyntaxIllegal(), node, node.operatorToken);
                }

                return {
                    type: combineTypes([leftType, adjustedRightType]),
                    node,
                };
            }
        }

        // Optional checks apply to all operations except for boolean operations.
        if (booleanOperatorMap[node.operator] === undefined) {
            if (isOptionalType(leftType)) {
                // Skip the optional error reporting for == and !=, since
                // None is a valid operand for these operators.
                if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportOptionalOperand,
                        DiagnosticRule.reportOptionalOperand,
                        Localizer.Diagnostic.noneOperator().format({
                            operator: ParseTreeUtils.printOperator(node.operator),
                        }),
                        node.leftExpression
                    );
                }
                leftType = removeNoneFromUnion(leftType);
            }

            // None is a valid operand for == and != even if the type stub says otherwise.
            if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
                rightType = removeNoneFromUnion(rightType);
            }
        }

        return {
            type: validateBinaryOperation(node.operator, leftType, rightType, node, expectedType),
            node,
        };
    }

    function getTypeFromAugmentedAssignment(node: AugmentedAssignmentNode, expectedType: Type | undefined): Type {
        const operatorMap: { [operator: number]: [string, OperatorType] } = {
            [OperatorType.AddEqual]: ['__iadd__', OperatorType.Add],
            [OperatorType.SubtractEqual]: ['__isub__', OperatorType.Subtract],
            [OperatorType.MultiplyEqual]: ['__imul__', OperatorType.Multiply],
            [OperatorType.FloorDivideEqual]: ['__ifloordiv__', OperatorType.FloorDivide],
            [OperatorType.DivideEqual]: ['__itruediv__', OperatorType.Divide],
            [OperatorType.ModEqual]: ['__imod__', OperatorType.Mod],
            [OperatorType.PowerEqual]: ['__ipow__', OperatorType.Power],
            [OperatorType.MatrixMultiplyEqual]: ['__imatmul__', OperatorType.MatrixMultiply],
            [OperatorType.BitwiseAndEqual]: ['__iand__', OperatorType.BitwiseAnd],
            [OperatorType.BitwiseOrEqual]: ['__ior__', OperatorType.BitwiseOr],
            [OperatorType.BitwiseXorEqual]: ['__ixor__', OperatorType.BitwiseXor],
            [OperatorType.LeftShiftEqual]: ['__ilshift__', OperatorType.LeftShift],
            [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift],
        };

        let type: Type | undefined;

        const leftType = makeTypeVarsConcrete(getTypeOfExpression(node.leftExpression).type);
        const rightType = makeTypeVarsConcrete(getTypeOfExpression(node.rightExpression).type);

        type = doForSubtypes(leftType!, (leftSubtype) => {
            return doForSubtypes(rightType, (rightSubtype) => {
                if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                    // If either type is "Unknown" (versus Any), propagate the Unknown.
                    if (isUnknown(leftSubtype) || isUnknown(rightSubtype)) {
                        return UnknownType.create();
                    } else {
                        return AnyType.create();
                    }
                }

                const magicMethodName = operatorMap[node.operator][0];
                return getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype], magicMethodName, node, expectedType);
            });
        });

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type || isNever(type)) {
            const binaryOperator = operatorMap[node.operator][1];
            type = validateBinaryOperation(binaryOperator, leftType!, rightType, node, expectedType);
        }

        return type;
    }

    function validateBinaryOperation(
        operator: OperatorType,
        leftType: Type,
        rightType: Type,
        errorNode: ExpressionNode,
        expectedType: Type | undefined
    ): Type {
        let type: Type | undefined;

        if (arithmeticOperatorMap[operator]) {
            type = doForSubtypes(leftType, (leftSubtype) => {
                return doForSubtypes(rightType, (rightSubtype) => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (isUnknown(leftSubtype) || isUnknown(rightSubtype)) {
                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    const magicMethodName = arithmeticOperatorMap[operator][0];
                    const resultType = getTypeFromMagicMethodReturn(
                        leftSubtype,
                        [rightSubtype],
                        magicMethodName,
                        errorNode,
                        expectedType
                    );
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = arithmeticOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(
                        rightSubtype,
                        [leftSubtype],
                        altMagicMethodName,
                        errorNode,
                        expectedType
                    );
                });
            });
        } else if (bitwiseOperatorMap[operator]) {
            type = doForSubtypes(leftType, (leftSubtype) => {
                return doForSubtypes(rightType, (rightSubtype) => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (isUnknown(leftSubtype) || isUnknown(rightSubtype)) {
                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    // Handle the general case.
                    const magicMethodName = bitwiseOperatorMap[operator][0];
                    return getTypeFromMagicMethodReturn(
                        leftSubtype,
                        [rightSubtype],
                        magicMethodName,
                        errorNode,
                        expectedType
                    );
                });
            });
        } else if (comparisonOperatorMap[operator]) {
            type = doForSubtypes(leftType, (leftSubtype) => {
                return doForSubtypes(rightType, (rightSubtype) => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (isUnknown(leftSubtype) || isUnknown(rightSubtype)) {
                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    const magicMethodName = comparisonOperatorMap[operator][0];
                    const resultType = getTypeFromMagicMethodReturn(
                        leftSubtype,
                        [rightSubtype],
                        magicMethodName,
                        errorNode,
                        expectedType
                    );
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = comparisonOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(
                        rightSubtype,
                        [leftSubtype],
                        altMagicMethodName,
                        errorNode,
                        expectedType
                    );
                });
            });
        } else if (booleanOperatorMap[operator]) {
            // If it's an AND or OR, we need to handle short-circuiting by
            // eliminating any known-truthy or known-falsy types.
            if (operator === OperatorType.And) {
                leftType = removeTruthinessFromType(leftType);

                // If the LHS evaluates to False, the And expression will
                // always return the type of the right-hand side.
                if (isNever(leftType)) {
                    return rightType;
                }
            } else if (operator === OperatorType.Or) {
                leftType = removeFalsinessFromType(leftType);

                // If the LHS evaluates to True, the Or expression will
                // always return the type of the right-hand side.
                if (isNever(leftType)) {
                    return rightType;
                }
            }

            // The "in" and "not in" operators make use of the __contains__
            // magic method.
            if (operator === OperatorType.In || operator === OperatorType.NotIn) {
                type = doForSubtypes(rightType, (rightSubtype) => {
                    return doForSubtypes(leftType, (leftSubtype) => {
                        if (isAnyOrUnknown(rightSubtype) || isAnyOrUnknown(leftSubtype)) {
                            // If either type is "Unknown" (versus Any), propagate the Unknown.
                            if (isUnknown(leftSubtype) || isUnknown(rightSubtype)) {
                                return UnknownType.create();
                            } else {
                                return AnyType.create();
                            }
                        }

                        let returnType = getTypeFromMagicMethodReturn(
                            rightSubtype,
                            [leftSubtype],
                            '__contains__',
                            errorNode,
                            /* expectedType */ undefined
                        );

                        if (!returnType) {
                            // If __contains__ was not supported, fall back
                            // on an iterable.
                            const iteratorType = getTypeFromIterable(
                                rightSubtype,
                                /* isAsync */ false,
                                errorNode,
                                /* supportGetItem */ false
                            );

                            if (iteratorType && canAssignType(iteratorType, leftSubtype, new DiagnosticAddendum())) {
                                returnType = iteratorType;
                            }
                        }

                        return returnType;
                    });
                });

                // Assume that a bool is returned even if the type is unknown
                if (type && !isNever(type)) {
                    type = getBuiltInObject(errorNode, 'bool');
                }
            } else {
                type = doForSubtypes(leftType, (leftSubtype) => {
                    return doForSubtypes(rightType, (rightSubtype) => {
                        // If the operator is an AND or OR, we need to combine the two types.
                        if (operator === OperatorType.And || operator === OperatorType.Or) {
                            return combineTypes([leftSubtype, rightSubtype]);
                        }
                        // The other boolean operators always return a bool value.
                        return getBuiltInObject(errorNode, 'bool');
                    });
                });
            }
        }

        if (!type || isNever(type)) {
            const fileInfo = getFileInfo(errorNode);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotSupportBinaryOperator().format({
                    operator: ParseTreeUtils.printOperator(operator),
                    leftType: printType(leftType),
                    rightType: printType(rightType),
                }),
                errorNode
            );
            type = UnknownType.create();
        }

        return type;
    }

    function getTypeFromMagicMethodReturn(
        objType: Type,
        args: Type[],
        magicMethodName: string,
        errorNode: ExpressionNode,
        expectedType: Type | undefined
    ): Type | undefined {
        let magicMethodSupported = true;

        // Create a helper lambda for object subtypes.
        const handleObjectSubtype = (subtype: ObjectType, bindToClassType?: ClassType) => {
            const magicMethodType = getTypeFromObjectMember(
                errorNode,
                subtype,
                magicMethodName,
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipForMethodLookup,
                bindToClassType
            );

            if (magicMethodType) {
                const functionArgs = args.map((arg) => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg,
                    };
                });

                let callResult: CallResult | undefined;

                suppressDiagnostics(() => {
                    callResult = validateCallArguments(
                        errorNode,
                        functionArgs,
                        magicMethodType,
                        new TypeVarMap(),
                        /* skipUnknownArgCheck */ true,
                        /* inferFunctionReturnType */ true,
                        expectedType
                    );
                });

                if (callResult!.argumentErrors) {
                    magicMethodSupported = false;
                }

                return callResult!.returnType;
            }

            magicMethodSupported = false;
            return undefined;
        };

        const returnType = doForSubtypes(objType, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isObject(subtype)) {
                return handleObjectSubtype(subtype);
            } else if (isClass(subtype)) {
                // See if the class has a metaclass that handles the operation.
                const metaclass = subtype.details.effectiveMetaclass;
                if (metaclass && isClass(metaclass)) {
                    return handleObjectSubtype(ObjectType.create(metaclass), subtype);
                }
            } else if (isNone(subtype)) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = getBuiltInObject(errorNode, 'object');
                if (isObject(obj)) {
                    return handleObjectSubtype(obj);
                }
            }

            magicMethodSupported = false;
            return undefined;
        });

        if (!magicMethodSupported) {
            return undefined;
        }

        return returnType;
    }

    function getTypeFromSet(node: SetNode, expectedType: Type | undefined): TypeResult {
        const entryTypes = node.entries.map((entryNode) => {
            if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                return getElementTypeFromListComprehension(entryNode);
            }
            return getTypeOfExpression(entryNode).type;
        });

        // If there is an expected type, see if we can match it.
        if (expectedType && entryTypes.length > 0) {
            const narrowedExpectedType = doForSubtypes(expectedType, (subtype) => {
                if (isObject(subtype)) {
                    const classAlias = subtype.classType.details.aliasClass || subtype.classType;
                    if (ClassType.isBuiltIn(classAlias, 'set') && subtype.classType.typeArguments) {
                        const typeArg = subtype.classType.typeArguments[0];
                        const typeVarMap = new TypeVarMap();

                        for (const entryType of entryTypes) {
                            if (!canAssignType(typeArg, entryType, new DiagnosticAddendum(), typeVarMap)) {
                                return undefined;
                            }
                        }

                        return specializeType(subtype, typeVarMap);
                    }
                }

                return undefined;
            });

            if (!isNever(narrowedExpectedType)) {
                return { type: narrowedExpectedType, node };
            }
        }

        let inferredEntryType =
            entryTypes.length > 0 ? combineTypes(entryTypes.map((t) => stripLiteralValue(t))) : AnyType.create();

        // If we weren't provided an expected type, strip away any
        // literals from the set.
        if (!expectedType) {
            inferredEntryType = stripLiteralValue(inferredEntryType);
        }

        const type = getBuiltInObject(node, 'Set', [inferredEntryType]);

        return { type, node };
    }

    function getTypeFromDictionary(node: DictionaryNode, expectedType: Type | undefined): TypeResult {
        let keyType: Type = AnyType.create();
        let valueType: Type = AnyType.create();

        let keyTypes: Type[] = [];
        let valueTypes: Type[] = [];

        let expectedKeyType: Type | undefined;
        let expectedValueType: Type | undefined;
        let expectedTypedDictEntries: Map<string, TypedDictEntry> | undefined;
        const diagAddendum = new DiagnosticAddendum();

        if (expectedType && isObject(expectedType)) {
            const expectedClass = expectedType.classType;
            if (
                ClassType.isBuiltIn(expectedClass, 'Mapping') ||
                ClassType.isBuiltIn(expectedClass, 'Dict') ||
                ClassType.isBuiltIn(expectedClass, 'dict')
            ) {
                if (expectedClass.typeArguments && expectedClass.typeArguments.length === 2) {
                    expectedKeyType = specializeType(expectedClass.typeArguments[0], /* typeVarMap */ undefined);
                    expectedValueType = specializeType(expectedClass.typeArguments[1], /* typeVarMap */ undefined);
                }
            } else if (ClassType.isTypedDictClass(expectedClass)) {
                expectedTypedDictEntries = getTypedDictMembersForClass(expectedClass);
            }
        }

        // Infer the key and value types if possible.
        node.entries.forEach((entryNode) => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                let keyType = getTypeOfExpression(entryNode.keyExpression, expectedKeyType).type;
                if (expectedKeyType) {
                    const adjExpectedKeyType = makeTypeVarsConcrete(expectedKeyType);
                    if (!isAnyOrUnknown(adjExpectedKeyType)) {
                        if (canAssignType(adjExpectedKeyType, keyType, new DiagnosticAddendum(), undefined)) {
                            keyType = adjExpectedKeyType;
                        }
                    }
                }
                let valueType: Type | undefined;

                if (
                    expectedTypedDictEntries &&
                    isObject(keyType) &&
                    ClassType.isBuiltIn(keyType.classType, 'str') &&
                    keyType.classType.literalValue &&
                    expectedTypedDictEntries.has(keyType.classType.literalValue as string)
                ) {
                    valueType = getTypeOfExpression(
                        entryNode.valueExpression,
                        expectedTypedDictEntries.get(keyType.classType.literalValue as string)!.valueType
                    ).type;
                } else {
                    valueType = getTypeOfExpression(entryNode.valueExpression, expectedValueType).type;
                }

                keyTypes.push(keyType);
                valueTypes.push(valueType);
                addUnknown = false;
            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                const unexpandedType = getTypeOfExpression(entryNode.expandExpression).type;
                if (isAnyOrUnknown(unexpandedType)) {
                    addUnknown = false;
                } else {
                    if (isObject(unexpandedType)) {
                        const classType = unexpandedType.classType;
                        const aliasType = classType.details.aliasClass || classType;

                        if (ClassType.isBuiltIn(aliasType, 'dict')) {
                            const typeArgs = classType.typeArguments;
                            if (typeArgs && typeArgs.length >= 2) {
                                keyTypes.push(typeArgs[0]);
                                valueTypes.push(typeArgs[1]);
                                addUnknown = false;
                            }
                        }
                    }
                }
            } else if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                const dictEntryType = getElementTypeFromListComprehension(entryNode);

                // The result should be a Tuple
                if (isObject(dictEntryType)) {
                    const classType = dictEntryType.classType;
                    if (ClassType.isBuiltIn(classType, 'Tuple')) {
                        const typeArgs = classType.typeArguments;
                        if (typeArgs && typeArgs.length === 2) {
                            keyTypes.push(typeArgs[0]);
                            valueTypes.push(typeArgs[1]);
                            addUnknown = false;
                        }
                    }
                }
            }

            if (addUnknown) {
                keyTypes.push(UnknownType.create());
                valueTypes.push(UnknownType.create());
            }
        });

        // If there is an expected type, see if we can match any parts of it.
        if (expectedType) {
            const narrowedExpectedType = doForSubtypes(expectedType, (subtype) => {
                if (!isObject(subtype)) {
                    return undefined;
                }

                if (
                    ClassType.isTypedDictClass(subtype.classType) &&
                    canAssignToTypedDict(subtype.classType, keyTypes, valueTypes, diagAddendum)
                ) {
                    return subtype;
                }

                const classAlias = subtype.classType.details.aliasClass || subtype.classType;
                if (ClassType.isBuiltIn(classAlias, 'dict') && subtype.classType.typeArguments) {
                    const typeArg0 = transformPossibleRecursiveTypeAlias(subtype.classType.typeArguments[0]);
                    const typeArg1 = transformPossibleRecursiveTypeAlias(subtype.classType.typeArguments[1]);
                    const typeVarMap = new TypeVarMap();

                    for (const keyType of keyTypes) {
                        if (!canAssignType(typeArg0, keyType, new DiagnosticAddendum(), typeVarMap)) {
                            return undefined;
                        }
                    }

                    for (const valueType of valueTypes) {
                        if (!canAssignType(typeArg1, valueType, new DiagnosticAddendum(), typeVarMap)) {
                            return undefined;
                        }
                    }

                    return specializeType(subtype, typeVarMap);
                }

                return undefined;
            });

            if (!isNever(narrowedExpectedType)) {
                return { type: narrowedExpectedType, node };
            }
        }

        // Strip any literal values.
        keyTypes = keyTypes.map((t) => stripLiteralValue(t));
        valueTypes = valueTypes.map((t) => stripLiteralValue(t));

        keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : AnyType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (getFileInfo(node).diagnosticRuleSet.strictDictionaryInference) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = areTypesSame(valueTypes) ? valueTypes[0] : UnknownType.create();
            }
        } else {
            valueType = AnyType.create();
        }

        // If we weren't provided an expected type, strip away any
        // literals from the key and value.
        if (!expectedType) {
            keyType = stripLiteralValue(keyType);
            valueType = stripLiteralValue(valueType);
        }

        const type = getBuiltInObject(node, 'Dict', [keyType, valueType]);

        return { type, node, expectedTypeDiagAddendum: !diagAddendum.isEmpty() ? diagAddendum : undefined };
    }

    function getTypeFromList(node: ListNode, expectedType: Type | undefined): TypeResult {
        // Define a local helper function that determines whether a
        // type is a list and returns the list element type if it is.
        const getListTypeArg = (potentialList: Type) => {
            return doForSubtypes(potentialList, (subtype) => {
                subtype = transformPossibleRecursiveTypeAlias(subtype);
                if (!isObject(subtype)) {
                    return undefined;
                }

                const classAlias = subtype.classType.details.aliasClass || subtype.classType;
                if (!ClassType.isBuiltIn(classAlias, 'list') || !subtype.classType.typeArguments) {
                    return undefined;
                }

                return subtype.classType.typeArguments[0];
            });
        };

        const expectedEntryType = expectedType ? getListTypeArg(expectedType) : undefined;

        let entryTypes = node.entries.map((entry) => {
            if (entry.nodeType === ParseNodeType.ListComprehension) {
                return getElementTypeFromListComprehension(entry, expectedEntryType);
            }
            return getTypeOfExpression(entry, expectedEntryType).type;
        });

        // If there is an expected type, see if we can match it.
        if (expectedType && entryTypes.length > 0) {
            const narrowedExpectedType = doForSubtypes(expectedType, (subtype) => {
                const expectedListElementType = getListTypeArg(subtype);
                if (expectedListElementType) {
                    const typeVarMap = new TypeVarMap();

                    for (const entryType of entryTypes) {
                        let assignedNonLiteral = false;

                        // If the entry type is a literal value, try to assign a non-literal
                        // type first to avoid over-narrowing. This may not work if the expected
                        // element type is a literal or a TypeVar bound to a literal.
                        const nonLiteralEntryType = stripLiteralValue(entryType);
                        if (entryType !== nonLiteralEntryType) {
                            if (
                                canAssignType(
                                    expectedListElementType,
                                    nonLiteralEntryType,
                                    new DiagnosticAddendum(),
                                    typeVarMap
                                )
                            ) {
                                assignedNonLiteral = true;
                            }
                        }

                        if (!assignedNonLiteral) {
                            if (
                                !canAssignType(expectedListElementType, entryType, new DiagnosticAddendum(), typeVarMap)
                            ) {
                                return undefined;
                            }
                        }
                    }

                    return specializeType(subtype, typeVarMap);
                }

                return undefined;
            });

            if (!isNever(narrowedExpectedType)) {
                return { type: narrowedExpectedType, node };
            }
        }

        entryTypes = entryTypes.map((t) => stripLiteralValue(t));

        let inferredEntryType: Type = AnyType.create();
        if (entryTypes.length > 0) {
            // If there was an expected type or we're using strict list inference,
            // combine the types into a union.
            if (expectedType || getFileInfo(node).diagnosticRuleSet.strictListInference) {
                inferredEntryType = combineTypes(entryTypes);
            } else {
                // Is the list homogeneous? If so, use stricter rules. Otherwise relax the rules.
                inferredEntryType = areTypesSame(entryTypes) ? entryTypes[0] : UnknownType.create();
            }
        }

        // If we weren't provided an expected type, strip away any
        // literals from the list. The user is probably not expecting
        // ['a'] to be interpreted as type List[Literal['a']] but
        // instead List[str].
        if (!expectedType) {
            inferredEntryType = stripLiteralValue(inferredEntryType);
        }

        const type = getBuiltInObject(node, 'List', [inferredEntryType]);

        return { type, node };
    }

    function getTypeFromTernary(node: TernaryNode, flags: EvaluatorFlags, expectedType: Type | undefined): TypeResult {
        getTypeOfExpression(node.testExpression);

        const ifType = getTypeOfExpression(node.ifExpression, expectedType, flags);
        const elseType = getTypeOfExpression(node.elseExpression, expectedType, flags);

        const type = combineTypes([ifType.type, elseType.type]);
        return { type, node };
    }

    function getTypeFromYield(node: YieldNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionTypeInfo = getTypeOfFunction(enclosingFunction);
            if (functionTypeInfo) {
                sentType = getDeclaredGeneratorSendType(functionTypeInfo.functionType);
            }
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        if (node.expression) {
            getTypeOfExpression(node.expression, sentType);
        }

        return { type: sentType, node };
    }

    function getTypeFromYieldFrom(node: YieldFromNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionTypeInfo = getTypeOfFunction(enclosingFunction);
            if (functionTypeInfo) {
                sentType = getDeclaredGeneratorSendType(functionTypeInfo.functionType);
            }
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        if (node.expression) {
            getTypeOfExpression(node.expression, sentType);
        }

        return { type: sentType, node };
    }

    function getTypeFromLambda(node: LambdaNode, expectedType: Type | undefined): TypeResult {
        const functionType = FunctionType.createInstance('', '', FunctionTypeFlags.None);

        // Pre-cache the newly-created function type.
        writeTypeCache(node, functionType);

        let expectedFunctionType: FunctionType | undefined;
        if (expectedType) {
            if (expectedType.category === TypeCategory.Function) {
                expectedFunctionType = expectedType;
            } else if (expectedType.category === TypeCategory.Union) {
                // It's not clear what we should do with a union type. For now,
                // simply use the first function in the union.
                expectedFunctionType = expectedType.subtypes.find(
                    (t) => t.category === TypeCategory.Function
                ) as FunctionType;
            }
        }

        node.parameters.forEach((param, index) => {
            let paramType: Type = UnknownType.create();
            if (expectedFunctionType && index < expectedFunctionType.details.parameters.length) {
                paramType = FunctionType.getEffectiveParameterType(expectedFunctionType, index);
                paramType = specializeType(paramType, /* typeVarMap */ undefined, /* makeConcrete */ true);
            }

            if (param.name) {
                writeTypeCache(param.name, paramType);
            }

            if (param.defaultValue) {
                // Evaluate the default value if it's present.
                getTypeOfExpression(param.defaultValue, undefined, EvaluatorFlags.ConvertEllipsisToAny);
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.value : undefined,
                hasDefault: !!param.defaultValue,
                type: paramType,
            };
            FunctionType.addParameter(functionType, functionParam);
        });

        const expectedReturnType = expectedFunctionType
            ? getFunctionEffectiveReturnType(expectedFunctionType)
            : undefined;
        functionType.inferredReturnType = getTypeOfExpression(node.expression, expectedReturnType).type;

        return { type: functionType, node };
    }

    function getTypeFromListComprehension(node: ListComprehensionNode): TypeResult {
        const elementType = getElementTypeFromListComprehension(node);

        const isAsync = node.comprehensions.some((comp) => {
            return comp.nodeType === ParseNodeType.ListComprehensionFor && comp.isAsync;
        });
        let type: Type = UnknownType.create();
        const builtInIteratorType = getTypingType(node, isAsync ? 'AsyncGenerator' : 'Generator');

        if (builtInIteratorType && isClass(builtInIteratorType)) {
            type = ObjectType.create(
                ClassType.cloneForSpecialization(builtInIteratorType, [elementType], /* isTypeArgumentExplicit */ false)
            );
        }

        return { type, node };
    }

    function reportPossibleUnknownAssignment(
        diagLevel: DiagnosticLevel,
        rule: string,
        target: NameNode,
        type: Type,
        errorNode: ExpressionNode
    ) {
        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.value;

        // Sometimes variables contain an "unbound" type if they're
        // assigned only within conditional statements. Remove this
        // to avoid confusion.
        const simplifiedType = removeUnboundFromUnion(type);

        if (isUnknown(simplifiedType)) {
            addDiagnostic(diagLevel, rule, Localizer.Diagnostic.typeUnknown().format({ name: nameValue }), errorNode);
        } else if (isPartlyUnknown(simplifiedType)) {
            const diagAddendum = new DiagnosticAddendum();
            diagAddendum.addMessage(
                Localizer.DiagnosticAddendum.typeOfSymbol().format({
                    name: nameValue,
                    type: printType(simplifiedType, /* expandTypeAlias */ true),
                })
            );
            addDiagnostic(
                diagLevel,
                rule,
                Localizer.Diagnostic.typePartiallyUnknown().format({ name: nameValue }) + diagAddendum.getString(),
                errorNode
            );
        }
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    function getElementTypeFromListComprehension(node: ListComprehensionNode, expectedElementType?: Type): Type {
        // "Execute" the list comprehensions from start to finish.
        for (const comprehension of node.comprehensions) {
            if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                const iterableType = stripLiteralValue(getTypeOfExpression(comprehension.iterableExpression).type);
                const itemType = getTypeFromIterable(
                    iterableType,
                    !!comprehension.isAsync,
                    comprehension.iterableExpression,
                    /* supportGetItem */ false
                );

                const targetExpr = comprehension.targetExpression;
                assignTypeToExpression(targetExpr, itemType, comprehension.iterableExpression);
            } else {
                assert(comprehension.nodeType === ParseNodeType.ListComprehensionIf);

                // Evaluate the test expression to validate it and mark symbols
                // as referenced. Don't bother doing this if we're in speculative
                // mode because it doesn't affect the element type.
                if (!isSpeculativeMode(comprehension.testExpression)) {
                    getTypeOfExpression(comprehension.testExpression);
                }
            }
        }

        let type: Type = UnknownType.create();
        if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
            // Create a tuple with the key/value types.
            const keyType = stripLiteralValue(getTypeOfExpression(node.expression.keyExpression).type);
            const valueType = stripLiteralValue(getTypeOfExpression(node.expression.valueExpression).type);

            type = getBuiltInType(node, 'Tuple');
            if (isClass(type)) {
                type = convertToInstance(
                    cloneTupleForSpecialization(type, [keyType, valueType], /* isTypeArgumentExplicit */ true)
                );
            }
        } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
            // The parser should have reported an error in this case because it's not allowed.
            getTypeOfExpression(node.expression.expandExpression);
        } else if (isExpressionNode(node)) {
            type = stripLiteralValue(getTypeOfExpression(node.expression as ExpressionNode, expectedElementType).type);
        }

        return type;
    }

    function getTypeFromSlice(node: SliceNode): TypeResult {
        // Evaluate the expressions to report errors and record symbol references.
        if (node.startValue) {
            getTypeOfExpression(node.startValue);
        }

        if (node.endValue) {
            getTypeOfExpression(node.endValue);
        }

        if (node.stepValue) {
            getTypeOfExpression(node.stepValue);
        }

        return { type: getBuiltInObject(node, 'slice'), node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    function createCallableType(typeArgs?: TypeResult[]): FunctionType {
        const functionType = FunctionType.createInstantiable('', '', FunctionTypeFlags.None);
        functionType.details.declaredReturnType = AnyType.create();

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    if (isEllipsisType(entry.type)) {
                        addError(Localizer.Diagnostic.ellipsisContext(), entry.node);
                    } else if (isModule(entry.type)) {
                        addError(Localizer.Diagnostic.moduleContext(), entry.node);
                    } else if (isParamSpecType(entry.type)) {
                        addError(Localizer.Diagnostic.paramSpecContext(), entry.node);
                    }

                    FunctionType.addParameter(functionType, {
                        category: ParameterCategory.Simple,
                        name: `p${index.toString()}`,
                        isNameSynthesized: true,
                        type: convertToInstance(entry.type),
                        hasDeclaredType: true,
                    });
                });
            } else if (isEllipsisType(typeArgs[0].type)) {
                FunctionType.addDefaultParameters(functionType);
                functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
            } else if (isParamSpecType(typeArgs[0].type)) {
                functionType.details.paramSpec = typeArgs[0].type as TypeVarType;
            } else {
                if (isClass(typeArgs[0].type) && ClassType.isBuiltIn(typeArgs[0].type, 'Concatenate')) {
                    const concatTypeArgs = typeArgs[0].type.typeArguments;
                    if (concatTypeArgs && concatTypeArgs.length > 0) {
                        concatTypeArgs.forEach((typeArg, index) => {
                            if (index === concatTypeArgs.length - 1) {
                                if (isParamSpecType(typeArg)) {
                                    functionType.details.paramSpec = typeArg as TypeVarType;
                                }
                            } else {
                                FunctionType.addParameter(functionType, {
                                    category: ParameterCategory.Simple,
                                    name: `__p${index}`,
                                    isNameSynthesized: true,
                                    hasDeclaredType: true,
                                    type: typeArg,
                                });
                            }
                        });
                    }
                } else {
                    addError(Localizer.Diagnostic.callableFirstArg(), typeArgs[0].node);
                }
            }
        } else {
            FunctionType.addDefaultParameters(functionType, /* useUnknown */ true);
            functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
        }

        if (typeArgs && typeArgs.length > 1) {
            if (isEllipsisType(typeArgs[1].type)) {
                addError(Localizer.Diagnostic.ellipsisContext(), typeArgs[1].node);
            } else if (isModule(typeArgs[1].type)) {
                addError(Localizer.Diagnostic.moduleContext(), typeArgs[1].node);
            } else if (isParamSpecType(typeArgs[1].type)) {
                addError(Localizer.Diagnostic.paramSpecContext(), typeArgs[1].node);
            }
            functionType.details.declaredReturnType = convertToInstance(typeArgs[1].type);
        } else {
            functionType.details.declaredReturnType = UnknownType.create();
        }

        if (typeArgs && typeArgs.length > 2) {
            addError(Localizer.Diagnostic.callableExtraArgs(), typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional[X, Y, Z] type.
    function createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(Localizer.Diagnostic.optionalExtraArgs(), errorNode);
            return UnknownType.create();
        }

        if (isEllipsisType(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.ellipsisContext(), typeArgs[0].node);
        } else if (isModule(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.moduleContext(), typeArgs[0].node);
        } else if (isParamSpecType(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.paramSpecContext(), typeArgs[0].node);
        } else if (!TypeBase.isInstantiable(typeArgs[0].type)) {
            addExpectedClassDiagnostic(typeArgs[0].type, typeArgs[0].node);
        }

        return combineTypes([typeArgs[0].type, NoneType.createType()]);
    }

    function cloneBuiltinObjectWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        const type = getBuiltInObject(node, builtInName);
        if (isObject(type)) {
            return ObjectType.create(ClassType.cloneWithLiteral(type.classType, value));
        }

        return UnknownType.create();
    }

    function cloneBuiltinClassWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        const type = getBuiltInObject(node, builtInName);
        if (isObject(type)) {
            return ClassType.cloneWithLiteral(type.classType, value);
        }

        return UnknownType.create();
    }

    // Creates a type that represents a Literal. This is not an officially-supported
    // feature of Python but is instead a mypy extension described here:
    // https://mypy.readthedocs.io/en/latest/literal_types.html
    function createLiteralType(node: IndexNode): Type {
        if (node.items.items.length === 0) {
            addError(Localizer.Diagnostic.literalEmptyArgs(), node.baseExpression);
            return UnknownType.create();
        }

        // As per the specification, we support None, int, bool, str, bytes literals
        // plus enum values.
        const literalTypes: Type[] = [];

        for (const item of node.items.items) {
            let type: Type | undefined;

            if (item.nodeType === ParseNodeType.StringList) {
                const isBytes = (item.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                const value = item.strings.map((s) => s.value).join('');
                if (isBytes) {
                    type = cloneBuiltinClassWithLiteral(node, 'bytes', value);
                } else {
                    type = cloneBuiltinClassWithLiteral(node, 'str', value);
                }
            } else if (item.nodeType === ParseNodeType.Number) {
                if (!item.isImaginary && item.isInteger) {
                    type = cloneBuiltinClassWithLiteral(node, 'int', item.value);
                }
            } else if (item.nodeType === ParseNodeType.Constant) {
                if (item.constType === KeywordType.True) {
                    type = cloneBuiltinClassWithLiteral(node, 'bool', true);
                } else if (item.constType === KeywordType.False) {
                    type = cloneBuiltinClassWithLiteral(node, 'bool', false);
                } else if (item.constType === KeywordType.None) {
                    type = NoneType.createType();
                }
            } else if (item.nodeType === ParseNodeType.UnaryOperation && item.operator === OperatorType.Subtract) {
                if (item.expression.nodeType === ParseNodeType.Number) {
                    if (!item.expression.isImaginary && item.expression.isInteger) {
                        type = cloneBuiltinClassWithLiteral(node, 'int', -item.expression.value);
                    }
                }
            }

            if (!type) {
                const exprType = getTypeOfExpression(item);

                // Is this an enum type?
                if (
                    isObject(exprType.type) &&
                    ClassType.isEnumClass(exprType.type.classType) &&
                    exprType.type.classType.literalValue !== undefined
                ) {
                    type = exprType.type.classType;
                } else {
                    // Is this a type alias to an existing literal type?
                    let isLiteralType = true;

                    doForSubtypes(exprType.type, (subtype) => {
                        if (!isClass(subtype) || subtype.literalValue === undefined) {
                            isLiteralType = false;
                        }
                        return undefined;
                    });

                    if (isLiteralType) {
                        type = exprType.type;
                    }
                }
            }

            if (!type) {
                addError(Localizer.Diagnostic.literalUnsupportedType(), item);
                type = UnknownType.create();
            }

            literalTypes.push(type);
        }

        return combineTypes(literalTypes);
    }

    // Creates a ClassVar type.
    function createClassVarType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            addError(Localizer.Diagnostic.classVarFirstArgMissing(), errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            addError(Localizer.Diagnostic.classVarTooManyArgs(), typeArgs[1].node);
            return UnknownType.create();
        }

        let type = typeArgs[0].type;

        if (requiresSpecialization(type)) {
            // A ClassVar should not allow generic types, but the typeshed
            // stubs use this in a few cases. For now, just specialize
            // it in a general way.
            type = specializeType(type, /* typeVarMap */ undefined);
        }

        return type;
    }

    // Creates a "Final" type.
    function createFinalType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined, flags: EvaluatorFlags): Type {
        if (flags & EvaluatorFlags.FinalDisallowed) {
            addError(Localizer.Diagnostic.finalContext(), errorNode);
            return AnyType.create();
        }

        if (!typeArgs || typeArgs.length === 0) {
            return AnyType.create();
        }

        if (typeArgs.length > 1) {
            addError(Localizer.Diagnostic.finalTooManyArgs(), errorNode);
        }

        return typeArgs[0].type;
    }

    function createConcatenateType(
        errorNode: ParseNode,
        classType: ClassType,
        typeArgs: TypeResult[] | undefined
    ): Type {
        if (!typeArgs || typeArgs.length === 0) {
            addError(Localizer.Diagnostic.concatenateTypeArgsMissing(), errorNode);
        } else {
            typeArgs.forEach((typeArg, index) => {
                if (index === typeArgs.length - 1) {
                    if (!isParamSpecType(typeArg.type)) {
                        addError(Localizer.Diagnostic.concatenateParamSpecMissing(), typeArg.node);
                    }
                } else {
                    if (isParamSpecType(typeArg.type)) {
                        addError(Localizer.Diagnostic.paramSpecContext(), typeArg.node);
                    }
                }
            });
        }

        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
    }

    function createAnnotatedType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length < 1) {
            addError(Localizer.Diagnostic.annotatedTypeArgMissing(), errorNode);
            return AnyType.create();
        }

        if (isEllipsisType(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.ellipsisContext(), typeArgs[0].node);
        } else if (isModule(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.moduleContext(), typeArgs[0].node);
        } else if (isParamSpecType(typeArgs[0].type)) {
            addError(Localizer.Diagnostic.paramSpecContext(), typeArgs[1].node);
        }

        return typeArgs[0].type;
    }

    // Creates one of several "special" types that are defined in typing.pyi
    // but not declared in their entirety. This includes the likes of "Tuple",
    // "Dict", etc.
    function createSpecialType(
        classType: ClassType,
        typeArgs: TypeResult[] | undefined,
        paramLimit?: number,
        allowParamSpec = false
    ): Type {
        const isTuple = ClassType.isBuiltIn(classType, 'Tuple');

        if (typeArgs) {
            // Verify that we didn't receive any inappropriate ellipses or modules.
            typeArgs.forEach((typeArg, index) => {
                if (isEllipsisType(typeArg.type)) {
                    if (!isTuple) {
                        addError(Localizer.Diagnostic.ellipsisContext(), typeArg.node);
                    } else if (typeArgs!.length !== 2 || index !== 1) {
                        addError(Localizer.Diagnostic.ellipsisSecondArg(), typeArg.node);
                    }
                } else if (isModule(typeArg.type)) {
                    addError(Localizer.Diagnostic.moduleContext(), typeArg.node);
                } else if (!allowParamSpec && isParamSpecType(typeArg.type)) {
                    addError(Localizer.Diagnostic.paramSpecContext(), typeArg.node);
                }
            });

            // Handle Tuple[()] as a special case, as defined in PEP 483.
            if (ClassType.isBuiltIn(classType, 'Tuple')) {
                if (
                    typeArgs.length === 1 &&
                    isObject(typeArgs[0].type) &&
                    ClassType.isBuiltIn(typeArgs[0].type.classType, 'Tuple') &&
                    typeArgs[0].type.classType.typeArguments &&
                    typeArgs[0].type.classType.typeArguments.length === 0
                ) {
                    typeArgs = [];
                }
            }
        }

        let typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                addError(
                    Localizer.Diagnostic.typeArgsTooMany().format({
                        expected: paramLimit,
                        received: typeArgTypes.length,
                    }),
                    typeArgs[paramLimit].node
                );
                typeArgTypes = typeArgTypes.slice(0, paramLimit);
            } else if (typeArgTypes.length < paramLimit) {
                // Fill up the remainder of the slots with unknown types.
                while (typeArgTypes.length < paramLimit) {
                    typeArgTypes.push(UnknownType.create());
                }
            }
        }

        // Handle tuple as a special case.
        if (isTuple) {
            // If no type args are provided and it's a tuple, default to [Any, ...].
            if (!typeArgs) {
                typeArgTypes.push(AnyType.create(false));
                typeArgTypes.push(AnyType.create(true));
            }

            return cloneTupleForSpecialization(classType, typeArgTypes, typeArgs !== undefined);
        }

        return ClassType.cloneForSpecialization(classType, typeArgTypes, typeArgs !== undefined);
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    function createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                types.push(typeArg.type);

                // Verify that we didn't receive any inappropriate ellipses.
                if (isEllipsisType(typeArg.type)) {
                    addError(Localizer.Diagnostic.ellipsisContext(), typeArg.node);
                } else if (isModule(typeArg.type)) {
                    addError(Localizer.Diagnostic.moduleContext(), typeArg.node);
                } else if (isParamSpecType(typeArg.type)) {
                    addError(Localizer.Diagnostic.paramSpecContext(), typeArg.node);
                } else if (!TypeBase.isInstantiable(typeArg.type)) {
                    addExpectedClassDiagnostic(typeArg.type, typeArg.node);
                }
            }
        }

        if (types.length > 0) {
            return combineTypes(types);
        }

        return NeverType.create();
    }

    // Creates a type that represents "Generic[T1, T2, ...]", used in the
    // definition of a generic class.
    function createGenericType(errorNode: ParseNode, classType: ClassType, typeArgs?: TypeResult[]): Type {
        // Make sure there's at least one type arg.
        if (!typeArgs || typeArgs.length === 0) {
            addError(Localizer.Diagnostic.genericTypeArgMissing(), errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            typeArgs.forEach((typeArg) => {
                if (!isTypeVar(typeArg.type)) {
                    addError(Localizer.Diagnostic.genericTypeArgTypeVar(), typeArg.node);
                } else {
                    for (const typeVar of uniqueTypeVars) {
                        if (typeVar === typeArg.type) {
                            addError(Localizer.Diagnostic.genericTypeArgUnique(), typeArg.node);
                            break;
                        }
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
    }

    function transformTypeForPossibleEnumClass(node: NameNode, typeOfExpr: Type): Type {
        // If the node is within a class that derives from the metaclass
        // "EnumMeta", we need to treat assignments differently.
        const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        if (enclosingClassNode) {
            const enumClassInfo = getTypeOfClass(enclosingClassNode);

            if (enumClassInfo && ClassType.isEnumClass(enumClassInfo.classType)) {
                if (ClassType.isBuiltIn(enumClassInfo.classType)) {
                    // Handle several built-in classes specially. We don't
                    // want to interpret their class variables as enumerations.
                    const className = enumClassInfo.classType.details.name;
                    const builtInEnumClasses = ['Enum', 'IntEnum', 'Flag', 'IntFlag'];
                    if (builtInEnumClasses.find((c) => c === className)) {
                        return typeOfExpr;
                    }
                }

                return ObjectType.create(
                    ClassType.cloneWithLiteral(
                        enumClassInfo.classType,
                        new EnumLiteral(enumClassInfo.classType.details.name, node.value)
                    )
                );
            }
        }

        return typeOfExpr;
    }

    function transformTypeForTypeAlias(type: Type, name: NameNode): Type {
        if (!TypeBase.isInstantiable(type)) {
            return type;
        }

        // If this is a recursive type alias that hasn't yet been fully resolved
        // (i.e. there is no boundType associated with it), don't apply the transform.
        if (isTypeVar(type) && type.details.recursiveTypeAliasName && !type.details.boundType) {
            return type;
        }

        // Determine if there are any generic type parameters associated
        // with this type alias.
        let typeParameters: TypeVarType[] = [];

        // Skip this for a simple TypeVar (one that's not part of a union).
        if (!isTypeVar(type)) {
            doForSubtypes(type, (subtype) => {
                addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(subtype));
                return undefined;
            });
        }

        // Don't include any synthesized type variables.
        typeParameters = typeParameters.filter((typeVar) => !typeVar.details.isSynthesized);

        return TypeBase.cloneForTypeAlias(type, name.value, typeParameters.length > 0 ? typeParameters : undefined);
    }

    function createSpecialBuiltInClass(node: ParseNode, assignedName: string, aliasMapEntry: AliasMapEntry): ClassType {
        const fileInfo = getFileInfo(node);
        const specialClassType = ClassType.create(
            assignedName,
            getClassFullName(node, fileInfo.moduleName, assignedName),
            fileInfo.moduleName,
            ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
            node.id,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined
        );

        if (fileInfo.isTypingExtensionsStubFile) {
            specialClassType.details.flags |= ClassTypeFlags.TypingExtensionClass;
        }

        const baseClassName = aliasMapEntry.alias ? aliasMapEntry.alias : 'object';

        let aliasClass: Type | undefined;
        if (aliasMapEntry.module === 'builtins') {
            aliasClass = getBuiltInType(node, baseClassName);
        } else if (aliasMapEntry.module === 'collections') {
            // The typing.pyi file imports collections.
            if (fileInfo.collectionsModulePath) {
                const lookupResult = importLookup(fileInfo.collectionsModulePath);
                if (lookupResult) {
                    const symbol = lookupResult.symbolTable.get(baseClassName);
                    if (symbol) {
                        aliasClass = getEffectiveTypeOfSymbol(symbol);
                    }
                }
            }
        } else if (aliasMapEntry.module === 'self') {
            const symbolWithScope = lookUpSymbolRecursive(node, baseClassName, /* honorCodeFlow */ false);
            if (symbolWithScope) {
                aliasClass = getEffectiveTypeOfSymbol(symbolWithScope.symbol);
            }
        }

        if (aliasClass && isClass(aliasClass)) {
            specialClassType.details.baseClasses.push(aliasClass);

            if (aliasMapEntry.alias) {
                specialClassType.details.aliasClass = aliasClass;
            }
            specialClassType.details.effectiveMetaclass = aliasClass.details.effectiveMetaclass;
        } else {
            specialClassType.details.baseClasses.push(UnknownType.create());
            specialClassType.details.effectiveMetaclass = UnknownType.create();
        }

        computeMroLinearization(specialClassType);

        return specialClassType;
    }

    // Handles some special-case type annotations that are found
    // within the typings.pyi file.
    function handleTypingStubTypeAnnotation(node: ExpressionNode): ClassType | undefined {
        if (!node.parent || node.parent.nodeType !== ParseNodeType.TypeAnnotation) {
            return undefined;
        }

        if (node.parent.valueExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.parent.valueExpression;
        const assignedName = nameNode.value;

        const specialTypes: { [name: string]: AliasMapEntry } = {
            Tuple: { alias: 'tuple', module: 'builtins' },
            Generic: { alias: '', module: 'builtins' },
            Protocol: { alias: '', module: 'builtins' },
            Callable: { alias: '', module: 'builtins' },
            Type: { alias: 'type', module: 'builtins' },
            ClassVar: { alias: '', module: 'builtins' },
            Final: { alias: '', module: 'builtins' },
            Literal: { alias: '', module: 'builtins' },
            TypedDict: { alias: '_TypedDict', module: 'self' },
            Union: { alias: '', module: 'builtins' },
            Optional: { alias: '', module: 'builtins' },
            Annotated: { alias: '', module: 'builtins' },
            TypeAlias: { alias: '', module: 'builtins' },
            Concatenate: { alias: '', module: 'builtins' },
        };

        const aliasMapEntry = specialTypes[assignedName];
        if (aliasMapEntry) {
            return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
        }

        return undefined;
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    function handleTypingStubAssignment(node: AssignmentNode): Type | undefined {
        if (node.leftExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.leftExpression;
        const assignedName = nameNode.value;

        if (assignedName === 'Any') {
            return AnyType.create();
        }

        const specialTypes: { [name: string]: AliasMapEntry } = {
            overload: { alias: '', module: 'builtins' },
            TypeVar: { alias: '', module: 'builtins' },
            _promote: { alias: '', module: 'builtins' },
            no_type_check: { alias: '', module: 'builtins' },
            NoReturn: { alias: '', module: 'builtins' },
            Counter: { alias: 'Counter', module: 'collections' },
            List: { alias: 'list', module: 'builtins' },
            Dict: { alias: 'dict', module: 'builtins' },
            DefaultDict: { alias: 'defaultdict', module: 'collections' },
            Set: { alias: 'set', module: 'builtins' },
            FrozenSet: { alias: 'frozenset', module: 'builtins' },
            Deque: { alias: 'deque', module: 'collections' },
            ChainMap: { alias: 'ChainMap', module: 'collections' },
            OrderedDict: { alias: 'OrderedDict', module: 'collections' },
        };

        const aliasMapEntry = specialTypes[assignedName];
        if (aliasMapEntry) {
            return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
        }

        return undefined;
    }

    function evaluateTypesForAssignmentStatement(node: AssignmentNode): void {
        const fileInfo = getFileInfo(node);

        // If the entire statement has already been evaluated, don't
        // re-evaluate it.
        if (readTypeCache(node)) {
            return;
        }

        // Is this type already cached?
        let rightHandType = readTypeCache(node.rightExpression);
        let isResolutionCycle = false;
        let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;

        if (!rightHandType) {
            // Special-case the typing.pyi file, which contains some special
            // types that the type analyzer needs to interpret differently.
            if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
                rightHandType = handleTypingStubAssignment(node);
                if (rightHandType) {
                    writeTypeCache(node.rightExpression, rightHandType);
                }
            }

            if (!rightHandType) {
                // Determine whether there is a declared type.
                const declaredType = getDeclaredTypeForExpression(node.leftExpression);

                let flags: EvaluatorFlags = EvaluatorFlags.DoNotSpecialize;
                if (fileInfo.isStubFile) {
                    // An assignment of ellipsis means "Any" within a type stub file.
                    flags |= EvaluatorFlags.ConvertEllipsisToUnknown;
                }

                let typeAliasNameNode: NameNode | undefined;
                if (isDeclaredTypeAlias(node.leftExpression)) {
                    flags |=
                        EvaluatorFlags.ExpectingType |
                        EvaluatorFlags.EvaluateStringLiteralAsType |
                        EvaluatorFlags.ParamSpecDisallowed;

                    typeAliasNameNode = (node.leftExpression as TypeAnnotationNode).valueExpression as NameNode;
                } else if (isPossibleImplicitTypeAlias(node.leftExpression)) {
                    if (node.leftExpression.nodeType === ParseNodeType.Name) {
                        typeAliasNameNode = node.leftExpression;
                    }
                }

                // Synthesize a type variable that represents the type alias while we're
                // evaluating it. This allows us to handle recursive definitions.
                let typeAliasTypeVar: TypeVarType | undefined;
                if (typeAliasNameNode) {
                    typeAliasTypeVar = TypeVarType.createInstantiable(
                        `__type_alias_${typeAliasNameNode.value}`,
                        /* isParamSpec */ false,
                        /* isSynthesized */ true
                    );
                    typeAliasTypeVar.details.recursiveTypeAliasName = typeAliasNameNode.value;

                    // Write the type back to the type cache. It will be replaced below.
                    writeTypeCache(node, typeAliasTypeVar);
                    writeTypeCache(node.leftExpression, typeAliasTypeVar);
                }

                const srcTypeResult = getTypeOfExpression(node.rightExpression, declaredType, flags);
                let srcType = srcTypeResult.type;
                expectedTypeDiagAddendum = srcTypeResult.expectedTypeDiagAddendum;
                if (srcTypeResult.isResolutionCyclical) {
                    isResolutionCycle = true;
                }

                // If the RHS is a constant boolean expression, assign it a literal type.
                const constExprValue = evaluateStaticBoolExpression(
                    node.rightExpression,
                    fileInfo.executionEnvironment
                );

                if (constExprValue !== undefined) {
                    const boolType = getBuiltInObject(node, 'bool');
                    if (isObject(boolType)) {
                        srcType = ObjectType.create(ClassType.cloneWithLiteral(boolType.classType, constExprValue));
                    }
                }

                // If there was a declared type, make sure the RHS value is compatible.
                if (declaredType) {
                    const diagAddendum = new DiagnosticAddendum();
                    const typeVarMap = new TypeVarMap();
                    if (canAssignType(declaredType, srcType, diagAddendum, typeVarMap)) {
                        // Constrain the resulting type to match the declared type.
                        srcType = narrowDeclaredTypeBasedOnAssignedType(declaredType, srcType);
                    }
                }

                // If this is an enum, transform the type as required.
                rightHandType = srcType;
                if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
                    rightHandType = transformTypeForPossibleEnumClass(node.leftExpression, rightHandType);
                }

                if (typeAliasNameNode) {
                    // If this is a type alias, record its name based on the assignment target.
                    rightHandType = transformTypeForTypeAlias(rightHandType, typeAliasNameNode);

                    if (isTypeAliasRecursive(typeAliasTypeVar!, rightHandType)) {
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typeAliasIsRecursive().format({ name: typeAliasNameNode.value }),
                            node.rightExpression
                        );
                    }

                    // Set the resulting type to the boundType of the original type alias
                    // to support recursive type aliases.
                    typeAliasTypeVar!.details.boundType = rightHandType;
                }
            }
        }

        // Don't write back an unbound type that results from a resolution cycle. We'll
        // write back the type when the stack unwinds and the type is fully evaluated.
        if (!isResolutionCycle) {
            assignTypeToExpression(node.leftExpression, rightHandType, node.rightExpression, expectedTypeDiagAddendum);

            writeTypeCache(node, rightHandType);
        }
    }

    function evaluateTypesForAugmentedAssignment(node: AugmentedAssignmentNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const destType = getTypeFromAugmentedAssignment(node, /* expectedType */ undefined);
        assignTypeToExpression(node.destExpression, destType, node.rightExpression);

        writeTypeCache(node, destType);
    }

    function getTypeOfClass(node: ClassNode): ClassTypeResult | undefined {
        // Is this type already cached?
        let classType = readTypeCache(node.name) as ClassType;
        let decoratedType = readTypeCache(node);

        if (classType) {
            return { classType, decoratedType: decoratedType || UnknownType.create() };
        }

        // The type wasn't cached, so we need to create a new one.
        const scope = ScopeUtils.getScopeForNode(node);

        const fileInfo = getFileInfo(node);
        let classFlags = ClassTypeFlags.None;
        if (
            scope?.type === ScopeType.Builtin ||
            fileInfo.isTypingStubFile ||
            fileInfo.isTypingExtensionsStubFile ||
            fileInfo.isBuiltInStubFile
        ) {
            classFlags |= ClassTypeFlags.BuiltInClass;

            if (fileInfo.isTypingExtensionsStubFile) {
                classFlags |= ClassTypeFlags.TypingExtensionClass;
            }

            if (node.name.value === 'property') {
                classFlags |= ClassTypeFlags.PropertyClass;
            }
        }

        classType = ClassType.create(
            node.name.value,
            getClassFullName(node, fileInfo.moduleName, node.name.value),
            fileInfo.moduleName,
            classFlags,
            node.id,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined,
            ParseTreeUtils.getDocString(node.suite.statements)
        );

        // Some classes refer to themselves within type arguments used within
        // base classes. We'll register the partially-constructed class type
        // to allow these to be resolved.
        const classSymbol = scope?.lookUpSymbol(node.name.value);
        let classDecl: ClassDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
            classDecl = decl as ClassDeclaration;
        }
        if (classDecl) {
            setSymbolResolutionPartialType(classSymbol!, classDecl, classType);
        }
        classType.details.flags |= ClassTypeFlags.PartiallyConstructed;
        writeTypeCache(node, classType);
        writeTypeCache(node.name, classType);

        // Keep a list of unique type parameters that are used in the
        // base class arguments.
        const typeParameters: TypeVarType[] = [];

        // If the class derives from "Generic" directly, it will provide
        // all of the type parameters in the specified order.
        let genericTypeParameters: TypeVarType[] | undefined;

        let sawMetaclass = false;
        let nonMetaclassBaseClassCount = 0;
        node.arguments.forEach((arg) => {
            // Ignore keyword parameters other than metaclass or total.
            if (!arg.name || arg.name.value === 'metaclass') {
                let exprFlags =
                    EvaluatorFlags.ExpectingType |
                    EvaluatorFlags.GenericClassTypeAllowed |
                    EvaluatorFlags.DisallowTypeVarsWithScopeId |
                    EvaluatorFlags.AssociateTypeVarsWithCurrentScope;
                if (fileInfo.isStubFile) {
                    exprFlags |= EvaluatorFlags.AllowForwardReferences;
                }

                let argType = getTypeOfExpression(arg.valueExpression, undefined, exprFlags).type;
                const isMetaclass = !!arg.name;

                if (isMetaclass) {
                    if (sawMetaclass) {
                        addError(Localizer.Diagnostic.metaclassDuplicate(), arg);
                    }
                    sawMetaclass = true;
                }

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType.category === TypeCategory.Union) {
                    argType = removeUnboundFromUnion(argType);
                }

                if (!isAnyOrUnknown(argType) && !isUnbound(argType)) {
                    // Handle "Type[X]" object.
                    argType = transformTypeObjectToClass(argType);
                    if (!isClass(argType)) {
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.baseClassInvalid(),
                            arg
                        );
                        argType = UnknownType.create();
                    } else {
                        if (ClassType.isBuiltIn(argType, 'Protocol')) {
                            if (
                                !fileInfo.isStubFile &&
                                !ClassType.isTypingExtensionClass(argType) &&
                                fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_7
                            ) {
                                addError(Localizer.Diagnostic.protocolIllegal(), arg.valueExpression);
                            }
                            classType.details.flags |= ClassTypeFlags.ProtocolClass;
                        }

                        if (ClassType.isBuiltIn(argType, 'property')) {
                            classType.details.flags |= ClassTypeFlags.PropertyClass;
                        }

                        // If the class directly derives from NamedTuple (in Python 3.6 or
                        // newer), it's considered a dataclass.
                        if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_6) {
                            if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                                classType.details.flags |= ClassTypeFlags.DataClass;
                            }
                        }

                        // If the class directly derives from TypedDict or from a class that is
                        // a TypedDict, it is considered a TypedDict.
                        if (ClassType.isBuiltIn(argType, 'TypedDict') || ClassType.isTypedDictClass(argType)) {
                            classType.details.flags |= ClassTypeFlags.TypedDictClass;
                        } else if (ClassType.isTypedDictClass(classType) && !ClassType.isTypedDictClass(argType)) {
                            // TypedDict classes must derive only from other
                            // TypedDict classes.
                            addError(Localizer.Diagnostic.typedDictBaseClass(), arg);
                        }

                        // Validate that the class isn't deriving from itself, creating a
                        // circular dependency.
                        if (derivesFromClassRecursive(argType, classType, /* ignoreUnknown */ true)) {
                            addError(Localizer.Diagnostic.baseClassCircular(), arg);
                            argType = UnknownType.create();
                        }
                    }
                }

                if (isUnknown(argType)) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUntypedBaseClass,
                        DiagnosticRule.reportUntypedBaseClass,
                        Localizer.Diagnostic.baseClassUnknown(),
                        arg
                    );
                }

                if (isMetaclass) {
                    if (isClass(argType) || isUnknown(argType)) {
                        classType.details.declaredMetaclass = argType;
                        if (isClass(argType)) {
                            if (ClassType.isBuiltIn(argType, 'EnumMeta')) {
                                classType.details.flags |= ClassTypeFlags.EnumClass;
                            } else if (ClassType.isBuiltIn(argType, 'ABCMeta')) {
                                classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
                            }
                        }
                    }
                } else {
                    classType.details.baseClasses.push(argType);
                    if (isClass(argType)) {
                        if (ClassType.isEnumClass(argType)) {
                            classType.details.flags |= ClassTypeFlags.EnumClass;
                        }

                        if (ClassType.supportsAbstractMethods(argType)) {
                            classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
                        }

                        if (ClassType.isPropertyClass(argType)) {
                            classType.details.flags |= ClassTypeFlags.PropertyClass;
                        }

                        if (ClassType.isFinal(argType)) {
                            const className = printObjectTypeForClass(argType);
                            addError(
                                Localizer.Diagnostic.baseClassFinal().format({ type: className }),
                                arg.valueExpression
                            );
                        }
                    }
                }

                addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(argType));
                if (isClass(argType) && ClassType.isBuiltIn(argType, 'Generic')) {
                    if (genericTypeParameters) {
                        addError(Localizer.Diagnostic.baseClassDoubleGeneric(), arg.valueExpression);
                    } else {
                        genericTypeParameters = [];
                        addTypeVarsToListIfUnique(genericTypeParameters, getTypeVarArgumentsRecursive(argType));
                    }
                }

                if (!isMetaclass) {
                    nonMetaclassBaseClassCount++;
                }
            } else if (arg.name.value === 'total') {
                // The "total" parameter name applies only for TypedDict classes.
                if (ClassType.isTypedDictClass(classType)) {
                    // PEP 589 specifies that the parameter must be either True or False.
                    const constArgValue = evaluateStaticBoolExpression(
                        arg.valueExpression,
                        fileInfo.executionEnvironment
                    );
                    if (constArgValue === undefined) {
                        addError(Localizer.Diagnostic.typedDictTotalParam(), arg.valueExpression);
                    } else if (!constArgValue) {
                        classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
                    }
                }
            }
        });

        if (nonMetaclassBaseClassCount === 0) {
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (!ClassType.isBuiltIn(classType, 'object')) {
                classType.details.baseClasses.push(getBuiltInType(node, 'object'));
            }
        }

        // TODO - if genericTypeParameters are provided, make sure that
        // typeParameters is a proper subset.
        classType.details.typeParameters = genericTypeParameters || typeParameters;

        if (!computeMroLinearization(classType)) {
            addError(Localizer.Diagnostic.methodOrdering(), node.name);
        }

        // Determine the effective metaclass and detect metaclass conflicts.
        let effectiveMetaclass = classType.details.declaredMetaclass;
        let reportedMetaclassConflict = false;

        if (!effectiveMetaclass || isClass(effectiveMetaclass)) {
            for (const baseClass of classType.details.baseClasses) {
                if (isClass(baseClass)) {
                    const baseClassMeta = baseClass.details.effectiveMetaclass;
                    if (baseClassMeta && isClass(baseClassMeta)) {
                        // Make sure there is no metaclass conflict.
                        if (!effectiveMetaclass) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            derivesFromClassRecursive(baseClassMeta, effectiveMetaclass, /* ignoreUnknown */ true)
                        ) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            !derivesFromClassRecursive(effectiveMetaclass, baseClassMeta, /* ignoreUnknown */ true)
                        ) {
                            if (!reportedMetaclassConflict) {
                                addDiagnostic(
                                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    Localizer.Diagnostic.metaclassConflict(),
                                    node.name
                                );
                                // Don't report more than once.
                                reportedMetaclassConflict = true;
                            }
                        }
                    } else {
                        effectiveMetaclass = UnknownType.create();
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
            const typeMetaclass = getBuiltInType(node, 'type');
            effectiveMetaclass = typeMetaclass && isClass(typeMetaclass) ? typeMetaclass : UnknownType.create();
        }

        classType.details.effectiveMetaclass = effectiveMetaclass;

        // The scope for this class becomes the "fields" for the corresponding type.
        const innerScope = ScopeUtils.getScopeForNode(node.suite);
        classType.details.fields = innerScope?.symbolTable || new Map<string, Symbol>();

        if (ClassType.isTypedDictClass(classType)) {
            synthesizeTypedDictClassMethods(node, classType);
        }

        // Determine if the class should be a "pseudo-generic" class, characterized
        // by having an __init__ method with parameters that lack type annotations.
        // For such classes, we'll treat them as generic, with the type arguments provided
        // by the callers of the constructor.
        if (!fileInfo.isStubFile && classType.details.typeParameters.length === 0) {
            const initMethod = classType.details.fields.get('__init__');
            if (initMethod) {
                const initDecls = initMethod.getTypedDeclarations();
                if (initDecls.length === 1 && initDecls[0].type === DeclarationType.Function) {
                    const initDeclNode = initDecls[0].node;
                    const initParams = initDeclNode.parameters;

                    if (
                        initParams.length > 1 &&
                        !initParams.some((param, index) => !!getTypeAnnotationForParameter(initDeclNode, index))
                    ) {
                        const genericParams = initParams.filter(
                            (param, index) => index > 0 && param.name && param.category === ParameterCategory.Simple
                        );

                        if (genericParams.length > 0) {
                            classType.details.flags |= ClassTypeFlags.PseudoGenericClass;

                            // Create a type parameter for each simple, named parameter
                            // in the __init__ method.
                            classType.details.typeParameters = genericParams.map((param) => {
                                const typeVar = TypeVarType.createInstance(
                                    `__type_of_${param.name!.value}`,
                                    /* isParamSpec */ false,
                                    /* isSynthesized */ true
                                );
                                return TypeVarType.cloneForScopeId(typeVar, node.id);
                            });
                        }
                    }
                }
            }
        }

        // Determine if the class is abstract.
        if (ClassType.supportsAbstractMethods(classType)) {
            if (getAbstractMethods(classType).length > 0) {
                classType.details.flags |= ClassTypeFlags.HasAbstractMethods;
            }
        }

        // Now determine the decorated type of the class.
        decoratedType = classType;
        let foundUnknown = false;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyClassDecorator(decoratedType, classType, decorator);
            if (isUnknown(newDecoratedType)) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        Localizer.Diagnostic.classDecoratorTypeUnknown(),
                        node.decorators[i].leftExpression
                    );

                    foundUnknown = true;
                }
            } else {
                // Apply the decorator only if the type is known.
                decoratedType = newDecoratedType;
            }
        }

        if (ClassType.isDataClass(classType)) {
            let skipSynthesizedInit = ClassType.isSkipSynthesizedInit(classType);
            if (!skipSynthesizedInit) {
                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                const initSymbol = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipBaseClasses);
                if (initSymbol) {
                    const initSymbolType = getTypeOfMember(initSymbol);
                    if (initSymbolType.category === TypeCategory.Function) {
                        if (!FunctionType.isSynthesizedMethod(initSymbolType)) {
                            skipSynthesizedInit = true;
                        }
                    } else {
                        skipSynthesizedInit = true;
                    }
                }
            }

            synthesizeDataClassMethods(node, classType, skipSynthesizedInit);
        }

        // Clear the "partially constructed" flag.
        classType.details.flags &= ~ClassTypeFlags.PartiallyConstructed;

        // Update the undecorated class type.
        writeTypeCache(node.name, classType);

        // Update the decorated class type.
        writeTypeCache(node, decoratedType);

        return { classType, decoratedType };
    }

    function applyClassDecorator(
        inputClassType: Type,
        originalClassType: ClassType,
        decoratorNode: DecoratorNode
    ): Type {
        const decoratorType = getTypeOfExpression(decoratorNode.leftExpression).type;

        // Is this a @dataclass?
        if (decoratorType.category === TypeCategory.OverloadedFunction) {
            const overloads = decoratorType.overloads;
            if (overloads.length > 0 && overloads[0].details.builtInName === 'dataclass') {
                // Determine whether we should skip synthesizing the init method.
                let skipSynthesizeInit = false;

                if (decoratorNode.arguments) {
                    decoratorNode.arguments.forEach((arg) => {
                        if (arg.name && arg.name.value === 'init') {
                            if (arg.valueExpression) {
                                const fileInfo = getFileInfo(decoratorNode);
                                const value = evaluateStaticBoolExpression(
                                    arg.valueExpression,
                                    fileInfo.executionEnvironment
                                );
                                if (!value) {
                                    skipSynthesizeInit = true;
                                }
                            }
                        }
                    });
                }

                originalClassType.details.flags |= ClassTypeFlags.DataClass;
                if (skipSynthesizeInit) {
                    originalClassType.details.flags |= ClassTypeFlags.SkipSynthesizedInit;
                }
                return inputClassType;
            }
        } else if (decoratorType.category === TypeCategory.Function) {
            if (decoratorType.details.builtInName === 'final') {
                originalClassType.details.flags |= ClassTypeFlags.Final;
            } else if (decoratorType.details.builtInName === 'runtime_checkable') {
                originalClassType.details.flags |= ClassTypeFlags.RuntimeCheckable;
            }
        }

        return getTypeFromDecorator(decoratorNode, inputClassType);
    }

    function getTypeOfFunction(node: FunctionNode): FunctionTypeResult | undefined {
        const fileInfo = getFileInfo(node);

        // Is this type already cached?
        let functionType = readTypeCache(node.name) as FunctionType;
        let decoratedType = readTypeCache(node);

        if (functionType) {
            return { functionType, decoratedType: decoratedType || UnknownType.create() };
        }

        let functionDecl: FunctionDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
            functionDecl = decl as FunctionDeclaration;
        }

        // There was no cached type, so create a new one.
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        let containingClassType: ClassType | undefined;
        if (containingClassNode) {
            const classInfo = getTypeOfClass(containingClassNode);
            if (!classInfo) {
                return undefined;
            }
            containingClassType = classInfo.classType;
        }

        let functionFlags = getFunctionFlagsFromDecorators(node, !!containingClassNode);
        if (functionDecl?.isGenerator) {
            functionFlags |= FunctionTypeFlags.Generator;
        }

        if (fileInfo.isStubFile) {
            functionFlags |= FunctionTypeFlags.StubDefinition;
        }

        if (node.isAsync) {
            functionFlags |= FunctionTypeFlags.Async;
        }

        functionType = FunctionType.createInstance(
            node.name.value,
            fileInfo.moduleName,
            functionFlags,
            ParseTreeUtils.getDocString(node.suite.statements)
        );

        if (fileInfo.isBuiltInStubFile || fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod', 'dataclass' and 'NewType'
            // specially.
            functionType.details.builtInName = node.name.value;
        }

        functionType.details.declaration = functionDecl;

        // Allow recursion by registering the partially-constructed
        // function type.
        const scope = ScopeUtils.getScopeForNode(node);
        const functionSymbol = scope?.lookUpSymbol(node.name.value);
        if (functionDecl) {
            setSymbolResolutionPartialType(functionSymbol!, functionDecl, functionType);
        }
        writeTypeCache(node, functionType);
        writeTypeCache(node.name, functionType);

        // Is this an "__init__" method within a pseudo-generic class? If so,
        // we'll add generic types to the constructor's parameters.
        const addGenericParamTypes =
            containingClassType &&
            ClassType.isPseudoGenericClass(containingClassType) &&
            node.name.value === '__init__';

        const paramTypes: Type[] = [];
        let typeParamIndex = 0;

        // Determine if the first parameter should be skipped for comment-based
        // function annotations.
        let firstCommentAnnotationIndex = 0;
        if (containingClassType && (functionType.details.flags & FunctionTypeFlags.StaticMethod) === 0) {
            firstCommentAnnotationIndex = 1;
        }

        // If there is a function annotation comment, validate that it has the correct
        // number of parameter annotations.
        if (node.functionAnnotationComment && !node.functionAnnotationComment.isParamListEllipsis) {
            const expected = node.parameters.length - firstCommentAnnotationIndex;
            const received = node.functionAnnotationComment.paramTypeAnnotations.length;

            // For methods with "self" or "cls" parameters, the annotation list
            // can either include or exclude the annotation for the first parameter.
            if (firstCommentAnnotationIndex > 0 && received === node.parameters.length) {
                firstCommentAnnotationIndex = 0;
            } else if (received !== expected) {
                addError(
                    Localizer.Diagnostic.annotatedParamCountMismatch().format({
                        expected,
                        received,
                    }),
                    node.functionAnnotationComment
                );
            }
        }

        const typeParameters: TypeVarType[] = [];

        node.parameters.forEach((param, index) => {
            let paramType: Type | undefined;
            let annotatedType: Type | undefined;
            let concreteAnnotatedType: Type | undefined;
            let isNoneWithoutOptional = false;
            let paramTypeNode: ExpressionNode | undefined;

            if (param.typeAnnotation) {
                paramTypeNode = param.typeAnnotation;
            } else if (node.functionAnnotationComment && !node.functionAnnotationComment.isParamListEllipsis) {
                const adjustedIndex = index - firstCommentAnnotationIndex;
                if (adjustedIndex >= 0 && adjustedIndex < node.functionAnnotationComment.paramTypeAnnotations.length) {
                    paramTypeNode = node.functionAnnotationComment.paramTypeAnnotations[adjustedIndex];
                }
            }

            if (paramTypeNode) {
                annotatedType = getTypeOfAnnotation(
                    paramTypeNode,
                    /* allowFinal */ false,
                    /* associateTypeVarsWithScope */ true
                );
            }

            if (!annotatedType && addGenericParamTypes) {
                if (index > 0 && param.category === ParameterCategory.Simple && param.name) {
                    annotatedType = containingClassType!.details.typeParameters[typeParamIndex];
                    typeParamIndex++;
                }
            }

            if (annotatedType) {
                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                if (param.defaultValue && param.defaultValue.nodeType === ParseNodeType.Constant) {
                    if (param.defaultValue.constType === KeywordType.None) {
                        isNoneWithoutOptional = true;

                        if (!fileInfo.diagnosticRuleSet.strictParameterNoneValue) {
                            annotatedType = combineTypes([annotatedType, NoneType.createInstance()]);
                        }
                    }
                }

                concreteAnnotatedType = specializeType(annotatedType, /* typeVarMap */ undefined);
            }

            let defaultValueType: Type | undefined;
            if (param.defaultValue) {
                defaultValueType = getTypeOfExpression(
                    param.defaultValue,
                    annotatedType,
                    EvaluatorFlags.ConvertEllipsisToAny
                ).type;
            }

            if (annotatedType) {
                // If there was both a type annotation and a default value, verify
                // that the default value matches the annotation.
                if (param.defaultValue && defaultValueType && concreteAnnotatedType) {
                    const diagAddendum = new DiagnosticAddendum();

                    if (!canAssignType(concreteAnnotatedType, defaultValueType, diagAddendum)) {
                        const diag = addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.paramAssignmentMismatch().format({
                                sourceType: printType(defaultValueType),
                                paramType: printType(annotatedType),
                            }) + diagAddendum.getString(),
                            param.defaultValue
                        );

                        if (isNoneWithoutOptional && paramTypeNode) {
                            const addOptionalAction: AddMissingOptionalToParamAction = {
                                action: Commands.addMissingOptionalToParam,
                                offsetOfTypeNode: paramTypeNode.start + 1,
                            };
                            if (diag) {
                                diag.addAction(addOptionalAction);
                            }
                        }
                    }
                }

                paramType = annotatedType;
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.value : undefined,
                hasDefault: !!param.defaultValue,
                defaultType: defaultValueType,
                hasDeclaredType: !!paramTypeNode,
                type: paramType || UnknownType.create(),
            };

            FunctionType.addParameter(functionType, functionParam);

            if (param.name) {
                const variadicParamType = transformVariadicParamType(node, param.category, functionParam.type);
                paramTypes.push(variadicParamType);
            } else {
                paramTypes.push(functionParam.type);
            }
        });

        if (containingClassNode && containingClassType) {
            // If the first parameter doesn't have an explicit type annotation,
            // provide a type if it's an instance, class or constructor method.
            if (functionType.details.parameters.length > 0 && !node.parameters[0].typeAnnotation) {
                const inferredParamType = inferFirstParamType(
                    functionType.details.flags,
                    containingClassType,
                    containingClassNode
                );
                if (inferredParamType) {
                    functionType.details.parameters[0].type = inferredParamType;
                    if (!isAnyOrUnknown(inferredParamType)) {
                        functionType.details.parameters[0].isTypeInferred = true;
                    }

                    paramTypes[0] = inferredParamType;
                }
            }
        }

        // Update the types for the nodes associated with the parameters.
        paramTypes.forEach((paramType, index) => {
            const paramNameNode = node.parameters[index].name;
            if (paramNameNode) {
                if (isUnknown(paramType)) {
                    functionType.details.flags |= FunctionTypeFlags.UnannotatedParams;
                }
                writeTypeCache(paramNameNode, paramType);
            }
        });

        // If there was a defined return type, analyze that first so when we
        // walk the contents of the function, return statements can be
        // validated against this type.
        if (node.returnTypeAnnotation) {
            // Temporarily set the return type to unknown in case of recursion.
            functionType.details.declaredReturnType = UnknownType.create();

            const returnType = getTypeOfAnnotation(
                node.returnTypeAnnotation,
                /* allowFinal */ false,
                /* associateTypeVarsWithScope */ true
            );
            functionType.details.declaredReturnType = returnType;
        } else if (node.functionAnnotationComment) {
            // Temporarily set the return type to unknown in case of recursion.
            functionType.details.declaredReturnType = UnknownType.create();

            const returnType = getTypeOfAnnotation(
                node.functionAnnotationComment.returnTypeAnnotation,
                /* allowFinal */ false,
                /* associateTypeVarsWithScope */ true
            );
            functionType.details.declaredReturnType = returnType;
        } else {
            // If there was no return type annotation and this is a type stub,
            // we have no opportunity to infer the return type, so we'll indicate
            // that it's unknown.
            if (fileInfo.isStubFile) {
                // Special-case the __init__ method, which is commonly left without
                // an annotated return type, but we can assume it returns None.
                if (node.name.value === '__init__') {
                    functionType.details.declaredReturnType = NoneType.createInstance();
                } else {
                    functionType.details.declaredReturnType = UnknownType.create();
                }
            }
        }

        // If it's an async function, wrap the return type in an Awaitable or Generator.
        const preDecoratedType = node.isAsync ? createAsyncFunction(node, functionType) : functionType;

        // Apply all of the decorators in reverse order.
        decoratedType = preDecoratedType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyFunctionDecorator(decoratedType, functionType, decorator, node);
            if (isUnknown(newDecoratedType)) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUntypedFunctionDecorator,
                        DiagnosticRule.reportUntypedFunctionDecorator,
                        Localizer.Diagnostic.functionDecoratorTypeUnknown(),
                        node.decorators[i].leftExpression
                    );

                    foundUnknown = true;
                }
            } else {
                // Apply the decorator only if the type is known.
                decoratedType = newDecoratedType;
            }
        }

        // See if there are any overloads provided by previous function declarations.
        if (decoratedType.category === TypeCategory.Function) {
            decoratedType = addOverloadsToFunctionType(node, decoratedType);
        }

        writeTypeCache(node.name, functionType);
        writeTypeCache(node, decoratedType);

        return { functionType, decoratedType };
    }

    function inferFirstParamType(
        flags: FunctionTypeFlags,
        containingClassType: ClassType,
        containingClassNode: ClassNode
    ): Type | undefined {
        if ((flags & FunctionTypeFlags.StaticMethod) === 0) {
            if (containingClassType) {
                if (ClassType.isProtocolClass(containingClassType)) {
                    // Don't specialize the "self" for protocol classes because type
                    // comparisons will fail during structural typing analysis. We'll
                    // use an "Any" type here to avoid triggering errors about Unknown
                    // types.
                    return AnyType.create();
                }

                if (flags & (FunctionTypeFlags.ClassMethod | FunctionTypeFlags.ConstructorMethod)) {
                    // For class methods, the cls parameter is allowed to skip the
                    // abstract class test because the caller is possibly passing
                    // in a non-abstract subclass.
                    const clsType = TypeVarType.createInstance(
                        `__type_of_cls_${containingClassType.details.name}`,
                        /* isParamSpec */ false,
                        /* isSynthesized */ true
                    );
                    clsType.scopeId = TypeVarType.makeScopeId(clsType.details.name, containingClassNode.id);
                    clsType.details.boundType = selfSpecializeClassType(
                        containingClassType,
                        /* setSkipAbstractClassTest */ true
                    );
                    return clsType;
                } else if ((flags & FunctionTypeFlags.StaticMethod) === 0) {
                    const selfType = TypeVarType.createInstance(
                        `__type_of_self_${containingClassType.details.name}`,
                        /* isParamSpec */ false,
                        /* isSynthesized */ true
                    );
                    selfType.scopeId = TypeVarType.makeScopeId(selfType.details.name, containingClassNode.id);
                    selfType.details.boundType = ObjectType.create(
                        selfSpecializeClassType(containingClassType, /* setSkipAbstractClassTest */ true)
                    );
                    return selfType;
                }
            }
        }

        return undefined;
    }

    // Transforms the parameter type based on its category. If it's a simple parameter,
    // no transform is applied. If it's a var-arg or keyword-arg parameter, the type
    // is wrapped in a List or Dict.
    function transformVariadicParamType(node: ParseNode, paramCategory: ParameterCategory, type: Type): Type {
        switch (paramCategory) {
            case ParameterCategory.Simple: {
                return type;
            }

            case ParameterCategory.VarArgList: {
                // Create a Tuple[X, ...] type.
                const tupleType = getTypingType(node, 'Tuple');
                if (tupleType && isClass(tupleType)) {
                    return ObjectType.create(
                        ClassType.cloneForSpecialization(
                            tupleType,
                            [type, AnyType.create(true)],
                            /* isTypeArgumentExplicit */ false
                        )
                    );
                }

                return UnknownType.create();
            }

            case ParameterCategory.VarArgDictionary: {
                const dictType = getBuiltInType(node, 'Dict');
                const strType = getBuiltInObject(node, 'str');

                if (isClass(dictType) && isObject(strType)) {
                    return ObjectType.create(
                        ClassType.cloneForSpecialization(dictType, [strType, type], /* isTypeArgumentExplicit */ false)
                    );
                }

                return UnknownType.create();
            }
        }
    }

    // Scans through the decorators to find a few built-in decorators
    // that affect the function flags.
    function getFunctionFlagsFromDecorators(node: FunctionNode, isInClass: boolean) {
        const fileInfo = getFileInfo(node);
        let flags = FunctionTypeFlags.None;

        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        if (node.name.value === '__new__' && isInClass) {
            flags |= FunctionTypeFlags.ConstructorMethod;
        }

        for (const decoratorNode of node.decorators) {
            let evaluatorFlags = EvaluatorFlags.DoNotSpecialize;
            if (fileInfo.isStubFile) {
                // Some stub files (e.g. builtins.pyi) rely on forward
                // declarations of decorators.
                evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
            }

            const decoratorType = getTypeOfExpression(decoratorNode.leftExpression, undefined, evaluatorFlags).type;
            if (decoratorType.category === TypeCategory.Function) {
                if (decoratorType.details.builtInName === 'abstractmethod') {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.AbstractMethod;
                    }
                } else if (decoratorType.details.builtInName === 'final') {
                    flags |= FunctionTypeFlags.Final;
                }
            } else if (isClass(decoratorType)) {
                if (ClassType.isBuiltIn(decoratorType, 'staticmethod')) {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.StaticMethod;
                    }
                } else if (ClassType.isBuiltIn(decoratorType, 'classmethod')) {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.ClassMethod;
                    }
                }
            }
        }

        return flags;
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    function applyFunctionDecorator(
        inputFunctionType: Type,
        originalFunctionType: FunctionType,
        decoratorNode: DecoratorNode,
        functionNode: FunctionNode
    ): Type {
        const fileInfo = getFileInfo(decoratorNode);

        let evaluatorFlags = EvaluatorFlags.DoNotSpecialize;
        if (fileInfo.isStubFile) {
            // Some stub files (e.g. builtins.pyi) rely on forward
            // declarations of decorators.
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        const decoratorType = getTypeOfExpression(decoratorNode.leftExpression, undefined, evaluatorFlags).type;

        // Special-case the "overload" because it has no definition.
        if (isClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) {
            if (inputFunctionType.category === TypeCategory.Function) {
                inputFunctionType.details.flags |= FunctionTypeFlags.Overloaded;
                return inputFunctionType;
            }
        }

        const returnType = getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (decoratorType.category === TypeCategory.Function) {
            if (decoratorType.details.builtInName === 'abstractmethod') {
                return inputFunctionType;
            }

            // Handle property setters and deleters.
            if (decoratorNode.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                const baseType = getTypeOfExpression(decoratorNode.leftExpression.leftExpression).type;
                if (isProperty(baseType)) {
                    const memberName = decoratorNode.leftExpression.memberName.value;
                    if (memberName === 'setter') {
                        return clonePropertyWithSetter(baseType, originalFunctionType, functionNode);
                    } else if (memberName === 'deleter') {
                        return clonePropertyWithDeleter(baseType, originalFunctionType);
                    }
                }
            }
        } else if (isClass(decoratorType)) {
            if (ClassType.isBuiltIn(decoratorType)) {
                switch (decoratorType.details.name) {
                    case 'classmethod':
                    case 'staticmethod': {
                        return inputFunctionType;
                    }
                }
            }

            // Handle properties and subclasses of properties specially.
            if (ClassType.isPropertyClass(decoratorType)) {
                if (inputFunctionType.category === TypeCategory.Function) {
                    return createProperty(
                        decoratorNode,
                        decoratorType.details.name,
                        inputFunctionType,
                        decoratorNode.id
                    );
                }
            }
        }

        // Copy the overload flag from the input function type.
        if (inputFunctionType.category === TypeCategory.Function && returnType.category === TypeCategory.Function) {
            if (FunctionType.isOverloaded(inputFunctionType)) {
                returnType.details.flags |= FunctionTypeFlags.Overloaded;
            }
        }

        return returnType;
    }

    function createProperty(
        decoratorNode: DecoratorNode,
        className: string,
        fget: FunctionType,
        typeSourceId: TypeSourceId
    ): ObjectType {
        const fileInfo = getFileInfo(decoratorNode);
        const typeMetaclass = getBuiltInType(decoratorNode, 'type');
        const propertyClass = ClassType.create(
            className,
            getClassFullName(decoratorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            ClassTypeFlags.PropertyClass,
            typeSourceId,
            /* declaredMetaclass */ undefined,
            isClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
        );
        computeMroLinearization(propertyClass);

        const propertyObject = ObjectType.create(propertyClass);

        // Fill in the fget method.
        const fields = propertyClass.details.fields;
        const fgetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fget);
        fields.set('fget', fgetSymbol);

        // Fill in the __get__ method.
        const getFunction = FunctionType.createInstance('__get__', '', FunctionTypeFlags.SynthesizedMethod);
        getFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fget.details.parameters.length > 0 ? fget.details.parameters[0].type : AnyType.create(),
        });
        getFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject,
        });
        getFunction.details.declaredReturnType = fget.details.declaredReturnType;
        getFunction.details.declaration = fget.details.declaration;
        const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunction);
        fields.set('__get__', getSymbol);

        // Fill in the getter, setter and deleter methods.
        ['getter', 'setter', 'deleter'].forEach((accessorName) => {
            const accessorFunction = FunctionType.createInstance(accessorName, '', FunctionTypeFlags.SynthesizedMethod);
            accessorFunction.details.parameters.push({
                category: ParameterCategory.Simple,
                name: 'self',
                type: propertyObject,
            });
            accessorFunction.details.parameters.push({
                category: ParameterCategory.Simple,
                name: 'accessor',
                type: AnyType.create(),
            });
            accessorFunction.details.declaredReturnType = propertyObject;
            const accessorSymbol = Symbol.createWithType(SymbolFlags.ClassMember, accessorFunction);
            fields.set(accessorName, accessorSymbol);
        });

        return propertyObject;
    }

    function clonePropertyWithSetter(prop: Type, fset: FunctionType, errorNode: FunctionNode): Type {
        if (!isProperty(prop)) {
            return prop;
        }

        const classType = (prop as ObjectType).classType;
        const propertyClass = ClassType.create(
            classType.details.name,
            classType.details.fullName,
            classType.details.moduleName,
            classType.details.flags,
            classType.details.typeSourceId,
            classType.details.declaredMetaclass,
            classType.details.effectiveMetaclass
        );
        computeMroLinearization(propertyClass);

        const propertyObject = ObjectType.create(propertyClass);

        // Clone the symbol table of the old class type.
        const fields = propertyClass.details.fields;
        classType.details.fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                fields.set(name, symbol);
            }
        });

        // Verify parameters for fset.
        if (errorNode.parameters.length >= 2 && errorNode.parameters[1].typeAnnotation) {
            // Verify consistency of the type.
            const fgetType = getGetterTypeFromProperty(classType, /* inferTypeIfNeeded */ false);
            if (fgetType && !isAnyOrUnknown(fgetType)) {
                const fsetType = getTypeOfAnnotation(errorNode.parameters[1].typeAnnotation);

                // The setter type should be assignable to the getter type.
                const diag = new DiagnosticAddendum();
                if (
                    !canAssignType(
                        fgetType,
                        fsetType,
                        diag,
                        /* typeVarMap */ undefined,
                        CanAssignFlags.DoNotSpecializeTypeVars
                    )
                ) {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportPropertyTypeMismatch,
                        DiagnosticRule.reportPropertyTypeMismatch,
                        Localizer.Diagnostic.setterGetterTypeMismatch() + diag.getString(),
                        errorNode.parameters[1].typeAnnotation
                    );
                }
            }
        }

        // Fill in the fset method.
        const fsetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fset);
        fields.set('fset', fsetSymbol);

        // Fill in the __set__ method.
        const setFunction = FunctionType.createInstance('__set__', '', FunctionTypeFlags.SynthesizedMethod);
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fset.details.parameters.length > 0 ? fset.details.parameters[0].type : AnyType.create(),
        });
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject,
        });
        setFunction.details.declaredReturnType = NoneType.createInstance();
        let setParamType: Type = UnknownType.create();
        if (
            fset.details.parameters.length >= 2 &&
            fset.details.parameters[1].category === ParameterCategory.Simple &&
            fset.details.parameters[1].name
        ) {
            setParamType = fset.details.parameters[1].type;
        }
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'value',
            type: setParamType,
        });
        const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
        fields.set('__set__', setSymbol);

        return propertyObject;
    }

    function clonePropertyWithDeleter(prop: Type, fdel: FunctionType): Type {
        if (!isProperty(prop)) {
            return prop;
        }

        const classType = (prop as ObjectType).classType;
        const propertyClass = ClassType.create(
            classType.details.name,
            classType.details.fullName,
            classType.details.moduleName,
            classType.details.flags,
            classType.details.typeSourceId,
            classType.details.declaredMetaclass,
            classType.details.effectiveMetaclass
        );
        computeMroLinearization(propertyClass);

        const propertyObject = ObjectType.create(propertyClass);

        // Clone the symbol table of the old class type.
        const fields = propertyClass.details.fields;
        classType.details.fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                fields.set(name, symbol);
            }
        });

        // Fill in the fdel method.
        const fdelSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fdel);
        fields.set('fdel', fdelSymbol);

        // Fill in the __delete__ method.
        const delFunction = FunctionType.createInstance('__delete__', '', FunctionTypeFlags.SynthesizedMethod);
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fdel.details.parameters.length > 0 ? fdel.details.parameters[0].type : AnyType.create(),
        });
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject,
        });
        delFunction.details.declaredReturnType = NoneType.createInstance();
        const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
        fields.set('__delete__', delSymbol);

        return propertyObject;
    }

    // Given a function node and the function type associated with it, this
    // method search for prior function nodes that are marked as @overload
    // and creates an OverloadedFunctionType that includes this function and
    // all previous ones.
    function addOverloadsToFunctionType(node: FunctionNode, type: FunctionType): Type {
        let functionDecl: FunctionDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
            functionDecl = decl as FunctionDeclaration;
        }
        const symbolWithScope = lookUpSymbolRecursive(node, node.name.value, /* honorCodeFlow */ false);
        if (symbolWithScope) {
            const decls = symbolWithScope.symbol.getDeclarations();

            // Find this function's declaration.
            let declIndex = decls.findIndex((decl) => decl === functionDecl);
            if (declIndex > 0) {
                const overloadedTypes: FunctionType[] = [type];
                while (declIndex > 0) {
                    const decl = decls[declIndex - 1];
                    if (decl.type !== DeclarationType.Function) {
                        break;
                    }

                    const declTypeInfo = getTypeOfFunction(decl.node);
                    if (!declTypeInfo) {
                        break;
                    }

                    if (declTypeInfo.decoratedType.category === TypeCategory.Function) {
                        if (FunctionType.isOverloaded(declTypeInfo.decoratedType)) {
                            overloadedTypes.unshift(declTypeInfo.decoratedType);
                        } else {
                            break;
                        }
                    } else if (declTypeInfo.decoratedType.category === TypeCategory.OverloadedFunction) {
                        // If the previous declaration was itself an overloaded function,
                        // copy the last entry out of it.
                        const lastOverload =
                            declTypeInfo.decoratedType.overloads[declTypeInfo.decoratedType.overloads.length - 1];
                        if (FunctionType.isOverloaded(lastOverload)) {
                            overloadedTypes.unshift(lastOverload);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }

                    declIndex--;
                }

                if (overloadedTypes.length > 1) {
                    // Create a new overloaded type that copies the contents of the previous
                    // one and adds a new function.
                    const newOverload = OverloadedFunctionType.create();
                    newOverload.overloads = overloadedTypes;

                    const prevOverload = overloadedTypes[overloadedTypes.length - 2];
                    const isPrevOverloadAbstract = FunctionType.isAbstractMethod(prevOverload);
                    const isCurrentOverloadAbstract = FunctionType.isAbstractMethod(type);

                    if (isPrevOverloadAbstract !== isCurrentOverloadAbstract) {
                        addDiagnostic(
                            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.overloadAbstractMismatch().format({ name: node.name.value }),
                            node.name
                        );
                    }

                    return newOverload;
                }
            }
        }

        return type;
    }

    function createAsyncFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
        // Clone the original function and replace its return type with an
        // Awaitable[<returnType>].
        const awaitableFunctionType = FunctionType.clone(functionType);

        if (functionType.details.declaredReturnType) {
            awaitableFunctionType.details.declaredReturnType = createAwaitableReturnType(
                node,
                functionType.details.declaredReturnType
            );
        }

        // Note that the inferred type, once lazily computed, needs to wrap the
        // resulting type in an awaitable.
        awaitableFunctionType.details.flags |= FunctionTypeFlags.WrapReturnTypeInAwait;

        return awaitableFunctionType;
    }

    function createAwaitableReturnType(node: ParseNode, returnType: Type): Type {
        let awaitableReturnType: Type | undefined;

        if (isObject(returnType)) {
            const classType = returnType.classType;
            if (ClassType.isBuiltIn(classType)) {
                if (classType.details.name === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = getTypingType(node, 'AsyncGenerator');
                    if (asyncGeneratorType && isClass(asyncGeneratorType)) {
                        const typeArgs: Type[] = [];
                        const generatorTypeArgs = classType.typeArguments;
                        if (generatorTypeArgs && generatorTypeArgs.length > 0) {
                            typeArgs.push(generatorTypeArgs[0]);
                        }
                        if (generatorTypeArgs && generatorTypeArgs.length > 1) {
                            typeArgs.push(generatorTypeArgs[1]);
                        }
                        awaitableReturnType = ObjectType.create(
                            ClassType.cloneForSpecialization(
                                asyncGeneratorType,
                                typeArgs,
                                /* isTypeArgumentExplicit */ false
                            )
                        );
                    }
                } else if (
                    ['AsyncGenerator', 'AsyncIterator', 'AsyncIterable'].some((name) => name === classType.details.name)
                ) {
                    // If it's already an AsyncGenerator, AsyncIterator or AsyncIterable,
                    // leave it as is.
                    awaitableReturnType = returnType;
                }
            }
        }

        if (!awaitableReturnType) {
            // Wrap in a Coroutine, which is a subclass of Awaitable.
            const coroutineType = getTypingType(node, 'Coroutine');
            if (coroutineType && isClass(coroutineType)) {
                // Don't wrap a NoReturn in a Coroutine. Treat it as an Any.
                if (isNoReturnType(returnType)) {
                    returnType = AnyType.create();
                }

                awaitableReturnType = ObjectType.create(
                    ClassType.cloneForSpecialization(
                        coroutineType,
                        [AnyType.create(), AnyType.create(), returnType],
                        /* isTypeArgumentExplicit */ true
                    )
                );
            } else {
                awaitableReturnType = UnknownType.create();
            }
        }

        return awaitableReturnType;
    }

    function inferFunctionReturnType(node: FunctionNode, isAbstract: boolean): Type | undefined {
        // This shouldn't be called if there is a declared return type.
        const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
        assert(!returnAnnotation);

        // Is this type already cached?
        let inferredReturnType = readTypeCache(node.suite);
        if (inferredReturnType) {
            return inferredReturnType;
        }

        if (!functionRecursionMap.has(node.id)) {
            functionRecursionMap.set(node.id, true);

            try {
                let functionDecl: FunctionDeclaration | undefined;
                const decl = AnalyzerNodeInfo.getDeclaration(node);
                if (decl) {
                    functionDecl = decl as FunctionDeclaration;
                }

                // Is it a generator?
                if (functionDecl?.yieldStatements) {
                    const inferredYieldTypes: Type[] = [];
                    functionDecl.yieldStatements.forEach((yieldNode) => {
                        if (isNodeReachable(yieldNode)) {
                            if (yieldNode.nodeType === ParseNodeType.YieldFrom) {
                                const iteratorType = getTypeOfExpression(yieldNode.expression).type;
                                const yieldType = getTypeFromIterable(
                                    iteratorType,
                                    /* isAsync */ false,
                                    yieldNode,
                                    /* supportGetItem */ false
                                );
                                inferredYieldTypes.push(yieldType || UnknownType.create());
                            } else {
                                if (yieldNode.expression) {
                                    const yieldType = getTypeOfExpression(yieldNode.expression).type;
                                    inferredYieldTypes.push(yieldType || UnknownType.create());
                                } else {
                                    inferredYieldTypes.push(NoneType.createInstance());
                                }
                            }
                        }
                    });

                    if (inferredYieldTypes.length === 0) {
                        inferredYieldTypes.push(NoneType.createInstance());
                    }
                    inferredReturnType = combineTypes(inferredYieldTypes);

                    // Inferred yield types need to be wrapped in a Generator to
                    // produce the final result.
                    const generatorType = getTypingType(node, 'Generator');
                    if (generatorType && isClass(generatorType)) {
                        inferredReturnType = ObjectType.create(
                            ClassType.cloneForSpecialization(
                                generatorType,
                                [inferredReturnType],
                                /* isTypeArgumentExplicit */ false
                            )
                        );
                    } else {
                        inferredReturnType = UnknownType.create();
                    }
                } else {
                    const functionNeverReturns = !isAfterNodeReachable(node);
                    const implicitlyReturnsNone = isAfterNodeReachable(node.suite);

                    // Infer the return type based on all of the return statements in the function's body.
                    if (getFileInfo(node).isStubFile) {
                        // If a return type annotation is missing in a stub file, assume
                        // it's an "unknown" type. In normal source files, we can infer the
                        // type from the implementation.
                        inferredReturnType = UnknownType.create();
                    } else if (functionNeverReturns) {
                        // If the function always raises and never returns, assume a "NoReturn" type.
                        // Skip this for abstract methods which often are implemented with "raise
                        // NotImplementedError()".
                        if (isAbstract || methodAlwaysRaisesNotImplemented(functionDecl)) {
                            inferredReturnType = UnknownType.create();
                        } else {
                            const noReturnClass = getTypingType(node, 'NoReturn');
                            if (noReturnClass && isClass(noReturnClass)) {
                                inferredReturnType = ObjectType.create(noReturnClass);
                            } else {
                                inferredReturnType = UnknownType.create();
                            }
                        }
                    } else {
                        const inferredReturnTypes: Type[] = [];
                        if (functionDecl?.returnStatements) {
                            functionDecl.returnStatements.forEach((returnNode) => {
                                if (isNodeReachable(returnNode)) {
                                    if (returnNode.returnExpression) {
                                        const returnType = getTypeOfExpression(returnNode.returnExpression).type;
                                        inferredReturnTypes.push(returnType || UnknownType.create());
                                    } else {
                                        inferredReturnTypes.push(NoneType.createInstance());
                                    }
                                }
                            });
                        }

                        if (!functionNeverReturns && implicitlyReturnsNone) {
                            inferredReturnTypes.push(NoneType.createInstance());
                        }

                        inferredReturnType = combineTypes(inferredReturnTypes);
                    }
                }

                // Remove any unbound values since those would generate an exception
                // before being returned.
                inferredReturnType = removeUnboundFromUnion(inferredReturnType);

                writeTypeCache(node.suite, inferredReturnType);
            } finally {
                functionRecursionMap.delete(node.id);
            }
        }

        return inferredReturnType;
    }

    // Determines whether the function consists only of a "raise" statement
    // and the exception type raised is a NotImplementedError. This is commonly
    // used for abstract methods that
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

        for (const raiseStatement of functionDecl.raiseStatements) {
            if (!raiseStatement.typeExpression || raiseStatement.valueExpression) {
                return false;
            }
            const raiseType = getTypeOfExpression(raiseStatement.typeExpression).type;
            const classType = isClass(raiseType) ? raiseType : isObject(raiseType) ? raiseType.classType : undefined;
            if (!classType || !ClassType.isBuiltIn(classType, 'NotImplementedError')) {
                return false;
            }
        }

        return true;
    }

    function evaluateTypesForForStatement(node: ForNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const iteratorType = getTypeOfExpression(node.iterableExpression).type;
        const iteratedType = getTypeFromIterable(iteratorType, !!node.isAsync, node.iterableExpression, !node.isAsync);

        assignTypeToExpression(node.targetExpression, iteratedType, node.targetExpression);

        writeTypeCache(node, iteratedType);
    }

    function evaluateTypesForExceptStatement(node: ExceptNode): void {
        // This should be called only if the except node has a target exception.
        assert(node.typeExpression !== undefined);

        if (readTypeCache(node)) {
            return;
        }

        const exceptionTypes = getTypeOfExpression(node.typeExpression!).type;

        function getExceptionType(exceptionType: Type, errorNode: ParseNode) {
            if (isAnyOrUnknown(exceptionType)) {
                return exceptionType;
            }

            if (isObject(exceptionType)) {
                exceptionType = transformTypeObjectToClass(exceptionType);
            }

            if (isClass(exceptionType)) {
                return ObjectType.create(exceptionType);
            }

            if (isObject(exceptionType)) {
                const iterableType = getTypeFromIterable(
                    exceptionType,
                    /* isAsync */ false,
                    errorNode,
                    /* supportGetItem */ false
                );

                return doForSubtypes(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        return subtype;
                    }

                    const transformedSubtype = transformTypeObjectToClass(subtype);
                    if (isClass(transformedSubtype)) {
                        return ObjectType.create(transformedSubtype);
                    }

                    return UnknownType.create();
                });
            }

            return UnknownType.create();
        }

        const targetType = doForSubtypes(exceptionTypes, (subType) => {
            // If more than one type was specified for the exception, we'll receive
            // a specialized tuple object here.
            const tupleType = getSpecializedTupleType(subType);
            if (tupleType && tupleType.typeArguments) {
                const entryTypes = tupleType.typeArguments.map((t) => {
                    return getExceptionType(t, node.typeExpression!);
                });
                return combineTypes(entryTypes);
            }

            return getExceptionType(subType, node.typeExpression!);
        });

        if (node.name) {
            assignTypeToExpression(node.name, targetType);
        }

        writeTypeCache(node, targetType);
    }

    function evaluateTypesForWithStatement(node: WithItemNode): void {
        if (readTypeCache(node)) {
            return;
        }

        let exprType = getTypeOfExpression(node.expression).type;
        const isAsync = node.parent && node.parent.nodeType === ParseNodeType.With && !!node.parent.isAsync;

        if (isOptionalType(exprType)) {
            const fileInfo = getFileInfo(node);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportOptionalContextManager,
                DiagnosticRule.reportOptionalContextManager,
                Localizer.Diagnostic.noneNotUsableWith(),
                node.expression
            );
            exprType = removeNoneFromUnion(exprType);
        }

        // Verify that the target has an __enter__ or __aenter__ method defined.
        const enterMethodName = isAsync ? '__aenter__' : '__enter__';
        const scopedType = doForSubtypes(exprType, (subtype) => {
            subtype = makeTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            const additionalHelp = new DiagnosticAddendum();

            if (isObject(subtype)) {
                const enterType = getTypeFromObjectMember(
                    node.expression,
                    subtype,
                    enterMethodName,
                    { method: 'get' },
                    diag,
                    MemberAccessFlags.None
                );

                if (enterType) {
                    let memberReturnType: Type;
                    if (enterType.category === TypeCategory.Function) {
                        memberReturnType = getFunctionEffectiveReturnType(enterType);
                    } else {
                        memberReturnType = UnknownType.create();
                    }

                    // For "async while", an implicit "await" is performed.
                    if (isAsync) {
                        memberReturnType = getTypeFromAwaitable(memberReturnType, node);
                    }

                    return memberReturnType;
                }

                if (!isAsync) {
                    const memberType = getTypeFromObjectMember(
                        node.expression,
                        subtype,
                        '__aenter__',
                        { method: 'get' },
                        diag,
                        MemberAccessFlags.None
                    );
                    if (memberType) {
                        additionalHelp.addMessage(Localizer.DiagnosticAddendum.asyncHelp());
                    }
                }
            }

            const fileInfo = getFileInfo(node);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotUsableWith().format({ type: printType(subtype), method: enterMethodName }) +
                    additionalHelp.getString(),
                node.expression
            );
            return UnknownType.create();
        });

        // Verify that the target has an __exit__ or __aexit__ method defined.
        const exitMethodName = isAsync ? '__aexit__' : '__exit__';
        doForSubtypes(exprType, (subtype) => {
            subtype = makeTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return undefined;
            }

            const diag = new DiagnosticAddendum();

            if (isObject(subtype)) {
                const exitType = getTypeFromObjectMember(
                    node.expression,
                    subtype,
                    exitMethodName,
                    { method: 'get' },
                    diag,
                    MemberAccessFlags.None
                );

                if (exitType) {
                    return undefined;
                }
            }

            const fileInfo = getFileInfo(node);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotUsableWith().format({ type: printType(subtype), method: exitMethodName }),
                node.expression
            );
            return undefined;
        });

        if (node.target) {
            assignTypeToExpression(node.target, scopedType, node.target);
        }

        writeTypeCache(node, scopedType);
    }

    function evaluateTypesForImportAs(node: ImportAsNode): void {
        if (readTypeCache(node)) {
            return;
        }

        let symbolNameNode: NameNode;
        if (node.alias) {
            // The symbol name is defined by the alias.
            symbolNameNode = node.alias;
        } else {
            // There was no alias, so we need to use the first element of
            // the name parts as the symbol.
            symbolNameNode = node.module.nameParts[0];
        }

        if (!symbolNameNode) {
            // This can happen in certain cases where there are parse errors.
            return;
        }

        // Look up the symbol to find the alias declaration.
        let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.value) || UnknownType.create();

        // Is there a cached module type associated with this node? If so, use
        // it instead of the type we just created.
        const cachedModuleType = readTypeCache(node) as ModuleType;
        if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
            if (isTypeSame(symbolType, cachedModuleType)) {
                symbolType = cachedModuleType;
            }
        }

        assignTypeToNameNode(symbolNameNode, symbolType);

        writeTypeCache(node, symbolType);
    }

    function evaluateTypesForImportFromAs(node: ImportFromAsNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const aliasNode = node.alias || node.name;

        let symbolType = getAliasedSymbolTypeForName(node, aliasNode.value);
        if (!symbolType) {
            const parentNode = node.parent as ImportFromNode;
            assert(parentNode && parentNode.nodeType === ParseNodeType.ImportFrom);
            assert(!parentNode.isWildcardImport);

            const importInfo = AnalyzerNodeInfo.getImportInfo(parentNode.module);
            if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
                const resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];

                const importLookupInfo = importLookup(resolvedPath);
                const fileInfo = getFileInfo(node);
                let reportError = false;

                // If we were able to resolve the import, report the error as
                // an unresolved symbol.
                if (importLookupInfo) {
                    // Handle PEP 562 support for module-level __getattr__ function,
                    // introduced in Python 3.7.
                    if (
                        fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_7 ||
                        !importLookupInfo.symbolTable.get('__getattr__')
                    ) {
                        reportError = true;
                    }
                } else if (!resolvedPath) {
                    // This corresponds to the "from . import a" form.
                    reportError = true;
                }

                if (reportError) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.importSymbolUnknown().format({ name: node.name.value }),
                        node.name
                    );
                }
            }

            symbolType = UnknownType.create();
        }

        assignTypeToNameNode(aliasNode, symbolType);
        writeTypeCache(node, symbolType);
    }

    function evaluateTypesForImportFrom(node: ImportFromNode): void {
        if (readTypeCache(node)) {
            return;
        }

        // Use the first element of the name parts as the symbol.
        const symbolNameNode = node.module.nameParts[0];

        // Look up the symbol to find the alias declaration.
        let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.value) || UnknownType.create();

        // Is there a cached module type associated with this node? If so, use
        // it instead of the type we just created.
        const cachedModuleType = readTypeCache(node) as ModuleType;
        if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
            if (isTypeSame(symbolType, cachedModuleType)) {
                symbolType = cachedModuleType;
            }
        }

        assignTypeToNameNode(symbolNameNode, symbolType);

        writeTypeCache(node, symbolType);
    }

    function getAliasedSymbolTypeForName(
        node: ImportAsNode | ImportFromAsNode | ImportFromNode,
        name: string
    ): Type | undefined {
        const symbolWithScope = lookUpSymbolRecursive(node, name, /* honorCodeFlow */ true);
        if (!symbolWithScope) {
            return undefined;
        }

        let aliasDecl = symbolWithScope.symbol.getDeclarations().find((decl) => decl.node === node);

        // If we didn't find an exact match, look for any alias associated with
        // this symbol. In cases where we have multiple ImportAs nodes that share
        // the same first-part name (e.g. "import asyncio" and "import asyncio.tasks"),
        // we may not find the declaration associated with this node.
        if (!aliasDecl) {
            aliasDecl = symbolWithScope.symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias);
        }

        if (!aliasDecl) {
            return undefined;
        }

        assert(aliasDecl.type === DeclarationType.Alias);

        const resolvedDecl = resolveAliasDeclaration(aliasDecl, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            return resolvedDecl;
        }

        return getInferredTypeOfDeclaration(aliasDecl);
    }

    // In some cases, an expression must be evaluated in the context of another
    // expression or statement that contains it. This contextual evaluation
    // allows for bidirectional type evaluation.
    function evaluateTypesForExpressionInContext(node: ExpressionNode): void {
        let lastContextualExpression = node;
        let curNode: ParseNode | undefined = node;

        function isContextual(node: ParseNode) {
            // Parameters are contextual only for lambdas.
            if (
                node.nodeType === ParseNodeType.Parameter &&
                node.parent &&
                node.parent.nodeType === ParseNodeType.Lambda
            ) {
                return true;
            }

            // Arguments are contextual only for call nodes.
            if (
                node.nodeType === ParseNodeType.Argument &&
                node.parent &&
                node.parent.nodeType === ParseNodeType.Call
            ) {
                return true;
            }

            return (
                node.nodeType === ParseNodeType.Call ||
                node.nodeType === ParseNodeType.Dictionary ||
                node.nodeType === ParseNodeType.FormatString ||
                node.nodeType === ParseNodeType.List ||
                node.nodeType === ParseNodeType.Lambda ||
                node.nodeType === ParseNodeType.MemberAccess ||
                node.nodeType === ParseNodeType.Set ||
                node.nodeType === ParseNodeType.String ||
                node.nodeType === ParseNodeType.Tuple ||
                node.nodeType === ParseNodeType.Unpack ||
                node.nodeType === ParseNodeType.DictionaryKeyEntry ||
                node.nodeType === ParseNodeType.DictionaryExpandEntry ||
                node.nodeType === ParseNodeType.ListComprehension
            );
        }

        // Scan up the parse tree until we find a non-expression (while
        // looking for contextual expressions in the process).
        while (curNode) {
            const isNodeContextual = isContextual(curNode);
            if (!isNodeContextual && !isExpressionNode(curNode)) {
                break;
            }
            if (isNodeContextual) {
                lastContextualExpression = curNode as ExpressionNode;
            }

            curNode = curNode.parent;
        }

        const parent = lastContextualExpression.parent!;
        if (parent.nodeType === ParseNodeType.Assignment) {
            if (lastContextualExpression === parent.typeAnnotationComment) {
                getTypeOfAnnotation(
                    lastContextualExpression,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(parent.leftExpression)
                );
            } else {
                evaluateTypesForAssignmentStatement(parent);
            }
            return;
        }

        if (parent.nodeType === ParseNodeType.AugmentedAssignment) {
            evaluateTypesForAugmentedAssignment(parent);
            return;
        }

        const evaluateTypeAnnotationExpression = (node: TypeAnnotationNode) => {
            const annotationParent = node.parent;
            if (annotationParent?.nodeType === ParseNodeType.Assignment && annotationParent.leftExpression === parent) {
                evaluateTypesForAssignmentStatement(annotationParent);
            } else {
                const annotationType = getTypeOfAnnotation(
                    node.typeAnnotation,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(node.valueExpression)
                );
                if (annotationType) {
                    writeTypeCache(node.valueExpression, annotationType);
                }
            }
        };

        if (parent.nodeType === ParseNodeType.TypeAnnotation) {
            evaluateTypeAnnotationExpression(parent);
            return;
        }

        if (parent.nodeType === ParseNodeType.ModuleName) {
            // A name within a module name isn't an expression,
            // so there's nothing we can evaluate here.
            return;
        }

        if (parent.nodeType === ParseNodeType.Argument && lastContextualExpression === parent.name) {
            // A name used to specify a named parameter in an argument isn't an
            // expression, so there's nothing we can evaluate here.
            return;
        }

        if (parent.nodeType === ParseNodeType.Return && parent.returnExpression) {
            const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
            const declaredReturnType = enclosingFunctionNode
                ? getFunctionDeclaredReturnType(enclosingFunctionNode)
                : undefined;
            getTypeOfExpression(parent.returnExpression, declaredReturnType, EvaluatorFlags.None);
            return;
        }

        // If the parent is an expression, we'll evaluate it to provide
        // the context for its child. If it's not, we'll evaluate the
        // child directly without any context.
        const nodeToEvaluate =
            isExpressionNode(parent) && parent.nodeType !== ParseNodeType.Error
                ? (parent as ExpressionNode)
                : lastContextualExpression;

        if (nodeToEvaluate.nodeType === ParseNodeType.TypeAnnotation) {
            evaluateTypeAnnotationExpression(nodeToEvaluate);
        } else {
            getTypeOfExpression(nodeToEvaluate);
        }
    }

    function evaluateTypeOfParameter(node: ParameterNode): void {
        assert(node.name !== undefined);

        // We need to handle lambdas differently from functions because
        // the former never have parameter type annotations but can
        // be inferred, whereas the latter sometimes have type annotations
        // but cannot be inferred.
        const parent = node.parent!;
        if (parent.nodeType === ParseNodeType.Lambda) {
            evaluateTypesForExpressionInContext(parent);
            return;
        }

        assert(parent.nodeType === ParseNodeType.Function);
        const functionNode = parent as FunctionNode;

        const paramIndex = functionNode.parameters.findIndex((param) => param === node);
        const typeAnnotation = getTypeAnnotationForParameter(functionNode, paramIndex);

        if (typeAnnotation) {
            writeTypeCache(
                node.name!,
                transformVariadicParamType(
                    node,
                    node.category,
                    getTypeOfAnnotation(typeAnnotation, /* allowFinal */ false, /* associateTypeVarsWithScope */ true)
                )
            );
            return;
        }

        // We may be able to infer the type of the first parameter.
        if (paramIndex === 0) {
            const containingClassNode = ParseTreeUtils.getEnclosingClass(functionNode, true);
            if (containingClassNode) {
                const classInfo = getTypeOfClass(containingClassNode);
                if (classInfo) {
                    const functionFlags = getFunctionFlagsFromDecorators(functionNode, true);
                    // If the first parameter doesn't have an explicit type annotation,
                    // provide a type if it's an instance, class or constructor method.
                    const inferredParamType = inferFirstParamType(
                        functionFlags,
                        classInfo.classType,
                        containingClassNode
                    );
                    writeTypeCache(node.name!, inferredParamType || UnknownType.create());
                    return;
                }
            }
        }

        // We weren't able to infer the input parameter type. Set its
        // type to unknown.
        writeTypeCache(node.name!, transformVariadicParamType(node, node.category, UnknownType.create()));
    }

    // Evaluates the types that are assigned within the statement that contains
    // the specified parse node. In some cases, a broader statement may need to
    // be evaluated to provide sufficient context for the type. Evaluated types
    // are written back to the type cache for later retrieval.
    function evaluateTypesForStatement(node: ParseNode): void {
        let curNode: ParseNode | undefined = node;

        while (curNode) {
            switch (curNode.nodeType) {
                case ParseNodeType.Assignment: {
                    // See if the assignment is part of a chain of assignments. If so,
                    // evaluate the entire chain.
                    const isInAssignmentChain =
                        curNode.parent &&
                        (curNode.parent.nodeType === ParseNodeType.Assignment ||
                            curNode.parent.nodeType === ParseNodeType.AssignmentExpression ||
                            curNode.parent.nodeType === ParseNodeType.AugmentedAssignment) &&
                        curNode.parent.rightExpression === curNode;
                    if (!isInAssignmentChain) {
                        evaluateTypesForAssignmentStatement(curNode);
                        return;
                    }
                    break;
                }

                case ParseNodeType.AssignmentExpression: {
                    getTypeOfExpression(curNode);
                    return;
                }

                case ParseNodeType.AugmentedAssignment: {
                    evaluateTypesForAugmentedAssignment(curNode);
                    return;
                }

                case ParseNodeType.Class: {
                    getTypeOfClass(curNode);
                    return;
                }

                case ParseNodeType.Parameter: {
                    evaluateTypeOfParameter(curNode);
                    return;
                }

                case ParseNodeType.Lambda: {
                    evaluateTypesForExpressionInContext(curNode);
                    return;
                }

                case ParseNodeType.Function: {
                    getTypeOfFunction(curNode);
                    return;
                }

                case ParseNodeType.For: {
                    evaluateTypesForForStatement(curNode);
                    return;
                }

                case ParseNodeType.Except: {
                    evaluateTypesForExceptStatement(curNode);
                    return;
                }

                case ParseNodeType.WithItem: {
                    evaluateTypesForWithStatement(curNode);
                    return;
                }

                case ParseNodeType.ListComprehensionFor: {
                    const listComprehension = curNode.parent as ListComprehensionNode;
                    assert(listComprehension.nodeType === ParseNodeType.ListComprehension);
                    evaluateTypesForExpressionInContext(listComprehension);
                    return;
                }

                case ParseNodeType.ImportAs: {
                    evaluateTypesForImportAs(curNode);
                    return;
                }

                case ParseNodeType.ImportFromAs: {
                    evaluateTypesForImportFromAs(curNode);
                    return;
                }

                case ParseNodeType.ImportFrom: {
                    evaluateTypesForImportFrom(curNode);
                    return;
                }
            }

            curNode = curNode.parent;
        }

        fail('Unexpected assignment target');
        return undefined;
    }

    function getTypeFromWildcardImport(flowNode: FlowWildcardImport, name: string): Type {
        const importInfo = AnalyzerNodeInfo.getImportInfo(flowNode.node.module);
        assert(importInfo !== undefined && importInfo.isImportFound);
        assert(flowNode.node.isWildcardImport);

        const symbolWithScope = lookUpSymbolRecursive(flowNode.node, name, /* honorCodeFlow */ false);
        assert(symbolWithScope !== undefined);
        const decls = symbolWithScope!.symbol.getDeclarations();
        const wildcardDecl = decls.find((decl) => decl.node === flowNode.node);

        if (!wildcardDecl) {
            return UnknownType.create();
        }

        return getInferredTypeOfDeclaration(wildcardDecl) || UnknownType.create();
    }

    // When we're evaluating a call to determine whether it returns NoReturn,
    // we don't want to do a full type evaluation, which would be expensive
    // and create circular dependencies in type evaluation. Instead, we do
    // a best-effort evaluation using only declared types (functions, parameters,
    // etc.).
    function getDeclaredCallBaseType(node: ExpressionNode): Type | undefined {
        if (node.nodeType === ParseNodeType.Name) {
            const symbolWithScope = lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);

            if (!symbolWithScope) {
                return undefined;
            }

            const symbol = symbolWithScope.symbol;
            const type = getDeclaredTypeOfSymbol(symbol);
            if (type) {
                return type;
            }

            // There was no declared type. Before we give up, see if the
            // symbol is a function parameter whose value can be inferred
            // or an imported symbol.
            const declarations = symbol.getDeclarations();
            if (declarations.length === 0) {
                return undefined;
            }

            const decl = declarations[declarations.length - 1];
            if (decl.type === DeclarationType.Parameter) {
                evaluateTypeOfParameter(decl.node);
                return readTypeCache(decl.node.name!);
            }

            if (decl.type === DeclarationType.Alias) {
                return getInferredTypeOfDeclaration(decl);
            }

            return undefined;
        }

        if (node.nodeType === ParseNodeType.MemberAccess) {
            const memberName = node.memberName.value;
            let baseType = getDeclaredCallBaseType(node.leftExpression);
            if (!baseType) {
                return undefined;
            }

            baseType = makeTypeVarsConcrete(baseType);

            let symbol: Symbol | undefined;
            if (isModule(baseType)) {
                symbol = ModuleType.getField(baseType, memberName);
            } else if (isClass(baseType)) {
                const classMemberInfo = lookUpClassMember(baseType, memberName);
                symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
            } else if (isObject(baseType)) {
                const classMemberInfo = lookUpClassMember(baseType.classType, memberName);
                symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
            }

            if (!symbol) {
                return undefined;
            }

            return getDeclaredTypeOfSymbol(symbol);
        }

        return undefined;
    }

    // Determines whether a call never returns without fully evaluating its type.
    function isCallNoReturn(node: CallNode) {
        // See if this information is cached already.
        if (callIsNoReturnCache.has(node.id)) {
            return callIsNoReturnCache.get(node.id);
        }

        // Initially set to false to avoid infinite recursion.
        callIsNoReturnCache.set(node.id, false);

        let callIsNoReturn = false;

        // Evaluate the call base type.
        const callType = getDeclaredCallBaseType(node.leftExpression);
        if (callType) {
            // We assume here that no constructors or __call__ methods
            // will be inferred "no return" types, so we can restrict
            // our check to functions.
            let functionType: FunctionType | undefined;
            if (callType.category === TypeCategory.Function) {
                functionType = callType;
            } else if (callType.category === TypeCategory.OverloadedFunction) {
                // Use the last overload, which should be the most general.
                const overloadedFunction = callType;
                functionType = overloadedFunction.overloads[overloadedFunction.overloads.length - 1];
            }

            if (functionType && !FunctionType.isAsync(functionType)) {
                if (functionType.details.declaredReturnType) {
                    callIsNoReturn = isNoReturnType(functionType.details.declaredReturnType);
                } else if (functionType.inferredReturnType) {
                    // If the inferred return type has already been lazily
                    // evaluated, use it.
                    callIsNoReturn = isNoReturnType(functionType.inferredReturnType);
                } else if (functionType.details.declaration) {
                    // If the function has yield expressions, it's a generator, and
                    // we'll assume the yield statements are reachable. Also, don't
                    // infer a "no return" type for abstract methods.
                    if (
                        !functionType.details.declaration.yieldStatements &&
                        !FunctionType.isAbstractMethod(functionType) &&
                        !FunctionType.isStubDefinition(functionType)
                    ) {
                        callIsNoReturn = !isAfterNodeReachable(functionType.details.declaration.node);
                    }
                }
            }
        }

        // Cache the value for next time.
        callIsNoReturnCache.set(node.id, callIsNoReturn);

        return callIsNoReturn;
    }

    // Attempts to determine the type of the reference expression at the
    // point in the code. If the code flow analysis has nothing to say
    // about that expression, it return undefined.
    function getFlowTypeOfReference(
        reference: NameNode | MemberAccessNode,
        targetSymbolId: number,
        initialType: Type | undefined
    ): Type | undefined {
        // See if this execution scope requires code flow for this reference expression.
        const referenceKey = createKeyForReference(reference);
        const executionScope = ParseTreeUtils.getExecutionScopeNode(reference);
        const codeFlowExpressions = AnalyzerNodeInfo.getCodeFlowExpressions(executionScope);

        assert(codeFlowExpressions !== undefined);
        if (!codeFlowExpressions!.has(referenceKey)) {
            return undefined;
        }

        // Is there an code flow analyzer cached for this execution scope?
        const executionNode = ParseTreeUtils.getExecutionScopeNode(reference);
        let analyzer: CodeFlowAnalyzer | undefined;

        if (isNodeInReturnTypeInferenceContext(executionNode)) {
            // If we're performing the analysis within a temporary
            // context of a function for purposes of inferring its
            // return type for a specified set of arguments, use
            // a temporary analyzer that we'll use only for this context.
            analyzer = getCodeFlowAnalyzerForReturnTypeInferenceContext();
        } else {
            analyzer = codeFlowAnalyzerCache.get(executionNode.id);

            if (!analyzer) {
                // Allocate a new code flow analyzer.
                analyzer = createCodeFlowAnalyzer();
                codeFlowAnalyzerCache.set(executionNode.id, analyzer);
            }
        }

        const wasIncompleteTypeMode = incompleteTypeTracker.isIncompleteTypeMode();
        const codeFlowResult = analyzer.getTypeFromCodeFlow(reference, targetSymbolId, initialType);

        if (codeFlowResult.isIncomplete) {
            incompleteTypeTracker.enterIncompleteTypeMode();
        } else if (!wasIncompleteTypeMode) {
            incompleteTypeTracker.leaveIncompleteTypeMode();
        }

        return codeFlowResult.type;
    }

    // Creates a new code flow analyzer that can be used to narrow the types
    // of the expressions within an execution context. Each code flow analyzer
    // instance maintains a cache of types it has already determined.
    function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
        const flowNodeTypeCacheSet = new Map<string, TypeCache>();

        function getTypeFromCodeFlow(
            reference: NameNode | MemberAccessNode,
            targetSymbolId: number,
            initialType: Type | undefined
        ): FlowNodeTypeResult {
            const flowNode = AnalyzerNodeInfo.getFlowNode(reference);
            const referenceKey = createKeyForReference(reference) + `.${targetSymbolId.toString()}`;
            let flowNodeTypeCache = flowNodeTypeCacheSet.get(referenceKey);
            if (!flowNodeTypeCache) {
                flowNodeTypeCache = new Map<number, CachedType | undefined>();
                flowNodeTypeCacheSet.set(referenceKey, flowNodeTypeCache);
            }

            // Caches the type of the flow node in our local cache, keyed by the flow node ID.
            function setCacheEntry(
                flowNode: FlowNode,
                type: Type | undefined,
                isIncomplete: boolean
            ): FlowNodeTypeResult {
                if (!isIncomplete) {
                    flowIncompleteGeneration++;
                } else {
                    const prevEntry = flowNodeTypeCache!.get(flowNode.id);
                    if (prevEntry === undefined) {
                        flowIncompleteGeneration++;
                    } else if (type && (prevEntry as IncompleteType).isIncompleteType) {
                        const prevIncompleteType = prevEntry as IncompleteType;
                        if (prevIncompleteType.type && !isTypeSame(prevIncompleteType.type, type)) {
                            flowIncompleteGeneration++;
                        }
                    }
                }

                // For speculative or incomplete types, we'll create a separate
                // object. For non-speculative and complete types, we'll store
                // the type directly.
                const entry: CachedType | undefined = isIncomplete
                    ? {
                          isIncompleteType: true,
                          type,
                          incompleteSubtypes: [],
                          generationCount: flowIncompleteGeneration,
                      }
                    : type;

                flowNodeTypeCache!.set(flowNode.id, entry);
                speculativeTypeTracker.trackEntry(flowNodeTypeCache!, flowNode.id);

                return {
                    type,
                    isIncomplete,
                    generationCount: flowIncompleteGeneration,
                    incompleteSubtypes: isIncomplete ? [] : undefined,
                };
            }

            function setIncompleteSubtype(flowNode: FlowNode, index: number, type: Type | undefined) {
                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined || !isIncompleteType(cachedEntry)) {
                    fail('setIncompleteSubtype can be called only on a valid incomplete cache entry');
                }

                const incompleteEntries = cachedEntry.incompleteSubtypes;
                if (index < incompleteEntries.length) {
                    incompleteEntries[index] = type;
                } else {
                    assert(incompleteEntries.length === index);
                    incompleteEntries.push(type);
                }

                flowIncompleteGeneration++;

                return getCacheEntry(flowNode);
            }

            function deleteCacheEntry(flowNode: FlowNode) {
                flowNodeTypeCache!.delete(flowNode.id);
            }

            function getCacheEntry(flowNode: FlowNode): FlowNodeTypeResult | undefined {
                if (!flowNodeTypeCache!.has(flowNode.id)) {
                    return undefined;
                }

                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined) {
                    return {
                        type: cachedEntry,
                        isIncomplete: false,
                    };
                }

                if (!isIncompleteType(cachedEntry)) {
                    return {
                        type: cachedEntry,
                        isIncomplete: false,
                    };
                }

                let type = cachedEntry.type;

                if (cachedEntry.incompleteSubtypes.length > 0) {
                    // Recompute the effective type based on all of the incomplete
                    // types we've accumulated so far.
                    const typesToCombine: Type[] = [];
                    cachedEntry.incompleteSubtypes.forEach((t) => {
                        if (t) {
                            typesToCombine.push(t);
                        }
                    });
                    type = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;
                }

                return {
                    type,
                    isIncomplete: true,
                    incompleteSubtypes: cachedEntry.incompleteSubtypes,
                    generationCount: cachedEntry.generationCount,
                };
            }

            function evaluateAssignmentFlowNode(flowNode: FlowAssignment): Type | undefined {
                // For function and class nodes, the reference node is the name
                // node, but we need to use the parent node (the FunctionNode or ClassNode)
                // to access the decorated type in the type cache.
                let nodeForCacheLookup: ParseNode = flowNode.node;
                const parentNode = flowNode.node.parent;
                if (parentNode) {
                    if (parentNode.nodeType === ParseNodeType.Function || parentNode.nodeType === ParseNodeType.Class) {
                        nodeForCacheLookup = parentNode;
                    }
                }

                let cachedType = readTypeCache(nodeForCacheLookup);
                if (!cachedType) {
                    // There is no cached type for this expression, so we need to
                    // evaluate it.
                    evaluateTypesForStatement(flowNode.node);
                    cachedType = readTypeCache(nodeForCacheLookup);
                }

                return cachedType;
            }

            // If this flow has no knowledge of the target expression, it returns undefined.
            // If the start flow node for this scope is reachable, the typeAtStart value is
            // returned.
            function getTypeFromFlowNode(
                flowNode: FlowNode,
                reference: NameNode | MemberAccessNode,
                targetSymbolId: number,
                initialType: Type | undefined
            ): FlowNodeTypeResult {
                let curFlowNode = flowNode;

                // This is a frequently-called routine, so it's a good place to call
                // the cancellation check. If the operation is canceled, an exception
                // will be thrown at this point.
                checkForCancellation();

                while (true) {
                    // Have we already been here? If so, use the cached value.
                    const cachedEntry = getCacheEntry(curFlowNode);
                    if (cachedEntry) {
                        // If the cached entry is incomplete, we can use it only if nothing
                        // has changed that may cause the previously-reported incomplete type to change.
                        if (!cachedEntry.isIncomplete || cachedEntry.generationCount === flowIncompleteGeneration) {
                            return cachedEntry;
                        }
                    }

                    if (curFlowNode.flags & FlowFlags.Unreachable) {
                        // We can get here if there are nodes in a compound logical expression
                        // (e.g. "False and x") that are never executed but are evaluated.
                        // The type doesn't matter in this case.
                        return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                    }

                    if (curFlowNode.flags & FlowFlags.Call) {
                        const callFlowNode = curFlowNode as FlowCall;

                        // If this function returns a "NoReturn" type, that means
                        // it always raises an exception or otherwise doesn't return,
                        // so we can assume that the code before this is unreachable.
                        if (isCallNoReturn(callFlowNode.node)) {
                            return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                        }

                        curFlowNode = callFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.Assignment) {
                        const assignmentFlowNode = curFlowNode as FlowAssignment;
                        // Are we targeting the same symbol? We need to do this extra check because the same
                        // symbol name might refer to different symbols in different scopes (e.g. a list
                        // comprehension introduces a new scope).
                        if (
                            targetSymbolId === assignmentFlowNode.targetSymbolId &&
                            ParseTreeUtils.isMatchingExpression(reference, assignmentFlowNode.node)
                        ) {
                            // Is this a special "unbind" assignment? If so,
                            // we can handle it immediately without any further evaluation.
                            if (curFlowNode.flags & FlowFlags.Unbind) {
                                return setCacheEntry(curFlowNode, UnboundType.create(), /* isIncomplete */ false);
                            }

                            // If there was a cache entry already, that means we hit a recursive
                            // case (something like "int: int = 4"). Avoid infinite recursion
                            // by returning an undefined type.
                            if (cachedEntry) {
                                return { type: undefined, isIncomplete: true };
                            }

                            // Set the cache entry to undefined before evaluating the
                            // expression in case it depends on itself.
                            setCacheEntry(curFlowNode, undefined, /* isIncomplete */ true);
                            const flowType = evaluateAssignmentFlowNode(assignmentFlowNode);
                            return setCacheEntry(curFlowNode, flowType, /* isIncomplete */ false);
                        }

                        curFlowNode = assignmentFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
                        const aliasFlowNode = curFlowNode as FlowAssignmentAlias;

                        // If the target symbol ID matches, replace with its alias
                        // and continue to traverse the code flow graph.
                        if (targetSymbolId === aliasFlowNode.targetSymbolId) {
                            targetSymbolId = aliasFlowNode.aliasSymbolId;
                        }
                        curFlowNode = aliasFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.BranchLabel) {
                        const labelNode = curFlowNode as FlowLabel;
                        const typesToCombine: Type[] = [];

                        let sawIncomplete = false;

                        labelNode.antecedents.forEach((antecedent) => {
                            const flowTypeResult = getTypeFromFlowNode(
                                antecedent,
                                reference,
                                targetSymbolId,
                                initialType
                            );

                            if (flowTypeResult.isIncomplete) {
                                sawIncomplete = true;
                            }

                            if (flowTypeResult.type) {
                                typesToCombine.push(flowTypeResult.type);
                            }
                        });

                        const effectiveType = combineTypes(typesToCombine);
                        return setCacheEntry(curFlowNode, effectiveType, sawIncomplete);
                    }

                    if (curFlowNode.flags & FlowFlags.LoopLabel) {
                        const labelNode = curFlowNode as FlowLabel;

                        let firstWasIncomplete = false;
                        let isFirstTimeInLoop = false;

                        // See if we've been here before. If so, there will be an incomplete cache entry.
                        let cacheEntry = getCacheEntry(curFlowNode);
                        if (cacheEntry === undefined) {
                            // We haven't been here before, so create a new incomplete cache entry.
                            isFirstTimeInLoop = true;
                            cacheEntry = setCacheEntry(curFlowNode, undefined, /* isIncomplete */ true);
                        }

                        labelNode.antecedents.forEach((antecedent, index) => {
                            // Have we already been here? If so, there will be an entry
                            // for this index, and we can use the type that was already
                            // computed.
                            if (index >= cacheEntry!.incompleteSubtypes!.length) {
                                // Set the incomplete type for this index to undefined to prevent
                                // infinite recursion. We'll set it to the computed value below.
                                cacheEntry = setIncompleteSubtype(curFlowNode, index, undefined);
                                const flowTypeResult = getTypeFromFlowNode(
                                    antecedent,
                                    reference,
                                    targetSymbolId,
                                    initialType
                                );

                                if (flowTypeResult.isIncomplete && index === 0) {
                                    firstWasIncomplete = true;
                                }

                                cacheEntry = setIncompleteSubtype(curFlowNode, index, flowTypeResult.type);
                            }
                        });

                        if (!isFirstTimeInLoop) {
                            // This was not the first time through the loop, so we are recursively trying
                            // to resolve other parts of the incomplete type. It will be marked complete
                            // once the stack pops back up to the first caller.
                            return cacheEntry;
                        }

                        // The result is incomplete only if the first antecedent (the edge
                        // that feeds the loop) is incomplete.
                        if (firstWasIncomplete) {
                            deleteCacheEntry(curFlowNode);
                            return { type: cacheEntry!.type, isIncomplete: true };
                        }

                        // We have made it all the way through all the antecedents, and we can
                        // mark the type as complete.
                        return setCacheEntry(curFlowNode, cacheEntry!.type, /* isIncomplete */ false);
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;
                        const typeNarrowingCallback = getTypeNarrowingCallback(reference, conditionalFlowNode);
                        if (typeNarrowingCallback) {
                            const flowTypeResult = getTypeFromFlowNode(
                                conditionalFlowNode.antecedent,
                                reference,
                                targetSymbolId,
                                initialType
                            );
                            let flowType = flowTypeResult.type;
                            if (flowType) {
                                flowType = typeNarrowingCallback(flowType);
                            }

                            return setCacheEntry(curFlowNode, flowType, flowTypeResult.isIncomplete);
                        }

                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                        const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                        if (preFinallyFlowNode.isGateClosed) {
                            return { type: undefined, isIncomplete: false };
                        }
                        curFlowNode = preFinallyFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.PostFinally) {
                        const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                        const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
                        try {
                            postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                            const flowTypeResult = getTypeFromFlowNode(
                                postFinallyFlowNode.antecedent,
                                reference,
                                targetSymbolId,
                                initialType
                            );

                            // If the type is incomplete, don't write back to the cache.
                            return flowTypeResult.isIncomplete
                                ? flowTypeResult
                                : setCacheEntry(curFlowNode, flowTypeResult.type, /* isIncomplete */ false);
                        } finally {
                            postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                        }
                    }

                    if (curFlowNode.flags & FlowFlags.Start) {
                        return setCacheEntry(curFlowNode, initialType, /* isIncomplete */ false);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.value;
                            if (wildcardImportFlowNode.names.some((name) => name === nameValue)) {
                                const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                                return setCacheEntry(curFlowNode, type, /* isIncomplete */ false);
                            }
                        }

                        curFlowNode = wildcardImportFlowNode.antecedent;
                        continue;
                    }

                    // We shouldn't get here.
                    fail('Unexpected flow node flags');
                    return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                }
            }

            if (!flowNode) {
                // This should happen only in cases where we're evaluating
                // parse nodes that are created after the initial parse
                // (namely, string literals that are used for forward
                // referenced types).
                return {
                    type: initialType,
                    isIncomplete: false,
                };
            }

            return getTypeFromFlowNode(flowNode, reference, targetSymbolId, initialType);
        }

        return {
            getTypeFromCodeFlow,
        };
    }

    // Determines whether the specified flowNode can be reached by any
    // control flow path within the execution context. If sourceFlowNode
    // is specified, it returns true only if at least one control flow
    // path passes through sourceFlowNode.
    function isFlowNodeReachable(flowNode: FlowNode, sourceFlowNode?: FlowNode): boolean {
        const visitedFlowNodeMap = new Map<number, true>();

        function isFlowNodeReachableRecursive(flowNode: FlowNode, sourceFlowNode: FlowNode | undefined): boolean {
            let curFlowNode = flowNode;

            while (true) {
                // If we've already visited this node, we can assume
                // it wasn't reachable.
                if (visitedFlowNodeMap.has(curFlowNode.id)) {
                    return false;
                }

                // Note that we've been here before.
                visitedFlowNodeMap.set(curFlowNode.id, true);

                if (curFlowNode.flags & FlowFlags.Unreachable) {
                    return false;
                }

                if (curFlowNode === sourceFlowNode) {
                    return true;
                }

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If we're determining whether a specified source flow node is
                    // reachable, don't take into consideration possible "no return"
                    // calls.
                    if (sourceFlowNode === undefined) {
                        // If this function returns a "NoReturn" type, that means
                        // it always raises an exception or otherwise doesn't return,
                        // so we can assume that the code before this is unreachable.
                        if (isCallNoReturn(callFlowNode.node)) {
                            return false;
                        }
                    }

                    curFlowNode = callFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.Assignment) {
                    const assignmentFlowNode = curFlowNode as FlowAssignment;
                    curFlowNode = assignmentFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
                    const aliasFlowNode = curFlowNode as FlowAssignmentAlias;
                    curFlowNode = aliasFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    const labelNode = curFlowNode as FlowLabel;
                    for (const antecedent of labelNode.antecedents) {
                        if (isFlowNodeReachableRecursive(antecedent, sourceFlowNode)) {
                            return true;
                        }
                    }
                    return false;
                }

                if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                    const conditionalFlowNode = curFlowNode as FlowCondition;
                    curFlowNode = conditionalFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    if (preFinallyFlowNode.isGateClosed) {
                        return false;
                    }
                    curFlowNode = preFinallyFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;

                    try {
                        postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                        return isFlowNodeReachableRecursive(postFinallyFlowNode.antecedent, sourceFlowNode);
                    } finally {
                        postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                    }
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    // If we hit the start but were looking for a particular source flow
                    // node, return false. Otherwise, the start is what we're looking for.
                    return sourceFlowNode ? false : true;
                }

                if (curFlowNode.flags & FlowFlags.WildcardImport) {
                    const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                    curFlowNode = wildcardImportFlowNode.antecedent;
                    continue;
                }

                // We shouldn't get here.
                fail('Unexpected flow node flags');
                return false;
            }
        }

        // Protect against infinite recursion.
        if (isReachableRecursionMap.has(flowNode.id)) {
            return true;
        }
        isReachableRecursionMap.set(flowNode.id, true);

        try {
            return isFlowNodeReachableRecursive(flowNode, sourceFlowNode);
        } finally {
            isReachableRecursionMap.delete(flowNode.id);
        }
    }

    // Given a reference expression and a flow node, returns a callback that
    // can be used to narrow the type described by the target expression.
    // If the specified flow node is not associated with the target expression,
    // it returns undefined.
    function getTypeNarrowingCallback(
        reference: ExpressionNode,
        flowNode: FlowCondition
    ): TypeNarrowingCallback | undefined {
        let testExpression = flowNode.expression;
        const isPositiveTest = !!(flowNode.flags & FlowFlags.TrueCondition);

        if (testExpression.nodeType === ParseNodeType.AssignmentExpression) {
            if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                testExpression = testExpression.rightExpression;
            } else if (ParseTreeUtils.isMatchingExpression(reference, testExpression.name)) {
                testExpression = testExpression.name;
            }
        }

        if (testExpression.nodeType === ParseNodeType.BinaryOperation) {
            const isOrIsNotOperator =
                testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.IsNot;
            const equalsOrNotEqualsOperator =
                testExpression.operator === OperatorType.Equals || testExpression.operator === OperatorType.NotEquals;

            if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
                // Invert the "isPositiveTest" value if this is an "is not" operation.
                const adjIsPositiveTest =
                    testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.Equals
                        ? isPositiveTest
                        : !isPositiveTest;

                // Look for "X is None", "X is not None", "X == None", and "X != None".
                // These are commonly-used patterns used in control flow.
                if (
                    testExpression.rightExpression.nodeType === ParseNodeType.Constant &&
                    testExpression.rightExpression.constType === KeywordType.None
                ) {
                    // Allow the LHS to be either a simple expression or an assignment
                    // expression that assigns to a simple name.
                    let leftExpression = testExpression.leftExpression;
                    if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                        leftExpression = leftExpression.name;
                    }

                    if (ParseTreeUtils.isMatchingExpression(reference, leftExpression)) {
                        // Narrow the type by filtering on "None".
                        return (type: Type) => {
                            if (type.category === TypeCategory.Union) {
                                const remainingTypes = type.subtypes.filter((t) => {
                                    if (isAnyOrUnknown(t)) {
                                        // We need to assume that "Any" is always both None and not None,
                                        // so it matches regardless of whether the test is positive or negative.
                                        return true;
                                    }

                                    // See if it's a match for None.
                                    return isNone(t) === adjIsPositiveTest;
                                });

                                return combineTypes(remainingTypes);
                            } else if (isNone(type)) {
                                if (!adjIsPositiveTest) {
                                    // Use a "Never" type (which is a special form
                                    // of None) to indicate that the condition will
                                    // always evaluate to false.
                                    return NeverType.create();
                                }
                            }

                            return type;
                        };
                    }
                }

                // Look for "type(X) is Y" or "type(X) is not Y".
                if (isOrIsNotOperator && testExpression.leftExpression.nodeType === ParseNodeType.Call) {
                    const callType = getTypeOfExpression(testExpression.leftExpression.leftExpression).type;
                    if (
                        isClass(callType) &&
                        ClassType.isBuiltIn(callType, 'type') &&
                        testExpression.leftExpression.arguments.length === 1 &&
                        testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
                    ) {
                        const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
                        if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                            const classType = getTypeOfExpression(testExpression.rightExpression).type;
                            if (isClass(classType)) {
                                return (type: Type) => {
                                    // Narrow the type based on whether the type matches the specified type.
                                    return doForSubtypes(type, (subtype) => {
                                        if (isObject(subtype)) {
                                            const matches = ClassType.isSameGenericClass(subtype.classType, classType);
                                            if (adjIsPositiveTest) {
                                                return matches ? subtype : undefined;
                                            } else {
                                                return matches ? undefined : subtype;
                                            }
                                        } else if (isNone(subtype)) {
                                            return adjIsPositiveTest ? undefined : subtype;
                                        }

                                        return subtype;
                                    });
                                };
                            }
                        }
                    }
                }

                // Look for "X is Y" or "X is not Y" where Y is a an enum.
                if (isOrIsNotOperator) {
                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                        const rightType = getTypeOfExpression(testExpression.rightExpression).type;
                        if (
                            isObject(rightType) &&
                            ClassType.isEnumClass(rightType.classType) &&
                            rightType.classType.literalValue !== undefined
                        ) {
                            return (type: Type) => {
                                return narrowTypeForLiteralComparison(type, rightType, adjIsPositiveTest);
                            };
                        }
                    }
                }

                if (equalsOrNotEqualsOperator) {
                    // Look for X == <literal> or X != <literal>
                    const adjIsPositiveTest =
                        testExpression.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                        const rightType = getTypeOfExpression(testExpression.rightExpression).type;
                        if (isObject(rightType) && rightType.classType.literalValue !== undefined) {
                            return (type: Type) => {
                                return narrowTypeForLiteralComparison(type, rightType, adjIsPositiveTest);
                            };
                        }
                    }

                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                        const leftType = getTypeOfExpression(testExpression.leftExpression).type;
                        if (isObject(leftType) && leftType.classType.literalValue !== undefined) {
                            return (type: Type) => {
                                return narrowTypeForLiteralComparison(type, leftType, adjIsPositiveTest);
                            };
                        }
                    }

                    // Look for X.Y == <literal> or X.Y != <literal>
                    if (
                        testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                        ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression)
                    ) {
                        const rightType = getTypeOfExpression(testExpression.rightExpression).type;
                        const memberName = testExpression.leftExpression.memberName;
                        if (isObject(rightType) && rightType.classType.literalValue !== undefined) {
                            return (type: Type) => {
                                return narrowTypeForDiscriminatedFieldComparison(
                                    type,
                                    memberName.value,
                                    rightType,
                                    adjIsPositiveTest
                                );
                            };
                        }
                    }
                }
            }

            if (testExpression.operator === OperatorType.In && isPositiveTest) {
                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    const rightType = getTypeOfExpression(testExpression.rightExpression).type;
                    return (type: Type) => {
                        return narrowTypeForContains(type, rightType);
                    };
                }
            }
        }

        if (testExpression.nodeType === ParseNodeType.Call) {
            if (testExpression.leftExpression.nodeType === ParseNodeType.Name) {
                // Look for "isinstance(X, Y)" or "issubclass(X, Y)".
                if (
                    (testExpression.leftExpression.value === 'isinstance' ||
                        testExpression.leftExpression.value === 'issubclass') &&
                    testExpression.arguments.length === 2
                ) {
                    // Make sure the first parameter is a supported expression type
                    // and the second parameter is a valid class type or a tuple
                    // of valid class types.
                    const isInstanceCheck = testExpression.leftExpression.value === 'isinstance';
                    const arg0Expr = testExpression.arguments[0].valueExpression;
                    const arg1Expr = testExpression.arguments[1].valueExpression;
                    if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                        const arg1Type = getTypeOfExpression(
                            arg1Expr,
                            undefined,
                            EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.ParamSpecDisallowed
                        ).type;
                        const classTypeList = getIsInstanceClassTypes(arg1Type);
                        if (classTypeList) {
                            return (type: Type) => {
                                return narrowTypeForIsInstance(type, classTypeList, isInstanceCheck, isPositiveTest);
                            };
                        }
                    }
                } else if (
                    testExpression.leftExpression.value === 'callable' &&
                    testExpression.arguments.length === 1
                ) {
                    const arg0Expr = testExpression.arguments[0].valueExpression;
                    if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                        return (type: Type) => {
                            return narrowTypeForCallable(type, isPositiveTest, testExpression);
                        };
                    }
                }
            }
        }

        if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
            return (type: Type) => {
                // Narrow the type based on whether the subtype can be true or false.
                return doForSubtypes(type, (subtype) => {
                    if (isPositiveTest) {
                        if (canBeTruthy(subtype)) {
                            return removeFalsinessFromType(subtype);
                        }
                    } else {
                        if (canBeFalsy(subtype)) {
                            return removeTruthinessFromType(subtype);
                        }
                    }
                    return undefined;
                });
            };
        }

        return undefined;
    }

    // The "isinstance" and "issubclass" calls support two forms - a simple form
    // that accepts a single class, and a more complex form that accepts a tuple
    // of classes. This method determines which form and returns a list of classes
    // or undefined.
    function getIsInstanceClassTypes(argType: Type): ClassType[] | undefined {
        if (isClass(argType)) {
            return [argType];
        }

        if (isObject(argType)) {
            const objClass = argType.classType;
            if (ClassType.isBuiltIn(objClass, 'Tuple') && objClass.typeArguments) {
                let foundNonClassType = false;
                const classTypeList: ClassType[] = [];
                objClass.typeArguments.forEach((typeArg) => {
                    if (isClass(typeArg)) {
                        classTypeList.push(typeArg);
                    } else {
                        foundNonClassType = true;
                    }
                });

                if (!foundNonClassType) {
                    return classTypeList;
                }
            }
        }

        return undefined;
    }

    // Attempts to narrow a type (make it more constrained) based on a
    // call to isinstance or issubclass. For example, if the original
    // type of expression "x" is "Mammal" and the test expression is
    // "isinstance(x, Cow)", (assuming "Cow" is a subclass of "Mammal"),
    // we can conclude that x must be constrained to "Cow".
    function narrowTypeForIsInstance(
        type: Type,
        classTypeList: ClassType[],
        isInstanceCheck: boolean,
        isPositiveTest: boolean
    ): Type {
        let effectiveType = doForSubtypes(type, (subtype) => {
            return transformTypeObjectToClass(subtype);
        });

        // Handle bound TypeVar.
        effectiveType = makeTypeVarsConcrete(effectiveType);

        // Filters the varType by the parameters of the isinstance
        // and returns the list of types the varType could be after
        // applying the filter.
        const filterType = (varType: ClassType): ObjectType[] | ClassType[] => {
            const filteredTypes: ClassType[] = [];

            let foundSuperclass = false;
            let isClassRelationshipIndeterminate = false;

            for (const filterType of classTypeList) {
                const filterIsSuperclass = ClassType.isDerivedFrom(varType, filterType);
                const filterIsSubclass = ClassType.isDerivedFrom(filterType, varType);

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                // Normally, a type should never be both a subclass or a superclass.
                // This can happen if either of the class types derives from a
                // class whose type is unknown (e.g. an import failed). We'll
                // note this case specially so we don't do any narrowing, which
                // will generate false positives.
                if (filterIsSubclass && filterIsSuperclass && !ClassType.isSameGenericClass(varType, filterType)) {
                    isClassRelationshipIndeterminate = true;
                }

                if (isPositiveTest) {
                    if (filterIsSuperclass) {
                        // If the variable type is a subclass of the isinstance
                        // filter, we haven't learned anything new about the
                        // variable type.
                        filteredTypes.push(varType);
                    } else if (filterIsSubclass) {
                        // If the variable type is a superclass of the isinstance
                        // filter, we can narrow the type to the subclass.
                        filteredTypes.push(filterType);
                    }
                }
            }

            // In the negative case, if one or more of the filters
            // always match the type (i.e. they are an exact match or
            // a superclass of the type), then there's nothing left after
            // the filter is applied. If we didn't find any superclass
            // match, then the original variable type survives the filter.
            if (!isPositiveTest) {
                if (!foundSuperclass || isClassRelationshipIndeterminate) {
                    filteredTypes.push(varType);
                }
            }

            if (!isInstanceCheck) {
                return filteredTypes;
            }

            return filteredTypes.map((t) => ObjectType.create(t));
        };

        if (isInstanceCheck && isObject(effectiveType)) {
            const filteredType = filterType(effectiveType.classType);
            return combineTypes(filteredType);
        } else if (!isInstanceCheck && isClass(effectiveType)) {
            const filteredType = filterType(effectiveType);
            return combineTypes(filteredType);
        } else if (effectiveType.category === TypeCategory.Union) {
            let remainingTypes: Type[] = [];

            effectiveType.subtypes.forEach((t) => {
                if (isAnyOrUnknown(t)) {
                    // Any types always remain for both positive and negative
                    // checks because we can't say anything about them.
                    remainingTypes.push(t);
                } else if (isInstanceCheck && isObject(t)) {
                    remainingTypes = remainingTypes.concat(filterType(t.classType));
                } else if (!isInstanceCheck && isClass(t)) {
                    remainingTypes = remainingTypes.concat(filterType(t));
                } else {
                    // All other types are never instances of a class.
                    if (!isPositiveTest) {
                        remainingTypes.push(t);
                    }
                }
            });

            return combineTypes(remainingTypes);
        } else if (isInstanceCheck && isPositiveTest && isAnyOrUnknown(effectiveType)) {
            // If this is a positive test for isinstance and the effective
            // type is Any or Unknown, we can assume that the type matches
            // one of the specified types.
            type = combineTypes(classTypeList.map((classType) => ObjectType.create(classType)));
        }

        // Return the original type.
        return type;
    }

    // Attempts to narrow a type (make it more constrained) based on an "in" or
    // "not in" binary expression.
    function narrowTypeForContains(referenceType: Type, containerType: Type) {
        // We support contains narrowing only for certain built-in types that have been specialized.
        if (!isObject(containerType) || !ClassType.isBuiltIn(containerType.classType)) {
            return referenceType;
        }
        const classType = containerType.classType;
        const builtInName = classType.details.aliasClass
            ? classType.details.aliasClass.details.name
            : classType.details.name;

        if (!['list', 'set', 'frozenset', 'deque'].some((name) => name === builtInName)) {
            return referenceType;
        }

        if (!classType.typeArguments || classType.typeArguments.length !== 1) {
            return referenceType;
        }

        const typeArg = classType.typeArguments[0];
        let canNarrow = true;

        const narrowedType = doForSubtypes(referenceType, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                canNarrow = false;
                return subtype;
            }

            if (!canAssignType(typeArg, subtype, new DiagnosticAddendum())) {
                // If the reference type isn't assignable to the element type, we will
                // assume that the __contains__ method will return false.
                return undefined;
            }

            return subtype;
        });

        return canNarrow ? narrowedType : referenceType;
    }

    // Attempts to narrow a type (make it more constrained) based on a comparison
    // (equal or not equal) between a discriminating node that has a declared
    // literal type to a literal value.
    function narrowTypeForDiscriminatedFieldComparison(
        referenceType: Type,
        memberName: string,
        literalType: ObjectType,
        isPositiveTest: boolean
    ): Type {
        let canNarrow = true;

        const narrowedType = doForSubtypes(referenceType, (subtype) => {
            subtype = transformTypeObjectToClass(subtype);

            let memberInfo: ClassMember | undefined;
            if (isObject(subtype)) {
                memberInfo = lookUpObjectMember(subtype, memberName);
            } else if (isClass(subtype)) {
                memberInfo = lookUpClassMember(subtype, memberName);
            }

            if (memberInfo && memberInfo.isTypeDeclared) {
                const memberType = getTypeOfMember(memberInfo);

                if (isLiteralType(memberType, /* allowLiteralUnions */ false)) {
                    const isAssignable = canAssignType(memberType, literalType, new DiagnosticAddendum());
                    return isAssignable === isPositiveTest ? subtype : undefined;
                }
            }

            canNarrow = false;
            return subtype;
        });

        return canNarrow ? narrowedType : referenceType;
    }

    // Attempts to narrow a type (make it more constrained) based on a comparison
    // (equal or not equal) to a literal value.
    function narrowTypeForLiteralComparison(
        referenceType: Type,
        literalType: ObjectType,
        isPositiveTest: boolean
    ): Type {
        let canNarrow = true;
        const narrowedType = doForSubtypes(referenceType, (subtype) => {
            if (isObject(subtype) && ClassType.isSameGenericClass(literalType.classType, subtype.classType)) {
                if (subtype.classType.literalValue !== undefined) {
                    const literalValueMatches = ClassType.isLiteralValueSame(subtype.classType, literalType.classType);
                    if ((literalValueMatches && !isPositiveTest) || (!literalValueMatches && isPositiveTest)) {
                        return undefined;
                    }
                    return subtype;
                } else if (isPositiveTest) {
                    return literalType;
                } else {
                    // If we're able to enumerate all possible literal values
                    // (for bool or enum), we can eliminate all others in a negative test.
                    const allLiteralTypes = enumerateLiteralsForType(subtype);
                    if (allLiteralTypes) {
                        return combineTypes(
                            allLiteralTypes.filter(
                                (type) => !ClassType.isLiteralValueSame(type.classType, literalType.classType)
                            )
                        );
                    }
                }
            }
            canNarrow = false;
            return subtype;
        });

        return canNarrow ? narrowedType : referenceType;
    }

    // Attempts to narrow a type (make it more constrained) based on a
    // call to "callable". For example, if the original type of expression "x" is
    // Union[Callable[..., Any], Type[int], int], it would remove the "int" because
    // it's not callable.
    function narrowTypeForCallable(type: Type, isPositiveTest: boolean, errorNode: ExpressionNode): Type {
        return doForSubtypes(type, (subtype) => {
            switch (subtype.category) {
                case TypeCategory.Function:
                case TypeCategory.OverloadedFunction:
                case TypeCategory.Class: {
                    return isPositiveTest ? subtype : undefined;
                }

                case TypeCategory.Module: {
                    return isPositiveTest ? undefined : subtype;
                }

                case TypeCategory.Object: {
                    const classFromTypeObject = getClassFromPotentialTypeObject(subtype);
                    if (classFromTypeObject && isClass(classFromTypeObject)) {
                        // It's a Type object, which is a class.
                        return isPositiveTest ? subtype : undefined;
                    }

                    // See if the object is callable.
                    const callMemberType = getTypeFromObjectMember(
                        errorNode,
                        subtype,
                        '__call__',
                        { method: 'get' },
                        new DiagnosticAddendum(),
                        MemberAccessFlags.SkipForMethodLookup
                    );
                    if (!callMemberType) {
                        return isPositiveTest ? undefined : subtype;
                    } else {
                        return isPositiveTest ? subtype : undefined;
                    }
                }

                default: {
                    // For all other types, we can't determine whether it's
                    // callable or not, so we can't eliminate them.
                    return subtype;
                }
            }
        });
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    function createSpecializedClassType(
        classType: ClassType,
        typeArgs: TypeResult[] | undefined,
        flags: EvaluatorFlags,
        errorNode: ParseNode
    ): Type {
        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (ClassType.isSpecialBuiltIn(classType)) {
            switch (classType.details.name) {
                case 'Callable': {
                    return createCallableType(typeArgs);
                }

                case 'Optional': {
                    return createOptionalType(errorNode, typeArgs);
                }

                case 'Type': {
                    return createSpecialType(classType, typeArgs, 1);
                }

                case 'ClassVar': {
                    return createClassVarType(errorNode, typeArgs);
                }

                case 'Deque':
                case 'List':
                case 'FrozenSet':
                case 'Set': {
                    return createSpecialType(classType, typeArgs, 1);
                }

                case 'ChainMap':
                case 'Dict':
                case 'DefaultDict': {
                    return createSpecialType(classType, typeArgs, 2);
                }

                case 'Protocol': {
                    return createSpecialType(classType, typeArgs, undefined);
                }

                case 'Tuple': {
                    return createSpecialType(classType, typeArgs, undefined);
                }

                case 'Union': {
                    return createUnionType(typeArgs);
                }

                case 'Generic': {
                    return createGenericType(errorNode, classType, typeArgs);
                }

                case 'Final': {
                    return createFinalType(errorNode, typeArgs, flags);
                }

                case 'Annotated': {
                    return createAnnotatedType(errorNode, typeArgs);
                }

                case 'Concatenate': {
                    return createConcatenateType(errorNode, classType, typeArgs);
                }
            }
        }

        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        const typeParameters = ClassType.getTypeParameters(classType);

        // If there are no type parameters or args, the class is already specialized.
        // No need to do any more work.
        if (typeParameters.length === 0 && typeArgCount === 0) {
            return classType;
        }

        if (typeArgs && typeArgCount > typeParameters.length) {
            if (!ClassType.isPartiallyConstructed(classType)) {
                const fileInfo = getFileInfo(errorNode);
                if (typeParameters.length === 0) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeArgsExpectingNone(),
                        typeArgs[typeParameters.length].node
                    );
                } else {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeArgsTooMany().format({
                            expected: typeParameters.length,
                            received: typeArgCount,
                        }),
                        typeArgs[typeParameters.length].node
                    );
                }
            }
            typeArgCount = typeParameters.length;
        }

        if (typeArgs) {
            typeArgs.forEach((typeArg) => {
                // Verify that we didn't receive any inappropriate ellipses or modules.
                if (isEllipsisType(typeArg.type)) {
                    addError(Localizer.Diagnostic.ellipsisContext(), typeArg.node);
                } else if (isModule(typeArg.type)) {
                    addError(Localizer.Diagnostic.moduleContext(), typeArg.node);
                }
            });
        }

        // Fill in any missing type arguments with Any.
        const typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];
        const typeParams = ClassType.getTypeParameters(classType);
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(getConcreteTypeFromTypeVar(typeParams[i]));
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
                    const fileInfo = getFileInfo(typeArgs![index].node);
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeVarAssignmentMismatch().format({
                            type: printType(typeArgType),
                            name: typeParameters[index].details.name,
                        }) + diag.getString(),
                        typeArgs![index].node
                    );
                }
            }
        });

        const specializedClass = ClassType.cloneForSpecialization(classType, typeArgTypes, typeArgs !== undefined);

        return specializedClass;
    }

    function getTypeForArgument(arg: FunctionArgument): Type {
        if (arg.type) {
            return arg.type;
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeOfExpression(arg.valueExpression!).type;
    }

    // This function is like getTypeForArgument except that it is
    // used in cases where the argument is expected to be a type
    // and therefore follows the normal rules of types (e.g. they
    // can be forward-declared in stubs, etc.).
    function getTypeForArgumentExpectingType(
        arg: FunctionArgument,
        fileInfo: AnalyzerFileInfo,
        allowMissingTypeArgs = false
    ): Type {
        if (arg.type) {
            return arg.type;
        }

        let flags =
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.ParamSpecDisallowed;

        if (fileInfo.isStubFile) {
            flags |= EvaluatorFlags.AllowForwardReferences;
        }

        if (allowMissingTypeArgs) {
            flags |= EvaluatorFlags.AllowMissingTypeArgs;
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeOfExpression(arg.valueExpression!, undefined, flags).type;
    }

    function getBuiltInType(node: ParseNode, name: string): Type {
        const scope = ScopeUtils.getScopeForNode(node);
        if (scope) {
            const builtInScope = ScopeUtils.getBuiltInScope(scope);
            const nameType = builtInScope.lookUpSymbol(name);
            if (nameType) {
                return getEffectiveTypeOfSymbol(nameType);
            }
        }

        return UnknownType.create();
    }

    function getBuiltInObject(node: ParseNode, name: string, typeArguments?: Type[]) {
        const nameType = getBuiltInType(node, name);
        if (isClass(nameType)) {
            let classType = nameType;
            if (typeArguments) {
                classType = ClassType.cloneForSpecialization(
                    classType,
                    typeArguments,
                    /* isTypeArgumentExplicit */ false
                );
            }

            return ObjectType.create(classType);
        }

        return nameType;
    }

    function lookUpSymbolRecursive(node: ParseNode, name: string, honorCodeFlow: boolean) {
        const scope = ScopeUtils.getScopeForNode(node);
        let symbolWithScope = scope?.lookUpSymbolRecursive(name);

        if (symbolWithScope && honorCodeFlow) {
            // Filter the declarations based on flow reachability.
            const decls = symbolWithScope.symbol.getDeclarations().filter((decl) => {
                if (decl.type !== DeclarationType.Alias) {
                    // Is the declaration in the same execution scope as the "usageNode" node?
                    const usageScope = ParseTreeUtils.getExecutionScopeNode(node);
                    const declNode =
                        decl.type === DeclarationType.Class || decl.type === DeclarationType.Function
                            ? decl.node.name
                            : decl.node;
                    const declScope = ParseTreeUtils.getExecutionScopeNode(declNode);
                    if (usageScope === declScope) {
                        if (!isFlowPathBetweenNodes(declNode, node)) {
                            return false;
                        }
                    }
                }

                return true;
            });

            // If none of the declarations are reachable from the current node,
            // search for the symbol in outer scopes.
            if (decls.length === 0) {
                if (symbolWithScope.scope.parent) {
                    symbolWithScope = symbolWithScope.scope.parent.lookUpSymbolRecursive(name);
                } else {
                    symbolWithScope = undefined;
                }
            }
        }

        return symbolWithScope;
    }

    // Disables recording of errors and warnings.
    function suppressDiagnostics(callback: () => void) {
        const wasSuppressed = isDiagnosticSuppressed;
        isDiagnosticSuppressed = true;
        try {
            callback();
        } finally {
            isDiagnosticSuppressed = wasSuppressed;
        }
    }

    // Disables recording of errors and warnings and disables
    // any caching of types, under the assumption that we're
    // performing speculative evaluations.
    function useSpeculativeMode(speculativeNode: ParseNode, callback: () => void) {
        speculativeTypeTracker.enterSpeculativeContext(speculativeNode);

        try {
            callback();
        } finally {
            speculativeTypeTracker.leaveSpeculativeContext();
        }
    }

    // Determines whether the specified node is within a part of the parse tree that
    // is being "speculatively" evaluated. If so, it should not be written to the type
    // cache, and diagnostics should not be reported for it.
    function isSpeculativeMode(node: ParseNode | undefined) {
        const speculativeRootNode = speculativeTypeTracker.getSpeculativeRootNode();
        if (!speculativeRootNode) {
            return false;
        }
        return node === undefined || ParseTreeUtils.isNodeContainedWithin(node, speculativeRootNode);
    }

    function disableSpeculativeMode(callback: () => void) {
        const stack = speculativeTypeTracker.disableSpeculativeMode();
        try {
            callback();
        } finally {
            speculativeTypeTracker.enableSpeculativeMode(stack);
        }
    }

    function getFileInfo(node: ParseNode): AnalyzerFileInfo {
        while (node.nodeType !== ParseNodeType.Module) {
            node = node.parent!;
        }
        return AnalyzerNodeInfo.getFileInfo(node)!;
    }

    function getDeclarationFromFunctionNamedParameter(type: FunctionType, paramName: string): Declaration | undefined {
        if (type.category === TypeCategory.Function) {
            if (type.details.declaration) {
                const functionDecl = type.details.declaration;
                if (functionDecl.type === DeclarationType.Function) {
                    const functionNode = functionDecl.node;
                    const functionScope = AnalyzerNodeInfo.getScope(functionNode);
                    if (functionScope) {
                        const paramSymbol = functionScope.lookUpSymbol(paramName)!;
                        if (paramSymbol) {
                            return paramSymbol
                                .getDeclarations()
                                .find((decl) => decl.type === DeclarationType.Parameter);
                        }
                    }
                }
            }
        }

        return undefined;
    }

    function getDeclarationsForNameNode(node: NameNode): Declaration[] | undefined {
        if (AnalyzerNodeInfo.isCodeUnreachable(node)) {
            return undefined;
        }

        const declarations: Declaration[] = [];

        // If the node is part of a "from X import Y as Z" statement and the node
        // is the "Y" (non-aliased) name, we need to look up the alias symbol
        // since the non-aliased name is not in the symbol table.
        if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFromAs &&
            node.parent.alias &&
            node === node.parent.name
        ) {
            const scope = ScopeUtils.getScopeForNode(node);
            if (scope) {
                // Look up the alias symbol.
                const symbolInScope = scope.lookUpSymbolRecursive(node.parent.alias.value);
                if (symbolInScope) {
                    // The alias could have more decls that don't refer to this import. Filter
                    // out the one(s) that specifically associated with this import statement.
                    const declsForThisImport = symbolInScope.symbol.getDeclarations().filter((decl) => {
                        return decl.type === DeclarationType.Alias && decl.node === node.parent;
                    });

                    // Make a shallow copy and clear the "usesLocalName" field.
                    const nonLocalDecls = declsForThisImport.map((localDecl) => {
                        if (localDecl.type === DeclarationType.Alias) {
                            const nonLocalDecl: AliasDeclaration = { ...localDecl };
                            nonLocalDecl.usesLocalName = false;
                            return nonLocalDecl;
                        }
                        return localDecl;
                    });

                    declarations.push(...nonLocalDecls);
                }
            }
        } else if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.MemberAccess &&
            node === node.parent.memberName
        ) {
            let baseType = getType(node.parent.leftExpression);
            if (baseType) {
                baseType = specializeType(baseType, /* typeVarMap */ undefined);
                const memberName = node.parent.memberName.value;
                doForSubtypes(baseType, (subtype) => {
                    let symbol: Symbol | undefined;

                    if (isClass(subtype)) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpClassMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpClassMember(subtype, memberName);
                        }
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (isObject(subtype)) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpObjectMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpObjectMember(subtype, memberName);
                        }
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (isModule(subtype)) {
                        symbol = ModuleType.getField(subtype, memberName);
                    }

                    if (symbol) {
                        // By default, report only the declarations that have type annotations.
                        // If there are none, then report all of the unannotated declarations,
                        // which includes every assignment of that symbol.
                        const typedDecls = symbol.getTypedDeclarations();
                        if (typedDecls.length > 0) {
                            declarations.push(...typedDecls);
                        } else {
                            declarations.push(...symbol.getDeclarations());
                        }
                    }

                    return subtype;
                });
            }
        } else if (node.parent && node.parent.nodeType === ParseNodeType.ModuleName) {
            const namePartIndex = node.parent.nameParts.findIndex((part) => part === node);
            const importInfo = AnalyzerNodeInfo.getImportInfo(node.parent);
            if (
                namePartIndex >= 0 &&
                importInfo &&
                !importInfo.isNativeLib &&
                namePartIndex < importInfo.resolvedPaths.length
            ) {
                if (importInfo.resolvedPaths[namePartIndex]) {
                    evaluateTypesForStatement(node);

                    // Synthesize an alias declaration for this name part. The only
                    // time this case is used is for the hover provider.
                    const aliasDeclaration: AliasDeclaration = {
                        type: DeclarationType.Alias,
                        node: undefined!,
                        path: importInfo.resolvedPaths[namePartIndex],
                        range: getEmptyRange(),
                        implicitImports: new Map<string, ModuleLoaderActions>(),
                        usesLocalName: false,
                        moduleName: '',
                    };
                    declarations.push(aliasDeclaration);
                }
            }
        } else if (node.parent && node.parent.nodeType === ParseNodeType.Argument && node === node.parent.name) {
            // The target node is the name in a named argument. We need to determine whether
            // the corresponding named parameter can be determined from the context.
            const argNode = node.parent;
            const paramName = node.value;
            if (argNode.parent && argNode.parent.nodeType === ParseNodeType.Call) {
                const baseType = getType(argNode.parent.leftExpression);

                if (baseType) {
                    if (baseType.category === TypeCategory.Function && baseType.details.declaration) {
                        const paramDecl = getDeclarationFromFunctionNamedParameter(baseType, paramName);
                        if (paramDecl) {
                            declarations.push(paramDecl);
                        }
                    } else if (isClass(baseType)) {
                        const initMethodType = getTypeFromObjectMember(
                            argNode.parent.leftExpression,
                            ObjectType.create(baseType),
                            '__init__',
                            { method: 'get' },
                            new DiagnosticAddendum(),
                            MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass
                        );

                        if (initMethodType && initMethodType.category === TypeCategory.Function) {
                            const paramDecl = getDeclarationFromFunctionNamedParameter(initMethodType, paramName);
                            if (paramDecl) {
                                declarations.push(paramDecl);
                            } else if (ClassType.isDataClass(baseType)) {
                                const lookupResults = lookUpClassMember(baseType, paramName);
                                if (lookupResults) {
                                    declarations.push(...lookupResults.symbol.getDeclarations());
                                }
                            }
                        }
                    }
                }
            }
        } else {
            let allowForwardReferences = false;

            // Determine if this node is within a quoted type annotation.
            if (ParseTreeUtils.isWithinTypeAnnotation(node, !isAnnotationEvaluationPostponed(getFileInfo(node)))) {
                allowForwardReferences = true;
            }

            const symbolWithScope = lookUpSymbolRecursive(node, node.value, !allowForwardReferences);
            if (symbolWithScope) {
                declarations.push(...symbolWithScope.symbol.getDeclarations());
            }
        }

        return declarations;
    }

    function getTypeForDeclaration(declaration: Declaration): Type | undefined {
        switch (declaration.type) {
            case DeclarationType.Intrinsic: {
                if (declaration.intrinsicType === 'Any') {
                    return AnyType.create();
                }

                if (declaration.intrinsicType === 'class') {
                    const classNode = ParseTreeUtils.getEnclosingClass(declaration.node) as ClassNode;
                    const classTypeInfo = getTypeOfClass(classNode);
                    return classTypeInfo ? classTypeInfo.classType : undefined;
                }

                const strType = getBuiltInObject(declaration.node, 'str');
                const intType = getBuiltInObject(declaration.node, 'int');
                if (isObject(intType) && isObject(strType)) {
                    if (declaration.intrinsicType === 'str') {
                        return strType;
                    }

                    if (declaration.intrinsicType === 'int') {
                        return intType;
                    }

                    if (declaration.intrinsicType === 'Iterable[str]') {
                        const iterableType = getBuiltInType(declaration.node, 'Iterable');
                        if (isClass(iterableType)) {
                            return ObjectType.create(
                                ClassType.cloneForSpecialization(
                                    iterableType,
                                    [strType],
                                    /* isTypeArgumentExplicit */ false
                                )
                            );
                        }
                    }

                    if (declaration.intrinsicType === 'Dict[str, Any]') {
                        const dictType = getBuiltInType(declaration.node, 'Dict');
                        if (isClass(dictType)) {
                            return ObjectType.create(
                                ClassType.cloneForSpecialization(
                                    dictType,
                                    [strType, AnyType.create()],
                                    /* isTypeArgumentExplicit */ false
                                )
                            );
                        }
                    }
                }

                return UnknownType.create();
            }

            case DeclarationType.Class: {
                const classTypeInfo = getTypeOfClass(declaration.node);
                return classTypeInfo ? classTypeInfo.decoratedType : undefined;
            }

            case DeclarationType.SpecialBuiltInClass: {
                return getTypeOfAnnotation(declaration.node.typeAnnotation);
            }

            case DeclarationType.Function: {
                const functionTypeInfo = getTypeOfFunction(declaration.node);
                return functionTypeInfo ? functionTypeInfo.decoratedType : undefined;
            }

            case DeclarationType.Parameter: {
                let typeAnnotationNode = declaration.node.typeAnnotation;

                // If there wasn't an annotation, see if the parent function
                // has a function-level annotation comment that provides
                // this parameter's annotation type.
                if (!typeAnnotationNode) {
                    if (declaration.node.parent?.nodeType === ParseNodeType.Function) {
                        const functionNode = declaration.node.parent;
                        if (
                            functionNode.functionAnnotationComment &&
                            !functionNode.functionAnnotationComment.isParamListEllipsis
                        ) {
                            const paramIndex = functionNode.parameters.findIndex((param) => param === declaration.node);
                            typeAnnotationNode = getTypeAnnotationForParameter(functionNode, paramIndex);
                        }
                    }
                }

                if (typeAnnotationNode) {
                    const declaredType = getTypeOfAnnotation(
                        typeAnnotationNode,
                        /* allowFinal */ false,
                        /* associateTypeVarsWithScope */ true
                    );
                    return transformVariadicParamType(declaration.node, declaration.node.category, declaredType);
                }

                return undefined;
            }

            case DeclarationType.Variable: {
                const typeAnnotationNode = declaration.typeAnnotationNode;

                if (typeAnnotationNode) {
                    const typeAliasNode = isDeclaredTypeAlias(typeAnnotationNode)
                        ? ParseTreeUtils.getTypeAnnotationNode(typeAnnotationNode)
                        : undefined;
                    let declaredType = getTypeOfAnnotation(typeAnnotationNode);
                    if (declaredType) {
                        // Apply enum transform if appropriate.
                        if (declaration.node.nodeType === ParseNodeType.Name) {
                            declaredType = transformTypeForPossibleEnumClass(declaration.node, declaredType);
                        }

                        if (typeAliasNode && typeAliasNode.valueExpression.nodeType === ParseNodeType.Name) {
                            declaredType = transformTypeForTypeAlias(declaredType, typeAliasNode.valueExpression);
                        }

                        return declaredType;
                    }
                }

                return undefined;
            }

            case DeclarationType.Alias: {
                return undefined;
            }
        }
    }

    function getInferredTypeOfDeclaration(decl: Declaration): Type | undefined {
        const resolvedDecl = resolveAliasDeclaration(decl, /* resolveLocalNames */ true);

        // We couldn't resolve the alias. Substitute an unknown
        // type in this case.
        if (!resolvedDecl) {
            return UnknownType.create();
        }

        function applyLoaderActionsToModuleType(
            moduleType: ModuleType,
            loaderActions: ModuleLoaderActions,
            importLookup: ImportLookup
        ): Type {
            if (loaderActions.path) {
                const lookupResults = importLookup(loaderActions.path);
                if (lookupResults) {
                    moduleType.fields = lookupResults.symbolTable;
                    moduleType.docString = lookupResults.docString;
                } else {
                    return UnknownType.create();
                }
            }

            if (loaderActions.implicitImports) {
                loaderActions.implicitImports.forEach((implicitImport, name) => {
                    // Recursively apply loader actions.
                    const moduleName = moduleType.moduleName ? moduleType.moduleName + '.' + name : '';
                    const importedModuleType = ModuleType.create(moduleName);
                    const symbolType = applyLoaderActionsToModuleType(importedModuleType, implicitImport, importLookup);

                    const importedModuleSymbol = Symbol.createWithType(SymbolFlags.None, symbolType);
                    moduleType.loaderFields.set(name, importedModuleSymbol);
                });
            }

            return moduleType;
        }

        // If the resolved declaration is still an alias, the alias
        // is pointing at a module, and we need to synthesize a
        // module type.
        if (resolvedDecl.type === DeclarationType.Alias) {
            // Build a module type that corresponds to the declaration and
            // its associated loader actions.
            const moduleType = ModuleType.create(resolvedDecl.moduleName);
            if (resolvedDecl.symbolName) {
                if (resolvedDecl.submoduleFallback) {
                    return applyLoaderActionsToModuleType(
                        moduleType,
                        resolvedDecl.symbolName && resolvedDecl.submoduleFallback
                            ? resolvedDecl.submoduleFallback
                            : resolvedDecl,
                        importLookup
                    );
                }
            } else {
                return applyLoaderActionsToModuleType(moduleType, resolvedDecl, importLookup);
            }
        }

        const declaredType = getTypeForDeclaration(resolvedDecl);
        if (declaredType) {
            return declaredType;
        }

        // If the resolved declaration had no defined type, use the
        // inferred type for this node.
        if (resolvedDecl.type === DeclarationType.Parameter) {
            const cachedValue = readTypeCache(resolvedDecl.node.name!);
            if (cachedValue) {
                return cachedValue;
            }
            evaluateTypeOfParameter(resolvedDecl.node);
            return readTypeCache(resolvedDecl.node.name!);
        }

        if (resolvedDecl.type === DeclarationType.Variable && resolvedDecl.inferredTypeSource) {
            let inferredType = readTypeCache(resolvedDecl.node);

            if (!inferredType) {
                // If this is a type alias, evaluate types for the entire assignment
                // statement rather than just the RHS of the assignment.
                const typeSource =
                    resolvedDecl.typeAliasName && resolvedDecl.inferredTypeSource.parent
                        ? resolvedDecl.inferredTypeSource.parent
                        : resolvedDecl.inferredTypeSource;
                evaluateTypesForStatement(typeSource);
                inferredType = readTypeCache(resolvedDecl.node);
            }

            if (inferredType && resolvedDecl.node.nodeType === ParseNodeType.Name) {
                inferredType = transformTypeForPossibleEnumClass(resolvedDecl.node, inferredType);
            }

            if (inferredType && resolvedDecl.typeAliasName) {
                inferredType = transformTypeForTypeAlias(inferredType, resolvedDecl.typeAliasName);
            }

            return inferredType;
        }

        return undefined;
    }

    // If the specified declaration is an alias declaration that points to a symbol,
    // it resolves the alias and looks up the symbol, then returns the first declaration
    // associated with that symbol. It does this recursively if necessary. If a symbol
    // lookup fails, undefined is returned. If resolveLocalNames is true, the method
    // resolves aliases through local renames ("as" clauses found in import statements).
    function resolveAliasDeclaration(declaration: Declaration, resolveLocalNames: boolean): Declaration | undefined {
        return DeclarationUtils.resolveAliasDeclaration(importLookup, declaration, resolveLocalNames);
    }

    // Returns the type of the symbol. If the type is explicitly declared, that type
    // is returned. If not, the type is inferred from assignments to the symbol. All
    // assigned types are evaluated and combined into a union. If a "usageNode"
    // node is specified, only declarations that are outside of the current execution
    // scope or that are reachable (as determined by code flow analysis) are considered.
    // This helps in cases where there are cyclical dependencies between symbols.
    function getEffectiveTypeOfSymbol(symbol: Symbol): Type {
        return getEffectiveTypeOfSymbolForUsage(symbol).type;
    }

    function getEffectiveTypeOfSymbolForUsage(symbol: Symbol, usageNode?: NameNode): EffectiveTypeResult {
        // If there's a declared type, it takes precedence over inferred types.
        if (symbol.hasTypedDeclarations()) {
            return {
                type: getDeclaredTypeOfSymbol(symbol) || UnknownType.create(),
                isResolutionCyclical: false,
            };
        }

        // Infer the type.
        const typesToCombine: Type[] = [];
        const isPrivate = symbol.isPrivateMember();
        const decls = symbol.getDeclarations();
        const isFinalVar = isFinalVariable(symbol);
        let isResolutionCyclical = false;

        decls.forEach((decl) => {
            let considerDecl = true;
            if (usageNode !== undefined) {
                if (decl.type !== DeclarationType.Alias) {
                    // Is the declaration in the same execution scope as the "usageNode" node?
                    const usageScope = ParseTreeUtils.getExecutionScopeNode(usageNode);
                    const declScope = ParseTreeUtils.getExecutionScopeNode(decl.node);
                    if (usageScope === declScope) {
                        if (!isFlowPathBetweenNodes(decl.node, usageNode)) {
                            considerDecl = false;
                        }
                    }
                }
            }

            if (considerDecl) {
                const isTypeAlias = isExplicitTypeAliasDeclaration(decl) || isPossibleTypeAliasDeclaration(decl);

                // If this is a type alias, evaluate it outside of the recursive symbol
                // resolution check so we can evaluate the full assignment statement.
                if (
                    isTypeAlias &&
                    decl.type === DeclarationType.Variable &&
                    decl.inferredTypeSource?.parent?.nodeType === ParseNodeType.Assignment
                ) {
                    evaluateTypesForAssignmentStatement(decl.inferredTypeSource.parent);

                    if (decl.typeAliasAnnotation) {
                        // Mark "TypeAlias" declaration as accessed.
                        getTypeOfExpression(decl.typeAliasAnnotation);
                    }
                }

                if (pushSymbolResolution(symbol, decl)) {
                    try {
                        let type = getInferredTypeOfDeclaration(decl);

                        if (popSymbolResolution(symbol)) {
                            isResolutionCyclical = true;
                        }

                        if (type) {
                            const isConstant = decl.type === DeclarationType.Variable && !!decl.isConstant;
                            type = stripLiteralTypeArgsValue(type);

                            if (decl.type === DeclarationType.Variable) {
                                const isEnum = isObject(type) && ClassType.isEnumClass(type.classType);

                                // If the symbol is private or constant, we can retain the literal
                                // value. Otherwise, strip them off to make the type less specific,
                                // allowing other values to be assigned to it in subclasses.
                                if (
                                    TypeBase.isInstance(type) &&
                                    !isTypeAlias &&
                                    !isPrivate &&
                                    !isConstant &&
                                    !isEnum &&
                                    !isFinalVar
                                ) {
                                    type = stripLiteralValue(type);
                                }
                            }
                            typesToCombine.push(type);
                        }
                    } catch (e) {
                        // Clean up the stack before rethrowing.
                        popSymbolResolution(symbol);
                        throw e;
                    }
                } else {
                    isResolutionCyclical = true;
                }
            }
        });

        if (typesToCombine.length > 0) {
            return {
                type: combineTypes(typesToCombine),
                isResolutionCyclical: false,
            };
        }

        return {
            type: UnboundType.create(),
            isResolutionCyclical,
        };
    }

    function getDeclaredTypeOfSymbol(symbol: Symbol): Type | undefined {
        const synthesizedType = symbol.getSynthesizedType();
        if (synthesizedType) {
            return synthesizedType;
        }

        const typedDecls = symbol.getTypedDeclarations();

        if (typedDecls.length === 0) {
            // There was no declaration with a defined type.
            return undefined;
        }

        // Start with the last decl. If that's already being resolved,
        // use the next-to-last decl, etc. This can happen when resolving
        // property methods. Often the setter method is defined in reference to
        // the initial property, which defines the getter method with the same
        // symbol name.
        let declIndex = typedDecls.length - 1;
        while (declIndex >= 0) {
            const decl = typedDecls[declIndex];

            // If there's a partially-constructed type that is allowed
            // for recursive symbol resolution, return it as the resolved type.
            const partialType = getSymbolResolutionPartialType(symbol, decl);
            if (partialType) {
                return partialType;
            }

            if (getIndexOfSymbolResolution(symbol, decl) < 0) {
                if (pushSymbolResolution(symbol, decl)) {
                    try {
                        const type = getTypeForDeclaration(decl);

                        if (!popSymbolResolution(symbol)) {
                            return undefined;
                        }

                        return type;
                    } catch (e) {
                        // Clean up the stack before rethrowing.
                        popSymbolResolution(symbol);
                        throw e;
                    }
                }

                break;
            }

            declIndex--;
        }

        return undefined;
    }

    // Returns the return type of the function. If the type is explicitly provided in
    // a type annotation, that type is returned. If not, an attempt is made to infer
    // the return type. If a list of args is provided, the inference logic may take
    // into account argument types to infer the return type.
    function getFunctionEffectiveReturnType(
        type: FunctionType,
        args?: ValidateArgTypeParams[],
        inferTypeIfNeeded = true
    ) {
        const specializedReturnType = FunctionType.getSpecializedReturnType(type);
        if (specializedReturnType) {
            return specializedReturnType;
        }

        if (inferTypeIfNeeded) {
            return getFunctionInferredReturnType(type, args);
        }

        return UnknownType.create();
    }

    function getFunctionInferredReturnType(type: FunctionType, args?: ValidateArgTypeParams[]) {
        let returnType: Type | undefined;

        // Don't attempt to infer the return type for a stub file.
        if (FunctionType.isStubDefinition(type)) {
            return UnknownType.create();
        }

        // If the return type has already been lazily evaluated,
        // don't bother computing it again.
        if (type.inferredReturnType) {
            returnType = type.inferredReturnType;
        } else {
            if (type.details.declaration) {
                const functionNode = type.details.declaration.node;

                // Temporarily disable speculative mode while we
                // lazily evaluate the return type.
                disableSpeculativeMode(() => {
                    returnType = inferFunctionReturnType(functionNode, FunctionType.isAbstractMethod(type));
                });

                // Do we need to wrap this in an awaitable?
                if (returnType && FunctionType.isWrapReturnTypeInAwait(type)) {
                    returnType = createAwaitableReturnType(functionNode, returnType);
                }
            }

            if (!returnType) {
                returnType = UnknownType.create();
            }

            // Cache the type for next time.
            type.inferredReturnType = returnType;
        }

        // If the type is partially unknown and the function has one or more unannotated
        // params, try to analyze the function with the provided argument types and
        // attempt to do a better job at inference.
        if (
            isPartlyUnknown(returnType) &&
            FunctionType.hasUnannotatedParams(type) &&
            !FunctionType.isStubDefinition(type) &&
            args
        ) {
            const contextualReturnType = getFunctionInferredReturnTypeUsingArguments(type, args);
            if (contextualReturnType) {
                returnType = contextualReturnType;
            }
        }

        return returnType;
    }

    function getFunctionInferredReturnTypeUsingArguments(
        type: FunctionType,
        args: ValidateArgTypeParams[]
    ): Type | undefined {
        let contextualReturnType: Type | undefined;

        if (!type.details.declaration) {
            return undefined;
        }
        const functionNode = type.details.declaration.node;

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

        const functionType = getTypeOfFunction(functionNode);
        if (!functionType) {
            return undefined;
        }

        // Don't explore arbitrarily deep in the call graph.
        if (returnTypeInferenceContextStack.length >= maxReturnTypeInferenceStackSize) {
            return undefined;
        }

        // Suppress diagnostics because we don't want to generate errors.
        suppressDiagnostics(() => {
            // Allocate a new temporary type cache for the context of just
            // this function so we can analyze it separately without polluting
            // the main type cache.
            const prevTypeCache = returnTypeInferenceTypeCache;
            returnTypeInferenceContextStack.push({
                functionNode,
                codeFlowAnalyzer: createCodeFlowAnalyzer(),
            });

            try {
                returnTypeInferenceTypeCache = new Map<number, CachedType>();

                let allArgTypesAreUnknown = true;
                functionNode.parameters.forEach((param, index) => {
                    if (param.name) {
                        let paramType: Type | undefined;
                        const arg = args.find((arg) => param.name!.value === arg.paramName);
                        if (arg && arg.argument.valueExpression) {
                            paramType = getTypeOfExpression(arg.argument.valueExpression).type;
                            allArgTypesAreUnknown = false;
                        } else if (param.defaultValue) {
                            paramType = getTypeOfExpression(param.defaultValue).type;
                            allArgTypesAreUnknown = false;
                        } else if (index === 0) {
                            // If this is an instance or class method, use the implied
                            // parameter type for the "self" or "cls" parameter.
                            if (
                                FunctionType.isInstanceMethod(functionType.functionType) ||
                                FunctionType.isClassMethod(functionType.functionType)
                            ) {
                                if (functionType.functionType.details.parameters.length > 0) {
                                    if (functionNode.parameters[0].name) {
                                        paramType = functionType.functionType.details.parameters[0].type;
                                    }
                                }
                            }
                        }

                        if (!paramType) {
                            paramType = UnknownType.create();
                        }

                        writeTypeCache(param.name, paramType);
                    }
                });

                // Don't bother trying to determine the contextual return
                // type if none of the argument types are known.
                if (!allArgTypesAreUnknown) {
                    contextualReturnType = inferFunctionReturnType(functionNode, FunctionType.isAbstractMethod(type));
                }
            } finally {
                returnTypeInferenceContextStack.pop();
                returnTypeInferenceTypeCache = prevTypeCache;
            }
        });

        if (contextualReturnType) {
            // Do we need to wrap this in an awaitable?
            if (FunctionType.isWrapReturnTypeInAwait(type) && !isNoReturnType(contextualReturnType)) {
                contextualReturnType = createAwaitableReturnType(functionNode, contextualReturnType);
            }

            return contextualReturnType;
        }

        return undefined;
    }

    function getFunctionDeclaredReturnType(node: FunctionNode): Type | undefined {
        const functionTypeInfo = getTypeOfFunction(node)!;
        if (!functionTypeInfo) {
            // We hit a recursive dependency.
            return AnyType.create();
        }

        // Ignore this check for abstract methods, which often
        // don't actually return any value.
        if (FunctionType.isAbstractMethod(functionTypeInfo.functionType)) {
            return AnyType.create();
        }

        if (FunctionType.isGenerator(functionTypeInfo.functionType)) {
            return getDeclaredGeneratorReturnType(functionTypeInfo.functionType);
        }

        return functionTypeInfo.functionType.details.declaredReturnType;
    }

    function getTypeOfMember(member: ClassMember): Type {
        if (isClass(member.classType)) {
            return partiallySpecializeType(getEffectiveTypeOfSymbol(member.symbol), member.classType);
        }
        return UnknownType.create();
    }

    function canAssignClassToProtocol(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ): boolean {
        const destClassFields = destType.details.fields;

        // Some protocol definitions include recursive references to themselves.
        // We need to protect against infinite recursion, so we'll check for that here.
        if (isTypeSame(srcType, destType)) {
            return true;
        }

        // Strip the type arguments off the dest protocol if they are provided.
        const genericDestType = ClassType.cloneForSpecialization(
            destType,
            undefined,
            /* isTypeArgumentExplicit */ false
        );
        const genericDestTypeVarMap = new TypeVarMap();

        let typesAreConsistent = true;
        const srcClassTypeVarMap = buildTypeVarMapFromSpecializedClass(srcType);

        destClassFields.forEach((symbol, name) => {
            if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                const memberInfo = lookUpClassMember(srcType, name);
                if (!memberInfo) {
                    diag.addMessage(Localizer.DiagnosticAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                } else {
                    const declaredType = getDeclaredTypeOfSymbol(symbol);
                    if (declaredType) {
                        const srcMemberType = specializeType(
                            getTypeOfMember(memberInfo),
                            srcClassTypeVarMap,
                            /* makeConcrete */ false
                        );

                        if (
                            !canAssignType(
                                declaredType,
                                srcMemberType,
                                diag.createAddendum(),
                                genericDestTypeVarMap,
                                CanAssignFlags.Default,
                                recursionCount + 1
                            )
                        ) {
                            diag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                            typesAreConsistent = false;
                        }
                    }

                    if (symbol.isClassVar() && !memberInfo.symbol.isClassMember()) {
                        diag.addMessage(Localizer.DiagnosticAddendum.protocolMemberClassVar().format({ name }));
                        typesAreConsistent = false;
                    }
                }
            }
        });

        // Now handle base classes of the dest protocol.
        destType.details.baseClasses.forEach((baseClass) => {
            if (
                isClass(baseClass) &&
                !ClassType.isBuiltIn(baseClass, 'object') &&
                !ClassType.isBuiltIn(baseClass, 'Protocol')
            ) {
                const specializedBaseClass = specializeForBaseClass(destType, baseClass, recursionCount + 1);
                if (
                    !canAssignClassToProtocol(
                        specializedBaseClass,
                        srcType,
                        diag,
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    )
                ) {
                    typesAreConsistent = false;
                }
            }
        });

        // If the dest protocol has type parameters, make sure the source type arguments match.
        if (typesAreConsistent && destType.details.typeParameters.length > 0 && destType.typeArguments !== undefined) {
            // Create a specialized version of the protocol defined by the dest and
            // make sure the resulting type args can be assigned.
            const specializedSrcProtocol = specializeType(
                genericDestType,
                genericDestTypeVarMap,
                /* makeConcrete */ false
            ) as ClassType;

            if (
                !verifyTypeArgumentsAssignable(
                    destType,
                    specializedSrcProtocol,
                    diag,
                    typeVarMap,
                    flags,
                    recursionCount
                )
            ) {
                typesAreConsistent = false;
            }
        }

        return typesAreConsistent;
    }

    function canAssignTypedDict(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        recursionCount: number
    ) {
        let typesAreConsistent = true;
        const destEntries = getTypedDictMembersForClass(destType);
        const srcEntries = getTypedDictMembersForClass(srcType);

        destEntries.forEach((destEntry, name) => {
            const srcEntry = srcEntries.get(name);
            if (!srcEntry) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldMissing().format({ name, type: printType(srcType) })
                );
                typesAreConsistent = false;
            } else {
                if (destEntry.isRequired && !srcEntry.isRequired) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typedDictFieldRequired().format({
                            name,
                            type: printType(destType),
                        })
                    );
                    typesAreConsistent = false;
                } else if (!destEntry.isRequired && srcEntry.isRequired) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typedDictFieldNotRequired().format({
                            name,
                            type: printType(destType),
                        })
                    );
                    typesAreConsistent = false;
                }

                if (!isTypeSame(destEntry.valueType, srcEntry.valueType, recursionCount + 1)) {
                    diag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                    typesAreConsistent = false;
                }
            }
        });

        return typesAreConsistent;
    }

    function canAssignClass(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number,
        reportErrorsUsingObjType: boolean
    ): boolean {
        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        if (ClassType.isProtocolClass(destType)) {
            return canAssignClassToProtocol(destType, srcType, diag, typeVarMap, flags, recursionCount);
        }

        // Handle typed dicts. They also use a form of structural typing for type
        // checking, as defined in PEP 589.
        if (ClassType.isTypedDictClass(destType) && ClassType.isTypedDictClass(srcType)) {
            return canAssignTypedDict(destType, srcType, diag, recursionCount);
        }

        // Handle property classes. They are special because each property
        // class has a different source ID, so they wouldn't otherwise match.
        // We need to see if the return types of the properties match.
        if (ClassType.isPropertyClass(destType) && ClassType.isPropertyClass(srcType)) {
            let typesAreConsistent = true;

            const fgetDestReturnType = getGetterTypeFromProperty(destType, /* inferTypeIfNeeded */ true);
            const fgetSrcReturnType = getGetterTypeFromProperty(srcType, /* inferTypeIfNeeded */ true);
            if (fgetDestReturnType && fgetSrcReturnType) {
                if (
                    !canAssignType(
                        fgetDestReturnType,
                        fgetSrcReturnType,
                        diag,
                        /* typeVarMap */ undefined,
                        CanAssignFlags.Default,
                        recursionCount + 1
                    )
                ) {
                    typesAreConsistent = false;
                }
            }

            return typesAreConsistent;
        }

        // Special-case conversion for the "numeric tower".
        if (ClassType.isBuiltIn(destType, 'float')) {
            if (ClassType.isBuiltIn(srcType, 'int')) {
                if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
                    return true;
                }
            }
        }

        if (ClassType.isBuiltIn(destType, 'complex')) {
            if (ClassType.isBuiltIn(srcType, 'int') || ClassType.isBuiltIn(srcType, 'float')) {
                if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
                    return true;
                }
            }
        }

        if ((flags & CanAssignFlags.EnforceInvariance) === 0 || ClassType.isSameGenericClass(srcType, destType)) {
            const inheritanceChain: InheritanceChain = [];
            if (ClassType.isDerivedFrom(srcType, destType, inheritanceChain)) {
                assert(inheritanceChain.length > 0);

                return canAssignClassWithTypeArgs(
                    destType,
                    srcType,
                    inheritanceChain,
                    diag,
                    typeVarMap,
                    flags,
                    recursionCount + 1
                );
            }
        }

        const destErrorType = reportErrorsUsingObjType ? ObjectType.create(destType) : destType;
        const srcErrorType = reportErrorsUsingObjType ? ObjectType.create(srcType) : srcType;
        diag.addMessage(
            Localizer.DiagnosticAddendum.typeIncompatible().format({
                sourceType: printType(srcErrorType),
                destType: printType(destErrorType),
            })
        );
        return false;
    }

    // Determines the specialized base class type that srcType derives from.
    function specializeForBaseClass(srcType: ClassType, baseClass: ClassType, recursionCount: number): ClassType {
        const typeParams = ClassType.getTypeParameters(baseClass);

        // If there are no type parameters for the specified base class,
        // no specialization is required.
        if (typeParams.length === 0) {
            return baseClass;
        }

        const typeVarMap = buildTypeVarMapFromSpecializedClass(srcType);
        const specializedType = specializeType(baseClass, typeVarMap, /* makeConcrete */ false, recursionCount + 1);
        assert(isClass(specializedType));
        return specializedType as ClassType;
    }

    // Determines whether the specified type can be assigned to the
    // specified inheritance chain, taking into account its type arguments.
    function canAssignClassWithTypeArgs(
        destType: ClassType,
        srcType: ClassType,
        inheritanceChain: InheritanceChain,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ): boolean {
        let curSrcType = srcType;
        let curTypeVarMap = typeVarMap;

        for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
            const ancestorType = inheritanceChain[ancestorIndex];

            // If we've hit an "unknown", all bets are off, and we need to assume
            // that the type is assignable.
            if (isUnknown(ancestorType)) {
                return true;
            }

            // If we've hit an 'object', it's assignable.
            if (ClassType.isBuiltIn(ancestorType, 'object')) {
                return true;
            }

            // If this isn't the first time through the loop, specialize
            // for the next ancestor in the chain.
            if (ancestorIndex < inheritanceChain.length - 1) {
                curSrcType = specializeForBaseClass(curSrcType, ancestorType, recursionCount + 1);
            }

            // Do we need to do special-case processing for various built-in classes?
            if (ancestorIndex === 0 && ClassType.isSpecialBuiltIn(destType)) {
                // Handle built-in types that support arbitrary numbers
                // of type parameters like Tuple.
                if (destType.details.name === 'Tuple') {
                    if (destType.typeArguments && curSrcType.typeArguments) {
                        const destTypeArgs = destType.typeArguments;
                        let destArgCount = destTypeArgs.length;
                        const isDestHomogenousTuple = destArgCount === 2 && isEllipsisType(destTypeArgs[1]);
                        if (isDestHomogenousTuple) {
                            destArgCount = 1;
                        }

                        const srcTypeArgs = curSrcType.typeArguments;
                        let srcArgCount = srcTypeArgs.length;
                        const isSrcHomogeneousType = srcArgCount === 2 && isEllipsisType(srcTypeArgs[1]);
                        if (isSrcHomogeneousType) {
                            srcArgCount = 1;
                        }

                        if ((srcTypeArgs.length === destArgCount && !isSrcHomogeneousType) || isDestHomogenousTuple) {
                            for (let i = 0; i < Math.max(destArgCount, srcArgCount); i++) {
                                const expectedDestType =
                                    (isDestHomogenousTuple ? destTypeArgs[0] : destTypeArgs[i]) || AnyType.create();
                                const expectedSrcType =
                                    (isSrcHomogeneousType ? srcTypeArgs[0] : srcTypeArgs[i]) || AnyType.create();
                                const entryDiag = diag.createAddendum();

                                if (
                                    !canAssignType(
                                        expectedDestType,
                                        expectedSrcType,
                                        entryDiag.createAddendum(),
                                        curTypeVarMap,
                                        flags,
                                        recursionCount + 1
                                    )
                                ) {
                                    entryDiag.addMessage(
                                        Localizer.DiagnosticAddendum.tupleEntryTypeMismatch().format({ entry: i + 1 })
                                    );
                                    return false;
                                }
                            }
                        } else {
                            diag.addMessage(
                                Localizer.DiagnosticAddendum.tupleSizeMismatch().format({
                                    expected: destArgCount,
                                    received: srcTypeArgs.length,
                                })
                            );
                            return false;
                        }
                    }

                    return true;
                }
            }

            // If there are no type parameters on this class, we're done.
            const ancestorTypeParams = ClassType.getTypeParameters(ancestorType);
            if (ancestorTypeParams.length === 0) {
                continue;
            }

            // If the dest type isn't specialized, there are no type args to validate.
            const ancestorTypeArgs = ancestorType.typeArguments;
            if (!ancestorTypeArgs) {
                return true;
            }

            // Validate that the type arguments match.
            if (!verifyTypeArgumentsAssignable(ancestorType, curSrcType, diag, curTypeVarMap, flags, recursionCount)) {
                return false;
            }

            // Allocate a new type var map for the next time through the loop.
            curTypeVarMap = new TypeVarMap();
        }

        if (destType.typeArguments) {
            // If the dest type is specialized, make sure the specialized source
            // type arguments are assignable to the dest type arguments.
            if (!verifyTypeArgumentsAssignable(destType, curSrcType, diag, typeVarMap, flags, recursionCount)) {
                return false;
            }
        } else if (
            typeVarMap &&
            destType.details.typeParameters.length > 0 &&
            curSrcType.typeArguments &&
            !typeVarMap.isLocked()
        ) {
            // Populate the typeVar map with type arguments of the source.
            for (let i = 0; i < destType.details.typeParameters.length; i++) {
                const typeArgType =
                    i < curSrcType.typeArguments.length ? curSrcType.typeArguments[i] : UnknownType.create();
                typeVarMap.setTypeVar(destType.details.typeParameters[i], typeArgType, /* isNarrowable */ true);
            }
        }

        return true;
    }

    function getGetterTypeFromProperty(propertyClass: ClassType, inferTypeIfNeeded: boolean): Type | undefined {
        if (!ClassType.isPropertyClass(propertyClass)) {
            return undefined;
        }

        const fgetSymbol = propertyClass.details.fields.get('fget');

        if (fgetSymbol) {
            const fgetType = getDeclaredTypeOfSymbol(fgetSymbol);
            if (fgetType && fgetType.category === TypeCategory.Function) {
                return getFunctionEffectiveReturnType(fgetType, /* args */ undefined, inferTypeIfNeeded);
            }
        }

        return undefined;
    }

    function verifyTypeArgumentsAssignable(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ) {
        assert(ClassType.isSameGenericClass(destType, srcType));

        const destTypeParams = ClassType.getTypeParameters(destType);
        const destTypeArgs = destType.typeArguments!;
        assert(destTypeArgs !== undefined);
        const srcTypeArgs = srcType.typeArguments;

        if (srcTypeArgs) {
            if (ClassType.isSpecialBuiltIn(srcType) || srcTypeArgs.length === destTypeParams.length) {
                for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                    const srcTypeArg = srcTypeArgs[srcArgIndex];

                    // In most cases, the number of type args should match the number
                    // of type arguments, but there are a few special cases where this
                    // isn't true (e.g. assigning a Tuple[X, Y, Z] to a tuple[W]).
                    const destArgIndex = srcArgIndex >= destTypeArgs.length ? destTypeArgs.length - 1 : srcArgIndex;
                    const destTypeArg = destArgIndex >= 0 ? destTypeArgs[destArgIndex] : UnknownType.create();
                    const destTypeParam =
                        destArgIndex < destTypeParams.length ? destTypeParams[destArgIndex] : undefined;
                    const assignmentDiag = new DiagnosticAddendum();

                    if (!destTypeParam || destTypeParam.details.isCovariant) {
                        if (
                            !canAssignType(
                                destTypeArg,
                                srcTypeArg,
                                assignmentDiag,
                                typeVarMap,
                                flags,
                                recursionCount + 1
                            )
                        ) {
                            if (destTypeParam) {
                                const childDiag = diag.createAddendum();
                                childDiag.addMessage(
                                    Localizer.DiagnosticAddendum.typeVarIsCovariant().format({
                                        name: destTypeParam.details.name,
                                    })
                                );
                                childDiag.addAddendum(assignmentDiag);
                            }
                            return false;
                        }
                    } else if (destTypeParam.details.isContravariant) {
                        if (
                            !canAssignType(
                                srcTypeArg,
                                destTypeArg,
                                assignmentDiag,
                                typeVarMap,
                                flags | CanAssignFlags.ReverseTypeVarMatching,
                                recursionCount + 1
                            )
                        ) {
                            const childDiag = diag.createAddendum();
                            childDiag.addMessage(
                                Localizer.DiagnosticAddendum.typeVarIsContravariant().format({
                                    name: destTypeParam.details.name,
                                })
                            );
                            childDiag.addAddendum(assignmentDiag);
                            return false;
                        }
                    } else {
                        if (
                            !canAssignType(
                                destTypeArg,
                                srcTypeArg,
                                assignmentDiag,
                                typeVarMap,
                                flags | CanAssignFlags.EnforceInvariance,
                                recursionCount + 1
                            )
                        ) {
                            const childDiag = diag.createAddendum();
                            childDiag.addMessage(
                                Localizer.DiagnosticAddendum.typeVarIsInvariant().format({
                                    name: destTypeParam.details.name,
                                })
                            );
                            childDiag.addAddendum(assignmentDiag);
                            return false;
                        }
                    }
                }
            }
        }

        return true;
    }

    // Assigns the source type to the dest type var in the type map. If an existing type is
    // already associated with that type var name, it attempts to either widen or narrow
    // the type (depending on the value of the canNarrowType parameter). The goal is to
    // produce the narrowest type that meets all of the requirements. If the type var map
    // has been "locked", it simply validates that the srcType is compatible (with no attempt
    // to widen or narrow).
    function assignTypeToTypeVar(
        destType: TypeVarType,
        srcType: Type,
        canNarrowType: boolean,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap,
        flags = CanAssignFlags.Default,
        recursionCount = 0
    ): boolean {
        const curTypeVarMapping = typeVarMap.getTypeVar(destType);

        if (destType.details.isParamSpec) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.typeParamSpec().format({
                    type: printType(srcType),
                    name: destType.details.name,
                })
            );
            return false;
        }

        // Handle the constrained case.
        if (destType.details.constraints.length > 0) {
            // Find the first constrained type that is compatible.
            const constrainedType = destType.details.constraints.find((constraintType) => {
                return canAssignType(constraintType, srcType, new DiagnosticAddendum());
            });

            if (!constrainedType) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeConstraint().format({
                        type: printType(srcType),
                        name: destType.details.name,
                    })
                );
                return false;
            }

            const isSrcTypeVar = isTypeVar(srcType) && !srcType.details.isSynthesized;
            if (curTypeVarMapping && !isAnyOrUnknown(curTypeVarMapping) && !isSrcTypeVar) {
                if (!isTypeSame(curTypeVarMapping, constrainedType)) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeConstraint().format({
                            type: printType(constrainedType),
                            name: printType(curTypeVarMapping),
                        })
                    );
                    return false;
                }
            } else {
                // Assign the type to the type var. If the source is a TypeVar, don't
                // specialize it to one of the constrained types. Leave it generic.
                if (!typeVarMap.isLocked()) {
                    typeVarMap.setTypeVar(destType, isSrcTypeVar ? srcType : constrainedType, false);
                }
            }

            return true;
        }

        // Handle the unconstrained (but possibly bound) case.
        let updatedType = srcType;
        const curTypeIsNarrowable = typeVarMap.isNarrowable(destType) && !typeVarMap.isLocked();
        const updatedTypeIsNarrowable = canNarrowType && curTypeIsNarrowable;

        if (curTypeVarMapping) {
            const diagAddendum = new DiagnosticAddendum();
            if (canNarrowType) {
                // Handle the narrowing case (used for contravariant type matching).
                if (
                    curTypeIsNarrowable &&
                    canAssignType(srcType, curTypeVarMapping, diagAddendum, typeVarMap, flags, recursionCount + 1)
                ) {
                    // No need to narrow. Stick with the existing type unless it's an Unknown,
                    // in which case we'll try to replace it with a known type.
                    if (!isAnyOrUnknown(curTypeVarMapping) && !isUnknown(srcType)) {
                        updatedType = curTypeVarMapping;
                    }
                } else if (
                    !canAssignType(
                        curTypeVarMapping,
                        srcType,
                        new DiagnosticAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    )
                ) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(srcType),
                            destType: printType(curTypeVarMapping),
                        })
                    );
                    return false;
                }
            } else {
                // Handle the widen case.
                if (canAssignType(curTypeVarMapping, srcType, diagAddendum, typeVarMap, flags, recursionCount + 1)) {
                    if (curTypeIsNarrowable) {
                        // The new srcType is narrower than the current type, but the current
                        // type is allowed to be narrowed, so replace the current type with
                        // the srcType.
                    } else {
                        // No need to widen. Stick with the existing type unless it's an Unknown,
                        // in which case we'll replace it with a known type.
                        if (!isUnknown(curTypeVarMapping)) {
                            updatedType = curTypeVarMapping;
                        }
                    }
                } else {
                    if (typeVarMap.isLocked()) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                                sourceType: printType(curTypeVarMapping),
                                destType: printType(srcType),
                            })
                        );
                        return false;
                    }

                    if (
                        !canAssignType(
                            srcType,
                            curTypeVarMapping,
                            new DiagnosticAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        )
                    ) {
                        // Create a union, widening the type.
                        updatedType = combineTypes([curTypeVarMapping, srcType]);
                    }
                }
            }
        }

        // If there's a bound type, make sure the source is derived from it.
        if (destType.details.boundType) {
            if (
                !canAssignType(
                    destType.details.boundType,
                    updatedType,
                    diag.createAddendum(),
                    undefined,
                    CanAssignFlags.Default,
                    recursionCount + 1
                )
            ) {
                // Avoid adding a message that will confuse users if the TypeVar was
                // synthesized for internal purposes.
                if (!destType.details.isSynthesized) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeBound().format({
                            sourceType: printType(updatedType),
                            destType: printType(destType.details.boundType),
                            name: destType.details.name,
                        })
                    );
                }
                return false;
            }
        }

        if (!typeVarMap.isLocked()) {
            typeVarMap.setTypeVar(destType, updatedType, updatedTypeIsNarrowable);
        }

        return true;
    }

    // Determines if the source type can be assigned to the dest type.
    // If typeVarMap is provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    function canAssignType(
        destType: Type,
        srcType: Type,
        diag: DiagnosticAddendum,
        typeVarMap?: TypeVarMap,
        flags = CanAssignFlags.Default,
        recursionCount = 0
    ): boolean {
        destType = transformPossibleRecursiveTypeAlias(destType);
        srcType = transformPossibleRecursiveTypeAlias(srcType);

        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        if (destType === srcType) {
            return true;
        }

        // If the source or dest is unbound, allow the assignment. The
        // error will be reported elsewhere.
        if (isUnbound(destType) || isUnbound(srcType)) {
            return true;
        }

        // Strip the ReverseTypeVarMatching from the incoming flags.
        // We don't want to propagate this flag to any nested calls to
        // canAssignType.
        const reverseTypeVarMatching = (flags & CanAssignFlags.ReverseTypeVarMatching) !== 0;
        flags &= ~CanAssignFlags.ReverseTypeVarMatching;

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (isTypeVar(destType)) {
            if (flags & CanAssignFlags.MatchTypeVarsExactly) {
                if (isTypeVar(srcType) && destType.details.name === srcType.details.name) {
                    return true;
                }
            } else if (!reverseTypeVarMatching) {
                if (
                    assignTypeToTypeVar(
                        destType,
                        srcType,
                        /* canNarrowType */ false,
                        diag,
                        typeVarMap || new TypeVarMap(),
                        flags,
                        recursionCount + 1
                    )
                ) {
                    return true;
                }

                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                return false;
            }
        }

        if (isTypeVar(srcType)) {
            if (flags & CanAssignFlags.MatchTypeVarsExactly) {
                if (isTypeVar(destType) && destType.details.name === srcType.details.name) {
                    return true;
                }

                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                return false;
            }
        }

        if (isAnyOrUnknown(destType)) {
            return true;
        }

        if (isAnyOrUnknown(srcType)) {
            if (typeVarMap) {
                // If it's an ellipsis type, convert it to a regular "Any"
                // type. These are functionally equivalent, but "Any" looks
                // better in the text representation.
                const typeVarSubstitution = isEllipsisType(srcType) ? AnyType.create() : srcType;
                setTypeArgumentsRecursive(destType, typeVarSubstitution, typeVarMap);
            }
            if ((flags & CanAssignFlags.DisallowAssignFromAny) === 0) {
                return true;
            }
        }

        if (isNever(srcType)) {
            if (typeVarMap) {
                setTypeArgumentsRecursive(destType, UnknownType.create(), typeVarMap);
            }
            return true;
        }

        if (isTypeVar(srcType)) {
            // In most cases, the source type will be specialized before
            // canAssignType is called, so we won't get here. However, there
            // are cases where this can occur (e.g. when we swap the src and dest
            // types because they are contravariant).
            if (reverseTypeVarMatching) {
                return assignTypeToTypeVar(
                    srcType,
                    destType,
                    /* canNarrowType */ true,
                    diag,
                    typeVarMap || new TypeVarMap(),
                    flags,
                    recursionCount + 1
                );
            }

            if (flags & CanAssignFlags.DoNotSpecializeTypeVars) {
                if (destType !== srcType) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(srcType),
                            destType: printType(destType),
                        })
                    );
                    return false;
                }
                return true;
            }

            const specializedSrcType = getConcreteTypeFromTypeVar(srcType);
            return canAssignType(destType, specializedSrcType, diag, undefined, flags, recursionCount + 1);
        }

        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        // If we need to enforce invariance, union types must match exactly.
        if (flags & CanAssignFlags.EnforceInvariance) {
            if (srcType.category === TypeCategory.Union || destType.category === TypeCategory.Union) {
                if (!isTypeSame(srcType, destType)) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(srcType),
                            destType: printType(destType),
                        })
                    );
                    return false;
                }

                return true;
            }
        }

        if (srcType.category === TypeCategory.Union) {
            let isIncompatible = false;

            // For union sources, all of the types need to be assignable to the dest.
            srcType.subtypes.forEach((t) => {
                if (!canAssignType(destType, t, diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
                    isIncompatible = true;
                }
            });

            if (isIncompatible) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                return false;
            }

            return true;
        }

        if (destType.category === TypeCategory.Union) {
            // For union destinations, we just need to match one of the types.
            const diagAddendum = new DiagnosticAddendum();

            let foundMatch = false;
            // Run through all subtypes in the union. Don't stop at the first
            // match we find because we may need to match TypeVars in other
            // subtypes. We special-case "None" so we can handle Optional[T]
            // without matching the None to the type var.
            if (
                srcType.category === TypeCategory.None &&
                destType.subtypes.some((subtype) => subtype.category === TypeCategory.None)
            ) {
                foundMatch = true;
            } else {
                let bestTypeVarMap: TypeVarMap | undefined;
                let bestTypeVarMapScore: number | undefined;

                destType.subtypes.forEach((subtype) => {
                    // Make a temporary clone of the typeVarMap. We don't want to modify
                    // the original typeVarMap until we find the "optimal" typeVar mapping.
                    const typeVarMapClone = typeVarMap?.clone();
                    if (canAssignType(subtype, srcType, diagAddendum, typeVarMapClone, flags, recursionCount + 1)) {
                        foundMatch = true;

                        if (typeVarMapClone) {
                            // Ask the typeVarMap to compute a "score" for the current
                            // contents of the table.
                            const typeVarMapScore = typeVarMapClone.getScore();
                            if (bestTypeVarMapScore === undefined || bestTypeVarMapScore <= typeVarMapScore) {
                                // We found a typeVar mapping with a higher score than before.
                                bestTypeVarMapScore = typeVarMapScore;
                                bestTypeVarMap = typeVarMapClone;
                            }
                        }
                    }
                });

                // If we found a winning type var mapping, copy it back to typeVarMap.
                if (typeVarMap && bestTypeVarMap) {
                    typeVarMap.copyFromClone(bestTypeVarMap);
                }
            }

            if (!foundMatch) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                diag.addAddendum(diagAddendum);
                return false;
            }
            return true;
        }

        if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
            return true;
        }

        // Is the src a specialized "Type" object?
        if (isObject(srcType) && ClassType.isBuiltIn(srcType.classType, 'Type')) {
            const srcTypeArgs = srcType.classType.typeArguments;
            if (srcTypeArgs && srcTypeArgs.length >= 1) {
                if (isAnyOrUnknown(srcTypeArgs[0])) {
                    return true;
                } else if (isObject(srcTypeArgs[0])) {
                    if (
                        canAssignType(
                            destType,
                            srcTypeArgs[0].classType,
                            diag.createAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        )
                    ) {
                        return true;
                    }

                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(srcType),
                            destType: printType(destType),
                        })
                    );
                    return false;
                }
            }
        }

        if (isClass(destType)) {
            if (isClass(srcType)) {
                if (
                    canAssignClass(
                        destType,
                        srcType,
                        diag,
                        typeVarMap,
                        flags,
                        recursionCount + 1,
                        /* reportErrorsUsingObjType */ false
                    )
                ) {
                    return true;
                }

                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                return false;
            }
        }

        if (isObject(destType)) {
            const destClassType = destType.classType;

            // Is the dest a generic "type" object?
            if (ClassType.isBuiltIn(destClassType, 'type')) {
                if (
                    isClass(srcType) ||
                    srcType.category === TypeCategory.Function ||
                    srcType.category === TypeCategory.OverloadedFunction
                ) {
                    return true;
                }
            }

            // Is the dest a specialized "Type" object?
            if (ClassType.isBuiltIn(destClassType, 'Type')) {
                const destTypeArgs = destClassType.typeArguments;
                if (destTypeArgs && destTypeArgs.length >= 1) {
                    if (isAnyOrUnknown(destTypeArgs[0])) {
                        return true;
                    } else if (isObject(destTypeArgs[0])) {
                        return canAssignType(
                            destTypeArgs[0].classType,
                            srcType,
                            diag,
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        );
                    } else if (isTypeVar(destTypeArgs[0])) {
                        if (isClass(srcType) || (isNone(srcType) && TypeBase.isInstantiable(srcType))) {
                            return canAssignType(
                                destTypeArgs[0],
                                convertToInstance(srcType),
                                diag,
                                typeVarMap,
                                flags,
                                recursionCount + 1
                            );
                        } else if (
                            srcType.category === TypeCategory.Function ||
                            srcType.category === TypeCategory.OverloadedFunction
                        ) {
                            return canAssignType(destTypeArgs[0], srcType, diag, typeVarMap, flags, recursionCount + 1);
                        }
                    }
                }
            }

            if (isObject(srcType)) {
                if (destType.classType.literalValue !== undefined) {
                    const srcLiteral = srcType.classType.literalValue;
                    if (
                        srcLiteral === undefined ||
                        !ClassType.isLiteralValueSame(srcType.classType, destType.classType)
                    ) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.literalAssignmentMismatch().format({
                                sourceType: srcLiteral !== undefined ? printLiteralType(srcType) : printType(srcType),
                                destType: printLiteralType(destType),
                            })
                        );

                        return false;
                    }
                }

                if (
                    !canAssignClass(
                        destClassType,
                        srcType.classType,
                        diag,
                        typeVarMap,
                        flags,
                        recursionCount + 1,
                        /* reportErrorsUsingObjType */ true
                    )
                ) {
                    return false;
                }

                return true;
            } else if (srcType.category === TypeCategory.Function) {
                // Is the destination a callback protocol (defined in PEP 544)?
                const callbackType = getCallbackProtocolType(destType);
                if (callbackType) {
                    return canAssignFunction(callbackType, srcType, diag, typeVarMap, flags, recursionCount + 1);
                }

                // All functions are assignable to "object".
                if (ClassType.isBuiltIn(destType.classType) && destType.classType.details.name === 'object') {
                    return true;
                }
            } else if (isModule(srcType)) {
                // Is the destination the built-in "ModuleType"?
                if (ClassType.isBuiltIn(destClassType, 'ModuleType')) {
                    return true;
                }
            } else if (isClass(srcType)) {
                // All classes are assignable to "object".
                if (ClassType.isBuiltIn(destType.classType, 'object')) {
                    return true;
                }

                // Determine if the metaclass can be assigned to the object.
                const metaclass = srcType.details.effectiveMetaclass;
                if (metaclass) {
                    if (isAnyOrUnknown(metaclass)) {
                        return true;
                    } else if (isClass(metaclass) && !ClassType.isBuiltIn(metaclass, 'type')) {
                        return canAssignClass(
                            destClassType,
                            metaclass,
                            diag,
                            typeVarMap,
                            flags,
                            recursionCount + 1,
                            /* reportErrorsUsingObjType */ false
                        );
                    }
                }
            }

            // See if the destType is an instantiation of a Protocol
            // class that is effectively a function.
            const callbackType = getCallbackProtocolType(destType);
            if (callbackType) {
                destType = callbackType;
            }
        }

        if (destType.category === TypeCategory.Function) {
            let srcFunction: FunctionType | undefined;

            if (srcType.category === TypeCategory.OverloadedFunction) {
                // Find first overloaded function that matches the parameters.
                // We don't want to pollute the current typeVarMap, so we'll
                // make a copy of the existing one if it's specified.
                const overloads = srcType.overloads;
                const overloadIndex = overloads.findIndex((overload) => {
                    const typeVarMapClone = typeVarMap ? typeVarMap.clone() : undefined;
                    return canAssignType(
                        destType,
                        overload,
                        diag.createAddendum(),
                        typeVarMapClone,
                        flags,
                        recursionCount + 1
                    );
                });
                if (overloadIndex < 0) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.noOverloadAssignable().format({ type: printType(destType) })
                    );
                    return false;
                }
                srcFunction = overloads[overloadIndex];
            } else if (srcType.category === TypeCategory.Function) {
                srcFunction = srcType;
            } else if (isObject(srcType)) {
                const callMember = lookUpObjectMember(srcType, '__call__');
                if (callMember) {
                    const memberType = getTypeOfMember(callMember);
                    if (memberType.category === TypeCategory.Function) {
                        srcFunction = stripFirstParameter(memberType);
                    }
                }
            } else if (isClass(srcType)) {
                // Synthesize a function that represents the constructor for this class.
                const constructorFunction = FunctionType.createInstance(
                    '__init__',
                    '',
                    FunctionTypeFlags.StaticMethod |
                        FunctionTypeFlags.ConstructorMethod |
                        FunctionTypeFlags.SynthesizedMethod
                );
                constructorFunction.details.declaredReturnType = ObjectType.create(srcType);

                let constructorInfo = lookUpClassMember(
                    srcType,
                    '__init__',
                    ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                );

                if (!constructorInfo) {
                    constructorInfo = lookUpClassMember(
                        srcType,
                        '__new__',
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                    );
                }

                const constructorType = constructorInfo ? getTypeOfMember(constructorInfo) : undefined;
                if (constructorType && constructorType.category === TypeCategory.Function) {
                    constructorType.details.parameters.forEach((param, index) => {
                        // Skip the 'cls' or 'self' parameter.
                        if (index > 0) {
                            FunctionType.addParameter(constructorFunction, param);
                        }
                    });
                } else {
                    FunctionType.addDefaultParameters(constructorFunction);
                }

                srcFunction = constructorFunction;
            }

            if (srcFunction) {
                if (
                    canAssignFunction(
                        destType,
                        srcFunction,
                        diag.createAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    )
                ) {
                    return true;
                }
            }
        }

        if (destType.category === TypeCategory.OverloadedFunction) {
            const overloadDiag = diag.createAddendum();

            // All overloads in the dest must be assignable.
            const isAssignable = !destType.overloads.some((destOverload) => {
                return !canAssignType(
                    destOverload,
                    srcType,
                    overloadDiag.createAddendum(),
                    new TypeVarMap(),
                    flags,
                    recursionCount + 1
                );
            });

            if (!isAssignable) {
                overloadDiag.addMessage(
                    Localizer.DiagnosticAddendum.overloadNotAssignable().format({
                        name: destType.overloads[0].details.name,
                    })
                );
                return false;
            }

            return true;
        }

        // NoneType and ModuleType derive from object.
        if (isNone(srcType) || isModule(srcType)) {
            if (isObject(destType)) {
                const destClassType = destType.classType;
                if (ClassType.isBuiltIn(destClassType, 'object')) {
                    return true;
                }
            }
        }

        if (isNone(destType)) {
            diag.addMessage(Localizer.DiagnosticAddendum.assignToNone());
            return false;
        }

        diag.addMessage(
            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                sourceType: printType(srcType),
                destType: printType(destType),
            })
        );

        return false;
    }

    function getCallbackProtocolType(objType: ObjectType): FunctionType | undefined {
        if (!ClassType.isProtocolClass(objType.classType)) {
            return undefined;
        }

        const callMember = lookUpObjectMember(objType, '__call__');
        if (!callMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(callMember);
        if (memberType.category === TypeCategory.Function) {
            const boundMethod = bindFunctionToClassOrObject(
                objType,
                memberType,
                /* treatAsClassMember */ false,
                /* errorNode */ undefined
            );

            if (boundMethod) {
                return boundMethod as FunctionType;
            }
        }

        return undefined;
    }

    function canAssignFunctionParameter(
        destType: Type,
        srcType: Type,
        paramIndex: number,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ) {
        // Call canAssignType once to perform any typeVarMap population.
        canAssignType(
            srcType,
            destType,
            new DiagnosticAddendum(),
            typeVarMap,
            flags | CanAssignFlags.ReverseTypeVarMatching,
            recursionCount + 1
        );

        // Make sure we can assign the specialized dest type to the source type.
        const specializedDestType = specializeType(destType, typeVarMap, /* makeConcrete */ false, recursionCount + 1);

        if (!canAssignType(srcType, specializedDestType, diag.createAddendum(), undefined, flags, recursionCount + 1)) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.paramAssignment().format({
                    index: paramIndex + 1,
                    sourceType: printType(specializedDestType),
                    destType: printType(srcType),
                })
            );
            return false;
        }

        return true;
    }

    function canAssignFunction(
        destType: FunctionType,
        srcType: FunctionType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ): boolean {
        let canAssign = true;
        const checkReturnType = (flags & CanAssignFlags.SkipFunctionReturnTypeCheck) === 0;
        flags &= ~CanAssignFlags.SkipFunctionReturnTypeCheck;

        const srcParams = srcType.details.parameters;
        const destParams = destType.details.parameters;

        const srcStartOfNamed = srcParams.findIndex(
            (p, index) =>
                p.category === ParameterCategory.VarArgDictionary ||
                (p.category === ParameterCategory.VarArgList && !p.name) ||
                (index > 0 && srcParams[index - 1].category === ParameterCategory.VarArgList)
        );
        let srcPositionals = srcStartOfNamed < 0 ? srcParams : srcParams.slice(0, srcStartOfNamed);
        const srcArgsIndex = srcPositionals.findIndex((p) => p.category === ParameterCategory.VarArgList && p.name);
        srcPositionals = srcPositionals.filter((p) => p.category === ParameterCategory.Simple && p.name);

        const destStartOfNamed = destParams.findIndex(
            (p, index) =>
                p.category === ParameterCategory.VarArgDictionary ||
                (p.category === ParameterCategory.VarArgList && !p.name) ||
                (index > 0 && destParams[index - 1].category === ParameterCategory.VarArgList)
        );
        let destPositionals = destStartOfNamed < 0 ? destParams : destParams.slice(0, destStartOfNamed);
        const destArgsIndex = destPositionals.findIndex((p) => p.category === ParameterCategory.VarArgList && p.name);
        destPositionals = destPositionals.filter((p) => p.category === ParameterCategory.Simple && p.name);

        const positionalsToMatch = Math.min(srcPositionals.length, destPositionals.length);

        if (!FunctionType.shouldSkipParamCompatibilityCheck(destType)) {
            // Match positional parameters.
            for (let paramIndex = 0; paramIndex < positionalsToMatch; paramIndex++) {
                const srcParamType = FunctionType.getEffectiveParameterType(
                    srcType,
                    srcParams.findIndex((p) => p === srcPositionals[paramIndex])
                );
                const destParamType = FunctionType.getEffectiveParameterType(
                    destType,
                    destParams.findIndex((p) => p === destPositionals[paramIndex])
                );

                if (
                    !canAssignFunctionParameter(
                        destParamType,
                        srcParamType,
                        paramIndex + 1,
                        diag.createAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }

            if (destPositionals.length < srcPositionals.length) {
                // If the dest type includes a ParamSpec, the additional parameters
                // can be assigned to it, so no need to report an error here.
                if (!destType.details.paramSpec) {
                    const nonDefaultSrcParamCount = srcParams.filter((p) => !!p.name && !p.hasDefault).length;
                    if (destArgsIndex < 0) {
                        if (destPositionals.length < nonDefaultSrcParamCount) {
                            diag.createAddendum().addMessage(
                                Localizer.DiagnosticAddendum.functionTooFewParams().format({
                                    expected: nonDefaultSrcParamCount,
                                    received: destPositionals.length,
                                })
                            );
                            canAssign = false;
                        }
                    } else {
                        // Make sure the remaining positional arguments are of the
                        // correct type for the *args parameter.
                        const destArgsType = FunctionType.getEffectiveParameterType(destType, destArgsIndex);
                        if (!isAnyOrUnknown(destArgsType)) {
                            for (
                                let paramIndex = destPositionals.length;
                                paramIndex < srcPositionals.length;
                                paramIndex++
                            ) {
                                const srcParamType = FunctionType.getEffectiveParameterType(
                                    srcType,
                                    srcParams.findIndex((p) => p === srcPositionals[paramIndex])
                                );
                                if (
                                    !canAssignFunctionParameter(
                                        destArgsType,
                                        srcParamType,
                                        paramIndex + 1,
                                        diag.createAddendum(),
                                        typeVarMap,
                                        flags,
                                        recursionCount
                                    )
                                ) {
                                    canAssign = false;
                                }
                            }
                        }
                    }
                }
            } else if (srcPositionals.length < destPositionals.length) {
                if (srcArgsIndex >= 0) {
                    // Make sure the remaining dest parameters can be assigned to the source
                    // *args parameter type.
                    const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
                    if (!isAnyOrUnknown(srcArgsType)) {
                        for (
                            let paramIndex = srcPositionals.length;
                            paramIndex < destPositionals.length;
                            paramIndex++
                        ) {
                            const destParamType = FunctionType.getEffectiveParameterType(
                                destType,
                                destParams.findIndex((p) => p === destPositionals[paramIndex])
                            );
                            if (
                                !canAssignFunctionParameter(
                                    destParamType,
                                    srcArgsType,
                                    paramIndex + 1,
                                    diag.createAddendum(),
                                    typeVarMap,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                canAssign = false;
                            }
                        }
                    }
                } else {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.functionTooManyParams().format({
                            expected: srcPositionals.length,
                            received: destPositionals.length,
                        })
                    );
                    canAssign = false;
                }
            }

            // If both src and dest have an "*args" parameter, make sure
            // their types are compatible.
            if (srcArgsIndex >= 0 && destArgsIndex >= 0) {
                const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
                const destArgsType = FunctionType.getEffectiveParameterType(destType, destArgsIndex);
                if (
                    !canAssignFunctionParameter(
                        destArgsType,
                        srcArgsType,
                        destArgsIndex + 1,
                        diag.createAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }

            // If the dest has an "*args" but the source doesn't, report the incompatibility.
            // The converse situation is OK.
            if (srcArgsIndex < 0 && destArgsIndex >= 0) {
                diag.createAddendum().addMessage(
                    Localizer.DiagnosticAddendum.argsParamMissing().format({
                        paramName: destParams[destArgsIndex].name!,
                    })
                );
                canAssign = false;
            }

            // Handle matching of named (keyword) parameters.
            // Build a dictionary of named parameters in the dest.
            const destParamMap = new Map<string, FunctionParameter>();
            let destHasKwargsParam = false;
            if (destStartOfNamed >= 0) {
                destParams.forEach((param, index) => {
                    if (index >= destStartOfNamed) {
                        if (param.category === ParameterCategory.VarArgDictionary) {
                            destHasKwargsParam = true;
                        } else if (param.name && param.category === ParameterCategory.Simple) {
                            destParamMap.set(param.name, param);
                        }
                    }
                });
            }

            if (srcStartOfNamed >= 0) {
                srcParams.forEach((param, index) => {
                    if (index >= srcStartOfNamed) {
                        if (param.name && param.category === ParameterCategory.Simple) {
                            const destParam = destParamMap.get(param.name);
                            const paramDiag = diag.createAddendum();
                            if (!destParam) {
                                if (!destHasKwargsParam && !param.hasDefault) {
                                    paramDiag.addMessage(
                                        Localizer.DiagnosticAddendum.namedParamMissingInDest().format({
                                            name: param.name,
                                        })
                                    );
                                    canAssign = false;
                                }
                            } else {
                                const specializedDestParamType = specializeType(
                                    destParam.type,
                                    typeVarMap,
                                    /* makeConcrete */ false,
                                    recursionCount + 1
                                );
                                if (
                                    !canAssignType(
                                        param.type,
                                        specializedDestParamType,
                                        paramDiag.createAddendum(),
                                        undefined,
                                        flags,
                                        recursionCount + 1
                                    )
                                ) {
                                    paramDiag.addMessage(
                                        Localizer.DiagnosticAddendum.namedParamTypeMismatch().format({
                                            name: param.name,
                                            sourceType: printType(specializedDestParamType),
                                            destType: printType(param.type),
                                        })
                                    );
                                    canAssign = false;
                                }
                                destParamMap.delete(param.name);
                            }
                        }
                    }
                });
            }

            // See if there are any unmatched named parameters.
            destParamMap.forEach((_, paramName) => {
                const paramDiag = diag.createAddendum();
                paramDiag.addMessage(
                    Localizer.DiagnosticAddendum.namedParamMissingInSource().format({ name: paramName })
                );
                canAssign = false;
            });
        }

        // Perform partial specialization of type variables to allow for
        // "higher-order" type variables.
        if (typeVarMap && !typeVarMap.isLocked()) {
            typeVarMap.getTypeVars().forEach((entry) => {
                const specializedType = specializeType(entry.type, typeVarMap, /* makeConcrete */ false);
                if (specializedType !== entry.type) {
                    typeVarMap.setTypeVar(entry.typeVar, specializedType, typeVarMap.isNarrowable(entry.typeVar));
                }
            });
        }

        // Match the return parameter.
        if (checkReturnType) {
            const destReturnType = getFunctionEffectiveReturnType(destType);
            if (!isAnyOrUnknown(destReturnType)) {
                let srcReturnType = getFunctionEffectiveReturnType(srcType);
                if (typeVarMap) {
                    srcReturnType = specializeType(srcReturnType, typeVarMap, /* makeConcrete */ false);
                }
                const returnDiag = diag.createAddendum();

                if (
                    !canAssignType(
                        destReturnType,
                        srcReturnType,
                        returnDiag.createAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    )
                ) {
                    returnDiag.addMessage(
                        Localizer.DiagnosticAddendum.functionReturnTypeMismatch().format({
                            sourceType: printType(srcReturnType),
                            destType: printType(destReturnType),
                        })
                    );
                    canAssign = false;
                }
            }

            // Are we assigning to a function with a ParamSpec?
            if (destType.details.paramSpec && typeVarMap && !typeVarMap.isLocked()) {
                typeVarMap.setParamSpec(
                    destType.details.paramSpec,
                    srcType.details.parameters
                        .map((p, index) => {
                            const paramSpecEntry: ParamSpecEntry = {
                                name: p.name || `__p${index}`,
                                type: p.type,
                            };
                            return paramSpecEntry;
                        })
                        .slice(destType.details.parameters.length, srcType.details.parameters.length)
                );
            }
        }

        return canAssign;
    }

    // When a variable with a declared type is assigned and the declared
    // type is a union, we may be able to further narrow the type.
    function narrowDeclaredTypeBasedOnAssignedType(declaredType: Type, assignedType: Type): Type {
        const diagAddendum = new DiagnosticAddendum();

        if (declaredType.category === TypeCategory.Union) {
            return doForSubtypes(declaredType, (subtype) => {
                if (assignedType.category === TypeCategory.Union) {
                    if (!assignedType.subtypes.some((t) => canAssignType(subtype, t, diagAddendum))) {
                        return undefined;
                    } else {
                        return subtype;
                    }
                }

                if (!canAssignType(subtype, assignedType, diagAddendum)) {
                    return undefined;
                }

                return subtype;
            });
        }

        if (!canAssignType(declaredType, assignedType, diagAddendum)) {
            return NeverType.create();
        }

        return transformTypeObjectToClass(declaredType);
    }

    function canOverrideMethod(baseMethod: Type, overrideMethod: FunctionType, diag: DiagnosticAddendum): boolean {
        // If we're overriding an overloaded method, uses the last overload.
        if (baseMethod.category === TypeCategory.OverloadedFunction) {
            baseMethod = baseMethod.overloads[baseMethod.overloads.length - 1];
        }

        // If we're overriding a non-method with a method, report it as an error.
        // This occurs when a non-property overrides a property.
        if (baseMethod.category !== TypeCategory.Function) {
            diag.addMessage(Localizer.DiagnosticAddendum.overrideType().format({ type: printType(baseMethod) }));
            return false;
        }

        let canOverride = true;
        const baseParams = baseMethod.details.parameters;
        const overrideParams = overrideMethod.details.parameters;

        // Verify that the param count matches exactly or that the override
        // adds only params that preserve the original signature.
        let foundParamCountMismatch = false;
        if (overrideParams.length < baseParams.length) {
            foundParamCountMismatch = true;
        } else if (overrideParams.length > baseParams.length) {
            // Verify that all of the override parameters that extend the
            // signature are either *vars, **kwargs or parameters with
            // default values.

            for (let i = baseParams.length; i < overrideParams.length; i++) {
                const overrideParam = overrideParams[i];

                if (
                    overrideParam.category === ParameterCategory.Simple &&
                    overrideParam.name &&
                    !overrideParam.hasDefault
                ) {
                    foundParamCountMismatch = true;
                }
            }
        }

        if (foundParamCountMismatch) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.overrideParamCount().format({
                    baseCount: baseParams.length,
                    overrideCount: overrideParams.length,
                })
            );
            canOverride = false;
        }

        const paramCount = Math.min(baseParams.length, overrideParams.length);
        const positionOnlyIndex = baseParams.findIndex(
            (param) => !param.name && param.category === ParameterCategory.Simple
        );

        for (let i = 0; i < paramCount; i++) {
            const baseParam = baseParams[i];
            const overrideParam = overrideParams[i];

            if (
                i > positionOnlyIndex &&
                !isPrivateOrProtectedName(baseParam.name || '') &&
                baseParam.category === ParameterCategory.Simple &&
                baseParam.name !== overrideParam.name
            ) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.overrideParamName().format({
                        index: i + 1,
                        baseName: baseParam.name || '*',
                        overrideName: overrideParam.name || '*',
                    })
                );
                canOverride = false;
            } else {
                const baseParamType = FunctionType.getEffectiveParameterType(baseMethod, i);
                const overrideParamType = FunctionType.getEffectiveParameterType(overrideMethod, i);

                const baseIsSynthesizedTypeVar = isTypeVar(baseParamType) && baseParamType.details.isSynthesized;
                const overrideIsSynthesizedTypeVar =
                    isTypeVar(overrideParamType) && overrideParamType.details.isSynthesized;
                if (!baseIsSynthesizedTypeVar && !overrideIsSynthesizedTypeVar) {
                    if (
                        baseParam.category !== overrideParam.category ||
                        !canAssignType(overrideParamType, baseParamType, diag.createAddendum())
                    ) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.overrideParamType().format({
                                index: i + 1,
                                baseType: printType(baseParamType),
                                overrideType: printType(overrideParamType),
                            })
                        );
                        canOverride = false;
                    }
                }
            }
        }

        const baseReturnType = getFunctionEffectiveReturnType(baseMethod);
        const overrideReturnType = getFunctionEffectiveReturnType(overrideMethod);
        if (!canAssignType(baseReturnType, overrideReturnType, diag.createAddendum())) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.overrideReturnType().format({
                    baseType: printType(baseReturnType),
                    overrideType: printType(overrideReturnType),
                })
            );

            canOverride = false;
        }

        return canOverride;
    }

    // Validates that the specified source type matches the constraints
    // of the type variable.
    function canAssignToTypeVar(
        destType: TypeVarType,
        srcType: Type,
        diag: DiagnosticAddendum,
        flags = CanAssignFlags.Default,
        recursionCount = 0
    ): boolean {
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        if (isAnyOrUnknown(srcType)) {
            return true;
        }

        let effectiveSrcType: Type = srcType;

        if (isTypeVar(srcType)) {
            if (isTypeSame(srcType, destType)) {
                return true;
            }

            if (srcType.details.boundType) {
                // If the source type is a type var itself and has a bound type,
                // convert it to that bound type.
                effectiveSrcType = getConcreteTypeFromTypeVar(srcType, recursionCount + 1);
            } else if (srcType.details.constraints) {
                effectiveSrcType = combineTypes(srcType.details.constraints);
            } else {
                effectiveSrcType = AnyType.create();
            }
        }

        // If there's a bound type, make sure the source is derived from it.
        const boundType = destType.details.boundType;
        if (boundType) {
            if (
                !canAssignType(boundType, effectiveSrcType, diag.createAddendum(), undefined, flags, recursionCount + 1)
            ) {
                // Avoid adding a message that will confuse users if the TypeVar was
                // synthesized for internal purposes.
                if (!destType.details.isSynthesized) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeBound().format({
                            sourceType: printType(effectiveSrcType),
                            destType: printType(boundType),
                            name: destType.details.name,
                        })
                    );
                }
                return false;
            }
        }

        // If there are no constraints, we're done.
        const constraints = destType.details.constraints;
        if (constraints.length === 0) {
            return true;
        }

        // Try to find a match among the constraints.
        for (const constraint of constraints) {
            if (isAnyOrUnknown(constraint)) {
                return true;
            } else if (effectiveSrcType.category === TypeCategory.Union) {
                // Does it match at least one of the constraints?
                if (effectiveSrcType.subtypes.find((t) => isSameWithoutLiteralValue(constraint, t))) {
                    return true;
                }
            } else if (isSameWithoutLiteralValue(constraint, effectiveSrcType)) {
                return true;
            }
        }

        diag.addMessage(
            Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                type: printType(effectiveSrcType),
                name: destType.details.name,
            })
        );

        return false;
    }

    function getAbstractMethods(classType: ClassType): AbstractMethod[] {
        const symbolTable = new Map<string, AbstractMethod>();

        classType.details.mro.forEach((mroClass) => {
            if (isClass(mroClass)) {
                // See if this class is introducing a new abstract method that has not been
                // introduced previously or if it is overriding an abstract method with
                // a non-abstract one.
                mroClass.details.fields.forEach((symbol, symbolName) => {
                    // We do a quick-and-dirty evaluation of methods based on
                    // decorators to determine which ones are abstract. This allows
                    // us to avoid evaluating the full function types.
                    if (symbol.isClassMember()) {
                        let isAbstract: boolean;

                        const decl = getLastTypedDeclaredForSymbol(symbol);
                        if (decl && decl.type === DeclarationType.Function) {
                            const functionFlags = getFunctionFlagsFromDecorators(decl.node, true);
                            isAbstract = !!(functionFlags & FunctionTypeFlags.AbstractMethod);
                        } else {
                            // If a symbol is overridden by a non-function, it is no longer
                            // considered abstract. This can happen in some code, for example,
                            // when a base class declares an abstract property and a subclass
                            // "overrides" it with an instance variable.
                            isAbstract = false;
                        }

                        if (!symbolTable.has(symbolName)) {
                            symbolTable.set(symbolName, {
                                symbol,
                                symbolName,
                                isAbstract,
                                classType: mroClass,
                            });
                        }
                    }
                });
            }
        });

        // Create a final list of methods that are abstract.
        const methodList: AbstractMethod[] = [];
        symbolTable.forEach((method) => {
            if (method.isAbstract) {
                methodList.push(method);
            }
        });

        return methodList;
    }

    // Determines whether the specified keys and values can be assigned to
    // a typed dictionary class. The caller should have already validated
    // that the class is indeed a typed dict.
    function canAssignToTypedDict(
        classType: ClassType,
        keyTypes: Type[],
        valueTypes: Type[],
        diagAddendum: DiagnosticAddendum
    ): boolean {
        assert(ClassType.isTypedDictClass(classType));
        assert(keyTypes.length === valueTypes.length);

        let isMatch = true;

        const symbolMap = getTypedDictMembersForClass(classType);

        keyTypes.forEach((keyType, index) => {
            if (
                !isObject(keyType) ||
                !ClassType.isBuiltIn(keyType.classType, 'str') ||
                keyType.classType.literalValue === undefined
            ) {
                isMatch = false;
            } else {
                const keyValue = keyType.classType.literalValue as string;
                const symbolEntry = symbolMap.get(keyValue);

                if (!symbolEntry) {
                    // The provided key name doesn't exist.
                    isMatch = false;
                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.typedDictFieldUndefined().format({
                            name: keyType.classType.literalValue as string,
                            type: printType(ObjectType.create(classType)),
                        })
                    );
                } else {
                    // Can we assign the value to the declared type?
                    const assignDiag = new DiagnosticAddendum();
                    if (!canAssignType(symbolEntry.valueType, valueTypes[index], assignDiag)) {
                        diagAddendum.addMessage(
                            Localizer.DiagnosticAddendum.typedDictFieldTypeMismatch().format({
                                name: keyType.classType.literalValue as string,
                                type: printType(valueTypes[index]),
                            })
                        );
                        isMatch = false;
                    }
                    symbolEntry.isProvided = true;
                }
            }
        });

        if (!isMatch) {
            return false;
        }

        // See if any required keys are missing.
        symbolMap.forEach((entry, name) => {
            if (entry.isRequired && !entry.isProvided) {
                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldRequired().format({
                        name,
                        type: printType(ObjectType.create(classType)),
                    })
                );
                isMatch = false;
            }
        });

        return isMatch;
    }

    function getTypedDictMembersForClass(classType: ClassType) {
        // Were the entries already calculated and cached?
        if (!classType.details.typedDictEntries) {
            const entries = new Map<string, TypedDictEntry>();
            getTypedDictMembersForClassRecursive(classType, entries);

            // Cache the entries for next time.
            classType.details.typedDictEntries = entries;
        }

        // Create a copy of the entries so the caller can mutate them.
        const entries = new Map<string, TypedDictEntry>();
        classType.details.typedDictEntries!.forEach((value, key) => {
            entries.set(key, { ...value });
        });

        return entries;
    }

    function getTypedDictMembersForClassRecursive(
        classType: ClassType,
        keyMap: Map<string, TypedDictEntry>,
        recursionCount = 0
    ) {
        assert(ClassType.isTypedDictClass(classType));
        if (recursionCount > maxTypeRecursionCount) {
            return;
        }

        classType.details.baseClasses.forEach((baseClassType) => {
            if (isClass(baseClassType) && ClassType.isTypedDictClass(baseClassType)) {
                getTypedDictMembersForClassRecursive(baseClassType, keyMap, recursionCount + 1);
            }
        });

        // Add any new typed dict entries from this class.
        classType.details.fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                // Only variables (not functions, classes, etc.) are considered.
                const lastDecl = getLastTypedDeclaredForSymbol(symbol);
                if (lastDecl && lastDecl.type === DeclarationType.Variable) {
                    keyMap.set(name, {
                        valueType: getDeclaredTypeOfSymbol(symbol) || UnknownType.create(),
                        isRequired: !ClassType.isCanOmitDictValues(classType),
                        isProvided: false,
                    });
                }
            }
        });
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it. If treatAsClassMember is true, the function is treated like a
    // class member even if it's not marked as such. That's needed to
    // special-case the __new__ magic method when it's invoked as a
    // constructor (as opposed to by name).
    function bindFunctionToClassOrObject(
        baseType: ClassType | ObjectType | undefined,
        memberType: Type,
        treatAsClassMember: boolean,
        errorNode: ParseNode | undefined = undefined
    ): Type | undefined {
        if (memberType.category === TypeCategory.Function) {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return stripFirstParameter(memberType);
            } else if (FunctionType.isInstanceMethod(memberType) && !treatAsClassMember) {
                if (isObject(baseType)) {
                    return partiallySpecializeFunctionForBoundClassOrObject(baseType, memberType, errorNode);
                }
            } else if (FunctionType.isClassMethod(memberType) || treatAsClassMember) {
                return partiallySpecializeFunctionForBoundClassOrObject(
                    isClass(baseType) ? baseType : baseType.classType,
                    memberType,
                    errorNode
                );
            }
        } else if (memberType.category === TypeCategory.OverloadedFunction) {
            const newOverloadType = OverloadedFunctionType.create();
            memberType.overloads.forEach((overload) => {
                const boundMethod = bindFunctionToClassOrObject(
                    baseType,
                    overload,
                    treatAsClassMember,
                    /* errorNode */ undefined
                );
                if (boundMethod) {
                    OverloadedFunctionType.addOverload(newOverloadType, boundMethod as FunctionType);
                }
            });

            if (newOverloadType.overloads.length === 1) {
                return newOverloadType.overloads[0];
            } else if (newOverloadType.overloads.length === 0) {
                // No overloads matched, so rebind with the errorNode
                // to report the error(s) to the user.
                memberType.overloads.forEach((overload) => {
                    bindFunctionToClassOrObject(baseType, overload, treatAsClassMember, errorNode);
                });
                return undefined;
            }

            return newOverloadType;
        }

        return memberType;
    }

    function partiallySpecializeFunctionForBoundClassOrObject(
        baseType: ClassType | ObjectType,
        memberType: FunctionType,
        errorNode: ParseNode | undefined
    ): Type | undefined {
        const classType = isClass(baseType) ? baseType : baseType.classType;

        // If the class has already been specialized (fully or partially), use its
        // existing type arg mappings. If it hasn't, use a fresh type arg map.
        const typeVarMap = classType.typeArguments ? buildTypeVarMapFromSpecializedClass(classType) : new TypeVarMap();

        if (memberType.details.parameters.length > 0) {
            const firstParam = memberType.details.parameters[0];

            // Fill out the typeVarMap.
            canAssignType(firstParam.type, baseType, new DiagnosticAddendum(), typeVarMap);
        }

        // Get the effective return type, which will have the side effect of lazily
        // evaluating (and caching) the inferred return type if there is no defined return type.
        getFunctionEffectiveReturnType(memberType);

        const specializedFunction = specializeType(memberType, typeVarMap, /* makeConcrete */ false) as FunctionType;

        // If the method has an annotated cls or self parameter, make sure the
        // base type is compatible with it.
        if (memberType.details.parameters.length > 0) {
            const firstParam = memberType.details.parameters[0];

            if (firstParam.name && !firstParam.isNameSynthesized && firstParam.hasDeclaredType) {
                const paramType = makeTypeVarsConcrete(FunctionType.getEffectiveParameterType(memberType, 0));
                const diag = new DiagnosticAddendum();
                if (!canAssignType(paramType, baseType, diag)) {
                    if (errorNode) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.bindTypeMismatch().format({
                                type: printType(baseType),
                                methodName: memberType.details.name,
                                paramName: firstParam.name,
                            }) + diag.getString(),
                            errorNode
                        );
                    } else {
                        // If there was no errorNode, we couldn't report the error,
                        // so we will instead return undefined and let the caller
                        // deal with the error.
                        return undefined;
                    }
                }
            }
        }

        return stripFirstParameter(specializedFunction);
    }

    function printObjectTypeForClass(type: ClassType, recursionCount = 0): string {
        let objName = type.details.name;

        // If this is a pseudo-generic class, don't display the type arguments
        // or type parameters because it will confuse users.
        if (!ClassType.isPseudoGenericClass(type)) {
            // If there is a type arguments array, it's a specialized class.
            if (type.typeArguments) {
                // Handle Tuple[()] as a special case.
                if (type.typeArguments.length > 0) {
                    if (
                        (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                        type.typeArguments.some((typeArg) => !isAnyOrUnknown(typeArg))
                    ) {
                        objName +=
                            '[' +
                            type.typeArguments
                                .map((typeArg) => {
                                    return printType(typeArg, /* expandTypeAlias */ false, recursionCount + 1);
                                })
                                .join(', ') +
                            ']';
                    }
                } else {
                    if (ClassType.isBuiltIn(type, 'Tuple')) {
                        objName += '[()]';
                    }
                }
            } else {
                const typeParams = ClassType.getTypeParameters(type);

                if (typeParams.length > 0) {
                    if (
                        (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                        typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))
                    ) {
                        objName +=
                            '[' +
                            typeParams
                                .map((typeParam) => {
                                    return printType(typeParam, /* expandTypeAlias */ false, recursionCount + 1);
                                })
                                .join(', ') +
                            ']';
                    }
                }
            }
        }

        return objName;
    }

    function printFunctionParts(type: FunctionType, recursionCount = 0): [string[], string] {
        const paramTypeStrings = type.details.parameters.map((param, index) => {
            let paramString = '';
            if (param.category === ParameterCategory.VarArgList) {
                paramString += '*';
            } else if (param.category === ParameterCategory.VarArgDictionary) {
                paramString += '**';
            }

            if (param.name) {
                paramString += param.name;
            }

            let defaultValueAssignment = '=';
            if (param.name) {
                // Avoid printing type types if parameter have unknown type.
                if (param.hasDeclaredType || param.isTypeInferred) {
                    const paramType = FunctionType.getEffectiveParameterType(type, index);
                    const paramTypeString =
                        recursionCount < maxTypeRecursionCount
                            ? printType(paramType, /* expandTypeAlias */ false, recursionCount + 1)
                            : '';
                    paramString += ': ' + paramTypeString;

                    // PEP8 indicates that the "=" for the default value should have surrounding
                    // spaces when used with a type annotation.
                    defaultValueAssignment = ' = ';
                } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0) {
                    paramString += ': Unknown';
                    defaultValueAssignment = ' = ';
                }
            } else {
                paramString += '/';
            }

            if (type.details.declaration) {
                const adjustedIndex = type.ignoreFirstParamOfDeclaration ? index + 1 : index;
                const paramNode = type.details.declaration.node.parameters[adjustedIndex];
                if (paramNode.defaultValue) {
                    paramString += defaultValueAssignment + ParseTreeUtils.printExpression(paramNode.defaultValue);
                }
            }

            return paramString;
        });

        const returnType = getFunctionEffectiveReturnType(type);
        let returnTypeString =
            recursionCount < maxTypeRecursionCount
                ? printType(returnType, /* expandTypeAlias */ false, recursionCount + 1)
                : '';

        if (
            printTypeFlags & PrintTypeFlags.PEP604 &&
            returnType.category === TypeCategory.Union &&
            recursionCount > 0
        ) {
            returnTypeString = `(${returnTypeString})`;
        }

        return [paramTypeStrings, returnTypeString];
    }

    function printType(type: Type, expandTypeAlias = false, recursionCount = 0): string {
        if (recursionCount >= maxTypeRecursionCount) {
            return '...';
        }

        // If this is a type alias, use its name rather than the type
        // it represents.
        if (type.typeAliasInfo && !expandTypeAlias) {
            let aliasName = type.typeAliasInfo.aliasName;

            // If there is a type arguments array, it's a specialized type alias.
            if (type.typeAliasInfo.typeArguments) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                    type.typeAliasInfo.typeArguments.some((typeArg) => !isAnyOrUnknown(typeArg))
                ) {
                    aliasName +=
                        '[' +
                        type.typeAliasInfo.typeArguments
                            .map((typeArg) => {
                                return printType(typeArg, /* expandTypeAlias */ false, recursionCount + 1);
                            })
                            .join(', ') +
                        ']';
                }
            } else {
                if (type.typeAliasInfo.typeParameters) {
                    if (
                        (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                        type.typeAliasInfo.typeParameters.some((typeParam) => !isAnyOrUnknown(typeParam))
                    ) {
                        aliasName +=
                            '[' +
                            type.typeAliasInfo.typeParameters
                                .map((typeParam) => {
                                    return printType(typeParam, /* expandTypeAlias */ false, recursionCount + 1);
                                })
                                .join(', ') +
                            ']';
                    }
                }
            }

            return aliasName;
        }

        switch (type.category) {
            case TypeCategory.Unbound: {
                return 'Unbound';
            }

            case TypeCategory.Unknown: {
                return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
            }

            case TypeCategory.Module: {
                return 'Module';
            }

            case TypeCategory.Class: {
                return 'Type[' + printObjectTypeForClass(type, recursionCount + 1) + ']';
            }

            case TypeCategory.Object: {
                const objType = type;
                if (objType.classType.literalValue !== undefined) {
                    return printLiteralType(objType);
                }

                if (isProperty(type)) {
                    const getterInfo = lookUpObjectMember(type, 'fget');
                    if (getterInfo) {
                        const getter = getTypeOfMember(getterInfo);
                        if (getter.category === TypeCategory.Function) {
                            const returnType = getFunctionEffectiveReturnType(getter);
                            return `${printType(
                                returnType,
                                /* expandTypeAlias */ false,
                                recursionCount + 1
                            )} (property)`;
                        }
                    }
                }

                return printObjectTypeForClass(objType.classType, recursionCount + 1);
            }

            case TypeCategory.Function: {
                // If it's a Callable with a ParamSpec, use the
                // Callable notation.
                const parts = printFunctionParts(type, recursionCount);
                if (type.details.paramSpec) {
                    if (type.details.parameters.length > 0) {
                        // Remove the args and kwargs parameters from the end.
                        const paramTypes = type.details.parameters.map((param) => printType(param.type));
                        return `Callable[Concatenate[${paramTypes.join(', ')}, ${
                            type.details.paramSpec.details.name
                        }], ${parts[1]}]`;
                    }
                    return `Callable[${type.details.paramSpec.details.name}, ${parts[1]}]`;
                }
                return `(${parts[0].join(', ')}) -> ${parts[1]}`;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedType = type;
                const overloads = overloadedType.overloads.map((overload) =>
                    printType(overload, /* expandTypeAlias */ false, recursionCount + 1)
                );
                return `Overload[${overloads.join(', ')}]`;
            }

            case TypeCategory.Union: {
                const unionType = type;
                let subtypes: Type[] = unionType.subtypes;

                if (subtypes.find((t) => t.category === TypeCategory.None) !== undefined) {
                    const optionalType = printType(
                        removeNoneFromUnion(unionType),
                        /* expandTypeAlias */ false,
                        recursionCount + 1
                    );

                    if (printTypeFlags & PrintTypeFlags.PEP604) {
                        return optionalType + ' | None';
                    }

                    return 'Optional[' + optionalType + ']';
                }

                // Make a shallow copy of the array so we can manipulate it.
                subtypes = [];
                subtypes = subtypes.concat(...unionType.subtypes);

                // If we're printing "Unknown" as "Any", remove redundant
                // unknowns so we don't see two Any's appear in the union.
                if ((printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0) {
                    if (subtypes.some((t) => t.category === TypeCategory.Any)) {
                        subtypes = subtypes.filter((t) => !isUnknown(t));
                    }
                }

                // If one or more subtypes are pseudo-generic, remove any other pseudo-generics
                // of the same type because we don't print type arguments for pseudo-generic
                // types, and we'll end up displaying seemingly-duplicated types.
                const isPseudoGeneric = (type: Type) =>
                    (isClass(type) && ClassType.isPseudoGenericClass(type)) ||
                    (isObject(type) && ClassType.isPseudoGenericClass(type.classType));
                if (subtypes.some((t) => isPseudoGeneric(t))) {
                    const filteredSubtypes: Type[] = [];
                    subtypes.forEach((type) => {
                        if (!isPseudoGeneric(type)) {
                            filteredSubtypes.push(type);
                        } else if (isClass(type)) {
                            if (!filteredSubtypes.some((t) => isClass(t) && ClassType.isSameGenericClass(t, type))) {
                                filteredSubtypes.push(type);
                            }
                        } else if (isObject(type)) {
                            if (
                                !filteredSubtypes.some(
                                    (t) => isObject(t) && ClassType.isSameGenericClass(t.classType, type.classType)
                                )
                            ) {
                                filteredSubtypes.push(type);
                            }
                        }
                    });
                    subtypes = filteredSubtypes;
                }

                const isLiteralObject = (type: Type) => isObject(type) && type.classType.literalValue !== undefined;
                const isLiteralClass = (type: Type) => isClass(type) && type.literalValue !== undefined;

                const subtypeStrings: string[] = [];
                while (subtypes.length > 0) {
                    const subtype = subtypes.shift()!;
                    if (isLiteralObject(subtype)) {
                        // Combine all literal objects. Rather than printing Union[Literal[1],
                        // Literal[2]], print Literal[1, 2].
                        const literals = subtypes.filter((t) => isLiteralObject(t));
                        literals.unshift(subtype);
                        const literalValues = literals.map((t) => printLiteralValue((t as ObjectType).classType));
                        subtypeStrings.push(`Literal[${literalValues.join(', ')}]`);

                        // Remove the items we've handled.
                        if (literals.length > 1) {
                            subtypes = subtypes.filter((t) => !isLiteralObject(t));
                        }
                    } else if (isLiteralClass(subtype)) {
                        // Combine all literal classes.
                        const literals = subtypes.filter((t) => isLiteralClass(t));
                        literals.unshift(subtype);
                        const literalValues = literals.map((t) => printLiteralValue(t as ClassType));
                        subtypeStrings.push(`Type[Literal[${literalValues.join(', ')}]]`);

                        // Remove the items we've handled.
                        if (literals.length > 1) {
                            subtypes = subtypes.filter((t) => !isLiteralClass(t));
                        }
                    } else {
                        subtypeStrings.push(printType(subtype, /* expandTypeAlias */ false, recursionCount + 1));
                    }
                }

                if (subtypeStrings.length === 1) {
                    return subtypeStrings[0];
                }

                if (printTypeFlags & PrintTypeFlags.PEP604) {
                    return subtypeStrings.join(' | ');
                }

                return `Union[${subtypeStrings.join(', ')}]`;
            }

            case TypeCategory.TypeVar: {
                // If it's synthesized, don't expose the internal name we generated.
                // This will confuse users. The exception is if it's a bound synthesized
                // type, in which case we'll print the bound type. This is used for
                // "self" and "cls" parameters.
                if (type.details.isSynthesized) {
                    // If it's a synthesized type var used to implement recursive type
                    // aliases, return the type alias name.
                    if (type.details.recursiveTypeAliasName) {
                        return type.details.recursiveTypeAliasName;
                    }

                    if (type.details.boundType) {
                        return printType(type.details.boundType, /* expandTypeAlias */ false, recursionCount + 1);
                    }

                    return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
                }

                if (type.details.isParamSpec) {
                    return `ParamSpec('${type.details.name}')`;
                }

                return `TypeVar('${type.details.name}')`;
            }

            case TypeCategory.None: {
                return TypeBase.isInstantiable(type) ? 'NoneType' : 'None';
            }

            case TypeCategory.Never: {
                return 'Never';
            }

            case TypeCategory.Any: {
                const anyType = type;
                return anyType.isEllipsis ? '...' : 'Any';
            }
        }

        return '';
    }

    // Calls back into the parser to parse the contents of a string literal.
    // This is unfortunately needed in some cases — specifically where the
    // parser couldn't determine that the string literal would be used in
    // a context where it should be treated as a forward-declared type. This
    // call produces an expression tree that is not attached to the main parse
    // expression tree because we don't want to mutate the latter; the
    // expression tree created by this function is therefore used only temporarily.
    function parseStringAsTypeAnnotation(node: StringListNode): ExpressionNode | undefined {
        const fileInfo = getFileInfo(node);
        const parser = new Parser();
        const textValue = node.strings[0].value;

        // Determine the offset within the file where the string
        // literal's contents begin.
        const valueOffset =
            node.strings[0].start + node.strings[0].token.prefixLength + node.strings[0].token.quoteMarkLength;

        const parseOptions = new ParseOptions();
        parseOptions.isStubFile = fileInfo.isStubFile;
        parseOptions.pythonVersion = fileInfo.executionEnvironment.pythonVersion;

        const parseResults = parser.parseTextExpression(
            fileInfo.fileContents,
            valueOffset,
            textValue.length,
            parseOptions
        );

        if (parseResults.parseTree) {
            parseResults.diagnostics.forEach((diag) => {
                addError(diag.message, node);
            });

            parseResults.parseTree.parent = node;
            return parseResults.parseTree;
        }

        return undefined;
    }

    return {
        runWithCancellationToken,
        getType,
        getTypeOfClass,
        getTypeOfFunction,
        evaluateTypesForStatement,
        getDeclaredTypeForExpression,
        verifyRaiseExceptionType,
        verifyDeleteExpression,
        isAfterNodeReachable,
        isNodeReachable,
        suppressDiagnostics,
        getDeclarationsForNameNode,
        getTypeForDeclaration,
        resolveAliasDeclaration,
        getTypeFromIterable,
        getTypedDictMembersForClass,
        getEffectiveTypeOfSymbol,
        getFunctionDeclaredReturnType,
        getFunctionInferredReturnType,
        getBuiltInType,
        getTypeOfMember,
        bindFunctionToClassOrObject,
        getBoundMethod,
        getCallSignatureInfo,
        getTypeAnnotationForParameter,
        canAssignType,
        canOverrideMethod,
        addError,
        addWarning,
        addInformation,
        addUnusedCode,
        addDiagnostic,
        addDiagnosticForTextRange,
        printType,
        printFunctionParts,
        getTypeCacheSize,
    };
}
