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
import { LogTracker } from '../common/logTracker';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { getEmptyRange, TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    ArgumentNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    BinaryOperationNode,
    CallNode,
    CaseNode,
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
    PatternAsNode,
    PatternAtomNode,
    PatternClassArgumentNode,
    PatternClassNode,
    PatternLiteralNode,
    PatternMappingNode,
    PatternSequenceNode,
    PatternValueNode,
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
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import * as DeclarationUtils from './aliasDeclarationUtils';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import {
    CodeFlowReferenceExpressionNode,
    createKeyForReference,
    FlowAssignment,
    FlowAssignmentAlias,
    FlowCall,
    FlowCondition,
    FlowFlags,
    FlowLabel,
    FlowNode,
    FlowPostContextManagerLabel,
    FlowPostFinally,
    FlowPreFinallyGate,
    FlowVariableAnnotation,
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
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName, isSingleDunderName } from './symbolNameUtils';
import {
    getLastTypedDeclaredForSymbol,
    isFinalVariable,
    isNotRequiredTypedDictVariable,
    isRequiredTypedDictVariable,
} from './symbolUtils';
import { PrintableType, TracePrinter } from './tracePrinter';
import {
    CachedType,
    IncompleteType,
    IncompleteTypeTracker,
    isIncompleteType,
    SpeculativeTypeTracker,
    TypeCache,
} from './typeCache';
import * as TypePrinter from './typePrinter';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineConstrainedTypes,
    combineTypes,
    ConstrainedSubtype,
    DataClassBehaviors,
    DataClassEntry,
    EnumLiteral,
    findSubtype,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    isAny,
    isAnyOrUnknown,
    isClass,
    isFunction,
    isModule,
    isNever,
    isNone,
    isObject,
    isOverloadedFunction,
    isParamSpec,
    isPossiblyUnbound,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnionableType,
    isUnknown,
    isVariadicTypeVar,
    LiteralValue,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    ObjectType,
    OverloadedFunctionType,
    ParamSpecEntry,
    removeNoneFromUnion,
    removeUnbound,
    SubtypeConstraint,
    SubtypeConstraints,
    Type,
    TypeBase,
    TypeCategory,
    TypedDictEntry,
    TypeSourceId,
    TypeVarScopeId,
    TypeVarType,
    UnboundType,
    UnknownType,
    Variance,
    WildcardTypeVarScopeId,
} from './types';
import {
    addTypeVarsToListIfUnique,
    applySolvedTypeVars,
    areTypesSame,
    buildTypeVarMapFromSpecializedClass,
    CanAssignFlags,
    canBeFalsy,
    canBeTruthy,
    ClassMember,
    ClassMemberLookupFlags,
    combineSameSizedTuples,
    computeMroLinearization,
    containsLiteralType,
    containsUnknown,
    convertToInstance,
    convertToInstantiable,
    derivesFromClassRecursive,
    doForEachSubtype,
    getDeclaredGeneratorReturnType,
    getDeclaredGeneratorSendType,
    getGeneratorTypeArgs,
    getSpecializedTupleType,
    getTypeVarArgumentsRecursive,
    getTypeVarScopeId,
    isEllipsisType,
    isLiteralType,
    isLiteralTypeOrUnion,
    isNoReturnType,
    isOpenEndedTupleClass,
    isOptionalType,
    isPartlyUnknown,
    isProperty,
    isTupleClass,
    isTypeAliasPlaceholder,
    isTypeAliasRecursive,
    lookUpClassMember,
    lookUpObjectMember,
    mapSubtypes,
    partiallySpecializeType,
    removeFalsinessFromType,
    removeNoReturnFromUnion,
    removeTruthinessFromType,
    requiresSpecialization,
    requiresTypeArguments,
    selfSpecializeClassType,
    setTypeArgumentsRecursive,
    specializeClassType,
    specializeForBaseClass,
    specializeTupleClass,
    stripLiteralValue,
    transformExpectedTypeForConstructor,
    transformPossibleRecursiveTypeAlias,
    transformTypeObjectToClass,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

interface TypeResult {
    type: Type;
    node: ParseNode;

    // Type consistency errors detected when evaluating this type.
    typeErrors?: boolean;

    // Variadic type arguments allow the shorthand "()" to
    // represent an empty tuple (i.e. Tuple[()]).
    isEmptyTupleShorthand?: boolean;

    // Is the type incomplete (i.e. not fully evaluated) because
    // some of the paths involve cyclical dependencies?
    isIncomplete?: boolean;

    unpackedType?: Type;
    typeList?: TypeResult[];
    expectedTypeDiagAddendum?: DiagnosticAddendum;

    // Used for the output of "super" calls used on the LHS of
    // a member access. Normally the type of the LHS is the same
    // as the class or object used to bind the member, but the
    // "super" call can specify a different class or object to
    // bind.
    bindToType?: ClassType | ObjectType | TypeVarType;
}

interface EffectiveTypeResult {
    type: Type;
    isIncomplete: boolean;
    includesVariableDecl: boolean;
    isRecursiveDefinition: boolean;
}

interface EffectiveTypeCacheEntry {
    usageNodeId: number | undefined;
    useLastDecl: boolean;
    result: EffectiveTypeResult;
}

interface FunctionArgument {
    argumentCategory: ArgumentCategory;
    node?: ArgumentNode;
    name?: NameNode;
    type?: Type;
    valueExpression?: ExpressionNode;
    active?: boolean;
}

interface ValidateArgTypeParams {
    paramCategory: ParameterCategory;
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: FunctionArgument;
    errorNode: ExpressionNode;
    paramName?: string;
    mapsToVarArgList?: boolean;
}

interface ClassMemberLookup {
    // Type of value.
    type: Type;
    isTypeIncomplete: boolean;

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

interface SequencePatternInfo {
    subtype: Type;
    entryTypes: Type[];
    isIndeterminateLength: boolean;
    isTuple: boolean;
}

interface MappingPatternInfo {
    subtype: Type;
    typedDict?: ClassType;
    dictTypeArgs?: {
        key: Type;
        value: Type;
    };
}

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

    // By default, member accesses are assumed to access the attributes
    // of a class instance. By setting this flag, only attributes of
    // the class are considered.
    AccessClassMembersOnly = 1 << 0,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 1 << 1,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 1 << 2,

    // Consider writes to symbols flagged as ClassVars as an error.
    DisallowClassVarWrites = 1 << 3,

    // Normally __new__ is treated as a static method, but when
    // it is invoked implicitly through a constructor call, it
    // acts like a class method instead.
    TreatConstructorAsClassMethod = 1 << 4,

    // By default, class member lookups start with the class itself
    // and fall back on the metaclass if it's not found. This option
    // skips the first check.
    ConsiderMetaclassOnly = 1 << 5,

    // If an attribute cannot be found when looking for instance
    // members, normally an attribute access override method
    // (__getattr__, etc.) may provide the missing attribute type.
    // This disables this check.
    SkipAttributeAccessOverride = 1 << 6,

    // Do not include the class itself, only base classes.
    SkipOriginalClass = 1 << 7,
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
    isPositionalOnly: boolean;
}

export type SetAnalysisChangedCallback = (reason: string) => void;

// Maps binary operators to the magic methods that implement them.
// The boolean indicates whether the operators "chain" together.
const binaryOperatorMap: { [operator: number]: [string, string, boolean] } = {
    [OperatorType.Add]: ['__add__', '__radd__', false],
    [OperatorType.Subtract]: ['__sub__', '__rsub__', false],
    [OperatorType.Multiply]: ['__mul__', '__rmul__', false],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__', false],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__', false],
    [OperatorType.Mod]: ['__mod__', '__rmod__', false],
    [OperatorType.Power]: ['__pow__', '__rpow__', false],
    [OperatorType.MatrixMultiply]: ['__matmul__', '__rmatmul__', false],
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__', false],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__', false],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__', false],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__', false],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__', false],
    [OperatorType.Equals]: ['__eq__', '__ne__', true],
    [OperatorType.NotEquals]: ['__ne__', '__eq__', true],
    [OperatorType.LessThan]: ['__lt__', '__gt__', true],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__', true],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__', true],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__', true],
};

// Maps boolean operators to a boolean value indicating whether
// the operators "chain" together with other comparison operators.
const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: false,
    [OperatorType.Or]: false,
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
    'builtins.tuple': PythonVersion.V3_9,
    'collections.ChainMap': PythonVersion.V3_9,
    'collections.Counter': PythonVersion.V3_9,
    'collections.defaultdict': PythonVersion.V3_9,
    'collections.DefaultDict': PythonVersion.V3_9,
    'collections.deque': PythonVersion.V3_9,
    'collections.OrderedDict': PythonVersion.V3_9,
    'queue.Queue': PythonVersion.V3_9,
};

// Some types that do not inherit from others are still considered
// "compatible" based on the Python spec. These are sometimes referred
// to as "type promotions".
const typePromotions: { [destType: string]: string[] } = {
    'builtins.float': ['builtins.int'],
    'builtins.complex': ['builtins.float', 'builtins.int'],
    'builtins.bytes': ['builtins.bytearray', 'builtins.memoryview'],
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
    callNode: CallNode;
}

export interface CallResult {
    returnType?: Type;
    isTypeIncomplete?: boolean;
    argumentErrors: boolean;
    activeParam?: FunctionParameter;
    overloadUsed?: FunctionType;
}

export interface MatchArgsToParamsResult {
    argumentErrors: boolean;
    argParams: ValidateArgTypeParams[];
    activeParam?: FunctionParameter;
    paramSpecTarget?: TypeVarType;
    paramSpecArgList?: FunctionArgument[];
}

export interface ArgResult {
    isCompatible: boolean;
    isTypeIncomplete?: boolean;
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
    suppressDiagnostics: (node: ParseNode, callback: () => void) => void;

    getDeclarationsForNameNode: (node: NameNode) => Declaration[] | undefined;
    getTypeForDeclaration: (declaration: Declaration) => Type | undefined;
    resolveAliasDeclaration: (declaration: Declaration, resolveLocalNames: boolean) => Declaration | undefined;
    getTypeFromIterable: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
    getTypeFromIterator: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
    getTypedDictMembersForClass: (classType: ClassType, allowNarrowed: boolean) => Map<string, TypedDictEntry>;
    getGetterTypeFromProperty: (propertyClass: ClassType, inferTypeIfNeeded: boolean) => Type | undefined;
    markNamesAccessed: (node: ParseNode, names: string[]) => void;
    getScopeIdForNode: (node: ParseNode) => string;
    makeTopLevelTypeVarsConcrete: (type: Type) => Type;

    getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    getFunctionDeclaredReturnType: (node: FunctionNode) => Type | undefined;
    getFunctionInferredReturnType: (type: FunctionType) => Type;
    getBuiltInType: (node: ParseNode, name: string) => Type;
    getTypeOfMember: (member: ClassMember) => Type;
    bindFunctionToClassOrObject: (
        baseType: ClassType | ObjectType | undefined,
        memberType: FunctionType | OverloadedFunctionType
    ) => FunctionType | OverloadedFunctionType | undefined;
    getCallSignatureInfo: (node: CallNode, activeIndex: number, activeOrFake: boolean) => CallSignatureInfo | undefined;
    getTypeAnnotationForParameter: (node: FunctionNode, paramIndex: number) => ExpressionNode | undefined;

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
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        targetSymbolId: number | undefined,
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

// What is the max number of input arguments we should allow
// for call-site return type inference? We've found that large,
// complex functions with many arguments can take too long to
// analyze.
const maxReturnTypeInferenceArgumentCount = 6;

// How many entries in a list, set, or dict should we examine
// when inferring the type? We need to cut it off at some point
// to avoid excessive computation.
const maxEntriesToUseForInference = 64;

// Maximum number of unioned subtypes for an inferred type (e.g.
// a list) before the type is considered an "Any".
const maxSubtypesForInferredType = 64;

export interface EvaluatorOptions {
    disableInferenceForPyTypedSources: boolean;
    printTypeFlags: TypePrinter.PrintTypeFlags;
    logCalls: boolean;
    minimumLoggingThreshold: number;
}

export function createTypeEvaluator(
    importLookup: ImportLookup,
    evaluatorOptions: EvaluatorOptions,
    logger: LogTracker,
    printer?: TracePrinter
): TypeEvaluator {
    const symbolResolutionStack: SymbolResolutionStackEntry[] = [];
    const isReachableRecursionMap = new Map<number, true>();
    const functionRecursionMap = new Map<number, true>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const isExceptionContextManagerCache = new Map<number, boolean>();
    const codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzer>();
    const typeCache: TypeCache = new Map<number, CachedType>();
    const speculativeTypeTracker = new SpeculativeTypeTracker();
    const effectiveTypeCache = new Map<number, EffectiveTypeCacheEntry[]>();
    const suppressedNodeStack: ParseNode[] = [];
    const incompleteTypeTracker = new IncompleteTypeTracker();
    let cancellationToken: CancellationToken | undefined;
    let flowIncompleteGeneration = 1;
    let isBasicTypesInitialized = false;
    let noneType: Type | undefined;
    let objectType: Type | undefined;
    let typeClassType: Type | undefined;
    let tupleClassType: Type | undefined;
    let incompleteTypeCache: TypeCache | undefined;

    const returnTypeInferenceContextStack: ReturnTypeInferenceContext[] = [];
    let returnTypeInferenceTypeCache: TypeCache | undefined;

    function logInternalCall<T>(title: string, callback: () => T, value: PrintableType): T {
        return logger.log(
            title,
            (logState) => {
                logState.add(printer?.print(value));
                return callback();
            },
            evaluatorOptions.minimumLoggingThreshold
        );
    }

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

    function writeTypeCache(
        node: ParseNode,
        type: Type,
        isIncomplete: boolean,
        expectedType?: Type,
        allowSpeculativeCaching = false
    ) {
        if (isIncomplete) {
            if (incompleteTypeCache) {
                incompleteTypeCache.set(node.id, type);
            }
            return;
        }

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
        if (speculativeTypeTracker.isSpeculative(node)) {
            speculativeTypeTracker.trackEntry(typeCacheToUse, node.id);
            if (allowSpeculativeCaching) {
                speculativeTypeTracker.addSpeculativeType(node, type, expectedType);
            }
        }

        incompleteTypeTracker.trackEntry(typeCacheToUse, node.id);
    }

    function deleteTypeCacheEntry(node: ParseNode) {
        const typeCacheToUse =
            returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)
                ? returnTypeInferenceTypeCache
                : typeCache;

        typeCacheToUse.delete(node.id);
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
        return evaluateTypeForSubnode(node, () => {
            evaluateTypesForExpressionInContext(node);
        })?.type;
    }

    function initializedBasicTypes(node: ParseNode) {
        if (!isBasicTypesInitialized) {
            // Some of these types have cyclical dependencies on each other,
            // so don't re-enter this block once we start executing it.
            isBasicTypesInitialized = true;

            objectType = getBuiltInObject(node, 'object') || AnyType.create();
            typeClassType = getBuiltInType(node, 'type') || AnyType.create();

            // Initialize and cache "Collection" to break a cyclical dependency
            // that occurs when resolving tuple below.
            getTypingType(node, 'Collection');

            noneType = getTypeshedType(node, 'NoneType') || AnyType.create();
            tupleClassType = getBuiltInType(node, 'tuple') || AnyType.create();
        }
    }

    const getTypeOfExpression = evaluatorOptions.logCalls
        ? (n: ExpressionNode, t?: Type, f = EvaluatorFlags.None) =>
              logInternalCall('getTypeOfExpression', () => getTypeOfExpressionInternal(n, t, f), n)
        : getTypeOfExpressionInternal;

    function getTypeOfExpressionInternal(
        node: ExpressionNode,
        expectedType?: Type,
        flags = EvaluatorFlags.None
    ): TypeResult {
        // Is this type already cached?
        const cachedType = readTypeCache(node);
        if (cachedType) {
            return { type: cachedType, node };
        } else {
            // Is it cached in the speculative type cache?
            const speculativeCachedType = speculativeTypeTracker.getSpeculativeType(node, expectedType);
            if (speculativeCachedType) {
                return { type: speculativeCachedType, node };
            }
        }

        // This is a frequently-called routine, so it's a good place to call
        // the cancellation check. If the operation is canceled, an exception
        // will be thrown at this point.
        checkForCancellation();

        const expectedTypeAlt = transformPossibleRecursiveTypeAlias(expectedType);

        // If we haven't already fetched some core type definitions from the
        // typeshed stubs, do so here. It would be better to fetch this when it's
        // needed in canAssignType, but we don't have access to the parse tree
        // at that point.
        initializedBasicTypes(node);

        let typeResult: TypeResult | undefined;
        let reportExpectingTypeErrors = (flags & EvaluatorFlags.ExpectingType) !== 0;

        switch (node.nodeType) {
            case ParseNodeType.Name: {
                typeResult = getTypeFromName(node, flags);
                break;
            }

            case ParseNodeType.MemberAccess: {
                typeResult = getTypeFromMemberAccess(node, flags);

                // Cache the type information in the member name node as well.
                if (!isTypeAliasPlaceholder(typeResult.type)) {
                    writeTypeCache(node.memberName, typeResult.type, !!typeResult.isIncomplete);
                }
                break;
            }

            case ParseNodeType.Index: {
                typeResult = getTypeFromIndex(node, flags);
                break;
            }

            case ParseNodeType.Call: {
                if ((flags & EvaluatorFlags.ExpectingTypeAnnotation) !== 0) {
                    // Evaluate the expression still so symbols are marked as accessed.
                    getTypeFromCall(node, expectedTypeAlt);

                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeAnnotationCall(),
                        node
                    );
                    typeResult = { node, type: UnknownType.create() };
                } else {
                    typeResult = getTypeFromCall(node, expectedTypeAlt);
                }
                break;
            }

            case ParseNodeType.Tuple: {
                typeResult = getTypeFromTuple(node, expectedTypeAlt, flags);
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
                if (node.isImaginary) {
                    typeResult = { node, type: getBuiltInObject(node, 'complex') };
                } else if (node.isInteger) {
                    typeResult = { node, type: cloneBuiltinObjectWithLiteral(node, 'int', node.value) };
                } else {
                    typeResult = { node, type: getBuiltInObject(node, 'float') };
                }
                break;
            }

            case ParseNodeType.Ellipsis: {
                if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                    typeResult = { type: AnyType.create(/* isEllipsis */ true), node };
                } else if ((flags & EvaluatorFlags.ConvertEllipsisToUnknown) !== 0) {
                    typeResult = { type: UnknownType.create(), node };
                } else {
                    const ellipsisType = getBuiltInObject(node, 'ellipsis') || AnyType.create();
                    typeResult = { type: ellipsisType, node };
                }
                break;
            }

            case ParseNodeType.UnaryOperation: {
                typeResult = getTypeFromUnaryOperation(node, expectedTypeAlt);
                break;
            }

            case ParseNodeType.BinaryOperation: {
                typeResult = getTypeFromBinaryOperation(node, expectedTypeAlt, flags);
                break;
            }

            case ParseNodeType.AugmentedAssignment: {
                typeResult = getTypeFromAugmentedAssignment(node, expectedTypeAlt);
                assignTypeToExpression(
                    node.destExpression,
                    typeResult.type,
                    !!typeResult.isIncomplete,
                    node.rightExpression
                );
                break;
            }

            case ParseNodeType.List:
            case ParseNodeType.Set: {
                typeResult = getTypeFromListOrSet(node, expectedTypeAlt);
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
                typeResult = getTypeFromTernary(node, flags, expectedTypeAlt);
                break;
            }

            case ParseNodeType.ListComprehension: {
                typeResult = getTypeFromListComprehension(node);
                break;
            }

            case ParseNodeType.Dictionary: {
                typeResult = getTypeFromDictionary(node, expectedTypeAlt);
                break;
            }

            case ParseNodeType.Lambda: {
                typeResult = getTypeFromLambda(node, expectedTypeAlt);
                break;
            }

            case ParseNodeType.Assignment: {
                typeResult = getTypeOfExpression(node.rightExpression);
                assignTypeToExpression(
                    node.leftExpression,
                    typeResult.type,
                    /* isTypeIncomplete */ false,
                    node.rightExpression,
                    /* ignoreEmptyContainers */ true
                );
                break;
            }

            case ParseNodeType.AssignmentExpression: {
                typeResult = getTypeOfExpression(node.rightExpression);
                assignTypeToExpression(
                    node.name,
                    typeResult.type,
                    /* isTypeIncomplete */ false,
                    node.rightExpression,
                    /* ignoreEmptyContainers */ true
                );
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
                let iterExpectedType: Type | undefined;
                if (expectedTypeAlt) {
                    const iterableType = getBuiltInType(node, 'Iterable');
                    if (iterableType && isClass(iterableType)) {
                        iterExpectedType = ObjectType.create(
                            ClassType.cloneForSpecialization(
                                iterableType,
                                [expectedTypeAlt],
                                /* isTypeArgumentExplicit */ true
                            )
                        );
                    }
                }

                const iterType = getTypeOfExpression(node.expression, iterExpectedType, flags).type;
                if (
                    (flags & EvaluatorFlags.TypeVarTupleDisallowed) === 0 &&
                    isVariadicTypeVar(iterType) &&
                    !iterType.isVariadicUnpacked
                ) {
                    typeResult = { type: TypeVarType.cloneForUnpacked(iterType), node };
                } else {
                    const type = getTypeFromIterator(iterType, /* isAsync */ false, node) || UnknownType.create();
                    typeResult = { type, unpackedType: iterType, node };
                }
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                typeResult = getTypeOfExpression(
                    node.typeAnnotation,
                    undefined,
                    EvaluatorFlags.EvaluateStringLiteralAsType |
                        EvaluatorFlags.ParamSpecDisallowed |
                        EvaluatorFlags.TypeVarTupleDisallowed |
                        EvaluatorFlags.ExpectingType |
                        EvaluatorFlags.ExpectingTypeAnnotation |
                        EvaluatorFlags.VariableTypeAnnotation
                );
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                suppressDiagnostics(node, () => {
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

        if (reportExpectingTypeErrors && !typeResult.isIncomplete) {
            const resultType = transformTypeObjectToClass(typeResult.type);

            if (flags & EvaluatorFlags.TypeVarTupleDisallowed) {
                if (isTypeVar(typeResult.type) && typeResult.type.details.isVariadic) {
                    addError(Localizer.Diagnostic.typeVarTupleContext(), node);
                    typeResult.type = UnknownType.create();
                }
            }

            if (!TypeBase.isInstantiable(resultType)) {
                const isEmptyVariadic =
                    isObject(resultType) &&
                    ClassType.isTupleClass(resultType.classType) &&
                    resultType.classType.tupleTypeArguments?.length === 0;

                if (!isEmptyVariadic) {
                    addExpectedClassDiagnostic(typeResult.type, node);
                }
            }
        }

        // Don't update the type cache with an unbound type that results from
        // a resolution cycle. The cache will be updated when the stack unwinds
        // and the type is fully evaluated.
        if (!isTypeAliasPlaceholder(typeResult.type)) {
            writeTypeCache(
                node,
                typeResult.type,
                !!typeResult.isIncomplete,
                expectedType,
                /* allowSpeculativeCaching */ true
            );
        }

        return typeResult;
    }

    function isAnnotationEvaluationPostponed(fileInfo: AnalyzerFileInfo) {
        return (
            fileInfo.futureImports.get('annotations') !== undefined ||
            fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_10 ||
            fileInfo.isStubFile
        );
    }

    function getTypeOfAnnotation(
        node: ExpressionNode,
        isVariableAnnotation: boolean,
        allowFinal = false,
        associateTypeVarsWithScope = false,
        allowTypeVarTuple = false
    ): Type {
        const fileInfo = getFileInfo(node);

        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
            const specialType = handleTypingStubTypeAnnotation(node);
            if (specialType) {
                return specialType;
            }
        }

        let evaluatorFlags =
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.ExpectingTypeAnnotation |
            EvaluatorFlags.ConvertEllipsisToAny |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.ParamSpecDisallowed;

        if (isVariableAnnotation) {
            evaluatorFlags |= EvaluatorFlags.VariableTypeAnnotation;
        }

        if (!allowTypeVarTuple) {
            evaluatorFlags |= EvaluatorFlags.TypeVarTupleDisallowed;
        }

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
        } else if (node?.parent?.nodeType === ParseNodeType.FunctionAnnotation) {
            if (node.parent.returnTypeAnnotation === node || node.parent.paramTypeAnnotations.some((n) => n === node)) {
                evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
            }
        } else if (node?.parent?.nodeType === ParseNodeType.Parameter) {
            if (node.parent.typeAnnotationComment === node) {
                evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
            }
        }

        if (!allowFinal) {
            evaluatorFlags |= EvaluatorFlags.FinalDisallowed;
        }

        const classType = getTypeOfExpression(node, /* expectedType */ undefined, evaluatorFlags).type;

        return convertToInstance(classType);
    }

    function getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        // Evaluate the type of the decorator expression. Do not specialize
        // if it's not a call expression because it could evaluate to a generic
        // class that we are instantiating.
        const decoratorTypeResult = getTypeOfExpression(
            node.expression,
            /* expectedType */ undefined,
            node.expression.nodeType === ParseNodeType.Call ? EvaluatorFlags.None : EvaluatorFlags.DoNotSpecialize
        );

        // Special-case the combination of a classmethod decorator applied
        // to a property. This is allowed in Python 3.9, but it's not reflected
        // in the builtins.pyi stub for classmethod.
        if (
            isClass(decoratorTypeResult.type) &&
            ClassType.isBuiltIn(decoratorTypeResult.type, 'classmethod') &&
            isProperty(functionOrClassType)
        ) {
            return functionOrClassType;
        }

        const argList = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: functionOrClassType,
            },
        ];

        const returnType =
            validateCallArguments(
                node.expression,
                argList,
                decoratorTypeResult.type,
                /* typeVarMap */ undefined,
                /* skipUnknownArgCheck */ true,
                /* expectedType */ undefined
            ).returnType || UnknownType.create();

        // If the return type is a function that has no annotations
        // and just *args and **kwargs parameters, assume that it
        // preserves the type of the input function.
        if (isFunction(returnType) && !returnType.details.declaredReturnType) {
            if (
                !returnType.details.parameters.some((param, index) => {
                    // Don't allow * or / separators or params with declared types.
                    if (!param.name || param.hasDeclaredType) {
                        return true;
                    }

                    // Allow *args or **kwargs parameters.
                    if (param.category !== ParameterCategory.Simple) {
                        return false;
                    }

                    // Allow inferred "self" or "cls" parameters.
                    return index !== 0 || !param.isTypeInferred;
                })
            ) {
                return functionOrClassType;
            }
        }

        return returnType;
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
        usage: EvaluatorUsage = { method: 'get' },
        diag: DiagnosticAddendum = new DiagnosticAddendum(),
        memberAccessFlags = MemberAccessFlags.None,
        bindToType?: ClassType | ObjectType | TypeVarType
    ): TypeResult | undefined {
        const memberInfo = getTypeFromClassMemberName(
            errorNode,
            objectType.classType,
            memberName,
            usage,
            diag,
            memberAccessFlags | MemberAccessFlags.DisallowClassVarWrites,
            bindToType
        );

        if (memberInfo) {
            return { node: errorNode, type: memberInfo.type, isIncomplete: !!memberInfo.isTypeIncomplete };
        }
        return undefined;
    }

    // Gets a member type from a class and if it's a function binds
    // it to the class.
    function getTypeFromClassMember(
        errorNode: ExpressionNode,
        classType: ClassType,
        memberName: string,
        usage: EvaluatorUsage = { method: 'get' },
        diag: DiagnosticAddendum = new DiagnosticAddendum(),
        memberAccessFlags = MemberAccessFlags.None,
        bindToType?: ClassType | ObjectType | TypeVarType
    ): TypeResult | undefined {
        let memberInfo: ClassMemberLookup | undefined;

        if (ClassType.isPartiallyConstructed(classType)) {
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.classDefinitionCycle().format({ name: classType.details.name }),
                errorNode
            );
            return { node: errorNode, type: UnknownType.create() };
        }

        if ((memberAccessFlags & MemberAccessFlags.ConsiderMetaclassOnly) === 0) {
            memberInfo = getTypeFromClassMemberName(
                errorNode,
                classType,
                memberName,
                usage,
                diag,
                memberAccessFlags | MemberAccessFlags.AccessClassMembersOnly,
                bindToType
            );
        }

        // If it wasn't found on the class, see if it's part of the metaclass.
        if (!memberInfo) {
            const metaclass = classType.details.effectiveMetaclass;
            if (metaclass && isClass(metaclass) && !ClassType.isSameGenericClass(metaclass, classType)) {
                memberInfo = getTypeFromClassMemberName(
                    errorNode,
                    metaclass,
                    memberName,
                    usage,
                    new DiagnosticAddendum(),
                    memberAccessFlags,
                    classType
                );
            }
        }

        if (memberInfo) {
            return { node: errorNode, type: memberInfo.type, isIncomplete: !!memberInfo.isTypeIncomplete };
        }
        return undefined;
    }

    function getBoundMethod(
        classType: ClassType,
        memberName: string,
        treatConstructorAsClassMember = false
    ): FunctionType | OverloadedFunctionType | undefined {
        const memberInfo = lookUpClassMember(
            classType,
            memberName,
            ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
        );

        if (memberInfo) {
            const unboundMethodType = getTypeOfMember(memberInfo);
            if (isFunction(unboundMethodType) || isOverloadedFunction(unboundMethodType)) {
                const boundMethod = bindFunctionToClassOrObject(
                    ObjectType.create(classType),
                    unboundMethodType,
                    /* memberClass */ undefined,
                    /* errorNode */ undefined,
                    /* recursionCount */ undefined,
                    treatConstructorAsClassMember
                );

                if (boundMethod) {
                    return boundMethod;
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
        } else if (param.typeAnnotationComment) {
            return param.typeAnnotationComment;
        }

        if (!node.functionAnnotationComment || node.functionAnnotationComment.isParamListEllipsis) {
            return undefined;
        }

        let firstCommentAnnotationIndex = 0;
        const paramAnnotations = node.functionAnnotationComment.paramTypeAnnotations;
        if (paramAnnotations.length < node.parameters.length) {
            firstCommentAnnotationIndex = 1;
        }

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
        callNode: CallNode,
        activeIndex: number,
        activeOrFake: boolean
    ): CallSignatureInfo | undefined {
        const exprNode = callNode.leftExpression;
        const callType = getType(exprNode);
        if (callType === undefined) {
            return undefined;
        }

        const argList: FunctionArgument[] = [];
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

        callNode.arguments.forEach((arg, index) => {
            let active = false;
            if (index === activeIndex) {
                if (activeOrFake) {
                    active = true;
                } else {
                    addFakeArg();
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

        if (callNode.arguments.length < activeIndex) {
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
                    new TypeVarMap(getTypeVarScopeId(type)),
                    /* skipUnknownArgCheck */ true
                );
            });

            signatures.push({
                type,
                activeParam: callResult?.activeParam,
            });
        }

        function addFunctionToSignature(type: FunctionType | OverloadedFunctionType) {
            if (isFunction(type)) {
                addOneFunctionToSignature(type);
            } else {
                type.overloads.forEach((func) => {
                    if (FunctionType.isOverloaded(func)) {
                        addOneFunctionToSignature(func);
                    }
                });
            }
        }

        doForEachSubtype(callType, (subtype) => {
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
                    methodType = getBoundMethod(subtype, '__init__');

                    if (!methodType || (isFunction(methodType) && FunctionType.isSkipConstructorCheck(methodType))) {
                        // If there was no __init__ method, use the __new__ method
                        // instead.
                        methodType = getBoundMethod(subtype, '__new__', /* treatConstructorAsClassMember */ true);
                    }

                    if (methodType) {
                        addFunctionToSignature(methodType);
                    }
                    break;
                }

                case TypeCategory.Object: {
                    const methodType = getBoundMethod(subtype.classType, '__call__');
                    if (methodType) {
                        addFunctionToSignature(methodType);
                    }
                    break;
                }
            }
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

    // Determines whether the specified expression is a symbol with a declared type
    // (either a simple name or a member variable). If so, the type is returned.
    function getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
        let symbol: Symbol | undefined;
        let classOrObjectBase: ClassType | ObjectType | undefined;
        let memberAccessClass: Type | undefined;

        switch (expression.nodeType) {
            case ParseNodeType.Name: {
                const symbolWithScope = lookUpSymbolRecursive(expression, expression.value, /* honorCodeFlow */ true);
                if (symbolWithScope) {
                    symbol = symbolWithScope.symbol;

                    // Handle the case where the symbol is a class-level variable
                    // where the type isn't declared in this class but is in
                    // a parent class.
                    if (
                        getDeclaredTypeOfSymbol(symbol) === undefined &&
                        symbolWithScope.scope.type === ScopeType.Class
                    ) {
                        const enclosingClass = ParseTreeUtils.getEnclosingClassOrFunction(expression);
                        if (enclosingClass && enclosingClass.nodeType === ParseNodeType.Class) {
                            const classTypeInfo = getTypeOfClass(enclosingClass);
                            if (classTypeInfo) {
                                const classMemberInfo = lookUpClassMember(
                                    classTypeInfo.classType,
                                    expression.value,
                                    ClassMemberLookupFlags.SkipInstanceVariables |
                                        ClassMemberLookupFlags.DeclaredTypesOnly
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
                return getDeclaredTypeForExpression(expression.valueExpression);
            }

            case ParseNodeType.MemberAccess: {
                const baseType = makeTopLevelTypeVarsConcrete(getTypeOfExpression(expression.leftExpression).type);
                let classMemberInfo: ClassMember | undefined;

                if (isObject(baseType)) {
                    classMemberInfo = lookUpObjectMember(
                        baseType,
                        expression.memberName.value,
                        ClassMemberLookupFlags.DeclaredTypesOnly
                    );
                    classOrObjectBase = baseType;
                    memberAccessClass = classMemberInfo?.classType;
                } else if (isClass(baseType)) {
                    classMemberInfo = lookUpClassMember(
                        baseType,
                        expression.memberName.value,
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.DeclaredTypesOnly
                    );
                    classOrObjectBase = baseType;
                    memberAccessClass = classMemberInfo?.classType;
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
                        if (isFunction(setItemType)) {
                            const boundFunction = bindFunctionToClassOrObject(
                                baseType,
                                setItemType,
                                isClass(setItemMember.classType) ? setItemMember.classType : undefined,
                                expression,
                                /* recursionCount */ undefined,
                                /* treatConstructorAsClassMember */ false
                            );
                            if (boundFunction && isFunction(boundFunction)) {
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
                    if (!setter || !isFunction(setter) || setter.details.parameters.length < 2) {
                        return undefined;
                    }

                    declaredType = setter.details.parameters[1].type;
                }

                if (classOrObjectBase) {
                    if (memberAccessClass && isClass(memberAccessClass)) {
                        declaredType = partiallySpecializeType(declaredType, memberAccessClass);
                    }

                    if (isFunction(declaredType) || isOverloadedFunction(declaredType)) {
                        declaredType = bindFunctionToClassOrObject(
                            classOrObjectBase,
                            declaredType,
                            /* memberClass */ undefined,
                            expression
                        );
                    }
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
        return mapSubtypes(type, (subtype) => {
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

    // Validates that the type is an iterator and returns the iterated type
    // (i.e. the type returned from the '__next__' or '__anext__' method).
    function getTypeFromIterator(type: Type, isAsync: boolean, errorNode: ParseNode | undefined): Type | undefined {
        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        let isValidIterator = true;

        type = makeTopLevelTypeVarsConcrete(type);

        if (isOptionalType(type)) {
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

        const iterableType = mapSubtypes(type, (subtype) => {
            subtype = transformTypeObjectToClass(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (isObject(subtype) || isClass(subtype)) {
                let iterReturnType: Type | undefined;

                if (isObject(subtype)) {
                    iterReturnType = getSpecializedReturnType(subtype, iterMethodName, errorNode);
                } else if (
                    isClass(subtype) &&
                    subtype.details.effectiveMetaclass &&
                    isClass(subtype.details.effectiveMetaclass)
                ) {
                    iterReturnType = getSpecializedReturnType(
                        ObjectType.create(subtype.details.effectiveMetaclass),
                        iterMethodName,
                        errorNode,
                        subtype
                    );
                }

                if (!iterReturnType) {
                    // There was no __iter__. See if we can fall back to
                    // the __getitem__ method instead.
                    if (isObject(subtype)) {
                        const getItemReturnType = getSpecializedReturnType(subtype, '__getitem__', errorNode);
                        if (getItemReturnType) {
                            return getItemReturnType;
                        }
                    }

                    diag.addMessage(Localizer.Diagnostic.methodNotDefined().format({ name: iterMethodName }));
                } else {
                    const concreteIterReturnType = makeTopLevelTypeVarsConcrete(iterReturnType);

                    if (isAnyOrUnknown(concreteIterReturnType)) {
                        return concreteIterReturnType;
                    }

                    if (isObject(concreteIterReturnType)) {
                        const nextReturnType = getSpecializedReturnType(
                            concreteIterReturnType,
                            nextMethodName,
                            errorNode
                        );

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
            }

            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotIterable().format({ type: printType(subtype) }) + diag.getString(),
                    errorNode
                );
            }

            isValidIterator = false;
        });

        return isValidIterator ? iterableType : undefined;
    }

    // Validates that the type is an iterable and returns the iterable type argument.
    function getTypeFromIterable(type: Type, isAsync: boolean, errorNode: ParseNode | undefined): Type | undefined {
        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        let isValidIterable = true;

        type = makeTopLevelTypeVarsConcrete(type);

        if (isOptionalType(type)) {
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

        const iterableType = mapSubtypes(type, (subtype) => {
            subtype = transformTypeObjectToClass(subtype);

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isObject(subtype) || isClass(subtype)) {
                let iterReturnType: Type | undefined;

                if (isObject(subtype)) {
                    iterReturnType = getSpecializedReturnType(subtype, iterMethodName, errorNode);
                } else if (
                    isClass(subtype) &&
                    subtype.details.effectiveMetaclass &&
                    isClass(subtype.details.effectiveMetaclass)
                ) {
                    iterReturnType = getSpecializedReturnType(
                        ObjectType.create(subtype.details.effectiveMetaclass),
                        iterMethodName,
                        errorNode,
                        subtype
                    );
                }

                if (iterReturnType) {
                    return makeTopLevelTypeVarsConcrete(iterReturnType);
                }
            }

            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotIterable().format({ type: printType(subtype) }),
                    errorNode
                );
            }

            isValidIterable = false;
        });

        return isValidIterable ? iterableType : undefined;
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods plus a __dataclass_fields__
    // class variable.
    function synthesizeDataClassMethods(node: ClassNode, classType: ClassType, skipSynthesizeInit: boolean) {
        assert(ClassType.isDataClass(classType));

        const newType = FunctionType.createInstance(
            '__new__',
            '',
            '',
            FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
        );
        const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);

        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType,
            hasDeclaredType: true,
        });
        FunctionType.addDefaultParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        const selfParam: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
            hasDeclaredType: true,
        };
        FunctionType.addParameter(initType, selfParam);
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
                    let aliasName: string | undefined;
                    let variableTypeEvaluator: TypeEvaluator | undefined;
                    let hasDefaultValue = false;
                    let defaultValueExpression: ExpressionNode | undefined;
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
                                    /* isVariableAnnotation */ true,
                                    /* allowFinal */ true
                                );
                        }

                        hasDefaultValue = true;
                        defaultValueExpression = statement.rightExpression;

                        // If the RHS of the assignment is assigning a field instance where the
                        // "init" parameter is set to false, do not include it in the init method.
                        if (statement.rightExpression.nodeType === ParseNodeType.Call) {
                            const callType = getTypeOfExpression(statement.rightExpression.leftExpression).type;
                            if (
                                isDataclassFieldConstructor(
                                    callType,
                                    classType.details.dataClassBehaviors?.fieldDescriptorNames || []
                                )
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

                                const aliasArg = statement.rightExpression.arguments.find(
                                    (arg) => arg.name?.value === 'alias'
                                );
                                if (aliasArg) {
                                    const valueType = getTypeOfExpression(aliasArg.valueExpression).type;
                                    if (
                                        isObject(valueType) &&
                                        ClassType.isBuiltIn(valueType.classType, 'str') &&
                                        isLiteralType(valueType)
                                    ) {
                                        aliasName = valueType.classType.literalValue as string;
                                    }
                                }
                            }
                        }
                    } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                        if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.valueExpression;
                            variableTypeEvaluator = () =>
                                getTypeOfAnnotation(
                                    statement.typeAnnotation,
                                    /* isVariableAnnotation */ true,
                                    /* allowFinal */ true
                                );
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
                                alias: aliasName,
                                hasDefault: hasDefaultValue,
                                defaultValueExpression,
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
                            if (
                                !ClassType.isDataClassKeywordOnlyParams(classType) &&
                                includeInInit &&
                                !skipSynthesizeInit &&
                                !hasDefaultValue
                            ) {
                                const firstDefaultValueIndex = fullDataClassEntries.findIndex(
                                    (p) => p.hasDefault && p.includeInInit
                                );
                                if (firstDefaultValueIndex >= 0 && firstDefaultValueIndex < insertIndex) {
                                    addError(Localizer.Diagnostic.dataClassFieldWithDefault(), variableNameNode);
                                }
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
            if (ClassType.isDataClassKeywordOnlyParams(classType)) {
                FunctionType.addParameter(initType, {
                    category: ParameterCategory.VarArgList,
                    type: AnyType.create(),
                });
            }

            fullDataClassEntries.forEach((entry) => {
                if (entry.includeInInit) {
                    const functionParam: FunctionParameter = {
                        category: ParameterCategory.Simple,
                        name: entry.alias || entry.name,
                        hasDefault: entry.hasDefault,
                        defaultValueExpression: entry.defaultValueExpression,
                        type: entry.type,
                        hasDeclaredType: true,
                    };

                    FunctionType.addParameter(initType, functionParam);
                }
            });

            symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
            symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        }

        const synthesizeComparisonMethod = (operator: string, paramType: Type) => {
            const operatorMethod = FunctionType.createInstance(operator, '', '', FunctionTypeFlags.SynthesizedMethod);
            FunctionType.addParameter(operatorMethod, selfParam);
            FunctionType.addParameter(operatorMethod, {
                category: ParameterCategory.Simple,
                name: 'x',
                type: paramType,
                hasDeclaredType: true,
            });
            operatorMethod.details.declaredReturnType = getBuiltInObject(node, 'bool');
            symbolTable.set(operator, Symbol.createWithType(SymbolFlags.ClassMember, operatorMethod));
        };

        // Synthesize comparison operators.
        if (!ClassType.isSkipSynthesizedDataClassEq(classType)) {
            synthesizeComparisonMethod('__eq__', getBuiltInObject(node, 'object'));
        }

        if (ClassType.isSynthesizedDataclassOrder(classType)) {
            const objType = ObjectType.create(classType);
            ['__lt__', '__le__', '__gt__', '__ge__'].forEach((operator) => {
                synthesizeComparisonMethod(operator, objType);
            });
        }

        let dictType = getBuiltInType(node, 'dict');
        if (isClass(dictType)) {
            dictType = ObjectType.create(
                ClassType.cloneForSpecialization(
                    dictType,
                    [getBuiltInObject(node, 'str'), AnyType.create()],
                    /* isTypeArgumentExplicit */ true
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
            '',
            FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
        );
        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType,
            hasDeclaredType: true,
        });
        FunctionType.addDefaultParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        // Synthesize an __init__ method.
        const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
            hasDeclaredType: true,
        });
        initType.details.declaredReturnType = NoneType.createInstance();

        // All parameters must be named, so insert an empty "*".
        FunctionType.addParameter(initType, {
            category: ParameterCategory.VarArgList,
            type: AnyType.create(),
            hasDeclaredType: true,
        });

        const entries = getTypedDictMembersForClass(classType);
        entries.forEach((entry, name) => {
            FunctionType.addParameter(initType, {
                category: ParameterCategory.Simple,
                name,
                hasDefault: !entry.isRequired,
                type: entry.valueType,
                hasDeclaredType: true,
            });
        });

        const symbolTable = classType.details.fields;
        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

        const strClass = getBuiltInType(node, 'str');

        // Synthesize a "get", pop, and setdefault method for each named entry.
        if (isClass(strClass)) {
            const selfParam: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'self',
                type: ObjectType.create(classType),
                hasDeclaredType: true,
            };
            const typeVarScopeId = getScopeIdForNode(node);
            let defaultTypeVar = TypeVarType.createInstance(`__${classType.details.name}_default`);
            defaultTypeVar.details.isSynthesized = true;
            defaultTypeVar = TypeVarType.cloneForScopeId(defaultTypeVar, typeVarScopeId, classType.details.name);

            const createGetMethod = (keyType: Type, valueType: Type, includeDefault: boolean) => {
                const getOverload = FunctionType.createInstance(
                    'get',
                    '',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(getOverload, selfParam);
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    type: keyType,
                    hasDeclaredType: true,
                });
                if (includeDefault) {
                    FunctionType.addParameter(getOverload, {
                        category: ParameterCategory.Simple,
                        name: 'default',
                        type: valueType,
                        hasDeclaredType: true,
                        hasDefault: true,
                    });
                    getOverload.details.declaredReturnType = valueType;
                } else {
                    getOverload.details.declaredReturnType = combineTypes([valueType, NoneType.createInstance()]);
                }
                return getOverload;
            };

            const createPopMethods = (keyType: Type, valueType: Type) => {
                const keyParam: FunctionParameter = {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    type: keyType,
                    hasDeclaredType: true,
                };

                const popOverload1 = FunctionType.createInstance(
                    'pop',
                    '',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(popOverload1, selfParam);
                FunctionType.addParameter(popOverload1, keyParam);
                popOverload1.details.declaredReturnType = valueType;

                const popOverload2 = FunctionType.createInstance(
                    'pop',
                    '',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(popOverload2, selfParam);
                FunctionType.addParameter(popOverload2, keyParam);
                FunctionType.addParameter(popOverload2, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    hasDeclaredType: true,
                    type: defaultTypeVar,
                    hasDefault: true,
                });
                popOverload2.details.declaredReturnType = combineTypes([valueType, defaultTypeVar]);
                popOverload2.details.typeVarScopeId = typeVarScopeId;
                return [popOverload1, popOverload2];
            };

            const createSetDefaultMethod = (keyType: Type, valueType: Type, isEntryRequired = false) => {
                const setDefaultOverload = FunctionType.createInstance(
                    'setdefault',
                    '',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(setDefaultOverload, selfParam);
                FunctionType.addParameter(setDefaultOverload, {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    hasDeclaredType: true,
                    type: keyType,
                });
                FunctionType.addParameter(setDefaultOverload, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    hasDeclaredType: true,
                    type: isEntryRequired ? AnyType.create() : defaultTypeVar,
                    hasDefault: true,
                });
                setDefaultOverload.details.declaredReturnType = isEntryRequired
                    ? valueType
                    : combineTypes([valueType, defaultTypeVar]);
                setDefaultOverload.details.typeVarScopeId = typeVarScopeId;
                return setDefaultOverload;
            };

            const createDelItemMethod = (keyType: Type) => {
                const delItemOverload = FunctionType.createInstance(
                    'delitem',
                    '',
                    '',
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(delItemOverload, selfParam);
                FunctionType.addParameter(delItemOverload, {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    hasDeclaredType: true,
                    type: keyType,
                });
                delItemOverload.details.declaredReturnType = NoneType.createInstance();
                return delItemOverload;
            };

            const getOverloads: FunctionType[] = [];
            const popOverloads: FunctionType[] = [];
            const setDefaultOverloads: FunctionType[] = [];

            entries.forEach((entry, name) => {
                const nameLiteralType = ObjectType.create(ClassType.cloneWithLiteral(strClass, name));

                if (!entry.isRequired) {
                    getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ false));
                }
                getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ true));
                popOverloads.push(...createPopMethods(nameLiteralType, entry.valueType));
                setDefaultOverloads.push(createSetDefaultMethod(nameLiteralType, entry.valueType, entry.isRequired));
            });

            // Provide a final overload that handles the general case where the key is
            // a str but the literal value isn't known.
            const strType = ObjectType.create(strClass);
            getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ false));
            getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ true));
            popOverloads.push(...createPopMethods(strType, AnyType.create()));
            setDefaultOverloads.push(createSetDefaultMethod(strType, AnyType.create()));

            symbolTable.set(
                'get',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(getOverloads))
            );
            symbolTable.set(
                'pop',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(popOverloads))
            );
            symbolTable.set(
                'setdefault',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(setDefaultOverloads))
            );
            symbolTable.set(
                '__delitem__',
                Symbol.createWithType(SymbolFlags.ClassMember, createDelItemMethod(strType))
            );
        }
    }

    function getTypingType(node: ParseNode, symbolName: string): Type | undefined {
        const fileInfo = getFileInfo(node);
        return getTypeFromTypeshedModule(symbolName, fileInfo.typingModulePath);
    }

    function getTypeshedType(node: ParseNode, symbolName: string): Type | undefined {
        const fileInfo = getFileInfo(node);
        return getTypeFromTypeshedModule(symbolName, fileInfo.typeshedModulePath);
    }

    function getTypeFromTypeshedModule(symbolName: string, importPath: string | undefined) {
        if (!importPath) {
            return undefined;
        }

        const lookupResult = importLookup(importPath);
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
            return false;
        }

        if (!isFlowNodeReachable(flowNode)) {
            return false;
        }

        return true;
    }

    function isAfterNodeReachable(node: ParseNode): boolean {
        const returnFlowNode = AnalyzerNodeInfo.getAfterFlowNode(node);
        if (!returnFlowNode) {
            return false;
        }

        if (!isFlowNodeReachable(returnFlowNode)) {
            return false;
        }

        if (!isFlowNodeReachableUsingNeverNarrowing(node, returnFlowNode)) {
            return false;
        }

        return true;
    }

    // Although isFlowNodeReachable indicates that the node is reachable, it
    // may not be reachable if we apply "never narrowing".
    function isFlowNodeReachableUsingNeverNarrowing(node: ParseNode, flowNode: FlowNode) {
        const analyzer = getCodeFlowAnalyzerForNode(node.id);
        const codeFlowResult = getTypeFromCodeFlow(
            analyzer,
            flowNode,
            /* reference */ undefined,
            /* targetSymbolId */ undefined,
            /* initialType */ UnboundType.create()
        );

        return codeFlowResult.type !== undefined;
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
        if (node.parent && node.parent.nodeType === ParseNodeType.Index) {
            const baseType = getTypeOfExpression(node.parent.baseExpression).type;
            if (baseType && isClass(baseType)) {
                if (ClassType.isSpecialBuiltIn(baseType, 'Literal')) {
                    return true;
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
        return (
            suppressedNodeStack.some((suppressedNode) => ParseTreeUtils.isNodeContainedWithin(node, suppressedNode)) ||
            speculativeTypeTracker.isSpeculative(node) ||
            incompleteTypeTracker.isUndoTrackingEnabled()
        );
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
        if (isUnion(type)) {
            doForEachSubtype(type, (subtype) => {
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
        isTypeIncomplete: boolean,
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

                // Replace the assigned type with the (unnarrowed) declared type.
                destType = declaredType;
            } else {
                // Constrain the resulting type to match the declared type.
                destType = narrowTypeBasedOnAssignment(declaredType, type);
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
                    TypeBase.isInstance(destType) &&
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

        writeTypeCache(
            nameNode,
            destType,
            isTypeIncomplete,
            /* expectedType */ undefined,
            /* allowSpeculativeCaching */ false
        );
    }

    function assignTypeToMemberAccessNode(
        target: MemberAccessNode,
        type: Type,
        isTypeIncomplete: boolean,
        srcExpr?: ExpressionNode,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        const baseTypeResult = getTypeOfExpression(target.leftExpression);
        const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);

        // Handle member accesses (e.g. self.x or cls.y).
        if (target.leftExpression.nodeType === ParseNodeType.Name) {
            // Determine whether we're writing to a class or instance member.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

            if (enclosingClassNode) {
                const classTypeResults = getTypeOfClass(enclosingClassNode);

                if (classTypeResults && isClass(classTypeResults.classType)) {
                    if (isObject(baseType)) {
                        if (ClassType.isSameGenericClass(baseType.classType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, isTypeIncomplete, true, srcExpr);
                        }
                    } else if (isClass(baseType)) {
                        if (ClassType.isSameGenericClass(baseType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, isTypeIncomplete, false, srcExpr);
                        }
                    }

                    // Assignments to instance or class variables through "self" or "cls" is not
                    // allowed for protocol classes unless it is also declared within the class.
                    if (ClassType.isProtocolClass(classTypeResults.classType)) {
                        const memberSymbol = classTypeResults.classType.details.fields.get(target.memberName.value);
                        if (memberSymbol) {
                            const classLevelDecls = memberSymbol.getDeclarations().filter((decl) => {
                                return !ParseTreeUtils.getEnclosingFunction(decl.node);
                            });
                            if (classLevelDecls.length === 0) {
                                addError(Localizer.Diagnostic.assignmentInProtocol(), target.memberName);
                            }
                        }
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

        writeTypeCache(
            target.memberName,
            type,
            isTypeIncomplete,
            /* expectedType */ undefined,
            /* allowSpeculativeCaching */ false
        );
        writeTypeCache(
            target,
            type,
            isTypeIncomplete,
            /* expectedType */ undefined,
            /* allowSpeculativeCaching */ false
        );
    }

    function assignTypeToMemberVariable(
        node: MemberAccessNode,
        srcType: Type,
        isTypeIncomplete: boolean,
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

            if (!memberInfo && srcExprNode && !isTypeIncomplete) {
                reportPossibleUnknownAssignment(
                    fileInfo.diagnosticRuleSet.reportUnknownMemberType,
                    DiagnosticRule.reportUnknownMemberType,
                    node.memberName,
                    srcType,
                    node,
                    /* ignoreEmptyContainers */ true
                );
            }
        }
    }

    function assignTypeToTupleNode(target: TupleNode, type: Type, isTypeIncomplete: boolean, srcExpr: ExpressionNode) {
        // Initialize the array of target types, one for each target.
        const targetTypes: ConstrainedSubtype[][] = new Array(target.expressions.length);
        for (let i = 0; i < target.expressions.length; i++) {
            targetTypes[i] = [];
        }

        // Do any of the targets use an unpack operator? If so, it will consume all of the
        // entries at that location.
        const unpackIndex = target.expressions.findIndex((expr) => expr.nodeType === ParseNodeType.Unpack);

        doForEachSubtype(type, (subtype, index, constraints) => {
            // Is this subtype a tuple?
            const tupleType = getSpecializedTupleType(subtype);
            if (tupleType && tupleType.tupleTypeArguments) {
                const sourceEntryTypes = tupleType.tupleTypeArguments;
                const sourceEntryCount = sourceEntryTypes.length;

                // Is this a homogenous tuple of indeterminate length?
                if (isOpenEndedTupleClass(tupleType)) {
                    for (let index = 0; index < target.expressions.length; index++) {
                        targetTypes[index].push({ type: sourceEntryTypes[0], constraints });
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
                                targetTypes[targetIndex].push({ type: sourceEntryTypes[sourceIndex], constraints });
                                sourceIndex++;
                                entriesToPack--;
                            }
                        } else {
                            if (sourceIndex >= sourceEntryCount) {
                                // No more source entries to assign.
                                break;
                            }

                            targetTypes[targetIndex].push({ type: sourceEntryTypes[sourceIndex], constraints });
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
                const iterableType = getTypeFromIterator(subtype, /* isAsync */ false, srcExpr) || UnknownType.create();
                for (let index = 0; index < target.expressions.length; index++) {
                    targetTypes[index].push({ type: iterableType, constraints });
                }
            }
        });

        // Assign the resulting types to the individual names in the tuple target expression.
        target.expressions.forEach((expr, index) => {
            const typeList = targetTypes[index];
            let targetType = typeList.length === 0 ? UnknownType.create() : combineConstrainedTypes(typeList);
            targetType = removeNoReturnFromUnion(targetType);

            // If the target uses an unpack operator, wrap the target type in a list.
            if (index === unpackIndex) {
                const listType = getBuiltInType(expr, 'list');
                if (isClass(listType)) {
                    targetType = ObjectType.create(
                        ClassType.cloneForSpecialization(listType, [targetType], /* isTypeArgumentExplicit */ true)
                    );
                }
            }

            assignTypeToExpression(expr, targetType, isTypeIncomplete, srcExpr, /* ignoreEmptyContainers */ true);
        });

        writeTypeCache(target, type, isTypeIncomplete);
    }

    // Replaces all of the top-level TypeVars (as opposed to TypeVars
    // used as type arguments in other types) with their concrete form.
    function makeTopLevelTypeVarsConcrete(type: Type): Type {
        return mapSubtypes(type, (subtype) => {
            if (isTypeVar(subtype) && !subtype.details.recursiveTypeAliasName) {
                if (subtype.details.boundType) {
                    return TypeBase.isInstantiable(subtype)
                        ? convertToInstantiable(subtype.details.boundType)
                        : convertToInstance(subtype.details.boundType);
                }

                // If this is a recursive type alias placeholder
                // that hasn't yet been resolved, return it as is.
                if (subtype.details.recursiveTypeAliasName) {
                    return subtype;
                }

                if (subtype.details.constraints.length > 0) {
                    const constrainedTypes = subtype.details.constraints.map((constraintType, constraintIndex) => {
                        return {
                            type: constraintType,
                            constraints: [
                                {
                                    typeVarName: TypeVarType.getNameWithScope(subtype),
                                    constraintIndex,
                                },
                            ],
                        };
                    });

                    return combineConstrainedTypes(constrainedTypes);
                }

                // Convert to an "object" or "type" instance depending on whether
                // it's instantiable.
                if (TypeBase.isInstantiable(subtype)) {
                    return typeClassType && isClass(typeClassType)
                        ? ObjectType.create(typeClassType)
                        : AnyType.create();
                }

                return objectType || AnyType.create();
            }

            return subtype;
        });
    }

    function mapSubtypesExpandTypeVars(
        type: Type,
        constraintFilter: SubtypeConstraints | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type, constraints: SubtypeConstraints) => Type | undefined
    ): Type {
        const newSubtypes: ConstrainedSubtype[] = [];
        let typeChanged = false;

        const expandSubtype = (unexpandedType: Type, constraints: SubtypeConstraints) => {
            const expandedType = isUnion(unexpandedType)
                ? unexpandedType
                : makeTopLevelTypeVarsConcrete(unexpandedType);

            if (isUnion(expandedType)) {
                expandedType.subtypes.forEach((subtype, index) => {
                    const subtypeConstraints = expandedType.constraints ? expandedType.constraints[index] : constraints;
                    if (constraintFilter) {
                        if (!SubtypeConstraint.isCompatible(subtypeConstraints, constraintFilter)) {
                            return undefined;
                        }
                    }

                    const transformedType = callback(subtype, unexpandedType, subtypeConstraints);
                    if (transformedType !== unexpandedType) {
                        typeChanged = true;
                    }
                    if (transformedType) {
                        newSubtypes.push({ type: transformedType, constraints: subtypeConstraints });
                    }
                    return undefined;
                });
            } else {
                const transformedType = callback(expandedType, unexpandedType, constraints);
                if (transformedType !== unexpandedType) {
                    typeChanged = true;
                }

                if (transformedType) {
                    newSubtypes.push({ type: transformedType, constraints: constraints });
                }
            }
        };

        if (isUnion(type)) {
            type.subtypes.forEach((subtype, index) => {
                expandSubtype(subtype, type.constraints ? type.constraints[index] : undefined);
            });
        } else {
            expandSubtype(type, /* constraints */ undefined);
        }

        return typeChanged ? combineConstrainedTypes(newSubtypes) : type;
    }

    function markNamesAccessed(node: ParseNode, names: string[]) {
        const fileInfo = getFileInfo(node);
        const scope = ScopeUtils.getScopeForNode(node);

        if (scope) {
            names.forEach((symbolName) => {
                const symbolInScope = scope.lookUpSymbolRecursive(symbolName);
                if (symbolInScope) {
                    setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
                }
            });
        }
    }

    function assignTypeToExpression(
        target: ExpressionNode,
        type: Type,
        isTypeIncomplete: boolean,
        srcExpr: ExpressionNode,
        ignoreEmptyContainers = false,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        // Is the source expression a TypeVar() call?
        if (isTypeVar(type)) {
            if (srcExpr && srcExpr.nodeType === ParseNodeType.Call) {
                const callType = getTypeOfExpression(srcExpr.leftExpression).type;
                if (
                    isClass(callType) &&
                    (ClassType.isBuiltIn(callType, 'TypeVar') ||
                        ClassType.isBuiltIn(callType, 'TypeVarTuple') ||
                        ClassType.isBuiltIn(callType, 'ParamSpec'))
                ) {
                    if (target.nodeType !== ParseNodeType.Name || target.value !== type.details.name) {
                        addError(
                            type.details.isParamSpec
                                ? Localizer.Diagnostic.paramSpecAssignedName().format({
                                      name: TypeVarType.getReadableName(type),
                                  })
                                : Localizer.Diagnostic.typeVarAssignedName().format({
                                      name: TypeVarType.getReadableName(type),
                                  }),
                            target
                        );
                    }
                }
            }
        }

        // If the type was partially unbound, an error will have already been logged.
        // Remove the unbound before assigning to the target expression so the unbound
        // error doesn't propagate.
        type = removeUnbound(type);

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                if (!isTypeIncomplete) {
                    reportPossibleUnknownAssignment(
                        getFileInfo(target).diagnosticRuleSet.reportUnknownVariableType,
                        DiagnosticRule.reportUnknownVariableType,
                        target,
                        type,
                        target,
                        ignoreEmptyContainers
                    );
                }

                assignTypeToNameNode(target, type, isTypeIncomplete, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.MemberAccess: {
                assignTypeToMemberAccessNode(target, type, isTypeIncomplete, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(
                    target.baseExpression,
                    undefined,
                    EvaluatorFlags.DoNotSpecialize
                );

                getTypeFromIndexWithBaseType(
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

                writeTypeCache(target, type, isTypeIncomplete);
                break;
            }

            case ParseNodeType.Tuple: {
                assignTypeToTupleNode(target, type, isTypeIncomplete, srcExpr);
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                const annotationType: Type | undefined = getTypeOfAnnotation(
                    target.typeAnnotation,
                    /* isVariableAnnotation */ true,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(target.valueExpression)
                );

                // Handle a bare "Final" in a special manner.
                if (!isObject(annotationType) || !ClassType.isBuiltIn(annotationType.classType, 'Final')) {
                    const isTypeAliasAnnotation =
                        isObject(annotationType) && ClassType.isBuiltIn(annotationType.classType, 'TypeAlias');

                    if (!isTypeAliasAnnotation) {
                        if (canAssignType(annotationType, type, new DiagnosticAddendum())) {
                            // Don't attempt to narrow based on the annotated type if the type
                            // is a enum because the annotated type in an enum doesn't reflect
                            // the type of the symbol.
                            if (!isObject(type) || !ClassType.isEnumClass(type.classType)) {
                                type = narrowTypeBasedOnAssignment(annotationType, type);
                            }
                        }
                    }
                }

                assignTypeToExpression(
                    target.valueExpression,
                    type,
                    /* isIncomplete */ false,
                    srcExpr,
                    ignoreEmptyContainers,
                    expectedTypeDiagAddendum
                );
                break;
            }

            case ParseNodeType.Unpack: {
                if (target.expression.nodeType === ParseNodeType.Name) {
                    assignTypeToNameNode(target.expression, type, /* isIncomplete */ false, srcExpr);
                }
                break;
            }

            case ParseNodeType.List: {
                // The assigned expression had better be some iterable type.
                const iteratedType = getTypeFromIterator(type, /* isAsync */ false, srcExpr) || UnknownType.create();

                target.entries.forEach((entry) => {
                    assignTypeToExpression(
                        entry,
                        iteratedType,
                        /* isIncomplete */ false,
                        srcExpr,
                        ignoreEmptyContainers
                    );
                });
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                if (target.child) {
                    suppressDiagnostics(target.child, () => {
                        getTypeOfExpression(target.child!);
                    });
                }
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
            const exceptionType = getTypeOfExpression(node.typeExpression).type;

            // Validate that the argument of "raise" is an exception object or class.
            // If it is a class, validate that the class's constructor accepts zero
            // arguments.
            if (exceptionType && baseExceptionType && isClass(baseExceptionType)) {
                const diagAddendum = new DiagnosticAddendum();

                doForEachSubtype(exceptionType, (subtype) => {
                    const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

                    if (!isAnyOrUnknown(concreteSubtype)) {
                        if (isClass(concreteSubtype) && concreteSubtype.literalValue === undefined) {
                            if (
                                !derivesFromClassRecursive(
                                    concreteSubtype,
                                    baseExceptionType,
                                    /* ignoreUnknown */ false
                                )
                            ) {
                                diagAddendum.addMessage(
                                    Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                        type: printType(subtype, /* expandTypeAlias */ false),
                                    })
                                );
                            } else {
                                let callResult: CallResult | undefined;
                                suppressDiagnostics(node.typeExpression!, () => {
                                    callResult = validateConstructorArguments(
                                        node.typeExpression!,
                                        [],
                                        concreteSubtype,
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
                        } else if (isObject(concreteSubtype)) {
                            if (
                                !derivesFromClassRecursive(
                                    concreteSubtype.classType,
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
                getTypeOfExpression(node, /* expectedType */ undefined, EvaluatorFlags.SkipUnboundCheck);
                break;
            }

            case ParseNodeType.MemberAccess: {
                const baseTypeResult = getTypeOfExpression(node.leftExpression);
                const memberType = getTypeFromMemberAccessWithBaseType(
                    node,
                    baseTypeResult,
                    { method: 'del' },
                    EvaluatorFlags.SkipUnboundCheck
                );
                writeTypeCache(node.memberName, memberType.type, /* isIncomplete */ false);
                writeTypeCache(node, memberType.type, /* isIncomplete */ false);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(
                    node.baseExpression,
                    undefined,
                    EvaluatorFlags.DoNotSpecialize
                );
                getTypeFromIndexWithBaseType(
                    node,
                    baseTypeResult.type,
                    { method: 'del' },
                    EvaluatorFlags.SkipUnboundCheck
                );
                writeTypeCache(node, UnboundType.create(), /* isIncomplete */ false);
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                if (node.child) {
                    suppressDiagnostics(node.child, () => {
                        getTypeOfExpression(node.child!, /* expectedType */ undefined, EvaluatorFlags.SkipUnboundCheck);
                    });
                }
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
        if (!speculativeTypeTracker.isSpeculative(node) && !incompleteTypeTracker.isUndoTrackingEnabled()) {
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
                const typeVarMap = buildTypeVarMapFromSpecializedClass(mroClass, /* makeConcrete */ false);
                const dataClassEntries = ClassType.getDataClassEntries(mroClass);

                // Add the entries to the end of the list, replacing same-named
                // entries if found.
                dataClassEntries.forEach((entry) => {
                    const existingIndex = entries.findIndex((e) => e.name === entry.name);

                    // If the type from the parent class is generic, we need to convert
                    // to the type parameter namespace of child class.
                    const updatedEntry = { ...entry };
                    updatedEntry.type = applySolvedTypeVars(updatedEntry.type, typeVarMap);

                    if (existingIndex >= 0) {
                        entries[existingIndex] = updatedEntry;
                    } else {
                        entries.push(updatedEntry);
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

    function getSpecializedReturnType(
        objType: ObjectType,
        memberName: string,
        errorNode: ParseNode | undefined,
        bindToClass?: ClassType
    ) {
        const classMember = lookUpObjectMember(objType, memberName, ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (isFunction(memberType)) {
            const methodType = bindFunctionToClassOrObject(
                bindToClass || objType,
                memberType,
                classMember && isClass(classMember.classType) ? classMember.classType : undefined,
                errorNode,
                /* recursionCount */ undefined,
                /* treatConstructorAsClassMember */ false,
                /* firstParamType */ bindToClass
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
        let isIncomplete = false;
        const allowForwardReferences = (flags & EvaluatorFlags.AllowForwardReferences) !== 0 || fileInfo.isStubFile;

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

            const symbol = symbolWithScope.symbol;

            // Get the effective type (either the declared type or the inferred type).
            // If we're using code flow analysis, pass the usage node so we consider
            // only the assignment nodes that are reachable from this usage.
            const effectiveTypeInfo = getEffectiveTypeOfSymbolForUsage(symbol, useCodeFlowAnalysis ? node : undefined);
            const effectiveType = effectiveTypeInfo.type;

            if (effectiveTypeInfo.isIncomplete) {
                isIncomplete = true;
            }

            if (effectiveTypeInfo.isRecursiveDefinition && isNodeReachable(node)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.recursiveDefinition().format({ name }),
                    node
                );
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
                const codeFlowTypeResult = getFlowTypeOfReference(node, symbol.id, typeAtStart);
                if (codeFlowTypeResult.type) {
                    type = codeFlowTypeResult.type;
                }

                if (codeFlowTypeResult.isIncomplete) {
                    isIncomplete = true;
                }
            }

            if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
                if (isClass(type)) {
                    if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
                        if (requiresTypeArguments(type) && !type.typeArguments) {
                            addDiagnostic(
                                fileInfo.diagnosticRuleSet.reportMissingTypeArgument,
                                DiagnosticRule.reportMissingTypeArgument,
                                Localizer.Diagnostic.typeArgsMissingForClass().format({
                                    name: type.aliasName || type.details.name,
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
                    type = transformTypeObjectToClass(type);
                }

                if (
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
                            name: type.typeAliasInfo.name,
                        }),
                        node
                    );
                }
            }

            // If there is a resolution cycle, don't report it as an unbound symbol
            // at this time. It will be re-evaluated as the call stack unwinds, and
            // its actual type will be known then. Also, if the node is unreachable
            // but within a reachable statement (e.g. if False and <name>) then avoid
            // reporting an unbound error.
            if (!isIncomplete && !AnalyzerNodeInfo.isCodeUnreachable(node)) {
                if ((flags & EvaluatorFlags.SkipUnboundCheck) === 0) {
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
            }

            setSymbolAccessed(fileInfo, symbol, node);

            if ((flags & EvaluatorFlags.ExpectingTypeAnnotation) !== 0) {
                // Verify that the name does not refer to a (non type alias) variable.
                if (effectiveTypeInfo.includesVariableDecl && !type.typeAliasInfo) {
                    // Disable for TypeVar and Unknown types as well as assignments
                    // in the typings.pyi file, since it defines special forms.
                    if (
                        !isTypeAliasPlaceholder(type) &&
                        !isTypeVar(type) &&
                        !isUnknown(type) &&
                        !fileInfo.isTypingStubFile
                    ) {
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typeAnnotationVariable(),
                            node
                        );
                    }
                }
            }
        } else {
            // Handle the special case of "reveal_type" and "reveal_locals".
            if (name !== 'reveal_type' && name !== 'reveal_locals') {
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportUndefinedVariable,
                    DiagnosticRule.reportUndefinedVariable,
                    Localizer.Diagnostic.symbolIsUndefined().format({ name }),
                    node
                );
            }
            type = UnknownType.create();
        }

        if (isParamSpec(type)) {
            if (flags & EvaluatorFlags.ParamSpecDisallowed) {
                addError(Localizer.Diagnostic.paramSpecContext(), node);
                type = UnknownType.create();
            }
        }

        if (isTypeVar(type) && (flags & EvaluatorFlags.ExpectingType) === 0 && type.details.name === name) {
            // A TypeVar in contexts where we're not expecting a type is
            // simply a TypeVar or TypeVarTuple object.
            const typeVarType = type.details.isVariadic
                ? getTypingType(node, 'TypeVarTuple')
                : getTypingType(node, 'TypeVar');
            if (typeVarType && isClass(typeVarType)) {
                type = ObjectType.create(typeVarType);
            } else {
                type = UnknownType.create();
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
        if (isTypeVar(type)) {
            if (TypeBase.isInstantiable(type) && !isTypeAliasPlaceholder(type)) {
                const scopedTypeVarInfo = findScopedTypeVar(node, type);
                type = scopedTypeVarInfo.type;

                if ((flags & EvaluatorFlags.DisallowTypeVarsWithScopeId) !== 0 && type.scopeId !== undefined) {
                    if (!type.details.isSynthesized && !type.details.isParamSpec) {
                        addDiagnostic(
                            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typeVarUsedByOuterScope().format({ name: type.details.name }),
                            node
                        );
                    }
                } else if ((flags & EvaluatorFlags.AssociateTypeVarsWithCurrentScope) !== 0) {
                    if (type.scopeId === undefined) {
                        if (!scopedTypeVarInfo.foundInterveningClass) {
                            let enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(node);

                            // Handle P.args and P.kwargs as a special case for inner functions.
                            if (
                                enclosingScope &&
                                node.parent?.nodeType === ParseNodeType.MemberAccess &&
                                node.parent.leftExpression === node
                            ) {
                                const memberName = node.parent.memberName.value;
                                if (memberName === 'args' || memberName === 'kwargs') {
                                    const outerFunctionScope = ParseTreeUtils.getEnclosingClassOrFunction(
                                        enclosingScope
                                    );

                                    if (outerFunctionScope?.nodeType === ParseNodeType.Function) {
                                        enclosingScope = outerFunctionScope;
                                    } else if (!scopedTypeVarInfo.type.scopeId) {
                                        addDiagnostic(
                                            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                                            DiagnosticRule.reportGeneralTypeIssues,
                                            Localizer.Diagnostic.paramSpecNotUsedByOuterScope().format({
                                                name: type.details.name,
                                            }),
                                            node
                                        );
                                    }
                                }
                            }

                            if (enclosingScope) {
                                type = TypeVarType.cloneForScopeId(
                                    type,
                                    getScopeIdForNode(enclosingScope),
                                    enclosingScope.name.value
                                );
                            } else {
                                fail('AssociateTypeVarsWithCurrentScope flag was set but enclosing scope not found');
                            }
                        } else {
                            addDiagnostic(
                                getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.typeVarUsedByOuterScope().format({ name: type.details.name }),
                                node
                            );
                        }
                    }
                } else if ((flags & EvaluatorFlags.DisallowTypeVarsWithoutScopeId) !== 0) {
                    if (
                        (type.scopeId === undefined || scopedTypeVarInfo.foundInterveningClass) &&
                        !type.details.isSynthesized
                    ) {
                        const message = isParamSpec(type)
                            ? Localizer.Diagnostic.paramSpecNotUsedByOuterScope()
                            : Localizer.Diagnostic.typeVarNotUsedByOuterScope();
                        addDiagnostic(
                            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            message.format({ name: type.details.name }),
                            node
                        );
                    }
                }
            }

            // If this type var is variadic, the name refers to the packed form. It
            // must be unpacked in most contexts.
            if (type.isVariadicUnpacked) {
                type = TypeVarType.cloneForPacked(type);
            }
        }

        return { type, node, isIncomplete };
    }

    // Creates an ID that identifies this parse node in a way that will
    // not change each time the file is parsed (unless, of course, the
    // file contents change).
    function getScopeIdForNode(node: ParseNode): string {
        const fileInfo = getFileInfo(node);
        return `${fileInfo.filePath}.${node.start.toString()}`;
    }

    // Walks up the parse tree and finds all scopes that can provide
    // a context for a TypeVar and returns the scope ID for each.
    function getTypeVarScopesForNode(node: ParseNode): TypeVarScopeId[] {
        const scopeIds: TypeVarScopeId[] = [];

        let curNode: ParseNode | undefined = node;
        while (curNode) {
            curNode = ParseTreeUtils.getTypeVarScopeNode(curNode);
            if (!curNode) {
                break;
            }

            scopeIds.push(getScopeIdForNode(curNode));
            curNode = curNode.parent;
        }

        return scopeIds;
    }

    // Walks up the parse tree to find a function, class, or type alias
    // assignment that provides the context for a type variable.
    function findScopedTypeVar(
        node: NameNode,
        type: TypeVarType
    ): { type: TypeVarType; foundInterveningClass: boolean } {
        let curNode: ParseNode | undefined = node;
        let nestedClassCount = 0;

        assert(TypeBase.isInstantiable(type));

        while (curNode) {
            // Generally, getTypeVarScopeNode should not include the function
            // that contains the TypeVar in its signature, but we make an exception
            // for TypeVars that are used in a member access expression to accommodate
            // ParamSpecs (P.args and P.kwargs).
            curNode = ParseTreeUtils.getTypeVarScopeNode(curNode, node.parent?.nodeType === ParseNodeType.MemberAccess);
            if (!curNode) {
                break;
            }

            let typeVarsForScope: TypeVarType[] | undefined;

            if (curNode.nodeType === ParseNodeType.Class) {
                const classTypeInfo = getTypeOfClass(curNode);
                if (classTypeInfo) {
                    typeVarsForScope = classTypeInfo.classType.details.typeParameters;
                }

                nestedClassCount++;
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

                if (match && match.scopeId) {
                    return {
                        type: nestedClassCount > 1 ? type : (convertToInstantiable(match) as TypeVarType),
                        foundInterveningClass: nestedClassCount > 1,
                    };
                }
            }

            curNode = curNode.parent;
        }

        // See if this is part of an assignment statement that is defining a type alias.
        curNode = node;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Assignment) {
                const leftType = readTypeCache(curNode.leftExpression);

                // Is this a placeholder that was temporarily written to the cache for
                // purposes of resolving type aliases?
                if (
                    leftType &&
                    isTypeVar(leftType) &&
                    leftType.details.recursiveTypeAliasScopeId &&
                    leftType.details.recursiveTypeAliasName
                ) {
                    return {
                        type: TypeVarType.cloneForScopeId(
                            type,
                            leftType.details.recursiveTypeAliasScopeId,
                            leftType.details.recursiveTypeAliasName
                        ),
                        foundInterveningClass: false,
                    };
                }
            }

            curNode = curNode.parent;
        }

        // Return the original type.
        return { type, foundInterveningClass: false };
    }

    function getTypeFromMemberAccess(node: MemberAccessNode, flags: EvaluatorFlags): TypeResult {
        const baseTypeFlags =
            EvaluatorFlags.DoNotSpecialize |
            (flags &
                (EvaluatorFlags.ExpectingType |
                    EvaluatorFlags.ExpectingTypeAnnotation |
                    EvaluatorFlags.VariableTypeAnnotation |
                    EvaluatorFlags.AllowForwardReferences |
                    EvaluatorFlags.DisallowTypeVarsWithScopeId |
                    EvaluatorFlags.DisallowTypeVarsWithoutScopeId |
                    EvaluatorFlags.AssociateTypeVarsWithCurrentScope));
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, baseTypeFlags);

        if (isTypeAliasPlaceholder(baseTypeResult.type)) {
            return {
                node,
                type: UnknownType.create(),
                isIncomplete: true,
            };
        }

        const memberTypeResult = getTypeFromMemberAccessWithBaseType(node, baseTypeResult, { method: 'get' }, flags);

        if (isCodeFlowSupportedForReference(node)) {
            // Before performing code flow analysis, update the cache to prevent recursion.
            writeTypeCache(node, memberTypeResult.type, /* isIncomplete */ false);
            writeTypeCache(node.memberName, memberTypeResult.type, /* isIncomplete */ false);

            // If the type is initially unbound, see if there's a parent class that
            // potentially initialized the value.
            let initialType = memberTypeResult.type;
            if (isUnbound(initialType)) {
                const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);

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
            const codeFlowTypeResult = getFlowTypeOfReference(node, indeterminateSymbolId, initialType);
            if (codeFlowTypeResult.type) {
                memberTypeResult.type = codeFlowTypeResult.type;
            }

            if (codeFlowTypeResult.isIncomplete) {
                memberTypeResult.isIncomplete = true;
            }

            deleteTypeCacheEntry(node);
            deleteTypeCacheEntry(node.memberName);
        }

        if (baseTypeResult.isIncomplete) {
            memberTypeResult.isIncomplete = true;
        }

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
        let isIncomplete = false;

        switch (baseType.category) {
            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                type = baseType;
                break;
            }

            case TypeCategory.Never: {
                type = UnknownType.create();
                break;
            }

            case TypeCategory.Class: {
                const typeResult = getTypeFromClassMember(
                    node.memberName,
                    baseType,
                    memberName,
                    usage,
                    diag,
                    MemberAccessFlags.None,
                    baseTypeResult.bindToType
                );
                type = typeResult?.type;
                if (typeResult?.isIncomplete) {
                    isIncomplete = true;
                }
                break;
            }

            case TypeCategory.TypeVar: {
                if (baseType.details.isParamSpec) {
                    if (memberName === 'args') {
                        if (
                            node.parent?.nodeType !== ParseNodeType.Parameter ||
                            node.parent.category !== ParameterCategory.VarArgList
                        ) {
                            addError(Localizer.Diagnostic.paramSpecArgsUsage(), node);
                            return { type: UnknownType.create(), node };
                        }
                        return { type: baseType, node };
                    }

                    if (memberName === 'kwargs') {
                        if (
                            node.parent?.nodeType !== ParseNodeType.Parameter ||
                            node.parent.category !== ParameterCategory.VarArgDictionary
                        ) {
                            addError(Localizer.Diagnostic.paramSpecKwargsUsage(), node);
                            return { type: UnknownType.create(), node };
                        }
                        return { type: baseType, node };
                    }

                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.paramSpecUnknownMember().format({ name: memberName }),
                        node
                    );
                    return { type: UnknownType.create(), node };
                }

                if (flags & EvaluatorFlags.ExpectingType) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeVarNoMember().format({ type: printType(baseType), name: memberName }),
                        node.leftExpression
                    );

                    return { type: UnknownType.create(), node };
                }

                if (baseType.details.recursiveTypeAliasName) {
                    return { type: UnknownType.create(), node, isIncomplete: true };
                }

                return getTypeFromMemberAccessWithBaseType(
                    node,
                    {
                        type: makeTopLevelTypeVarsConcrete(baseType),
                        node,
                        bindToType: baseType,
                    },
                    usage,
                    EvaluatorFlags.None
                );
            }

            case TypeCategory.Object: {
                const classFromTypeObject = transformTypeObjectToClass(baseType);
                if (TypeBase.isInstantiable(classFromTypeObject)) {
                    // Handle the case where the object is a 'type' object, which
                    // represents a class.
                    return getTypeFromMemberAccessWithBaseType(
                        node,
                        { type: classFromTypeObject, node: baseTypeResult.node, bindToType: baseTypeResult.bindToType },
                        usage,
                        flags
                    );
                }

                // Handle the special case of 'name' and 'value' members within an enum.
                if (
                    ClassType.isEnumClass(baseType.classType) &&
                    baseType.classType.literalValue instanceof EnumLiteral
                ) {
                    if (memberName === 'name' || memberName === '_name_') {
                        const strClass = getBuiltInType(node, 'str');
                        if (isClass(strClass)) {
                            return {
                                node,
                                type: ObjectType.create(
                                    ClassType.cloneWithLiteral(strClass, baseType.classType.literalValue.itemName)
                                ),
                            };
                        }
                    } else if (memberName === 'value' || memberName === '_value_') {
                        return { node, type: baseType.classType.literalValue.itemType };
                    }
                }

                const typeResult = getTypeFromObjectMember(
                    node.memberName,
                    baseType,
                    memberName,
                    usage,
                    diag,
                    /* memberAccessFlags */ undefined,
                    baseTypeResult.bindToType
                );
                type = typeResult?.type;
                if (typeResult?.isIncomplete) {
                    isIncomplete = true;
                }
                break;
            }

            case TypeCategory.Module: {
                const symbol = ModuleType.getField(baseType, memberName);
                if (symbol) {
                    if (usage.method === 'get') {
                        setSymbolAccessed(getFileInfo(node), symbol, node.memberName);
                    }

                    type = getEffectiveTypeOfSymbolForUsage(symbol, /* usageNode */ undefined, /* useLastDecl */ true)
                        .type;

                    // If the type resolved to "unbound", treat it as "unknown" in
                    // the case of a module reference because if it's truly unbound,
                    // that error will be reported within the module and should not
                    // leak into other modules that import it.
                    if (isUnbound(type)) {
                        type = UnknownType.create();
                    }
                } else {
                    // Does the module export a top-level __getattr__ function?
                    if (usage.method === 'get') {
                        const getAttrSymbol = ModuleType.getField(baseType, '__getattr__');
                        if (getAttrSymbol) {
                            const isModuleGetAttrSupported =
                                fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_7 ||
                                getAttrSymbol
                                    .getDeclarations()
                                    .some((decl) => decl.path.toLowerCase().endsWith('.pyi'));

                            if (isModuleGetAttrSupported) {
                                const getAttrTypeResult = getEffectiveTypeOfSymbolForUsage(getAttrSymbol);
                                if (isFunction(getAttrTypeResult.type)) {
                                    type = getFunctionEffectiveReturnType(getAttrTypeResult.type);
                                    if (getAttrTypeResult.isIncomplete) {
                                        isIncomplete = true;
                                    }
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
                type = mapSubtypes(baseType, (subtype) => {
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
                const functionObj = getBuiltInObject(node, 'function');

                // The "__defaults__" member is not currently defined in the "function"
                // class, so we'll special-case it here.
                if (functionObj && memberName !== '__defaults__') {
                    type = getTypeFromMemberAccessWithBaseType(node, { type: functionObj, node }, usage, flags).type;
                } else {
                    type = AnyType.create();
                }
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

            const isFunctionRule =
                isFunction(baseType) ||
                isOverloadedFunction(baseType) ||
                (isObject(baseType) && ClassType.isBuiltIn(baseType.classType, 'function'));
            const [ruleSet, rule] = isFunctionRule
                ? [fileInfo.diagnosticRuleSet.reportFunctionMemberAccess, DiagnosticRule.reportFunctionMemberAccess]
                : [fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagnosticRule.reportGeneralTypeIssues];

            addDiagnostic(
                ruleSet,
                rule,
                diagMessage.format({ name: memberName, type: printType(baseType) }) + diag.getString(),
                node.memberName
            );

            // If this is member access on a function, use "Any" so if the
            // reportFunctionMemberAccess rule is disabled, we don't trigger
            // additional reportUnknownMemberType diagnostics.
            type = isFunctionRule ? AnyType.create() : UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (isClass(type) && !type.typeArguments) {
                type = createSpecializedClassType(type, undefined, flags, node);
            }
        }

        if (usage.method === 'get') {
            // Don't report an error if the type is a partially-specialized
            // class. This comes up frequently in cases where a type is passed
            // as an argument (e.g. "defaultdict(list)").
            if (node.parent?.nodeType !== ParseNodeType.Argument || !isClass(type)) {
                if (!isIncomplete) {
                    reportPossibleUnknownAssignment(
                        fileInfo.diagnosticRuleSet.reportUnknownMemberType,
                        DiagnosticRule.reportUnknownMemberType,
                        node.memberName,
                        type,
                        node,
                        /* ignoreEmptyContainers */ false
                    );
                }
            }
        }

        return { type, node, isIncomplete };
    }

    function getTypeFromClassMemberName(
        errorNode: ExpressionNode,
        classType: ClassType,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum,
        flags: MemberAccessFlags,
        bindToType?: ClassType | ObjectType | TypeVarType
    ): ClassMemberLookup | undefined {
        // If this is a special type (like "List") that has an alias class (like
        // "list"), switch to the alias, which defines the members.
        let classLookupFlags = ClassMemberLookupFlags.Default;
        if (flags & MemberAccessFlags.AccessClassMembersOnly) {
            classLookupFlags |= ClassMemberLookupFlags.SkipInstanceVariables;
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classLookupFlags |= ClassMemberLookupFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classLookupFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
        }
        if (flags & MemberAccessFlags.SkipOriginalClass) {
            classLookupFlags |= ClassMemberLookupFlags.SkipOriginalClass;
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
            let type: Type | undefined;
            let isTypeIncomplete = false;

            if (usage.method === 'get') {
                const typeResult = getTypeOfMemberInternal(errorNode, memberInfo);
                if (typeResult) {
                    type = typeResult.type;
                    if (typeResult.isIncomplete) {
                        isTypeIncomplete = true;
                    }
                } else {
                    type = UnknownType.create();
                }
            } else {
                // If the usage indicates a 'set' or 'delete' and the access is within the
                // class definition itself, use only the declared type to avoid circular
                // type evaluation.
                const containingClass = ParseTreeUtils.getEnclosingClass(errorNode);
                if (containingClass) {
                    const containingClassType = getTypeOfClass(containingClass)?.classType;
                    if (
                        containingClassType &&
                        isClass(containingClassType) &&
                        ClassType.isSameGenericClass(containingClassType, classType)
                    ) {
                        type = getDeclaredTypeOfSymbol(memberInfo.symbol) || UnknownType.create();
                        if (type && isClass(memberInfo.classType)) {
                            type = partiallySpecializeType(type, memberInfo.classType);
                        }
                    }
                }

                if (!type) {
                    const typeResult = getTypeOfMemberInternal(errorNode, memberInfo);
                    if (typeResult) {
                        type = typeResult.type;
                        if (typeResult.isIncomplete) {
                            isTypeIncomplete = true;
                        }
                    } else {
                        type = UnknownType.create();
                    }
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

            const objectAccessType = applyDescriptorAccessMethod(
                type,
                memberInfo,
                classType,
                bindToType,
                /* isAccessedThroughObject */ (flags & MemberAccessFlags.AccessClassMembersOnly) === 0,
                flags,
                errorNode,
                memberName,
                usage,
                diag
            );

            if (!objectAccessType) {
                return undefined;
            }
            type = objectAccessType;

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
                    return undefined;
                }

                if (
                    isClass(memberInfo.classType) &&
                    ClassType.isFrozenDataClass(memberInfo.classType) &&
                    (flags & MemberAccessFlags.AccessClassMembersOnly) === 0
                ) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.dataclassFrozen().format({
                            name: printType(ObjectType.create(memberInfo.classType)),
                        })
                    );
                    return undefined;
                }
            }

            return {
                type,
                isTypeIncomplete,
                isClassMember: !memberInfo.isInstanceMember,
            };
        }

        // No attribute of that name was found. If this is a member access
        // through an object, see if there's an attribute access override
        // method ("__getattr__", etc.).
        if (
            (flags & (MemberAccessFlags.AccessClassMembersOnly | MemberAccessFlags.SkipAttributeAccessOverride)) ===
            0
        ) {
            const generalAttrType = applyAttributeAccessOverride(classType, errorNode, usage);

            if (generalAttrType) {
                const objectAccessType = applyDescriptorAccessMethod(
                    generalAttrType,
                    memberInfo,
                    classType,
                    bindToType,
                    /* isAccessedThroughObject */ false,
                    flags,
                    errorNode,
                    memberName,
                    usage,
                    diag
                );

                if (!objectAccessType) {
                    return undefined;
                }

                return {
                    type: objectAccessType,
                    isTypeIncomplete: false,
                    isClassMember: false,
                };
            }
        }

        diag.addMessage(Localizer.DiagnosticAddendum.memberUnknown().format({ name: memberName }));
        return undefined;
    }

    // Applies descriptor access methods "__get__", "__set__", or "__delete__"
    // if they apply. Also binds methods to the class/object through which it
    // is accessed.
    function applyDescriptorAccessMethod(
        type: Type,
        memberInfo: ClassMember | undefined,
        baseTypeClass: ClassType,
        bindToType: ObjectType | ClassType | TypeVarType | undefined,
        isAccessedThroughObject: boolean,
        flags: MemberAccessFlags,
        errorNode: ExpressionNode,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum
    ): Type | undefined {
        const treatConstructorAsClassMember = (flags & MemberAccessFlags.TreatConstructorAsClassMethod) !== 0;
        let isTypeValid = true;

        type = mapSubtypes(type, (subtype) => {
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
                    const argList: FunctionArgument[] = [
                        {
                            // Provide "self" argument.
                            argumentCategory: ArgumentCategory.Simple,
                            type: subtype,
                        },
                        {
                            // Provide "instance" argument.
                            argumentCategory: ArgumentCategory.Simple,
                            type: isAccessedThroughObject
                                ? bindToType || ObjectType.create(baseTypeClass)
                                : NoneType.createInstance(),
                        },
                    ];

                    if (usage.method === 'get') {
                        // Provide "owner" argument.
                        argList.push({
                            argumentCategory: ArgumentCategory.Simple,
                            type: baseTypeClass,
                        });
                    } else if (usage.method === 'set') {
                        // Provide "value" argument.
                        argList.push({
                            argumentCategory: ArgumentCategory.Simple,
                            type: usage.setType,
                        });
                    }

                    if (ClassType.isPropertyClass(subtype.classType) && memberInfo && isClass(memberInfo!.classType)) {
                        // This specialization is required specifically for properties, which should be
                        // generic but are not defined that way. Because of this, we use type variables
                        // in the synthesized methods (e.g. __get__) for the property class that are
                        // defined in the class that declares the fget method.

                        // Infer return types before specializing. Otherwise a generic inferred
                        // return type won't be properly specialized.
                        if (isFunction(accessMethodType)) {
                            getFunctionEffectiveReturnType(accessMethodType);
                        } else if (isOverloadedFunction(accessMethodType)) {
                            accessMethodType.overloads.forEach((overload) => {
                                getFunctionEffectiveReturnType(overload);
                            });
                        }

                        accessMethodType = partiallySpecializeType(accessMethodType, memberInfo.classType);
                    }

                    if (accessMethodType && (isFunction(accessMethodType) || isOverloadedFunction(accessMethodType))) {
                        const methodType = accessMethodType;

                        // Don't emit separate diagnostics for these method calls because
                        // they will be redundant.
                        const returnType = suppressDiagnostics(errorNode, () => {
                            // Bind the accessor to the base object type.
                            const boundMethodType = bindFunctionToClassOrObject(
                                subtype,
                                methodType,
                                memberInfo && isClass(memberInfo.classType) ? memberInfo.classType : undefined,
                                errorNode
                            );

                            if (
                                boundMethodType &&
                                (isFunction(boundMethodType) || isOverloadedFunction(boundMethodType))
                            ) {
                                const callResult = validateCallArguments(
                                    errorNode,
                                    argList.slice(1),
                                    boundMethodType,
                                    new TypeVarMap(getTypeVarScopeId(boundMethodType)),
                                    /* skipUnknownArgCheck */ true
                                );

                                if (callResult.argumentErrors) {
                                    isTypeValid = false;
                                    return AnyType.create();
                                }

                                // For set or delete, always return Any.
                                return usage.method === 'get'
                                    ? callResult.returnType || UnknownType.create()
                                    : AnyType.create();
                            }
                        });

                        if (returnType) {
                            return returnType;
                        }
                    }
                }
            } else if (isFunction(subtype) || isOverloadedFunction(subtype)) {
                // If this function is an instance member (e.g. a lambda that was
                // assigned to an instance variable), don't perform any binding.
                if (!isAccessedThroughObject || !memberInfo?.isInstanceMember) {
                    return bindFunctionToClassOrObject(
                        isAccessedThroughObject ? ObjectType.create(baseTypeClass) : baseTypeClass,
                        subtype,
                        memberInfo && isClass(memberInfo.classType) ? memberInfo.classType : undefined,
                        errorNode,
                        /* recursionCount */ undefined,
                        treatConstructorAsClassMember,
                        bindToType
                    );
                }
            }

            if (usage.method === 'set') {
                if (memberInfo?.symbol.isClassVar()) {
                    if (flags & MemberAccessFlags.DisallowClassVarWrites) {
                        diag.addMessage(Localizer.DiagnosticAddendum.memberSetClassVar().format({ name: memberName }));
                        return undefined;
                    }
                }

                let enforceTargetType = false;

                if (memberInfo && memberInfo.symbol.hasTypedDeclarations()) {
                    // If the member has a declared type, we will enforce it.
                    enforceTargetType = true;
                } else {
                    // If the member has no declared type, we will enforce it
                    // if this assignment isn't within the enclosing class. If
                    // it is within the enclosing class, the assignment is used
                    // to infer the type of the member.
                    if (memberInfo && !memberInfo.symbol.getDeclarations().some((decl) => decl.node === errorNode)) {
                        enforceTargetType = true;
                    }
                }

                if (enforceTargetType) {
                    let effectiveType = subtype;

                    // If the code is patching a method (defined on the class)
                    // with an object-level function, strip the "self" parameter
                    // off the original type. This is sometimes done for test
                    // purposes to override standard behaviors of specific methods.
                    if (isAccessedThroughObject) {
                        if (!memberInfo!.isInstanceMember && isFunction(subtype)) {
                            if (FunctionType.isClassMethod(subtype) || FunctionType.isInstanceMethod(subtype)) {
                                effectiveType = FunctionType.clone(subtype, /* stripFirstParam */ true);
                            }
                        }
                    }

                    return effectiveType;
                }
            }

            return subtype;
        });

        return isTypeValid ? type : undefined;
    }

    // Applies the __getattr__, __setattr__ or __delattr__ method if present.
    function applyAttributeAccessOverride(
        classType: ClassType,
        errorNode: ExpressionNode,
        usage: EvaluatorUsage
    ): Type | undefined {
        if (usage.method === 'get') {
            // See if the class has a "__getattribute__" or "__getattr__" method.
            // If so, arbitrary members are supported.
            const getAttribType = getTypeFromClassMember(
                errorNode,
                classType,
                '__getattribute__',
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipObjectBaseClass
            )?.type;

            if (getAttribType && isFunction(getAttribType)) {
                return getFunctionEffectiveReturnType(getAttribType);
            }

            const getAttrType = getTypeFromClassMember(
                errorNode,
                classType,
                '__getattr__',
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipObjectBaseClass
            )?.type;
            if (getAttrType && isFunction(getAttrType)) {
                return getFunctionEffectiveReturnType(getAttrType);
            }
        } else if (usage.method === 'set') {
            const setAttrType = getTypeFromClassMember(
                errorNode,
                classType,
                '__setattr__',
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipObjectBaseClass
            )?.type;
            if (setAttrType) {
                // The type doesn't matter for a set usage. We just need
                // to return a defined type.
                return AnyType.create();
            }
        } else {
            assert(usage.method === 'del');
            const delAttrType = getTypeFromClassMember(
                errorNode,
                classType,
                '__detattr__',
                { method: 'get' },
                new DiagnosticAddendum(),
                MemberAccessFlags.SkipObjectBaseClass
            )?.type;
            if (delAttrType) {
                // The type doesn't matter for a delete usage. We just need
                // to return a defined type.
                return AnyType.create();
            }
        }

        return undefined;
    }

    function getTypeFromIndex(node: IndexNode, flags = EvaluatorFlags.None): TypeResult {
        const baseTypeResult = getTypeOfExpression(
            node.baseExpression,
            undefined,
            flags | EvaluatorFlags.DoNotSpecialize
        );

        // If this is meant to be a type and the base expression is a string expression,
        // emit an error because this will generate a runtime exception in Python versions
        // less than 3.10.
        if (flags & EvaluatorFlags.ExpectingType) {
            if (node.baseExpression.nodeType === ParseNodeType.StringList) {
                const fileInfo = getFileInfo(node);
                if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_10) {
                    addError(Localizer.Diagnostic.stringNotSubscriptable(), node.baseExpression);
                }
            }
        }

        // Check for builtin classes that will generate runtime exceptions if subscripted.
        if ((flags & EvaluatorFlags.AllowForwardReferences) === 0) {
            // We can skip this check if the class is used within a PEP 526 variable
            // type annotation. For some reason, they don't result in runtime exceptions
            // when used in this manner.
            if ((flags & EvaluatorFlags.VariableTypeAnnotation) === 0) {
                const fileInfo = getFileInfo(node);
                if (
                    isClass(baseTypeResult.type) &&
                    ClassType.isBuiltIn(baseTypeResult.type) &&
                    !baseTypeResult.type.aliasName
                ) {
                    const minPythonVersion = nonSubscriptableBuiltinTypes[baseTypeResult.type.details.fullName];
                    if (
                        minPythonVersion !== undefined &&
                        fileInfo.executionEnvironment.pythonVersion < minPythonVersion &&
                        !fileInfo.isStubFile
                    ) {
                        addError(
                            Localizer.Diagnostic.classNotRuntimeSubscriptable().format({
                                name: baseTypeResult.type.aliasName || baseTypeResult.type.details.name,
                            }),
                            node.baseExpression
                        );
                    }
                }
            }
        }

        const indexTypeResult = getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'get' }, flags);

        if (isCodeFlowSupportedForReference(node)) {
            // Before performing code flow analysis, update the cache to prevent recursion.
            writeTypeCache(node, indexTypeResult.type, /* isIncomplete */ false);

            // See if we can refine the type based on code flow analysis.
            const codeFlowTypeResult = getFlowTypeOfReference(node, indeterminateSymbolId, indexTypeResult.type);
            if (codeFlowTypeResult.type) {
                indexTypeResult.type = codeFlowTypeResult.type;
            }

            if (codeFlowTypeResult.isIncomplete) {
                indexTypeResult.isIncomplete = true;
            }

            deleteTypeCacheEntry(node);
        }

        if (baseTypeResult.isIncomplete) {
            indexTypeResult.isIncomplete = true;
        }

        return indexTypeResult;
    }

    function adjustTypeArgumentsForVariadicTypeVar(
        typeArgs: TypeResult[],
        typeParameters: TypeVarType[]
    ): TypeResult[] {
        const variadicIndex = typeParameters.findIndex((param) => isVariadicTypeVar(param));

        // Do we need to adjust the type arguments to map to a variadic type
        // param at the end of the list?
        if (variadicIndex >= 0) {
            if (tupleClassType && isClass(tupleClassType)) {
                const variadicTypeResults = typeArgs.slice(
                    variadicIndex,
                    variadicIndex + 1 + typeArgs.length - typeParameters.length
                );

                // If the type args consist of a lone variadic type variable, don't wrap it in a tuple.
                if (variadicTypeResults.length === 1 && isVariadicTypeVar(variadicTypeResults[0].type)) {
                    validateVariadicTypeVarIsUnpacked(variadicTypeResults[0].type, variadicTypeResults[0].node);
                } else {
                    variadicTypeResults.forEach((arg, index) => {
                        validateTypeArg(arg, /* allowEmptyTuple */ index === 0);
                    });

                    const variadicTypes: Type[] =
                        variadicTypeResults.length === 1 && variadicTypeResults[0].isEmptyTupleShorthand
                            ? []
                            : variadicTypeResults.map((typeResult) => convertToInstance(typeResult.type));

                    const tupleObject = convertToInstance(
                        specializeTupleClass(
                            tupleClassType,
                            variadicTypes,
                            /* isTypeArgumentExplicit */ true,
                            /* stripLiterals */ true,
                            /* isForUnpackedVariadicTypeVar */ true
                        )
                    );

                    typeArgs = [
                        ...typeArgs.slice(0, variadicIndex),
                        { node: typeArgs[variadicIndex].node, type: tupleObject },
                        ...typeArgs.slice(variadicIndex + 1 + typeArgs.length - typeParameters.length, typeArgs.length),
                    ];
                }
            }
        }

        return typeArgs;
    }

    // If the variadic type variable is not unpacked, report an error.
    function validateVariadicTypeVarIsUnpacked(type: TypeVarType, node: ParseNode) {
        if (!type.isVariadicUnpacked) {
            addError(
                Localizer.Diagnostic.unpackedTypeVarTupleExpected().format({
                    name1: type.details.name,
                    name2: type.details.name,
                }),
                node
            );
            return false;
        }

        return true;
    }

    function getTypeFromIndexWithBaseType(
        node: IndexNode,
        baseType: Type,
        usage: EvaluatorUsage,
        flags: EvaluatorFlags
    ): TypeResult {
        // Handle the case where we're specializing a generic type alias.
        if (
            baseType.typeAliasInfo?.typeParameters &&
            baseType.typeAliasInfo.typeParameters.length > 0 &&
            !baseType.typeAliasInfo.typeArguments
        ) {
            const typeParameters = baseType.typeAliasInfo.typeParameters;
            const typeArgs = adjustTypeArgumentsForVariadicTypeVar(getTypeArgs(node, flags), typeParameters);

            if (
                typeArgs.length > typeParameters.length &&
                !typeParameters.some((typeVar) => typeVar.details.isVariadic)
            ) {
                addError(
                    Localizer.Diagnostic.typeArgsTooMany().format({
                        name: printType(baseType),
                        expected: typeParameters.length,
                        received: typeArgs.length,
                    }),
                    typeArgs[typeParameters.length].node
                );
            }

            const typeVarMap = new TypeVarMap(baseType.typeAliasInfo.typeVarScopeId);
            const diag = new DiagnosticAddendum();
            typeParameters.forEach((param, index) => {
                const typeArgType: Type =
                    index < typeArgs.length ? convertToInstance(typeArgs[index].type) : UnknownType.create();
                canAssignTypeToTypeVar(param, typeArgType, diag, typeVarMap);
            });

            if (!diag.isEmpty()) {
                addError(
                    Localizer.Diagnostic.typeNotSpecializable().format({ type: printType(baseType) }) +
                        diag.getString(),
                    node
                );
            }

            const aliasTypeArgs: Type[] = [];
            baseType.typeAliasInfo.typeParameters?.forEach((typeParam) => {
                aliasTypeArgs.push(typeVarMap.getTypeVarType(typeParam) || UnknownType.create());
            });

            const type = TypeBase.cloneForTypeAlias(
                applySolvedTypeVars(baseType, typeVarMap),
                baseType.typeAliasInfo.name,
                baseType.typeAliasInfo.fullName,
                baseType.typeAliasInfo.typeVarScopeId,
                baseType.typeAliasInfo.typeParameters,
                aliasTypeArgs
            );

            return { type, node };
        }

        if (isTypeAliasPlaceholder(baseType)) {
            const typeArgTypes = getTypeArgs(node, flags).map((t) => convertToInstance(t.type));
            const type = TypeBase.cloneForTypeAlias(
                baseType,
                baseType.details.recursiveTypeAliasName!,
                '',
                baseType.details.recursiveTypeAliasScopeId!,
                undefined,
                typeArgTypes
            );
            return { type, node };
        }

        let isIncomplete = false;

        const type = mapSubtypes(baseType, (subtype) => {
            subtype = transformTypeObjectToClass(subtype);
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(concreteSubtype)) {
                return concreteSubtype;
            }

            if (flags & EvaluatorFlags.ExpectingType) {
                if (isTypeVar(subtype)) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.typeVarNotSubscriptable().format({ type: printType(subtype) }),
                        node.baseExpression
                    );

                    // Evaluate the index expressions as though they are type arguments for error-reporting.
                    getTypeArgs(node, flags, /* isAnnotatedClass */ false, /* hasCustomClassGetItem */ false);

                    return UnknownType.create();
                }
            }

            if (isClass(concreteSubtype)) {
                // Setting the value of an indexed class will always result
                // in an exception.
                if (usage.method === 'set') {
                    addError(Localizer.Diagnostic.genericClassAssigned(), node.baseExpression);
                } else if (usage.method === 'del') {
                    addError(Localizer.Diagnostic.genericClassDeleted(), node.baseExpression);
                }

                if (ClassType.isSpecialBuiltIn(concreteSubtype, 'Literal')) {
                    // Special-case Literal types.
                    return createLiteralType(node, flags);
                }

                if (ClassType.isBuiltIn(concreteSubtype, 'InitVar')) {
                    // Special-case InitVar, used in data classes.
                    const typeArgs = getTypeArgs(node, flags);
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

                if (ClassType.isEnumClass(concreteSubtype)) {
                    // Special-case Enum types.
                    // TODO - validate that there's only one index entry
                    // that is a str type.
                    // TODO - validate that literal strings are referencing
                    // a known enum member.
                    return ObjectType.create(concreteSubtype);
                }

                const isAnnotatedClass = isClass(concreteSubtype) && ClassType.isBuiltIn(concreteSubtype, 'Annotated');
                const hasCustomClassGetItem =
                    isClass(concreteSubtype) && ClassType.hasCustomClassGetItem(concreteSubtype);

                let typeArgs = getTypeArgs(node, flags, isAnnotatedClass, hasCustomClassGetItem);
                if (!isAnnotatedClass) {
                    typeArgs = adjustTypeArgumentsForVariadicTypeVar(typeArgs, concreteSubtype.details.typeParameters);
                }

                // If this is a custom __class_getitem__, there's no need to specialize the class.
                // Just return it as is.
                if (hasCustomClassGetItem) {
                    return concreteSubtype;
                }

                return createSpecializedClassType(concreteSubtype, typeArgs, flags, node);
            }

            if (isObject(concreteSubtype)) {
                const typeResult = getTypeFromIndexedObject(node, concreteSubtype, usage);
                if (typeResult.isIncomplete) {
                    isIncomplete = true;
                }
                return typeResult.type;
            }

            if (isNever(concreteSubtype)) {
                return UnknownType.create();
            }

            if (isNone(concreteSubtype)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticRuleSet.reportOptionalSubscript,
                    DiagnosticRule.reportOptionalSubscript,
                    Localizer.Diagnostic.noneNotSubscriptable(),
                    node.baseExpression
                );

                return UnknownType.create();
            }

            if (!isUnbound(concreteSubtype)) {
                const fileInfo = getFileInfo(node);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeNotSubscriptable().format({ type: printType(concreteSubtype) }),
                    node.baseExpression
                );
            }

            return UnknownType.create();
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.forEach((item) => {
            getTypeOfExpression(
                item.valueExpression,
                /* expectedType */ undefined,
                flags & EvaluatorFlags.AllowForwardReferences
            );
        });

        return { type, node, isIncomplete };
    }

    function makeTupleObject(entryTypes: Type[], isUnspecifiedLength = false) {
        if (tupleClassType && isClass(tupleClassType)) {
            if (isUnspecifiedLength) {
                return convertToInstance(
                    specializeTupleClass(tupleClassType, [
                        combineTypes(entryTypes),
                        AnyType.create(/* isEllipsis */ true),
                    ])
                );
            }
            return convertToInstance(specializeTupleClass(tupleClassType, entryTypes));
        }

        return UnknownType.create();
    }

    function getTypeFromIndexedObject(node: IndexNode, baseType: ObjectType, usage: EvaluatorUsage): TypeResult {
        // Handle index operations for TypedDict classes specially.
        if (ClassType.isTypedDictClass(baseType.classType)) {
            const typeFromTypedDict = getTypeFromIndexedTypedDict(node, baseType, usage);
            if (typeFromTypedDict) {
                return typeFromTypedDict;
            }
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

        const itemMethodType = getTypeFromObjectMember(node, baseType, magicMethodName)?.type;

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
            return { node, type: UnknownType.create() };
        }

        // Handle the special case where the object is a Tuple and
        // the index is a constant number. In such case, we can determine
        // the exact type by indexing into the tuple type array.
        if (
            node.items.length === 1 &&
            !node.trailingComma &&
            !node.items[0].name &&
            node.items[0].argumentCategory === ArgumentCategory.Simple
        ) {
            const baseTypeClass = baseType.classType;
            const index0Expr = node.items[0].valueExpression;
            const valueType = getTypeOfExpression(index0Expr).type;

            if (isObject(valueType) && ClassType.isBuiltIn(valueType.classType, 'int') && isLiteralType(valueType)) {
                const indexValue = valueType.classType.literalValue as number;
                const tupleType = getSpecializedTupleType(baseTypeClass);

                if (tupleType && tupleType.tupleTypeArguments) {
                    if (isOpenEndedTupleClass(tupleType)) {
                        return { node, type: tupleType.tupleTypeArguments[0] };
                    } else if (indexValue >= 0 && indexValue < tupleType.tupleTypeArguments.length) {
                        return { node, type: tupleType.tupleTypeArguments[indexValue] };
                    } else if (indexValue < 0 && tupleType.tupleTypeArguments.length + indexValue >= 0) {
                        return {
                            node,
                            type: tupleType.tupleTypeArguments[tupleType.tupleTypeArguments.length + indexValue],
                        };
                    }
                }
            }
        }

        // Follow PEP 637 rules for positional and keyword arguments.
        const positionalArgs = node.items.filter(
            (item) => item.argumentCategory === ArgumentCategory.Simple && !item.name
        );
        const unpackedListArgs = node.items.filter((item) => item.argumentCategory === ArgumentCategory.UnpackedList);

        const keywordArgs = node.items.filter(
            (item) => item.argumentCategory === ArgumentCategory.Simple && !!item.name
        );
        const unpackedDictArgs = node.items.filter(
            (item) => item.argumentCategory === ArgumentCategory.UnpackedDictionary
        );

        let positionalIndexType: Type;
        if (positionalArgs.length === 1 && unpackedListArgs.length === 0 && !node.trailingComma) {
            // Handle the common case where there is a single positional argument.
            positionalIndexType = getTypeOfExpression(positionalArgs[0].valueExpression).type;
        } else if (positionalArgs.length === 0 && unpackedListArgs.length === 0) {
            // Handle the case where there are no positionals provided but there are keywords.
            positionalIndexType =
                tupleClassType && isClass(tupleClassType)
                    ? convertToInstance(specializeTupleClass(tupleClassType, []))
                    : UnknownType.create();
        } else {
            // Package up all of the positionals into a tuple.
            const tupleEntries: Type[] = [];
            positionalArgs.forEach((arg) => {
                tupleEntries.push(getTypeOfExpression(arg.valueExpression).type);
            });
            unpackedListArgs.forEach((arg) => {
                const exprType = getTypeOfExpression(arg.valueExpression).type;
                const iterableType = getTypeFromIterator(exprType, /* isAsync */ false, arg) || UnknownType.create();
                tupleEntries.push(iterableType);
            });

            positionalIndexType = makeTupleObject(tupleEntries, unpackedListArgs.length > 0);
        }

        let argList: FunctionArgument[] = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: positionalIndexType,
            },
        ];

        if (usage.method === 'set') {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                type: usage.setType || AnyType.create(),
            });
        }

        keywordArgs.forEach((arg) => {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                valueExpression: arg.valueExpression,
                node: arg,
                name: arg.name,
            });
        });

        unpackedDictArgs.forEach((arg) => {
            argList.push({
                argumentCategory: ArgumentCategory.UnpackedDictionary,
                valueExpression: arg.valueExpression,
                node: arg,
            });
        });

        let callResult: CallResult | undefined;

        // Speculatively attempt the call. We may need to replace the index
        // type with 'int', and we don't want to emit errors before we know
        // which type to use.
        useSpeculativeMode(node, () => {
            callResult = validateCallArguments(
                node,
                argList,
                itemMethodType,
                new TypeVarMap(getTypeVarScopeId(itemMethodType))
            );

            if (callResult.argumentErrors) {
                // If the object supports "__index__" magic method, convert
                // the index it to an int and try again.
                if (isObject(positionalIndexType) && keywordArgs.length === 0 && unpackedDictArgs.length === 0) {
                    const altArgList = [...argList];
                    altArgList[0] = { ...altArgList[0] };
                    const indexMethod = getTypeFromObjectMember(node, positionalIndexType, '__index__');

                    if (indexMethod) {
                        const intType = getBuiltInObject(node, 'int');
                        if (isObject(intType)) {
                            altArgList[0].type = intType;
                        }
                    }

                    callResult = validateCallArguments(
                        node,
                        altArgList,
                        itemMethodType,
                        new TypeVarMap(getTypeVarScopeId(itemMethodType))
                    );

                    // We were successful, so replace the arg list.
                    if (!callResult.argumentErrors) {
                        argList = altArgList;
                    }
                }
            }
        });

        callResult = validateCallArguments(
            node,
            argList,
            itemMethodType,
            new TypeVarMap(getTypeVarScopeId(itemMethodType))
        );

        return {
            node,
            type: callResult.returnType || UnknownType.create(),
            isIncomplete: !!callResult.isTypeIncomplete,
        };
    }

    function getTypeFromIndexedTypedDict(
        node: IndexNode,
        baseType: ObjectType,
        usage: EvaluatorUsage
    ): TypeResult | undefined {
        if (node.items.length !== 1) {
            addError(Localizer.Diagnostic.typeArgsMismatchOne().format({ received: node.items.length }), node);
            return { node, type: UnknownType.create() };
        }

        // Look for subscript types that are not supported by TypedDict.
        if (node.trailingComma || node.items[0].name || node.items[0].argumentCategory !== ArgumentCategory.Simple) {
            return undefined;
        }

        const entries = getTypedDictMembersForClass(baseType.classType, /* allowNarrowed */ true);

        const indexTypeResult = getTypeOfExpression(node.items[0].valueExpression);
        const indexType = indexTypeResult.type;
        let diag = new DiagnosticAddendum();
        let allDiagsInvolveNotRequiredKeys = true;

        const resultingType = mapSubtypes(indexType, (subtype) => {
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
                    allDiagsInvolveNotRequiredKeys = false;
                    return UnknownType.create();
                } else if (!entry.isRequired && usage.method === 'get') {
                    if (!ParseTreeUtils.isWithinTryBlock(node)) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.keyNotRequired().format({
                                name: entryName,
                                type: printType(baseType),
                            })
                        );
                    }
                }

                if (usage.method === 'set') {
                    canAssignType(entry.valueType, usage.setType!, diag);
                } else if (usage.method === 'del' && entry.isRequired) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.keyRequiredDeleted().format({
                            name: entryName,
                        })
                    );
                    allDiagsInvolveNotRequiredKeys = false;
                }

                return entry.valueType;
            }

            diag.addMessage(Localizer.DiagnosticAddendum.typeNotStringLiteral().format({ type: printType(subtype) }));
            allDiagsInvolveNotRequiredKeys = false;
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
                allDiagsInvolveNotRequiredKeys
                    ? fileInfo.diagnosticRuleSet.reportTypedDictNotRequiredAccess
                    : fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                allDiagsInvolveNotRequiredKeys
                    ? DiagnosticRule.reportTypedDictNotRequiredAccess
                    : DiagnosticRule.reportGeneralTypeIssues,
                typedDictDiag + diag.getString(),
                node
            );
        }

        return { node, type: resultingType, isIncomplete: !!indexTypeResult.isIncomplete };
    }

    function getTypeArgs(
        node: IndexNode,
        flags: EvaluatorFlags,
        isAnnotatedClass = false,
        hasCustomClassGetItem = false
    ): TypeResult[] {
        const typeArgs: TypeResult[] = [];
        const adjFlags =
            flags &
            ~(
                EvaluatorFlags.DoNotSpecialize |
                EvaluatorFlags.ParamSpecDisallowed |
                EvaluatorFlags.TypeVarTupleDisallowed
            );

        // Create a local function that validates a single type argument.
        const getTypeArgTypeResult = (expr: ExpressionNode, argIndex: number) => {
            let typeResult: TypeResult;

            // If it's a custom __class_getitem__, none of the arguments should be
            // treated as types. If it's an Annotated[a, b, c], only the first index
            // should be treated as a type. The others can be regular (non-type) objects.
            if (hasCustomClassGetItem || (isAnnotatedClass && argIndex > 0)) {
                typeResult = getTypeOfExpression(
                    expr,
                    /* expectedType */ undefined,
                    EvaluatorFlags.ParamSpecDisallowed |
                        EvaluatorFlags.TypeVarTupleDisallowed |
                        EvaluatorFlags.DoNotSpecialize
                );
            } else {
                typeResult = getTypeArg(expr, adjFlags);
            }
            return typeResult;
        };

        // A single (non-empty) tuple is treated the same as a list of items in the index.
        if (
            node.items.length === 1 &&
            !node.trailingComma &&
            !node.items[0].name &&
            node.items[0].valueExpression.nodeType === ParseNodeType.Tuple &&
            node.items[0].valueExpression.expressions.length > 0
        ) {
            node.items[0].valueExpression.expressions.forEach((item, index) => {
                typeArgs.push(getTypeArgTypeResult(item, index));
            });
        } else {
            node.items.forEach((arg, index) => {
                const typeResult = getTypeArgTypeResult(arg.valueExpression, index);

                if (arg.argumentCategory !== ArgumentCategory.Simple) {
                    if (
                        arg.argumentCategory === ArgumentCategory.UnpackedList &&
                        isVariadicTypeVar(typeResult.type) &&
                        !typeResult.type.isVariadicUnpacked
                    ) {
                        typeResult.type = TypeVarType.cloneForUnpacked(typeResult.type);
                    } else {
                        addError(Localizer.Diagnostic.unpackedArgInTypeArgument(), arg.valueExpression);
                        typeResult.type = UnknownType.create();
                    }
                }

                if (arg.name) {
                    addError(Localizer.Diagnostic.keywordArgInTypeArgument(), arg.valueExpression);
                }

                typeArgs.push(typeResult);
            });
        }

        return typeArgs;
    }

    function getTypeArg(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        let typeResult: TypeResult;

        let adjustedFlags =
            flags |
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.ExpectingTypeAnnotation |
            EvaluatorFlags.ConvertEllipsisToAny |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.FinalDisallowed;

        const fileInfo = getFileInfo(node);
        if (fileInfo.isStubFile) {
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

    function getTypeFromTuple(node: TupleNode, expectedType: Type | undefined, flags: EvaluatorFlags): TypeResult {
        if ((flags & EvaluatorFlags.ExpectingType) !== 0 && node.expressions.length === 0 && !expectedType) {
            return { type: makeTupleObject([]), node, isEmptyTupleShorthand: true };
        }

        // If the expected type is a union, recursively call for each of the subtypes
        // to find one that matches.
        let effectiveExpectedType = expectedType;

        if (expectedType && isUnion(expectedType)) {
            let matchingSubtype: Type | undefined;

            doForEachSubtype(expectedType, (subtype) => {
                if (!matchingSubtype) {
                    const subtypeResult = useSpeculativeMode(node, () => {
                        return getTypeFromTupleExpected(node, subtype);
                    });

                    if (subtypeResult) {
                        matchingSubtype = subtype;
                    }
                }
            });

            effectiveExpectedType = matchingSubtype;
        }

        if (effectiveExpectedType) {
            const result = getTypeFromTupleExpected(node, effectiveExpectedType);
            if (result) {
                return result;
            }
        }

        return getTypeFromTupleInferred(node, /* useAny */ !!expectedType);
    }

    function getTypeFromTupleExpected(node: TupleNode, expectedType: Type): TypeResult | undefined {
        expectedType = transformPossibleRecursiveTypeAlias(expectedType);
        if (!isObject(expectedType)) {
            return undefined;
        }

        if (!tupleClassType || !isClass(tupleClassType)) {
            return undefined;
        }

        // Build an array of expected types.
        const expectedTypes: Type[] = [];

        if (isTupleClass(expectedType.classType) && expectedType.classType.tupleTypeArguments) {
            // Is this a homogeneous tuple of indeterminate length? If so,
            // match the number of expected types to the number of entries
            // in the tuple expression.
            if (isOpenEndedTupleClass(expectedType.classType)) {
                const homogenousType = transformPossibleRecursiveTypeAlias(
                    expectedType.classType.tupleTypeArguments[0]
                );
                for (let i = 0; i < node.expressions.length; i++) {
                    expectedTypes.push(homogenousType);
                }
            } else {
                expectedType.classType.tupleTypeArguments.forEach((typeArg) => {
                    expectedTypes.push(transformPossibleRecursiveTypeAlias(typeArg));
                });
            }
        } else {
            const tupleTypeVarMap = new TypeVarMap(getTypeVarScopeId(tupleClassType));
            if (
                !populateTypeVarMapBasedOnExpectedType(
                    tupleClassType,
                    expectedType,
                    tupleTypeVarMap,
                    getTypeVarScopesForNode(node)
                )
            ) {
                return undefined;
            }

            const specializedTuple = applySolvedTypeVars(tupleClassType, tupleTypeVarMap) as ClassType;
            if (!specializedTuple.typeArguments || specializedTuple.typeArguments.length !== 1) {
                return undefined;
            }

            const homogenousType = transformPossibleRecursiveTypeAlias(specializedTuple.typeArguments[0]);
            for (let i = 0; i < node.expressions.length; i++) {
                expectedTypes.push(homogenousType);
            }
        }

        const entryTypeResults = node.expressions.map((expr, index) =>
            getTypeOfExpression(expr, index < expectedTypes.length ? expectedTypes[index] : undefined)
        );

        const expectedTypesContainLiterals = expectedTypes.some((type) => isLiteralTypeOrUnion(type));

        const type = convertToInstance(
            specializeTupleClass(
                tupleClassType,
                buildTupleTypesList(entryTypeResults),
                /* isTypeArgumentExplicit */ true,
                /* stripLiterals */ !expectedTypesContainLiterals
            )
        );

        return { type, node };
    }

    function getTypeFromTupleInferred(node: TupleNode, useAny: boolean): TypeResult {
        const entryTypeResults = node.expressions.map((expr) =>
            getTypeOfExpression(expr, useAny ? AnyType.create() : undefined)
        );

        if (!tupleClassType || !isClass(tupleClassType)) {
            return { type: UnknownType.create(), node };
        }

        const type = convertToInstance(specializeTupleClass(tupleClassType, buildTupleTypesList(entryTypeResults)));

        return { type, node };
    }

    function buildTupleTypesList(entryTypeResults: TypeResult[]): Type[] {
        const entryTypes: Type[] = [];
        let isOpenEnded = false;

        for (const typeResult of entryTypeResults) {
            if (typeResult.unpackedType) {
                // Is this an unpacked tuple? If so, we can append the individual
                // unpacked entries onto the new tuple. If it's not an upacked tuple
                // but some other iterator (e.g. a List), we won't know the number of
                // items, so we'll need to leave the Tuple open-ended.
                if (isObject(typeResult.unpackedType) && isTupleClass(typeResult.unpackedType.classType)) {
                    const typeArgs = typeResult.unpackedType.classType.tupleTypeArguments;

                    // If the Tuple wasn't specialized or has a "..." type parameter, we can't
                    // make any determination about its contents.
                    if (!typeArgs || isOpenEndedTupleClass(typeResult.unpackedType.classType)) {
                        entryTypes.push(typeResult.type);
                        isOpenEnded = true;
                    } else {
                        entryTypes.push(...typeArgs);
                    }
                } else {
                    entryTypes.push(typeResult.type);
                    isOpenEnded = true;
                }
            } else {
                entryTypes.push(typeResult.type);
            }
        }

        if (isOpenEnded) {
            return [combineTypes(entryTypes), AnyType.create(/* isEllipsis */ true)];
        }

        return entryTypes;
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

        if (!isClass(typedTupleClass) || !isTupleClass(typedTupleClass)) {
            return;
        }

        const updatedTupleClass = specializeTupleClass(typedTupleClass, typeArgs, isTypeArgumentExplicit);

        // Create a copy of the NamedTuple class that overrides the normal MRO
        // entries with a version of Tuple that is specialized appropriately.
        const clonedNamedTupleClass = ClassType.cloneForSpecialization(namedTupleClass, [], isTypeArgumentExplicit);
        clonedNamedTupleClass.details = { ...clonedNamedTupleClass.details };
        clonedNamedTupleClass.details.mro = [...clonedNamedTupleClass.details.mro];
        clonedNamedTupleClass.details.mro[1] = updatedTupleClass.details.mro[0];

        clonedNamedTupleClass.details.baseClasses = clonedNamedTupleClass.details.baseClasses.map((baseClass) => {
            if (isClass(baseClass) && isTupleClass(baseClass)) {
                return updatedTupleClass;
            }
            return baseClass;
        });

        classType.details.mro[namedTupleIndex] = clonedNamedTupleClass;
        classType.details.mro[namedTupleIndex + 1] = updatedTupleClass;

        classType.details.baseClasses = classType.details.baseClasses.map((baseClass) => {
            if (isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'NamedTuple')) {
                return clonedNamedTupleClass;
            }
            return baseClass;
        });
    }

    function getTypeFromCall(node: CallNode, expectedType: Type | undefined): TypeResult {
        const baseTypeResult = getTypeOfExpression(
            node.leftExpression,
            /* expectedType */ undefined,
            EvaluatorFlags.DoNotSpecialize
        );

        const argList = node.arguments.map((arg) => {
            const functionArg: FunctionArgument = {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                node: arg,
                name: arg.name,
            };
            return functionArg;
        });

        let returnResult: TypeResult = { node, type: UnknownType.create() };

        if (!isTypeAliasPlaceholder(baseTypeResult.type)) {
            if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'super') {
                // Handle the built-in "super" call specially.
                returnResult = getTypeFromSuperCall(node);
            } else if (
                isAnyOrUnknown(baseTypeResult.type) &&
                node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.value === 'reveal_type'
            ) {
                if (
                    node.arguments.length === 1 &&
                    node.arguments[0].argumentCategory === ArgumentCategory.Simple &&
                    node.arguments[0].name === undefined
                ) {
                    // Handle the special-case "reveal_type" call.
                    returnResult.type = getTypeFromRevealType(node);
                } else {
                    addError(Localizer.Diagnostic.revealTypeArgs(), node);
                }
            } else if (
                isAnyOrUnknown(baseTypeResult.type) &&
                node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.value === 'reveal_locals'
            ) {
                if (node.arguments.length === 0) {
                    // Handle the special-case "reveal_locals" call.
                    returnResult.type = getTypeFromRevealLocals(node);
                } else {
                    addError(Localizer.Diagnostic.revealLocalsArgs(), node);
                }
            } else {
                const callResult = validateCallArguments(
                    node,
                    argList,
                    baseTypeResult.type,
                    /* typeVarMap */ undefined,
                    /* skipUnknownArgCheck */ false,
                    expectedType
                );
                returnResult.type = callResult.returnType || UnknownType.create();
                if (callResult.argumentErrors) {
                    returnResult.typeErrors = true;
                }
            }

            if (baseTypeResult.isIncomplete) {
                returnResult.isIncomplete = true;
            }
        } else {
            returnResult.isIncomplete = true;
        }

        // Touch all of the args so they're marked accessed even if there were errors.
        // We skip this if it's a TypeVar() call in the typing.pyi module because
        // this results in a cyclical type resolution problem whereby we try to
        // retrieve the str class, which inherits from Sequence, which inherits from
        // Iterable, which uses a TypeVar. Without this, Iterable and Sequence classes
        // have invalid type parameters.
        const isCyclicalTypeVarCall =
            isClass(baseTypeResult.type) &&
            ClassType.isBuiltIn(baseTypeResult.type, 'TypeVar') &&
            getFileInfo(node).isTypingStubFile;

        if (!isCyclicalTypeVarCall) {
            argList.forEach((arg, index) => {
                if (arg.node!.valueExpression.nodeType !== ParseNodeType.StringList) {
                    getTypeForArgument(arg);
                }
            });
        }

        return returnResult;
    }

    function getTypeFromRevealType(node: CallNode) {
        const type = getTypeOfExpression(node.arguments[0].valueExpression).type;
        const exprString = ParseTreeUtils.printExpression(node.arguments[0].valueExpression);
        const typeString = printType(type);
        addInformation(
            Localizer.DiagnosticAddendum.typeOfSymbol().format({ name: exprString, type: typeString }),
            node.arguments[0]
        );

        // Return a literal string with the type. We can use this in unit tests
        // to validate the exact type.
        const strType = getBuiltInType(node, 'str');
        if (isClass(strType)) {
            return ObjectType.create(ClassType.cloneWithLiteral(strType, typeString));
        }

        return AnyType.create();
    }

    function getTypeFromRevealLocals(node: CallNode) {
        let curNode: ParseNode | undefined = node;
        let scope: Scope | undefined;

        while (curNode) {
            scope = ScopeUtils.getScopeForNode(curNode);

            // Stop when we get a valid scope that's not a list comprehension
            // scope. That includes lambdas, functions, classes, and modules.
            if (scope && scope.type !== ScopeType.ListComprehension) {
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
                        Localizer.DiagnosticAddendum.typeOfSymbol().format({ name, type: printType(typeOfSymbol) })
                    );
                }
            });
        }

        if (infoMessages.length > 0) {
            addInformation(infoMessages.join('\n'), node);
        } else {
            addInformation(Localizer.Diagnostic.revealLocalsNone(), node);
        }

        return NoneType.createInstance();
    }

    function getTypeFromSuperCall(node: CallNode): TypeResult {
        if (node.arguments.length > 2) {
            addError(Localizer.Diagnostic.superCallArgCount(), node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = getTypeOfExpression(node.arguments[0].valueExpression).type;

            if (!isAnyOrUnknown(targetClassType) && !isClass(targetClassType)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
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

        // Determine whether to further narrow the type.
        let bindToType: ClassType | ObjectType | undefined;
        if (node.arguments.length > 1) {
            const secondArgType = makeTopLevelTypeVarsConcrete(
                getTypeOfExpression(node.arguments[1].valueExpression).type
            );

            let reportError = false;

            if (isAnyOrUnknown(secondArgType)) {
                // Ignore unknown or any types.
            } else if (isObject(secondArgType)) {
                if (isClass(targetClassType)) {
                    if (
                        !derivesFromClassRecursive(secondArgType.classType, targetClassType, /* ignoreUnknown */ true)
                    ) {
                        reportError = true;
                    }
                }
                bindToType = secondArgType;
            } else if (isClass(secondArgType)) {
                if (isClass(targetClassType)) {
                    if (!derivesFromClassRecursive(secondArgType, targetClassType, /* ignoreUnknown */ true)) {
                        reportError = true;
                    }
                }
                bindToType = secondArgType;
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
                return {
                    type: ObjectType.create(lookupResults.classType),
                    node,
                    bindToType,
                };
            }
        }

        // If the lookup failed, try to return the first base class. An error
        // will be reported by the member lookup logic at a later time.
        if (isClass(targetClassType)) {
            // If the class derives from one or more unknown classes,
            // return unknown here to prevent spurious errors.
            if (targetClassType.details.mro.some((mroBase) => isAnyOrUnknown(mroBase))) {
                return {
                    type: UnknownType.create(),
                    node,
                };
            }

            const baseClasses = targetClassType.details.baseClasses;
            if (baseClasses.length > 0) {
                const baseClassType = baseClasses[0];
                if (isClass(baseClassType)) {
                    return {
                        type: ObjectType.create(baseClassType),
                        node,
                    };
                }
            }
        }

        return {
            type: UnknownType.create(),
            node,
        };
    }

    function findOverloadedFunctionType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: OverloadedFunctionType,
        expectedType: Type | undefined,
        typeVarMap?: TypeVarMap
    ): FunctionType | undefined {
        let validOverload: FunctionType | undefined;

        for (const overload of callType.overloads) {
            // Only iterate through the functions that have the @overload
            // decorator, not the final function that omits the overload.
            // This is the intended behavior according to PEP 484.
            if (FunctionType.isOverloaded(overload)) {
                // Clone the typeVarMap so we don't modify the original.
                const effectiveTypeVarMap = typeVarMap
                    ? typeVarMap.clone()
                    : new TypeVarMap(getTypeVarScopeId(overload));

                effectiveTypeVarMap.addSolveForScope(getTypeVarScopeId(overload));

                // Temporarily disable diagnostic output.
                useSpeculativeMode(errorNode, () => {
                    const callResult = validateFunctionArguments(
                        errorNode,
                        argList,
                        overload,
                        effectiveTypeVarMap,
                        /* skipUnknownArgCheck */ true,
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
            return isFunction(type) && FunctionType.isSkipConstructorCheck(type);
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
            MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.SkipAttributeAccessOverride
        )?.type;

        if (initMethodType && !skipConstructorCheck(initMethodType)) {
            // If there is an expected type, analyze the constructor call
            // for each of the subtypes that comprise the expected type. If
            // one or more analyzes with no errors, use those results.
            if (expectedType) {
                returnType = mapSubtypes(expectedType, (expectedSubType) => {
                    expectedSubType = transformPossibleRecursiveTypeAlias(expectedSubType);
                    const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
                    if (
                        populateTypeVarMapBasedOnExpectedType(
                            type,
                            expectedSubType,
                            typeVarMap,
                            getTypeVarScopesForNode(errorNode)
                        )
                    ) {
                        let callResult: CallResult | undefined;
                        useSpeculativeMode(errorNode, () => {
                            callResult = validateCallArguments(
                                errorNode,
                                argList,
                                initMethodType,
                                typeVarMap.clone(),
                                skipUnknownArgCheck,
                                NoneType.createInstance()
                            );
                        });

                        if (!callResult?.argumentErrors) {
                            // Call validateCallArguments again, this time without speculative
                            // mode, so any errors are reported.
                            validateCallArguments(
                                errorNode,
                                argList,
                                initMethodType,
                                typeVarMap,
                                skipUnknownArgCheck,
                                NoneType.createInstance()
                            );
                            return applyExpectedSubtypeForConstructor(type, expectedSubType, typeVarMap);
                        }
                    }

                    return undefined;
                });

                if (isNever(returnType)) {
                    returnType = undefined;
                }
            }

            if (!returnType) {
                const typeVarMap = type.typeArguments
                    ? buildTypeVarMapFromSpecializedClass(type, /* makeConcrete */ false)
                    : new TypeVarMap(getTypeVarScopeId(type));

                typeVarMap.addSolveForScope(getTypeVarScopeId(initMethodType));
                const callResult = validateCallArguments(
                    errorNode,
                    argList,
                    initMethodType,
                    typeVarMap,
                    skipUnknownArgCheck
                );

                if (!callResult.argumentErrors) {
                    returnType = applyExpectedTypeForConstructor(type, /* expectedType */ undefined, typeVarMap);
                } else {
                    reportedErrors = true;
                }
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
                MemberAccessFlags.AccessClassMembersOnly |
                    MemberAccessFlags.SkipObjectBaseClass |
                    MemberAccessFlags.TreatConstructorAsClassMethod,
                type
            );
            if (constructorMethodInfo && !skipConstructorCheck(constructorMethodInfo.type)) {
                const constructorMethodType = constructorMethodInfo.type;
                const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));

                if (constructorMethodType) {
                    // Skip the unknown argument check if we've already checked for __init__.
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        constructorMethodType,
                        typeVarMap,
                        skipUnknownArgCheck
                    );

                    if (callResult.argumentErrors) {
                        reportedErrors = true;
                    } else {
                        let newReturnType = callResult.returnType;

                        // If the constructor returned an object whose type matches the class of
                        // the original type being constructed, use the return type in case it was
                        // specialized. If it doesn't match, we'll fall back on the assumption that
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
                                    // Special-case the 'tuple' type specialization to use
                                    // the homogenous arbitrary-length form.
                                    if (
                                        isObject(newReturnType) &&
                                        ClassType.isTupleClass(newReturnType.classType) &&
                                        !newReturnType.classType.tupleTypeArguments &&
                                        newReturnType.classType.typeArguments &&
                                        newReturnType.classType.typeArguments.length === 1
                                    ) {
                                        newReturnType = ObjectType.create(
                                            specializeTupleClass(newReturnType.classType, [
                                                newReturnType.classType.typeArguments[0],
                                                AnyType.create(/* isEllipsis */ true),
                                            ])
                                        );
                                    }

                                    returnType = newReturnType;
                                }
                            } else if (!returnType && !isUnknown(newReturnType)) {
                                returnType = newReturnType;
                            }
                        }
                    }

                    if (!returnType) {
                        returnType = applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
                    }
                    validatedTypes = true;
                }
            }
        }

        // If we weren't able to validate the args, analyze the expressions
        // here to mark symbols as referenced and report expression-level errors.
        if (!validatedTypes) {
            argList.forEach((arg) => {
                if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
                    getTypeOfExpression(arg.valueExpression);
                }
            });
        }

        if (!validatedTypes && argList.length > 0) {
            // Suppress this error if the class was instantiated from a custom
            // metaclass because it's likely that it's a false positive.
            const isCustomMetaclass =
                !!type.details.effectiveMetaclass &&
                isClass(type.details.effectiveMetaclass) &&
                !ClassType.isBuiltIn(type.details.effectiveMetaclass);

            if (!isCustomMetaclass) {
                const fileInfo = getFileInfo(errorNode);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.constructorNoArgs().format({ type: type.aliasName || type.details.name }),
                    errorNode
                );
            }
        }

        if (!returnType) {
            // There was no __init__ or __new__ method or we couldn't match the provided
            // arguments to them. Do our best to specialize the instantiated class based
            // on the expected type (if provided).
            const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
            if (expectedType) {
                populateTypeVarMapBasedOnExpectedType(
                    type,
                    expectedType,
                    typeVarMap,
                    getTypeVarScopesForNode(errorNode)
                );
            }
            returnType = applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
        }

        return { argumentErrors: reportedErrors, returnType };
    }

    function applyExpectedSubtypeForConstructor(
        type: ClassType,
        expectedSubtype: Type,
        typeVarMap: TypeVarMap
    ): Type | undefined {
        const specializedType = applySolvedTypeVars(ObjectType.create(type), typeVarMap, /* unknownIfNotFound */ true);

        if (!canAssignType(expectedSubtype, specializedType, new DiagnosticAddendum())) {
            return undefined;
        }

        // If the expected type is "Any", transform it to an Any.
        if (isAny(expectedSubtype)) {
            return expectedSubtype;
        }

        return specializedType;
    }

    // Handles the case where a constructor is a generic type and the type
    // arguments are not specified but can be provided by the expected type.
    function applyExpectedTypeForConstructor(
        type: ClassType,
        expectedType: Type | undefined,
        typeVarMap: TypeVarMap
    ): Type {
        if (expectedType) {
            const specializedExpectedType = mapSubtypes(expectedType, (expectedSubtype) => {
                return applyExpectedSubtypeForConstructor(type, expectedSubtype, typeVarMap);
            });

            if (!isNever(specializedExpectedType)) {
                return specializedExpectedType;
            }
        }

        const specializedType = applySolvedTypeVars(type, typeVarMap, /* unknownIfNotFound */ true) as ClassType;
        return ObjectType.create(specializedType);
    }

    // In cases where the expected type is a specialized base class of the
    // source type, we need to determine which type arguments in the derived
    // class will make it compatible with the specialized base class. This method
    // performs this reverse mapping of type arguments and populates the type var
    // map for the target type. If the type is not assignable to the expected type,
    // it returns false.
    function populateTypeVarMapBasedOnExpectedType(
        type: ClassType,
        expectedType: Type,
        typeVarMap: TypeVarMap,
        liveTypeVarScopes: TypeVarScopeId[]
    ): boolean {
        if (isAny(expectedType)) {
            type.details.typeParameters.forEach((typeParam) => {
                typeVarMap.setTypeVarType(typeParam, expectedType);
            });
            return true;
        }

        if (!isObject(expectedType)) {
            return false;
        }

        // If the expected type is generic (but not specialized), we can't proceed.
        const expectedTypeArgs = expectedType.classType.typeArguments;
        if (!expectedTypeArgs) {
            return canAssignType(type, expectedType.classType, new DiagnosticAddendum(), typeVarMap);
        }

        // If the expected type is the same as the target type (commonly the case),
        // we can use a faster method.
        if (ClassType.isSameGenericClass(expectedType.classType, type)) {
            const sameClassTypeVarMap = buildTypeVarMapFromSpecializedClass(expectedType.classType);
            sameClassTypeVarMap.getTypeVars().forEach((entry) => {
                const typeVarType = sameClassTypeVarMap.getTypeVarType(entry.typeVar);
                typeVarMap.setTypeVarType(
                    entry.typeVar,
                    entry.typeVar.details.variance === Variance.Covariant ? undefined : typeVarType,
                    entry.typeVar.details.variance === Variance.Contravariant ? undefined : typeVarType,
                    entry.retainLiteral
                );
            });
            return true;
        }

        // Create a generic version of the expected type.
        const expectedTypeScopeId = getTypeVarScopeId(expectedType.classType);
        const synthExpectedTypeArgs = ClassType.getTypeParameters(expectedType.classType).map((typeParam, index) => {
            const typeVar = TypeVarType.createInstance(`__dest${index}`);
            typeVar.details.isSynthesized = true;
            typeVar.details.variance = typeParam.details.variance;
            typeVar.scopeId = expectedTypeScopeId;
            return typeVar;
        });
        const genericExpectedType = ClassType.cloneForSpecialization(
            expectedType.classType,
            synthExpectedTypeArgs,
            /* isTypeArgumentExplicit */ true
        );

        // For each type param in the target type, create a placeholder type variable.
        const typeArgs = ClassType.getTypeParameters(type).map((_, index) => {
            const typeVar = TypeVarType.createInstance(`__source${index}`);
            typeVar.details.isSynthesized = true;
            typeVar.details.synthesizedIndex = index;
            return typeVar;
        });

        const specializedType = ClassType.cloneForSpecialization(type, typeArgs, /* isTypeArgumentExplicit */ true);
        const syntheticTypeVarMap = new TypeVarMap(expectedTypeScopeId);
        if (canAssignType(genericExpectedType, specializedType, new DiagnosticAddendum(), syntheticTypeVarMap)) {
            synthExpectedTypeArgs.forEach((typeVar, index) => {
                const synthTypeVar = syntheticTypeVarMap.getTypeVarType(typeVar);

                // Is this one of the synthesized type vars we allocated above? If so,
                // the type arg that corresponds to this type var maps back to the target type.
                if (
                    synthTypeVar &&
                    isTypeVar(synthTypeVar) &&
                    synthTypeVar.details.isSynthesized &&
                    synthTypeVar.details.synthesizedIndex !== undefined
                ) {
                    const targetTypeVar = ClassType.getTypeParameters(specializedType)[
                        synthTypeVar.details.synthesizedIndex
                    ];
                    if (index < expectedTypeArgs.length) {
                        const expectedTypeArgValue = transformExpectedTypeForConstructor(
                            expectedTypeArgs[index],
                            typeVarMap,
                            liveTypeVarScopes
                        );
                        if (expectedTypeArgValue) {
                            typeVarMap.setTypeVarType(
                                targetTypeVar,
                                typeVar.details.variance === Variance.Covariant ? undefined : expectedTypeArgValue,
                                typeVar.details.variance === Variance.Contravariant ? undefined : expectedTypeArgValue
                            );
                        }
                    }
                }
            });

            return true;
        }

        return false;
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    function validateCallArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: Type,
        typeVarMap?: TypeVarMap,
        skipUnknownArgCheck = false,
        expectedType?: Type
    ): CallResult {
        let argumentErrors = false;
        let overloadUsed: FunctionType | undefined;
        let isTypeIncomplete = false;

        const returnType = mapSubtypes(callType, (subtype) => {
            let isTypeObject = false;
            if (isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'Type')) {
                subtype = transformTypeObjectToClass(subtype);
                isTypeObject = true;
            }

            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            switch (concreteSubtype.category) {
                case TypeCategory.Unknown:
                case TypeCategory.Any: {
                    // Touch all of the args so they're marked accessed.
                    argList.forEach((arg) => {
                        if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
                            getTypeForArgument(arg);
                        }
                    });

                    return concreteSubtype;
                }

                // Normally a union wouldn't appear within a mapSubtypes iteration, but
                // unions can come from making type vars concrete.
                case TypeCategory.Union: {
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        concreteSubtype,
                        typeVarMap,
                        skipUnknownArgCheck,
                        expectedType
                    );
                    if (callResult.argumentErrors) {
                        argumentErrors = true;
                    }
                    if (callResult.overloadUsed) {
                        overloadUsed = callResult.overloadUsed;
                    }
                    if (callResult.isTypeIncomplete) {
                        isTypeIncomplete = true;
                    }
                    return callResult.returnType;
                }

                case TypeCategory.Function: {
                    // The stdlib collections/__init__.pyi stub file defines namedtuple
                    // as a function rather than a class, so we need to check for it here.
                    if (concreteSubtype.details.builtInName === 'namedtuple') {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportUntypedNamedTuple,
                            DiagnosticRule.reportUntypedNamedTuple,
                            Localizer.Diagnostic.namedTupleNoTypes(),
                            errorNode
                        );
                        return createNamedTupleType(errorNode, argList, false);
                    }

                    const functionResult = validateFunctionArguments(
                        errorNode,
                        argList,
                        concreteSubtype,
                        typeVarMap || new TypeVarMap(getTypeVarScopeId(concreteSubtype)),
                        skipUnknownArgCheck,
                        expectedType
                    );
                    if (functionResult.argumentErrors) {
                        argumentErrors = true;
                    }
                    if (functionResult.isTypeIncomplete) {
                        isTypeIncomplete = true;
                    }

                    // Handle the NewType specially, replacing the normal return type.
                    if (!functionResult.argumentErrors && concreteSubtype.details.builtInName === 'NewType') {
                        return createNewType(errorNode, argList);
                    }

                    if (concreteSubtype.details.builtInName === '__import__') {
                        // For the special __import__ type, we'll override the return type to be "Any".
                        // This is required because we don't know what module was imported, and we don't
                        // want to fail type checks when accessing members of the resulting module type.
                        return AnyType.create();
                    }

                    return functionResult.returnType;
                }

                case TypeCategory.OverloadedFunction: {
                    const functionType = findOverloadedFunctionType(
                        errorNode,
                        argList,
                        concreteSubtype,
                        expectedType,
                        typeVarMap
                    );

                    if (functionType) {
                        if (functionType.details.builtInName === 'cast' && argList.length === 2) {
                            // Verify that the cast is necessary.
                            const castToType = getTypeForArgumentExpectingType(argList[0]);
                            const castFromType = getTypeForArgument(argList[1]);
                            if (isClass(castToType) && isObject(castFromType)) {
                                if (isTypeSame(castToType, castFromType.classType)) {
                                    addDiagnostic(
                                        getFileInfo(errorNode).diagnosticRuleSet.reportUnnecessaryCast,
                                        DiagnosticRule.reportUnnecessaryCast,
                                        Localizer.Diagnostic.unnecessaryCast().format({
                                            type: printType(castFromType),
                                        }),
                                        errorNode
                                    );
                                }
                            }

                            return convertToInstance(castToType);
                        }

                        const effectiveTypeVarMap = typeVarMap || new TypeVarMap(getTypeVarScopeId(concreteSubtype));
                        effectiveTypeVarMap.addSolveForScope(getTypeVarScopeId(functionType));
                        const functionResult = validateFunctionArguments(
                            errorNode,
                            argList,
                            functionType,
                            effectiveTypeVarMap,
                            skipUnknownArgCheck,
                            expectedType
                        );

                        overloadUsed = functionType;
                        if (functionResult.argumentErrors) {
                            argumentErrors = true;
                        }
                        if (functionResult.isTypeIncomplete) {
                            isTypeIncomplete = true;
                        }

                        return functionResult.returnType || UnknownType.create();
                    }

                    // We couldn't find any valid overloads. Skip the error message if we're
                    // in speculative mode because it's very expensive, and we're going to
                    // suppress the diagnostic anyway.
                    if (!isDiagnosticSuppressedForNode(errorNode)) {
                        const functionName = concreteSubtype.overloads[0].details.name || '<anonymous function>';
                        const diagAddendum = new DiagnosticAddendum();
                        const argTypes = argList.map((t) => printType(getTypeForArgument(t)));

                        diagAddendum.addMessage(
                            Localizer.DiagnosticAddendum.argumentTypes().format({ types: argTypes.join(', ') })
                        );
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.noOverload().format({ name: functionName }) + diagAddendum.getString(),
                            errorNode
                        );
                    }

                    argumentErrors = true;
                    return UnknownType.create();
                }

                case TypeCategory.Class: {
                    if (concreteSubtype.literalValue !== undefined) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.literalNotCallable(),
                            errorNode
                        );
                        argumentErrors = true;
                        return UnknownType.create();
                    }

                    if (ClassType.isBuiltIn(concreteSubtype)) {
                        const className = concreteSubtype.aliasName || concreteSubtype.details.name;

                        if (className === 'type') {
                            // Validate the constructor arguments.
                            validateConstructorArguments(
                                errorNode,
                                argList,
                                concreteSubtype,
                                skipUnknownArgCheck,
                                expectedType
                            );

                            // Handle the 'type' call specially.
                            if (argList.length === 1) {
                                // The one-parameter form of "type" returns the class
                                // for the specified object.
                                const argType = getTypeForArgument(argList[0]);
                                if (
                                    isObject(argType) ||
                                    (isTypeVar(argType) && TypeBase.isInstance(argType)) ||
                                    isNone(argType)
                                ) {
                                    return convertToInstantiable(stripLiteralValue(argType));
                                }
                            } else if (argList.length >= 2) {
                                // The two-parameter form of "type" returns a new class type
                                // built from the specified base types.
                                return createType(errorNode, argList) || AnyType.create();
                            }

                            // If the parameter to type() is not statically known,
                            // fall back to Any.
                            return AnyType.create();
                        }

                        if (className === 'TypeVar') {
                            return createTypeVarType(errorNode, argList);
                        }

                        if (className === 'TypeVarTuple') {
                            return createTypeVarTupleType(errorNode, argList);
                        }

                        if (className === 'ParamSpec') {
                            return createParamSpecType(errorNode, argList);
                        }

                        if (className === 'NamedTuple') {
                            return createNamedTupleType(errorNode, argList, true);
                        }

                        if (
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
                            return AnyType.create();
                        }

                        if (
                            className === 'Enum' ||
                            className === 'IntEnum' ||
                            className === 'Flag' ||
                            className === 'IntFlag'
                        ) {
                            return createEnumType(errorNode, concreteSubtype, argList);
                        }

                        if (className === 'TypedDict') {
                            return createTypedDictType(errorNode, concreteSubtype, argList);
                        }

                        if (className === 'auto' && argList.length === 0) {
                            return getBuiltInObject(errorNode, 'int');
                        }
                    }

                    if (!isTypeObject && ClassType.hasAbstractMethods(concreteSubtype)) {
                        // If the class is abstract, it can't be instantiated.
                        const abstractMethods = getAbstractMethods(concreteSubtype);
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
                            Localizer.Diagnostic.typeAbstract().format({ type: concreteSubtype.details.name }) +
                                diagAddendum.getString(),
                            errorNode
                        );
                    }

                    if (!isTypeObject && ClassType.hasAbstractMethods(concreteSubtype)) {
                        // If the class is abstract, it can't be instantiated.
                        const abstractMethods = getAbstractMethods(concreteSubtype);
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
                            Localizer.Diagnostic.typeAbstract().format({ type: concreteSubtype.details.name }) +
                                diagAddendum.getString(),
                            errorNode
                        );
                    }

                    // Assume this is a call to the constructor.
                    const constructorResult = validateConstructorArguments(
                        errorNode,
                        argList,
                        concreteSubtype,
                        skipUnknownArgCheck,
                        expectedType
                    );
                    if (constructorResult.argumentErrors) {
                        argumentErrors = true;
                    }
                    let returnType = constructorResult.returnType;

                    // If the concreteSubtype originated from a TypeVar, convert
                    // the constructed type back to the TypeVar. For example, if
                    // we have `cls: Type[_T]` followed by `_T()`.
                    if (isTypeVar(subtype)) {
                        returnType = convertToInstance(subtype);
                    }

                    // If we instantiated a type, transform it into a class.
                    // This can happen if someone directly instantiates a metaclass
                    // deriving from type.
                    if (
                        returnType &&
                        isObject(returnType) &&
                        returnType.classType.details.mro.some(
                            (baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'type')
                        )
                    ) {
                        // We don't know the name of the new class in this case.
                        const newClassName = '__class_' + returnType.classType.details.name;
                        const newClassType = ClassType.create(
                            newClassName,
                            '',
                            '',
                            getFileInfo(errorNode).filePath,
                            ClassTypeFlags.None,
                            getTypeSourceId(errorNode),
                            returnType.classType,
                            returnType.classType
                        );
                        newClassType.details.baseClasses.push(getBuiltInType(errorNode, 'object'));
                        computeMroLinearization(newClassType);
                        return newClassType;
                    }

                    return returnType;
                }

                case TypeCategory.Object: {
                    const memberType = getTypeFromObjectMember(errorNode, concreteSubtype, '__call__')?.type;

                    if (memberType && (isFunction(memberType) || isOverloadedFunction(memberType))) {
                        const functionResult = validateCallArguments(
                            errorNode,
                            argList,
                            memberType,
                            typeVarMap,
                            skipUnknownArgCheck,
                            expectedType
                        );
                        if (functionResult.argumentErrors) {
                            argumentErrors = true;
                        }
                        return functionResult.returnType || UnknownType.create();
                    }

                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.objectNotCallable().format({ type: printType(subtype) }),
                        errorNode
                    );
                    return UnknownType.create();
                }

                case TypeCategory.None: {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportOptionalCall,
                        DiagnosticRule.reportOptionalCall,
                        Localizer.Diagnostic.noneNotCallable(),
                        errorNode
                    );
                    return undefined;
                }
            }
        });

        return {
            argumentErrors,
            returnType: isNever(returnType) ? undefined : returnType,
            overloadUsed,
            isTypeIncomplete,
        };
    }

    // Matches the arguments passed to a function to the corresponding parameters in that
    // function. This matching is done based on positions and keywords. Type evaluation and
    // validation is left to the caller.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    function matchFunctionArgumentsToParameters(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        type: FunctionType
    ): MatchArgsToParamsResult {
        let argIndex = 0;
        const typeParams = type.details.parameters;

        // The last parameter might be a var arg dictionary. If so, strip it off.
        const varArgDictParam = typeParams.find((param) => param.category === ParameterCategory.VarArgDictionary);
        let reportedArgError = false;

        // Is there a positional-only "/" parameter? If so, it separates the
        // positional-only from positional or keyword parameters.
        let positionalOnlyIndex = typeParams.findIndex(
            (param) => param.category === ParameterCategory.Simple && !param.name
        );

        // Build a map of parameters by name.
        const paramMap = new Map<string, ParamAssignmentInfo>();
        typeParams.forEach((param, index) => {
            if (param.name && param.category === ParameterCategory.Simple) {
                paramMap.set(param.name, {
                    argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
                    argsReceived: 0,
                    isPositionalOnly: positionalOnlyIndex >= 0 && index < positionalOnlyIndex,
                });
            }
        });

        // Is there a bare (nameless) "*" parameter? If so, it signifies the end
        // of the positional parameter list.
        let positionalParamCount = typeParams.findIndex(
            (param) => param.category === ParameterCategory.VarArgList && !param.name
        );

        const varArgListParamIndex = typeParams.findIndex((param) => param.category === ParameterCategory.VarArgList);
        const varArgDictParamIndex = typeParams.findIndex(
            (param) => param.category === ParameterCategory.VarArgDictionary
        );

        // Is there a var-arg (named "*") parameter? If so, it is the last of
        // the positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = varArgListParamIndex;
            if (positionalParamCount >= 0) {
                positionalParamCount++;
            }
        }

        // Is there a keyword var-arg ("**") parameter? If so, it's not included
        // in the list of positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = varArgDictParamIndex;
        }

        // Is this an function that uses the *args and **kwargs
        // from a param spec? If so, we need to treat all positional parameters
        // prior to the *args as positional-only according to PEP 612.
        let paramSpecArgList: FunctionArgument[] | undefined;
        let paramSpecTarget: TypeVarType | undefined;

        if (varArgListParamIndex >= 0 && varArgDictParamIndex >= 0) {
            const varArgListParam = typeParams[varArgListParamIndex];
            const varArgDictParam = typeParams[varArgDictParamIndex];
            if (
                varArgListParam.name &&
                varArgListParam.hasDeclaredType &&
                varArgListParam.typeAnnotation &&
                varArgListParam.typeAnnotation.nodeType === ParseNodeType.MemberAccess &&
                varArgListParam.typeAnnotation.memberName.value === 'args' &&
                varArgListParam.typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
                varArgDictParam.name &&
                varArgDictParam.hasDeclaredType &&
                varArgDictParam.typeAnnotation &&
                varArgDictParam.typeAnnotation.nodeType === ParseNodeType.MemberAccess &&
                varArgDictParam.typeAnnotation.memberName.value === 'kwargs' &&
                varArgDictParam.typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
                varArgListParam.typeAnnotation.leftExpression.value ===
                    varArgDictParam.typeAnnotation.leftExpression.value
            ) {
                const baseType = getTypeOfExpression(varArgListParam.typeAnnotation.leftExpression).type;
                if (isTypeVar(baseType) && baseType.details.isParamSpec) {
                    // Does this function define the param spec, or is it an inner
                    // function nested within another function that defines the param
                    // spec? We need to handle these two cases differently.
                    if (baseType.scopeId === type.details.typeVarScopeId) {
                        paramSpecArgList = [];
                        paramSpecTarget = baseType;
                    } else {
                        positionalOnlyIndex = varArgListParamIndex;
                    }
                }
            }
        }

        // If there are keyword arguments present, they may target one or
        // more parameters that are positional. In this case, we will limit
        // the number of positional parameters.
        argList.forEach((arg) => {
            if (arg.name) {
                const namedParamIndex = typeParams.findIndex(
                    (param) => param.name === arg.name!.value && param.category === ParameterCategory.Simple
                );

                // Is this a parameter that can be interpreted as either a keyword or a positional?
                // If so, we'll treat it as a keyword parameter in this case because it's being
                // targeted by a keyword argument.
                if (namedParamIndex >= 0 && namedParamIndex > positionalOnlyIndex) {
                    if (positionalParamCount < 0 || namedParamIndex < positionalParamCount) {
                        positionalParamCount = namedParamIndex;
                    }
                }
            }
        });

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

        let validateArgTypeParams: ValidateArgTypeParams[] = [];

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
        let unpackedParamIndex = 0;
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
                reportedArgError = true;
            }

            if (paramIndex >= positionalParamCount) {
                if (!foundUnpackedListArg || argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        positionalParamCount === 1
                            ? Localizer.Diagnostic.argPositionalExpectedOne()
                            : Localizer.Diagnostic.argPositionalExpectedCount().format({
                                  expected: positionalParamCount,
                              }),
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

                const isParamVariadic =
                    typeParams[paramIndex].category === ParameterCategory.VarArgList && isVariadicTypeVar(paramType);
                let isArgCompatibleWithVariadic = false;
                const argType = getTypeForArgument(argList[argIndex]);
                let listElementType: Type;
                let advanceToNextArg = false;

                // Handle the case where *args is being passed to a function defined
                // with a ParamSpec and a Concatenate operator. PEP 612 indicates that
                // all positional parameters specified in the Concatenate must be
                // filled explicitly.
                if (type.details.paramSpec && paramIndex < positionalParamCount) {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        positionalParamCount === 1
                            ? Localizer.Diagnostic.argPositionalExpectedOne()
                            : Localizer.Diagnostic.argPositionalExpectedCount().format({
                                  expected: positionalParamCount,
                              }),
                        argList[argIndex].valueExpression || errorNode
                    );
                    reportedArgError = true;
                }

                // If this is a tuple with specified element types, use those
                // specified types rather than using the more generic iterator
                // type which will be a union of all element types.
                const combinedTupleType = combineSameSizedTuples(argType, tupleClassType);
                if (
                    !isParamVariadic &&
                    combinedTupleType &&
                    isObject(combinedTupleType) &&
                    combinedTupleType.classType.tupleTypeArguments!.length > 0
                ) {
                    listElementType = combinedTupleType.classType.tupleTypeArguments![unpackedArgIndex];

                    // Determine if there are any more unpacked list arguments after
                    // this one. If not, we'll clear this flag because this unpacked
                    // list arg is bounded in length.
                    foundUnpackedListArg =
                        argList.find(
                            (arg, index) => index > argIndex && arg.argumentCategory === ArgumentCategory.UnpackedList
                        ) !== undefined;

                    unpackedArgIndex++;
                    if (unpackedArgIndex >= combinedTupleType.classType.tupleTypeArguments!.length) {
                        unpackedArgIndex = 0;
                        advanceToNextArg = true;
                    }
                } else if (isParamVariadic && isVariadicTypeVar(argType)) {
                    // Allow an unpacked variadic type variable to satisfy an
                    // unpacked variadic type variable.
                    listElementType = argType;
                    isArgCompatibleWithVariadic = true;
                } else {
                    listElementType =
                        getTypeFromIterator(argType, /* isAsync */ false, argList[argIndex].valueExpression!) ||
                        UnknownType.create();

                    if (isParamSpec(listElementType)) {
                        // Handle the case where the arg came from *P.args parameter.
                        listElementType = AnyType.create();
                    }
                }

                const funcArg: FunctionArgument = {
                    argumentCategory: ArgumentCategory.Simple,
                    type: listElementType,
                };

                const paramName = typeParams[paramIndex].name;

                // It's not allowed to use unpacked arguments with a variadic *args
                // parameter unless the argument is a variadic arg as well.
                if (isParamVariadic && !isArgCompatibleWithVariadic) {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.unpackedArgWithVariadicParam(),
                        argList[argIndex].valueExpression || errorNode
                    );
                    reportedArgError = true;
                } else {
                    validateArgTypeParams.push({
                        paramCategory: typeParams[paramIndex].category,
                        paramType,
                        requiresTypeVarMatching: requiresSpecialization(paramType),
                        argument: funcArg,
                        errorNode: argList[argIndex].valueExpression || errorNode,
                        paramName: typeParams[paramIndex].isNameSynthesized ? undefined : paramName,
                    });
                }

                trySetActive(argList[argIndex], typeParams[paramIndex]);

                // Note that the parameter has received an argument.
                if (paramName && typeParams[paramIndex].category === ParameterCategory.Simple) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                if (advanceToNextArg || typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                    argIndex++;
                }

                if (typeParams[paramIndex].category !== ParameterCategory.VarArgList) {
                    paramIndex++;
                }
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                trySetActive(argList[argIndex], typeParams[paramIndex]);

                if (paramSpecArgList) {
                    paramSpecArgList.push(argList[argIndex]);
                } else {
                    let paramCategory = typeParams[paramIndex].category;
                    let effectiveParamType = paramType;
                    const paramName = typeParams[paramIndex].name;

                    // Handle the case where the target parameter is a variadic type variable
                    // that has been specialized with a tuple of types.
                    if (
                        isVariadicTypeVar(typeParams[paramIndex].type) &&
                        isObject(paramType) &&
                        isTupleClass(paramType.classType) &&
                        paramType.classType.tupleTypeArguments &&
                        unpackedParamIndex < paramType.classType.tupleTypeArguments.length
                    ) {
                        effectiveParamType = paramType.classType.tupleTypeArguments[unpackedParamIndex];
                        paramCategory = isVariadicTypeVar(effectiveParamType)
                            ? ParameterCategory.VarArgList
                            : ParameterCategory.Simple;

                        unpackedParamIndex++;
                        const paramsToFillCount = positionalArgCount - argIndex - 1;
                        const argsRemainingCount = paramType.classType.tupleTypeArguments.length - unpackedParamIndex;

                        if (unpackedParamIndex >= paramType.classType.tupleTypeArguments.length) {
                            paramIndex++;
                        } else if (argsRemainingCount > 0 && paramsToFillCount <= 0) {
                            // Have we run out of arguments and still have parameters left to fill?
                            addDiagnostic(
                                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                argsRemainingCount === 1
                                    ? Localizer.Diagnostic.argMorePositionalExpectedOne()
                                    : Localizer.Diagnostic.argMorePositionalExpectedCount().format({
                                          expected: argsRemainingCount,
                                      }),
                                argList[argIndex].valueExpression || errorNode
                            );
                            reportedArgError = true;
                        }
                    }

                    validateArgTypeParams.push({
                        paramCategory,
                        paramType: effectiveParamType,
                        requiresTypeVarMatching: requiresSpecialization(paramType),
                        argument: argList[argIndex],
                        errorNode: argList[argIndex].valueExpression || errorNode,
                        paramName,
                        mapsToVarArgList: true,
                    });
                }
                argIndex++;
            } else {
                const paramName = typeParams[paramIndex].name;
                validateArgTypeParams.push({
                    paramCategory: typeParams[paramIndex].category,
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
                    // Verify that the type used in this expression is a mapping.
                    const argType = getTypeForArgument(argList[argIndex]);
                    const mappingType = getTypingType(errorNode, 'Mapping');
                    const strObjType = getBuiltInObject(errorNode, 'str');

                    if (mappingType && isClass(mappingType) && strObjType && isObject(strObjType)) {
                        const strMapObject = ObjectType.create(
                            ClassType.cloneForSpecialization(
                                mappingType,
                                [strObjType, AnyType.create()],
                                /* isTypeArgumentExplicit */ true
                            )
                        );
                        const diag = new DiagnosticAddendum();
                        if (!isParamSpec(argType) && !canAssignType(strMapObject, argType, diag)) {
                            addDiagnostic(
                                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.unpackedDictArgumentNotMapping() + diag.getString(),
                                argList[argIndex].valueExpression || errorNode
                            );
                            reportedArgError = true;
                        }
                    }
                    foundUnpackedDictionaryArg = true;
                } else {
                    // Protect against the case where a non-named argument appears after
                    // a named argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = argList[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.value;
                        const paramEntry = paramMap.get(paramNameValue);
                        if (paramEntry && !paramEntry.isPositionalOnly) {
                            if (paramEntry.argsReceived > 0) {
                                addDiagnostic(
                                    getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    Localizer.Diagnostic.paramAlreadyAssigned().format({ name: paramNameValue }),
                                    paramName
                                );
                                reportedArgError = true;
                            } else {
                                paramEntry.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex((param) => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);

                                validateArgTypeParams.push({
                                    paramCategory: ParameterCategory.Simple,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramNameValue,
                                });
                                trySetActive(argList[argIndex], typeParams[paramInfoIndex]);
                            }
                        } else if (varArgDictParam) {
                            assert(varArgDictParamIndex >= 0);
                            if (paramSpecArgList) {
                                paramSpecArgList.push(argList[argIndex]);
                            } else {
                                const paramType = FunctionType.getEffectiveParameterType(type, varArgDictParamIndex);
                                validateArgTypeParams.push({
                                    paramCategory: ParameterCategory.VarArgDictionary,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(varArgDictParam.type),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramNameValue,
                                });

                                // Remember that this parameter has already received a value.
                                paramMap.set(paramNameValue, {
                                    argsNeeded: 1,
                                    argsReceived: 1,
                                    isPositionalOnly: false,
                                });
                            }
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
                    } else if (argList[argIndex].argumentCategory === ArgumentCategory.Simple) {
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
                typeParams.forEach((param, index) => {
                    if (param.category === ParameterCategory.Simple && param.name) {
                        const entry = paramMap.get(param.name)!;
                        if (entry.argsNeeded === 0 && entry.argsReceived === 0) {
                            const paramType = FunctionType.getEffectiveParameterType(type, index);

                            if (
                                param.defaultType &&
                                !isEllipsisType(param.defaultType) &&
                                requiresSpecialization(paramType)
                            ) {
                                validateArgTypeParams.push({
                                    paramCategory: param.category,
                                    paramType: paramType,
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

        // If we're in speculative mode and an arg/param mismatch has already been reported, don't
        // bother doing the extra work here. This occurs frequently when attempting to find the
        // correct overload.
        if (!reportedArgError || !speculativeTypeTracker.isSpeculative(undefined)) {
            // If there are arguments that map to a variadic *args parameter, see
            // if the type of that *args parameter is a variadic type variable. If so,
            // we'll preprocess those arguments and combine them into a tuple.
            if (varArgListParamIndex >= 0 && typeParams[varArgListParamIndex].hasDeclaredType) {
                const paramType = FunctionType.getEffectiveParameterType(type, varArgListParamIndex);
                const variadicArgs = validateArgTypeParams.filter((argParam) => argParam.mapsToVarArgList);

                if (isTypeVar(paramType) && paramType.details.isVariadic) {
                    // TODO - check whether any of the arguments in variadicArgs are
                    // variadic (*args). These are not allowed because we don't know
                    // their length.

                    if (tupleClassType && isClass(tupleClassType)) {
                        const tupleTypeArgs = variadicArgs.map((argParam) =>
                            stripLiteralValue(getTypeForArgument(argParam.argument))
                        );
                        const specializedTuple = ObjectType.create(
                            specializeTupleClass(
                                tupleClassType,
                                tupleTypeArgs,
                                /* isTypeArgumentExplicit */ true,
                                /* stripLiterals */ true,
                                /* isForUnpackedVariadicTypeVar */ true
                            )
                        );

                        const combinedArg: ValidateArgTypeParams = {
                            paramCategory: ParameterCategory.VarArgList,
                            paramType,
                            requiresTypeVarMatching: true,
                            argument: { argumentCategory: ArgumentCategory.Simple, type: specializedTuple },
                            errorNode,
                            paramName: typeParams[varArgListParamIndex].name,
                            mapsToVarArgList: true,
                        };

                        validateArgTypeParams = [
                            ...validateArgTypeParams.filter((argParam) => !argParam.mapsToVarArgList),
                            combinedArg,
                        ];
                    }
                }
            }
        }

        return {
            argumentErrors: reportedArgError,
            argParams: validateArgTypeParams,
            paramSpecTarget,
            paramSpecArgList,
            activeParam,
        };
    }

    // After having matched arguments with parameters, this function evaluates the
    // types of each argument expression and validates that the resulting type is
    // compatible with the declared type of the corresponding parameter.
    function validateFunctionArgumentTypes(
        errorNode: ExpressionNode,
        matchResults: MatchArgsToParamsResult,
        type: FunctionType,
        typeVarMap: TypeVarMap,
        skipUnknownArgCheck = false,
        expectedType?: Type
    ): CallResult {
        let isTypeIncomplete = false;
        let argumentErrors = false;

        // If the function was bound to a class or object, it's possible that
        // some of that class's type variables have not yet been solved. Add
        // that class's TypeVar scope ID.
        if (type.boundTypeVarScopeId) {
            typeVarMap.addSolveForScope(type.boundTypeVarScopeId);

            // Some typeshed stubs use specialized type annotations in the "self" parameter
            // of an overloaded __init__ method to specify which specialized type should
            // be constructed. Although this isn't part of the official Python spec, other
            // type checkers appear to honor it.
            if (
                type.details.name === '__init__' &&
                FunctionType.isOverloaded(type) &&
                type.strippedFirstParamType &&
                type.boundToType &&
                isObject(type.strippedFirstParamType) &&
                isObject(type.boundToType) &&
                ClassType.isSameGenericClass(type.strippedFirstParamType.classType, type.boundToType.classType) &&
                type.strippedFirstParamType.classType.typeArguments
            ) {
                const typeParams = type.strippedFirstParamType!.classType.details.typeParameters;
                type.strippedFirstParamType.classType.typeArguments.forEach((typeArg, index) => {
                    const typeParam = typeParams[index];
                    if (!isTypeSame(typeParam, typeArg)) {
                        typeVarMap.setTypeVarType(typeParams[index], typeArg);
                    }
                });
            }
        }

        if (expectedType && !requiresSpecialization(expectedType) && type.details.declaredReturnType) {
            // If the expected type is a union, we don't know which type is expected,
            // so avoid using the expected type. The exception is if there are literals
            // in the union, where it's important to prepopulate the literals.
            if (!isUnion(expectedType) || containsLiteralType(expectedType)) {
                // Prepopulate the typeVarMap based on the specialized expected type if the
                // callee has a declared return type. This will allow us to more closely match
                // the expected type if possible. We set the AllowTypeVarNarrowing and
                // SkipStripLiteralForTypeVar flags so the type can be further narrowed
                // and so literals are not stripped.
                canAssignType(
                    getFunctionEffectiveReturnType(type),
                    expectedType,
                    new DiagnosticAddendum(),
                    typeVarMap,
                    CanAssignFlags.AllowTypeVarNarrowing | CanAssignFlags.RetainLiteralsForTypeVar
                );
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
        const typeVarMatchingCount = matchResults.argParams.filter((arg) => arg.requiresTypeVarMatching).length;
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
                    matchResults.argParams.forEach((argParam) => {
                        if (argParam.requiresTypeVarMatching) {
                            const argResult = validateArgType(
                                argParam,
                                typeVarMap,
                                type.details.name,
                                skipUnknownArgCheck
                            );
                            if (argResult.isTypeIncomplete) {
                                isTypeIncomplete = true;
                            }
                        }
                    });
                });
            }

            // Lock the type var map so it cannot be modified and revalidate the
            // arguments in a second pass.
            typeVarMap.lock();
        }

        matchResults.argParams.forEach((argParam) => {
            const argResult = validateArgType(argParam, typeVarMap, type.details.name, skipUnknownArgCheck);
            if (!argResult.isCompatible) {
                argumentErrors = true;
            } else if (argResult.isTypeIncomplete) {
                isTypeIncomplete = true;
            }
        });

        // Handle the assignment of additional arguments that map to a param spec.
        if (matchResults.paramSpecArgList && matchResults.paramSpecTarget) {
            if (
                !validateFunctionArgumentsForParamSpec(
                    errorNode,
                    matchResults.paramSpecArgList,
                    matchResults.paramSpecTarget,
                    typeVarMap
                )
            ) {
                argumentErrors = true;
            }
        }

        // Calculate the return type. If there was a type error detected,
        // don't bother attempting to infer the return type.
        const returnType = getFunctionEffectiveReturnType(type, matchResults.argParams, !argumentErrors);
        const specializedReturnType = applySolvedTypeVars(returnType, typeVarMap);

        // If the return type includes a generic Callable type, set the type var
        // scope to a wildcard to allow these type vars to be solved. This won't
        // work with overloads or unions of callables. It's intended for a
        // specific use case. We may need to make this more sophisticated in
        // the future.
        if (isFunction(specializedReturnType) && !specializedReturnType.details.name) {
            specializedReturnType.details = {
                ...specializedReturnType.details,
                typeVarScopeId: WildcardTypeVarScopeId,
            };
        }

        return {
            argumentErrors,
            returnType: specializedReturnType,
            isTypeIncomplete,
            activeParam: matchResults.activeParam,
        };
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    function validateFunctionArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        type: FunctionType,
        typeVarMap: TypeVarMap,
        skipUnknownArgCheck = false,
        expectedType?: Type
    ): CallResult {
        const matchResults = matchFunctionArgumentsToParameters(errorNode, argList, type);

        if (matchResults.argumentErrors) {
            // Evaluate types of all args. This will ensure that referenced symbols are
            // not reported as unaccessed.
            if (!incompleteTypeTracker.isUndoTrackingEnabled()) {
                argList.forEach((arg) => {
                    if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
                        getTypeOfExpression(arg.valueExpression);
                    }
                });
            }

            return {
                argumentErrors: true,
                activeParam: matchResults.activeParam,
            };
        }

        return validateFunctionArgumentTypes(
            errorNode,
            matchResults,
            type,
            typeVarMap,
            skipUnknownArgCheck,
            expectedType
        );
    }

    // Determines whether the specified argument list satisfies the function
    // signature bound to the specified ParamSpec. Return value indicates success.
    function validateFunctionArgumentsForParamSpec(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        paramSpec: TypeVarType,
        typeVarMap: TypeVarMap
    ): boolean {
        const paramSpecValue = typeVarMap.getParamSpec(paramSpec);

        if (!paramSpecValue || !paramSpecValue.parameters) {
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.paramSpecNotBound().format({ type: printType(paramSpec) }),
                argList[0]?.valueExpression || errorNode
            );
            return false;
        }

        let reportedArgError = false;

        // Build a map of all named parameters.
        const paramMap = new Map<string, ParamSpecEntry>();
        const paramSpecParams = paramSpecValue.parameters;
        paramSpecParams.forEach((param) => {
            if (param.name) {
                paramMap.set(param.name, param);
            }
        });

        let positionalIndex = 0;
        argList.forEach((arg) => {
            if (arg.argumentCategory === ArgumentCategory.Simple) {
                let paramType: Type | undefined;

                if (arg.name) {
                    const paramInfo = paramMap.get(arg.name.value);
                    if (paramInfo) {
                        paramType = paramInfo.type;
                        paramMap.delete(arg.name.value);
                    } else {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.paramNameMissing().format({ name: arg.name.value }),
                            arg.valueExpression || errorNode
                        );
                        reportedArgError = true;
                    }
                } else {
                    if (positionalIndex < paramSpecParams.length) {
                        const paramInfo = paramSpecParams[positionalIndex];
                        paramType = paramInfo.type;
                        if (paramInfo.name) {
                            paramMap.delete(paramInfo.name);
                        }
                    } else {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            paramSpecParams.length === 1
                                ? Localizer.Diagnostic.argPositionalExpectedOne()
                                : Localizer.Diagnostic.argPositionalExpectedCount().format({
                                      expected: paramSpecParams.length,
                                  }),
                            arg.valueExpression || errorNode
                        );
                        reportedArgError = true;
                    }

                    positionalIndex++;
                }

                if (paramType) {
                    if (
                        !validateArgType(
                            {
                                paramCategory: ParameterCategory.Simple,
                                paramType,
                                requiresTypeVarMatching: false,
                                argument: arg,
                                errorNode: arg.valueExpression || errorNode,
                            },
                            typeVarMap,
                            /* functionName */ '',
                            /* skipUnknownArgCheck */ false
                        )
                    ) {
                        reportedArgError = true;
                    }
                }
            } else {
                // TODO - handle *args and **kwargs
            }
        });

        // Report any missing parameters.
        if (!reportedArgError) {
            const unassignedParams = [...paramMap.keys()];

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
        }

        return !reportedArgError;
    }

    function validateArgType(
        argParam: ValidateArgTypeParams,
        typeVarMap: TypeVarMap,
        functionName: string,
        skipUnknownCheck: boolean
    ): ArgResult {
        let argType: Type | undefined;
        let expectedTypeDiag: DiagnosticAddendum | undefined;
        let isTypeIncomplete = false;

        if (argParam.argument.valueExpression) {
            // If the param type is a "bare" TypeVar, don't use it as an expected
            // type. This causes problems for cases where the the call expression
            // result can influence the type of the TypeVar, such as in
            // the expression "min(1, max(2, 0.5))". We set useNarrowBoundOnly
            // to true here because a wide bound on a TypeVar (if a narrow bound
            // has not yet been established) will unnecessarily constrain the
            // expected type.
            let expectedType: Type | undefined = isTypeVar(argParam.paramType)
                ? undefined
                : applySolvedTypeVars(
                      argParam.paramType,
                      typeVarMap,
                      /* unknownIfNotFound */ false,
                      /* useNarrowBoundOnly */ true
                  );

            // If the expected type is unknown, don't use an expected type. Instead,
            // use default rules for evaluating the expression type.
            if (expectedType && isUnknown(expectedType)) {
                expectedType = undefined;
            }

            const exprType = getTypeOfExpression(argParam.argument.valueExpression, expectedType);
            argType = exprType.type;
            if (exprType.isIncomplete) {
                isTypeIncomplete = true;
            }
            if (exprType.typeErrors) {
                return { isCompatible: false };
            }
            expectedTypeDiag = exprType.expectedTypeDiagAddendum;

            if (
                argParam.argument &&
                argParam.argument.name &&
                !speculativeTypeTracker.isSpeculative(argParam.errorNode)
            ) {
                writeTypeCache(argParam.argument.name, expectedType || argType, !!exprType.isIncomplete);
            }
        } else {
            argType = getTypeForArgument(argParam.argument);
        }

        // If we're assigning to a var arg dictionary with a TypeVar type,
        // strip literals before performing the assignment. This is used in
        // places like a dict constructor.
        if (argParam.paramCategory === ParameterCategory.VarArgDictionary && isTypeVar(argParam.paramType)) {
            argType = stripLiteralValue(argType);
        }

        let diag = new DiagnosticAddendum();

        if (!canAssignType(argParam.paramType, argType, diag.createAddendum(), typeVarMap)) {
            // Mismatching parameter types are common in untyped code; don't bother spending time
            // printing types if the diagnostic is disabled.
            const fileInfo = getFileInfo(argParam.errorNode);
            if (
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues !== 'none' &&
                !isDiagnosticSuppressedForNode(argParam.errorNode)
            ) {
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
            return { isCompatible: false };
        } else if (!skipUnknownCheck) {
            const simplifiedType = removeUnbound(argType);
            const fileInfo = getFileInfo(argParam.errorNode);

            const getDiagAddendum = () => {
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
                return diagAddendum;
            };

            // Do not check for unknown types if the expected type is "Any".
            // Don't print types if reportUnknownArgumentType is disabled for performance.
            if (fileInfo.diagnosticRuleSet.reportUnknownArgumentType !== 'none' && !isAny(argParam.paramType)) {
                if (isUnknown(simplifiedType)) {
                    const diagAddendum = getDiagAddendum();
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
                        const diagAddendum = getDiagAddendum();
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
        }

        return { isCompatible: true, isTypeIncomplete };
    }

    function createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';
        let firstConstraintArg: FunctionArgument | undefined;

        if (argList.length === 0) {
            addError(Localizer.Diagnostic.typeVarFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map((s) => s.value).join('');
        } else {
            addError(Localizer.Diagnostic.typeVarFirstArg(), firstArg.valueExpression || errorNode);
        }

        const typeVar = TypeVarType.createInstantiable(typeVarName, /* isParamSpec */ false);

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

                if (paramName === 'bound') {
                    if (typeVar.details.constraints.length > 0) {
                        addError(
                            Localizer.Diagnostic.typeVarBoundAndConstrained(),
                            argList[i].valueExpression || errorNode
                        );
                    } else {
                        const argType = getTypeForArgumentExpectingType(argList[i]);
                        if (requiresSpecialization(argType)) {
                            addError(Localizer.Diagnostic.typeVarGeneric(), argList[i].valueExpression || errorNode);
                        }
                        typeVar.details.boundType = convertToInstance(argType);
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.details.variance === Variance.Contravariant) {
                            addError(Localizer.Diagnostic.typeVarVariance(), argList[i].valueExpression!);
                        } else {
                            typeVar.details.variance = Variance.Covariant;
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.details.variance === Variance.Covariant) {
                            addError(Localizer.Diagnostic.typeVarVariance(), argList[i].valueExpression!);
                        } else {
                            typeVar.details.variance = Variance.Contravariant;
                        }
                    }
                } else {
                    addError(
                        Localizer.Diagnostic.typeVarUnknownParam().format({ name: paramName }),
                        argList[i].node?.name || argList[i].valueExpression || errorNode
                    );
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.details.boundType) {
                    addError(
                        Localizer.Diagnostic.typeVarBoundAndConstrained(),
                        argList[i].valueExpression || errorNode
                    );
                } else {
                    const argType = getTypeForArgumentExpectingType(argList[i]);
                    if (requiresSpecialization(argType)) {
                        addError(Localizer.Diagnostic.typeVarGeneric(), argList[i].valueExpression || errorNode);
                    }
                    TypeVarType.addConstraint(typeVar, convertToInstance(argType));
                    if (firstConstraintArg === undefined) {
                        firstConstraintArg = argList[i];
                    }
                }
            }
        }

        if (typeVar.details.constraints.length === 1 && firstConstraintArg) {
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeVarSingleConstraint(),
                firstConstraintArg.valueExpression || errorNode
            );
        }

        return typeVar;
    }

    function createTypeVarTupleType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';

        if (argList.length === 0) {
            addError(Localizer.Diagnostic.typeVarFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map((s) => s.value).join('');
        } else {
            addError(Localizer.Diagnostic.typeVarFirstArg(), firstArg.valueExpression || errorNode);
        }

        const typeVar = TypeVarType.createInstantiable(typeVarName, /* isParamSpec */ false);
        typeVar.details.isVariadic = true;

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            addError(
                Localizer.Diagnostic.typeVarUnknownParam().format({ name: argList[i].name?.value || '?' }),
                argList[i].node?.name || argList[i].valueExpression || errorNode
            );
        }

        return typeVar;
    }

    function createParamSpecType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        const fileInfo = getFileInfo(errorNode);
        if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_9) {
            addError(Localizer.Diagnostic.paramSpecIllegal(), errorNode);
        }

        if (argList.length === 0) {
            addError(Localizer.Diagnostic.paramSpecFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        let paramSpecName = '';
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            paramSpecName = firstArg.valueExpression.strings.map((s) => s.value).join('');
        } else {
            addError(Localizer.Diagnostic.paramSpecFirstArg(), firstArg.valueExpression || errorNode);
        }

        const paramSpec = TypeVarType.createInstantiable(paramSpecName, /* isParamSpec */ true);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            if (argList[i].name?.value) {
                addError(
                    Localizer.Diagnostic.paramSpecUnknownParam().format({ name: argList[i].name!.value }),
                    argList[i].node?.name || argList[i].valueExpression || errorNode
                );
            } else {
                addError(Localizer.Diagnostic.paramSpecUnknownArg(), argList[i].valueExpression || errorNode);
                break;
            }
        }

        return paramSpec;
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

    function getFunctionFullName(functionNode: ParseNode, moduleName: string, functionName: string): string {
        const nameParts: string[] = [functionName];

        let curNode: ParseNode | undefined = functionNode;

        // Walk the parse tree looking for classes or functions.
        while (curNode) {
            curNode = ParseTreeUtils.getEnclosingClassOrFunction(curNode);
            if (curNode) {
                nameParts.push(curNode.name.value);
            }
        }

        nameParts.push(moduleName);

        return nameParts.reverse().join('.');
    }

    // Creates a new custom enum class with named values.
    function createEnumType(
        errorNode: ExpressionNode,
        enumClass: ClassType,
        argList: FunctionArgument[]
    ): ClassType | undefined {
        const fileInfo = getFileInfo(errorNode);
        let className = 'enum';
        if (argList.length === 0) {
            return undefined;
        } else {
            const nameArg = argList[0];
            if (
                nameArg.argumentCategory === ArgumentCategory.Simple &&
                nameArg.valueExpression &&
                nameArg.valueExpression.nodeType === ParseNodeType.StringList
            ) {
                className = nameArg.valueExpression.strings.map((s) => s.value).join('');
            } else {
                return undefined;
            }
        }

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.filePath,
            ClassTypeFlags.EnumClass,
            getTypeSourceId(errorNode),
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
            return undefined;
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
                return undefined;
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
            const baseClass = getTypeForArgumentExpectingType(argList[1]);

            if (isClass(baseClass)) {
                if (ClassType.isProtocolClass(baseClass)) {
                    addError(Localizer.Diagnostic.newTypeProtocolClass(), argList[1].node || errorNode);
                } else if (baseClass.literalValue !== undefined) {
                    addError(Localizer.Diagnostic.newTypeLiteral(), argList[1].node || errorNode);
                }

                const classFlags =
                    baseClass.details.flags & ~(ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn);
                const classType = ClassType.create(
                    className,
                    getClassFullName(errorNode, fileInfo.moduleName, className),
                    fileInfo.moduleName,
                    fileInfo.filePath,
                    classFlags,
                    getTypeSourceId(errorNode),
                    /* declaredMetaclass */ undefined,
                    baseClass.details.effectiveMetaclass
                );
                classType.details.baseClasses.push(baseClass);
                computeMroLinearization(classType);

                // Synthesize an __init__ method that accepts only the specified type.
                const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);
                FunctionType.addParameter(initType, {
                    category: ParameterCategory.Simple,
                    name: 'self',
                    type: ObjectType.create(classType),
                    hasDeclaredType: true,
                });
                FunctionType.addParameter(initType, {
                    category: ParameterCategory.Simple,
                    name: '_x',
                    type: ObjectType.create(baseClass),
                    hasDeclaredType: true,
                });
                initType.details.declaredReturnType = NoneType.createInstance();
                classType.details.fields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

                // Synthesize a trivial __new__ method.
                const newType = FunctionType.createInstance(
                    '__new__',
                    '',
                    '',
                    FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
                );
                FunctionType.addParameter(newType, {
                    category: ParameterCategory.Simple,
                    name: 'cls',
                    type: classType,
                    hasDeclaredType: true,
                });
                FunctionType.addDefaultParameters(newType);
                newType.details.declaredReturnType = ObjectType.create(classType);
                classType.details.fields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
                return classType;
            } else if (!isAnyOrUnknown(baseClass)) {
                addError(Localizer.Diagnostic.newTypeNotAClass(), argList[1].node || errorNode);
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
            !isTupleClass(arg1Type.classType) ||
            arg1Type.classType.tupleTypeArguments === undefined
        ) {
            return undefined;
        }

        const classType = ClassType.create(
            className,
            getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.filePath,
            ClassTypeFlags.None,
            getTypeSourceId(errorNode),
            /* declaredMetaclass */ undefined,
            arg1Type.classType.details.effectiveMetaclass
        );
        arg1Type.classType.tupleTypeArguments.forEach((baseClass) => {
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
            fileInfo.filePath,
            ClassTypeFlags.TypedDictClass,
            getTypeSourceId(errorNode),
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
                    getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

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

                    // Evaluate the type with specific evaluation flags. The
                    // type will be cached for later.
                    getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

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
            fileInfo.filePath,
            ClassTypeFlags.None,
            getTypeSourceId(errorNode),
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
            hasDeclaredType: true,
        });

        const selfParameter: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType),
            hasDeclaredType: true,
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
                                type: entryType,
                                hasDeclaredType: includesTypes,
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
                                entryType = convertToInstance(getTypeForExpressionExpectingType(entryTypeNode));
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
                            type: entryType,
                            hasDeclaredType: includesTypes,
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
            '',
            FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.SkipConstructorCheck
        );
        FunctionType.addParameter(initType, selfParameter);
        FunctionType.addDefaultParameters(initType);
        initType.details.declaredReturnType = NoneType.createInstance();

        classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
        classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

        const keysItemType = FunctionType.createInstance('keys', '', '', FunctionTypeFlags.SynthesizedMethod);
        const itemsItemType = FunctionType.createInstance('items', '', '', FunctionTypeFlags.SynthesizedMethod);
        keysItemType.details.declaredReturnType = getBuiltInObject(errorNode, 'list', [
            getBuiltInObject(errorNode, 'str'),
        ]);
        itemsItemType.details.declaredReturnType = keysItemType.details.declaredReturnType;
        classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
        classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, itemsItemType));

        const lenType = FunctionType.createInstance('__len__', '', '', FunctionTypeFlags.SynthesizedMethod);
        lenType.details.declaredReturnType = getBuiltInObject(errorNode, 'int');
        FunctionType.addParameter(lenType, selfParameter);
        classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

        if (addGenericGetAttribute) {
            const getAttribType = FunctionType.createInstance(
                '__getattribute__',
                '',
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
        let exprType = makeTopLevelTypeVarsConcrete(getTypeOfExpression(node.expression).type);

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

    function operatorSupportsComparisonChaining(op: OperatorType) {
        if (binaryOperatorMap[op] && binaryOperatorMap[op][2]) {
            return true;
        }

        if (booleanOperatorMap[op]) {
            return true;
        }

        return false;
    }

    function getTypeFromBinaryOperation(
        node: BinaryOperationNode,
        expectedType: Type | undefined,
        flags: EvaluatorFlags
    ): TypeResult {
        const leftExpression = node.leftExpression;
        let rightExpression = node.rightExpression;
        let isIncomplete = false;

        // If this is a comparison and the left expression is also a comparison,
        // we need to change the behavior to accommodate python's "chained
        // comparisons" feature.
        if (operatorSupportsComparisonChaining(node.operator)) {
            if (
                rightExpression.nodeType === ParseNodeType.BinaryOperation &&
                !rightExpression.parenthesized &&
                operatorSupportsComparisonChaining(rightExpression.operator)
            ) {
                // Evaluate the right expression so it is type checked.
                getTypeFromBinaryOperation(rightExpression, expectedType, flags);

                // Use the left side of the right expression for comparison purposes.
                rightExpression = rightExpression.leftExpression;
            }
        }

        // For most binary operations, the "expected type" is applied to the output
        // of the magic method for that operation. However, the "or" and "and" operators
        // have no magic method, so we apply the expected type directly to both operands.
        let expectedOperandType =
            node.operator === OperatorType.Or || node.operator === OperatorType.And ? expectedType : undefined;

        // Handle the very special case where the expected type is a list
        // and the operator is a multiply. This comes up in the common case
        // of "x: List[Optional[X]] = [None] * y" where y is an integer literal.
        let expectedLeftOperandType: Type | undefined;
        if (
            node.operator === OperatorType.Multiply &&
            expectedType &&
            isObject(expectedType) &&
            ClassType.isBuiltIn(expectedType.classType, 'list') &&
            expectedType.classType.typeArguments &&
            expectedType.classType.typeArguments.length >= 1 &&
            node.leftExpression.nodeType === ParseNodeType.List
        ) {
            expectedLeftOperandType = expectedType;
        }

        const leftTypeResult = getTypeOfExpression(
            leftExpression,
            expectedOperandType || expectedLeftOperandType,
            flags
        );
        let leftType = leftTypeResult.type;

        // If there is no expected type, use the type of the left operand. This
        // allows us to infer a better type for expressions like `x or []`.
        if (!expectedOperandType && (node.operator === OperatorType.Or || node.operator === OperatorType.And)) {
            expectedOperandType = leftType;
        }

        const rightTypeResult = getTypeOfExpression(rightExpression, expectedOperandType, flags);
        let rightType = rightTypeResult.type;

        if (leftTypeResult.isIncomplete || rightTypeResult.isIncomplete) {
            isIncomplete = true;
        }

        // Is this a "|" operator used in a context where it is supposed to be
        // interpreted as a union operator?
        if (
            node.operator === OperatorType.BitwiseOr &&
            !customMetaclassSupportsMethod(leftType, '__or__') &&
            !customMetaclassSupportsMethod(rightType, '__ror__')
        ) {
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
                    fileInfo.isStubFile ||
                    (flags & EvaluatorFlags.AllowForwardReferences) !== 0 ||
                    fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_10;
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
            isIncomplete,
        };
    }

    function customMetaclassSupportsMethod(type: Type, methodName: string): boolean {
        if (!isClass(type)) {
            return false;
        }

        const metaclass = type.details.effectiveMetaclass;
        if (!metaclass || !isClass(metaclass)) {
            return false;
        }

        if (ClassType.isBuiltIn(metaclass, 'type')) {
            return false;
        }

        const memberInfo = lookUpClassMember(metaclass, methodName);
        if (!memberInfo) {
            return false;
        }

        if (isClass(memberInfo.classType) && ClassType.isBuiltIn(memberInfo.classType, 'type')) {
            return false;
        }

        return true;
    }

    function getTypeFromAugmentedAssignment(node: AugmentedAssignmentNode, expectedType: Type | undefined): TypeResult {
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

        const leftTypeResult = getTypeOfExpression(node.leftExpression);
        const leftType = leftTypeResult.type;
        const rightTypeResult = getTypeOfExpression(node.rightExpression);
        const rightType = rightTypeResult.type;
        const isIncomplete = !!rightTypeResult.isIncomplete || !!leftTypeResult.isIncomplete;

        type = mapSubtypesExpandTypeVars(
            leftType,
            /* constraintFilter */ undefined,
            (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
                return mapSubtypesExpandTypeVars(
                    rightType,
                    leftConstraints,
                    (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                        if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                            // If either type is "Unknown" (versus Any), propagate the Unknown.
                            if (isUnknown(leftSubtypeUnexpanded) || isUnknown(rightSubtypeUnexpanded)) {
                                return UnknownType.create();
                            } else {
                                return AnyType.create();
                            }
                        }

                        const magicMethodName = operatorMap[node.operator][0];
                        let returnResult = getTypeFromMagicMethodReturn(
                            leftSubtypeUnexpanded,
                            [rightSubtypeUnexpanded],
                            magicMethodName,
                            node,
                            expectedType
                        );

                        if (!returnResult && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                            // Try with the expanded left type.
                            returnResult = getTypeFromMagicMethodReturn(
                                leftSubtypeExpanded,
                                [rightSubtypeUnexpanded],
                                magicMethodName,
                                node,
                                expectedType
                            );
                        }

                        if (!returnResult && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                            // Try with the expanded left and right type.
                            returnResult = getTypeFromMagicMethodReturn(
                                leftSubtypeExpanded,
                                [rightSubtypeExpanded],
                                magicMethodName,
                                node,
                                expectedType
                            );
                        }

                        return returnResult;
                    }
                );
            }
        );

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type || isNever(type)) {
            const binaryOperator = operatorMap[node.operator][1];
            type = validateBinaryOperation(binaryOperator, leftType!, rightType, node, expectedType);
        }

        return { node, type, isIncomplete };
    }

    function validateBinaryOperation(
        operator: OperatorType,
        leftType: Type,
        rightType: Type,
        errorNode: ExpressionNode,
        expectedType: Type | undefined
    ): Type {
        let type: Type | undefined;
        const diag = new DiagnosticAddendum();

        let concreteLeftType = makeTopLevelTypeVarsConcrete(leftType);

        if (booleanOperatorMap[operator] !== undefined) {
            // If it's an AND or OR, we need to handle short-circuiting by
            // eliminating any known-truthy or known-falsy types.
            if (operator === OperatorType.And) {
                // If the LHS evaluates to falsy, the And expression will
                // always return the type of the left-hand side.
                if (!canBeTruthy(concreteLeftType)) {
                    return leftType;
                }

                // If the LHS evaluates to truthy, the And expression will
                // always return the type of the right-hand side.
                if (!canBeFalsy(concreteLeftType)) {
                    return rightType;
                }

                concreteLeftType = removeTruthinessFromType(concreteLeftType);
            } else if (operator === OperatorType.Or) {
                // If the LHS evaluates to truthy, the Or expression will
                // always return the type of the left-hand side.
                if (!canBeFalsy(concreteLeftType)) {
                    return leftType;
                }

                // If the LHS evaluates to falsy, the Or expression will
                // always return the type of the right-hand side.
                if (!canBeTruthy(concreteLeftType)) {
                    return rightType;
                }

                concreteLeftType = removeFalsinessFromType(concreteLeftType);
            }

            // The "in" and "not in" operators make use of the __contains__
            // magic method.
            if (operator === OperatorType.In || operator === OperatorType.NotIn) {
                type = mapSubtypesExpandTypeVars(
                    rightType,
                    /* constraintFilter */ undefined,
                    (rightSubtypeExpanded, rightSubtypeUnexpanded, rightConstraints) => {
                        return mapSubtypesExpandTypeVars(concreteLeftType, rightConstraints, (leftSubtype) => {
                            if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                                // If either type is "Unknown" (versus Any), propagate the Unknown.
                                if (isUnknown(leftSubtype) || isUnknown(rightSubtypeUnexpanded)) {
                                    return UnknownType.create();
                                } else {
                                    return AnyType.create();
                                }
                            }

                            let returnType = getTypeFromMagicMethodReturn(
                                rightSubtypeExpanded,
                                [leftSubtype],
                                '__contains__',
                                errorNode,
                                /* expectedType */ undefined
                            );

                            if (!returnType) {
                                // If __contains__ was not supported, fall back
                                // on an iterable.
                                const iteratorType = getTypeFromIterator(
                                    rightSubtypeExpanded,
                                    /* isAsync */ false,
                                    /* errorNode */ undefined
                                );

                                if (
                                    iteratorType &&
                                    canAssignType(iteratorType, leftSubtype, new DiagnosticAddendum())
                                ) {
                                    returnType = getBuiltInObject(errorNode, 'bool');
                                }
                            }

                            if (!returnType) {
                                diag.addMessage(
                                    Localizer.Diagnostic.typeNotSupportBinaryOperator().format({
                                        operator: ParseTreeUtils.printOperator(operator),
                                        leftType: printType(leftType),
                                        rightType: printType(rightType),
                                    })
                                );
                            }

                            return returnType;
                        });
                    }
                );

                // Assume that a bool is returned even if the type is unknown
                if (type && !isNever(type)) {
                    type = getBuiltInObject(errorNode, 'bool');
                }
            } else {
                type = mapSubtypesExpandTypeVars(
                    concreteLeftType,
                    /* constraintFilter */ undefined,
                    (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
                        return mapSubtypesExpandTypeVars(
                            rightType,
                            leftConstraints,
                            (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                                // If the operator is an AND or OR, we need to combine the two types.
                                if (operator === OperatorType.And || operator === OperatorType.Or) {
                                    return combineTypes([leftSubtypeUnexpanded, rightSubtypeUnexpanded]);
                                }
                                // The other boolean operators always return a bool value.
                                return getBuiltInObject(errorNode, 'bool');
                            }
                        );
                    }
                );
            }
        } else if (binaryOperatorMap[operator]) {
            type = mapSubtypesExpandTypeVars(
                leftType,
                /* constraintFilter */ undefined,
                (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
                    return mapSubtypesExpandTypeVars(
                        rightType,
                        leftConstraints,
                        (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                            if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                                // If either type is "Unknown" (versus Any), propagate the Unknown.
                                if (isUnknown(leftSubtypeUnexpanded) || isUnknown(rightSubtypeUnexpanded)) {
                                    return UnknownType.create();
                                } else {
                                    return AnyType.create();
                                }
                            }

                            const magicMethodName = binaryOperatorMap[operator][0];
                            let resultType = getTypeFromMagicMethodReturn(
                                leftSubtypeUnexpanded,
                                [rightSubtypeUnexpanded],
                                magicMethodName,
                                errorNode,
                                expectedType
                            );

                            if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                                // Try the expanded left type.
                                resultType = getTypeFromMagicMethodReturn(
                                    leftSubtypeExpanded,
                                    [rightSubtypeUnexpanded],
                                    magicMethodName,
                                    errorNode,
                                    expectedType
                                );
                            }

                            if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                                // Try the expanded left and right type.
                                resultType = getTypeFromMagicMethodReturn(
                                    leftSubtypeExpanded,
                                    [rightSubtypeExpanded],
                                    magicMethodName,
                                    errorNode,
                                    expectedType
                                );
                            }

                            if (!resultType) {
                                // Try the alternate form (swapping right and left).
                                const altMagicMethodName = binaryOperatorMap[operator][1];
                                resultType = getTypeFromMagicMethodReturn(
                                    rightSubtypeUnexpanded,
                                    [leftSubtypeUnexpanded],
                                    altMagicMethodName,
                                    errorNode,
                                    expectedType
                                );

                                if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                                    // Try the expanded right type.
                                    resultType = getTypeFromMagicMethodReturn(
                                        rightSubtypeExpanded,
                                        [leftSubtypeUnexpanded],
                                        altMagicMethodName,
                                        errorNode,
                                        expectedType
                                    );
                                }

                                if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                                    // Try the expanded right and left type.
                                    resultType = getTypeFromMagicMethodReturn(
                                        rightSubtypeExpanded,
                                        [leftSubtypeExpanded],
                                        altMagicMethodName,
                                        errorNode,
                                        expectedType
                                    );
                                }
                            }

                            if (!resultType) {
                                diag.addMessage(
                                    Localizer.Diagnostic.typeNotSupportBinaryOperator().format({
                                        operator: ParseTreeUtils.printOperator(operator),
                                        leftType: printType(leftType),
                                        rightType: printType(rightType),
                                    })
                                );
                            }
                            return resultType;
                        }
                    );
                }
            );
        }

        if (!diag.isEmpty() || !type || isNever(type)) {
            const fileInfo = getFileInfo(errorNode);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotSupportBinaryOperator().format({
                    operator: ParseTreeUtils.printOperator(operator),
                    leftType: printType(leftType),
                    rightType: printType(rightType),
                }) + diag.getString(),
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
        const handleSubtype = (subtype: ObjectType | ClassType | TypeVarType) => {
            let magicMethodType: Type | undefined;
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isObject(concreteSubtype)) {
                magicMethodType = getTypeFromObjectMember(
                    errorNode,
                    concreteSubtype,
                    magicMethodName,
                    /* usage */ undefined,
                    /* diag */ undefined,
                    /* memberAccessFlags */ undefined,
                    subtype
                )?.type;
            } else if (isClass(concreteSubtype)) {
                magicMethodType = getTypeFromClassMember(
                    errorNode,
                    concreteSubtype,
                    magicMethodName,
                    /* usage */ undefined,
                    /* diag */ undefined,
                    MemberAccessFlags.ConsiderMetaclassOnly
                )?.type;
            }

            if (magicMethodType) {
                const functionArgs = args.map((arg) => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg,
                    };
                });

                let callResult: CallResult | undefined;

                useSpeculativeMode(errorNode, () => {
                    callResult = validateCallArguments(
                        errorNode,
                        functionArgs,
                        magicMethodType!,
                        new TypeVarMap(getTypeVarScopeId(magicMethodType!)),
                        /* skipUnknownArgCheck */ true,
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

        const returnType = mapSubtypes(objType, (subtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (isObject(subtype) || isClass(subtype) || isTypeVar(subtype)) {
                return handleSubtype(subtype);
            } else if (isNone(subtype)) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = getBuiltInObject(errorNode, 'object');
                if (isObject(obj)) {
                    return handleSubtype(obj);
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

    function getTypeFromDictionary(node: DictionaryNode, expectedType: Type | undefined): TypeResult {
        // If the expected type is a union, analyze for each of the subtypes
        // to find one that matches.
        if (expectedType && isUnion(expectedType)) {
            let matchingSubtype: Type | undefined;

            doForEachSubtype(expectedType, (subtype) => {
                if (!matchingSubtype) {
                    const subtypeResult = useSpeculativeMode(node, () => {
                        return getTypeFromDictionaryExpected(node, subtype, new DiagnosticAddendum());
                    });

                    if (subtypeResult) {
                        matchingSubtype = subtype;
                    }
                }
            });

            expectedType = matchingSubtype;
        }

        let expectedTypeDiagAddendum = undefined;
        if (expectedType) {
            expectedTypeDiagAddendum = new DiagnosticAddendum();
            const result = getTypeFromDictionaryExpected(node, expectedType, expectedTypeDiagAddendum);
            if (result) {
                return result;
            }
        }

        const result = getTypeFromDictionaryInferred(node, expectedType)!;
        return { ...result, expectedTypeDiagAddendum };
    }

    // Attempts to infer the type of a dictionary statement. If an expectedType
    // is provided, the resulting type must be compatible with the expected type.
    // If this isn't possible, undefined is returned.
    function getTypeFromDictionaryExpected(
        node: DictionaryNode,
        expectedType: Type,
        expectedDiagAddendum: DiagnosticAddendum
    ): TypeResult | undefined {
        expectedType = transformPossibleRecursiveTypeAlias(expectedType);

        if (!isObject(expectedType)) {
            return undefined;
        }

        const keyTypes: Type[] = [];
        const valueTypes: Type[] = [];

        // Handle TypedDict's as a special case.
        if (ClassType.isTypedDictClass(expectedType.classType)) {
            const expectedTypedDictEntries = getTypedDictMembersForClass(expectedType.classType);

            // Infer the key and value types if possible.
            getKeyAndValueTypesFromDictionary(
                node,
                keyTypes,
                valueTypes,
                !!expectedType,
                /* expectedKeyType */ undefined,
                /* expectedValueType */ undefined,
                expectedTypedDictEntries,
                expectedDiagAddendum
            );

            if (
                ClassType.isTypedDictClass(expectedType.classType) &&
                canAssignToTypedDict(expectedType.classType, keyTypes, valueTypes, expectedDiagAddendum)
            ) {
                return {
                    type: expectedType,
                    node,
                };
            }

            return undefined;
        }

        const builtInDict = getBuiltInObject(node, 'dict');
        if (!isObject(builtInDict)) {
            return undefined;
        }

        const dictTypeVarMap = new TypeVarMap(getTypeVarScopeId(builtInDict.classType));
        if (
            !populateTypeVarMapBasedOnExpectedType(
                builtInDict.classType,
                expectedType,
                dictTypeVarMap,
                getTypeVarScopesForNode(node)
            )
        ) {
            return undefined;
        }

        const specializedDict = applySolvedTypeVars(builtInDict.classType, dictTypeVarMap) as ClassType;
        if (!specializedDict.typeArguments || specializedDict.typeArguments.length !== 2) {
            return undefined;
        }

        const expectedKeyType = specializedDict.typeArguments[0];
        const expectedValueType = specializedDict.typeArguments[1];

        // Infer the key and value types if possible.
        getKeyAndValueTypesFromDictionary(
            node,
            keyTypes,
            valueTypes,
            !!expectedType,
            expectedKeyType,
            expectedValueType,
            undefined,
            expectedDiagAddendum
        );

        // Dict and MutableMapping types have invariant value types, so they
        // cannot be narrowed further. Other super-types like Mapping, Collection,
        // and Iterable use covariant value types, so they can be narrowed.
        const isValueTypeInvariant =
            isObject(expectedType) &&
            (ClassType.isBuiltIn(expectedType.classType, 'dict') ||
                ClassType.isBuiltIn(expectedType.classType, 'MutableMapping'));

        const specializedKeyType = inferTypeArgFromExpectedType(expectedKeyType, keyTypes, /* isNarrowable */ false);
        const specializedValueType = inferTypeArgFromExpectedType(
            expectedValueType,
            valueTypes,
            /* isNarrowable */ !isValueTypeInvariant
        );
        if (!specializedKeyType || !specializedValueType) {
            return undefined;
        }

        const type = getBuiltInObject(node, 'dict', [specializedKeyType, specializedValueType]);
        return { type, node };
    }

    // Attempts to infer the type of a dictionary statement. If an expectedType
    // is provided, the resulting type must be compatible with the expected type.
    // If this isn't possible, undefined is returned.
    function getTypeFromDictionaryInferred(node: DictionaryNode, expectedType: Type | undefined): TypeResult {
        let keyType: Type = expectedType ? AnyType.create() : UnknownType.create();
        let valueType: Type = expectedType ? AnyType.create() : UnknownType.create();

        let keyTypes: Type[] = [];
        let valueTypes: Type[] = [];

        let isEmptyContainer = false;

        // Infer the key and value types if possible.
        getKeyAndValueTypesFromDictionary(
            node,
            keyTypes,
            valueTypes,
            !expectedType,
            expectedType ? AnyType.create() : undefined,
            expectedType ? AnyType.create() : undefined
        );

        // Strip any literal values.
        keyTypes = keyTypes.map((t) => stripLiteralValue(t));
        valueTypes = valueTypes.map((t) => stripLiteralValue(t));

        keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : expectedType ? AnyType.create() : UnknownType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (getFileInfo(node).diagnosticRuleSet.strictDictionaryInference || !!expectedType) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = areTypesSame(valueTypes)
                    ? valueTypes[0]
                    : expectedType
                    ? AnyType.create()
                    : UnknownType.create();
            }
        } else {
            valueType = expectedType ? AnyType.create() : UnknownType.create();
            isEmptyContainer = true;
        }

        const dictClass = getBuiltInType(node, 'dict');
        const type = isClass(dictClass)
            ? ObjectType.create(
                  ClassType.cloneForSpecialization(
                      dictClass,
                      [keyType, valueType],
                      /* isTypeArgumentExplicit */ true,
                      /* skipAbstractClassTest */ false,
                      /* TupleTypeArguments */ undefined,
                      isEmptyContainer
                  )
              )
            : UnknownType.create();

        return { type, node };
    }

    function getKeyAndValueTypesFromDictionary(
        node: DictionaryNode,
        keyTypes: Type[],
        valueTypes: Type[],
        limitEntryCount: boolean,
        expectedKeyType?: Type,
        expectedValueType?: Type,
        expectedTypedDictEntries?: Map<string, TypedDictEntry>,
        expectedDiagAddendum?: DiagnosticAddendum
    ) {
        // Infer the key and value types if possible.
        node.entries.forEach((entryNode, index) => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                let keyType = getTypeOfExpression(entryNode.keyExpression, expectedKeyType).type;
                if (expectedKeyType) {
                    const adjExpectedKeyType = makeTopLevelTypeVarsConcrete(expectedKeyType);
                    if (!isAnyOrUnknown(adjExpectedKeyType)) {
                        if (canAssignType(adjExpectedKeyType, keyType, new DiagnosticAddendum(), undefined)) {
                            keyType = adjExpectedKeyType;
                        }
                    }
                }

                let valueTypeResult: TypeResult;

                if (
                    expectedTypedDictEntries &&
                    isObject(keyType) &&
                    ClassType.isBuiltIn(keyType.classType, 'str') &&
                    isLiteralType(keyType) &&
                    expectedTypedDictEntries.has(keyType.classType.literalValue as string)
                ) {
                    valueTypeResult = getTypeOfExpression(
                        entryNode.valueExpression,
                        expectedTypedDictEntries.get(keyType.classType.literalValue as string)!.valueType
                    );
                } else {
                    valueTypeResult = getTypeOfExpression(entryNode.valueExpression, expectedValueType);
                }

                if (expectedDiagAddendum && valueTypeResult.expectedTypeDiagAddendum) {
                    expectedDiagAddendum.addAddendum(valueTypeResult.expectedTypeDiagAddendum);
                }

                const valueType = valueTypeResult.type;

                if (!limitEntryCount || index < maxEntriesToUseForInference) {
                    keyTypes.push(keyType);
                    valueTypes.push(valueType);
                }
                addUnknown = false;
            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                const unexpandedType = getTypeOfExpression(entryNode.expandExpression).type;
                if (isAnyOrUnknown(unexpandedType)) {
                    addUnknown = false;
                } else {
                    const mappingType = getTypingType(node, 'Mapping');
                    if (mappingType && isClass(mappingType)) {
                        const mappingTypeVarMap = new TypeVarMap(getTypeVarScopeId(mappingType));
                        if (
                            canAssignType(
                                ObjectType.create(mappingType),
                                unexpandedType,
                                new DiagnosticAddendum(),
                                mappingTypeVarMap
                            )
                        ) {
                            const specializedMapping = applySolvedTypeVars(mappingType, mappingTypeVarMap) as ClassType;
                            const typeArgs = specializedMapping.typeArguments;
                            if (typeArgs && typeArgs.length >= 2) {
                                if (!limitEntryCount || index < maxEntriesToUseForInference) {
                                    keyTypes.push(typeArgs[0]);
                                    valueTypes.push(typeArgs[1]);
                                }
                                addUnknown = false;
                            }
                        } else {
                            const fileInfo = getFileInfo(node);
                            addDiagnostic(
                                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.dictUnpackIsNotMapping(),
                                entryNode
                            );
                        }
                    }
                }
            } else if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                const dictEntryType = getElementTypeFromListComprehension(
                    entryNode,
                    expectedValueType,
                    expectedKeyType
                );

                // The result should be a Tuple
                if (isObject(dictEntryType)) {
                    const classType = dictEntryType.classType;
                    if (isTupleClass(classType)) {
                        const typeArgs = classType.tupleTypeArguments;
                        if (typeArgs && typeArgs.length === 2) {
                            if (!limitEntryCount || index < maxEntriesToUseForInference) {
                                keyTypes.push(typeArgs[0]);
                                valueTypes.push(typeArgs[1]);
                            }
                            addUnknown = false;
                        }
                    }
                }
            }

            if (addUnknown) {
                if (!limitEntryCount || index < maxEntriesToUseForInference) {
                    keyTypes.push(UnknownType.create());
                    valueTypes.push(UnknownType.create());
                }
            }
        });
    }

    function getTypeFromListOrSet(node: ListNode | SetNode, expectedType: Type | undefined): TypeResult {
        // If the expected type is a union, recursively call for each of the subtypes
        // to find one that matches.
        let effectiveExpectedType = expectedType;

        if (expectedType && isUnion(expectedType)) {
            let matchingSubtype: Type | undefined;

            doForEachSubtype(expectedType, (subtype) => {
                if (!matchingSubtype) {
                    const subtypeResult = useSpeculativeMode(node, () => {
                        return getTypeFromListOrSetExpected(node, subtype);
                    });

                    if (subtypeResult) {
                        matchingSubtype = subtype;
                    }
                }
            });

            effectiveExpectedType = matchingSubtype;
        }

        if (effectiveExpectedType) {
            const result = getTypeFromListOrSetExpected(node, effectiveExpectedType);
            if (result) {
                return result;
            }
        }

        return getTypeFromListOrSetInferred(node, expectedType);
    }

    // Attempts to determine the type of a list or set statement based on an expected type.
    // Returns undefined if that type cannot be honored.
    function getTypeFromListOrSetExpected(node: ListNode | SetNode, expectedType: Type): TypeResult | undefined {
        const builtInClassName = node.nodeType === ParseNodeType.List ? 'list' : 'set';
        expectedType = transformPossibleRecursiveTypeAlias(expectedType);

        if (!isObject(expectedType)) {
            return undefined;
        }

        const builtInListOrSet = getBuiltInObject(node, builtInClassName);
        if (!isObject(builtInListOrSet)) {
            return undefined;
        }

        const typeVarMap = new TypeVarMap(getTypeVarScopeId(builtInListOrSet.classType));
        if (
            !populateTypeVarMapBasedOnExpectedType(
                builtInListOrSet.classType,
                expectedType,
                typeVarMap,
                getTypeVarScopesForNode(node)
            )
        ) {
            return undefined;
        }

        const specializedListOrSet = applySolvedTypeVars(builtInListOrSet.classType, typeVarMap) as ClassType;
        if (!specializedListOrSet.typeArguments || specializedListOrSet.typeArguments.length !== 1) {
            return undefined;
        }

        const expectedEntryType = specializedListOrSet.typeArguments[0];

        const entryTypes: Type[] = [];
        node.entries.forEach((entry) => {
            if (entry.nodeType === ParseNodeType.ListComprehension) {
                entryTypes.push(getElementTypeFromListComprehension(entry, expectedEntryType));
            } else {
                entryTypes.push(getTypeOfExpression(entry, expectedEntryType).type);
            }
        });

        const isExpectedTypeListOrSet =
            isObject(expectedType) && ClassType.isBuiltIn(expectedType.classType, builtInClassName);
        const specializedEntryType = inferTypeArgFromExpectedType(
            expectedEntryType,
            entryTypes,
            /* isNarrowable */ !isExpectedTypeListOrSet
        );
        if (!specializedEntryType) {
            return undefined;
        }

        const type = getBuiltInObject(node, builtInClassName, [specializedEntryType]);
        return { type, node };
    }

    // Attempts to infer the type of a list or set statement with no "expected type".
    function getTypeFromListOrSetInferred(node: ListNode | SetNode, expectedType: Type | undefined): TypeResult {
        const builtInClassName = node.nodeType === ParseNodeType.List ? 'list' : 'set';
        let isEmptyContainer = false;

        // If we received an expected entry type that of "object",
        // allow Any rather than generating an "Unknown".
        let expectedEntryType: Type | undefined;
        if (expectedType) {
            if (isAny(expectedType)) {
                expectedEntryType = expectedType;
            } else if (isObject(expectedType) && ClassType.isBuiltIn(expectedType.classType, 'object')) {
                expectedEntryType = AnyType.create();
            }
        }

        let entryTypes: Type[] = [];
        node.entries.forEach((entry, index) => {
            let entryType: Type;

            if (entry.nodeType === ParseNodeType.ListComprehension) {
                entryType = getElementTypeFromListComprehension(entry, expectedEntryType);
            } else {
                entryType = getTypeOfExpression(entry, expectedEntryType).type;
            }

            if (index < maxEntriesToUseForInference) {
                entryTypes.push(entryType);
            }
        });

        entryTypes = entryTypes.map((t) => stripLiteralValue(t));

        let inferredEntryType: Type = expectedType ? AnyType.create() : UnknownType.create();
        if (entryTypes.length > 0) {
            const fileInfo = getFileInfo(node);
            // If there was an expected type or we're using strict list inference,
            // combine the types into a union.
            if (
                (builtInClassName === 'list' && fileInfo.diagnosticRuleSet.strictListInference) ||
                (builtInClassName === 'set' && fileInfo.diagnosticRuleSet.strictSetInference) ||
                !!expectedType
            ) {
                inferredEntryType = combineTypes(entryTypes, maxSubtypesForInferredType);
            } else {
                // Is the list or set homogeneous? If so, use stricter rules. Otherwise relax the rules.
                inferredEntryType = areTypesSame(entryTypes) ? entryTypes[0] : inferredEntryType;
            }
        } else {
            isEmptyContainer = true;
        }

        const listOrSetClass = getBuiltInType(node, builtInClassName);
        const type = isClass(listOrSetClass)
            ? ObjectType.create(
                  ClassType.cloneForSpecialization(
                      listOrSetClass,
                      [inferredEntryType],
                      /* isTypeArgumentExplicit */ true,
                      /* skipAbstractClassTest */ false,
                      /* TupleTypeArguments */ undefined,
                      isEmptyContainer
                  )
              )
            : UnknownType.create();

        return { type, node };
    }

    function inferTypeArgFromExpectedType(
        expectedType: Type,
        entryTypes: Type[],
        isNarrowable: boolean
    ): Type | undefined {
        const diagDummy = new DiagnosticAddendum();

        // Synthesize a temporary bound type var. We will attempt to assign all list
        // entries to this type var, possibly narrowing the type in the process.
        const targetTypeVar = TypeVarType.createInstance('__typeArg');
        targetTypeVar.details.isSynthesized = true;
        targetTypeVar.details.boundType = expectedType;

        // Use a dummy scope ID. It needs to be a non-empty string.
        targetTypeVar.scopeId = '__typeArgScopeId';

        let typeVarMap = new TypeVarMap(WildcardTypeVarScopeId);
        typeVarMap.setTypeVarType(targetTypeVar, isNarrowable ? undefined : expectedType, expectedType);

        // First, try to assign entries with their literal values stripped.
        // The only time we don't want to strip them is if the expected
        // type explicitly includes literals.
        if (
            entryTypes.some(
                (entryType) => !canAssignType(targetTypeVar, stripLiteralValue(entryType), diagDummy, typeVarMap)
            )
        ) {
            // Allocate a fresh typeVarMap before we try again with literals not stripped.
            typeVarMap = new TypeVarMap(WildcardTypeVarScopeId);
            typeVarMap.setTypeVarType(
                targetTypeVar,
                isNarrowable ? undefined : expectedType,
                expectedType,
                /* retainLiteral */ true
            );
            if (entryTypes.some((entryType) => !canAssignType(targetTypeVar!, entryType, diagDummy, typeVarMap))) {
                return undefined;
            }
        }

        return applySolvedTypeVars(targetTypeVar, typeVarMap);
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

        if (node.expression) {
            getTypeOfExpression(node.expression).type;
        }

        return { type: sentType || UnknownType.create(), node };
    }

    function getTypeFromYieldFrom(node: YieldFromNode): TypeResult {
        const yieldFromType = getTypeOfExpression(node.expression).type;
        let generatorTypeArgs = getGeneratorTypeArgs(yieldFromType);

        let returnedType: Type | undefined;

        // Is the expression a Generator type?
        if (generatorTypeArgs) {
            returnedType = generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
        } else {
            const iterableType = getTypeFromIterable(yieldFromType, /* isAsync */ false, node) || UnknownType.create();

            // Does the iterable return a Generator?
            generatorTypeArgs = getGeneratorTypeArgs(iterableType);
            if (generatorTypeArgs) {
                returnedType = generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
            } else {
                returnedType = UnknownType.create();
            }
        }

        return { type: returnedType || UnknownType.create(), node };
    }

    function getTypeFromLambda(node: LambdaNode, expectedType: Type | undefined): TypeResult {
        const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);

        // Pre-cache the newly-created function type.
        writeTypeCache(node, functionType, /* isIncomplete */ false);

        let expectedFunctionType: FunctionType | undefined;
        if (expectedType) {
            if (isFunction(expectedType)) {
                expectedFunctionType = expectedType;
            } else if (isUnion(expectedType)) {
                // It's not clear what we should do with a union type. For now,
                // simply use the first function in the union.
                expectedFunctionType = findSubtype(expectedType, (t) => isFunction(t)) as FunctionType;
            } else if (isObject(expectedType)) {
                const callMember = lookUpObjectMember(expectedType, '__call__');
                if (callMember) {
                    const memberType = getTypeOfMember(callMember);
                    if (memberType && isFunction(memberType)) {
                        const boundMethod = bindFunctionToClassOrObject(expectedType, memberType);

                        if (boundMethod) {
                            expectedFunctionType = boundMethod as FunctionType;
                        }
                    }
                }
            }
        }

        node.parameters.forEach((param, index) => {
            let paramType: Type = UnknownType.create();
            if (expectedFunctionType && index < expectedFunctionType.details.parameters.length) {
                paramType = FunctionType.getEffectiveParameterType(expectedFunctionType, index);
            }

            if (param.name) {
                writeTypeCache(param.name, paramType, /* isIncomplete */ false);
            }

            if (param.defaultValue) {
                // Evaluate the default value if it's present.
                getTypeOfExpression(param.defaultValue, undefined, EvaluatorFlags.ConvertEllipsisToAny);
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.value : undefined,
                hasDefault: !!param.defaultValue,
                defaultValueExpression: param.defaultValue,
                hasDeclaredType: true,
                type: paramType,
            };
            FunctionType.addParameter(functionType, functionParam);
        });

        const expectedReturnType = expectedFunctionType
            ? getFunctionEffectiveReturnType(expectedFunctionType)
            : undefined;

        // If we're speculatively evaluating the lambda, create another speculative
        // evaluation scope for the return expression and do not allow retention
        // of the cached types.
        if (speculativeTypeTracker.isSpeculative(node)) {
            useSpeculativeMode(
                node.expression,
                () => {
                    functionType.inferredReturnType = getTypeOfExpression(node.expression, expectedReturnType).type;
                },
                /* allowCacheRetention */ false
            );
        } else {
            functionType.inferredReturnType = getTypeOfExpression(node.expression, expectedReturnType).type;
        }

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
                ClassType.cloneForSpecialization(
                    builtInIteratorType,
                    isAsync
                        ? [elementType, NoneType.createInstance()]
                        : [elementType, NoneType.createInstance(), NoneType.createInstance()],
                    /* isTypeArgumentExplicit */ true
                )
            );
        }

        return { type, node };
    }

    function reportPossibleUnknownAssignment(
        diagLevel: DiagnosticLevel,
        rule: string,
        target: NameNode,
        type: Type,
        errorNode: ExpressionNode,
        ignoreEmptyContainers: boolean
    ) {
        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.value;

        // Sometimes variables contain an "unbound" type if they're
        // assigned only within conditional statements. Remove this
        // to avoid confusion.
        const simplifiedType = removeUnbound(type);

        if (isUnknown(simplifiedType)) {
            addDiagnostic(diagLevel, rule, Localizer.Diagnostic.typeUnknown().format({ name: nameValue }), errorNode);
        } else if (isPartlyUnknown(simplifiedType)) {
            // If ignoreEmptyContainers is true, don't report the problem for
            // empty containers(lists or dictionaries). We'll report the problem
            // only if the assigned value is used later.
            if (!ignoreEmptyContainers || !isObject(type) || !type.classType.isEmptyContainer) {
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
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    function getElementTypeFromListComprehension(
        node: ListComprehensionNode,
        expectedValueOrElementType?: Type,
        expectedKeyType?: Type
    ): Type {
        // "Execute" the list comprehensions from start to finish.
        for (const comprehension of node.comprehensions) {
            if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                const iterableTypeInfo = getTypeOfExpression(comprehension.iterableExpression);
                const iterableType = stripLiteralValue(iterableTypeInfo.type);
                const itemType =
                    getTypeFromIterator(iterableType, !!comprehension.isAsync, comprehension.iterableExpression) ||
                    UnknownType.create();

                const targetExpr = comprehension.targetExpression;
                assignTypeToExpression(
                    targetExpr,
                    itemType,
                    !!iterableTypeInfo.isIncomplete,
                    comprehension.iterableExpression
                );
            } else {
                assert(comprehension.nodeType === ParseNodeType.ListComprehensionIf);

                // Evaluate the test expression to validate it and mark symbols
                // as referenced. Don't bother doing this if we're in speculative
                // mode because it doesn't affect the element type.
                if (!speculativeTypeTracker.isSpeculative(comprehension.testExpression)) {
                    getTypeOfExpression(comprehension.testExpression);
                }
            }
        }

        let type: Type = UnknownType.create();
        if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
            // Create a tuple with the key/value types.
            let keyType = getTypeOfExpression(node.expression.keyExpression, expectedKeyType).type;
            if (!expectedKeyType || !containsLiteralType(expectedKeyType)) {
                keyType = stripLiteralValue(keyType);
            }
            let valueType = getTypeOfExpression(node.expression.valueExpression, expectedValueOrElementType).type;
            if (!expectedValueOrElementType || !containsLiteralType(expectedValueOrElementType)) {
                valueType = stripLiteralValue(valueType);
            }

            type = makeTupleObject([keyType, valueType]);
        } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
            // The parser should have reported an error in this case because it's not allowed.
            getTypeOfExpression(node.expression.expandExpression, expectedValueOrElementType);
        } else if (isExpressionNode(node)) {
            type = stripLiteralValue(
                getTypeOfExpression(node.expression as ExpressionNode, expectedValueOrElementType).type
            );
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

    // Verifies that a type argument's type is not disallowed.
    function validateTypeArg(
        argResult: TypeResult,
        allowEmptyTuple = false,
        allowVariadicTypeVar = false,
        allowParamSpec = false
    ): boolean {
        if (argResult.typeList) {
            addError(Localizer.Diagnostic.typeArgListNotAllowed(), argResult.node);
            return false;
        }

        if (isEllipsisType(argResult.type)) {
            addError(Localizer.Diagnostic.ellipsisContext(), argResult.node);
            return false;
        }

        if (isModule(argResult.type)) {
            addError(Localizer.Diagnostic.moduleContext(), argResult.node);
            return false;
        }

        if (isParamSpec(argResult.type)) {
            if (!allowParamSpec) {
                addError(Localizer.Diagnostic.paramSpecContext(), argResult.node);
                return false;
            }
        }

        if (isVariadicTypeVar(argResult.type)) {
            if (!allowVariadicTypeVar) {
                addError(Localizer.Diagnostic.typeVarTupleContext(), argResult.node);
                return false;
            } else {
                validateVariadicTypeVarIsUnpacked(argResult.type, argResult.node);
            }
        }

        if (!allowEmptyTuple && argResult.isEmptyTupleShorthand) {
            addError(Localizer.Diagnostic.zeroLengthTupleNotAllowed(), argResult.node);
            return false;
        }

        return true;
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    function createCallableType(typeArgs: TypeResult[] | undefined, errorNode: ParseNode): FunctionType {
        const functionType = FunctionType.createInstantiable('', '', '', FunctionTypeFlags.None);
        functionType.details.declaredReturnType = UnknownType.create();

        const enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(errorNode);

        // Handle the case where the Callable has no enclosing scope. This can
        // happen in the case where a generic function return type is annotated
        // with a generic type alias that includes a Callable in its definition.
        functionType.details.typeVarScopeId = enclosingScope
            ? getScopeIdForNode(enclosingScope)
            : WildcardTypeVarScopeId;

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                const typeList = typeArgs[0].typeList;
                let sawVariadic = false;
                let reportedVariadicError = false;

                typeList.forEach((entry, index) => {
                    let entryType = entry.type;
                    let paramCategory: ParameterCategory = ParameterCategory.Simple;
                    const paramName = `_p${index.toString()}`;

                    if (isVariadicTypeVar(entryType)) {
                        // Make sure we have at most one unpacked variadic type variable.
                        if (sawVariadic) {
                            if (!reportedVariadicError) {
                                addError(Localizer.Diagnostic.variadicTypeArgsTooMany(), entry.node);
                                reportedVariadicError = true;
                            }
                        }
                        sawVariadic = true;
                        validateVariadicTypeVarIsUnpacked(entryType, entry.node);
                        paramCategory = ParameterCategory.Simple;
                    } else if (!validateTypeArg(entry)) {
                        entryType = UnknownType.create();
                    }

                    FunctionType.addParameter(functionType, {
                        category: paramCategory,
                        name: paramName,
                        isNameSynthesized: true,
                        type: convertToInstance(entryType),
                        hasDeclaredType: true,
                    });
                });
            } else if (isEllipsisType(typeArgs[0].type)) {
                FunctionType.addDefaultParameters(functionType);
                functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
            } else if (isParamSpec(typeArgs[0].type)) {
                functionType.details.paramSpec = typeArgs[0].type;
            } else {
                if (isClass(typeArgs[0].type) && ClassType.isBuiltIn(typeArgs[0].type, 'Concatenate')) {
                    const concatTypeArgs = typeArgs[0].type.typeArguments;
                    if (concatTypeArgs && concatTypeArgs.length > 0) {
                        concatTypeArgs.forEach((typeArg, index) => {
                            if (index === concatTypeArgs.length - 1) {
                                if (isParamSpec(typeArg)) {
                                    functionType.details.paramSpec = typeArg;
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

            if (typeArgs.length > 1) {
                let typeArg1Type = typeArgs[1].type;
                if (!validateTypeArg(typeArgs[1])) {
                    typeArg1Type = UnknownType.create();
                }
                functionType.details.declaredReturnType = convertToInstance(typeArg1Type);
            } else {
                const fileInfo = getFileInfo(errorNode);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.callableSecondArg(),
                    errorNode
                );

                functionType.details.declaredReturnType = UnknownType.create();
            }

            if (typeArgs.length > 2) {
                addError(Localizer.Diagnostic.callableExtraArgs(), typeArgs[2].node);
            }
        } else {
            FunctionType.addDefaultParameters(functionType, /* useUnknown */ true);
            functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
        }

        return functionType;
    }

    // Creates an Optional[X] type.
    function createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(Localizer.Diagnostic.optionalExtraArgs(), errorNode);
            return UnknownType.create();
        }

        let typeArg0Type = typeArgs[0].type;
        if (!validateTypeArg(typeArgs[0])) {
            typeArg0Type = UnknownType.create();
        } else if (!TypeBase.isInstantiable(typeArg0Type)) {
            addExpectedClassDiagnostic(typeArg0Type, typeArgs[0].node);
        }

        return combineTypes([typeArg0Type, NoneType.createType()]);
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
    function createLiteralType(node: IndexNode, flags: EvaluatorFlags): Type {
        if (node.items.length === 0) {
            addError(Localizer.Diagnostic.literalEmptyArgs(), node.baseExpression);
            return UnknownType.create();
        }

        // As per the specification, we support None, int, bool, str, bytes literals
        // plus enum values.
        const literalTypes: Type[] = [];

        for (const item of node.items) {
            let type: Type | undefined;
            const itemExpr = item.valueExpression;

            if (item.argumentCategory !== ArgumentCategory.Simple) {
                addError(Localizer.Diagnostic.unpackedArgInTypeArgument(), itemExpr);
                type = UnknownType.create();
            } else if (item.name) {
                addError(Localizer.Diagnostic.keywordArgInTypeArgument(), itemExpr);
                type = UnknownType.create();
            } else if (itemExpr.nodeType === ParseNodeType.StringList) {
                const isBytes = (itemExpr.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                const value = itemExpr.strings.map((s) => s.value).join('');
                if (isBytes) {
                    type = cloneBuiltinClassWithLiteral(node, 'bytes', value);
                } else {
                    type = cloneBuiltinClassWithLiteral(node, 'str', value);
                }
            } else if (itemExpr.nodeType === ParseNodeType.Number) {
                if (!itemExpr.isImaginary && itemExpr.isInteger) {
                    type = cloneBuiltinClassWithLiteral(node, 'int', itemExpr.value);
                }
            } else if (itemExpr.nodeType === ParseNodeType.Constant) {
                if (itemExpr.constType === KeywordType.True) {
                    type = cloneBuiltinClassWithLiteral(node, 'bool', true);
                } else if (itemExpr.constType === KeywordType.False) {
                    type = cloneBuiltinClassWithLiteral(node, 'bool', false);
                } else if (itemExpr.constType === KeywordType.None) {
                    type = NoneType.createType();
                }
            } else if (
                itemExpr.nodeType === ParseNodeType.UnaryOperation &&
                itemExpr.operator === OperatorType.Subtract
            ) {
                if (itemExpr.expression.nodeType === ParseNodeType.Number) {
                    if (!itemExpr.expression.isImaginary && itemExpr.expression.isInteger) {
                        type = cloneBuiltinClassWithLiteral(node, 'int', -itemExpr.expression.value);
                    }
                }
            }

            if (!type) {
                const exprType = getTypeOfExpression(itemExpr);

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

                    doForEachSubtype(exprType.type, (subtype) => {
                        if (!isClass(subtype) || subtype.literalValue === undefined) {
                            isLiteralType = false;
                        }
                    });

                    if (isLiteralType) {
                        type = exprType.type;
                    }
                }
            }

            if (!type) {
                if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
                    addError(Localizer.Diagnostic.literalUnsupportedType(), item);
                    type = UnknownType.create();
                } else {
                    // This is a Literal[x] used in a context where we were not
                    // expecting a type. Treat it as an "Any" type.
                    type = AnyType.create();
                }
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

        // A ClassVar should not allow generic types, but the typeshed
        // stubs use this in a few cases. For now, just specialize
        // it in a general way.
        type = makeTopLevelTypeVarsConcrete(type);

        return type;
    }

    // Creates a "TypeGuard" type. This is an alias for 'bool', which
    // isn't a generic type and therefore doesn't have a typeParameter.
    // We'll abuse our internal types a bit by specializing it with
    // a type argument anyway.
    function createTypeGuardType(errorNode: ParseNode, classType: ClassType, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(Localizer.Diagnostic.typeGuardArgCount(), errorNode);
        }

        let typeArg: Type;
        if (typeArgs && typeArgs.length > 0) {
            typeArg = typeArgs[0].type;
            if (!validateTypeArg(typeArgs[0])) {
                typeArg = UnknownType.create();
            }
        } else {
            typeArg = UnknownType.create();
        }

        return ClassType.cloneForSpecialization(classType, [convertToInstance(typeArg)], !!typeArgs);
    }

    function createRequiredType(
        classType: ClassType,
        errorNode: ParseNode,
        isRequired: boolean,
        typeArgs: TypeResult[] | undefined
    ): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(
                isRequired ? Localizer.Diagnostic.requiredArgCount() : Localizer.Diagnostic.notRequiredArgCount(),
                errorNode
            );
            return classType;
        }

        const typeArgType = typeArgs[0].type;

        // Make sure this is used only in a dataclass.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(errorNode, /* stopAtFunction */ true);
        const classTypeInfo = containingClassNode ? getTypeOfClass(containingClassNode) : undefined;

        let isUsageLegal = false;

        if (classTypeInfo && isClass(classTypeInfo.classType) && ClassType.isTypedDictClass(classTypeInfo.classType)) {
            // The only legal usage is when used in a type annotation statement.
            if (
                errorNode.parent?.nodeType === ParseNodeType.TypeAnnotation &&
                errorNode.parent.typeAnnotation === errorNode
            ) {
                isUsageLegal = true;
            }
        }

        if (!isUsageLegal) {
            addError(
                isRequired
                    ? Localizer.Diagnostic.requiredNotInTypedDict()
                    : Localizer.Diagnostic.notRequiredNotInTypedDict(),
                errorNode
            );
            return ClassType.cloneForSpecialization(classType, [convertToInstance(typeArgType)], !!typeArgs);
        }

        return typeArgType;
    }

    function createUnpackType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(Localizer.Diagnostic.unpackArgCount(), errorNode);
            return UnknownType.create();
        }

        let typeArgType = typeArgs[0].type;
        if (isUnion(typeArgType) && typeArgType.subtypes.length === 1) {
            typeArgType = typeArgType.subtypes[0];
        }

        if (!isVariadicTypeVar(typeArgType) || typeArgType.isVariadicUnpacked) {
            addError(Localizer.Diagnostic.unpackExpectedTypeVarTuple(), errorNode);
            return UnknownType.create();
        }

        return TypeVarType.cloneForUnpacked(typeArgType);
    }

    // Creates a "Final" type.
    function createFinalType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResult[] | undefined,
        flags: EvaluatorFlags
    ): Type {
        if (flags & EvaluatorFlags.FinalDisallowed) {
            addError(Localizer.Diagnostic.finalContext(), errorNode);
            return AnyType.create();
        }

        if (!typeArgs || typeArgs.length === 0) {
            return classType;
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
                    if (!isParamSpec(typeArg.type)) {
                        addError(Localizer.Diagnostic.concatenateParamSpecMissing(), typeArg.node);
                    }
                } else {
                    if (isParamSpec(typeArg.type)) {
                        addError(Localizer.Diagnostic.paramSpecContext(), typeArg.node);
                    }
                }
            });
        }

        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
    }

    function createAnnotatedType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (typeArgs && typeArgs.length < 2) {
            addError(Localizer.Diagnostic.annotatedTypeArgMissing(), errorNode);
        }

        if (!typeArgs || typeArgs.length === 0) {
            return AnyType.create();
        }

        let typeArg0Type = typeArgs[0].type;
        if (!validateTypeArg(typeArgs[0])) {
            typeArg0Type = UnknownType.create();
        }

        return TypeBase.cloneForAnnotated(typeArg0Type);
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
        const isTupleTypeParam = ClassType.isTupleClass(classType);

        if (typeArgs) {
            if (isTupleTypeParam && typeArgs.length === 1 && typeArgs[0].isEmptyTupleShorthand) {
                typeArgs = [];
            } else {
                let sawVariadic = false;
                let reportedVariadicError = false;

                // Verify that we didn't receive any inappropriate types.
                typeArgs.forEach((typeArg, index) => {
                    if (isEllipsisType(typeArg.type)) {
                        if (!isTupleTypeParam) {
                            addError(Localizer.Diagnostic.ellipsisContext(), typeArg.node);
                        } else if (typeArgs!.length !== 2 || index !== 1) {
                            addError(Localizer.Diagnostic.ellipsisSecondArg(), typeArg.node);
                        } else {
                            if (isTypeVar(typeArgs![0].type) && isVariadicTypeVar(typeArgs![0].type)) {
                                addError(Localizer.Diagnostic.typeVarTupleContext(), typeArgs![0].node);
                            }
                        }
                    } else if (isParamSpec(typeArg.type) && allowParamSpec) {
                        // Nothing to do - this is allowed.
                    } else if (isVariadicTypeVar(typeArg.type) && paramLimit === undefined) {
                        // Make sure we have at most one unpacked variadic type variable.
                        if (sawVariadic) {
                            if (!reportedVariadicError) {
                                addError(Localizer.Diagnostic.variadicTypeArgsTooMany(), typeArg.node);
                                reportedVariadicError = true;
                            }
                        }
                        validateVariadicTypeVarIsUnpacked(typeArg.type, typeArg.node);
                        sawVariadic = true;
                    } else {
                        validateTypeArg(typeArg);
                    }
                });
            }
        }

        let typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                addError(
                    Localizer.Diagnostic.typeArgsTooMany().format({
                        name: classType.aliasName || classType.details.name,
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

        // Handle tuple type params as a special case.
        if (isTupleTypeParam) {
            // If no type args are provided and it's a tuple, default to [Unknown, ...].
            if (!typeArgs) {
                typeArgTypes.push(UnknownType.create());
                typeArgTypes.push(AnyType.create(/* isEllipsis */ true));
            }

            return specializeTupleClass(classType, typeArgTypes, typeArgs !== undefined);
        }

        return ClassType.cloneForSpecialization(classType, typeArgTypes, typeArgs !== undefined);
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    function createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                let typeArgType = typeArg.type;

                if (!validateTypeArg(typeArg, /* allowEmptyTuple */ false, /* allowVariadicTypeVar */ true)) {
                    typeArgType = UnknownType.create();
                } else if (!TypeBase.isInstantiable(typeArgType)) {
                    addExpectedClassDiagnostic(typeArgType, typeArg.node);
                }

                types.push(typeArgType);
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

    function transformTypeForPossibleEnumClass(node: NameNode, getValueType: () => Type): Type | undefined {
        // If the node is within a class that derives from the metaclass
        // "EnumMeta", we need to treat assignments differently.
        const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
        if (enclosingClassNode) {
            const enumClassInfo = getTypeOfClass(enclosingClassNode);

            if (enumClassInfo && ClassType.isEnumClass(enumClassInfo.classType)) {
                // In ".py" files, the transform applies only to members that are
                // assigned within the class. In stub files, it applies to most variables
                // even if they are not assigned. This unfortunate convention means
                // there is no way in a stub to specify both enum members and instance
                // variables used within each enum instance. Unless/until there is
                // a change to this convention and all type checkers and stubs adopt
                // it, we're stuck with this limitation.
                let isMemberOfEnumeration =
                    (node.parent?.nodeType === ParseNodeType.Assignment && node.parent.leftExpression === node) ||
                    (node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
                        node.parent.valueExpression === node &&
                        node.parent.parent?.nodeType === ParseNodeType.Assignment) ||
                    (getFileInfo(node).isStubFile &&
                        node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
                        node.parent.valueExpression === node);

                // The spec specifically excludes names that start and end with a single underscore.
                // This also includes dunder names.
                if (isSingleDunderName(node.value)) {
                    isMemberOfEnumeration = false;
                }

                // Specifically exclude "value" and "name". These are reserved by the enum metaclass.
                if (node.value === 'name' || node.value === 'value') {
                    isMemberOfEnumeration = false;
                }

                const valueType = getValueType();

                // The spec excludes descriptors.
                if (isObject(valueType) && valueType.classType.details.fields.get('__get__')) {
                    isMemberOfEnumeration = false;
                }

                if (isMemberOfEnumeration) {
                    return ObjectType.create(
                        ClassType.cloneWithLiteral(
                            enumClassInfo.classType,
                            new EnumLiteral(enumClassInfo.classType.details.name, node.value, valueType)
                        )
                    );
                }
            }
        }
    }

    function transformTypeForTypeAlias(type: Type, name: NameNode, errorNode: ParseNode): Type {
        if (!TypeBase.isInstantiable(type)) {
            return type;
        }

        // If this is a recursive type alias that hasn't yet been fully resolved
        // (i.e. there is no boundType associated with it), don't apply the transform.
        if (isTypeAliasPlaceholder(type)) {
            return type;
        }

        // Determine if there are any generic type parameters associated
        // with this type alias.
        let typeParameters: TypeVarType[] = [];

        // Skip this for a simple TypeVar (one that's not part of a union).
        if (!isTypeVar(type) || TypeBase.isAnnotated(type)) {
            doForEachSubtype(type, (subtype) => {
                addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(subtype));
            });
        }

        // Don't include any synthesized type variables.
        typeParameters = typeParameters.filter((typeVar) => !typeVar.details.isSynthesized);

        // Verify that we have at most one variadic type variable.
        const variadics = typeParameters.filter((param) => isVariadicTypeVar(param));
        if (variadics.length > 1) {
            addError(
                Localizer.Diagnostic.variadicTypeParamTooManyAlias().format({
                    names: variadics.map((v) => `"${v.details.name}"`).join(', '),
                }),
                errorNode
            );
        }

        const fileInfo = getFileInfo(name);

        return TypeBase.cloneForTypeAlias(
            type,
            name.value,
            `${fileInfo.moduleName}.${name.value}`,
            getScopeIdForNode(name),
            typeParameters.length > 0 ? typeParameters : undefined
        );
    }

    function createSpecialBuiltInClass(node: ParseNode, assignedName: string, aliasMapEntry: AliasMapEntry): ClassType {
        const fileInfo = getFileInfo(node);
        let specialClassType = ClassType.create(
            assignedName,
            getClassFullName(node, fileInfo.moduleName, assignedName),
            fileInfo.moduleName,
            fileInfo.filePath,
            ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
            /* typeSourceId */ 0,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined
        );

        if (fileInfo.isTypingExtensionsStubFile) {
            specialClassType.details.flags |= ClassTypeFlags.TypingExtensionClass;
        }

        const baseClassName = aliasMapEntry.alias || 'object';

        let baseClass: Type | undefined;
        if (aliasMapEntry.module === 'builtins') {
            baseClass = getBuiltInType(node, baseClassName);
        } else if (aliasMapEntry.module === 'collections') {
            // The typing.pyi file imports collections.
            if (fileInfo.collectionsModulePath) {
                const lookupResult = importLookup(fileInfo.collectionsModulePath);
                if (lookupResult) {
                    const symbol = lookupResult.symbolTable.get(baseClassName);
                    if (symbol) {
                        baseClass = getEffectiveTypeOfSymbol(symbol);
                    }
                }
            }
        } else if (aliasMapEntry.module === 'self') {
            const symbolWithScope = lookUpSymbolRecursive(node, baseClassName, /* honorCodeFlow */ false);
            if (symbolWithScope) {
                baseClass = getEffectiveTypeOfSymbol(symbolWithScope.symbol);
                // The _TypedDict class is marked as abstract, but the
                // methods that are abstract are overridden and shouldn't
                // cause the TypedDict to be marked as abstract.
                if (isClass(baseClass) && ClassType.isBuiltIn(baseClass, '_TypedDict')) {
                    baseClass.details.flags &= ~(
                        ClassTypeFlags.HasAbstractMethods | ClassTypeFlags.SupportsAbstractMethods
                    );
                }
            }
        }

        if (baseClass && isClass(baseClass)) {
            if (aliasMapEntry.alias) {
                specialClassType = ClassType.cloneForTypingAlias(baseClass, assignedName);
            } else {
                specialClassType.details.baseClasses.push(baseClass);
                specialClassType.details.effectiveMetaclass = baseClass.details.effectiveMetaclass;
                computeMroLinearization(specialClassType);
            }
        } else {
            specialClassType.details.baseClasses.push(UnknownType.create());
            specialClassType.details.effectiveMetaclass = UnknownType.create();
            computeMroLinearization(specialClassType);
        }

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
            TypeGuard: { alias: '', module: 'builtins' },
            Unpack: { alias: '', module: 'builtins' },
            Required: { alias: '', module: 'builtins' },
            NotRequired: { alias: '', module: 'builtins' },
        };

        const aliasMapEntry = specialTypes[assignedName];
        if (aliasMapEntry) {
            const cachedType = readTypeCache(node);
            if (cachedType) {
                assert(isClass(cachedType));
                return cachedType as ClassType;
            }
            const specialType = createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
            writeTypeCache(node, specialType, /* isIncomplete */ false);
            return specialType;
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
        let isIncomplete = false;
        let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;

        if (!rightHandType) {
            // Special-case the typing.pyi file, which contains some special
            // types that the type analyzer needs to interpret differently.
            if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
                rightHandType = handleTypingStubAssignment(node);
                if (rightHandType) {
                    writeTypeCache(node.rightExpression, rightHandType, /* isIncomplete */ false);
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
                let isSpeculativeTypeAlias = false;

                if (isDeclaredTypeAlias(node.leftExpression)) {
                    flags |=
                        EvaluatorFlags.ExpectingType |
                        EvaluatorFlags.EvaluateStringLiteralAsType |
                        EvaluatorFlags.ParamSpecDisallowed |
                        EvaluatorFlags.TypeVarTupleDisallowed;

                    typeAliasNameNode = (node.leftExpression as TypeAnnotationNode).valueExpression as NameNode;
                } else if (node.leftExpression.nodeType === ParseNodeType.Name) {
                    const symbolWithScope = lookUpSymbolRecursive(
                        node.leftExpression,
                        node.leftExpression.value,
                        /* honorCodeFlow */ false
                    );
                    if (symbolWithScope) {
                        const decls = symbolWithScope.symbol.getDeclarations();
                        if (decls.length === 1 && isPossibleTypeAliasDeclaration(decls[0])) {
                            typeAliasNameNode = node.leftExpression;
                            isSpeculativeTypeAlias = true;
                        }
                    }
                }

                // Synthesize a type variable that represents the type alias while we're
                // evaluating it. This allows us to handle recursive definitions.
                let typeAliasTypeVar: TypeVarType | undefined;
                if (typeAliasNameNode) {
                    typeAliasTypeVar = TypeVarType.createInstantiable(`__type_alias_${typeAliasNameNode.value}`);
                    typeAliasTypeVar.details.isSynthesized = true;
                    typeAliasTypeVar.details.recursiveTypeAliasName = typeAliasNameNode.value;
                    const scopeId = getScopeIdForNode(typeAliasNameNode);
                    typeAliasTypeVar.details.recursiveTypeAliasScopeId = scopeId;
                    typeAliasTypeVar.scopeId = scopeId;

                    // Write the type back to the type cache. It will be replaced below.
                    writeTypeCache(node, typeAliasTypeVar, /* isIncomplete */ false);
                    writeTypeCache(node.leftExpression, typeAliasTypeVar, /* isIncomplete */ false);
                }

                const srcTypeResult = getTypeOfExpression(node.rightExpression, declaredType, flags);
                let srcType = srcTypeResult.type;
                expectedTypeDiagAddendum = srcTypeResult.expectedTypeDiagAddendum;
                if (srcTypeResult.isIncomplete) {
                    isIncomplete = true;
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

                    if (canAssignType(declaredType, srcType, diagAddendum)) {
                        // Narrow the resulting type if possible.
                        srcType = narrowTypeBasedOnAssignment(declaredType, srcType);
                    }
                }

                // If this is an enum, transform the type as required.
                rightHandType = srcType;
                if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
                    rightHandType =
                        transformTypeForPossibleEnumClass(node.leftExpression, () => rightHandType!) || rightHandType;
                }

                if (typeAliasNameNode) {
                    // Clear out the temporary types we wrote above.
                    deleteTypeCacheEntry(node);
                    deleteTypeCacheEntry(node.leftExpression);

                    // If this was a speculative type alias, it becomes a real type alias
                    // only if the evaluated type is an instantiable type.
                    if (
                        !isSpeculativeTypeAlias ||
                        (TypeBase.isInstantiable(rightHandType) && !isUnknown(rightHandType))
                    ) {
                        // If this is a type alias, record its name based on the assignment target.
                        rightHandType = transformTypeForTypeAlias(
                            rightHandType,
                            typeAliasNameNode,
                            node.rightExpression
                        );

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

                        // Record the type parameters within the recursive type alias so it
                        // can be specialized.
                        typeAliasTypeVar!.details.recursiveTypeParameters = rightHandType.typeAliasInfo?.typeParameters;
                    }
                }
            }
        }

        assignTypeToExpression(
            node.leftExpression,
            rightHandType,
            isIncomplete,
            node.rightExpression,
            /* ignoreEmptyContainers */ true,
            expectedTypeDiagAddendum
        );

        writeTypeCache(node, rightHandType, isIncomplete);
    }

    function evaluateTypesForAugmentedAssignment(node: AugmentedAssignmentNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const destTypeResult = getTypeFromAugmentedAssignment(node, /* expectedType */ undefined);
        assignTypeToExpression(
            node.destExpression,
            destTypeResult.type,
            !!destTypeResult.isIncomplete,
            node.rightExpression
        );

        writeTypeCache(node, destTypeResult.type, !!destTypeResult.isIncomplete);
    }

    function getTypeOfClass(node: ClassNode): ClassTypeResult | undefined {
        // Is this type already cached?
        const cachedClassType = readTypeCache(node.name);

        if (cachedClassType) {
            if (!isClass(cachedClassType)) {
                // This can happen in rare circumstances where the class declaration
                // is located in an unreachable code block.
                return undefined;
            }
            return { classType: cachedClassType, decoratedType: readTypeCache(node) || UnknownType.create() };
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

            if (node.name.value === 'tuple') {
                classFlags |= ClassTypeFlags.TupleClass;
            }
        }

        const classType = ClassType.create(
            node.name.value,
            getClassFullName(node, fileInfo.moduleName, node.name.value),
            fileInfo.moduleName,
            fileInfo.filePath,
            classFlags,
            /* typeSourceId */ 0,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined,
            ParseTreeUtils.getDocString(node.suite.statements)
        );

        classType.details.typeVarScopeId = getScopeIdForNode(node);

        // Some classes refer to themselves within type arguments used within
        // base classes. We'll register the partially-constructed class type
        // to allow these to be resolved.
        const classSymbol = scope?.lookUpSymbol(node.name.value);
        let classDecl: ClassDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
            classDecl = decl as ClassDeclaration;
        }
        if (classDecl && classSymbol) {
            setSymbolResolutionPartialType(classSymbol, classDecl, classType);
        }
        classType.details.flags |= ClassTypeFlags.PartiallyConstructed;
        writeTypeCache(node, classType, /* isIncomplete */ false);
        writeTypeCache(node.name, classType, /* isIncomplete */ false);

        // Keep a list of unique type parameters that are used in the
        // base class arguments.
        const typeParameters: TypeVarType[] = [];

        // If the class derives from "Generic" directly, it will provide
        // all of the type parameters in the specified order.
        let genericTypeParameters: TypeVarType[] | undefined;

        const initSubclassArgs: FunctionArgument[] = [];
        let metaclassNode: ExpressionNode | undefined;
        let exprFlags =
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.GenericClassTypeAllowed |
            EvaluatorFlags.DisallowTypeVarsWithScopeId |
            EvaluatorFlags.AssociateTypeVarsWithCurrentScope;
        if (fileInfo.isStubFile) {
            exprFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        node.arguments.forEach((arg) => {
            if (!arg.name) {
                let argType = getTypeOfExpression(arg.valueExpression, undefined, exprFlags).type;

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (isUnion(argType)) {
                    argType = removeUnbound(argType);
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

                // Check for a duplicate class.
                if (
                    classType.details.baseClasses.some((prevBaseClass) => {
                        return (
                            isClass(prevBaseClass) &&
                            isClass(argType) &&
                            ClassType.isSameGenericClass(argType, prevBaseClass)
                        );
                    })
                ) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.duplicateBaseClass(),
                        arg.name || arg
                    );
                }

                classType.details.baseClasses.push(argType);
                if (isClass(argType)) {
                    if (ClassType.isEnumClass(argType)) {
                        classType.details.flags |= ClassTypeFlags.EnumClass;
                    }

                    // Determine if the class is abstract. Protocol classes support abstract methods
                    // even though they don't derive from the ABCMeta class. We'll exclude built-in
                    // protocol classes because these are known not to contain any abstract methods
                    // and getAbstractMethods causes problems because of dependencies on some of these
                    // built-in protocol classes.
                    if (
                        ClassType.supportsAbstractMethods(argType) ||
                        (ClassType.isProtocolClass(argType) && !ClassType.isBuiltIn(argType))
                    ) {
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

                addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(argType));
                if (isClass(argType) && ClassType.isBuiltIn(argType, 'Generic')) {
                    if (!genericTypeParameters) {
                        genericTypeParameters = [];
                        addTypeVarsToListIfUnique(genericTypeParameters, getTypeVarArgumentsRecursive(argType));
                    }
                }
            } else if (arg.name.value === 'metaclass') {
                if (metaclassNode) {
                    addError(Localizer.Diagnostic.metaclassDuplicate(), arg);
                } else {
                    metaclassNode = arg.valueExpression;
                }
            } else if (arg.name.value === 'total' && ClassType.isTypedDictClass(classType)) {
                // The "total" parameter name applies only for TypedDict classes.
                // PEP 589 specifies that the parameter must be either True or False.
                const constArgValue = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                if (constArgValue === undefined) {
                    addError(Localizer.Diagnostic.typedDictTotalParam(), arg.valueExpression);
                } else if (!constArgValue) {
                    classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
                }
            } else {
                // Collect arguments that will be passed to the `__init_subclass__`
                // method described in PEP 487.
                initSubclassArgs.push({
                    argumentCategory: ArgumentCategory.Simple,
                    node: arg,
                    name: arg.name,
                    valueExpression: arg.valueExpression,
                });
            }
        });

        // Check for NamedTuple multiple inheritance.
        if (classType.details.baseClasses.length > 1) {
            if (
                classType.details.baseClasses.some(
                    (baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'NamedTuple')
                )
            ) {
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.namedTupleMultipleInheritance(),
                    node.name
                );
            }
        }

        // Make sure we don't have 'object' derive from itself. Infinite
        // recursion will result.
        if (!ClassType.isBuiltIn(classType, 'object')) {
            classType.details.baseClasses.push(getBuiltInType(node, 'object'));
        }

        // If genericTypeParameters are provided, make sure that typeParameters is a proper subset.
        if (genericTypeParameters) {
            verifyGenericTypeParameters(node.name, typeParameters, genericTypeParameters);
        }
        classType.details.typeParameters = genericTypeParameters || typeParameters;

        // Make sure there's at most one variadic type parameter.
        const variadics = classType.details.typeParameters.filter((param) => isVariadicTypeVar(param));
        if (variadics.length > 1) {
            addError(
                Localizer.Diagnostic.variadicTypeParamTooManyClass().format({
                    names: variadics.map((v) => `"${v.details.name}"`).join(', '),
                }),
                node.name,
                TextRange.combine(node.arguments) || node.name
            );
        }

        if (!computeMroLinearization(classType)) {
            addError(Localizer.Diagnostic.methodOrdering(), node.name);
        }

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
                                const typeVar = TypeVarType.createInstance(`__type_of_${param.name!.value}`);
                                typeVar.details.isSynthesized = true;
                                typeVar.scopeId = getScopeIdForNode(initDeclNode);
                                typeVar.details.boundType = UnknownType.create();
                                return TypeVarType.cloneForScopeId(typeVar, getScopeIdForNode(node), node.name.value);
                            });
                        }
                    }
                }
            }
        }

        // Determine if the class has a custom __class_getitem__ method. This applies
        // only to classes that have no type parameters, since those with type parameters
        // are assumed to follow normal subscripting semantics for generic classes.
        if (classType.details.typeParameters.length === 0) {
            if (
                classType.details.baseClasses.some(
                    (baseClass) => isClass(baseClass) && ClassType.hasCustomClassGetItem(baseClass)
                ) ||
                classType.details.fields.has('__class_getitem__')
            ) {
                classType.details.flags |= ClassTypeFlags.HasCustomClassGetItem;
            }
        }

        // Determine the effective metaclass and detect metaclass conflicts.
        if (metaclassNode) {
            const metaclassType = getTypeOfExpression(metaclassNode, undefined, exprFlags).type;
            if (isClass(metaclassType) || isUnknown(metaclassType)) {
                classType.details.declaredMetaclass = metaclassType;
                if (isClass(metaclassType)) {
                    if (ClassType.isBuiltIn(metaclassType, 'EnumMeta')) {
                        classType.details.flags |= ClassTypeFlags.EnumClass;
                    } else if (ClassType.isBuiltIn(metaclassType, 'ABCMeta')) {
                        classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
                    }
                }
            }
        }

        let effectiveMetaclass = classType.details.declaredMetaclass;
        let reportedMetaclassConflict = false;

        if (!effectiveMetaclass || isClass(effectiveMetaclass)) {
            for (const baseClass of classType.details.baseClasses) {
                if (isClass(baseClass)) {
                    const baseClassMeta = baseClass.details.effectiveMetaclass || typeClassType;
                    if (baseClassMeta && isClass(baseClassMeta)) {
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
            const typeMetaclass = getBuiltInType(node, 'type');
            effectiveMetaclass = typeMetaclass && isClass(typeMetaclass) ? typeMetaclass : UnknownType.create();
        }

        classType.details.effectiveMetaclass = effectiveMetaclass;

        // Determine if the class is abstract.
        if (ClassType.supportsAbstractMethods(classType)) {
            if (getAbstractMethods(classType).length > 0) {
                classType.details.flags |= ClassTypeFlags.HasAbstractMethods;
            }
        }

        // Now determine the decorated type of the class.
        let decoratedType: Type = classType;
        let foundUnknown = false;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyClassDecorator(decoratedType, classType, decorator);
            if (containsUnknown(newDecoratedType)) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        Localizer.Diagnostic.classDecoratorTypeUnknown(),
                        node.decorators[i].expression
                    );

                    foundUnknown = true;
                }
            } else {
                // Apply the decorator only if the type is known.
                decoratedType = newDecoratedType;
            }
        }

        if (isClass(effectiveMetaclass)) {
            // Mark the class as a dataclass if the metaclass provides dataclass-like behaviors.
            if (effectiveMetaclass.details.metaclassDataClassTransform) {
                applyDataClassDefaultBehaviors(classType, effectiveMetaclass.details.metaclassDataClassTransform);
                applyDataClassMetaclassBehaviorOverrides(node, classType, initSubclassArgs);
            }
        }

        // Synthesize dataclass methods.
        if (ClassType.isDataClass(classType)) {
            let skipSynthesizedInit = ClassType.isSkipSynthesizedDataClassInit(classType);
            if (!skipSynthesizedInit) {
                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                const initSymbol = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipBaseClasses);
                if (initSymbol) {
                    const initSymbolType = getTypeOfMember(initSymbol);
                    if (isFunction(initSymbolType)) {
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
        writeTypeCache(node.name, classType, /* isIncomplete */ false);

        // Update the decorated class type.
        writeTypeCache(node, decoratedType, /* isIncomplete */ false);

        // Validate __init_subclass__ call.
        validateInitSubclassArgs(node, classType, initSubclassArgs);

        return { classType, decoratedType };
    }

    // Verifies that the type variables provided outside of "Generic" are also
    // provided within the "Generic". For example:
    //    class Foo(Mapping[K, V], Generic[V])
    // is illegal because K is not included in Generic.
    function verifyGenericTypeParameters(
        errorNode: ExpressionNode,
        typeVars: TypeVarType[],
        genericTypeVars: TypeVarType[]
    ) {
        const missingFromGeneric = typeVars.filter((typeVar) => {
            return !genericTypeVars.some((genericTypeVar) => genericTypeVar.details.name === typeVar.details.name);
        });

        if (missingFromGeneric.length > 0) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(
                Localizer.DiagnosticAddendum.typeVarsMissing().format({
                    names: missingFromGeneric.map((typeVar) => `"${typeVar.details.name}"`).join(', '),
                })
            );
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeVarsNotInGeneric() + diag.getString(),
                errorNode
            );
        }
    }

    function validateDataClassTransformDecorator(node: ExpressionNode): DataClassBehaviors | undefined {
        if (node.nodeType !== ParseNodeType.Call) {
            // TODO - emit diagnostic
            return undefined;
        }

        const behaviors: DataClassBehaviors = {
            keywordOnlyParams: false,
            generateEq: true,
            generateOrder: false,
            fieldDescriptorNames: [],
        };

        const fileInfo = getFileInfo(node);

        // Parse the arguments to the call.
        node.arguments.forEach((arg) => {
            if (!arg.name) {
                // TODO - emit diagnostic
                return;
            }

            if (arg.argumentCategory !== ArgumentCategory.Simple) {
                // TODO - emit diagnostic
                return;
            }

            switch (arg.name.value) {
                case 'kw_only_default': {
                    const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                    if (value === undefined) {
                        // TODO - emit diagnostic
                        return;
                    }

                    behaviors.keywordOnlyParams = value;
                    break;
                }

                case 'eq_default': {
                    const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                    if (value === undefined) {
                        // TODO - emit diagnostic
                        return;
                    }

                    behaviors.generateEq = value;
                    break;
                }

                case 'order_default': {
                    const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                    if (value === undefined) {
                        // TODO - emit diagnostic
                        return;
                    }

                    behaviors.generateOrder = value;
                    break;
                }

                case 'field_descriptors': {
                    const valueType = getTypeOfExpression(arg.valueExpression).type;
                    if (
                        !isObject(valueType) ||
                        !ClassType.isBuiltIn(valueType.classType, 'tuple') ||
                        !valueType.classType.tupleTypeArguments ||
                        valueType.classType.tupleTypeArguments.some(
                            (entry) => !isClass(entry) && !isFunction(entry) && !isOverloadedFunction(entry)
                        )
                    ) {
                        // TODO - emit diagnostic
                        return;
                    }

                    if (!behaviors.fieldDescriptorNames) {
                        behaviors.fieldDescriptorNames = [];
                    }
                    valueType.classType.tupleTypeArguments.forEach((arg) => {
                        if (isClass(arg) || isFunction(arg)) {
                            behaviors.fieldDescriptorNames.push(arg.details.fullName);
                        } else if (isOverloadedFunction(arg)) {
                            behaviors.fieldDescriptorNames.push(arg.overloads[0].details.fullName);
                        }
                    });
                    break;
                }

                default:
                    // TODO - emit diagnostic
                    break;
            }
        });

        return behaviors;
    }

    function getDataclassDecoratorBehaviors(type: Type): DataClassBehaviors | undefined {
        let functionType: FunctionType | undefined;
        if (isFunction(type)) {
            functionType = type;
        } else if (isOverloadedFunction(type)) {
            functionType = type.overloads[0];
        }

        if (!functionType) {
            return undefined;
        }

        if (functionType.details.decoratorDataClassBehaviors) {
            return functionType.details.decoratorDataClassBehaviors;
        }

        // Is this the built-in dataclass? If so, return the default behaviors.
        if (functionType.details.builtInName === 'dataclass') {
            return {
                keywordOnlyParams: false,
                generateEq: true,
                generateOrder: false,
                fieldDescriptorNames: ['dataclasses.field', 'dataclasses.Field'],
            };
        }

        return undefined;
    }

    function isDataclassFieldConstructor(type: Type, fieldDescriptorNames: string[]) {
        let callName: string | undefined;

        if (isFunction(type)) {
            callName = type.details.fullName;
        } else if (isOverloadedFunction(type)) {
            callName = type.overloads[0].details.fullName;
        } else if (isClass(type)) {
            callName = type.details.fullName;
        }

        if (!callName) {
            return false;
        }

        return fieldDescriptorNames.some((name) => name === callName);
    }

    function applyClassDecorator(
        inputClassType: Type,
        originalClassType: ClassType,
        decoratorNode: DecoratorNode
    ): Type {
        const decoratorType = getTypeOfExpression(decoratorNode.expression).type;

        if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
            const decoratorCallType = getTypeOfExpression(decoratorNode.expression.leftExpression).type;
            if (isFunction(decoratorCallType)) {
                if (decoratorCallType.details.name === '__dataclass_transform__') {
                    originalClassType.details.metaclassDataClassTransform = validateDataClassTransformDecorator(
                        decoratorNode.expression
                    );
                }
            }
        }

        if (isOverloadedFunction(decoratorType)) {
            const dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorType);
            if (dataclassBehaviors) {
                applyDataClassDecorator(originalClassType, dataclassBehaviors, /* callNode */ undefined);
            }
        } else if (isFunction(decoratorType)) {
            if (decoratorType.details.builtInName === 'final') {
                originalClassType.details.flags |= ClassTypeFlags.Final;
            } else if (decoratorType.details.builtInName === 'runtime_checkable') {
                originalClassType.details.flags |= ClassTypeFlags.RuntimeCheckable;
            }

            // Is this a dataclass decorator?
            let dataclassBehaviors: DataClassBehaviors | undefined;
            let callNode: CallNode | undefined;

            if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
                callNode = decoratorNode.expression;
                const decoratorCallType = getTypeOfExpression(callNode.leftExpression).type;
                dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorCallType);
            } else {
                const decoratorType = getTypeOfExpression(decoratorNode.expression).type;
                dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorType);
            }

            if (dataclassBehaviors) {
                applyDataClassDecorator(originalClassType, dataclassBehaviors, callNode);
                return inputClassType;
            }
        }

        return getTypeFromDecorator(decoratorNode, inputClassType);
    }

    function applyDataClassBehaviorOverride(
        errorNode: ParseNode,
        classType: ClassType,
        argName: string,
        argValue: ExpressionNode
    ) {
        const fileInfo = getFileInfo(errorNode);
        const value = evaluateStaticBoolExpression(argValue, fileInfo.executionEnvironment);

        switch (argName) {
            case 'order':
                if (value === true) {
                    classType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
                } else if (value === false) {
                    classType.details.flags &= ~ClassTypeFlags.SynthesizedDataClassOrder;
                }
                break;

            case 'kw_only':
                if (value === false) {
                    classType.details.flags &= ~ClassTypeFlags.DataClassKeywordOnlyParams;
                } else if (value === true) {
                    classType.details.flags |= ClassTypeFlags.DataClassKeywordOnlyParams;
                }
                break;

            case 'frozen': {
                let hasUnfrozenBaseClass = false;
                let hasFrozenBaseClass = false;

                classType.details.baseClasses.forEach((baseClass) => {
                    if (isClass(baseClass) && ClassType.isDataClass(baseClass)) {
                        if (ClassType.isFrozenDataClass(baseClass)) {
                            hasFrozenBaseClass = true;
                        } else if (
                            !baseClass.details.declaredMetaclass ||
                            !isClass(baseClass.details.declaredMetaclass) ||
                            !baseClass.details.declaredMetaclass.details.metaclassDataClassTransform
                        ) {
                            // If this base class is unfrozen and isn't the class that directly
                            // references the metaclass that provides dataclass-like behaviors,
                            // we'll assume we're deriving from an unfrozen dataclass.
                            hasUnfrozenBaseClass = true;
                        }
                    }
                });

                if (value === true || hasFrozenBaseClass) {
                    classType.details.flags |= ClassTypeFlags.FrozenDataClass;

                    // A frozen dataclass cannot derive from a non-frozen dataclass.
                    if (hasUnfrozenBaseClass) {
                        addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.dataClassBaseClassNotFrozen(),
                            errorNode
                        );
                    }
                }
                break;
            }

            case 'init':
                if (value === false) {
                    classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassInit;
                } else if (value === true) {
                    classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassInit;
                }
                break;

            case 'eq':
                if (value === false) {
                    classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
                } else if (value === true) {
                    classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassEq;
                }
                break;
        }
    }

    function applyDataClassMetaclassBehaviorOverrides(node: ClassNode, classType: ClassType, args: FunctionArgument[]) {
        args.forEach((arg) => {
            if (arg.valueExpression && arg.name) {
                applyDataClassBehaviorOverride(arg.name, classType, arg.name.value, arg.valueExpression);
            }
        });
    }

    function applyDataClassDefaultBehaviors(classType: ClassType, defaultBehaviors: DataClassBehaviors) {
        classType.details.dataClassBehaviors = defaultBehaviors;
        classType.details.flags |= ClassTypeFlags.DataClass;

        if (defaultBehaviors.keywordOnlyParams) {
            classType.details.flags |= ClassTypeFlags.DataClassKeywordOnlyParams;
        }

        if (!defaultBehaviors.generateEq) {
            classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
        }

        if (defaultBehaviors.generateOrder) {
            classType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
        }
    }

    function applyDataClassDecorator(
        classType: ClassType,
        defaultBehaviors: DataClassBehaviors,
        callNode: CallNode | undefined
    ) {
        applyDataClassDefaultBehaviors(classType, defaultBehaviors);

        if (callNode?.arguments) {
            callNode.arguments.forEach((arg) => {
                if (arg.name && arg.valueExpression) {
                    applyDataClassBehaviorOverride(arg, classType, arg.name.value, arg.valueExpression);
                }
            });
        }
    }

    function validateInitSubclassArgs(node: ClassNode, classType: ClassType, argList: FunctionArgument[]) {
        const errorNode = argList.length > 0 ? argList[0].node!.name! : node.name;
        const initSubclassMethodInfo = getTypeFromClassMemberName(
            errorNode,
            classType,
            '__init_subclass__',
            { method: 'get' },
            new DiagnosticAddendum(),
            MemberAccessFlags.AccessClassMembersOnly |
                MemberAccessFlags.SkipObjectBaseClass |
                MemberAccessFlags.SkipOriginalClass,
            classType
        );

        if (initSubclassMethodInfo) {
            const initSubclassMethodType = initSubclassMethodInfo.type;

            if (initSubclassMethodType) {
                validateCallArguments(
                    errorNode,
                    argList,
                    initSubclassMethodType,
                    new TypeVarMap(getTypeVarScopeId(initSubclassMethodType)),
                    /* skipUnknownArgCheck */ false,
                    NoneType.createInstance()
                );
            }
        }
    }

    function getTypeOfFunction(node: FunctionNode): FunctionTypeResult | undefined {
        const fileInfo = getFileInfo(node);

        // Is this type already cached?
        const cachedFunctionType = readTypeCache(node.name) as FunctionType;

        if (cachedFunctionType) {
            if (!isFunction(cachedFunctionType)) {
                // This can happen in certain rare circumstances where the
                // function declaration falls within an unreachable code block.
                return undefined;
            }
            return { functionType: cachedFunctionType, decoratedType: readTypeCache(node) || UnknownType.create() };
        }

        let functionDecl: FunctionDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
            functionDecl = decl as FunctionDeclaration;
        }

        // There was no cached type, so create a new one.
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
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

        // Special-case magic method __class_getitem__, which is implicitly a class method.
        if (containingClassNode && node.name.value === '__class_getitem__') {
            functionFlags |= FunctionTypeFlags.ClassMethod;
        }

        if (fileInfo.isStubFile) {
            functionFlags |= FunctionTypeFlags.StubDefinition;
        } else if (fileInfo.isInPyTypedPackage && evaluatorOptions.disableInferenceForPyTypedSources) {
            functionFlags |= FunctionTypeFlags.PyTypedDefinition;
        }

        if (node.isAsync) {
            functionFlags |= FunctionTypeFlags.Async;
        }

        const functionType = FunctionType.createInstance(
            node.name.value,
            getFunctionFullName(node, fileInfo.moduleName, node.name.value),
            fileInfo.moduleName,
            functionFlags,
            ParseTreeUtils.getDocString(node.suite.statements)
        );

        functionType.details.typeVarScopeId = getScopeIdForNode(node);

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
        const functionSymbol = scope?.lookUpSymbolRecursive(node.name.value);
        if (functionDecl && functionSymbol) {
            setSymbolResolutionPartialType(functionSymbol.symbol, functionDecl, functionType);
        }
        writeTypeCache(node, functionType, /* isIncomplete */ false);
        writeTypeCache(node.name, functionType, /* isIncomplete */ false);

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

        node.parameters.forEach((param, index) => {
            let paramType: Type | undefined;
            let annotatedType: Type | undefined;
            let isNoneWithoutOptional = false;
            let paramTypeNode: ExpressionNode | undefined;

            if (param.name) {
                let markParamAccessed = false;

                if (
                    index === 0 &&
                    containingClassType &&
                    (FunctionType.isClassMethod(functionType) ||
                        FunctionType.isInstanceMethod(functionType) ||
                        FunctionType.isConstructorMethod(functionType))
                ) {
                    // Mark "self/cls" as accessed.
                    markParamAccessed = true;
                } else if (FunctionType.isAbstractMethod(functionType) || FunctionType.isOverloaded(functionType)) {
                    // Mark all parameters in abstract methods and overloaded
                    // functions as accessed.
                    markParamAccessed = true;
                } else if (containingClassType && ClassType.isProtocolClass(containingClassType)) {
                    // Mark all parameters in protocol methods as accessed.
                    markParamAccessed = true;
                }

                if (markParamAccessed) {
                    const symbolWithScope = lookUpSymbolRecursive(
                        param.name,
                        param.name.value,
                        /* honorCodeFlow */ false
                    );
                    if (symbolWithScope) {
                        setSymbolAccessed(fileInfo, symbolWithScope.symbol, param.name);
                    }
                }
            }

            if (param.typeAnnotation) {
                paramTypeNode = param.typeAnnotation;
            } else if (param.typeAnnotationComment) {
                paramTypeNode = param.typeAnnotationComment;
            } else if (node.functionAnnotationComment && !node.functionAnnotationComment.isParamListEllipsis) {
                const adjustedIndex = index - firstCommentAnnotationIndex;
                if (adjustedIndex >= 0 && adjustedIndex < node.functionAnnotationComment.paramTypeAnnotations.length) {
                    paramTypeNode = node.functionAnnotationComment.paramTypeAnnotations[adjustedIndex];
                }
            }

            if (paramTypeNode) {
                annotatedType = getTypeOfAnnotation(
                    paramTypeNode,
                    /* isVariableAnnotation */ false,
                    /* allowFinal */ false,
                    /* associateTypeVarsWithScope */ true,
                    /* allowTypeVarType */ param.category === ParameterCategory.VarArgList
                );

                if (isVariadicTypeVar(annotatedType) && !annotatedType.isVariadicUnpacked) {
                    addError(
                        Localizer.Diagnostic.unpackedTypeVarTupleExpected().format({
                            name1: annotatedType.details.name,
                            name2: annotatedType.details.name,
                        }),
                        paramTypeNode
                    );
                    annotatedType = UnknownType.create();
                }
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
                if (param.defaultValue && defaultValueType) {
                    const diagAddendum = new DiagnosticAddendum();
                    const typeVarMap = new TypeVarMap(functionType.details.typeVarScopeId);
                    if (containingClassType && containingClassType.details.typeVarScopeId !== undefined) {
                        if (node.name.value === '__init__' || node.name.value === '__new__') {
                            typeVarMap.addSolveForScope(containingClassType.details.typeVarScopeId);
                        }
                    }

                    if (!canAssignType(annotatedType, defaultValueType, diagAddendum, typeVarMap)) {
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
                defaultValueExpression: param.defaultValue,
                defaultType: defaultValueType,
                type: paramType || UnknownType.create(),
                typeAnnotation: paramTypeNode,
                hasDeclaredType: !!paramTypeNode,
            };

            FunctionType.addParameter(functionType, functionParam);

            if (param.name) {
                const variadicParamType = transformVariadicParamType(node, param.category, functionParam.type);
                paramTypes.push(variadicParamType);
            } else {
                paramTypes.push(functionParam.type);
            }
        });

        if (containingClassType) {
            // If the first parameter doesn't have an explicit type annotation,
            // provide a type if it's an instance, class or constructor method.
            if (functionType.details.parameters.length > 0) {
                const typeAnnotation = getTypeAnnotationForParameter(node, 0);
                if (!typeAnnotation) {
                    const inferredParamType = inferFirstParamType(
                        functionType.details.flags,
                        containingClassType,
                        node
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
        }

        // Update the types for the nodes associated with the parameters.
        paramTypes.forEach((paramType, index) => {
            const paramNameNode = node.parameters[index].name;
            if (paramNameNode) {
                if (isUnknown(paramType)) {
                    functionType.details.flags |= FunctionTypeFlags.UnannotatedParams;
                }
                writeTypeCache(paramNameNode, paramType, /* isIncomplete */ false);
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
                /* isVariableAnnotation */ false,
                /* allowFinal */ false,
                /* associateTypeVarsWithScope */ true
            );
            functionType.details.declaredReturnType = returnType;
        } else if (node.functionAnnotationComment) {
            // Temporarily set the return type to unknown in case of recursion.
            functionType.details.declaredReturnType = UnknownType.create();

            const returnType = getTypeOfAnnotation(
                node.functionAnnotationComment.returnTypeAnnotation,
                /* isVariableAnnotation */ false,
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
        let decoratedType: Type = preDecoratedType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyFunctionDecorator(decoratedType, functionType, decorator, node);
            if (containsUnknown(newDecoratedType)) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportUntypedFunctionDecorator,
                        DiagnosticRule.reportUntypedFunctionDecorator,
                        Localizer.Diagnostic.functionDecoratorTypeUnknown(),
                        node.decorators[i].expression
                    );

                    foundUnknown = true;
                }
            } else {
                // Apply the decorator only if the type is known.
                decoratedType = newDecoratedType;
            }
        }

        // See if there are any overloads provided by previous function declarations.
        if (isFunction(decoratedType)) {
            decoratedType = addOverloadsToFunctionType(node, decoratedType);
        }

        writeTypeCache(node.name, functionType, /* isIncomplete */ false);
        writeTypeCache(node, decoratedType, /* isIncomplete */ false);

        return { functionType, decoratedType };
    }

    // Synthesizes the "self" or "cls" parameter type if they are not explicitly annotated.
    function inferFirstParamType(
        flags: FunctionTypeFlags,
        containingClassType: ClassType,
        functionNode: FunctionNode
    ): Type | undefined {
        if ((flags & FunctionTypeFlags.StaticMethod) === 0) {
            if (containingClassType) {
                const hasClsParam = flags & (FunctionTypeFlags.ClassMethod | FunctionTypeFlags.ConstructorMethod);

                const selfType = TypeVarType.createInstance(`__type_of_self_${containingClassType.details.name}`);
                const scopeId = getScopeIdForNode(functionNode);
                selfType.details.isSynthesized = true;
                selfType.details.isSynthesizedSelfCls = true;
                selfType.nameWithScope = TypeVarType.makeNameWithScope(selfType.details.name, scopeId);
                selfType.scopeId = scopeId;

                // The self/cls parameter is allowed to skip the abstract class test
                // because the caller is possibly passing in a non-abstract subclass.
                selfType.details.boundType = ObjectType.create(
                    selfSpecializeClassType(containingClassType, /* setSkipAbstractClassTest */ true)
                );

                if (!hasClsParam) {
                    return selfType;
                }

                const typeClass = getTypingType(functionNode, 'Type');
                if (typeClass && isClass(typeClass)) {
                    return ObjectType.create(
                        ClassType.cloneForSpecialization(typeClass, [selfType], /* isTypeArgumentExplicit */ true)
                    );
                } else {
                    // This path is taken when analyzing the typing.pyi file.
                    return AnyType.create();
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
                if (tupleClassType && isClass(tupleClassType)) {
                    let tupleTypeArgs: Type[];
                    let isForVariadic = false;

                    if (isVariadicTypeVar(type) && type.isVariadicUnpacked) {
                        // Create a tuple[*X] type.
                        tupleTypeArgs = [type];
                        isForVariadic = true;
                    } else {
                        // Create a tuple[X, ...] type.
                        tupleTypeArgs = [type, AnyType.create(/* isEllipsis */ true)];
                    }

                    return ObjectType.create(
                        specializeTupleClass(
                            tupleClassType,
                            tupleTypeArgs,
                            /* isTypeArgumentExplicit */ true,
                            /* stripLiterals */ true,
                            isForVariadic
                        )
                    );
                }

                return UnknownType.create();
            }

            case ParameterCategory.VarArgDictionary: {
                const dictType = getBuiltInType(node, 'dict');
                const strType = getBuiltInObject(node, 'str');

                if (isClass(dictType) && isObject(strType)) {
                    return ObjectType.create(
                        ClassType.cloneForSpecialization(dictType, [strType, type], /* isTypeArgumentExplicit */ true)
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

        // The "__init_subclass__" magic method is not an instance method.
        // It acts an an implicit class method instead.
        if (node.name.value === '__init_subclass__' && isInClass) {
            flags |= FunctionTypeFlags.ClassMethod;
        }

        for (const decoratorNode of node.decorators) {
            let evaluatorFlags = EvaluatorFlags.DoNotSpecialize;
            if (fileInfo.isStubFile) {
                // Some stub files (e.g. builtins.pyi) rely on forward
                // declarations of decorators.
                evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
            }

            const decoratorType = getTypeOfExpression(
                decoratorNode.expression,
                /* expectedType */ undefined,
                evaluatorFlags
            ).type;
            if (isFunction(decoratorType)) {
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
        undecoratedType: FunctionType,
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

        const decoratorType = getTypeOfExpression(decoratorNode.expression, undefined, evaluatorFlags).type;

        // Special-case the "overload" because it has no definition.
        if (isClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) {
            if (isFunction(inputFunctionType)) {
                inputFunctionType.details.flags |= FunctionTypeFlags.Overloaded;
                undecoratedType.details.flags |= FunctionTypeFlags.Overloaded;
                return inputFunctionType;
            }
        }

        if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
            const decoratorCallType = getTypeOfExpression(decoratorNode.expression.leftExpression).type;

            if (isFunction(decoratorCallType)) {
                if (decoratorCallType.details.name === '__dataclass_transform__') {
                    undecoratedType.details.decoratorDataClassBehaviors = validateDataClassTransformDecorator(
                        decoratorNode.expression
                    );
                    return inputFunctionType;
                }
            }
        }

        // Special-case the "no_type_check" because it has no definition.
        // Pyright chooses not to implement the semantics of "no_type_check"
        // because it's an ill-conceived construct.
        if (isClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'no_type_check')) {
            return inputFunctionType;
        }

        let returnType = getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (isFunction(decoratorType)) {
            if (decoratorType.details.builtInName === 'abstractmethod') {
                return inputFunctionType;
            }

            // Handle property setters and deleters.
            if (decoratorNode.expression.nodeType === ParseNodeType.MemberAccess) {
                const baseType = getTypeOfExpression(decoratorNode.expression.leftExpression).type;
                if (isProperty(baseType)) {
                    const memberName = decoratorNode.expression.memberName.value;
                    if (memberName === 'setter') {
                        if (isFunction(inputFunctionType)) {
                            validatePropertyMethod(inputFunctionType, decoratorNode);
                            return clonePropertyWithSetter(baseType, inputFunctionType, functionNode);
                        } else {
                            return inputFunctionType;
                        }
                    } else if (memberName === 'deleter') {
                        if (isFunction(inputFunctionType)) {
                            validatePropertyMethod(inputFunctionType, decoratorNode);
                            return clonePropertyWithDeleter(baseType, inputFunctionType, functionNode);
                        } else {
                            return inputFunctionType;
                        }
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
                if (isFunction(inputFunctionType)) {
                    validatePropertyMethod(inputFunctionType, decoratorNode);
                    return createProperty(
                        decoratorNode,
                        decoratorType.details.name,
                        inputFunctionType,
                        getTypeSourceId(decoratorNode)
                    );
                } else {
                    return UnknownType.create();
                }
            }
        }

        if (isFunction(inputFunctionType) && isFunction(returnType)) {
            returnType = FunctionType.clone(returnType);

            // Copy the overload flag from the input function type.
            if (FunctionType.isOverloaded(inputFunctionType)) {
                returnType.details.flags |= FunctionTypeFlags.Overloaded;
            }

            // Copy the docstrings from the input function type if the
            // decorator didn't have its own docstring.
            if (!returnType.details.docString) {
                returnType.details.docString = inputFunctionType.details.docString;
            }
        }

        return returnType;
    }

    function validatePropertyMethod(method: FunctionType, errorNode: ParseNode) {
        if (FunctionType.isStaticMethod(method)) {
            addDiagnostic(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.propertyStaticMethod(),
                errorNode
            );
        }
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
            getClassFullName(decoratorNode, fileInfo.moduleName, `__property_${fget.details.name}`),
            fileInfo.moduleName,
            fileInfo.filePath,
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

        // Fill in the __get__ method with an overload.
        const getFunction1 = FunctionType.createInstance(
            '__get__',
            '',
            '',
            FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
        );
        getFunction1.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: propertyObject,
            hasDeclaredType: true,
        });
        getFunction1.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: NoneType.createInstance(),
            hasDeclaredType: true,
        });
        getFunction1.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'type',
            type: AnyType.create(),
            hasDeclaredType: true,
            hasDefault: true,
            defaultType: AnyType.create(),
        });
        getFunction1.details.declaredReturnType = FunctionType.isClassMethod(fget)
            ? fget.details.declaredReturnType
            : propertyObject;
        getFunction1.details.declaration = fget.details.declaration;

        const getFunction2 = FunctionType.createInstance(
            '__get__',
            '',
            '',
            FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
        );
        getFunction2.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: propertyObject,
            hasDeclaredType: true,
        });

        // Use the type of the "self" parameter for the object type. If it
        // was a synthesized "self" TypeVar with a bound type, use the bound
        // bound type instead.
        let objType = fget.details.parameters.length > 0 ? fget.details.parameters[0].type : AnyType.create();
        if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
            objType = makeTopLevelTypeVarsConcrete(objType);
        }
        getFunction2.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: FunctionType.isClassMethod(fget) ? convertToInstance(objType) : objType,
            hasDeclaredType: true,
        });
        getFunction2.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'type',
            type: AnyType.create(),
            hasDeclaredType: true,
            hasDefault: true,
            defaultType: AnyType.create(),
        });
        getFunction2.details.declaredReturnType = fget.details.declaredReturnType;
        getFunction2.details.declaration = fget.details.declaration;

        // Override the scope ID since we're using parameter types from the
        // decorated function.
        getFunction2.details.typeVarScopeId = getTypeVarScopeId(fget);

        const getFunctionOverload = OverloadedFunctionType.create([getFunction1, getFunction2]);
        const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunctionOverload);
        fields.set('__get__', getSymbol);

        // Fill in the getter, setter and deleter methods.
        ['getter', 'setter', 'deleter'].forEach((accessorName) => {
            const accessorFunction = FunctionType.createInstance(
                accessorName,
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod
            );
            accessorFunction.details.parameters.push({
                category: ParameterCategory.Simple,
                name: 'self',
                type: AnyType.create(),
                hasDeclaredType: true,
            });
            accessorFunction.details.parameters.push({
                category: ParameterCategory.Simple,
                name: 'accessor',
                type: AnyType.create(),
                hasDeclaredType: true,
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
            getFileInfo(errorNode).filePath,
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
        // We'll skip this test if the diagnostic rule is disabled because it
        // can be somewhat expensive, especially in code that is not annotated.
        const fileInfo = getFileInfo(errorNode);
        if (fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch !== 'none') {
            if (errorNode.parameters.length >= 2) {
                const typeAnnotation = getTypeAnnotationForParameter(errorNode, 1);
                if (typeAnnotation) {
                    // Verify consistency of the type.
                    const fgetType = getGetterTypeFromProperty(classType, /* inferTypeIfNeeded */ false);
                    if (fgetType && !isAnyOrUnknown(fgetType)) {
                        const fsetType = getTypeOfAnnotation(typeAnnotation, /* isVariableAnnotation */ false);

                        // The setter type should be assignable to the getter type.
                        const diag = new DiagnosticAddendum();
                        if (!canAssignType(fgetType, fsetType, diag)) {
                            addDiagnostic(
                                fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch,
                                DiagnosticRule.reportPropertyTypeMismatch,
                                Localizer.Diagnostic.setterGetterTypeMismatch() + diag.getString(),
                                typeAnnotation
                            );
                        }
                    }
                }
            }
        }

        // Fill in the fset method.
        const fsetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fset);
        fields.set('fset', fsetSymbol);

        // Fill in the __set__ method.
        const setFunction = FunctionType.createInstance('__set__', '', '', FunctionTypeFlags.SynthesizedMethod);
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: prop,
            hasDeclaredType: true,
        });
        let objType = fset.details.parameters.length > 0 ? fset.details.parameters[0].type : AnyType.create();
        if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
            objType = makeTopLevelTypeVarsConcrete(objType);
        }
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: combineTypes([objType, NoneType.createInstance()]),
            hasDeclaredType: true,
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
            hasDeclaredType: true,
        });
        const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
        fields.set('__set__', setSymbol);

        return propertyObject;
    }

    function clonePropertyWithDeleter(prop: Type, fdel: FunctionType, errorNode: FunctionNode): Type {
        if (!isProperty(prop)) {
            return prop;
        }

        const classType = (prop as ObjectType).classType;
        const propertyClass = ClassType.create(
            classType.details.name,
            classType.details.fullName,
            classType.details.moduleName,
            getFileInfo(errorNode).filePath,
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
        const delFunction = FunctionType.createInstance('__delete__', '', '', FunctionTypeFlags.SynthesizedMethod);
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: prop,
            hasDeclaredType: true,
        });
        let objType = fdel.details.parameters.length > 0 ? fdel.details.parameters[0].type : AnyType.create();
        if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
            objType = makeTopLevelTypeVarsConcrete(objType);
        }
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: combineTypes([objType, NoneType.createInstance()]),
            hasDeclaredType: true,
        });
        delFunction.details.declaredReturnType = NoneType.createInstance();
        const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
        fields.set('__delete__', delSymbol);

        return propertyObject;
    }

    // Given a function node and the function type associated with it, this
    // method searches for prior function nodes that are marked as @overload
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
            const declIndex = decls.findIndex((decl) => decl === functionDecl);
            if (declIndex > 0) {
                // Evaluate all of the previous function declarations. They will
                // be cached. We do it in this order to avoid a stack overflow due
                // to recursion if there is a large number (1000's) of overloads.
                for (let i = 0; i < declIndex; i++) {
                    const decl = decls[i];
                    if (decl.type === DeclarationType.Function) {
                        getTypeOfFunction(decl.node);
                    }
                }

                const overloadedTypes: FunctionType[] = [];

                // Look at the previous declaration's type.
                const prevDecl = decls[declIndex - 1];
                if (prevDecl.type === DeclarationType.Function) {
                    const prevDeclDeclTypeInfo = getTypeOfFunction(prevDecl.node);
                    if (prevDeclDeclTypeInfo) {
                        if (isFunction(prevDeclDeclTypeInfo.decoratedType)) {
                            if (FunctionType.isOverloaded(prevDeclDeclTypeInfo.decoratedType)) {
                                overloadedTypes.push(prevDeclDeclTypeInfo.decoratedType);
                            }
                        } else if (isOverloadedFunction(prevDeclDeclTypeInfo.decoratedType)) {
                            // If the previous declaration was itself an overloaded function,
                            // copy the entries from it.
                            overloadedTypes.push(...prevDeclDeclTypeInfo.decoratedType.overloads);
                        }
                    }
                }

                overloadedTypes.push(type);

                if (overloadedTypes.length === 1) {
                    return overloadedTypes[0];
                }

                // Create a new overloaded type that copies the contents of the previous
                // one and adds a new function.
                const newOverload = OverloadedFunctionType.create(overloadedTypes);

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

        return type;
    }

    function createAsyncFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
        // Clone the original function and replace its return type with an
        // Awaitable[<returnType>].
        const awaitableFunctionType = FunctionType.clone(functionType);

        if (functionType.details.declaredReturnType) {
            awaitableFunctionType.details.declaredReturnType = createAwaitableReturnType(
                node,
                functionType.details.declaredReturnType,
                !!functionType.details.declaration?.isGenerator
            );
        }

        // Note that the inferred type, once lazily computed, needs to wrap the
        // resulting type in an awaitable.
        awaitableFunctionType.details.flags |= FunctionTypeFlags.WrapReturnTypeInAwait;

        return awaitableFunctionType;
    }

    function createAwaitableReturnType(node: ParseNode, returnType: Type, isGenerator: boolean): Type {
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
                                /* isTypeArgumentExplicit */ true
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

        if (!awaitableReturnType || !isGenerator) {
            // Wrap in a Coroutine, which is a subclass of Awaitable.
            const coroutineType = getTypingType(node, 'Coroutine');
            if (coroutineType && isClass(coroutineType)) {
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
        const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;

        // This shouldn't be called if there is a declared return type, but it
        // can happen if there are unexpected cycles between decorators and
        // classes that they decorate. We'll just return an undefined type
        // in this case.
        if (returnAnnotation) {
            return undefined;
        }

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

                const functionNeverReturns = !isAfterNodeReachable(node);
                const implicitlyReturnsNone = isAfterNodeReachable(node.suite);

                // Infer the return type based on all of the return statements in the function's body.
                if (getFileInfo(node).isStubFile) {
                    // If a return type annotation is missing in a stub file, assume
                    // it's an "unknown" type. In normal source files, we can infer the
                    // type from the implementation.
                    inferredReturnType = UnknownType.create();
                } else {
                    if (functionNeverReturns) {
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

                        // Remove any unbound values since those would generate an exception
                        // before being returned.
                        inferredReturnType = removeUnbound(inferredReturnType);

                        // Remove NoReturn types if they appear within a union.
                        inferredReturnType = removeNoReturnFromUnion(inferredReturnType);
                    }

                    // Is it a generator?
                    if (functionDecl?.isGenerator) {
                        const inferredYieldTypes: Type[] = [];
                        if (functionDecl.yieldStatements) {
                            functionDecl.yieldStatements.forEach((yieldNode) => {
                                if (isNodeReachable(yieldNode)) {
                                    if (yieldNode.nodeType === ParseNodeType.YieldFrom) {
                                        const iteratorType = getTypeOfExpression(yieldNode.expression).type;
                                        const yieldType = getTypeFromIterator(
                                            iteratorType,
                                            /* isAsync */ false,
                                            yieldNode
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
                        }

                        if (inferredYieldTypes.length === 0) {
                            inferredYieldTypes.push(NoneType.createInstance());
                        }
                        const inferredYieldType = combineTypes(inferredYieldTypes);

                        // Inferred yield types need to be wrapped in a Generator to
                        // produce the final result.
                        const generatorType = getTypingType(node, 'Generator');
                        if (generatorType && isClass(generatorType)) {
                            inferredReturnType = ObjectType.create(
                                ClassType.cloneForSpecialization(
                                    generatorType,
                                    [
                                        inferredYieldType,
                                        NoneType.createInstance(),
                                        isNoReturnType(inferredReturnType)
                                            ? NoneType.createInstance()
                                            : inferredReturnType,
                                    ],
                                    /* isTypeArgumentExplicit */ true
                                )
                            );
                        } else {
                            inferredReturnType = UnknownType.create();
                        }
                    }
                }

                writeTypeCache(node.suite, inferredReturnType, /* isIncomplete */ false);
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

        const iteratorTypeResult = getTypeOfExpression(node.iterableExpression);
        const iteratedType =
            getTypeFromIterator(iteratorTypeResult.type, !!node.isAsync, node.iterableExpression) ||
            UnknownType.create();

        assignTypeToExpression(
            node.targetExpression,
            iteratedType,
            !!iteratorTypeResult.isIncomplete,
            node.targetExpression
        );

        writeTypeCache(node, iteratedType, !!iteratorTypeResult.isIncomplete);
    }

    function evaluateTypesForExceptStatement(node: ExceptNode): void {
        // This should be called only if the except node has a target exception.
        assert(node.typeExpression !== undefined);

        if (readTypeCache(node)) {
            return;
        }

        const exceptionTypes = getTypeOfExpression(node.typeExpression!).type;

        function getExceptionType(exceptionType: Type, errorNode: ParseNode) {
            exceptionType = makeTopLevelTypeVarsConcrete(exceptionType);

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
                const iterableType =
                    getTypeFromIterator(exceptionType, /* isAsync */ false, errorNode) || UnknownType.create();

                return mapSubtypes(iterableType, (subtype) => {
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

        const targetType = mapSubtypes(exceptionTypes, (subType) => {
            // If more than one type was specified for the exception, we'll receive
            // a specialized tuple object here.
            const tupleType = getSpecializedTupleType(subType);
            if (tupleType && tupleType.tupleTypeArguments) {
                const entryTypes = tupleType.tupleTypeArguments.map((t) => {
                    return getExceptionType(t, node.typeExpression!);
                });
                return combineTypes(entryTypes);
            }

            return getExceptionType(subType, node.typeExpression!);
        });

        if (node.name) {
            assignTypeToExpression(node.name, targetType, /* isIncomplete */ false, node.name);
        }

        writeTypeCache(node, targetType, /* isIncomplete */ false);
    }

    function evaluateTypesForWithStatement(node: WithItemNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const exprTypeResult = getTypeOfExpression(node.expression);
        let exprType = exprTypeResult.type;
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
        const scopedType = mapSubtypes(exprType, (subtype) => {
            subtype = makeTopLevelTypeVarsConcrete(subtype);

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
                    diag
                )?.type;

                if (enterType) {
                    let memberReturnType: Type;
                    if (isFunction(enterType)) {
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
                        diag
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
        doForEachSubtype(exprType, (subtype) => {
            subtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return;
            }

            const diag = new DiagnosticAddendum();

            if (isObject(subtype)) {
                const exitType = getTypeFromObjectMember(
                    node.expression,
                    subtype,
                    exitMethodName,
                    { method: 'get' },
                    diag
                );

                if (exitType) {
                    return;
                }
            }

            const fileInfo = getFileInfo(node);
            addDiagnostic(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.typeNotUsableWith().format({ type: printType(subtype), method: exitMethodName }),
                node.expression
            );
        });

        if (node.target) {
            assignTypeToExpression(node.target, scopedType, !!exprTypeResult.isIncomplete, node.target);
        }

        writeTypeCache(node, scopedType, !!exprTypeResult.isIncomplete);
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

        assignTypeToNameNode(symbolNameNode, symbolType, /* isIncomplete */ false);

        writeTypeCache(node, symbolType, /* isIncomplete */ false);
    }

    function evaluateTypesForImportFromAs(node: ImportFromAsNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const aliasNode = node.alias || node.name;
        const fileInfo = getFileInfo(node);

        // If this is a redundant form of an import, assume it is an intentional
        // export and mark the symbol as accessed.
        if (node.alias?.value === node.name.value) {
            const symbolInScope = lookUpSymbolRecursive(node, node.name.value, /* honorCodeFlow */ true);
            if (symbolInScope) {
                setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
            }
        }

        let symbolType = getAliasedSymbolTypeForName(node, aliasNode.value);
        if (!symbolType) {
            const parentNode = node.parent as ImportFromNode;
            assert(parentNode && parentNode.nodeType === ParseNodeType.ImportFrom);
            assert(!parentNode.isWildcardImport);

            const importInfo = AnalyzerNodeInfo.getImportInfo(parentNode.module);
            if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
                const resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];

                const importLookupInfo = importLookup(resolvedPath);
                let reportError = false;

                // If we were able to resolve the import, report the error as
                // an unresolved symbol.
                if (importLookupInfo) {
                    reportError = true;

                    // Handle PEP 562 support for module-level __getattr__ function,
                    // introduced in Python 3.7.
                    if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_7 || fileInfo.isStubFile) {
                        const getAttrSymbol = importLookupInfo.symbolTable.get('__getattr__');
                        if (getAttrSymbol) {
                            const getAttrType = getEffectiveTypeOfSymbol(getAttrSymbol);
                            if (isFunction(getAttrType)) {
                                symbolType = getFunctionEffectiveReturnType(getAttrType);
                                reportError = false;
                            }
                        }
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

            if (!symbolType) {
                symbolType = UnknownType.create();
            }
        }

        assignTypeToNameNode(aliasNode, symbolType, /* isIncomplete */ false);
        writeTypeCache(node, symbolType, /* isIncomplete */ false);
    }

    function evaluateTypesForCaseNode(node: CaseNode) {
        if (readTypeCache(node)) {
            return;
        }

        if (!node.parent || node.parent.nodeType !== ParseNodeType.Match) {
            fail('Expected parent of case statement to be match statement');
            return;
        }

        const subjectTypeResult = getTypeOfExpression(node.parent.subjectExpression);
        assignTypeToPatternTargets(subjectTypeResult.type, !!subjectTypeResult.isIncomplete, node.pattern);

        writeTypeCache(node, subjectTypeResult.type, !!subjectTypeResult.isIncomplete);
    }

    function narrowTypeBasedOnPattern(type: Type, pattern: PatternAtomNode, isPositiveTest: boolean): Type {
        switch (pattern.nodeType) {
            case ParseNodeType.PatternSequence: {
                return narrowTypeBasedOnSequencePattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternLiteral: {
                return narrowTypeBasedOnLiteralPattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternClass: {
                return narrowTypeBasedOnClassPattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternAs: {
                return narrowTypeBasedOnAsPattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternMapping: {
                return narrowTypeBasedOnMappingPattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternValue: {
                return narrowTypeBasedOnValuePattern(type, pattern, isPositiveTest);
            }

            case ParseNodeType.PatternCapture: {
                // A capture captures everything, so nothing remains in the negative case.
                return isPositiveTest ? type : NeverType.create();
            }

            case ParseNodeType.Error: {
                return type;
            }
        }
    }

    function narrowTypeBasedOnSequencePattern(type: Type, pattern: PatternSequenceNode, isPositiveTest: boolean): Type {
        if (!isPositiveTest) {
            // Never narrow in negative case.
            return type;
        }

        let sequenceInfo = getSequencePatternInfo(type, pattern.entries.length, pattern.starEntryIndex);
        // Further narrow based on pattern entry types.
        sequenceInfo = sequenceInfo.filter((entry) => {
            let isPlausibleMatch = true;
            const narrowedEntryTypes: Type[] = [];
            let canNarrowTuple = entry.isTuple;

            pattern.entries.forEach((sequenceEntry, index) => {
                const entryType = getTypeForPatternSequenceEntry(
                    entry,
                    index,
                    pattern.entries.length,
                    pattern.starEntryIndex
                );

                const narrowedEntryType = narrowTypeBasedOnPattern(entryType, sequenceEntry, /* isPositiveTest */ true);
                if (index === pattern.starEntryIndex) {
                    if (
                        isObject(narrowedEntryType) &&
                        narrowedEntryType.classType.tupleTypeArguments &&
                        !isOpenEndedTupleClass(narrowedEntryType.classType) &&
                        narrowedEntryType.classType.tupleTypeArguments
                    ) {
                        narrowedEntryTypes.push(...narrowedEntryType.classType.tupleTypeArguments);
                    } else {
                        canNarrowTuple = false;
                    }
                } else {
                    narrowedEntryTypes.push(narrowedEntryType);
                }

                if (isNever(narrowedEntryType)) {
                    isPlausibleMatch = false;
                }
            });

            // If this is a tuple, we can narrow it to a specific tuple type.
            // Other sequences cannot be narrowed because we don't know if they
            // are immutable (covariant).
            if (isPlausibleMatch && canNarrowTuple && tupleClassType && isClass(tupleClassType)) {
                entry.subtype = ObjectType.create(specializeTupleClass(tupleClassType, narrowedEntryTypes));
            }

            return isPlausibleMatch;
        });

        return combineTypes(sequenceInfo.map((entry) => entry.subtype));
    }

    function narrowTypeBasedOnAsPattern(type: Type, pattern: PatternAsNode, isPositiveTest: boolean): Type {
        let remainingType = type;

        if (!isPositiveTest) {
            pattern.orPatterns.forEach((subpattern) => {
                remainingType = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ false);
            });
            return remainingType;
        }

        const narrowedTypes = pattern.orPatterns.map((subpattern) => {
            const narrowedSubtype = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ true);
            remainingType = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ false);
            return narrowedSubtype;
        });
        return combineTypes(narrowedTypes);
    }

    function narrowTypeBasedOnMappingPattern(type: Type, pattern: PatternMappingNode, isPositiveTest: boolean): Type {
        if (!isPositiveTest) {
            // Never narrow in negative case.
            return type;
        }

        let mappingInfo = getMappingPatternInfo(type);

        // Further narrow based on pattern entry types.
        mappingInfo = mappingInfo.filter((mappingSubtypeInfo) => {
            let isPlausibleMatch = true;
            pattern.entries.forEach((mappingEntry) => {
                if (mappingSubtypeInfo.typedDict) {
                    if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                        const narrowedKeyType = narrowTypeBasedOnPattern(
                            getBuiltInObject(pattern, 'str'),
                            mappingEntry.keyPattern,
                            isPositiveTest
                        );

                        if (isNever(narrowedKeyType)) {
                            isPlausibleMatch = false;
                        }

                        const valueType = mapSubtypes(narrowedKeyType, (keySubtype) => {
                            if (isAnyOrUnknown(keySubtype)) {
                                return keySubtype;
                            }

                            if (isObject(keySubtype) && ClassType.isBuiltIn(keySubtype.classType, 'str')) {
                                if (!isLiteralType(keySubtype)) {
                                    return UnknownType.create();
                                }

                                const tdEntries = getTypedDictMembersForClass(mappingSubtypeInfo.typedDict!);
                                const valueEntry = tdEntries.get(keySubtype.classType.literalValue as string);
                                if (valueEntry) {
                                    const narrowedValueType = narrowTypeBasedOnPattern(
                                        valueEntry.valueType,
                                        mappingEntry.valuePattern,
                                        /* isPositiveTest */ true
                                    );
                                    if (!isNever(narrowedValueType)) {
                                        return narrowedValueType;
                                    }
                                }
                            }

                            return undefined;
                        });

                        if (isNever(valueType)) {
                            isPlausibleMatch = false;
                        }
                    }
                } else if (mappingSubtypeInfo.dictTypeArgs) {
                    if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                        const narrowedKeyType = narrowTypeBasedOnPattern(
                            mappingSubtypeInfo.dictTypeArgs.key,
                            mappingEntry.keyPattern,
                            isPositiveTest
                        );
                        const narrowedValueType = narrowTypeBasedOnPattern(
                            mappingSubtypeInfo.dictTypeArgs.value,
                            mappingEntry.valuePattern,
                            isPositiveTest
                        );
                        if (isNever(narrowedKeyType) || isNever(narrowedValueType)) {
                            isPlausibleMatch = false;
                        }
                    }
                }
            });

            return isPlausibleMatch;
        });

        return combineTypes(mappingInfo.map((entry) => entry.subtype));
    }

    // Looks up the "__match_args__" class member to determine the names of
    // the attributes used for class pattern matching.
    function getPositionalMatchArgNames(type: ClassType): string[] {
        const matchArgsMemberInfo = lookUpClassMember(type, '__match_args__');
        if (matchArgsMemberInfo) {
            const matchArgsType = getTypeOfMember(matchArgsMemberInfo);
            if (
                isObject(matchArgsType) &&
                isTupleClass(matchArgsType.classType) &&
                !isOpenEndedTupleClass(matchArgsType.classType) &&
                matchArgsType.classType.tupleTypeArguments
            ) {
                const tupleArgs = matchArgsType.classType.tupleTypeArguments;

                // Are all the args string literals?
                if (
                    !tupleArgs.some(
                        (argType) =>
                            !isObject(argType) ||
                            !ClassType.isBuiltIn(argType.classType, 'str') ||
                            !isLiteralType(argType)
                    )
                ) {
                    return tupleArgs.map((argType) => (argType as ObjectType).classType.literalValue as string);
                }
            }
        }

        return [];
    }

    function narrowTypeBasedOnLiteralPattern(type: Type, pattern: PatternLiteralNode, isPositiveTest: boolean): Type {
        const literalType = getTypeOfExpression(pattern.expression).type;

        if (!isPositiveTest) {
            return mapSubtypes(type, (subtype) => {
                if (canAssignType(literalType, subtype, new DiagnosticAddendum())) {
                    return undefined;
                }

                // Narrow a non-literal bool based on a literal bool pattern.
                if (
                    isObject(subtype) &&
                    ClassType.isBuiltIn(subtype.classType, 'bool') &&
                    subtype.classType.literalValue === undefined &&
                    isObject(literalType) &&
                    ClassType.isBuiltIn(literalType.classType, 'bool') &&
                    literalType.classType.literalValue !== undefined
                ) {
                    return ObjectType.create(
                        ClassType.cloneWithLiteral(
                            literalType.classType,
                            !(literalType.classType.literalValue as boolean)
                        )
                    );
                }

                return subtype;
            });
        }

        return mapSubtypes(type, (subtype) => {
            if (canAssignType(subtype, literalType, new DiagnosticAddendum())) {
                return literalType;
            }
            return undefined;
        });
    }

    function narrowTypeBasedOnClassPattern(type: Type, pattern: PatternClassNode, isPositiveTest: boolean): Type {
        const classType = getTypeOfExpression(pattern.className).type;

        if (!isPositiveTest) {
            // Don't attempt to narrow if there are arguments.
            if (pattern.arguments.length > 0) {
                return type;
            }

            // Don't attempt to narrow if the class type is a more complex type (e.g. a TypeVar or union).
            if (!isClass(classType)) {
                return type;
            }

            // Don't attempt to narrow if the class type is generic.
            if (classType.details.typeParameters.length > 0) {
                return type;
            }

            const diag = new DiagnosticAddendum();
            const classInstance = convertToInstance(classType);
            return mapSubtypes(type, (subtype) => {
                if (canAssignType(classInstance, subtype, diag)) {
                    return undefined;
                }

                return subtype;
            });
        }

        if (!TypeBase.isInstantiable(classType)) {
            addDiagnostic(
                getFileInfo(pattern).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.DiagnosticAddendum.typeNotClass().format({ type: printType(classType) }),
                pattern.className
            );
            return NeverType.create();
        }

        return mapSubtypesExpandTypeVars(
            classType,
            /* constraintFilter */ undefined,
            (expandedSubtype, unexpandedSubtype) => {
                if (isAnyOrUnknown(expandedSubtype)) {
                    return unexpandedSubtype;
                }

                if (isClass(expandedSubtype)) {
                    return mapSubtypes(type, (matchSubtype) => {
                        const concreteSubtype = makeTopLevelTypeVarsConcrete(matchSubtype);

                        if (isAnyOrUnknown(concreteSubtype)) {
                            return matchSubtype;
                        }

                        if (isObject(concreteSubtype)) {
                            let resultType: Type;

                            if (canAssignType(expandedSubtype, concreteSubtype.classType, new DiagnosticAddendum())) {
                                resultType = matchSubtype;
                            } else if (
                                canAssignType(concreteSubtype.classType, expandedSubtype, new DiagnosticAddendum())
                            ) {
                                resultType = convertToInstance(unexpandedSubtype);
                            } else {
                                return undefined;
                            }

                            // Are there any positional arguments? If so, try to get the mappings for
                            // these arguments by fetching the __match_args__ symbol from the class.
                            let positionalArgNames: string[] = [];
                            if (pattern.arguments.some((arg) => !arg.name)) {
                                positionalArgNames = getPositionalMatchArgNames(expandedSubtype);
                            }

                            let isMatchValid = true;
                            pattern.arguments.forEach((arg, index) => {
                                const narrowedArgType = narrowTypeOfClassPatternArgument(
                                    arg,
                                    index,
                                    positionalArgNames,
                                    expandedSubtype
                                );

                                if (isNever(narrowedArgType)) {
                                    isMatchValid = false;
                                }
                            });

                            if (isMatchValid) {
                                return resultType;
                            }
                        }

                        return undefined;
                    });
                }

                return undefined;
            }
        );
    }

    function narrowTypeOfClassPatternArgument(
        arg: PatternClassArgumentNode,
        argIndex: number,
        positionalArgNames: string[],
        classType: ClassType
    ) {
        let argName: string | undefined;
        if (arg.name) {
            argName = arg.name.value;
        } else if (argIndex < positionalArgNames.length) {
            argName = positionalArgNames[argIndex];
        }

        let argType: Type | undefined;
        if (argName) {
            const argMemberInfo = lookUpClassMember(classType, argName);
            if (argMemberInfo) {
                argType = getTypeOfMember(argMemberInfo);
            }
        }

        if (!argType) {
            argType = UnknownType.create();
        }

        return narrowTypeBasedOnPattern(argType, arg.pattern, /* isPositiveTest */ true);
    }

    function narrowTypeBasedOnValuePattern(type: Type, pattern: PatternValueNode, isPositiveTest: boolean): Type {
        if (!isPositiveTest) {
            // Never narrow in negative case.
            return type;
        }

        const valueType = getTypeOfExpression(pattern.expression).type;
        const narrowedSubtypes: Type[] = [];

        mapSubtypesExpandTypeVars(
            valueType,
            /* constraintFilter */ undefined,
            (leftSubtypeExpanded, leftSubtypeUnexpanded, leftSubtypeConstraints) => {
                narrowedSubtypes.push(
                    mapSubtypesExpandTypeVars(
                        type,
                        leftSubtypeConstraints,
                        (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                            if (isNever(leftSubtypeExpanded) || isNever(rightSubtypeUnexpanded)) {
                                return NeverType.create();
                            }

                            if (isAnyOrUnknown(leftSubtypeExpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                                // If either type is "Unknown" (versus Any), propagate the Unknown.
                                return isUnknown(leftSubtypeExpanded) || isUnknown(rightSubtypeUnexpanded)
                                    ? UnknownType.create()
                                    : AnyType.create();
                            }

                            // Determine if we assignment is supported for this combination of
                            // value subtype and matching subtype.
                            const magicMethodName = binaryOperatorMap[OperatorType.Equals][0];
                            const returnType = useSpeculativeMode(pattern.expression, () =>
                                getTypeFromMagicMethodReturn(
                                    leftSubtypeExpanded,
                                    [rightSubtypeUnexpanded],
                                    magicMethodName,
                                    pattern.expression,
                                    /* expectedType */ undefined
                                )
                            );

                            return returnType ? leftSubtypeUnexpanded : undefined;
                        }
                    )
                );

                return undefined;
            }
        );

        return combineTypes(narrowedSubtypes);
    }

    // Returns information about all subtypes that match the definition of a "mapping" as
    // specified in PEP 634.
    function getMappingPatternInfo(type: Type): MappingPatternInfo[] {
        const mappingInfo: MappingPatternInfo[] = [];

        doForEachSubtype(type, (subtype) => {
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(concreteSubtype)) {
                mappingInfo.push({
                    subtype,
                    dictTypeArgs: {
                        key: concreteSubtype,
                        value: concreteSubtype,
                    },
                });
            } else if (isObject(concreteSubtype)) {
                if (ClassType.isTypedDictClass(concreteSubtype.classType)) {
                    mappingInfo.push({
                        subtype,
                        typedDict: concreteSubtype.classType,
                    });
                } else {
                    let mroClassToSpecialize: ClassType | undefined;
                    for (const mroClass of concreteSubtype.classType.details.mro) {
                        if (isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'Mapping')) {
                            mroClassToSpecialize = mroClass;
                            break;
                        }
                    }

                    if (mroClassToSpecialize) {
                        const specializedMapping = partiallySpecializeType(
                            mroClassToSpecialize,
                            concreteSubtype.classType
                        ) as ClassType;
                        if (specializedMapping.typeArguments && specializedMapping.typeArguments.length >= 2) {
                            mappingInfo.push({
                                subtype,
                                dictTypeArgs: {
                                    key: specializedMapping.typeArguments[0],
                                    value: specializedMapping.typeArguments[1],
                                },
                            });
                        }
                    }
                }
            }
        });

        return mappingInfo;
    }

    // Returns information about all subtypes that match the definition of a "sequence" as
    // specified in PEP 634. Eliminates sequences that are not of sufficient length.
    function getSequencePatternInfo(
        type: Type,
        entryCount: number,
        starEntryIndex: number | undefined
    ): SequencePatternInfo[] {
        const sequenceInfo: SequencePatternInfo[] = [];
        const minEntryCount = starEntryIndex === undefined ? entryCount : entryCount - 1;

        doForEachSubtype(type, (subtype) => {
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);
            let mroClassToSpecialize: ClassType | undefined;

            if (isAnyOrUnknown(concreteSubtype)) {
                sequenceInfo.push({
                    subtype,
                    entryTypes: [concreteSubtype],
                    isIndeterminateLength: true,
                    isTuple: false,
                });
            } else if (isObject(concreteSubtype)) {
                for (const mroClass of concreteSubtype.classType.details.mro) {
                    if (!isClass(mroClass)) {
                        break;
                    }

                    // Strings and bytes are explicitly excluded.
                    if (ClassType.isBuiltIn(mroClass, 'str')) {
                        break;
                    }

                    if (ClassType.isBuiltIn(mroClass, 'bytes')) {
                        break;
                    }

                    if (ClassType.isBuiltIn(mroClass, 'Sequence')) {
                        mroClassToSpecialize = mroClass;
                        break;
                    }

                    if (isTupleClass(mroClass)) {
                        mroClassToSpecialize = mroClass;
                        break;
                    }
                }

                if (mroClassToSpecialize) {
                    const specializedSequence = partiallySpecializeType(
                        mroClassToSpecialize,
                        concreteSubtype.classType
                    ) as ClassType;
                    if (isTupleClass(specializedSequence)) {
                        if (specializedSequence.tupleTypeArguments) {
                            if (isOpenEndedTupleClass(specializedSequence)) {
                                sequenceInfo.push({
                                    subtype,
                                    entryTypes: [specializedSequence.tupleTypeArguments[0]],
                                    isIndeterminateLength: true,
                                    isTuple: true,
                                });
                            } else {
                                if (
                                    specializedSequence.tupleTypeArguments.length >= minEntryCount &&
                                    (starEntryIndex !== undefined ||
                                        specializedSequence.tupleTypeArguments.length === minEntryCount)
                                ) {
                                    sequenceInfo.push({
                                        subtype,
                                        entryTypes: specializedSequence.tupleTypeArguments,
                                        isIndeterminateLength: false,
                                        isTuple: true,
                                    });
                                }
                            }
                        }
                    } else {
                        sequenceInfo.push({
                            subtype,
                            entryTypes: [
                                specializedSequence.typeArguments && specializedSequence.typeArguments.length > 0
                                    ? specializedSequence.typeArguments[0]
                                    : UnknownType.create(),
                            ],
                            isIndeterminateLength: true,
                            isTuple: false,
                        });
                    }
                }
            }
        });

        return sequenceInfo;
    }

    function getTypeForPatternSequenceEntry(
        sequenceInfo: SequencePatternInfo,
        entryIndex: number,
        entryCount: number,
        starEntryIndex: number | undefined
    ): Type {
        if (sequenceInfo.isIndeterminateLength) {
            if (starEntryIndex === entryIndex) {
                if (tupleClassType && isClass(tupleClassType)) {
                    return ObjectType.create(
                        specializeTupleClass(tupleClassType, [
                            sequenceInfo.entryTypes[0],
                            AnyType.create(/* isEllipsis */ true),
                        ])
                    );
                } else {
                    return UnknownType.create();
                }
            } else {
                return sequenceInfo.entryTypes[0];
            }
        } else if (starEntryIndex === undefined || entryIndex < starEntryIndex) {
            return sequenceInfo.entryTypes[entryIndex];
        } else if (entryIndex === starEntryIndex) {
            // Create a tuple out of the entries that map to the star entry.
            const starEntryTypes = sequenceInfo.entryTypes.slice(
                starEntryIndex,
                starEntryIndex + sequenceInfo.entryTypes.length - entryCount + 1
            );
            if (tupleClassType && isClass(tupleClassType)) {
                return ObjectType.create(specializeTupleClass(tupleClassType, starEntryTypes));
            } else {
                return UnknownType.create();
            }
        } else {
            // The entry index is past the index of the star entry, so we need
            // to index from the end of the sequence rather than the start.
            const itemIndex = sequenceInfo.entryTypes.length - (entryCount - entryIndex);
            assert(itemIndex >= 0 && itemIndex < sequenceInfo.entryTypes.length);
            return sequenceInfo.entryTypes[itemIndex];
        }
    }

    // Recursively assigns the specified type to the pattern and any capture
    // nodes within it
    function assignTypeToPatternTargets(type: Type, isTypeIncomplete: boolean, pattern: PatternAtomNode) {
        // Further narrow the type based on this pattern.
        type = narrowTypeBasedOnPattern(type, pattern, /* positiveTest */ true);

        switch (pattern.nodeType) {
            case ParseNodeType.PatternSequence: {
                const sequenceInfo = getSequencePatternInfo(type, pattern.entries.length, pattern.starEntryIndex);

                pattern.entries.forEach((entry, index) => {
                    const entryType = combineTypes(
                        sequenceInfo.map((info) =>
                            getTypeForPatternSequenceEntry(info, index, pattern.entries.length, pattern.starEntryIndex)
                        )
                    );

                    assignTypeToPatternTargets(entryType, isTypeIncomplete, entry);
                });
                break;
            }

            case ParseNodeType.PatternAs: {
                if (pattern.target) {
                    assignTypeToExpression(pattern.target, type, isTypeIncomplete, pattern.target);
                }

                pattern.orPatterns.forEach((orPattern) => {
                    assignTypeToPatternTargets(type, isTypeIncomplete, orPattern);

                    // OR patterns are evaluated left to right, so we can narrow
                    // the type as we go.
                    type = narrowTypeBasedOnPattern(type, orPattern, /* positiveTest */ false);
                });
                break;
            }

            case ParseNodeType.PatternCapture: {
                assignTypeToExpression(
                    pattern.target,
                    pattern.isWildcard ? AnyType.create() : type,
                    isTypeIncomplete,
                    pattern.target
                );
                break;
            }

            case ParseNodeType.PatternMapping: {
                const mappingInfo = getMappingPatternInfo(type);

                pattern.entries.forEach((mappingEntry) => {
                    const keyTypes: Type[] = [];
                    const valueTypes: Type[] = [];

                    mappingInfo.forEach((mappingSubtypeInfo) => {
                        if (mappingSubtypeInfo.typedDict) {
                            if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                                const keyType = narrowTypeBasedOnPattern(
                                    getBuiltInObject(pattern, 'str'),
                                    mappingEntry.keyPattern,
                                    /* isPositiveTest */ true
                                );
                                keyTypes.push(keyType);

                                doForEachSubtype(keyType, (keySubtype) => {
                                    if (
                                        isObject(keySubtype) &&
                                        ClassType.isBuiltIn(keySubtype.classType, 'str') &&
                                        isLiteralType(keySubtype)
                                    ) {
                                        const tdEntries = getTypedDictMembersForClass(mappingSubtypeInfo.typedDict!);
                                        const valueInfo = tdEntries.get(keySubtype.classType.literalValue as string);
                                        valueTypes.push(valueInfo ? valueInfo.valueType : UnknownType.create());
                                    } else {
                                        valueTypes.push(UnknownType.create());
                                    }
                                });
                            } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                                keyTypes.push(getBuiltInObject(pattern, 'str'));
                                valueTypes.push(UnknownType.create());
                            }
                        } else if (mappingSubtypeInfo.dictTypeArgs) {
                            if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                                const keyType = narrowTypeBasedOnPattern(
                                    mappingSubtypeInfo.dictTypeArgs.key,
                                    mappingEntry.keyPattern,
                                    /* isPositiveTest */ true
                                );
                                keyTypes.push(keyType);
                                valueTypes.push(
                                    narrowTypeBasedOnPattern(
                                        mappingSubtypeInfo.dictTypeArgs.value,
                                        mappingEntry.valuePattern,
                                        /* isPositiveTest */ true
                                    )
                                );
                            } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                                keyTypes.push(mappingSubtypeInfo.dictTypeArgs.key);
                                valueTypes.push(mappingSubtypeInfo.dictTypeArgs.value);
                            }
                        }
                    });

                    const keyType = combineTypes(keyTypes);
                    const valueType = combineTypes(valueTypes);

                    if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                        assignTypeToPatternTargets(keyType, isTypeIncomplete, mappingEntry.keyPattern);
                        assignTypeToPatternTargets(valueType, isTypeIncomplete, mappingEntry.valuePattern);
                    } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                        const dictClass = getBuiltInType(pattern, 'dict');
                        const strType = getBuiltInObject(pattern, 'str');
                        const dictType =
                            dictClass && isClass(dictClass) && isObject(strType)
                                ? ObjectType.create(
                                      ClassType.cloneForSpecialization(
                                          dictClass,
                                          [keyType, valueType],
                                          /* isTypeArgumentExplicit */ true
                                      )
                                  )
                                : UnknownType.create();
                        assignTypeToExpression(mappingEntry.target, dictType, isTypeIncomplete, mappingEntry.target);
                    }
                });
                break;
            }

            case ParseNodeType.PatternClass: {
                const argTypes: Type[][] = pattern.arguments.map((arg) => []);

                mapSubtypesExpandTypeVars(type, /* constraintFilter */ undefined, (expandedSubtype) => {
                    if (isObject(expandedSubtype)) {
                        doForEachSubtype(type, (matchSubtype) => {
                            const concreteSubtype = makeTopLevelTypeVarsConcrete(matchSubtype);

                            if (isAnyOrUnknown(concreteSubtype)) {
                                pattern.arguments.forEach((arg, index) => {
                                    argTypes[index].push(concreteSubtype);
                                });
                            } else if (isObject(concreteSubtype)) {
                                // Are there any positional arguments? If so, try to get the mappings for
                                // these arguments by fetching the __match_args__ symbol from the class.
                                let positionalArgNames: string[] = [];
                                if (pattern.arguments.some((arg) => !arg.name)) {
                                    positionalArgNames = getPositionalMatchArgNames(expandedSubtype.classType);
                                }

                                pattern.arguments.forEach((arg, index) => {
                                    const narrowedArgType = narrowTypeOfClassPatternArgument(
                                        arg,
                                        index,
                                        positionalArgNames,
                                        expandedSubtype.classType
                                    );
                                    argTypes[index].push(narrowedArgType);
                                });
                            }
                        });
                    } else {
                        pattern.arguments.forEach((arg, index) => {
                            argTypes[index].push(UnknownType.create());
                        });
                    }

                    return undefined;
                });

                pattern.arguments.forEach((arg, index) => {
                    assignTypeToPatternTargets(combineTypes(argTypes[index]), isTypeIncomplete, arg.pattern);
                });
                break;
            }

            case ParseNodeType.PatternLiteral:
            case ParseNodeType.PatternValue:
            case ParseNodeType.Error: {
                // Nothing to do here.
                break;
            }
        }
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

        assignTypeToNameNode(symbolNameNode, symbolType, /* isIncomplete */ false);

        writeTypeCache(node, symbolType, /* isIncomplete */ false);
    }

    function getAliasedSymbolTypeForName(
        node: ImportAsNode | ImportFromAsNode | ImportFromNode,
        name: string
    ): Type | undefined {
        const symbolWithScope = lookUpSymbolRecursive(node, name, /* honorCodeFlow */ true);
        if (!symbolWithScope) {
            return undefined;
        }

        // Normally there will be at most one decl associated with the import node, but
        // there can be multiple in the case of the "from .X import X" statement. In such
        // case, we want to choose the last declaration.
        const filteredDecls = symbolWithScope.symbol
            .getDeclarations()
            .filter(
                (decl) => ParseTreeUtils.isNodeContainedWithin(node, decl.node) && decl.type === DeclarationType.Alias
            );
        let aliasDecl = filteredDecls.length > 0 ? filteredDecls[filteredDecls.length - 1] : undefined;

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
            if (node.nodeType === ParseNodeType.Parameter && node.parent?.nodeType === ParseNodeType.Lambda) {
                return true;
            }

            // Arguments are contextual only for call and index nodes.
            if (
                node.nodeType === ParseNodeType.Argument &&
                (node.parent?.nodeType === ParseNodeType.Call || node.parent?.nodeType === ParseNodeType.Index)
            ) {
                return true;
            }

            // All nodes within a type annotation need to be evaluated
            // contextually so we pass the "type expected" flag to
            // the evaluator.
            if (node.parent?.nodeType === ParseNodeType.TypeAnnotation) {
                return true;
            }

            return (
                node.nodeType === ParseNodeType.Call ||
                node.nodeType === ParseNodeType.Index ||
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
                node.nodeType === ParseNodeType.ListComprehension ||
                node.nodeType === ParseNodeType.ListComprehensionFor ||
                node.nodeType === ParseNodeType.ListComprehensionIf ||
                node.nodeType === ParseNodeType.PatternSequence ||
                node.nodeType === ParseNodeType.PatternLiteral ||
                node.nodeType === ParseNodeType.PatternClass ||
                node.nodeType === ParseNodeType.PatternClassArgument ||
                node.nodeType === ParseNodeType.PatternAs ||
                node.nodeType === ParseNodeType.PatternCapture ||
                node.nodeType === ParseNodeType.PatternMapping ||
                node.nodeType === ParseNodeType.PatternValue ||
                node.nodeType === ParseNodeType.PatternMappingKeyEntry ||
                node.nodeType === ParseNodeType.PatternMappingExpandEntry
            );
        }

        // Check for a couple of special cases where the node is a NameNode but
        // is technically not part of an expression. We'll handle these here so
        // callers don't need to include special-case logic.
        if (node.nodeType === ParseNodeType.Name && node.parent) {
            if (node.parent.nodeType === ParseNodeType.Function && node.parent.name === node) {
                getTypeOfFunction(node.parent);
                return;
            } else if (node.parent.nodeType === ParseNodeType.Class && node.parent.name === node) {
                getTypeOfClass(node.parent);
                return;
            } else if (
                node.parent.nodeType === ParseNodeType.Global ||
                node.parent.nodeType === ParseNodeType.Nonlocal
            ) {
                // For global and nonlocal statements, allow forward references so
                // we don't use code flow during symbol lookups.
                getTypeOfExpression(
                    node,
                    /* expectedType */ undefined,
                    EvaluatorFlags.AllowForwardReferences | EvaluatorFlags.SkipUnboundCheck
                );
                return;
            }
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
                    /* isVariableAnnotation */ true,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(parent.leftExpression)
                );
            } else {
                evaluateTypesForAssignmentStatement(parent);
            }
            return;
        } else if (parent.nodeType === ParseNodeType.Del) {
            verifyDeleteExpression(lastContextualExpression);
            return;
        }

        if (parent.nodeType === ParseNodeType.AugmentedAssignment) {
            evaluateTypesForAugmentedAssignment(parent);
            return;
        }

        if (parent.nodeType === ParseNodeType.Decorator) {
            if (parent.parent?.nodeType === ParseNodeType.Class) {
                getTypeOfClass(parent.parent);
            } else if (parent.parent?.nodeType === ParseNodeType.Function) {
                getTypeOfFunction(parent.parent);
            }
            return;
        }

        const evaluateTypeAnnotationExpression = (node: TypeAnnotationNode) => {
            const annotationParent = node.parent;
            if (annotationParent?.nodeType === ParseNodeType.Assignment && annotationParent.leftExpression === parent) {
                evaluateTypesForAssignmentStatement(annotationParent);
            } else {
                const annotationType = getTypeOfAnnotation(
                    node.typeAnnotation,
                    /* isVariableAnnotation */ true,
                    ParseTreeUtils.isFinalAllowedForAssignmentTarget(node.valueExpression)
                );
                if (annotationType) {
                    writeTypeCache(node.valueExpression, annotationType, /* isIncomplete */ false);
                }
            }
        };

        if (parent.nodeType === ParseNodeType.Case) {
            evaluateTypesForCaseNode(parent);
            return;
        }

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
            const fileInfo = getFileInfo(nodeToEvaluate);
            const flags = fileInfo.isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
            getTypeOfExpression(nodeToEvaluate, /* expectedType */ undefined, flags);
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
                    getTypeOfAnnotation(
                        typeAnnotation,
                        /* isVariableAnnotation */ false,
                        /* allowFinal */ false,
                        /* associateTypeVarsWithScope */ true,
                        /* allowTypeVarTuple */ functionNode.parameters[paramIndex].category ===
                            ParameterCategory.VarArgList
                    )
                ),
                /* isIncomplete */ false
            );
            return;
        }

        // We may be able to infer the type of the first parameter.
        if (paramIndex === 0) {
            const containingClassNode = ParseTreeUtils.getEnclosingClass(functionNode, /* stopAtFunction */ true);
            if (containingClassNode) {
                const classInfo = getTypeOfClass(containingClassNode);
                if (classInfo) {
                    const functionFlags = getFunctionFlagsFromDecorators(functionNode, /* isInClass */ true);
                    // If the first parameter doesn't have an explicit type annotation,
                    // provide a type if it's an instance, class or constructor method.
                    const inferredParamType = inferFirstParamType(functionFlags, classInfo.classType, functionNode);
                    writeTypeCache(node.name!, inferredParamType || UnknownType.create(), /* isIncomplete */ false);
                    return;
                }
            }
        }

        // We weren't able to infer the input parameter type. Set its
        // type to unknown.
        writeTypeCache(
            node.name!,
            transformVariadicParamType(node, node.category, UnknownType.create()),
            /* isIncomplete */ false
        );
    }

    // Evaluates the types that are assigned within the statement that contains
    // the specified parse node. In some cases, a broader statement may need to
    // be evaluated to provide sufficient context for the type. Evaluated types
    // are written back to the type cache for later retrieval.
    function evaluateTypesForStatement(node: ParseNode): void {
        initializedBasicTypes(node);

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

                case ParseNodeType.Case: {
                    evaluateTypesForCaseNode(curNode);
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
                return evaluateTypeForSubnode(decl.node.name!, () => {
                    evaluateTypeOfParameter(decl.node);
                })?.type;
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

            baseType = makeTopLevelTypeVarsConcrete(baseType);

            const declaredTypeOfSymbol = mapSubtypes(baseType, (subtype) => {
                let symbol: Symbol | undefined;
                if (isModule(subtype)) {
                    symbol = ModuleType.getField(subtype, memberName);
                } else if (isClass(subtype)) {
                    const classMemberInfo = lookUpClassMember(subtype, memberName);
                    symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
                } else if (isObject(subtype)) {
                    const classMemberInfo = lookUpClassMember(subtype.classType, memberName);
                    symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
                }

                return symbol ? getDeclaredTypeOfSymbol(symbol) : undefined;
            });

            if (!isNever(declaredTypeOfSymbol)) {
                return declaredTypeOfSymbol;
            }
        }

        return undefined;
    }

    // Helper function for cases where we need to evaluate the types
    // for a subtree so we can determine the type of one of the subnodes
    // within that tree. If the type cannot be determined (because it's part
    // of a cyclical dependency), the function returns undefined.
    function evaluateTypeForSubnode(subnode: ParseNode, callback: () => void): TypeResult | undefined {
        // If the type cache is already populated, don't bother
        // doing additional work.
        let subnodeType = readTypeCache(subnode);
        if (subnodeType) {
            return { node: subnode, type: subnodeType };
        }

        const oldIncompleteCache = incompleteTypeCache;
        try {
            incompleteTypeCache = new Map<number, CachedType>();
            callback();
            subnodeType = readTypeCache(subnode);
            if (subnodeType) {
                return { node: subnode, type: subnodeType };
            }

            subnodeType = incompleteTypeCache.get(subnode.id) as Type | undefined;
            if (subnodeType) {
                return { node: subnode, type: subnodeType, isIncomplete: true };
            }
        } finally {
            incompleteTypeCache = oldIncompleteCache;
        }

        return undefined;
    }

    // Performs a cursory analysis to determine whether the expression
    // corresponds to a context manager object that supports the swallowing
    // of exceptions. By convention, these objects have an "__exit__" method
    // that returns a bool response (as opposed to a None). This function is
    // called during code flow, so it can't rely on full type evaluation. It
    // makes some simplifying assumptions that work in most cases.
    function isExceptionContextManager(node: ExpressionNode, isAsync: boolean) {
        // See if this information is cached already.
        if (isExceptionContextManagerCache.has(node.id)) {
            return isExceptionContextManagerCache.get(node.id);
        }

        // Initially set to false to avoid infinite recursion.
        isExceptionContextManagerCache.set(node.id, false);

        let cmSwallowsExceptions = false;

        // We assume that the context manager is instantiated through a call.
        if (node.nodeType === ParseNodeType.Call) {
            const callType = getDeclaredCallBaseType(node.leftExpression);
            if (callType && isClass(callType)) {
                const exitMethodName = isAsync ? '__aexit__' : '__exit__';
                const exitType = getTypeFromObjectMember(
                    node.leftExpression,
                    ObjectType.create(callType),
                    exitMethodName
                )?.type;

                if (exitType && isFunction(exitType) && exitType.details.declaredReturnType) {
                    const returnType = exitType.details.declaredReturnType;
                    cmSwallowsExceptions = isObject(returnType) && ClassType.isBuiltIn(returnType.classType, 'bool');
                }
            }
        }

        // Cache the value for next time.
        isExceptionContextManagerCache.set(node.id, cmSwallowsExceptions);

        return cmSwallowsExceptions;
    }

    // Performs a cursory analysis to determine whether a call never returns
    // without fully evaluating its type. This is done during code flow,
    // so it can't rely on full type analysis. It makes some simplifying
    // assumptions that work fine in practice.
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
            doForEachSubtype(callType, (callSubtype) => {
                // We assume here that no constructors or __call__ methods
                // will be inferred "no return" types, so we can restrict
                // our check to functions.
                let functionType: FunctionType | undefined;
                if (isFunction(callSubtype)) {
                    functionType = callSubtype;
                } else if (isOverloadedFunction(callSubtype)) {
                    // Use the last overload, which should be the most general.
                    const overloadedFunction = callSubtype;
                    functionType = overloadedFunction.overloads[overloadedFunction.overloads.length - 1];
                }

                if (functionType && !FunctionType.isAsync(functionType)) {
                    if (functionType.details.declaredReturnType) {
                        if (isNoReturnType(functionType.details.declaredReturnType)) {
                            callIsNoReturn = true;
                        }
                    } else if (functionType.details.declaration) {
                        // If the function has yield expressions, it's a generator, and
                        // we'll assume the yield statements are reachable. Also, don't
                        // infer a "no return" type for abstract methods.
                        if (
                            !functionType.details.declaration.yieldStatements &&
                            !FunctionType.isAbstractMethod(functionType) &&
                            !FunctionType.isStubDefinition(functionType) &&
                            !FunctionType.isPyTypedDefinition(functionType)
                        ) {
                            // Check specifically for a common idiom where the only statement
                            // (other than a possible docstring) is a "raise NotImplementedError".
                            const functionStatements = functionType.details.declaration.node.suite.statements;

                            let foundRaiseNotImplemented = false;
                            for (const statement of functionStatements) {
                                if (
                                    statement.nodeType !== ParseNodeType.StatementList ||
                                    statement.statements.length !== 1
                                ) {
                                    break;
                                }

                                const simpleStatement = statement.statements[0];
                                if (simpleStatement.nodeType === ParseNodeType.StringList) {
                                    continue;
                                }

                                if (
                                    simpleStatement.nodeType === ParseNodeType.Raise &&
                                    simpleStatement.typeExpression
                                ) {
                                    // Check for "raise NotImplementedError" or "raise NotImplementedError()"
                                    const isNotImplementedName = (node: ParseNode) => {
                                        return (
                                            node?.nodeType === ParseNodeType.Name &&
                                            node.value === 'NotImplementedError'
                                        );
                                    };

                                    if (isNotImplementedName(simpleStatement.typeExpression)) {
                                        foundRaiseNotImplemented = true;
                                    } else if (
                                        simpleStatement.typeExpression.nodeType === ParseNodeType.Call &&
                                        isNotImplementedName(simpleStatement.typeExpression.leftExpression)
                                    ) {
                                        foundRaiseNotImplemented = true;
                                    }
                                }

                                break;
                            }

                            if (
                                !foundRaiseNotImplemented &&
                                !isAfterNodeReachable(functionType.details.declaration.node)
                            ) {
                                callIsNoReturn = true;
                            }
                        }
                    }
                }
            });
        }

        // Cache the value for next time.
        callIsNoReturnCache.set(node.id, callIsNoReturn);

        return callIsNoReturn;
    }

    function getCodeFlowAnalyzerForNode(nodeId: number) {
        let analyzer = codeFlowAnalyzerCache.get(nodeId);

        if (!analyzer) {
            // Allocate a new code flow analyzer.
            analyzer = createCodeFlowAnalyzer();
            codeFlowAnalyzerCache.set(nodeId, analyzer);
        }

        return analyzer;
    }

    // Attempts to determine the type of the reference expression at the
    // point in the code. If the code flow analysis has nothing to say
    // about that expression, it return undefined.
    function getFlowTypeOfReference(
        reference: CodeFlowReferenceExpressionNode,
        targetSymbolId: number,
        initialType: Type | undefined
    ): FlowNodeTypeResult {
        // See if this execution scope requires code flow for this reference expression.
        const referenceKey = createKeyForReference(reference);
        const executionScope = ParseTreeUtils.getExecutionScopeNode(reference);
        const codeFlowExpressions = AnalyzerNodeInfo.getCodeFlowExpressions(executionScope);

        assert(codeFlowExpressions !== undefined);
        if (!codeFlowExpressions!.has(referenceKey)) {
            return { type: undefined, isIncomplete: false };
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
            analyzer = getCodeFlowAnalyzerForNode(executionNode.id);
        }

        const flowNode = AnalyzerNodeInfo.getFlowNode(reference);
        if (flowNode === undefined) {
            return { type: undefined, isIncomplete: false };
        }

        return getTypeFromCodeFlow(analyzer, flowNode!, reference, targetSymbolId, initialType);
    }

    function getTypeFromCodeFlow(
        analyzer: CodeFlowAnalyzer,
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        targetSymbolId: number | undefined,
        initialType: Type | undefined
    ) {
        incompleteTypeTracker.enterTrackingScope();
        let codeFlowResult: FlowNodeTypeResult;

        try {
            codeFlowResult = analyzer.getTypeFromCodeFlow(flowNode!, reference, targetSymbolId, initialType);
        } finally {
            incompleteTypeTracker.exitTrackingScope();
        }

        if (codeFlowResult.isIncomplete) {
            incompleteTypeTracker.enableUndoTracking();
        }

        return { type: codeFlowResult.type, isIncomplete: codeFlowResult.isIncomplete };
    }

    // Creates a new code flow analyzer that can be used to narrow the types
    // of the expressions within an execution context. Each code flow analyzer
    // instance maintains a cache of types it has already determined.
    function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
        const flowNodeTypeCacheSet = new Map<string, TypeCache>();

        function getTypeFromCodeFlow(
            flowNode: FlowNode,
            reference: CodeFlowReferenceExpressionNode | undefined,
            targetSymbolId: number | undefined,
            initialType: Type | undefined
        ): FlowNodeTypeResult {
            const referenceKey =
                reference !== undefined && targetSymbolId !== undefined
                    ? createKeyForReference(reference) + `.${targetSymbolId.toString()}`
                    : '.';
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

            function evaluateAssignmentFlowNode(flowNode: FlowAssignment): TypeResult | undefined {
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

                return evaluateTypeForSubnode(nodeForCacheLookup, () => {
                    evaluateTypesForStatement(flowNode.node);
                });
            }

            // If this flow has no knowledge of the target expression, it returns undefined.
            // If the start flow node for this scope is reachable, the typeAtStart value is
            // returned.
            function getTypeFromFlowNode(
                flowNode: FlowNode,
                reference: CodeFlowReferenceExpressionNode | undefined,
                targetSymbolId: number | undefined,
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

                    if (curFlowNode.flags & FlowFlags.VariableAnnotation) {
                        const varAnnotationNode = curFlowNode as FlowVariableAnnotation;
                        curFlowNode = varAnnotationNode.antecedent;
                        continue;
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
                        if (reference) {
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
                                if (cachedEntry && cachedEntry.type === undefined) {
                                    return { type: undefined, isIncomplete: true };
                                }

                                // Set the cache entry to undefined before evaluating the
                                // expression in case it depends on itself.
                                setCacheEntry(curFlowNode, undefined, /* isIncomplete */ true);
                                let flowTypeResult = evaluateAssignmentFlowNode(assignmentFlowNode);
                                if (flowTypeResult && isTypeAliasPlaceholder(flowTypeResult.type)) {
                                    flowTypeResult = undefined;
                                }
                                return setCacheEntry(curFlowNode, flowTypeResult?.type, !!flowTypeResult?.isIncomplete);
                            } else if (ParseTreeUtils.isPartialMatchingExpression(reference, assignmentFlowNode.node)) {
                                // If the node partially matches the reference, we need to "kill" any narrowed
                                // types further above this point. For example, if we see the sequence
                                //    a.b = 3
                                //    a = Foo()
                                //    x = a.b
                                // The type of "a.b" can no longer be assumed to be Literal[3].
                                return setCacheEntry(curFlowNode, initialType, /* isIncomplete */ false);
                            }
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
                        if (curFlowNode.flags & FlowFlags.PostContextManager) {
                            // Determine whether any of the context managers support exception
                            // suppression. If not, none of its antecedents are reachable.
                            const contextMgrNode = curFlowNode as FlowPostContextManagerLabel;
                            if (
                                !contextMgrNode.expressions.some((expr) =>
                                    isExceptionContextManager(expr, contextMgrNode.isAsync)
                                )
                            ) {
                                return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                            }
                        }

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

                        if (reference) {
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
                        }

                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;
                        if (conditionalFlowNode.reference) {
                            // Make sure the reference type has a declared type. If not,
                            // don't bother trying to infer its type because that would be
                            // too expensive.
                            const symbolWithScope = lookUpSymbolRecursive(
                                conditionalFlowNode.reference,
                                conditionalFlowNode.reference.value,
                                /* honorCodeFlow */ false
                            );
                            if (symbolWithScope && symbolWithScope.symbol.getTypedDeclarations().length > 0) {
                                const typeNarrowingCallback = getTypeNarrowingCallback(
                                    conditionalFlowNode.reference,
                                    conditionalFlowNode
                                );
                                if (typeNarrowingCallback) {
                                    const refTypeInfo = getTypeOfExpression(conditionalFlowNode.reference!);
                                    const narrowedType = typeNarrowingCallback(refTypeInfo.type) || refTypeInfo.type;

                                    // If the narrowed type is "never", don't allow further exploration.
                                    if (isNever(narrowedType)) {
                                        return setCacheEntry(curFlowNode, undefined, !!refTypeInfo.isIncomplete);
                                    }
                                }
                            }
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
                            let flowTypeResult: FlowNodeTypeResult | undefined;

                            // Use speculative mode for the remainder of the finally suite
                            // because the final types within this parse node block should be
                            // evaluated when the gate is open.
                            useSpeculativeMode(postFinallyFlowNode.finallyNode, () => {
                                flowTypeResult = getTypeFromFlowNode(
                                    postFinallyFlowNode.antecedent,
                                    reference,
                                    targetSymbolId,
                                    initialType
                                );
                            });

                            // If the type is incomplete, don't write back to the cache.
                            return flowTypeResult!.isIncomplete
                                ? flowTypeResult!
                                : setCacheEntry(curFlowNode, flowTypeResult!.type, /* isIncomplete */ false);
                        } finally {
                            postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                        }
                    }

                    if (curFlowNode.flags & FlowFlags.Start) {
                        return setCacheEntry(curFlowNode, initialType, /* isIncomplete */ false);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference && reference.nodeType === ParseNodeType.Name) {
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

                if (
                    curFlowNode.flags &
                    (FlowFlags.VariableAnnotation |
                        FlowFlags.Assignment |
                        FlowFlags.AssignmentAlias |
                        FlowFlags.TrueCondition |
                        FlowFlags.FalseCondition |
                        FlowFlags.WildcardImport |
                        FlowFlags.TrueNeverCondition |
                        FlowFlags.FalseNeverCondition)
                ) {
                    const typedFlowNode = curFlowNode as
                        | FlowVariableAnnotation
                        | FlowAssignment
                        | FlowAssignmentAlias
                        | FlowCondition
                        | FlowWildcardImport
                        | FlowCondition;
                    curFlowNode = typedFlowNode.antecedent;
                    continue;
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

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    if (curFlowNode.flags & FlowFlags.PostContextManager) {
                        // Determine whether any of the context managers support exception
                        // suppression. If not, none of its antecedents are reachable.
                        const contextMgrNode = curFlowNode as FlowPostContextManagerLabel;
                        if (
                            !contextMgrNode.expressions.some((expr) =>
                                isExceptionContextManager(expr, contextMgrNode.isAsync)
                            )
                        ) {
                            return false;
                        }
                    }

                    const labelNode = curFlowNode as FlowLabel;
                    for (const antecedent of labelNode.antecedents) {
                        if (isFlowNodeReachableRecursive(antecedent, sourceFlowNode)) {
                            return true;
                        }
                    }
                    return false;
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    // If we hit the start but were looking for a particular source flow
                    // node, return false. Otherwise, the start is what we're looking for.
                    return sourceFlowNode ? false : true;
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    return !preFinallyFlowNode.isGateClosed;
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
        const isPositiveTest = !!(flowNode.flags & (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition));

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
                            const expandedType = mapSubtypes(type, (subtype) => {
                                return transformPossibleRecursiveTypeAlias(subtype);
                            });
                            return mapSubtypes(expandedType, (subtype) => {
                                if (isAnyOrUnknown(subtype)) {
                                    // We need to assume that "Any" is always both None and not None,
                                    // so it matches regardless of whether the test is positive or negative.
                                    return subtype;
                                }

                                // See if it's a match for None.
                                if (isNone(subtype) === adjIsPositiveTest) {
                                    return subtype;
                                }

                                return undefined;
                            });
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
                                    // Narrow the type based on whether the type derives from the specified type.
                                    return mapSubtypes(type, (subtype) => {
                                        if (isObject(subtype)) {
                                            const matches = ClassType.isDerivedFrom(classType, subtype.classType);
                                            if (adjIsPositiveTest) {
                                                return matches ? ObjectType.create(classType) : undefined;
                                            } else {
                                                // We can't eliminate the subtype in the negative
                                                // case because it could be a subclass of the type,
                                                // in which case `type(x) is y` would fail.
                                                return subtype;
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
                                return narrowTypeForLiteralComparison(
                                    type,
                                    rightType,
                                    adjIsPositiveTest,
                                    /* isIsOperator */ true
                                );
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
                                return narrowTypeForLiteralComparison(
                                    type,
                                    rightType,
                                    adjIsPositiveTest,
                                    /* isIsOperator */ false
                                );
                            };
                        }
                    }

                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                        const leftType = getTypeOfExpression(testExpression.leftExpression).type;
                        if (isObject(leftType) && leftType.classType.literalValue !== undefined) {
                            return (type: Type) => {
                                return narrowTypeForLiteralComparison(
                                    type,
                                    leftType,
                                    adjIsPositiveTest,
                                    /* isIsOperator */ false
                                );
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

            if (testExpression.operator === OperatorType.In) {
                // Look for "x in y" where y is one of several built-in types.
                if (isPositiveTest && ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    const rightType = getTypeOfExpression(testExpression.rightExpression).type;
                    return (type: Type) => {
                        return narrowTypeForContains(type, rightType);
                    };
                }
            }

            if (testExpression.operator === OperatorType.In || testExpression.operator === OperatorType.NotIn) {
                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                    // Look for <string literal> in y where y is a union that contains
                    // one or more TypedDicts.
                    const leftType = getTypeOfExpression(testExpression.leftExpression).type;
                    if (
                        isObject(leftType) &&
                        ClassType.isBuiltIn(leftType.classType, 'str') &&
                        isLiteralType(leftType)
                    ) {
                        const adjIsPositiveTest =
                            testExpression.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;
                        return (type: Type) => {
                            return narrowTypeForTypedDictKey(type, leftType.classType, adjIsPositiveTest);
                        };
                    }
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
                            EvaluatorFlags.EvaluateStringLiteralAsType |
                                EvaluatorFlags.ParamSpecDisallowed |
                                EvaluatorFlags.TypeVarTupleDisallowed
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

            if (testExpression.arguments.length >= 1) {
                const arg0Expr = testExpression.arguments[0].valueExpression;
                if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                    const functionType = getTypeOfExpression(testExpression.leftExpression).type;

                    // Does this look like it's a custom type guard function?
                    if (
                        isFunction(functionType) &&
                        functionType.details.declaredReturnType &&
                        isObject(functionType.details.declaredReturnType) &&
                        ClassType.isBuiltIn(functionType.details.declaredReturnType.classType, 'TypeGuard')
                    ) {
                        // Evaluate the type guard call expression.
                        const functionReturnType = getTypeOfExpression(testExpression).type;
                        if (
                            isObject(functionReturnType) &&
                            ClassType.isBuiltIn(functionReturnType.classType, 'TypeGuard')
                        ) {
                            const typeGuardTypeArgs = functionReturnType.classType.typeArguments;
                            const typeGuardTypeArg =
                                typeGuardTypeArgs && typeGuardTypeArgs.length > 0
                                    ? typeGuardTypeArgs[0]
                                    : UnknownType.create();

                            return (type: Type) => {
                                return isPositiveTest ? typeGuardTypeArg : type;
                            };
                        }
                    }
                }
            }
        }

        if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
            return (type: Type) => {
                // Narrow the type based on whether the subtype can be true or false.
                return mapSubtypes(type, (subtype) => {
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
    function getIsInstanceClassTypes(argType: Type): (ClassType | TypeVarType | NoneType)[] | undefined {
        argType = transformTypeObjectToClass(argType);

        if (isClass(argType) || (isTypeVar(argType) && TypeBase.isInstantiable(argType))) {
            return [argType];
        }

        if (isObject(argType)) {
            const objClass = argType.classType;
            if (isTupleClass(objClass) && objClass.tupleTypeArguments) {
                let foundNonClassType = false;
                const classTypeList: (ClassType | TypeVarType | NoneType)[] = [];
                objClass.tupleTypeArguments.forEach((typeArg) => {
                    typeArg = transformTypeObjectToClass(typeArg);
                    if (isClass(typeArg) || (isTypeVar(typeArg) && TypeBase.isInstantiable(typeArg))) {
                        classTypeList.push(typeArg);
                    } else if (isNone(typeArg) && TypeBase.isInstantiable(typeArg)) {
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

        // Python 3.10 supports unions within isinstance and issubclass calls.
        if (isUnion(argType)) {
            let isValid = true;
            const classList: (ClassType | TypeVarType)[] = [];
            doForEachSubtype(argType, (subtype) => {
                if (isClass(subtype) || (isTypeVar(subtype) && TypeBase.isInstantiable(subtype))) {
                    classList.push(subtype);
                } else {
                    isValid = false;
                }
            });

            if (isValid && classList.length > 0) {
                return classList;
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
        classTypeList: (ClassType | TypeVarType | NoneType)[],
        isInstanceCheck: boolean,
        isPositiveTest: boolean
    ): Type {
        const expandedTypes = mapSubtypes(type, (subtype) => {
            return transformPossibleRecursiveTypeAlias(subtype);
        });
        const effectiveType = mapSubtypes(expandedTypes, (subtype) => {
            return transformTypeObjectToClass(subtype);
        });

        // Filters the varType by the parameters of the isinstance
        // and returns the list of types the varType could be after
        // applying the filter.
        const filterType = (
            varType: ClassType,
            unexpandedType: Type,
            constraints: SubtypeConstraints,
            negativeFallbackType: Type
        ): Type[] => {
            const filteredTypes: Type[] = [];

            let foundSuperclass = false;
            let isClassRelationshipIndeterminate = false;

            for (const filterType of classTypeList) {
                const concreteFilterType = makeTopLevelTypeVarsConcrete(filterType);

                if (isClass(concreteFilterType)) {
                    // Handle the special case where the variable type is a TypedDict and
                    // we're filtering against 'dict'. TypedDict isn't derived from dict,
                    // but at runtime, isinstance returns True.
                    const filterIsSuperclass =
                        !isTypeVar(filterType) &&
                        (ClassType.isDerivedFrom(varType, concreteFilterType) ||
                            (isInstanceCheck &&
                                ClassType.isProtocolClass(concreteFilterType) &&
                                canAssignType(concreteFilterType, varType, new DiagnosticAddendum())) ||
                            (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(varType)));
                    const filterIsSubclass = ClassType.isDerivedFrom(concreteFilterType, varType);

                    if (filterIsSuperclass) {
                        foundSuperclass = true;
                    }

                    // Normally, a type should never be both a subclass or a superclass.
                    // This can happen if either of the class types derives from a
                    // class whose type is unknown (e.g. an import failed). We'll
                    // note this case specially so we don't do any narrowing, which
                    // will generate false positives.
                    if (
                        filterIsSubclass &&
                        filterIsSuperclass &&
                        !ClassType.isSameGenericClass(varType, concreteFilterType)
                    ) {
                        isClassRelationshipIndeterminate = true;
                    }

                    if (isPositiveTest) {
                        if (filterIsSuperclass) {
                            // If the variable type is a subclass of the isinstance filter,
                            // we haven't learned anything new about the variable type.
                            // For TypeVars (those that have no constraints), we'll use the
                            // unexpanded type to preserve the TypeVar.
                            if (isTypeVar(unexpandedType) && unexpandedType.details.constraints.length === 0) {
                                filteredTypes.push(unexpandedType);
                            } else {
                                filteredTypes.push(combineConstrainedTypes([{ type: varType, constraints }]));
                            }
                        } else if (filterIsSubclass) {
                            // If the variable type is a superclass of the isinstance
                            // filter, we can narrow the type to the subclass.
                            filteredTypes.push(filterType);
                        }
                    }
                } else if (isTypeVar(filterType) && TypeBase.isInstantiable(filterType)) {
                    // Handle the case where the filter type is Type[T] and the unexpanded
                    // subtype is some instance type, possibly T.
                    if (isInstanceCheck && TypeBase.isInstance(unexpandedType)) {
                        if (isTypeVar(unexpandedType) && isTypeSame(convertToInstance(filterType), unexpandedType)) {
                            // If the unexpanded subtype is T, we can definitively filter
                            // in both the positive and negative cases.
                            if (isPositiveTest) {
                                filteredTypes.push(unexpandedType);
                            }
                        } else {
                            if (isPositiveTest) {
                                filteredTypes.push(convertToInstance(filterType));
                            } else {
                                // If the unexpanded subtype is some other instance, we can't
                                // filter anything because it might be an instance.
                                filteredTypes.push(unexpandedType);
                                isClassRelationshipIndeterminate = true;
                            }
                        }
                    } else if (!isInstanceCheck && TypeBase.isInstantiable(unexpandedType)) {
                        if (isTypeVar(unexpandedType) && isTypeSame(filterType, unexpandedType)) {
                            if (isPositiveTest) {
                                filteredTypes.push(unexpandedType);
                            }
                        } else {
                            if (isPositiveTest) {
                                filteredTypes.push(filterType);
                            } else {
                                filteredTypes.push(unexpandedType);
                                isClassRelationshipIndeterminate = true;
                            }
                        }
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
                    filteredTypes.push(negativeFallbackType);
                }
            }

            if (!isInstanceCheck) {
                return filteredTypes;
            }

            return filteredTypes.map((t) => convertToInstance(t));
        };

        const anyOrUnknownSubstitutions: Type[] = [];
        const anyOrUnknown: Type[] = [];

        const filteredType = mapSubtypesExpandTypeVars(
            effectiveType,
            /* constraintFilter */ undefined,
            (subtype, unexpandedSubtype, constraints) => {
                // If we fail to filter anything in the negative case, we need to decide
                // whether to retain the original TypeVar or replace it with its specialized
                // type(s). We'll assume that if someone is using isinstance or issubclass
                // on a constrained TypeVar that they want to filter based on its constrained
                // parts.
                const negativeFallback = constraints ? subtype : unexpandedSubtype;
                const isSubtypeTypeObject = isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'type');

                if (isPositiveTest && isAnyOrUnknown(subtype)) {
                    // If this is a positive test and the effective type is Any or
                    // Unknown, we can assume that the type matches one of the
                    // specified types.
                    if (isInstanceCheck) {
                        anyOrUnknownSubstitutions.push(
                            combineTypes(classTypeList.map((classType) => convertToInstance(classType)))
                        );
                    } else {
                        anyOrUnknownSubstitutions.push(combineTypes(classTypeList));
                    }

                    anyOrUnknown.push(subtype);
                    return undefined;
                }

                if (isInstanceCheck) {
                    if (isNone(subtype)) {
                        const containsNoneType = classTypeList.some((t) => isNone(t) && TypeBase.isInstantiable(t));
                        if (isPositiveTest) {
                            return containsNoneType ? subtype : undefined;
                        } else {
                            return containsNoneType ? undefined : subtype;
                        }
                    }

                    if (isObject(subtype) && !isSubtypeTypeObject) {
                        return combineTypes(
                            filterType(
                                subtype.classType,
                                convertToInstance(unexpandedSubtype),
                                constraints,
                                negativeFallback
                            )
                        );
                    }

                    if (isClass(subtype) || isSubtypeTypeObject) {
                        // Handle the special case of isinstance(x, type).
                        const includesTypeType = classTypeList.some(
                            (classType) => isClass(classType) && ClassType.isBuiltIn(classType, 'type')
                        );
                        if (isPositiveTest) {
                            return includesTypeType ? negativeFallback : undefined;
                        } else {
                            return includesTypeType ? undefined : negativeFallback;
                        }
                    }
                } else {
                    if (isClass(subtype)) {
                        return combineTypes(filterType(subtype, unexpandedSubtype, constraints, negativeFallback));
                    }

                    if (isSubtypeTypeObject) {
                        if (objectType && isObject(objectType)) {
                            return combineTypes(
                                filterType(
                                    objectType.classType,
                                    convertToInstantiable(unexpandedSubtype),
                                    constraints,
                                    negativeFallback
                                )
                            );
                        }
                    }
                }

                return isPositiveTest ? undefined : negativeFallback;
            }
        );

        // If the result is Any/Unknown and contains no other subtypes and
        // we have substitutions for Any/Unknown, use those instead. We don't
        // want to apply this if the filtering produced something other than
        // Any/Unknown. For example, if the statement is "isinstance(x, list)"
        // and the type of x is "List[str] | int | Any", the result should be
        // "List[str]", not "List[str] | List[Unknown]".
        if (isNever(filteredType) && anyOrUnknownSubstitutions.length > 0) {
            return combineTypes(anyOrUnknownSubstitutions);
        }

        if (anyOrUnknown.length > 0) {
            return combineTypes([filteredType, ...anyOrUnknown]);
        }

        return filteredType;
    }

    // Attempts to narrow a type (make it more constrained) based on an "in" or
    // "not in" binary expression.
    function narrowTypeForContains(referenceType: Type, containerType: Type) {
        // We support contains narrowing only for certain built-in types that have been specialized.
        if (!isObject(containerType) || !ClassType.isBuiltIn(containerType.classType)) {
            return referenceType;
        }

        const classType = containerType.classType;
        const builtInName = classType.details.name;

        if (!['list', 'set', 'frozenset', 'deque'].some((name) => name === builtInName)) {
            return referenceType;
        }

        if (!classType.typeArguments || classType.typeArguments.length !== 1) {
            return referenceType;
        }

        const typeArg = classType.typeArguments[0];
        let canNarrow = true;

        const narrowedType = mapSubtypes(referenceType, (subtype) => {
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

    // Attempts to narrow a type based on whether it is a TypedDict with
    // a literal key value.
    function narrowTypeForTypedDictKey(referenceType: Type, literalKey: ClassType, isPositiveTest: boolean): Type {
        const narrowedType = mapSubtypes(referenceType, (subtype) => {
            if (isObject(subtype) && ClassType.isTypedDictClass(subtype.classType)) {
                const entries = getTypedDictMembersForClass(subtype.classType, /* allowNarrowed */ true);
                const tdEntry = entries.get(literalKey.literalValue as string);

                if (isPositiveTest) {
                    if (!tdEntry) {
                        return undefined;
                    }

                    // If the entry is currently not required, we can mark it as required
                    // after this guard expression confirms it is.
                    if (tdEntry.isRequired) {
                        return subtype;
                    }

                    const oldNarrowedEntriesMap = subtype.classType.typedDictNarrowedEntries;
                    const newNarrowedEntriesMap = new Map<string, TypedDictEntry>();
                    if (oldNarrowedEntriesMap) {
                        // Copy the old entries.
                        oldNarrowedEntriesMap.forEach((value, key) => {
                            newNarrowedEntriesMap.set(key, value);
                        });
                    }

                    // Add the new entry.
                    newNarrowedEntriesMap.set(literalKey.literalValue as string, {
                        valueType: tdEntry.valueType,
                        isRequired: true,
                        isProvided: true,
                    });

                    // Clone the TypedDict object with the new entries.
                    return ObjectType.create(
                        ClassType.cloneForNarrowedTypedDictEntries(subtype.classType, newNarrowedEntriesMap)
                    );
                } else {
                    return tdEntry !== undefined && tdEntry.isRequired ? undefined : subtype;
                }
            }

            return subtype;
        });

        return narrowedType;
    }

    // Attempts to narrow a type based on a comparison (equal or not equal)
    // between a discriminating node that has a declared literal type to a
    // literal value.
    function narrowTypeForDiscriminatedFieldComparison(
        referenceType: Type,
        memberName: string,
        literalType: ObjectType,
        isPositiveTest: boolean
    ): Type {
        let canNarrow = true;

        const narrowedType = mapSubtypes(referenceType, (subtype) => {
            subtype = transformTypeObjectToClass(subtype);

            let memberInfo: ClassMember | undefined;
            if (isObject(subtype)) {
                memberInfo = lookUpObjectMember(subtype, memberName);
            } else if (isClass(subtype)) {
                memberInfo = lookUpClassMember(subtype, memberName);
            }

            if (memberInfo && memberInfo.isTypeDeclared) {
                const memberType = getTypeOfMember(memberInfo);

                if (isLiteralTypeOrUnion(memberType)) {
                    if (isPositiveTest) {
                        return canAssignType(memberType, literalType, new DiagnosticAddendum()) ? subtype : undefined;
                    } else {
                        return canAssignType(literalType, memberType, new DiagnosticAddendum()) ? undefined : subtype;
                    }
                }
            }

            canNarrow = false;
            return subtype;
        });

        return canNarrow ? narrowedType : referenceType;
    }

    // Attempts to narrow a type (make it more constrained) based on a comparison
    // (equal or not equal) to a literal value. It also handles "is" or "is not"
    // operators if isIsOperator is true.
    function narrowTypeForLiteralComparison(
        referenceType: Type,
        literalType: ObjectType,
        isPositiveTest: boolean,
        isIsOperator: boolean
    ): Type {
        return mapSubtypes(referenceType, (subtype) => {
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
            } else if (isIsOperator && isPositiveTest) {
                return undefined;
            }

            return subtype;
        });
    }

    function enumerateLiteralsForType(type: ObjectType): ObjectType[] | undefined {
        if (ClassType.isBuiltIn(type.classType, 'bool')) {
            // Booleans have only two types: True and False.
            return [
                ObjectType.create(ClassType.cloneWithLiteral(type.classType, true)),
                ObjectType.create(ClassType.cloneWithLiteral(type.classType, false)),
            ];
        }

        if (ClassType.isEnumClass(type.classType)) {
            // Enumerate all of the values in this enumeration.
            const enumList: ObjectType[] = [];
            const fields = type.classType.details.fields;
            fields.forEach((symbol, name) => {
                if (!symbol.isIgnoredForProtocolMatch() && !symbol.isInstanceMember()) {
                    const symbolType = getEffectiveTypeOfSymbol(symbol);
                    if (
                        isObject(symbolType) &&
                        ClassType.isSameGenericClass(type.classType, symbolType.classType) &&
                        symbolType.classType.literalValue !== undefined
                    ) {
                        enumList.push(symbolType);
                    }
                }
            });

            return enumList;
        }

        return undefined;
    }

    // Attempts to narrow a type (make it more constrained) based on a
    // call to "callable". For example, if the original type of expression "x" is
    // Union[Callable[..., Any], Type[int], int], it would remove the "int" because
    // it's not callable.
    function narrowTypeForCallable(type: Type, isPositiveTest: boolean, errorNode: ExpressionNode): Type {
        return mapSubtypes(type, (subtype) => {
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            switch (concreteSubtype.category) {
                case TypeCategory.Function:
                case TypeCategory.OverloadedFunction:
                case TypeCategory.Class: {
                    return isPositiveTest ? subtype : undefined;
                }

                case TypeCategory.None:
                case TypeCategory.Module: {
                    return isPositiveTest ? undefined : subtype;
                }

                case TypeCategory.Object: {
                    const classFromTypeObject = transformTypeObjectToClass(concreteSubtype);
                    if (TypeBase.isInstantiable(classFromTypeObject)) {
                        // It's a Type object, which is a class.
                        return isPositiveTest ? subtype : undefined;
                    }

                    // See if the object is callable.
                    const callMemberType = getTypeFromObjectMember(errorNode, concreteSubtype, '__call__');
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
            const aliasedName = classType.aliasName || classType.details.name;
            switch (aliasedName) {
                case 'Callable': {
                    return createCallableType(typeArgs, errorNode);
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

                case 'Protocol': {
                    return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
                }

                case 'Tuple': {
                    return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
                }

                case 'Union': {
                    return createUnionType(typeArgs);
                }

                case 'Generic': {
                    return createGenericType(errorNode, classType, typeArgs);
                }

                case 'Final': {
                    return createFinalType(classType, errorNode, typeArgs, flags);
                }

                case 'Annotated': {
                    return createAnnotatedType(errorNode, typeArgs);
                }

                case 'Concatenate': {
                    return createConcatenateType(errorNode, classType, typeArgs);
                }

                case 'TypeGuard': {
                    return createTypeGuardType(errorNode, classType, typeArgs);
                }

                case 'Unpack': {
                    return createUnpackType(errorNode, typeArgs);
                }

                case 'Required':
                case 'NotRequired': {
                    return createRequiredType(classType, errorNode, aliasedName === 'Required', typeArgs);
                }
            }
        }

        const fileInfo = getFileInfo(errorNode);
        if (
            fileInfo.isStubFile ||
            fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_9 ||
            isAnnotationEvaluationPostponed(getFileInfo(errorNode)) ||
            (flags & EvaluatorFlags.AllowForwardReferences) !== 0
        ) {
            // Handle "type" specially, since it needs to act like "Type"
            // in Python 3.9 and newer.
            if (ClassType.isBuiltIn(classType, 'type') && typeArgs) {
                const typeClass = getTypingType(errorNode, 'Type');
                if (typeClass && isClass(typeClass)) {
                    return createSpecialType(typeClass, typeArgs, 1);
                }
            }

            // Handle "tuple" specially, since it needs to act like "Tuple"
            // in Python 3.9 and newer.
            if (isTupleClass(classType)) {
                return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
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

        const variadicTypeParamIndex = typeParameters.findIndex((param) => isVariadicTypeVar(param));

        if (typeArgs) {
            if (typeArgCount > typeParameters.length) {
                if (!ClassType.isPartiallyConstructed(classType) && !ClassType.isTupleClass(classType)) {
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
                                name: classType.aliasName || classType.details.name,
                                expected: typeParameters.length,
                                received: typeArgCount,
                            }),
                            typeArgs[typeParameters.length].node
                        );
                    }
                }
                typeArgCount = typeParameters.length;
            } else if (typeArgCount < typeParameters.length) {
                const fileInfo = getFileInfo(errorNode);
                addDiagnostic(
                    fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.typeArgsTooFew().format({
                        name: classType.aliasName || classType.details.name,
                        expected: typeParameters.length,
                        received: typeArgCount,
                    }),
                    typeArgs.length > 0 ? typeArgs[0].node.parent! : errorNode
                );
            }

            typeArgs.forEach((typeArg, index) => {
                if (index === variadicTypeParamIndex) {
                    // The types that make up the tuple that maps to the variadic
                    // type variable have already been validated when the tuple
                    // object was created in adjustTypeArgumentsForVariadicTypeVar.
                    if (isObject(typeArg.type) && isTupleClass(typeArg.type.classType)) {
                        return;
                    }

                    if (isVariadicTypeVar(typeArg.type)) {
                        validateVariadicTypeVarIsUnpacked(typeArg.type, typeArg.node);
                        return;
                    }
                }

                validateTypeArg(
                    typeArg,
                    /* allowEmptyTuple */ false,
                    /* allowVariadicTypeVar */ false,
                    /* allowParamSpec */ true
                );
            });
        }

        // Fill in any missing type arguments with Unknown.
        const typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];
        const typeParams = ClassType.getTypeParameters(classType);
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(UnknownType.create());
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
                            name: TypeVarType.getReadableName(typeParameters[index]),
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
    function getTypeForArgumentExpectingType(arg: FunctionArgument): Type {
        if (arg.type) {
            return arg.type;
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeForExpressionExpectingType(arg.valueExpression!);
    }

    function getTypeForExpressionExpectingType(node: ExpressionNode, allowFinal = false) {
        let flags =
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.ParamSpecDisallowed |
            EvaluatorFlags.TypeVarTupleDisallowed;

        const fileInfo = getFileInfo(node);
        if (fileInfo.isStubFile) {
            flags |= EvaluatorFlags.AllowForwardReferences;
        }

        if (!allowFinal) {
            flags |= EvaluatorFlags.FinalDisallowed;
        }

        return getTypeOfExpression(node, undefined, flags).type;
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
                    /* isTypeArgumentExplicit */ typeArguments !== undefined
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
                            // If there was no control flow path from the usage back
                            // to the source, see if the usage node is reachable by
                            // any path.
                            const flowNode = AnalyzerNodeInfo.getFlowNode(node);
                            const isReachable = flowNode && isFlowNodeReachable(flowNode);
                            return !isReachable;
                        }
                    }
                }

                return true;
            });

            // If none of the declarations are reachable from the current node,
            // search for the symbol in outer scopes.
            if (decls.length === 0) {
                if (symbolWithScope.scope.parent) {
                    symbolWithScope = symbolWithScope.scope.parent.lookUpSymbolRecursive(
                        name,
                        symbolWithScope.isOutsideCallerModule || symbolWithScope.scope.type === ScopeType.Module,
                        symbolWithScope.isBeyondExecutionScope || symbolWithScope.scope.isIndependentlyExecutable()
                    );
                } else {
                    symbolWithScope = undefined;
                }
            }
        }

        return symbolWithScope;
    }

    // Disables recording of errors and warnings.
    function suppressDiagnostics<T>(node: ParseNode, callback: () => T) {
        suppressedNodeStack.push(node);
        try {
            return callback();
        } finally {
            suppressedNodeStack.pop();
        }
    }

    // Disables recording of errors and warnings and disables
    // any caching of types, under the assumption that we're
    // performing speculative evaluations.
    function useSpeculativeMode<T>(speculativeNode: ParseNode, callback: () => T, allowCacheRetention = true) {
        speculativeTypeTracker.enterSpeculativeContext(speculativeNode, allowCacheRetention);

        try {
            return callback();
        } finally {
            speculativeTypeTracker.leaveSpeculativeContext();
        }
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
        if (isFunction(type)) {
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
                baseType = transformTypeObjectToClass(makeTopLevelTypeVarsConcrete(baseType));
                const memberName = node.parent.memberName.value;
                doForEachSubtype(baseType, (subtype) => {
                    let symbol: Symbol | undefined;

                    subtype = makeTopLevelTypeVarsConcrete(subtype);

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
                const baseType = getTypeOfExpression(argNode.parent.leftExpression).type;

                if (baseType) {
                    if (isFunction(baseType) && baseType.details.declaration) {
                        const paramDecl = getDeclarationFromFunctionNamedParameter(baseType, paramName);
                        if (paramDecl) {
                            declarations.push(paramDecl);
                        }
                    } else if (isOverloadedFunction(baseType)) {
                        baseType.overloads.forEach((f) => {
                            const paramDecl = getDeclarationFromFunctionNamedParameter(f, paramName);
                            if (paramDecl) {
                                declarations.push(paramDecl);
                            }
                        });
                    } else if (isClass(baseType)) {
                        const initMethodType = getTypeFromObjectMember(
                            argNode.parent.leftExpression,
                            ObjectType.create(baseType),
                            '__init__',
                            { method: 'get' },
                            new DiagnosticAddendum(),
                            MemberAccessFlags.SkipObjectBaseClass
                        )?.type;

                        if (initMethodType && isFunction(initMethodType)) {
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
            const fileInfo = getFileInfo(node);
            let allowForwardReferences = fileInfo.isStubFile;

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
                                    /* isTypeArgumentExplicit */ true
                                )
                            );
                        }
                    }

                    if (declaration.intrinsicType === 'Dict[str, Any]') {
                        const dictType = getBuiltInType(declaration.node, 'dict');
                        if (isClass(dictType)) {
                            return ObjectType.create(
                                ClassType.cloneForSpecialization(
                                    dictType,
                                    [strType, AnyType.create()],
                                    /* isTypeArgumentExplicit */ true
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
                return getTypeOfAnnotation(declaration.node.typeAnnotation, /* isVariableAnnotation */ false);
            }

            case DeclarationType.Function: {
                const functionTypeInfo = getTypeOfFunction(declaration.node);
                return functionTypeInfo ? functionTypeInfo.decoratedType : undefined;
            }

            case DeclarationType.Parameter: {
                let typeAnnotationNode = declaration.node.typeAnnotation || declaration.node.typeAnnotationComment;

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
                        /* isVariableAnnotation */ false,
                        /* allowFinal */ false,
                        /* associateTypeVarsWithScope */ true,
                        /* allowTypeVarTuple */ declaration.node.category === ParameterCategory.VarArgList
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
                    let declaredType = getTypeOfAnnotation(typeAnnotationNode, /* isVariableAnnotation */ true);

                    if (declaredType) {
                        // Apply enum transform if appropriate.
                        if (declaration.node.nodeType === ParseNodeType.Name) {
                            declaredType =
                                transformTypeForPossibleEnumClass(declaration.node, () => declaredType) || declaredType;
                        }

                        if (typeAliasNode && typeAliasNode.valueExpression.nodeType === ParseNodeType.Name) {
                            declaredType = transformTypeForTypeAlias(
                                declaredType,
                                typeAliasNode.valueExpression,
                                declaration.node
                            );
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
                    const importedModuleType = ModuleType.create(moduleName, implicitImport.path);
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
            let moduleName = resolvedDecl.moduleName;
            if (decl.type === DeclarationType.Alias) {
                if (decl.symbolName) {
                    moduleName += '.' + decl.symbolName;
                }

                // If the module name is relative to the current file, use that
                // file's module name as a reference.
                if (moduleName.startsWith('.')) {
                    const fileInfo = getFileInfo(decl.node);
                    const nameParts = fileInfo.moduleName.split('.');
                    moduleName = moduleName.substr(1);

                    while (moduleName.startsWith('.') && nameParts.length > 0) {
                        moduleName = moduleName.substr(1);
                        nameParts.pop();
                    }

                    moduleName = nameParts.join('.') + '.' + moduleName;
                }
            }
            const moduleType = ModuleType.create(moduleName, resolvedDecl.path);
            if (resolvedDecl.symbolName && resolvedDecl.submoduleFallback) {
                return applyLoaderActionsToModuleType(moduleType, resolvedDecl.submoduleFallback, importLookup);
            } else {
                return applyLoaderActionsToModuleType(moduleType, resolvedDecl, importLookup);
            }
        }

        const declaredType = getTypeForDeclaration(resolvedDecl);
        if (declaredType) {
            return declaredType;
        }

        // If this is part of a "py.typed" package, don't fall back on type inference
        // unless it's marked Final, is a constant, or is a declared type alias.
        const fileInfo = getFileInfo(resolvedDecl.node);
        let isSpeculativeTypeAliasFromPyTypedFile = false;

        if (fileInfo.isInPyTypedPackage && !fileInfo.isStubFile && evaluatorOptions.disableInferenceForPyTypedSources) {
            if (resolvedDecl.type !== DeclarationType.Variable) {
                return UnknownType.create();
            }

            // Special-case variables within an enum class. These are effectively
            // constants, so we'll treat them as such.
            const enclosingClass = ParseTreeUtils.getEnclosingClass(resolvedDecl.node, /* stopAtFunction */ true);
            let isEnumValue = false;
            if (enclosingClass) {
                const classTypeInfo = getTypeOfClass(enclosingClass);
                if (classTypeInfo && ClassType.isEnumClass(classTypeInfo.classType)) {
                    isEnumValue = true;
                }
            }

            if (!resolvedDecl.isFinal && !resolvedDecl.isConstant && !isEnumValue) {
                if (!resolvedDecl.typeAliasName) {
                    return UnknownType.create();
                } else if (!resolvedDecl.typeAliasAnnotation) {
                    isSpeculativeTypeAliasFromPyTypedFile = true;
                }
            }
        }

        // If the resolved declaration had no defined type, use the
        // inferred type for this node.
        if (resolvedDecl.type === DeclarationType.Parameter) {
            return evaluateTypeForSubnode(resolvedDecl.node.name!, () => {
                evaluateTypeOfParameter(resolvedDecl.node);
            })?.type;
        }

        if (resolvedDecl.type === DeclarationType.Variable && resolvedDecl.inferredTypeSource) {
            // If this is a type alias, evaluate types for the entire assignment
            // statement rather than just the RHS of the assignment.
            const typeSource =
                resolvedDecl.typeAliasName && resolvedDecl.inferredTypeSource.parent
                    ? resolvedDecl.inferredTypeSource.parent
                    : resolvedDecl.inferredTypeSource;
            let inferredType = evaluateTypeForSubnode(resolvedDecl.node, () => {
                evaluateTypesForStatement(typeSource);
            })?.type;

            if (inferredType && resolvedDecl.node.nodeType === ParseNodeType.Name) {
                // See if this is an enum member. If so, we need to handle it as a special case.
                const enumMemberType = transformTypeForPossibleEnumClass(resolvedDecl.node, () => {
                    return (
                        evaluateTypeForSubnode(resolvedDecl.inferredTypeSource!, () => {
                            evaluateTypesForStatement(resolvedDecl.inferredTypeSource!);
                        })?.type || UnknownType.create()
                    );
                });
                if (enumMemberType) {
                    inferredType = enumMemberType;
                }
            }

            if (inferredType && resolvedDecl.typeAliasName) {
                // If this was a speculative type alias, it becomes a real type alias only
                // in the event that its inferred type is instantiable.
                if (TypeBase.isInstantiable(inferredType) && !isAnyOrUnknown(inferredType)) {
                    inferredType = transformTypeForTypeAlias(
                        inferredType,
                        resolvedDecl.typeAliasName,
                        resolvedDecl.node
                    );
                } else if (isSpeculativeTypeAliasFromPyTypedFile) {
                    return UnknownType.create();
                }
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

    const getEffectiveTypeOfSymbolForUsage = evaluatorOptions.logCalls
        ? (s: Symbol, u?: NameNode, l = false) =>
              logInternalCall(
                  'getEffectiveTypeOfSymbolForUsage',
                  () => getEffectiveTypeOfSymbolForUsageInternal(s, u, l),
                  s
              )
        : getEffectiveTypeOfSymbolForUsageInternal;

    function getEffectiveTypeOfSymbolForUsageInternal(
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl = false
    ): EffectiveTypeResult {
        // If there's a declared type, it takes precedence over inferred types.
        if (symbol.hasTypedDeclarations()) {
            const declaredType = getDeclaredTypeOfSymbol(symbol);
            return {
                type: declaredType || UnknownType.create(),
                isIncomplete: false,
                includesVariableDecl: symbol
                    .getTypedDeclarations()
                    .some((decl) => decl.type === DeclarationType.Variable),
                isRecursiveDefinition: !declaredType,
            };
        }

        // Look in the cache to see if we've computed this already.
        let cacheEntries = effectiveTypeCache.get(symbol.id);
        const usageNodeId = usageNode ? usageNode.id : undefined;
        if (cacheEntries) {
            for (const entry of cacheEntries) {
                if (entry.usageNodeId === usageNodeId && entry.useLastDecl === useLastDecl) {
                    return entry.result;
                }
            }
        }

        // Infer the type.
        const typesToCombine: Type[] = [];
        const isPrivate = symbol.isPrivateMember();
        const decls = symbol.getDeclarations();
        const isFinalVar = isFinalVariable(symbol);
        let isIncomplete = false;
        let includesVariableDecl = false;

        decls.forEach((decl, index) => {
            // If useLastDecl is true, consider only the last declaration.
            let considerDecl = !useLastDecl || index === decls.length - 1;

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

                        if (!popSymbolResolution(symbol)) {
                            isIncomplete = true;
                        }

                        if (type) {
                            if (decl.type === DeclarationType.Variable) {
                                includesVariableDecl = true;

                                let isConstant = decl.type === DeclarationType.Variable && !!decl.isConstant;

                                // Treat enum values declared within an enum class as though they are const even
                                // though they may not be named as such.
                                if (
                                    isObject(type) &&
                                    ClassType.isEnumClass(type.classType) &&
                                    isDeclInEnumClass(decl)
                                ) {
                                    isConstant = true;
                                }

                                // If the symbol is private or constant, we can retain the literal
                                // value. Otherwise, strip literal values to widen the type.
                                if (
                                    TypeBase.isInstance(type) &&
                                    !isTypeAlias &&
                                    !isPrivate &&
                                    !isConstant &&
                                    !isFinalVar
                                ) {
                                    type = stripLiteralValue(type);
                                }
                            }
                            typesToCombine.push(type);
                        } else {
                            isIncomplete = true;
                        }
                    } catch (e) {
                        // Clean up the stack before rethrowing.
                        popSymbolResolution(symbol);
                        throw e;
                    }
                } else {
                    isIncomplete = true;
                }
            }
        });

        if (typesToCombine.length > 0) {
            const result: EffectiveTypeResult = {
                type: combineTypes(typesToCombine),
                isIncomplete: false,
                includesVariableDecl,
                isRecursiveDefinition: false,
            };

            // Add the entry to the cache so we don't need to compute it next time.
            if (!cacheEntries) {
                cacheEntries = [];
                effectiveTypeCache.set(symbol.id, cacheEntries);
            }

            cacheEntries.push({
                usageNodeId,
                useLastDecl,
                result,
            });

            return result;
        }

        return {
            type: UnboundType.create(),
            isIncomplete,
            includesVariableDecl,
            isRecursiveDefinition: false,
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

                        // If there was recursion detected, don't use this declaration.
                        // The exception is it's a class declaration because getTypeOfClass
                        // handles recursion by populating a partially-created class type
                        // in the type cache. This exception is required to handle the
                        // circular dependency between the "type" and "object" classes in
                        // builtins.pyi (since "object" is a "type" and "type" is an "object").
                        if (popSymbolResolution(symbol) || decl.type === DeclarationType.Class) {
                            return type;
                        }
                    } catch (e) {
                        // Clean up the stack before rethrowing.
                        popSymbolResolution(symbol);
                        throw e;
                    }
                }
            }

            declIndex--;
        }

        return undefined;
    }

    function isDeclInEnumClass(decl: VariableDeclaration): boolean {
        const classNode = ParseTreeUtils.getEnclosingClass(decl.node, /* stopAtFunction */ true);
        if (!classNode) {
            return false;
        }

        const classInfo = getTypeOfClass(classNode);
        if (!classInfo) {
            return false;
        }

        return ClassType.isEnumClass(classInfo.classType);
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

    const getFunctionInferredReturnType = evaluatorOptions.logCalls
        ? (t: FunctionType, a?: ValidateArgTypeParams[]) =>
              logInternalCall('getFunctionInferredReturnType', () => getFunctionInferredReturnTypeInternal(t, a), t)
        : getFunctionInferredReturnTypeInternal;

    function getFunctionInferredReturnTypeInternal(type: FunctionType, args?: ValidateArgTypeParams[]) {
        let returnType: Type | undefined;

        // Don't attempt to infer the return type for a stub file or a py.typed module.
        if (FunctionType.isStubDefinition(type) || FunctionType.isPyTypedDefinition(type)) {
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
                    returnType = createAwaitableReturnType(
                        functionNode,
                        returnType,
                        !!type.details.declaration?.isGenerator
                    );
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
            !FunctionType.isPyTypedDefinition(type) &&
            args
        ) {
            const contextualReturnType = getFunctionInferredReturnTypeUsingArguments(type, args);
            if (contextualReturnType) {
                returnType = removeNoReturnFromUnion(contextualReturnType);
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

        // Very complex functions with many arguments can take a long time to analyze,
        // so we'll use a heuristic and avoiding this inference technique for any
        // call site that involves too many arguments.
        if (args.length > maxReturnTypeInferenceArgumentCount) {
            return undefined;
        }

        // Don't explore arbitrarily deep in the call graph.
        if (returnTypeInferenceContextStack.length >= maxReturnTypeInferenceStackSize) {
            return undefined;
        }

        // Suppress diagnostics because we don't want to generate errors.
        suppressDiagnostics(functionNode, () => {
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
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
                        } else if (param.defaultValue) {
                            paramType = getTypeOfExpression(param.defaultValue).type;
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
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

                        writeTypeCache(param.name, paramType, /* isIncomplete */ false);
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
            contextualReturnType = removeUnbound(contextualReturnType);

            // Do we need to wrap this in an awaitable?
            if (FunctionType.isWrapReturnTypeInAwait(type) && !isNoReturnType(contextualReturnType)) {
                contextualReturnType = createAwaitableReturnType(
                    functionNode,
                    contextualReturnType,
                    !!type.details.declaration?.isGenerator
                );
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

    function getTypeOfMemberInternal(node: ParseNode, member: ClassMember): TypeResult | undefined {
        if (isClass(member.classType)) {
            const typeResult = getEffectiveTypeOfSymbolForUsage(member.symbol);
            if (typeResult) {
                return {
                    node,
                    type: partiallySpecializeType(typeResult.type, member.classType),
                    isIncomplete: !!typeResult.isIncomplete,
                };
            }
        }
        return undefined;
    }

    function canAssignClassToProtocol(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        allowMetaclassForProtocols: boolean,
        recursionCount: number
    ): boolean {
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        const destClassFields = destType.details.fields;

        // Some protocol definitions include recursive references to themselves.
        // We need to protect against infinite recursion, so we'll check for that here.
        if (ClassType.isSameGenericClass(srcType, destType)) {
            if (isTypeSame(srcType, destType)) {
                return true;
            }

            return verifyTypeArgumentsAssignable(destType, srcType, diag, typeVarMap, flags, recursionCount + 1);
        }

        // Strip the type arguments off the dest protocol if they are provided.
        const genericDestType = ClassType.cloneForSpecialization(
            destType,
            undefined,
            /* isTypeArgumentExplicit */ false
        );
        const genericDestTypeVarMap = new TypeVarMap(getTypeVarScopeId(destType));

        let typesAreConsistent = true;
        const srcClassTypeVarMap = buildTypeVarMapFromSpecializedClass(srcType);

        destClassFields.forEach((symbol, name) => {
            if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                let isMemberFromMetaclass = false;
                let memberInfo: ClassMember | undefined;

                // Look up in the metaclass first if allowed.
                if (
                    allowMetaclassForProtocols &&
                    srcType.details.effectiveMetaclass &&
                    isClass(srcType.details.effectiveMetaclass)
                ) {
                    memberInfo = lookUpClassMember(srcType.details.effectiveMetaclass, name);
                    srcClassTypeVarMap.addSolveForScope(getTypeVarScopeId(srcType.details.effectiveMetaclass));
                    isMemberFromMetaclass = true;
                }

                if (!memberInfo) {
                    memberInfo = lookUpClassMember(srcType, name);
                }

                if (!memberInfo) {
                    diag.addMessage(Localizer.DiagnosticAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                } else {
                    let destMemberType = getDeclaredTypeOfSymbol(symbol);
                    if (destMemberType) {
                        let srcMemberType = getTypeOfMember(memberInfo);

                        if (isFunction(srcMemberType) || isOverloadedFunction(srcMemberType)) {
                            if (isMemberFromMetaclass) {
                                const boundSrcFunction = bindFunctionToClassOrObject(
                                    srcType,
                                    srcMemberType,
                                    /* memberClass */ undefined,
                                    /* errorNode */ undefined,
                                    recursionCount + 1,
                                    /* treatConstructorAsClassMember */ false,
                                    srcType
                                );
                                if (boundSrcFunction) {
                                    srcMemberType = boundSrcFunction;
                                }

                                if (isFunction(destMemberType) || isOverloadedFunction(destMemberType)) {
                                    const boundDeclaredType = bindFunctionToClassOrObject(
                                        srcType,
                                        destMemberType,
                                        /* memberClass */ undefined,
                                        /* errorNode */ undefined,
                                        recursionCount + 1,
                                        /* treatConstructorAsClassMember */ false,
                                        srcType
                                    );
                                    if (boundDeclaredType) {
                                        destMemberType = boundDeclaredType;
                                    }
                                }
                            } else if (isClass(memberInfo.classType)) {
                                const boundSrcFunction = bindFunctionToClassOrObject(
                                    ObjectType.create(srcType),
                                    srcMemberType,
                                    memberInfo.classType,
                                    /* errorNode */ undefined,
                                    recursionCount + 1
                                );
                                if (boundSrcFunction) {
                                    srcMemberType = boundSrcFunction;
                                }

                                if (isFunction(destMemberType) || isOverloadedFunction(destMemberType)) {
                                    const boundDeclaredType = bindFunctionToClassOrObject(
                                        ObjectType.create(srcType),
                                        destMemberType,
                                        memberInfo.classType,
                                        /* errorNode */ undefined,
                                        recursionCount + 1
                                    );
                                    if (boundDeclaredType) {
                                        destMemberType = boundDeclaredType;
                                    }
                                }
                            }
                        }

                        const subDiag = diag.createAddendum();

                        // Properties require special processing.
                        if (
                            isObject(destMemberType) &&
                            ClassType.isPropertyClass(destMemberType.classType) &&
                            isObject(srcMemberType) &&
                            ClassType.isPropertyClass(srcMemberType.classType)
                        ) {
                            if (
                                !canAssignProperty(
                                    destMemberType.classType,
                                    srcMemberType.classType,
                                    srcType,
                                    subDiag.createAddendum(),
                                    genericDestTypeVarMap,
                                    recursionCount + 1
                                )
                            ) {
                                subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                                typesAreConsistent = false;
                            }
                        } else if (
                            !canAssignType(
                                destMemberType,
                                srcMemberType,
                                subDiag.createAddendum(),
                                genericDestTypeVarMap,
                                CanAssignFlags.Default,
                                recursionCount + 1
                            )
                        ) {
                            subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
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
                const specializedBaseClass = specializeForBaseClass(destType, baseClass);
                if (
                    !canAssignClassToProtocol(
                        specializedBaseClass,
                        srcType,
                        diag.createAddendum(),
                        typeVarMap,
                        flags,
                        allowMetaclassForProtocols,
                        recursionCount + 1
                    )
                ) {
                    typesAreConsistent = false;
                }
            }
        });

        // If the dest protocol has type parameters, make sure the source type arguments match.
        if (typesAreConsistent && destType.details.typeParameters.length > 0 && destType.typeArguments) {
            // Create a specialized version of the protocol defined by the dest and
            // make sure the resulting type args can be assigned.
            const specializedDestProtocol = applySolvedTypeVars(genericDestType, genericDestTypeVarMap) as ClassType;

            if (
                !verifyTypeArgumentsAssignable(
                    destType,
                    specializedDestProtocol,
                    diag,
                    typeVarMap,
                    flags,
                    recursionCount + 1
                )
            ) {
                typesAreConsistent = false;
            }
        }

        return typesAreConsistent;
    }

    function canAssignModuleToProtocol(
        destType: ClassType,
        srcType: ModuleType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags,
        recursionCount: number
    ): boolean {
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        let typesAreConsistent = true;
        const destClassFields = destType.details.fields;

        // Strip the type arguments off the dest protocol if they are provided.
        const genericDestType = ClassType.cloneForSpecialization(
            destType,
            undefined,
            /* isTypeArgumentExplicit */ false
        );
        const genericDestTypeVarMap = new TypeVarMap(getTypeVarScopeId(destType));

        destClassFields.forEach((symbol, name) => {
            if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                const memberSymbol = srcType.fields.get(name);

                if (!memberSymbol) {
                    diag.addMessage(Localizer.DiagnosticAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                } else {
                    let declaredType = getDeclaredTypeOfSymbol(symbol);
                    if (declaredType) {
                        const srcMemberType = getEffectiveTypeOfSymbol(memberSymbol);

                        if (isFunction(srcMemberType) || isOverloadedFunction(srcMemberType)) {
                            if (isFunction(declaredType) || isOverloadedFunction(declaredType)) {
                                const boundDeclaredType = bindFunctionToClassOrObject(
                                    ObjectType.create(destType),
                                    declaredType,
                                    destType,
                                    /* errorNode */ undefined,
                                    recursionCount + 1
                                );
                                if (boundDeclaredType) {
                                    declaredType = boundDeclaredType;
                                }
                            }
                        }

                        const subDiag = diag.createAddendum();

                        if (
                            !canAssignType(
                                declaredType,
                                srcMemberType,
                                subDiag.createAddendum(),
                                genericDestTypeVarMap,
                                CanAssignFlags.Default,
                                recursionCount + 1
                            )
                        ) {
                            subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                            typesAreConsistent = false;
                        }
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
                const specializedBaseClass = specializeForBaseClass(destType, baseClass);
                if (
                    !canAssignModuleToProtocol(
                        specializedBaseClass,
                        srcType,
                        diag.createAddendum(),
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
        if (typesAreConsistent && destType.details.typeParameters.length > 0 && destType.typeArguments) {
            // Create a specialized version of the protocol defined by the dest and
            // make sure the resulting type args can be assigned.
            const specializedSrcProtocol = applySolvedTypeVars(genericDestType, genericDestTypeVarMap) as ClassType;

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

    function canAssignProperty(
        destPropertyType: ClassType,
        srcPropertyType: ClassType,
        srcClass: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap?: TypeVarMap,
        recursionCount = 0
    ): boolean {
        const objectToBind = ObjectType.create(srcClass);
        let isAssignable = true;
        const accessors: { name: string; missingDiagMsg: () => string; incompatibleDiagMsg: () => string }[] = [
            {
                name: 'fget',
                missingDiagMsg: Localizer.DiagnosticAddendum.missingGetter,
                incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleGetter,
            },
            {
                name: 'fset',
                missingDiagMsg: Localizer.DiagnosticAddendum.missingSetter,
                incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleSetter,
            },
            {
                name: 'fdel',
                missingDiagMsg: Localizer.DiagnosticAddendum.missingDeleter,
                incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleDeleter,
            },
        ];

        accessors.forEach((accessorInfo) => {
            const destAccessSymbol = destPropertyType.details.fields.get(accessorInfo.name);
            const destAccessType = destAccessSymbol ? getDeclaredTypeOfSymbol(destAccessSymbol) : undefined;

            if (destAccessType && isFunction(destAccessType)) {
                const srcAccessSymbol = srcPropertyType.details.fields.get(accessorInfo.name);
                const srcAccessType = srcAccessSymbol ? getDeclaredTypeOfSymbol(srcAccessSymbol) : undefined;

                if (!srcAccessType || !isFunction(srcAccessType)) {
                    diag.addMessage(accessorInfo.missingDiagMsg());
                    isAssignable = false;
                    return;
                }

                const boundDestAccessType = bindFunctionToClassOrObject(objectToBind, destAccessType);
                const boundSrcAccessType = bindFunctionToClassOrObject(objectToBind, srcAccessType);

                if (
                    !boundDestAccessType ||
                    !boundSrcAccessType ||
                    !canAssignType(
                        boundDestAccessType,
                        boundSrcAccessType,
                        diag.createAddendum(),
                        typeVarMap,
                        CanAssignFlags.Default,
                        recursionCount + 1
                    )
                ) {
                    diag.addMessage('getter type is incompatible');
                    isAssignable = false;
                    return;
                }
            }
        });

        return isAssignable;
    }

    // This function is used to validate the variance of type variables
    // within a protocol class.
    function canAssignProtocolClassToSelf(destType: ClassType, srcType: ClassType, recursionCount = 1): boolean {
        assert(ClassType.isProtocolClass(destType));
        assert(ClassType.isProtocolClass(srcType));
        assert(ClassType.isSameGenericClass(destType, srcType));
        assert(destType.details.typeParameters.length > 0);

        const diag = new DiagnosticAddendum();
        const typeVarMap = new TypeVarMap();
        let isAssignable = true;

        destType.details.fields.forEach((symbol, name) => {
            if (isAssignable && symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                const memberInfo = lookUpClassMember(srcType, name);
                assert(memberInfo !== undefined);

                let destMemberType = getDeclaredTypeOfSymbol(symbol);
                if (destMemberType) {
                    const srcMemberType = getTypeOfMember(memberInfo!);
                    destMemberType = partiallySpecializeType(destMemberType, destType);

                    // Properties require special processing.
                    if (
                        isObject(destMemberType) &&
                        ClassType.isPropertyClass(destMemberType.classType) &&
                        isObject(srcMemberType) &&
                        ClassType.isPropertyClass(srcMemberType.classType)
                    ) {
                        if (
                            !canAssignProperty(
                                destMemberType.classType,
                                srcMemberType.classType,
                                srcType,
                                diag,
                                typeVarMap,
                                recursionCount + 1
                            )
                        ) {
                            isAssignable = false;
                        }
                    } else if (
                        !canAssignType(
                            destMemberType,
                            srcMemberType,
                            diag,
                            typeVarMap,
                            CanAssignFlags.Default,
                            recursionCount + 1
                        )
                    ) {
                        isAssignable = false;
                    }
                }
            }
        });

        // Now handle generic base classes.
        destType.details.baseClasses.forEach((baseClass) => {
            if (
                isClass(baseClass) &&
                ClassType.isProtocolClass(baseClass) &&
                !ClassType.isBuiltIn(baseClass, 'object') &&
                !ClassType.isBuiltIn(baseClass, 'Protocol') &&
                baseClass.details.typeParameters.length > 0
            ) {
                const specializedDestBaseClass = specializeForBaseClass(destType, baseClass);
                const specializedSrcBaseClass = specializeForBaseClass(srcType, baseClass);
                if (
                    !canAssignProtocolClassToSelf(specializedDestBaseClass, specializedSrcBaseClass, recursionCount + 1)
                ) {
                    isAssignable = false;
                }
            }
        });

        return isAssignable;
    }

    function canAssignTypedDict(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        recursionCount: number
    ) {
        let typesAreConsistent = true;
        const destEntries = getTypedDictMembersForClass(destType);
        const srcEntries = getTypedDictMembersForClass(srcType, /* allowNarrowed */ true);

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
        reportErrorsUsingObjType: boolean,
        allowMetaclassForProtocols = false
    ): boolean {
        // Handle typed dicts. They also use a form of structural typing for type
        // checking, as defined in PEP 589.
        if (ClassType.isTypedDictClass(destType) && ClassType.isTypedDictClass(srcType)) {
            return canAssignTypedDict(destType, srcType, diag, recursionCount);
        }

        // Handle special-case type promotions.
        const promotionList = typePromotions[destType.details.fullName];
        if (promotionList && promotionList.some((srcName) => srcName === srcType.details.fullName)) {
            if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
                return true;
            }
        }

        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        const inheritanceChain: InheritanceChain = [];
        const isDerivedFrom = ClassType.isDerivedFrom(srcType, destType, inheritanceChain);

        // Use the slow path for protocols if the dest doesn't explicitly
        // derive from the source. We also need to use this path if we're
        // testing to see if the metaclass matches the protocol.
        if (ClassType.isProtocolClass(destType) && (!isDerivedFrom || allowMetaclassForProtocols)) {
            return canAssignClassToProtocol(
                destType,
                srcType,
                diag,
                typeVarMap,
                flags,
                allowMetaclassForProtocols,
                recursionCount + 1
            );
        }

        if ((flags & CanAssignFlags.EnforceInvariance) === 0 || ClassType.isSameGenericClass(srcType, destType)) {
            if (isDerivedFrom) {
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

        // Everything is assignable to an object.
        if (ClassType.isBuiltIn(destType, 'object')) {
            if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
                return true;
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
        let curTypeVarMap = typeVarMap || new TypeVarMap(getTypeVarScopeId(destType));
        let effectiveFlags = flags;

        // If we're using a private typeVarMap, don't skip solving type vars.
        if (!typeVarMap) {
            effectiveFlags &= ~CanAssignFlags.SkipSolveTypeVars;
        }

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
                curSrcType = specializeForBaseClass(curSrcType, ancestorType);
            }

            // Do we need to do special-case processing for various built-in classes?
            if (ancestorIndex === 0) {
                // Handle built-in types that support arbitrary numbers
                // of type parameters like Tuple.
                if (ClassType.isTupleClass(destType)) {
                    if (destType.tupleTypeArguments && curSrcType.tupleTypeArguments) {
                        const destTypeArgs = destType.tupleTypeArguments;
                        let destArgCount = destTypeArgs.length;

                        const isDestHomogenousType = destArgCount === 2 && isEllipsisType(destTypeArgs[1]);
                        if (isDestHomogenousType) {
                            destArgCount = 1;
                        }

                        const isDestVariadic = destArgCount > 0 && isVariadicTypeVar(destTypeArgs[destArgCount - 1]);

                        const srcTypeArgs = curSrcType.tupleTypeArguments;
                        let srcArgCount = srcTypeArgs.length;
                        const isSrcHomogeneousType = srcArgCount === 2 && isEllipsisType(srcTypeArgs[1]);
                        if (isSrcHomogeneousType) {
                            srcArgCount = 1;
                        }

                        if (isDestVariadic && isSrcHomogeneousType) {
                            diag.addMessage(Localizer.DiagnosticAddendum.typeVarTupleRequiresKnownLength());
                            return false;
                        }

                        if (
                            (srcTypeArgs.length === destArgCount && !isSrcHomogeneousType) ||
                            isDestHomogenousType ||
                            isDestVariadic
                        ) {
                            const maxArgCount = Math.max(destArgCount, srcArgCount);
                            for (let argIndex = 0; argIndex < maxArgCount; argIndex++) {
                                let srcTypeArgType: Type;
                                let destTypeArgType: Type;
                                let isSourceTypeMissing = false;

                                if (isSrcHomogeneousType) {
                                    srcTypeArgType = srcTypeArgs[0];
                                } else if (argIndex < srcTypeArgs.length) {
                                    srcTypeArgType = srcTypeArgs[argIndex];
                                } else {
                                    srcTypeArgType = AnyType.create();
                                    if (destType.isTypeArgumentExplicit) {
                                        if (isDestVariadic && argIndex < destArgCount - 1 && !isDestHomogenousType) {
                                            isSourceTypeMissing = true;
                                        }
                                    }
                                }

                                let movePastSourceArgs = false;
                                if (isDestVariadic && argIndex >= destArgCount - 1) {
                                    destTypeArgType = destTypeArgs[destArgCount - 1];
                                    if (tupleClassType && isClass(tupleClassType)) {
                                        // Package up the remaining type arguments into a tuple object.
                                        const remainingSrcTypeArgs = srcTypeArgs.slice(argIndex);
                                        srcTypeArgType = convertToInstance(
                                            specializeTupleClass(
                                                tupleClassType,
                                                remainingSrcTypeArgs.map((type) => stripLiteralValue(type)),
                                                /* isTypeArgumentExplicit */ true,
                                                /* stripLiterals */ true,
                                                /* isForUnpackedVariadicTypeVar */ true
                                            )
                                        );
                                        movePastSourceArgs = true;
                                    }
                                } else if (isDestHomogenousType) {
                                    destTypeArgType = destTypeArgs[0];
                                } else {
                                    destTypeArgType =
                                        argIndex < destTypeArgs.length ? destTypeArgs[argIndex] : AnyType.create();
                                }

                                const entryDiag = diag.createAddendum();

                                if (
                                    isSourceTypeMissing ||
                                    !canAssignType(
                                        destTypeArgType,
                                        srcTypeArgType,
                                        entryDiag.createAddendum(),
                                        curTypeVarMap,
                                        effectiveFlags,
                                        recursionCount + 1
                                    )
                                ) {
                                    entryDiag.addMessage(
                                        Localizer.DiagnosticAddendum.tupleEntryTypeMismatch().format({
                                            entry: argIndex + 1,
                                        })
                                    );
                                    return false;
                                }

                                if (movePastSourceArgs) {
                                    argIndex = srcArgCount;
                                }
                            }
                        } else {
                            if (isSrcHomogeneousType) {
                                diag.addMessage(
                                    Localizer.DiagnosticAddendum.tupleSizeMismatchIndeterminate().format({
                                        expected: destArgCount,
                                    })
                                );
                            } else {
                                diag.addMessage(
                                    Localizer.DiagnosticAddendum.tupleSizeMismatch().format({
                                        expected: destArgCount,
                                        received: srcTypeArgs.length,
                                    })
                                );
                            }
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
            if (!ancestorType.typeArguments) {
                return true;
            }

            // Validate that the type arguments match.
            if (
                !verifyTypeArgumentsAssignable(
                    ancestorType,
                    curSrcType,
                    diag,
                    curTypeVarMap,
                    effectiveFlags,
                    recursionCount
                )
            ) {
                return false;
            }

            // Allocate a new type var map for the next time through the loop.
            curTypeVarMap = new TypeVarMap(getTypeVarScopeId(ancestorType));
            effectiveFlags &= ~CanAssignFlags.SkipSolveTypeVars;
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
            const srcTypeArgs = curSrcType.typeArguments;
            for (let i = 0; i < destType.details.typeParameters.length; i++) {
                const typeArgType = i < srcTypeArgs.length ? srcTypeArgs[i] : UnknownType.create();
                typeVarMap.setTypeVarType(destType.details.typeParameters[i], undefined, typeArgType);
            }

            if (
                ClassType.isTupleClass(curSrcType) &&
                curSrcType.tupleTypeArguments &&
                destType.details.typeParameters.length >= 1
            ) {
                typeVarMap.setVariadicTypeVar(destType.details.typeParameters[0], curSrcType.tupleTypeArguments);
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
            if (fgetType && isFunction(fgetType)) {
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
        let destTypeArgs: Type[];
        let srcTypeArgs: Type[] | undefined;

        // If either source or dest type arguments are missing, they are
        // treated as "Any", so they are assumed to be assignable.
        if (!destType.typeArguments || !srcType.typeArguments) {
            return true;
        }

        if (ClassType.isTupleClass(destType)) {
            destTypeArgs = destType.tupleTypeArguments || [];
            srcTypeArgs = srcType.tupleTypeArguments;
        } else {
            destTypeArgs = destType.typeArguments!;
            srcTypeArgs = srcType.typeArguments;
        }

        if (srcTypeArgs && srcType.isTypeArgumentExplicit) {
            for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                const srcTypeArg = srcTypeArgs[srcArgIndex];

                // In most cases, the number of type args should match the number
                // of type arguments, but there are a few special cases where this
                // isn't true (e.g. assigning a Tuple[X, Y, Z] to a tuple[W]).
                const destArgIndex = srcArgIndex >= destTypeArgs.length ? destTypeArgs.length - 1 : srcArgIndex;
                const destTypeArg = destArgIndex >= 0 ? destTypeArgs[destArgIndex] : UnknownType.create();
                const destTypeParam = destArgIndex < destTypeParams.length ? destTypeParams[destArgIndex] : undefined;
                const assignmentDiag = new DiagnosticAddendum();

                if (!destTypeParam || destTypeParam.details.variance === Variance.Covariant) {
                    if (
                        !canAssignType(destTypeArg, srcTypeArg, assignmentDiag, typeVarMap, flags, recursionCount + 1)
                    ) {
                        if (destTypeParam) {
                            const childDiag = diag.createAddendum();
                            childDiag.addMessage(
                                Localizer.DiagnosticAddendum.typeVarIsCovariant().format({
                                    name: TypeVarType.getReadableName(destTypeParam),
                                })
                            );
                            childDiag.addAddendum(assignmentDiag);
                        }
                        return false;
                    }
                } else if (destTypeParam.details.variance === Variance.Contravariant) {
                    if (
                        !canAssignType(
                            srcTypeArg,
                            destTypeArg,
                            assignmentDiag,
                            typeVarMap,
                            flags ^ CanAssignFlags.ReverseTypeVarMatching,
                            recursionCount + 1
                        )
                    ) {
                        const childDiag = diag.createAddendum();
                        childDiag.addMessage(
                            Localizer.DiagnosticAddendum.typeVarIsContravariant().format({
                                name: TypeVarType.getReadableName(destTypeParam),
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
                                name: TypeVarType.getReadableName(destTypeParam),
                            })
                        );
                        childDiag.addAddendum(assignmentDiag);
                        return false;
                    }
                }
            }
        }

        return true;
    }

    // Assigns the source type to the dest type var in the type map. If an existing type is
    // already associated with that type var name, it attempts to either widen or narrow
    // the type (depending on the value of the isContravariant parameter). The goal is to
    // produce the narrowest type that meets all of the requirements. If the type var map
    // has been "locked", it simply validates that the srcType is compatible (with no attempt
    // to widen or narrow).
    function canAssignTypeToTypeVar(
        destType: TypeVarType,
        srcType: Type,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap,
        flags = CanAssignFlags.Default,
        recursionCount = 0
    ): boolean {
        let isTypeVarInScope = true;
        const isContravariant = (flags & CanAssignFlags.ReverseTypeVarMatching) !== 0;

        // If the TypeVar doesn't have a scope ID, then it's being used
        // outside of a valid TypeVar scope. This will be reported as a
        // separate error. Just ignore this case to avoid redundant errors.
        if (!destType.scopeId) {
            return true;
        }

        // Verify that we are solving for the scope associated with this
        // type variable.
        if (!typeVarMap.hasSolveForScope(destType.scopeId)) {
            if (isAnyOrUnknown(srcType)) {
                return true;
            }

            isTypeVarInScope = false;
            if (!destType.details.isSynthesized) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                        sourceType: printType(srcType),
                        destType: printType(destType),
                    })
                );
                return false;
            }
        }

        if (destType.details.isParamSpec) {
            if (isTypeVar(srcType) && srcType.details.isParamSpec) {
                const existingEntry = typeVarMap.getParamSpec(destType);
                if (existingEntry) {
                    if (!existingEntry.parameters && existingEntry.paramSpec) {
                        // If there's an existing entry that matches, that's fine.
                        if (isTypeSame(existingEntry.paramSpec, srcType)) {
                            return true;
                        }
                    }
                } else {
                    typeVarMap.setParamSpec(destType, { paramSpec: srcType });
                    return true;
                }
            }

            diag.addMessage(
                Localizer.DiagnosticAddendum.typeParamSpec().format({
                    type: printType(srcType),
                    name: destType.details.name,
                })
            );
            return false;
        }

        if (destType.details.isVariadic) {
            const isVariadicTuple =
                isObject(srcType) &&
                isTupleClass(srcType.classType) &&
                !!srcType.classType.isTupleForUnpackedVariadicTypeVar;

            if (!isVariadicTypeVar(srcType) && !isVariadicTuple) {
                if (tupleClassType && isClass(tupleClassType)) {
                    // Package up the type into a tuple.
                    srcType = convertToInstance(
                        specializeTupleClass(
                            tupleClassType,
                            [srcType],
                            /* isTypeArgumentExplicit */ true,
                            /* stripLiterals */ true,
                            /* isForUnpackedVariadicTypeVar */ true
                        )
                    );
                } else {
                    srcType = UnknownType.create();
                }
            }
        }

        const curEntry = typeVarMap.getTypeVar(destType);
        const curNarrowTypeBound = curEntry?.narrowBound;
        const curWideTypeBound = curEntry?.wideBound;

        // Handle the constrained case. This case needs to be handled specially
        // because type narrowing isn't used in this case. For example, if the
        // source type is "Literal[1]" and the constraint list includes the type
        // "float", the resulting type is float.
        if (destType.details.constraints.length > 0) {
            let constrainedType: Type | undefined;
            const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

            if (isTypeVar(srcType)) {
                if (
                    canAssignType(destType, concreteSrcType, new DiagnosticAddendum(), new TypeVarMap(destType.scopeId))
                ) {
                    constrainedType = srcType;
                }
            } else {
                let isCompatible = true;

                // Find the narrowest constrained type that is compatible.
                constrainedType = mapSubtypes(concreteSrcType, (srcSubtype) => {
                    let constrainedSubtype: Type | undefined;

                    if (isAnyOrUnknown(srcSubtype)) {
                        return srcSubtype;
                    }

                    destType.details.constraints.forEach((t) => {
                        if (canAssignType(t, srcSubtype, new DiagnosticAddendum())) {
                            if (!constrainedSubtype || canAssignType(constrainedSubtype, t, new DiagnosticAddendum())) {
                                constrainedSubtype = t;
                            }
                        }
                    });

                    if (!constrainedSubtype) {
                        // We found a source subtype that is not compatible with the dest.
                        // This is OK if we're handling the contravariant case because only
                        // one subtype needs to be assignable in that case.
                        if (!isContravariant) {
                            isCompatible = false;
                        }
                    }

                    return constrainedSubtype;
                });

                if (isNever(constrainedType) || !isCompatible) {
                    constrainedType = undefined;
                }
            }

            // If there was no constrained type that was assignable
            // or there were multiple constrained types that were assignable,
            // it's an error.
            if (!constrainedType || (isUnion(constrainedType) && !constrainedType.constraints)) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                        type: printType(srcType),
                        name: destType.details.name,
                    })
                );
                return false;
            }

            if (curNarrowTypeBound && !isAnyOrUnknown(curNarrowTypeBound)) {
                if (!canAssignType(curNarrowTypeBound, constrainedType, new DiagnosticAddendum())) {
                    // Handle the case where one of the constrained types is a wider
                    // version of another constrained type that was previously assigned
                    // to the type variable.
                    if (canAssignType(constrainedType, curNarrowTypeBound, new DiagnosticAddendum())) {
                        if (!typeVarMap.isLocked() && isTypeVarInScope) {
                            typeVarMap.setTypeVarType(destType, constrainedType);
                        }
                    } else {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                                type: printType(constrainedType),
                                name: printType(curNarrowTypeBound),
                            })
                        );
                        return false;
                    }
                }
            } else {
                // Assign the type to the type var.
                if (!typeVarMap.isLocked() && isTypeVarInScope) {
                    typeVarMap.setTypeVarType(destType, constrainedType);
                }
            }

            return true;
        }

        // Handle the unconstrained (but possibly bound) case.
        let newNarrowTypeBound = curNarrowTypeBound;
        let newWideTypeBound = curWideTypeBound;
        const diagAddendum = new DiagnosticAddendum();

        // Strip literals if the existing value contains no literals. This allows
        // for explicit (but no implicit) literal specialization of a generic class.
        const retainLiterals =
            (flags & CanAssignFlags.RetainLiteralsForTypeVar) !== 0 ||
            typeVarMap.getRetainLiterals(destType) ||
            (destType.details.boundType && containsLiteralType(destType.details.boundType)) ||
            destType.details.constraints.some((t) => containsLiteralType(t));
        const adjSrcType = retainLiterals ? srcType : stripLiteralValue(srcType);

        if (isContravariant || (flags & CanAssignFlags.AllowTypeVarNarrowing) !== 0) {
            // Update the wide type bound.
            if (!curWideTypeBound) {
                newWideTypeBound = adjSrcType;
            } else if (!isTypeSame(curWideTypeBound, adjSrcType)) {
                if (canAssignType(curWideTypeBound, adjSrcType, diagAddendum)) {
                    // The srcType is narrower than the current wideTypeBound, so replace it.
                    newWideTypeBound = srcType;
                } else if (!canAssignType(adjSrcType, curWideTypeBound, diagAddendum)) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(adjSrcType),
                            destType: printType(curWideTypeBound),
                        })
                    );
                    diag.addAddendum(diagAddendum);
                    return false;
                }
            }

            // Make sure we haven't narrowed it beyond the current narrow bound.
            if (curNarrowTypeBound) {
                if (!canAssignType(newWideTypeBound!, curNarrowTypeBound, new DiagnosticAddendum())) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(adjSrcType),
                            destType: printType(curNarrowTypeBound),
                        })
                    );
                    diag.addAddendum(diagAddendum);
                    return false;
                }
            }
        } else {
            if (!curNarrowTypeBound) {
                // There was previously no narrow bound. We've now established one.
                newNarrowTypeBound = adjSrcType;
            } else if (!isTypeSame(curNarrowTypeBound, adjSrcType)) {
                if (
                    canAssignType(curNarrowTypeBound, adjSrcType, diagAddendum, typeVarMap, flags, recursionCount + 1)
                ) {
                    // No need to widen. Stick with the existing type unless it's unknown
                    // or partly unknown, in which case we'll replace it with a known type
                    // as long as it doesn't violate the current narrow bound.
                    if (
                        isPartlyUnknown(curNarrowTypeBound) &&
                        canAssignType(
                            adjSrcType,
                            curNarrowTypeBound,
                            new DiagnosticAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        )
                    ) {
                        newNarrowTypeBound = adjSrcType;
                    } else {
                        newNarrowTypeBound = curNarrowTypeBound;
                    }
                } else {
                    // We need to widen the type.
                    if (typeVarMap.isLocked() || isTypeVar(adjSrcType)) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                                sourceType: printType(curNarrowTypeBound),
                                destType: printType(adjSrcType),
                            })
                        );
                        return false;
                    }

                    // Don't allow widening for variadic type variables.
                    if (isVariadicTypeVar(destType)) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                                sourceType: printType(curNarrowTypeBound),
                                destType: printType(adjSrcType),
                            })
                        );
                        return false;
                    }

                    if (
                        canAssignType(
                            adjSrcType,
                            curNarrowTypeBound,
                            new DiagnosticAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        )
                    ) {
                        newNarrowTypeBound = adjSrcType;
                    } else {
                        // In some extreme edge cases, the narrow type bound can become
                        // a union with so many subtypes that performance grinds to a
                        // halt. We'll detect this case and widen the resulting type
                        // to an 'object' instead of making the union even bigger. This
                        // is still a valid solution to the TypeVar.
                        if (
                            isUnion(curNarrowTypeBound) &&
                            curNarrowTypeBound.subtypes.length > maxSubtypesForInferredType &&
                            (destType as TypeVarType).details.boundType !== undefined &&
                            objectType &&
                            isObject(objectType)
                        ) {
                            newNarrowTypeBound = combineTypes([curNarrowTypeBound, objectType]);
                        } else {
                            newNarrowTypeBound = combineTypes([curNarrowTypeBound, adjSrcType]);
                        }
                    }
                }
            }

            // Make sure we don't exceed the wide type bound.
            if (curWideTypeBound) {
                if (
                    !canAssignType(
                        makeTopLevelTypeVarsConcrete(curWideTypeBound),
                        newNarrowTypeBound!,
                        new DiagnosticAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    )
                ) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format({
                            sourceType: printType(curWideTypeBound),
                            destType: printType(adjSrcType),
                        })
                    );
                    return false;
                }
            }
        }

        // If there's a bound type, make sure the source is assignable to it.
        if (destType.details.boundType) {
            const boundType = TypeBase.isInstantiable(destType)
                ? convertToInstantiable(destType.details.boundType)
                : destType.details.boundType;
            const updatedType = (newNarrowTypeBound || newWideTypeBound)!;
            const adjustedUpdatedType =
                isTypeVar(srcType) && TypeBase.isInstantiable(srcType)
                    ? convertToInstantiable(updatedType)
                    : updatedType;
            if (
                !canAssignType(
                    boundType,
                    adjustedUpdatedType,
                    diag.createAddendum(),
                    typeVarMap,
                    CanAssignFlags.Default,
                    recursionCount + 1
                )
            ) {
                // Avoid adding a message that will confuse users if the TypeVar was
                // synthesized for internal purposes.
                if (!destType.details.isSynthesized) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeBound().format({
                            sourceType: printType(adjustedUpdatedType),
                            destType: printType(boundType),
                            name: TypeVarType.getReadableName(destType),
                        })
                    );
                }
                return false;
            }
        }

        if (!typeVarMap.isLocked() && isTypeVarInScope) {
            typeVarMap.setTypeVarType(destType, newNarrowTypeBound, newWideTypeBound, retainLiterals);
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

        // If this is a one-element union that contains a variadic type variable,
        // pull out the subtype.
        if (isUnion(destType) && destType.subtypes.length === 1 && isVariadicTypeVar(destType.subtypes[0])) {
            destType = destType.subtypes[0];
        }

        if (isUnion(srcType) && srcType.subtypes.length === 1 && isVariadicTypeVar(srcType.subtypes[0])) {
            srcType = srcType.subtypes[0];
        }

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

        // Strip a few of the flags we don't want to propagate to other calls.
        const originalFlags = flags;
        flags &= ~(CanAssignFlags.AllowBoolTypeGuard | CanAssignFlags.AllowTypeVarNarrowing);

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (isTypeVar(destType)) {
            // If it's an exact match, no need to do any more work.
            if (isTypeSame(destType, srcType)) {
                return true;
            }

            // If the dest is a constrained type variable and all of the types in
            // the source are constrained using that same type variable and have
            // compatible types, we'll consider it assignable.
            const destTypeVar = destType;
            if (destTypeVar.details.constraints.length > 0) {
                if (
                    findSubtype(srcType, (srcSubtype, constraints) => {
                        if (isTypeSame(destTypeVar, srcSubtype)) {
                            return false;
                        }

                        if (
                            constraints?.find(
                                (constraint) => constraint.typeVarName === TypeVarType.getNameWithScope(destTypeVar)
                            )
                        ) {
                            if (
                                destTypeVar.details.constraints.some((constraintType) => {
                                    return canAssignType(constraintType, srcSubtype, new DiagnosticAddendum());
                                })
                            ) {
                                return false;
                            }
                        }

                        return true;
                    }) === undefined
                ) {
                    return true;
                }
            }

            // If the dest is a variadic type variable, and the source is a tuple
            // with a single entry that is the same variadic type variable, it's a match.
            if (
                isVariadicTypeVar(destTypeVar) &&
                isObject(srcType) &&
                isTupleClass(srcType.classType) &&
                srcType.classType.tupleTypeArguments &&
                srcType.classType.tupleTypeArguments.length === 1
            ) {
                if (isTypeSame(destTypeVar, srcType.classType.tupleTypeArguments[0])) {
                    return true;
                }
            }

            if ((flags & CanAssignFlags.ReverseTypeVarMatching) === 0) {
                if (flags & CanAssignFlags.SkipSolveTypeVars) {
                    return canAssignType(
                        makeTopLevelTypeVarsConcrete(destType),
                        makeTopLevelTypeVarsConcrete(srcType),
                        diag,
                        /* typeVarMap */ undefined,
                        flags,
                        recursionCount + 1
                    );
                } else {
                    return canAssignTypeToTypeVar(
                        destType,
                        srcType,
                        diag,
                        typeVarMap || new TypeVarMap(),
                        originalFlags,
                        recursionCount + 1
                    );
                }
            }
        }

        if (isTypeVar(srcType)) {
            if ((flags & CanAssignFlags.ReverseTypeVarMatching) !== 0) {
                if ((flags & CanAssignFlags.SkipSolveTypeVars) !== 0) {
                    return canAssignType(
                        makeTopLevelTypeVarsConcrete(srcType),
                        makeTopLevelTypeVarsConcrete(destType),
                        diag,
                        /* typeVarMap */ undefined,
                        flags,
                        recursionCount + 1
                    );
                } else {
                    return canAssignTypeToTypeVar(
                        srcType,
                        destType,
                        diag,
                        typeVarMap || new TypeVarMap(getTypeVarScopeId(srcType)),
                        originalFlags,
                        recursionCount + 1
                    );
                }
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

        if (isUnion(srcType)) {
            // Start by checking for an exact match. This is needed to handle unions
            // that contain recursive type aliases.
            if (isTypeSame(srcType, destType)) {
                return true;
            }

            // Handle the case where the source and dest are both unions and
            // invariance is being enforced and the dest contains a type variable.
            // In this case, the non-matched subtypes in the source will get assigned
            // to the remaining type variable.
            if (flags & CanAssignFlags.EnforceInvariance) {
                if (
                    isUnion(destType) &&
                    destType.subtypes.some((t) => isTypeVar(t) && !t.details.recursiveTypeAliasName)
                ) {
                    const remainingDestSubtypes: Type[] = [...destType.subtypes];
                    const remainingSrcSubtypes: Type[] = [];

                    srcType.subtypes.forEach((srcSubtype) => {
                        const destIndex = remainingDestSubtypes.findIndex((t) => isTypeSame(t, srcSubtype));
                        if (destIndex >= 0) {
                            remainingDestSubtypes.splice(destIndex, 1);
                        } else {
                            remainingSrcSubtypes.push(srcSubtype);
                        }
                    });

                    if (remainingDestSubtypes.length === 1) {
                        const remainingDestType = remainingDestSubtypes[0];
                        if (isTypeVar(remainingDestType) && !remainingDestType.details.recursiveTypeAliasName) {
                            return canAssignType(
                                remainingDestSubtypes[0],
                                combineTypes(remainingSrcSubtypes),
                                diag.createAddendum(),
                                typeVarMap,
                                flags,
                                recursionCount + 1
                            );
                        }
                    }
                }
            }

            let isIncompatible = false;

            // For union sources, all of the types need to be assignable to the dest.
            doForEachSubtype(srcType, (subtype) => {
                if (
                    !canAssignType(destType, subtype, new DiagnosticAddendum(), typeVarMap, flags, recursionCount + 1)
                ) {
                    // That didn't work, so try again with concrete versions.
                    if (
                        !canAssignType(
                            destType,
                            makeTopLevelTypeVarsConcrete(subtype),
                            diag.createAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        )
                    ) {
                        isIncompatible = true;
                    }
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

        if (isUnion(destType)) {
            // If we need to enforce invariance, the source needs to be compatible
            // with all subtypes in the dest, unless those subtypes are subclasses
            // of other subtypes.
            if (flags & CanAssignFlags.EnforceInvariance) {
                let isIncompatible = false;

                doForEachSubtype(destType, (subtype, index) => {
                    // First determine whether this subtype is assignable to
                    // another subtype elsewhere in the union. If so, we'll skip
                    // this one.
                    let skipSubtype = false;

                    if (!isAnyOrUnknown(subtype)) {
                        doForEachSubtype(destType, (otherSubtype, otherIndex) => {
                            if (index !== otherIndex && !skipSubtype) {
                                if (
                                    canAssignType(
                                        otherSubtype,
                                        subtype,
                                        new DiagnosticAddendum(),
                                        /* typeVarMap */ undefined,
                                        CanAssignFlags.Default,
                                        recursionCount + 1
                                    )
                                ) {
                                    skipSubtype = true;
                                }
                            }
                        });
                    }

                    if (
                        !skipSubtype &&
                        !canAssignType(subtype, srcType, diag.createAddendum(), typeVarMap, flags, recursionCount + 1)
                    ) {
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

            // For union destinations, we just need to match one of the types.
            const diagAddendum = new DiagnosticAddendum();

            let foundMatch = false;
            // Run through all subtypes in the union. Don't stop at the first
            // match we find because we may need to match TypeVars in other
            // subtypes. We special-case "None" so we can handle Optional[T]
            // without matching the None to the type var.
            if (isNone(srcType) && isOptionalType(destType)) {
                foundMatch = true;
            } else {
                let bestTypeVarMap: TypeVarMap | undefined;
                let bestTypeVarMapScore: number | undefined;

                doForEachSubtype(destType, (subtype) => {
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

            // If the source is a constrained TypeVar, see if we can assign all of the
            // constraints to the union.
            if (!foundMatch) {
                if (isTypeVar(srcType) && srcType.details.constraints.length > 0) {
                    foundMatch = canAssignType(
                        destType,
                        makeTopLevelTypeVarsConcrete(srcType),
                        diagAddendum,
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    );
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

        if (isNone(destType) && isNone(srcType)) {
            return true;
        }

        // Is the src a specialized "Type" object?
        if (isObject(srcType) && ClassType.isBuiltIn(srcType.classType, 'type')) {
            const srcTypeArgs = srcType.classType.typeArguments;
            if (srcTypeArgs && srcTypeArgs.length >= 1) {
                if (isAnyOrUnknown(srcTypeArgs[0])) {
                    return TypeBase.isInstantiable(transformTypeObjectToClass(destType));
                } else if (isObject(srcTypeArgs[0]) || isTypeVar(srcTypeArgs[0])) {
                    if (
                        canAssignType(
                            transformTypeObjectToClass(destType),
                            convertToInstantiable(srcTypeArgs[0]),
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
            const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);
            if (isClass(concreteSrcType)) {
                if (
                    canAssignClass(
                        destType,
                        concreteSrcType,
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

            // Is the dest a specialized "Type" object?
            if (ClassType.isBuiltIn(destClassType, 'Type')) {
                const destTypeArgs = destClassType.typeArguments;
                if (destTypeArgs && destTypeArgs.length >= 1) {
                    const convertedSrc = transformTypeObjectToClass(srcType);
                    if (TypeBase.isInstance(destTypeArgs[0]) && TypeBase.isInstantiable(convertedSrc)) {
                        return canAssignType(
                            destTypeArgs[0],
                            convertToInstance(convertedSrc),
                            diag,
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        );
                    }
                }
            } else if (ClassType.isBuiltIn(destClassType, 'type')) {
                // Is the dest a "type" object? Assume that all instantiable
                // types are assignable to "type".
                if (TypeBase.isInstantiable(srcType)) {
                    return true;
                }
            } else if (ClassType.isBuiltIn(destClassType, 'TypeGuard')) {
                // All the source to be a "bool".
                if ((originalFlags & CanAssignFlags.AllowBoolTypeGuard) !== 0) {
                    if (isObject(srcType) && ClassType.isBuiltIn(srcType.classType, 'bool')) {
                        return true;
                    }
                }
            }

            const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);
            if (isObject(concreteSrcType)) {
                if (destType.classType.literalValue !== undefined) {
                    const srcLiteral = concreteSrcType.classType.literalValue;
                    if (
                        srcLiteral === undefined ||
                        !ClassType.isLiteralValueSame(concreteSrcType.classType, destType.classType)
                    ) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.literalAssignmentMismatch().format({
                                sourceType: printType(srcType),
                                destType: printType(destType),
                            })
                        );

                        return false;
                    }
                }

                if (
                    !canAssignClass(
                        destClassType,
                        concreteSrcType.classType,
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
            } else if (isFunction(concreteSrcType)) {
                // Is the destination a callback protocol (defined in PEP 544)?
                const callbackType = getCallbackProtocolType(destType);
                if (callbackType) {
                    return canAssignFunction(
                        callbackType,
                        concreteSrcType,
                        diag,
                        typeVarMap || new TypeVarMap(),
                        flags,
                        recursionCount + 1
                    );
                }

                // All functions are objects, so try to assign as an object.
                if (objectType && isObject(objectType)) {
                    return canAssignType(destType, objectType, diag, typeVarMap, flags, recursionCount + 1);
                }
            } else if (isModule(concreteSrcType)) {
                // Is the destination the built-in "ModuleType"?
                if (ClassType.isBuiltIn(destClassType, 'ModuleType')) {
                    return true;
                }

                if (ClassType.isProtocolClass(destType.classType)) {
                    return canAssignModuleToProtocol(
                        destType.classType,
                        concreteSrcType,
                        diag,
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    );
                }
            } else if (isClass(concreteSrcType)) {
                // See if the destType is an instantiation of a Protocol
                // class that is effectively a function.
                const callbackType = getCallbackProtocolType(destType);
                if (callbackType) {
                    return canAssignType(callbackType, concreteSrcType, diag, typeVarMap, flags, recursionCount + 1);
                }

                // Determine if the metaclass can be assigned to the object.
                const metaclass = concreteSrcType.details.effectiveMetaclass;
                if (metaclass) {
                    if (isAnyOrUnknown(metaclass)) {
                        return true;
                    } else {
                        return canAssignClass(
                            destClassType,
                            ClassType.isProtocolClass(destClassType) ? concreteSrcType : metaclass,
                            diag,
                            typeVarMap,
                            flags,
                            recursionCount + 1,
                            /* reportErrorsUsingObjType */ false,
                            /* allowMetaclassForProtocols */ true
                        );
                    }
                }
            } else if (isAnyOrUnknown(concreteSrcType)) {
                return (flags & CanAssignFlags.DisallowAssignFromAny) === 0;
            } else if (isUnion(concreteSrcType)) {
                return canAssignType(destType, concreteSrcType, diag, typeVarMap, flags, recursionCount + 1);
            }
        }

        if (isFunction(destType)) {
            let srcFunction: FunctionType | undefined;
            let concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

            if (isObject(concreteSrcType)) {
                const callMember = lookUpObjectMember(concreteSrcType, '__call__');
                if (callMember) {
                    const memberType = getTypeOfMember(callMember);
                    if (isFunction(memberType) || isOverloadedFunction(memberType)) {
                        const boundMethod = bindFunctionToClassOrObject(concreteSrcType, memberType);
                        if (boundMethod) {
                            concreteSrcType = boundMethod;
                        }
                    }
                }
            }

            if (isOverloadedFunction(concreteSrcType)) {
                // Overloads are not compatible with ParamSpec.
                if (destType.details.paramSpec) {
                    diag.addMessage(Localizer.DiagnosticAddendum.paramSpecOverload());
                    return false;
                }

                // Find first overloaded function that matches the parameters.
                // We don't want to pollute the current typeVarMap, so we'll
                // make a copy of the existing one if it's specified.
                const overloads = concreteSrcType.overloads;
                const overloadIndex = overloads.findIndex((overload) => {
                    if (!FunctionType.isOverloaded(overload)) {
                        return false;
                    }
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
            } else if (isFunction(concreteSrcType)) {
                srcFunction = concreteSrcType;
            } else if (isClass(concreteSrcType) && concreteSrcType.literalValue === undefined) {
                // Synthesize a function that represents the constructor for this class.
                const constructorFunction = FunctionType.createInstance(
                    '__init__',
                    '',
                    '',
                    FunctionTypeFlags.StaticMethod |
                        FunctionTypeFlags.ConstructorMethod |
                        FunctionTypeFlags.SynthesizedMethod
                );
                constructorFunction.details.declaredReturnType = ObjectType.create(concreteSrcType);

                let constructorInfo = lookUpClassMember(
                    concreteSrcType,
                    '__init__',
                    ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                );

                if (!constructorInfo) {
                    constructorInfo = lookUpClassMember(
                        concreteSrcType,
                        '__new__',
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                    );
                }

                const constructorType = constructorInfo ? getTypeOfMember(constructorInfo) : undefined;
                if (constructorType && isFunction(constructorType)) {
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
            } else if (isAnyOrUnknown(concreteSrcType)) {
                return (flags & CanAssignFlags.DisallowAssignFromAny) === 0;
            }

            if (srcFunction) {
                if (
                    canAssignFunction(
                        destType,
                        srcFunction,
                        diag.createAddendum(),
                        typeVarMap || new TypeVarMap(),
                        flags,
                        recursionCount + 1
                    )
                ) {
                    return true;
                }
            }
        }

        if (isOverloadedFunction(destType)) {
            const overloadDiag = diag.createAddendum();

            // All overloads in the dest must be assignable.
            const isAssignable = !destType.overloads.some((destOverload) => {
                if (!FunctionType.isOverloaded(destOverload)) {
                    return false;
                }

                if (typeVarMap) {
                    typeVarMap.addSolveForScope(getTypeVarScopeId(destOverload));
                }

                return !canAssignType(
                    destOverload,
                    srcType,
                    overloadDiag.createAddendum(),
                    typeVarMap || new TypeVarMap(getTypeVarScopeId(destOverload)),
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

        if (isObject(destType) && ClassType.isBuiltIn(destType.classType, 'object')) {
            if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
                // All types (including None, Module, OverloadedFunction) derive from object.
                return true;
            }
        }

        // Are we trying to assign None to a protocol?
        if (isNone(srcType) && isObject(destType) && ClassType.isProtocolClass(destType.classType)) {
            if (noneType && isClass(noneType)) {
                return canAssignClassToProtocol(
                    destType.classType,
                    noneType,
                    diag,
                    typeVarMap,
                    flags,
                    /* allowMetaclassForProtocols */ false,
                    recursionCount + 1
                );
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
        if (isFunction(memberType)) {
            const boundMethod = bindFunctionToClassOrObject(objType, memberType);

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
        destTypeVarMap: TypeVarMap,
        srcTypeVarMap: TypeVarMap,
        flags: CanAssignFlags,
        recursionCount: number
    ) {
        // Handle the special case where the dest type is a synthesized
        // "self" for a protocol class.
        if (
            isTypeVar(destType) &&
            destType.details.isSynthesized &&
            destType.details.boundType &&
            isObject(destType.details.boundType) &&
            ClassType.isProtocolClass(destType.details.boundType.classType)
        ) {
            return true;
        }

        // Call canAssignType once to perform any typeVarMap population.
        canAssignType(
            srcType,
            destType,
            new DiagnosticAddendum(),
            destTypeVarMap,
            flags ^ CanAssignFlags.ReverseTypeVarMatching,
            recursionCount + 1
        );

        // Make sure we can assign the specialized dest type to the source type.
        const specializedDestType = applySolvedTypeVars(destType, destTypeVarMap);

        if (
            !canAssignType(
                srcType,
                specializedDestType,
                diag.createAddendum(),
                srcTypeVarMap,
                flags,
                recursionCount + 1
            )
        ) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.paramAssignment().format({
                    index: paramIndex + 1,
                    sourceType: printType(destType),
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
        typeVarMap: TypeVarMap,
        flags: CanAssignFlags,
        recursionCount: number
    ): boolean {
        let canAssign = true;
        const checkReturnType = (flags & CanAssignFlags.SkipFunctionReturnTypeCheck) === 0;
        flags &= ~CanAssignFlags.SkipFunctionReturnTypeCheck;

        const srcParams = srcType.details.parameters;
        const destParams = destType.details.parameters;

        let srcStartOfNamed = srcParams.findIndex(
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

        // Is there a *args parameter annotated with a TypeVarTuple?
        const destVariadicArgsList =
            destArgsIndex >= 0 && isVariadicTypeVar(destPositionals[destArgsIndex].type)
                ? destPositionals[destArgsIndex]
                : undefined;
        destPositionals = destPositionals.filter((p) => p.category === ParameterCategory.Simple && p.name);

        // Is there a simple (non-*args) parameter with a TypeVarTuple? If so,
        // we may need to pack zero or more source positionals into a tuple.
        const destVariadicParamIndex = destPositionals.findIndex(
            (p) => p.category === ParameterCategory.Simple && isVariadicTypeVar(p.type)
        );
        if (destVariadicParamIndex >= 0) {
            const srcPositionalsToPack = srcPositionals.slice(
                destVariadicParamIndex,
                destVariadicParamIndex + 1 + srcPositionals.length - destPositionals.length
            );

            // Don't try to pack *args parameters. They are not allowed to be matched against
            // a variadic type variable.
            if (srcArgsIndex < 0) {
                const srcTupleTypes: Type[] = srcPositionalsToPack.map((entry) => {
                    const srcParamIndex = srcParams.findIndex((p) => p === entry);
                    return FunctionType.getEffectiveParameterType(srcType, srcParamIndex);
                });

                if (srcTupleTypes.length !== 1 || !isVariadicTypeVar(srcTupleTypes[0])) {
                    let srcPositionalsType: Type;
                    if (tupleClassType && isClass(tupleClassType)) {
                        srcPositionalsType = convertToInstance(
                            specializeTupleClass(
                                tupleClassType,
                                srcTupleTypes,
                                /* isTypeArgumentExplicit */ true,
                                /* stripLiterals */ true,
                                /* isForUnpackedVariadicTypeVar */ true
                            )
                        );
                    } else {
                        srcPositionalsType = UnknownType.create();
                    }

                    // Snip out the portion of the source positionals that map to the variadic
                    // dest parameter and replace it with a single parameter that is typed as a
                    // tuple containing the individual types of the replaced parameters.
                    srcPositionals = [
                        ...srcPositionals.slice(0, destVariadicParamIndex),
                        {
                            category: ParameterCategory.Simple,
                            name: '_arg_combined',
                            isNameSynthesized: true,
                            hasDeclaredType: true,
                            type: srcPositionalsType,
                        },
                        ...srcPositionals.slice(
                            destVariadicParamIndex + 1 + srcPositionals.length - destPositionals.length,
                            srcPositionals.length
                        ),
                    ];
                }
            }
        }

        const positionalsToMatch = Math.min(srcPositionals.length, destPositionals.length);
        const srcTypeVarMap = new TypeVarMap(getTypeVarScopeId(srcType));

        const srcKwargsIndex = srcParams.findIndex((p) => p.category === ParameterCategory.VarArgDictionary && p.name);
        const destKwargsIndex = destParams.findIndex(
            (p) => p.category === ParameterCategory.VarArgDictionary && p.name
        );

        const srcPositionalOnlyIndex = srcParams.findIndex((p) => p.category === ParameterCategory.Simple && !p.name);
        const destPositionalOnlyIndex = destParams.findIndex((p) => p.category === ParameterCategory.Simple && !p.name);

        if (!FunctionType.shouldSkipParamCompatibilityCheck(destType)) {
            // Match positional parameters.
            for (let paramIndex = 0; paramIndex < positionalsToMatch; paramIndex++) {
                // Find the original index of this source param. If we synthesized it above (for
                // a variadic parameter), it may not be found.
                const srcParamIndex = srcParams.findIndex((p) => p === srcPositionals[paramIndex]);
                const srcParamType =
                    srcParamIndex >= 0
                        ? FunctionType.getEffectiveParameterType(srcType, srcParamIndex)
                        : srcPositionals[paramIndex].type;
                const destParamIndex = destParams.findIndex((p) => p === destPositionals[paramIndex]);
                const destParamType = FunctionType.getEffectiveParameterType(destType, destParamIndex);

                const destParamName = destPositionals[paramIndex].name;
                const srcParamName = srcPositionals[paramIndex].name || '';
                if (
                    destParamName &&
                    !isPrivateOrProtectedName(destParamName) &&
                    !isPrivateOrProtectedName(srcParamName)
                ) {
                    const isPositionalOnly =
                        srcPositionalOnlyIndex >= 0 &&
                        paramIndex < srcPositionalOnlyIndex &&
                        destPositionalOnlyIndex >= 0 &&
                        paramIndex < destPositionalOnlyIndex;
                    if (!isPositionalOnly && destParamName !== srcParamName) {
                        diag.createAddendum().addMessage(
                            Localizer.DiagnosticAddendum.functionParamName().format({
                                srcName: srcParamName,
                                destName: destParamName,
                            })
                        );
                        canAssign = false;
                    }
                }

                // Handle the special case of an overloaded __init__ method whose self
                // parameter is annotated.
                if (
                    paramIndex === 0 &&
                    srcType.details.name === '__init__' &&
                    FunctionType.isInstanceMethod(srcType) &&
                    destType.details.name === '__init__' &&
                    FunctionType.isInstanceMethod(destType) &&
                    FunctionType.isOverloaded(destType) &&
                    destPositionals[paramIndex].hasDeclaredType
                ) {
                    continue;
                }

                if (
                    !canAssignFunctionParameter(
                        destParamType,
                        srcParamType,
                        paramIndex,
                        diag.createAddendum(),
                        typeVarMap,
                        srcTypeVarMap,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }

            if (destVariadicArgsList) {
                // Package up the remaining source positional parameters
                // and assign them to the variadic.
                const remainingSrcPositionals = srcPositionals.slice(destPositionals.length).map((param) => param.type);
                let isSourceNonVariadicArgs = false;
                if (srcArgsIndex >= 0) {
                    const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
                    if (isVariadicTypeVar(srcArgsType)) {
                        remainingSrcPositionals.push(srcArgsType);
                    } else {
                        isSourceNonVariadicArgs = true;
                    }
                }

                let srcPositionalsType: Type;
                if (remainingSrcPositionals.length === 1 && isVariadicTypeVar(remainingSrcPositionals[0])) {
                    // Handle the special case where we're assigning a variadic type
                    // variable to a variadic type variable.
                    srcPositionalsType = remainingSrcPositionals[0];
                } else {
                    if (tupleClassType && isClass(tupleClassType)) {
                        srcPositionalsType = convertToInstance(
                            specializeTupleClass(
                                tupleClassType,
                                remainingSrcPositionals,
                                /* isTypeArgumentExplicit */ true,
                                /* stripLiterals */ true,
                                /* isForUnpackedVariadicTypeVar */ true
                            )
                        );
                    } else {
                        srcPositionalsType = UnknownType.create();
                    }
                }

                if (isSourceNonVariadicArgs) {
                    diag.createAddendum().addMessage(
                        Localizer.DiagnosticAddendum.argsParamWithVariadic().format({
                            paramName: srcParams[srcArgsIndex].name!,
                        })
                    );
                    canAssign = false;
                } else if (
                    !canAssignFunctionParameter(
                        FunctionType.getEffectiveParameterType(destType, destArgsIndex),
                        srcPositionalsType,
                        destArgsIndex,
                        diag.createAddendum(),
                        typeVarMap,
                        srcTypeVarMap,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            } else if (destPositionals.length < srcPositionals.length) {
                // If the dest type includes a ParamSpec, the additional parameters
                // can be assigned to it, so no need to report an error here.
                if (!destType.details.paramSpec) {
                    const nonDefaultSrcParamCount = srcParams.filter(
                        (p) => !!p.name && !p.hasDefault && p.category === ParameterCategory.Simple
                    ).length;
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
                                        paramIndex,
                                        diag.createAddendum(),
                                        typeVarMap,
                                        srcTypeVarMap,
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
                    for (let paramIndex = srcPositionals.length; paramIndex < destPositionals.length; paramIndex++) {
                        const destParamType = FunctionType.getEffectiveParameterType(
                            destType,
                            destParams.findIndex((p) => p === destPositionals[paramIndex])
                        );
                        if (isVariadicTypeVar(destParamType) && !isVariadicTypeVar(srcArgsType)) {
                            diag.addMessage(Localizer.DiagnosticAddendum.typeVarTupleRequiresKnownLength());
                            canAssign = false;
                        } else if (
                            !canAssignFunctionParameter(
                                destParamType,
                                srcArgsType,
                                paramIndex,
                                diag.createAddendum(),
                                typeVarMap,
                                srcTypeVarMap,
                                flags,
                                recursionCount
                            )
                        ) {
                            canAssign = false;
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
                        destArgsIndex,
                        diag.createAddendum(),
                        typeVarMap,
                        srcTypeVarMap,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }

            // If the dest has an "*args" but the source doesn't, report the incompatibility.
            // The converse situation is OK.
            if (srcArgsIndex < 0 && destArgsIndex >= 0 && !destVariadicArgsList) {
                diag.createAddendum().addMessage(
                    Localizer.DiagnosticAddendum.argsParamMissing().format({
                        paramName: destParams[destArgsIndex].name!,
                    })
                );
                canAssign = false;
            }

            // Handle matching of named (keyword) parameters.
            // Build a dictionary of named parameters in the dest.
            if (!destType.details.paramSpec) {
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

                // If the dest has fewer positional arguments than the source, the remaining
                // positional arguments in the source can be treated as named arguments.
                if (destPositionals.length < srcPositionals.length && destArgsIndex < 0) {
                    srcStartOfNamed = destPositionals.length;
                }

                if (srcStartOfNamed >= 0) {
                    srcParams.forEach((srcParam, index) => {
                        if (index >= srcStartOfNamed) {
                            if (srcParam.name && srcParam.category === ParameterCategory.Simple) {
                                const destParam = destParamMap.get(srcParam.name);
                                const paramDiag = diag.createAddendum();
                                if (!destParam) {
                                    if (!destHasKwargsParam && !srcParam.hasDefault) {
                                        paramDiag.addMessage(
                                            Localizer.DiagnosticAddendum.namedParamMissingInDest().format({
                                                name: srcParam.name,
                                            })
                                        );
                                        canAssign = false;
                                    } else if (destHasKwargsParam) {
                                        // Make sure we can assign the type to the Kwargs.
                                        const destKwargsType = FunctionType.getEffectiveParameterType(
                                            destType,
                                            destKwargsIndex
                                        );
                                        if (
                                            !canAssignFunctionParameter(
                                                destKwargsType,
                                                srcParam.type,
                                                destKwargsIndex,
                                                diag.createAddendum(),
                                                typeVarMap,
                                                srcTypeVarMap,
                                                flags,
                                                recursionCount
                                            )
                                        ) {
                                            canAssign = false;
                                        }
                                    }
                                } else {
                                    const specializedDestParamType = typeVarMap
                                        ? applySolvedTypeVars(destParam.type, typeVarMap)
                                        : destParam.type;
                                    if (
                                        !canAssignType(
                                            srcParam.type,
                                            specializedDestParamType,
                                            paramDiag.createAddendum(),
                                            undefined,
                                            flags,
                                            recursionCount + 1
                                        )
                                    ) {
                                        paramDiag.addMessage(
                                            Localizer.DiagnosticAddendum.namedParamTypeMismatch().format({
                                                name: srcParam.name,
                                                sourceType: printType(specializedDestParamType),
                                                destType: printType(srcParam.type),
                                            })
                                        );
                                        canAssign = false;
                                    }
                                    destParamMap.delete(srcParam.name);
                                }
                            }
                        }
                    });
                }

                // See if there are any unmatched named parameters.
                destParamMap.forEach((destParam, paramName) => {
                    if (srcKwargsIndex >= 0 && destParam.name) {
                        // Make sure the dest kwargs type is compatible.
                        const srcKwargsType = FunctionType.getEffectiveParameterType(srcType, srcKwargsIndex);
                        if (
                            !canAssignFunctionParameter(
                                destParam.type,
                                srcKwargsType,
                                destKwargsIndex,
                                diag.createAddendum(),
                                typeVarMap,
                                srcTypeVarMap,
                                flags,
                                recursionCount
                            )
                        ) {
                            canAssign = false;
                        }
                        destParamMap.delete(destParam.name);
                    } else {
                        const paramDiag = diag.createAddendum();
                        paramDiag.addMessage(
                            Localizer.DiagnosticAddendum.namedParamMissingInSource().format({ name: paramName })
                        );
                        canAssign = false;
                    }
                });

                // If both src and dest have a "*kwargs" parameter, make sure
                // their types are compatible.
                if (srcKwargsIndex >= 0 && destKwargsIndex >= 0) {
                    const srcKwargsType = FunctionType.getEffectiveParameterType(srcType, srcKwargsIndex);
                    const destKwargsType = FunctionType.getEffectiveParameterType(destType, destKwargsIndex);
                    if (
                        !canAssignFunctionParameter(
                            destKwargsType,
                            srcKwargsType,
                            destKwargsIndex,
                            diag.createAddendum(),
                            typeVarMap,
                            srcTypeVarMap,
                            flags,
                            recursionCount
                        )
                    ) {
                        canAssign = false;
                    }
                }

                // If the dest has a "**kwargs" but the source doesn't, report the incompatibility.
                // The converse situation is OK.
                if (srcKwargsIndex < 0 && destKwargsIndex >= 0) {
                    diag.createAddendum().addMessage(
                        Localizer.DiagnosticAddendum.argsParamMissing().format({
                            paramName: destParams[destKwargsIndex].name!,
                        })
                    );
                    canAssign = false;
                }
            }
        }

        if (typeVarMap && !typeVarMap.isLocked()) {
            // If the source function was generic and we solved some of the type variables
            // in that generic type, assign them back to the destination typeVar.
            srcTypeVarMap.getTypeVars().forEach((typeVarEntry) => {
                canAssignType(
                    typeVarEntry.typeVar,
                    srcTypeVarMap.getTypeVarType(typeVarEntry.typeVar)!,
                    new DiagnosticAddendum(),
                    typeVarMap
                );
            });

            // Perform partial specialization of type variables to allow for
            // "higher-order" type variables.
            typeVarMap.getTypeVars().forEach((entry) => {
                if (entry.narrowBound) {
                    const specializedType = applySolvedTypeVars(entry.narrowBound, typeVarMap);
                    if (specializedType !== entry.narrowBound) {
                        typeVarMap.setTypeVarType(entry.typeVar, specializedType, entry.wideBound, entry.retainLiteral);
                    }
                }
            });

            // Are we assigning to a function with a ParamSpec?
            if (destType.details.paramSpec) {
                typeVarMap.setParamSpec(destType.details.paramSpec, {
                    parameters: srcType.details.parameters
                        .map((p, index) => {
                            const paramSpecEntry: ParamSpecEntry = {
                                category: p.category,
                                name: p.name,
                                hasDefault: !!p.hasDefault,
                                type: FunctionType.getEffectiveParameterType(srcType, index),
                            };
                            return paramSpecEntry;
                        })
                        .slice(destType.details.parameters.length, srcType.details.parameters.length),
                });
            }
        }

        // Match the return parameter.
        if (checkReturnType) {
            const destReturnType = getFunctionEffectiveReturnType(destType);
            if (!isAnyOrUnknown(destReturnType)) {
                const srcReturnType = applySolvedTypeVars(getFunctionEffectiveReturnType(srcType), srcTypeVarMap);
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
        }

        return canAssign;
    }

    // If the declaredType contains type arguments that are "Any" and
    // the corresponding type argument in the assignedType is not "Any",
    // replace that type argument in the assigned type. This function assumes
    // that the caller has already verified that the assignedType is assignable
    // to the declaredType.
    function replaceTypeArgsWithAny(declaredType: ClassType, assignedType: ClassType): ClassType | undefined {
        if (
            assignedType.details.typeParameters.length > 0 &&
            assignedType.typeArguments &&
            assignedType.typeArguments.length <= assignedType.details.typeParameters.length
        ) {
            const typeVarMap = new TypeVarMap(getTypeVarScopeId(assignedType));
            populateTypeVarMapBasedOnExpectedType(
                ClassType.cloneForSpecialization(
                    assignedType,
                    /* typeArguments */ undefined,
                    /* isTypeArgumentExplicit */ false
                ),
                ObjectType.create(declaredType),
                typeVarMap,
                []
            );

            let replacedTypeArg = false;
            const newTypeArgs = assignedType.typeArguments.map((typeArg, index) => {
                const typeParam = assignedType.details.typeParameters[index];
                const expectedTypeArgType = typeVarMap.getTypeVarType(typeParam);

                if (expectedTypeArgType) {
                    if (isAny(expectedTypeArgType) || isAnyOrUnknown(typeArg)) {
                        replacedTypeArg = true;
                        return expectedTypeArgType;
                    }
                }

                return typeArg;
            });

            if (replacedTypeArg) {
                return ClassType.cloneForSpecialization(assignedType, newTypeArgs, /* isTypeArgumentExplicit */ true);
            }
        }

        return undefined;
    }

    // When a value is assigned to a variable with a declared type,
    // we may be able to narrow the type based on the assignment.
    function narrowTypeBasedOnAssignment(declaredType: Type, assignedType: Type): Type {
        const diag = new DiagnosticAddendum();

        const narrowedType = mapSubtypes(assignedType, (assignedSubtype) => {
            const narrowedSubtype = mapSubtypes(declaredType, (declaredSubtype) => {
                // We can't narrow "Any".
                if (isAnyOrUnknown(declaredType)) {
                    return declaredType;
                }

                if (canAssignType(declaredSubtype, assignedSubtype, diag)) {
                    // If the source is generic and has unspecified type arguments,
                    // see if we can determine then based on the declared type.
                    if (isClass(declaredSubtype) && isClass(assignedSubtype)) {
                        const result = replaceTypeArgsWithAny(declaredSubtype, assignedSubtype);
                        if (result) {
                            assignedSubtype = result;
                        }
                    } else if (isObject(declaredSubtype) && isObject(assignedSubtype)) {
                        const result = replaceTypeArgsWithAny(declaredSubtype.classType, assignedSubtype.classType);
                        if (result) {
                            assignedSubtype = ObjectType.create(result);
                        }
                    } else if (isAnyOrUnknown(assignedSubtype)) {
                        // Any or Unknown do not narrow because they're assignable to all types.
                        return declaredType;
                    }

                    return assignedSubtype;
                }

                return undefined;
            });

            // If we couldn't assign the assigned subtype any of the declared
            // subtypes, the types are incompatible. Return the unnarrowed form.
            if (isNever(narrowedSubtype)) {
                return assignedSubtype;
            }

            return narrowedSubtype;
        });

        // If the result of narrowing is Any, stick with the declared (unnarrowed) type.
        if (isAnyOrUnknown(assignedType)) {
            return declaredType;
        }

        return narrowedType;
    }

    function canOverrideMethod(
        baseMethod: Type,
        overrideMethod: FunctionType,
        diag: DiagnosticAddendum,
        enforceParamNames = true
    ): boolean {
        // If we're overriding an overloaded method, uses the last overload.
        if (isOverloadedFunction(baseMethod)) {
            baseMethod = baseMethod.overloads[baseMethod.overloads.length - 1];
        }

        // If we're overriding a non-method with a method, report it as an error.
        // This occurs when a non-property overrides a property.
        if (!isFunction(baseMethod)) {
            diag.addMessage(Localizer.DiagnosticAddendum.overrideType().format({ type: printType(baseMethod) }));
            return false;
        }

        let canOverride = true;
        const baseParams = baseMethod.details.parameters;
        const overrideParams = overrideMethod.details.parameters;
        const overrideArgsParam = overrideParams.find(
            (param) => param.category === ParameterCategory.VarArgList && !!param.name
        );
        const overrideKwargsParam = overrideParams.find(
            (param) => param.category === ParameterCategory.VarArgDictionary && !!param.name
        );

        // Verify that the param count matches exactly or that the override
        // adds only params that preserve the original signature.
        let foundParamCountMismatch = false;
        if (overrideParams.length < baseParams.length) {
            if (!overrideArgsParam || !overrideKwargsParam) {
                foundParamCountMismatch = true;
            }
        } else if (overrideParams.length > baseParams.length) {
            // Verify that all of the override parameters that extend the
            // signature are either *args, **kwargs or parameters with
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
            // If the first parameter is a "self" or "cls" parameter, skip the
            // test because these are allowed to violate the Liskov substitution
            // principle.
            if (i === 0) {
                if (
                    FunctionType.isInstanceMethod(overrideMethod) ||
                    FunctionType.isClassMethod(overrideMethod) ||
                    FunctionType.isConstructorMethod(overrideMethod)
                ) {
                    continue;
                }
            }

            const baseParam = baseParams[i];
            const overrideParam = overrideParams[i];

            if (
                i > positionOnlyIndex &&
                !isPrivateOrProtectedName(baseParam.name || '') &&
                baseParam.category === ParameterCategory.Simple &&
                baseParam.name !== overrideParam.name
            ) {
                if (overrideParam.category === ParameterCategory.Simple) {
                    if (enforceParamNames) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.overrideParamName().format({
                                index: i + 1,
                                baseName: baseParam.name || '*',
                                overrideName: overrideParam.name || '*',
                            })
                        );
                        canOverride = false;
                    }
                }
            } else {
                const baseParamType = FunctionType.getEffectiveParameterType(baseMethod, i);
                const overrideParamType = FunctionType.getEffectiveParameterType(overrideMethod, i);

                const baseIsSynthesizedTypeVar = isTypeVar(baseParamType) && baseParamType.details.isSynthesized;
                const overrideIsSynthesizedTypeVar =
                    isTypeVar(overrideParamType) && overrideParamType.details.isSynthesized;
                if (!baseIsSynthesizedTypeVar && !overrideIsSynthesizedTypeVar) {
                    if (
                        baseParam.category !== overrideParam.category ||
                        !canAssignType(
                            overrideParamType,
                            baseParamType,
                            diag.createAddendum(),
                            /* typeVarMap */ undefined,
                            CanAssignFlags.SkipSolveTypeVars
                        )
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
        if (
            !canAssignType(
                baseReturnType,
                overrideReturnType,
                diag.createAddendum(),
                /* typeVarMap */ undefined,
                CanAssignFlags.SkipSolveTypeVars
            )
        ) {
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

            effectiveSrcType = makeTopLevelTypeVarsConcrete(srcType);
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
                            name: TypeVarType.getReadableName(destType),
                        })
                    );
                }
                return false;
            }
        }

        if (destType.details.isParamSpec) {
            if (isParamSpec(srcType)) {
                return true;
            }
        } else if (isParamSpec(srcType)) {
            diag.addMessage(Localizer.Diagnostic.paramSpecContext());
            return false;
        } else {
            // If there are no constraints, we're done.
            const constraints = destType.details.constraints;
            if (constraints.length === 0) {
                return true;
            }

            // Try to find a match among the constraints.
            for (const constraint of constraints) {
                if (isAnyOrUnknown(constraint)) {
                    return true;
                } else if (isUnion(effectiveSrcType)) {
                    // Does it match at least one of the constraints?
                    if (
                        findSubtype(effectiveSrcType, (subtype) =>
                            canAssignType(constraint, subtype, new DiagnosticAddendum())
                        )
                    ) {
                        return true;
                    }
                } else if (canAssignType(constraint, effectiveSrcType, new DiagnosticAddendum())) {
                    return true;
                }
            }
        }

        diag.addMessage(
            Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                type: printType(effectiveSrcType),
                name: TypeVarType.getReadableName(destType),
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
            if (!isObject(keyType) || !ClassType.isBuiltIn(keyType.classType, 'str') || !isLiteralType(keyType)) {
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

    function getTypedDictMembersForClass(classType: ClassType, allowNarrowed = false) {
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

        // Apply narrowed types on top of existing entries if present.
        if (allowNarrowed && classType.typedDictNarrowedEntries) {
            classType.typedDictNarrowedEntries.forEach((value, key) => {
                entries.set(key, { ...value });
            });
        }

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
                    const valueType = getDeclaredTypeOfSymbol(symbol) || UnknownType.create();
                    let isRequired = !ClassType.isCanOmitDictValues(classType);

                    if (isRequiredTypedDictVariable(symbol)) {
                        isRequired = true;
                    } else if (isNotRequiredTypedDictVariable(symbol)) {
                        isRequired = false;
                    }

                    // If a base class already declares this field, verify that the
                    // subclass isn't trying to change its type. That's expressly
                    // forbidden in PEP 589.
                    const existingEntry = keyMap.get(name);
                    if (existingEntry) {
                        if (!isTypeSame(existingEntry.valueType, valueType)) {
                            const diag = new DiagnosticAddendum();
                            diag.addMessage(
                                Localizer.DiagnosticAddendum.typedDictFieldRedefinition().format({
                                    parentType: printType(existingEntry.valueType),
                                    childType: printType(valueType),
                                })
                            );
                            addDiagnostic(
                                getFileInfo(lastDecl.node).diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.typedDictFieldRedefinition().format({
                                    name,
                                }) + diag.getString(),
                                lastDecl.node
                            );
                        }
                    }

                    keyMap.set(name, {
                        valueType,
                        isRequired,
                        isProvided: false,
                    });
                }
            }
        });
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it. If treatAsClassMethod is true, the function is treated like a
    // class method even if it's not marked as such. That's needed to
    // special-case the __new__ magic method when it's invoked as a
    // constructor (as opposed to by name).
    function bindFunctionToClassOrObject(
        baseType: ClassType | ObjectType | undefined,
        memberType: FunctionType | OverloadedFunctionType,
        memberClass?: ClassType,
        errorNode?: ParseNode,
        recursionCount = 0,
        treatConstructorAsClassMember = false,
        firstParamType?: ClassType | ObjectType | TypeVarType
    ): FunctionType | OverloadedFunctionType | undefined {
        if (isFunction(memberType)) {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return FunctionType.clone(memberType, /* stripFirstParam */ true);
            }

            if (FunctionType.isInstanceMethod(memberType)) {
                const baseObj = isObject(baseType) ? baseType : ObjectType.create(specializeClassType(baseType));
                return partiallySpecializeFunctionForBoundClassOrObject(
                    baseType,
                    memberType,
                    memberClass || baseObj.classType,
                    errorNode,
                    recursionCount + 1,
                    firstParamType || baseObj,
                    /* stripFirstParam */ isObject(baseType)
                );
            }

            if (
                FunctionType.isClassMethod(memberType) ||
                (treatConstructorAsClassMember && FunctionType.isConstructorMethod(memberType))
            ) {
                const baseClass = isClass(baseType) ? baseType : baseType.classType;

                // If the caller passed an object as the base type, we need to also
                // convert the firstParamType to an instantiable.
                const effectiveFirstParamType = firstParamType
                    ? isClass(baseType)
                        ? firstParamType
                        : (convertToInstantiable(firstParamType) as ClassType | TypeVarType)
                    : baseClass;

                return partiallySpecializeFunctionForBoundClassOrObject(
                    baseType,
                    memberType,
                    memberClass || baseClass,
                    errorNode,
                    recursionCount + 1,
                    effectiveFirstParamType,
                    /* stripFirstParam */ true
                );
            }

            if (FunctionType.isStaticMethod(memberType)) {
                const baseClass = isClass(baseType) ? baseType : baseType.classType;

                return partiallySpecializeFunctionForBoundClassOrObject(
                    baseType,
                    memberType,
                    memberClass || baseClass,
                    errorNode,
                    recursionCount + 1,
                    /* effectiveFirstParamType */ undefined,
                    /* stripFirstParam */ false
                );
            }
        } else if (isOverloadedFunction(memberType)) {
            const newOverloadType = OverloadedFunctionType.create();
            memberType.overloads.forEach((overload) => {
                const boundMethod = bindFunctionToClassOrObject(
                    baseType,
                    overload,
                    memberClass,
                    /* errorNode */ undefined,
                    recursionCount + 1,
                    treatConstructorAsClassMember,
                    firstParamType
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
                if (errorNode) {
                    memberType.overloads.forEach((overload) => {
                        bindFunctionToClassOrObject(
                            baseType,
                            overload,
                            memberClass,
                            errorNode,
                            recursionCount + 1,
                            treatConstructorAsClassMember,
                            firstParamType
                        );
                    });
                }
                return undefined;
            }

            return newOverloadType;
        }

        return memberType;
    }

    // Specializes the specified function for the specified class,
    // optionally stripping the first first paramter (the "self" or "cls")
    // off of the specialized function in the process. The baseType
    // is the type used to reference the member, and the memberClass
    // is the class that provided the member (could be an ancestor of
    // the baseType's class).
    function partiallySpecializeFunctionForBoundClassOrObject(
        baseType: ClassType | ObjectType,
        memberType: FunctionType,
        memberClass: ClassType,
        errorNode: ParseNode | undefined,
        recursionCount: number,
        firstParamType: ClassType | ObjectType | TypeVarType | undefined,
        stripFirstParam = true
    ): FunctionType | undefined {
        // If the class has already been specialized (fully or partially), use its
        // existing type arg mappings. If it hasn't, use a fresh type arg map.
        const typeVarMap = memberClass.typeArguments
            ? buildTypeVarMapFromSpecializedClass(memberClass)
            : new TypeVarMap(getTypeVarScopeId(memberClass));

        if (firstParamType && memberType.details.parameters.length > 0) {
            const memberTypeFirstParam = memberType.details.parameters[0];
            const memberTypeFirstParamType = FunctionType.getEffectiveParameterType(memberType, 0);

            // If the type has a literal associated with it, strip it now. This
            // is needed to handle generic functions in the enum.Flag class.
            const nonLiteralFirstParamType = stripLiteralValue(firstParamType);

            // Fill out the typeVarMap for the "self" or "cls" parameter.
            typeVarMap.addSolveForScope(getTypeVarScopeId(memberType));
            const diag = new DiagnosticAddendum();

            if (
                isTypeVar(memberTypeFirstParamType) &&
                memberTypeFirstParamType.details.boundType &&
                isObject(memberTypeFirstParamType.details.boundType) &&
                ClassType.isProtocolClass(memberTypeFirstParamType.details.boundType.classType)
            ) {
                // Handle the protocol class specially. Some protocol classes
                // contain references to themselves or their subclasses, so if
                // we attempt to call canAssignType, we'll risk infinite recursion.
                // Instead, we'll assume it's assignable.
                if (!typeVarMap.isLocked()) {
                    typeVarMap.setTypeVarType(memberTypeFirstParamType, nonLiteralFirstParamType);
                }
            } else if (
                !canAssignType(
                    memberTypeFirstParamType,
                    nonLiteralFirstParamType,
                    diag,
                    typeVarMap,
                    /* flags */ undefined,
                    recursionCount + 1
                )
            ) {
                if (
                    memberTypeFirstParam.name &&
                    !memberTypeFirstParam.isNameSynthesized &&
                    memberTypeFirstParam.hasDeclaredType
                ) {
                    if (errorNode) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.bindTypeMismatch().format({
                                type: printType(baseType),
                                methodName: memberType.details.name,
                                paramName: memberTypeFirstParam.name,
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

        // Get the effective return type, which will have the side effect of lazily
        // evaluating (and caching) the inferred return type if there is no defined return type.
        getFunctionEffectiveReturnType(memberType);

        const specializedFunction = applySolvedTypeVars(memberType, typeVarMap) as FunctionType;

        return FunctionType.clone(specializedFunction, stripFirstParam, baseType, getTypeVarScopeId(baseType));
    }

    function printObjectTypeForClass(type: ClassType): string {
        return TypePrinter.printObjectTypeForClass(
            type,
            evaluatorOptions.printTypeFlags,
            getFunctionEffectiveReturnType
        );
    }

    function printFunctionParts(type: FunctionType): [string[], string] {
        return TypePrinter.printFunctionParts(type, evaluatorOptions.printTypeFlags, getFunctionEffectiveReturnType);
    }

    function printType(type: Type, expandTypeAlias = false): string {
        let flags = evaluatorOptions.printTypeFlags;

        if (expandTypeAlias) {
            flags |= TypePrinter.PrintTypeFlags.ExpandTypeAlias;
        }

        return TypePrinter.printType(type, flags, getFunctionEffectiveReturnType);
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

    // Create an ID that is based on the location within the file.
    // This allows us to disambiguate between different types that
    // don't have unique names (those that are not created with class
    // declarations).
    function getTypeSourceId(node: ParseNode): TypeSourceId {
        return node.start;
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
        getTypeFromIterator,
        getTypedDictMembersForClass,
        getGetterTypeFromProperty,
        markNamesAccessed,
        getScopeIdForNode,
        makeTopLevelTypeVarsConcrete,
        getEffectiveTypeOfSymbol,
        getFunctionDeclaredReturnType,
        getFunctionInferredReturnType,
        getBuiltInType,
        getTypeOfMember,
        bindFunctionToClassOrObject,
        getCallSignatureInfo,
        getTypeAnnotationForParameter,
        canAssignType,
        canOverrideMethod,
        canAssignProtocolClassToSelf,
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
