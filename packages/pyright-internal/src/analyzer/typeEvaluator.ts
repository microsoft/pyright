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

import { invalidateTypeCacheIfCanceled, throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { DiagnosticLevel } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { isThenable } from '../common/core';
import { assert, assertNever, fail } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetToPosition } from '../common/positionUtils';
import {
    PythonVersion,
    pythonVersion3_13,
    pythonVersion3_14,
    pythonVersion3_6,
    pythonVersion3_7,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { LocAddendum, LocMessage, ParameterizedString } from '../localization/localize';
import {
    ArgCategory,
    ArgumentNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    AwaitNode,
    CallNode,
    CaseNode,
    ClassNode,
    ComprehensionForIfNode,
    ComprehensionNode,
    ConstantNode,
    DecoratorNode,
    DictionaryNode,
    ErrorExpressionCategory,
    ExceptNode,
    ExpressionNode,
    FormatStringNode,
    ForNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    IndexNode,
    isExpressionNode,
    LambdaNode,
    ListNode,
    MatchNode,
    MemberAccessNode,
    NameNode,
    NumberNode,
    ParamCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    SetNode,
    SliceNode,
    StringListNode,
    StringNode,
    TupleNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterListNode,
    TypeParameterNode,
    TypeParamKind,
    UnpackNode,
    WithItemNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookup, isAnnotationEvaluationPostponed } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { FlowNodeTypeOptions, FlowNodeTypeResult, getCodeFlowEngine } from './codeFlowEngine';
import {
    CodeFlowReferenceExpressionNode,
    FlowFlags,
    FlowNode,
    FlowWildcardImport,
    isCodeFlowSupportedForReference,
} from './codeFlowTypes';
import {
    addConstraintsForExpectedType,
    applySourceSolutionToConstraints,
    assignTypeVar,
    solveConstraints,
    solveConstraintSet,
} from './constraintSolver';
import { ConstraintSet, ConstraintTracker } from './constraintTracker';
import { createFunctionFromConstructor, getBoundInitMethod, validateConstructorArgs } from './constructors';
import {
    applyDataClassClassBehaviorOverrides,
    synthesizeDataClassMethods,
    synthesizeDataClassSlots,
} from './dataClasses';
import {
    ClassDeclaration,
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    isVariableDeclaration,
    ModuleLoaderActions,
    SpecialBuiltInClassDeclaration,
    VariableDeclaration,
} from './declaration';
import {
    getNameNodeForDeclaration,
    resolveAliasDeclaration as resolveAliasDeclarationUtil,
    ResolvedAliasInfo,
    synthesizeAliasDeclaration,
} from './declarationUtils';
import {
    addOverloadsToFunctionType,
    applyClassDecorator,
    applyFunctionDecorator,
    getDeprecatedMessageFromCall,
    getFunctionInfoFromDecorators,
} from './decorators';
import {
    applyIntFlagTransform,
    createEnumType,
    getEnumAutoValueType,
    getTypeOfEnumMember,
    getTypeOfIntFlagMember,
    isDeclInEnumClass,
    isEnumClassWithMembers,
    isEnumMetaclass,
    isIntFlagBitwiseFunction,
    synthesizeEnumBoundary,
} from './enums';
import { applyFunctionTransform } from './functionTransform';
import { createNamedTupleType } from './namedTuples';
import {
    getTypeOfAugmentedAssignment,
    getTypeOfBinaryOperation,
    getTypeOfTernaryOperation,
    getTypeOfUnaryOperation,
} from './operations';
import {
    getParamListDetails,
    isParamSpecArgs,
    isParamSpecKwargs,
    ParamAssignmentTracker,
    ParamKind,
    ParamListDetails,
    VirtualParamDetails,
} from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { getChildNodes } from './parseTreeWalker';
import { assignTypeToPatternTargets, checkForUnusedPattern, narrowTypeBasedOnPattern } from './patternMatching';
import { assignProperty, createProperty } from './properties';
import { assignClassToProtocol, assignModuleToProtocol, noteAssignTypeRecursionLimit } from './protocols';
import { Scope, ScopeType, SymbolWithScope } from './scope';
import * as ScopeUtils from './scopeUtils';
import { createSentinelType } from './sentinel';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags, SynthesizedTypeInfo } from './symbol';
import { isConstantName, isMethodExemptFromLsp, isPrivateName, isPrivateOrProtectedName } from './symbolNameUtils';
import { isEffectivelyClassVar } from './symbolUtils';
import { getTypeOfTuple, makeTupleObject } from './tuples';
import {
    addContextualTypeCacheEntry,
    contextualTypeCacheEntryMatches,
    findContextualTypeCacheEntry,
    SpeculativeModeOptions,
    SpeculativeTypeTracker,
    useNodeCacheIsolation,
} from './typeCacheUtils';
import { createTypedDictType, getTypedDictMembersForClass, synthesizeTypedDictClassMethods } from './typedDicts';
import * as LiteralTypes from './typeEvaluator/literalTypes';
import {
    AbstractSymbol,
    Arg,
    ArgResult,
    ArgWithExpression,
    AssignTypeFlags,
    CallResult,
    CallSignature,
    CallSignatureInfo,
    CallSiteEvaluationInfo,
    ClassMemberLookup,
    ClassTypeResult,
    DeclaredSymbolTypeInfo,
    EffectiveTypeResult,
    ensureExpectedTypeCandidates,
    EvalFlags,
    EvaluationOperationController,
    EvaluatorUsage,
    ExpectedTypeOptions,
    ExpectedTypeResult,
    FunctionResult,
    FunctionTypeResult,
    MapSubtypesOptions,
    MemberAccessDeprecationInfo,
    PrefetchedTypes,
    PrintTypeOptions,
    Reachability,
    ResolveAliasOptions,
    SolveConstraintsOptions,
    SymbolDeclInfo,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
    ValidateArgTypeParams,
    ValidateTypeArgsOptions,
} from './typeEvaluatorTypes';
import { enumerateLiteralsForType } from './typeGuards';
import * as TypePrinter from './typePrinter';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    DataClassBehaviors,
    EnumLiteral,
    findSubtype,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    getInferredTupleLiteralBase,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isMethodType,
    isModule,
    isNever,
    isOverloaded,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnbound,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    isUnpackedTypeVarTuple,
    LiteralValue,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    OverloadedType,
    ParamSpecType,
    removeFromUnion,
    removeUnbound,
    TupleTypeArg,
    Type,
    TypeAliasInfo,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeVarKind,
    TypeVarScopeId,
    TypeVarScopeType,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
    Variance,
} from './types';
import {
    addConditionToType,
    addTypeVarsToListIfUnique,
    applySolvedTypeVars,
    ApplyTypeVarOptions,
    areTypesSame,
    buildSolutionFromSpecializedClass,
    ClassMember,
    combineTupleTypeArgs,
    combineVariances,
    computeMroLinearization,
    containsAnyOrUnknown,
    containsLiteralType,
    convertToInstance,
    convertToInstantiable,
    convertTypeToParamSpecValue,
    derivesFromClassRecursive,
    derivesFromStdlibClass,
    doForEachSubtype,
    ensureSignaturesAreUnique,
    getSpecializedTupleType,
    getTypeCondition,
    getTypeVarArgsRecursive,
    getTypeVarScopeId,
    getTypeVarScopeIds,
    getUnknownForTypeVar,
    InferenceContext,
    invertVariance,
    isDescriptorInstance,
    isEffectivelyInstantiable,
    isEllipsisType,
    isIncompleteUnknown,
    isInstantiableMetaclass,
    isMaybeDescriptorInstance,
    isMemberReadOnly,
    isMetaclassInstance,
    isNoneInstance,
    isOptionalType,
    isOverlapOnlyByOmission,
    isPartlyUnknown,
    isProperty,
    isSentinelLiteral,
    isTupleClass,
    isTypeAliasPlaceholder,
    isTypeAliasRecursive,
    isTypeVarSame,
    isUnboundedTupleClass,
    isVarianceOfTypeArgCompatible,
    lookUpClassMember,
    lookUpObjectMember,
    makeInferenceContext,
    makePacked,
    makeTypeVarsBound,
    makeTypeVarsFree,
    mapSignatures,
    mapSubtypes,
    MemberAccessFlags,
    partiallySpecializeType,
    preserveUnknown,
    removeNoneFromUnion,
    requiresSpecialization,
    selfSpecializeClass,
    someSubtypes,
    sortTypes,
    specializeForBaseClass,
    specializeTupleClass,
    specializeWithDefaultTypeArgs,
    specializeWithUnknownTypeArgs,
    stripTypeForm,
    stripTypeFormRecursive,
    synthesizeTypeVarForSelfCls,
    transformExpectedType,
    transformPossibleRecursiveTypeAlias,
    UniqueSignatureTracker,
} from './typeUtils';
import { TypeWalker } from './typeWalker';

import {
    AutomaticOverloadSelection,
    getFixedOverloadCoverage,
    hasNestedOverloadAny,
    isAutomaticOverloadSeedSyntax,
    isFixedOverloadArgumentShape,
    isFixedOverloadReturnShape,
    OverloadCoverage,
    OverloadSelectionBudget,
} from './overloadResultSelector';

// This table contains the names of several built-in types that
// are not subscriptable at runtime on older versions of Python.
// It lists the first version of Python where subscripting is
// allowed.
const nonSubscriptableBuiltinTypes: Map<string, PythonVersion> = new Map([
    ['asyncio.futures.Future', pythonVersion3_9],
    ['asyncio.tasks.Task', pythonVersion3_9],
    ['builtins.dict', pythonVersion3_9],
    ['builtins.frozenset', pythonVersion3_9],
    ['builtins.list', pythonVersion3_9],
    ['builtins._PathLike', pythonVersion3_9],
    ['builtins.set', pythonVersion3_9],
    ['builtins.tuple', pythonVersion3_9],
    ['collections.ChainMap', pythonVersion3_9],
    ['collections.Counter', pythonVersion3_9],
    ['collections.defaultdict', pythonVersion3_9],
    ['collections.DefaultDict', pythonVersion3_9],
    ['collections.deque', pythonVersion3_9],
    ['collections.OrderedDict', pythonVersion3_9],
    ['queue.Queue', pythonVersion3_9],
]);

// Some types that do not inherit from others are still considered
// "compatible" based on the Python spec. These are sometimes referred
// to as "type promotions".
const typePromotions: Map<string, string[]> = new Map([
    ['builtins.float', ['builtins.int']],
    ['builtins.complex', ['builtins.float', 'builtins.int']],
    ['builtins.bytes', ['builtins.bytearray', 'builtins.memoryview']],
]);

// How many levels deep should we attempt to infer return
// types based on call-site argument types? The deeper we go,
// the more types we may be able to infer, but the worse the
// performance.
const maxReturnTypeInferenceStackSize = 2;

// What is the max number of input arguments we should allow
// for call-site return type inference? We've found that large,
// complex functions with many arguments can take too long to
// analyze.
const maxReturnTypeInferenceArgCount = 6;

// What is the max complexity of the code flow graph that
// we will analyze to determine the return type of a function
// when its parameters are unannotated? We want to keep this
// pretty low because this can be very costly.
const maxReturnTypeInferenceCodeFlowComplexity = 32;

// What is the max complexity of the code flow graph for
// call-site type inference? This is very expensive, so we
// want to keep this very low.
const maxReturnCallSiteTypeInferenceCodeFlowComplexity = 8;

// What is the max number of return types cached per function
// when using call-site inference?
const maxCallSiteReturnTypeCacheSize = 8;

// How many entries in a list, set, or dict should we examine
// when inferring the type? We need to cut it off at some point
// to avoid excessive computation.
const maxEntriesToUseForInference = 64;

// How many times should attempt to infer a return type of a
// function before giving up and assuming that it won't converge
// due to recursion?
const maxReturnTypeInferenceAttempts = 8;

// How many assignments to an unannotated variable should be used
// when inferring its type? We need to cut it off at some point
// to avoid excessive computation.
const maxDeclarationsToUseForInference = 64;

// Maximum number of times to attempt effective type evaluation
// of a variable that has no type declaration.
const maxEffectiveTypeEvaluationAttempts = 16;

// Maximum number of combinatoric argument type expansions allowed
// when resolving an overload.
const maxTotalOverloadArgTypeExpansionCount = 256;

// Maximum size of an enum that will be expanded during overload
// argument type expansion.
const maxSingleOverloadArgTypeExpansionCount = 64;

// Maximum number of recursive function return type inference attempts
// that can be concurrently pending before we give up.
const maxInferFunctionReturnRecursionCount = 12;

// Maximum recursion amount when comparing two recursive type aliases.
// Increasing this can greatly increase the time required to evaluate
// two recursive type aliases that have the same definition. Decreasing
// it can increase the chance of false negatives for such recursive
// type aliases.
const maxRecursiveTypeAliasRecursionCount = 10;

// Normally a symbol can have only one type declaration, but there are
// cases where multiple are possible (e.g. a property with a setter
// and a deleter). In extreme cases, we need to limit the number of
// type declarations we consider to avoid excessive computation.
const maxTypedDeclsPerSymbol = 16;

// This switch enables a special debug mode that attempts to catch
// bugs due to inconsistent evaluation flags used when reading types
// from the type cache.
const verifyTypeCacheEvaluatorFlags = false;

// This debugging option prints each expression and its evaluated type.
const printExpressionTypes = false;

// Describes a "deferred class completion" that is run when a class type is
// fully created and the "PartiallyEvaluated" flag has just been cleared.
// This allows us to properly compute information like the MRO which
// depends on a full understanding of base classes.

import {
    AliasMapEntry,
    AssignClassToSelfInfo,
    CodeFlowAnalyzerCacheEntry,
    ContextualLambdaTypeCache,
    DeferredClassCompletion,
    EffectiveReturnTypeOptions,
    EvaluatorOptions,
    ExpectedTypeCacheEntry,
    FunctionRecursionInfo,
    GetTypeArgsOptions,
    LogWrapper,
    MatchArgsToParamsResult,
    MatchedOverloadInfo,
    MemberAccessTypeResult,
    ParamSpecArgResult,
    ReturnTypeInferenceContext,
    ScopedTypeVarResult,
    SignatureTrackerStackEntry,
    SuppressedNodeStackEntry,
    SymbolResolutionStackEntry,
    TypeCacheEntry,
    TypeFormTypeCacheEntry,
    ValidateArgTypeOptions,
} from './typeEvaluator/internals';
export { EvaluatorOptions, MemberAccessTypeResult } from './typeEvaluator/internals';

import { createBoundMethodSpecialization } from './typeEvaluator/boundMethodSpecialization';
import { createClassConstruction } from './typeEvaluator/classConstruction';
import { createCollectionInference } from './typeEvaluator/collectionInference';
import { createDiagnostics } from './typeEvaluator/diagnostics';
import { createEvaluatorCore } from './typeEvaluator/evaluatorCore';
import { createEvaluatorNarrowing } from './typeEvaluator/evaluatorNarrowing';
import { createExpressionEvaluation, getIndexAccessMagicMethodName } from './typeEvaluator/expressionEvaluation';
import { createFlowAnalysis } from './typeEvaluator/flowAnalysis';
import { createMemberResolution } from './typeEvaluator/memberResolution';
import { createOverrideValidation } from './typeEvaluator/overrideValidation';
import { createReturnTypeInference } from './typeEvaluator/returnTypeInference';
import { createSpecialFormCreation } from './typeEvaluator/specialFormCreation';
import { applyUnpackToTupleLike } from './typeEvaluator/tupleUnpacking';
import { createTypeCompatibility } from './typeEvaluator/typeCompatibility';
import { createTypeVarHandling } from './typeEvaluator/typeVarHandling';
export function createTypeEvaluator(
    importLookup: ImportLookup,
    evaluatorOptions: EvaluatorOptions,
    wrapWithLogger: LogWrapper
): TypeEvaluator {
    const nodeInfo = AnalyzerNodeInfo.createAnalyzerNodeInfoAccessor(evaluatorOptions.nodeInfoReader);
    const maxCodeComplexity = evaluatorOptions.maxCodeComplexity;
    const operationController: EvaluationOperationController | undefined =
        evaluatorOptions.experimentalOverloadResult ?? evaluatorOptions.testOnlyExpression;
    let operationRouter = evaluatorOptions.experimentalOverloadResult?.isAutomatic ? undefined : operationController;
    const symbolResolutionStack: SymbolResolutionStackEntry[] = [];
    const speculativeTypeTracker = new SpeculativeTypeTracker();
    const suppressedNodeStack: SuppressedNodeStackEntry[] = [];
    const assignClassToSelfStack: AssignClassToSelfInfo[] = [];

    let functionRecursionMap = new Map<number, FunctionRecursionInfo[]>();
    let codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzerCacheEntry[]>();
    let typeCache = new Map<number, TypeCacheEntry>();
    let contextualLambdaTypeCache: ContextualLambdaTypeCache | undefined;
    let typeFormTypeCache = new Map<number, TypeFormTypeCacheEntry[]>();
    let effectiveTypeCache = new Map<number, Map<string, EffectiveTypeResult>>();
    let exceptionTargetSymbolCache = new Map<number, boolean>();
    let expectedTypeCache = new Map<number, ExpectedTypeCacheEntry>();
    let asymmetricAccessorAssignmentCache = new Set<number>();
    let deferredClassCompletions: DeferredClassCompletion[] = [];
    let cancellationToken: CancellationToken | undefined;
    let printExpressionSpaceCount = 0;
    let incompleteGenCount = 0;
    const returnTypeInferenceContextStack: ReturnTypeInferenceContext[] = [];
    let returnTypeInferenceTypeCache: Map<number, TypeCacheEntry> | undefined;
    let returnTypeInferenceTypeFormTypeCache: Map<number, TypeFormTypeCacheEntry[]> | undefined;
    const signatureTrackerStack: SignatureTrackerStackEntry[] = [];
    let prefetched: Partial<PrefetchedTypes> | undefined;

    function getScopeForNode(node: ParseNode) {
        return ScopeUtils.getScopeForNode(node, nodeInfo);
    }

    function getScopeHierarchy(node: ParseNode, stopScope?: Scope) {
        return ScopeUtils.getScopeHierarchy(node, stopScope, nodeInfo);
    }

    function findTopNodeInScope(node: ParseNode, scope: Scope) {
        return ScopeUtils.findTopNodeInScope(node, scope, nodeInfo);
    }

    function getScopeIdForNode(node: ParseNode) {
        return ParseTreeUtils.getScopeIdForNode(node, nodeInfo);
    }

    function getTypeVarScopesForNode(node: ParseNode) {
        return ParseTreeUtils.getTypeVarScopesForNode(node, nodeInfo);
    }

    function runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;
    function runWithCancellationToken<T>(token: CancellationToken, callback: () => Promise<T>): Promise<T>;
    function runWithCancellationToken<T>(token: CancellationToken, callback: () => T | Promise<T>): T | Promise<T> {
        // Save the current token and restore it after the callback to support nested calls
        const oldToken = cancellationToken;
        let result: T | Promise<T> | undefined = undefined;
        try {
            cancellationToken = token;
            result = callback();

            if (!isThenable(result)) {
                return result;
            }

            return result.finally(() => {
                cancellationToken = oldToken;
            });
        } finally {
            if (!isThenable(result)) {
                cancellationToken = oldToken;
            }
        }
    }

    function checkForCancellation() {
        if (cancellationToken) {
            throwIfCancellationRequested(cancellationToken);
        }
    }

    function getTypeCacheEntryCount(): number {
        return typeCache.size;
    }

    // This function should be called immediately prior to discarding
    // the type evaluator. It forcibly replaces existing cache maps
    // with empty equivalents. This shouldn't be necessary, but there
    // is apparently a bug in the v8 GC where it is unable to detect
    // circular references in complex data structures, so it fails
    // to clean up the objects if we don't help it out.
    function disposeEvaluator() {
        operationController?.dispose?.();
        functionRecursionMap = new Map<number, FunctionRecursionInfo[]>();
        codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzerCacheEntry[]>();
        typeCache = new Map<number, TypeCacheEntry>();
        typeFormTypeCache = new Map<number, TypeFormTypeCacheEntry[]>();
        effectiveTypeCache = new Map<number, Map<string, EffectiveTypeResult>>();
        exceptionTargetSymbolCache = new Map<number, boolean>();
        expectedTypeCache = new Map<number, ExpectedTypeCacheEntry>();
        asymmetricAccessorAssignmentCache = new Set<number>();
    }

    function readTypeCacheEntry(node: ParseNode) {
        // Should we use a temporary cache associated with a contextual
        // analysis of a function, contextualized based on call-site argument types?
        if (returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)) {
            return returnTypeInferenceTypeCache.get(node.id);
        } else {
            return typeCache.get(node.id);
        }
    }

    function getTypeFormTypeCache(node: ParseNode) {
        if (returnTypeInferenceTypeFormTypeCache && isNodeInReturnTypeInferenceContext(node)) {
            return returnTypeInferenceTypeFormTypeCache;
        }

        return typeFormTypeCache;
    }

    function readTypeFormTypeCacheEntry(node: ParseNode, expectedType: Type | undefined) {
        return findContextualTypeCacheEntry(getTypeFormTypeCache(node).get(node.id), expectedType);
    }

    // Contextual reads consult expectedTypeCache and prefer a matching TypeForm result.
    // Runtime-only consumers must use readTypeCacheEntry so this precedence is not
    // accidentally applied where an ordinary runtime type is required.
    function readContextualTypeCacheEntryForNode(node: ParseNode) {
        const expectedType = expectedTypeCache.get(node.id)?.type;
        if (expectedType && expectedTypeWantsTypeForm(expectedType)) {
            return (
                readTypeFormTypeCacheEntry(node, expectedType) ??
                readTypeFormTypeCacheEntry(node, /* expectedType */ undefined) ??
                readTypeCacheEntry(node)
            );
        }

        return readTypeCacheEntry(node) ?? readTypeFormTypeCacheEntry(node, /* expectedType */ undefined);
    }

    // Bumps the incomplete generation count using the same rules for both the
    // regular type cache and the TypeForm type cache so the two cache-invalidation
    // paths cannot drift. A complete result always bumps the count (invalidating
    // dependent incomplete entries); an incomplete result bumps only when its type
    // differs from the previously-cached value.
    function updateIncompleteGenerationCount(typeResult: TypeResult, oldTypeResult: TypeResult | undefined) {
        if (!typeResult.isIncomplete) {
            incompleteGenCount++;
        } else if (oldTypeResult !== undefined && !isTypeSame(typeResult.type, oldTypeResult.type)) {
            incompleteGenCount++;
        }
    }

    function isTypeCached(node: ParseNode) {
        // This helper is used by runtime-evaluation guards. A contextual TypeForm
        // entry does not prove that the ordinary runtime type was evaluated.
        return isTypeCacheEntryValid(readTypeCacheEntry(node));
    }

    function isTypeFormTypeCached(node: ParseNode, expectedType: Type | undefined) {
        return isTypeCacheEntryValid(readTypeFormTypeCacheEntry(node, expectedType));
    }

    function isTypeCacheEntryValid(cacheEntry: TypeCacheEntry | undefined) {
        if (!cacheEntry) {
            return false;
        }

        return !cacheEntry.typeResult.isIncomplete || cacheEntry.incompleteGenCount === incompleteGenCount;
    }

    function readTypeCache(node: ParseNode, flags: EvalFlags | undefined): Type | undefined {
        const cacheEntry = readTypeCacheEntry(node);
        if (!cacheEntry || cacheEntry.typeResult.isIncomplete) {
            return undefined;
        }

        if (evaluatorOptions.verifyTypeCacheEvaluatorFlags || verifyTypeCacheEvaluatorFlags) {
            if (flags !== undefined) {
                const expectedFlags = cacheEntry.flags;

                if (expectedFlags !== undefined && flags !== expectedFlags) {
                    const fileInfo = nodeInfo.getFileInfo(node);
                    const position = convertOffsetToPosition(node.start, fileInfo.lines);

                    const message =
                        `Type cache flag mismatch for node type ${node.nodeType} ` +
                        `(parent ${node.parent?.nodeType ?? 'none'}): ` +
                        `cached flags = ${expectedFlags}, access flags = ${flags}, ` +
                        `file = {${fileInfo.fileUri} [${position.line + 1}:${position.character + 1}]}`;
                    if (evaluatorOptions.verifyTypeCacheEvaluatorFlags) {
                        fail(message);
                    } else {
                        console.log(message);
                    }
                }
            }
        }

        return cacheEntry.typeResult.type;
    }

    function writeTypeCache(
        node: ParseNode,
        typeResult: TypeResult,
        flags: EvalFlags | undefined,
        inferenceContext?: InferenceContext,
        allowSpeculativeCaching = false
    ) {
        const useTypeFormCache =
            (flags !== undefined && (flags & EvalFlags.TypeFormArg) !== 0) ||
            (!!inferenceContext && expectedTypeWantsTypeForm(inferenceContext.expectedType));

        if (useTypeFormCache) {
            const expectedType = inferenceContext?.expectedType;

            // Speculative TypeForm results are not retained, so they must not invalidate
            // persistent incomplete entries through the global generation counter.
            if (isSpeculativeModeInUse(node)) {
                return;
            }

            const typeFormCache = getTypeFormTypeCache(node);
            const cacheEntries = typeFormCache.get(node.id) ?? [];
            const oldEntry = cacheEntries.find((entry) => contextualTypeCacheEntryMatches(entry, expectedType));

            updateIncompleteGenerationCount(typeResult, oldEntry?.typeResult);

            typeFormCache.set(
                node.id,
                addContextualTypeCacheEntry(cacheEntries, { typeResult, flags, incompleteGenCount, expectedType })
            );
            return;
        }

        // Should we use a temporary cache associated with a contextual
        // analysis of a function, contextualized based on call-site argument types?
        const typeCacheToUse =
            returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)
                ? returnTypeInferenceTypeCache
                : typeCache;

        const oldValue = typeCacheToUse.get(node.id);
        updateIncompleteGenerationCount(typeResult, oldValue?.typeResult);

        typeCacheToUse.set(node.id, { typeResult, flags, incompleteGenCount });

        // If the entry is located within a part of the parse tree that is currently being
        // "speculatively" evaluated, track it so we delete the cached entry when we leave
        // this speculative context.
        if (isSpeculativeModeInUse(node)) {
            speculativeTypeTracker.trackEntry(typeCacheToUse, node.id);
            if (allowSpeculativeCaching) {
                speculativeTypeTracker.addSpeculativeType(
                    node,
                    typeResult,
                    incompleteGenCount,
                    inferenceContext?.expectedType
                );
            }
        }
    }

    function setTypeResultForNode(node: ParseNode, typeResult: TypeResult, flags = EvalFlags.None) {
        writeTypeCache(node, typeResult, flags);
    }

    function captureContextualLambdaTypes(node: LambdaNode, typeResult?: TypeResult) {
        const cache = contextualLambdaTypeCache;
        if (!cache || !cache.lambdaNodes.some((root) => ParseTreeUtils.isNodeContainedWithin(node, root))) {
            return;
        }

        captureLambdaTypeCacheEntries(node, cache, typeResult);
    }

    function captureLambdaTypeCacheEntries(node: ParseNode, cache: ContextualLambdaTypeCache, typeResult?: TypeResult) {
        checkForCancellation();
        const entry = typeResult ? { typeResult, flags: EvalFlags.None, incompleteGenCount } : readTypeCacheEntry(node);
        if (entry && !entry.typeResult.isIncomplete) {
            captureLambdaTypeCacheEntry(node, cache, entry);
        }

        if (typeResult) {
            return;
        }

        for (const child of getChildNodes(node)) {
            // Nested lambdas capture their own contextual types before any
            // non-contextual fallback can replace them.
            if (child && child.nodeType !== ParseNodeType.Lambda) {
                captureLambdaTypeCacheEntries(child, cache);
            }
        }
    }

    function captureLambdaTypeCacheEntry(node: ParseNode, cache: ContextualLambdaTypeCache, entry: TypeCacheEntry) {
        const nodeEntries = cache.entries.get(node) ?? new Map<number, TypeCacheEntry>();
        // Generic inference can revisit a lambda within the same callable branch.
        nodeEntries.set(cache.branchIndex, entry);
        cache.entries.set(node, nodeEntries);
    }

    function combineContextualLambdaTypes(cache: ContextualLambdaTypeCache) {
        for (const [node, branchEntries] of cache.entries) {
            checkForCancellation();
            const nodeEntries = Array.from(branchEntries.values());
            const lastEntry = nodeEntries[nodeEntries.length - 1];
            writeTypeCache(
                node,
                {
                    ...lastEntry.typeResult,
                    type: combineTypes(nodeEntries.map((entry) => entry.typeResult.type)),
                    typeErrors: nodeEntries.some((entry) => entry.typeResult.typeErrors),
                },
                readTypeCacheEntry(node)?.flags ?? lastEntry.flags
            );

            const parentCache = contextualLambdaTypeCache;
            const combinedEntry = readTypeCacheEntry(node);
            if (
                parentCache &&
                combinedEntry &&
                parentCache.lambdaNodes.some((root) => ParseTreeUtils.isNodeContainedWithin(node, root))
            ) {
                captureLambdaTypeCacheEntry(node, parentCache, combinedEntry);
            }
        }
    }

    function getMaxCodeComplexity(): number {
        return maxCodeComplexity;
    }

    function setAsymmetricDescriptorAssignment(node: ParseNode) {
        if (isSpeculativeModeInUse(/* node */ undefined)) {
            return;
        }

        asymmetricAccessorAssignmentCache.add(node.id);
    }

    function isAsymmetricAccessorAssignment(node: ParseNode) {
        return asymmetricAccessorAssignmentCache.has(node.id);
    }

    // Determines whether the specified node is contained within
    // the function node corresponding to the function that we
    // are currently analyzing in the context of parameter types
    // defined by a call site.
    function isNodeInReturnTypeInferenceContext(node: ParseNode) {
        return returnTypeInference.isNodeInReturnTypeInferenceContext(node);
    }

    function getCodeFlowAnalyzerForReturnTypeInferenceContext() {
        return returnTypeInference.getCodeFlowAnalyzerForReturnTypeInferenceContext();
    }

    function getIndexOfSymbolResolution(symbol: Symbol, declaration: Declaration) {
        return memberResolution.getIndexOfSymbolResolution(symbol, declaration);
    }

    function pushSymbolResolution(symbol: Symbol, declaration: Declaration) {
        return memberResolution.pushSymbolResolution(symbol, declaration);
    }

    function popSymbolResolution(symbol: Symbol) {
        return memberResolution.popSymbolResolution(symbol);
    }

    function setSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration, type: Type) {
        return memberResolution.setSymbolResolutionPartialType(symbol, declaration, type);
    }

    function getSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration): Type | undefined {
        return memberResolution.getSymbolResolutionPartialType(symbol, declaration);
    }

    function finishOverloadActivation() {
        if (!returnTypeInferenceTypeCache && !isSpeculativeModeInUse(undefined)) {
            try {
                evaluatorOptions.experimentalOverloadResult!.finishActivation();
            } finally {
                // Install routing before an activation restart re-enters evaluation.
                if (evaluatorOptions.experimentalOverloadResult!.roots.size) {
                    operationRouter = operationController;
                }
            }
        }
    }

    function runWithOverloadActivation<T>(callback: () => T): T {
        return evaluatorOptions.experimentalOverloadResult!.runWithActivation(() => {
            const result = callback();
            if (evaluatorOptions.experimentalOverloadResult!.hasPendingActivation) {
                finishOverloadActivation();
            }
            return result;
        });
    }

    // Determines the type of the specified node by evaluating it in
    // context, logging any errors in the process. This may require the
    // type of surrounding statements to be evaluated.
    function getType(node: ExpressionNode): Type | undefined {
        if (evaluatorOptions.experimentalOverloadResult?.needsActivationBoundary()) {
            return runWithOverloadActivation(() => getType(node));
        }
        const canonical =
            operationRouter?.route?.({ kind: 'query', node })?.result ??
            evaluatorOptions.testOnlyExpression?.query?.(node);
        if (canonical) {
            return canonical.type;
        }
        initializePrefetchedTypes(node);

        let type = evaluateContextualTypeForSubnode(node, () => {
            evaluateTypesForExpressionInContext(node);
        })?.type;

        // If this is a type parameter with a calculated variance, see if we
        // can swap it out for a version that has a computed variance.
        if (type && isTypeVar(type) && type.shared.declaredVariance === Variance.Auto) {
            const typeVarType = type;
            const typeParamListNode = ParseTreeUtils.getParentNodeOfType<TypeParameterListNode>(
                node,
                ParseNodeType.TypeParameterList
            );

            if (typeParamListNode?.parent?.nodeType === ParseNodeType.Class) {
                const classTypeResult = getTypeOfClass(typeParamListNode.parent);

                if (classTypeResult) {
                    inferVarianceForClass(classTypeResult.classType);

                    const typeParam = classTypeResult.classType.shared.typeParams.find((param) =>
                        isTypeSame(param, typeVarType, { ignoreTypeFlags: true })
                    );

                    if (typeParam?.priv.computedVariance !== undefined) {
                        type = TypeVarType.cloneWithComputedVariance(type, typeParam.priv.computedVariance);
                    }
                }
            } else if (typeParamListNode?.parent?.nodeType === ParseNodeType.TypeAlias) {
                const typeAliasType = getTypeOfTypeAlias(typeParamListNode.parent);
                const typeParamIndex = typeParamListNode.d.params.findIndex((param) => param.d.name === node);

                if (typeParamIndex >= 0) {
                    inferVarianceForTypeAlias(typeAliasType);

                    const typeAliasInfo = typeAliasType.props?.typeAliasInfo;
                    if (typeAliasInfo?.shared.computedVariance) {
                        const computedVariance = typeAliasInfo.shared.computedVariance[typeParamIndex];

                        type = TypeVarType.cloneWithComputedVariance(type, computedVariance);
                    }
                }
            }
        }

        if (type) {
            type = transformPossibleRecursiveTypeAlias(type);
        }

        return type;
    }

    function getTypeResult(node: ExpressionNode): TypeResult | undefined {
        if (evaluatorOptions.experimentalOverloadResult?.needsActivationBoundary()) {
            return runWithOverloadActivation(() => getTypeResult(node));
        }
        const canonical =
            operationRouter?.route?.({ kind: 'query', node })?.result ??
            evaluatorOptions.testOnlyExpression?.query?.(node);
        if (canonical) {
            return canonical;
        }
        return evaluateContextualTypeForSubnode(node, () => {
            evaluateTypesForExpressionInContext(node);
        });
    }

    function getTypeResultForDecorator(node: DecoratorNode): TypeResult | undefined {
        return evaluateContextualTypeForSubnode(node, () => {
            evaluateTypesForExpressionInContext(node.d.expr);
        });
    }

    // Reads the type of the node from the cache.
    function getCachedType(node: ExpressionNode | DecoratorNode): Type | undefined {
        // Prefer the ordinary runtime type when both caches contain an entry for this node.
        // Fall back to the contextual cache so TypeForm-only evaluations remain discoverable.
        const cacheEntry = readTypeCacheEntry(node) ?? readContextualTypeCacheEntryForNode(node);
        if (!cacheEntry || cacheEntry.typeResult.isIncomplete) {
            return undefined;
        }

        return cacheEntry.typeResult.type;
    }

    // Determines the expected type of a specified node based on surrounding
    // context. For example, if it's a subexpression of an argument expression,
    // the associated parameter type might inform the expected type.
    function getExpectedType(node: ExpressionNode): ExpectedTypeResult | undefined {
        // This is a primary entry point called by language server providers,
        // and it might be called before any other type evaluation has occurred.
        // Use this opportunity to do some initialization.
        initializePrefetchedTypes(node);

        // Scan up the parse tree to find the top-most expression node
        // so we can evaluate the entire expression.
        let topExpression = node;
        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (isExpressionNode(curNode)) {
                topExpression = curNode;
            }

            curNode = curNode.parent;
        }

        // Evaluate the expression. This will have the side effect of
        // storing an expected type in the expected type cache.
        evaluateTypesForExpressionInContext(topExpression);

        // Look for the resulting expected type by scanning up the parse tree.
        curNode = node;
        while (curNode) {
            const expectedType = expectedTypeCache.get(curNode.id);
            if (expectedType) {
                return {
                    type: expectedType.type,
                    node: curNode,
                    candidates: ensureExpectedTypeCandidates(expectedType.type, expectedType.candidates),
                };
            }

            if (curNode === topExpression) {
                break;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    function addExpectedTypeCacheEntry(node: ParseNode, expectedType: Type) {
        const cached = expectedTypeCache.get(node.id);
        if (!cached) {
            expectedTypeCache.set(node.id, {
                type: expectedType,
                candidates: [expectedType],
            });
            return;
        }

        cached.type = expectedType;
        if (!cached.candidates.some((candidate) => isTypeSame(candidate, expectedType))) {
            cached.candidates.push(expectedType);
        }
    }

    function initializePrefetchedTypes(node: ParseNode) {
        if (!prefetched) {
            // Some of these types have cyclical dependencies on each other,
            // so don't re-enter this block once we start executing it.
            prefetched = {};

            const fileInfo = nodeInfo.getFileInfo(node);

            prefetched.objectClass = getBuiltInType(node, 'object');
            prefetched.typeClass = getBuiltInType(node, 'type');
            prefetched.functionClass = getTypesType(node, 'FunctionType') ?? getBuiltInType(node, 'function');
            prefetched.methodClass = getTypesType(node, 'MethodType');

            prefetched.unionTypeClass = getTypesType(node, 'UnionType');
            if (prefetched.unionTypeClass && isClass(prefetched.unionTypeClass)) {
                prefetched.unionTypeClass.shared.flags |= ClassTypeFlags.SpecialFormClass;
            }

            // Initialize and cache "Collection" to break a cyclical dependency
            // that occurs when resolving tuple below.
            getTypingType(node, 'Collection');

            prefetched.noneTypeClass = getTypeshedType(node, 'NoneType') ?? UnknownType.create();
            prefetched.tupleClass = getBuiltInType(node, 'tuple');
            prefetched.boolClass = getBuiltInType(node, 'bool');
            prefetched.intClass = getBuiltInType(node, 'int');
            prefetched.strClass = getBuiltInType(node, 'str');
            prefetched.dictClass = getBuiltInType(node, 'dict');
            prefetched.moduleTypeClass = getTypingType(node, 'ModuleType');
            prefetched.typedDictPrivateClass =
                getTypeCheckerInternalsType(node, 'TypedDictFallback') ?? getTypingType(node, '_TypedDict');
            prefetched.typedDictClass = getTypingType(node, 'TypedDict');
            prefetched.awaitableClass = getTypingType(node, 'Awaitable');
            prefetched.mappingClass = getTypingType(node, 'Mapping');

            // Don't attempt to resolve the string.templatelib if pyright is configured for
            // Python 3.13 or older. Doing so will either fail to resolve (if running on Python 3.13
            // or older) or resolve to the templatelib.py source file (if running on Python 3.14).
            if (PythonVersion.isGreaterOrEqualTo(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_14)) {
                prefetched.templateClass = getTypeOfModule(node, 'Template', ['string', 'templatelib']);
            } else {
                prefetched.templateClass = UnknownType.create();
            }

            prefetched.supportsKeysAndGetItemClass = getTypeshedType(node, 'SupportsKeysAndGetItem');
            if (!prefetched.supportsKeysAndGetItemClass) {
                // Fall back on 'Mapping' if 'SupportsKeysAndGetItem' is not available.
                prefetched.supportsKeysAndGetItemClass = prefetched.mappingClass;
            }

            // Wire up the `Any` class to the special-form version of our internal AnyType.
            if (
                prefetched.objectClass &&
                isInstantiableClass(prefetched.objectClass) &&
                prefetched.typeClass &&
                isInstantiableClass(prefetched.typeClass)
            ) {
                const anyClass = ClassType.createInstantiable(
                    'Any',
                    'typing.Any',
                    'typing',
                    Uri.empty(),
                    ClassTypeFlags.BuiltIn | ClassTypeFlags.SpecialFormClass | ClassTypeFlags.IllegalIsinstanceClass,
                    /* typeSourceId */ -1,
                    /* declaredMetaclass */ undefined,
                    /* effectiveMetaclass */ prefetched.typeClass
                );
                anyClass.shared.baseClasses.push(prefetched.objectClass);
                computeMroLinearization(anyClass);
                const anySpecialForm = AnyType.createSpecialForm();

                if (isAny(anySpecialForm)) {
                    TypeBase.setSpecialForm(anySpecialForm, anyClass);
                    TypeBase.setTypeForm(anySpecialForm, convertToInstance(anySpecialForm));
                }
            }
        }
    }

    function getTypeOfExpression(
        node: ExpressionNode,
        flags = EvalFlags.None,
        inferenceContext?: InferenceContext
    ): TypeResult {
        const result = getTypeOfExpressionWithCache(node, flags, inferenceContext);
        if ((flags & EvalFlags.StripTupleLiterals) !== 0 && result.type.props?.inferredTupleLiteral) {
            return { ...result, type: getInferredTupleLiteralBase(result.type) };
        }
        return result;
    }

    function getTypeOfExpressionWithCache(
        node: ExpressionNode,
        flags = EvalFlags.None,
        inferenceContext?: InferenceContext
    ): TypeResult {
        if (evaluatorOptions.experimentalOverloadResult?.needsActivationBoundary()) {
            return runWithOverloadActivation(() => getTypeOfExpression(node, flags, inferenceContext));
        }
        let useTypeFormCache = (flags & EvalFlags.TypeFormArg) !== 0;
        if (inferenceContext) {
            inferenceContext.expectedType = transformPossibleRecursiveTypeAlias(inferenceContext.expectedType);
            useTypeFormCache ||= expectedTypeWantsTypeForm(inferenceContext.expectedType);

            if (expectedTypeRequiresTypeForm(inferenceContext.expectedType)) {
                flags |= EvalFlags.TypeFormArg;
            }
        }

        if ((flags & EvalFlags.TypeFormArg) !== 0 && (flags & EvalFlags.NoConvertSpecialForm) === 0) {
            flags |= EvalFlags.NoParamSpec | EvalFlags.NoTypeVarTuple;
        }

        const testResult =
            operationRouter?.route?.({
                kind: 'expression',
                node,
                flags,
                context: inferenceContext,
            })?.result ?? operationRouter?.dispatch(node, flags, inferenceContext);
        if (testResult) {
            return testResult;
        }

        // Is this type already cached?
        const cacheEntry = useTypeFormCache
            ? readTypeFormTypeCacheEntry(node, inferenceContext?.expectedType)
            : readTypeCacheEntry(node);
        if (cacheEntry) {
            if (!cacheEntry.typeResult.isIncomplete || cacheEntry.incompleteGenCount === incompleteGenCount) {
                if (printExpressionTypes) {
                    console.log(
                        `${getPrintExpressionTypesSpaces()}${ParseTreeUtils.printExpression(node)} (${getLineNum(
                            node
                        )}): Cached ${printType(cacheEntry.typeResult.type)} ${
                            cacheEntry.typeResult.typeErrors ? ' Errors' : ''
                        }`
                    );
                }

                return cacheEntry.typeResult;
            }
        }

        // Is it cached in the speculative type cache?
        const specCacheEntry = useTypeFormCache
            ? undefined
            : speculativeTypeTracker.getSpeculativeType(node, inferenceContext?.expectedType);
        if (specCacheEntry) {
            if (
                !specCacheEntry.typeResult.isIncomplete ||
                specCacheEntry.incompleteGenerationCount === incompleteGenCount
            ) {
                if (printExpressionTypes) {
                    console.log(
                        `${getPrintExpressionTypesSpaces()}${ParseTreeUtils.printExpression(node)} (${getLineNum(
                            node
                        )}): Speculative ${printType(specCacheEntry.typeResult.type)}`
                    );
                }

                return specCacheEntry.typeResult;
            }
        }

        if (printExpressionTypes) {
            console.log(
                `${getPrintExpressionTypesSpaces()}${ParseTreeUtils.printExpression(node)} (${getLineNum(node)}): Pre`
            );
            printExpressionSpaceCount++;
        }

        // This is a frequently-called routine, so it's a good place to call
        // the cancellation check. If the operation is canceled, an exception
        // will be thrown at this point.
        checkForCancellation();

        // If we haven't already fetched some core type definitions from the
        // typeshed stubs, do so here. It would be better to fetch this when it's
        // needed in assignType, but we don't have access to the parse tree
        // at that point.
        initializePrefetchedTypes(node);

        let typeResult = getTypeOfExpressionCore(node, flags, inferenceContext);
        if (evaluatorOptions.experimentalOverloadResult?.hasPendingActivation) {
            finishOverloadActivation();
        }
        if (operationRouter) {
            typeResult = operationRouter.project(node, typeResult);
        }

        // Should we disable type promotions for bytes?
        if (
            isInstantiableClass(typeResult.type) &&
            typeResult.type.priv.includePromotions &&
            !typeResult.type.priv.includeSubclasses &&
            ClassType.isBuiltIn(typeResult.type, 'bytes')
        ) {
            if (nodeInfo.getFileInfo(node).diagnosticRuleSet.disableBytesTypePromotions) {
                typeResult = {
                    ...typeResult,
                    type: ClassType.cloneRemoveTypePromotions(typeResult.type),
                };
            }
        }

        if (inferenceContext) {
            // Handle TypeForm assignments.
            typeResult.type = convertToTypeFormType(inferenceContext.expectedType, typeResult.type);
        }

        // Don't allow speculative caching for assignment expressions because
        // the target name node won't have a corresponding type cached speculatively.
        const allowSpeculativeCaching = node.nodeType !== ParseNodeType.AssignmentExpression;

        writeTypeCache(node, typeResult, flags, inferenceContext, allowSpeculativeCaching);

        if (node.nodeType === ParseNodeType.Name || node.nodeType === ParseNodeType.MemberAccess) {
            // If this is a generic function and there is a signature tracker,
            // make sure the signature is unique.
            typeResult.type = ensureSignatureIsUnique(typeResult.type, node);
        }

        // If there was an expected type, make sure that the result type is compatible.
        if (
            inferenceContext &&
            !isAnyOrUnknown(inferenceContext.expectedType) &&
            !isNever(inferenceContext.expectedType)
        ) {
            addExpectedTypeCacheEntry(node, inferenceContext.expectedType);

            if (!typeResult.isIncomplete && !typeResult.expectedTypeDiagAddendum) {
                const diag = new DiagnosticAddendum();

                // Make sure the resulting type is assignable to the expected type.
                if (
                    !assignType(
                        inferenceContext.expectedType,
                        typeResult.type,
                        diag,
                        /* constraints */ undefined,
                        AssignTypeFlags.Default
                    )
                ) {
                    // Set the typeErrors to true, but first make a copy of the
                    // type result because the (non-error) version may already
                    // be cached.
                    typeResult = { ...typeResult, typeErrors: true };
                    typeResult.expectedTypeDiagAddendum = diag;
                    diag.addTextRange(node);
                }
            }
        }

        if (printExpressionTypes) {
            printExpressionSpaceCount--;
            console.log(
                `${getPrintExpressionTypesSpaces()}${ParseTreeUtils.printExpression(node)} (${getLineNum(
                    node
                )}): Post ${printType(typeResult.type)}${typeResult.isIncomplete ? ' Incomplete' : ''}`
            );
        }

        return typeResult;
    }

    // This is a helper function that implements the core of getTypeOfExpression.
    function getTypeOfExpressionCore(
        node: ExpressionNode,
        flags = EvalFlags.None,
        inferenceContext?: InferenceContext
    ): TypeResult {
        let typeResult: TypeResult | undefined;
        let expectingInstantiable = (flags & EvalFlags.InstantiableType) !== 0;

        switch (node.nodeType) {
            case ParseNodeType.Name: {
                typeResult = getTypeOfName(node, flags);
                break;
            }

            case ParseNodeType.MemberAccess: {
                typeResult = getTypeOfMemberAccess(node, flags);
                break;
            }

            case ParseNodeType.Index: {
                typeResult = getTypeOfIndex(node, flags);
                break;
            }

            case ParseNodeType.Call: {
                typeResult = useSignatureTracker(node, () => getTypeOfCall(node, flags, inferenceContext));
                break;
            }

            case ParseNodeType.Tuple: {
                typeResult = getTypeOfTuple(evaluatorInterface, node, flags, inferenceContext, nodeInfo);
                break;
            }

            case ParseNodeType.Constant: {
                typeResult = getTypeOfConstant(node, flags);
                break;
            }

            case ParseNodeType.StringList: {
                if ((flags & EvalFlags.StrLiteralAsType) !== 0) {
                    // Don't report expecting type errors again. We will have already
                    // reported them when analyzing the contents of the string.
                    expectingInstantiable = false;
                }

                typeResult = getTypeOfStringList(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.Number: {
                typeResult = getTypeOfNumber(node, typeResult);
                break;
            }

            case ParseNodeType.Ellipsis: {
                typeResult = getTypeOfEllipsis(flags, typeResult, node);
                break;
            }

            case ParseNodeType.UnaryOperation: {
                typeResult = getTypeOfUnaryOperation(evaluatorInterface, node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.BinaryOperation: {
                let effectiveFlags = flags;

                // If we're expecting an instantiable type and this isn't a union operator,
                // don't require that the two operands are also instantiable types.
                if (expectingInstantiable && node.d.operator !== OperatorType.BitwiseOr) {
                    effectiveFlags &= ~EvalFlags.InstantiableType;
                }

                typeResult = getTypeOfBinaryOperation(
                    evaluatorInterface,
                    node,
                    effectiveFlags,
                    inferenceContext,
                    nodeInfo
                );
                break;
            }

            case ParseNodeType.AugmentedAssignment: {
                typeResult = getTypeOfAugmentedAssignment(evaluatorInterface, node, inferenceContext);
                break;
            }

            case ParseNodeType.List:
            case ParseNodeType.Set: {
                typeResult = getTypeOfListOrSet(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.Slice: {
                typeResult = getTypeOfSlice(node);
                break;
            }

            case ParseNodeType.Await: {
                typeResult = getTypeOfAwaitOperator(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.Ternary: {
                typeResult = getTypeOfTernaryOperation(evaluatorInterface, node, flags, inferenceContext, nodeInfo);
                break;
            }

            case ParseNodeType.Comprehension: {
                typeResult = getTypeOfComprehension(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.Dictionary: {
                typeResult = getTypeOfDictionary(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.Lambda: {
                typeResult = getTypeOfLambda(node, inferenceContext);
                break;
            }

            case ParseNodeType.Assignment: {
                typeResult = getTypeOfExpression(node.d.rightExpr, flags, inferenceContext);
                assignTypeToExpression(
                    node.d.leftExpr,
                    typeResult,
                    node.d.rightExpr,
                    /* ignoreEmptyContainers */ true,
                    /* allowAssignmentToFinalVar */ true
                );
                break;
            }

            case ParseNodeType.AssignmentExpression: {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.walrusNotAllowed(), node);
                }

                typeResult = getTypeOfExpression(node.d.rightExpr, flags, inferenceContext);
                assignTypeToExpression(node.d.name, typeResult, node.d.rightExpr, /* ignoreEmptyContainers */ true);
                break;
            }

            case ParseNodeType.Yield: {
                typeResult = getTypeOfYield(node);
                break;
            }

            case ParseNodeType.YieldFrom: {
                typeResult = getTypeOfYieldFrom(node);
                break;
            }

            case ParseNodeType.Unpack: {
                typeResult = getTypeOfUnpackOperator(node, flags, inferenceContext);
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                typeResult = getTypeOfExpression(
                    node.d.annotation,
                    EvalFlags.InstantiableType |
                        EvalFlags.TypeExpression |
                        EvalFlags.StrLiteralAsType |
                        EvalFlags.NoParamSpec |
                        EvalFlags.NoTypeVarTuple |
                        EvalFlags.VarTypeAnnotation
                );
                break;
            }

            case ParseNodeType.String:
            case ParseNodeType.FormatString: {
                typeResult = getTypeOfString(node);
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                suppressDiagnostics(node, () => {
                    if (node.d.child) {
                        getTypeOfExpression(node.d.child);
                    }
                });
                typeResult = { type: UnknownType.create() };
                break;
            }

            default:
                assertNever(node, `Illegal node type: ${(node as any).nodeType}`);
        }

        if (!typeResult) {
            // We shouldn't get here. If we do, report an error.
            fail(`Unhandled expression type '${ParseTreeUtils.printExpression(node)}'`);
        }

        // Do we need to validate that the type is instantiable?
        if (expectingInstantiable) {
            validateTypeIsInstantiable(typeResult, flags, node);
        }

        // If this is a PEP 695 type alias, remove the special form so the type
        // printer prints it as its aliased type rather than TypeAliasType.
        if ((flags & EvalFlags.TypeExpression) !== 0 && typeResult.type.props?.typeForm === undefined) {
            const specialForm = typeResult.type.props?.specialForm;
            if (specialForm && ClassType.isBuiltIn(specialForm, 'TypeAliasType')) {
                typeResult.type = TypeBase.cloneAsSpecialForm(typeResult.type, undefined);
            }
        }

        return typeResult;
    }

    // Reports the case where a function or class has been decorated with
    // @type_check_only and is used in a value expression.
    function reportUseOfTypeCheckOnly(type: Type, node: ExpressionNode) {
        return specialFormCreation.reportUseOfTypeCheckOnly(type, node);
    }

    function validateTypeIsInstantiable(typeResult: TypeResult, flags: EvalFlags, node: ExpressionNode) {
        return evaluatorCore.validateTypeIsInstantiable(typeResult, flags, node);
    }

    function getTypeOfAwaitOperator(node: AwaitNode, flags: EvalFlags, inferenceContext?: InferenceContext) {
        if ((flags & EvalFlags.TypeExpression) !== 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.awaitNotAllowed(), node);
            return { type: UnknownType.create() };
        }

        const expectedType = inferenceContext
            ? createAwaitableReturnType(
                  node,
                  inferenceContext.expectedType,
                  /* isGenerator */ false,
                  /* useCoroutine */ false
              )
            : undefined;

        const exprTypeResult = getTypeOfExpression(node.d.expr, flags, makeInferenceContext(expectedType));
        const awaitableResult = getTypeOfAwaitable(exprTypeResult, node.d.expr);
        const typeResult: TypeResult = {
            type: awaitableResult.type,
            isIncomplete: exprTypeResult.isIncomplete || awaitableResult.isIncomplete,
            typeErrors: exprTypeResult.typeErrors,
        };

        if (exprTypeResult.isIncomplete) {
            typeResult.isIncomplete = true;
        }
        return typeResult;
    }

    function getTypeOfEllipsis(flags: EvalFlags, typeResult: TypeResult | undefined, node: ExpressionNode) {
        return expressionEvaluation.getTypeOfEllipsis(flags, typeResult, node);
    }

    function getTypeOfNumber(node: NumberNode, typeResult: TypeResult | undefined) {
        if (node.d.isImaginary) {
            typeResult = { type: getBuiltInObject(node, 'complex') };
        } else if (node.d.isInteger) {
            typeResult = { type: cloneBuiltinObjectWithLiteral(node, 'int', node.d.value) };
        } else {
            typeResult = { type: getBuiltInObject(node, 'float') };
        }
        return typeResult;
    }

    function getTypeOfUnpackOperator(node: UnpackNode, flags: EvalFlags, inferenceContext?: InferenceContext) {
        return expressionEvaluation.getTypeOfUnpackOperator(node, flags, inferenceContext);
    }

    function getTypeOfStringList(
        node: StringListNode,
        flags: EvalFlags,
        inferenceContext?: InferenceContext
    ): TypeResult {
        return expressionEvaluation.getTypeOfStringList(node, flags, inferenceContext);
    }

    function getTypeOfString(node: StringNode | FormatStringNode): TypeResult {
        return expressionEvaluation.getTypeOfString(node);
    }

    function stripLiteralValue(type: Type): Type {
        return LiteralTypes.stripLiteralValue(type, prefetched?.strClass);
    }

    function getTypeOfParamAnnotation(paramTypeNode: ExpressionNode, paramCategory: ParamCategory) {
        return getTypeOfAnnotation(paramTypeNode, {
            typeVarGetsCurScope: true,
            allowUnpackedTuple: paramCategory === ParamCategory.ArgsList,
            allowUnpackedTypedDict: paramCategory === ParamCategory.KwargsDict,
        });
    }

    function getTypeOfAnnotation(node: ExpressionNode, options?: ExpectedTypeOptions): Type {
        const fileInfo = nodeInfo.getFileInfo(node);

        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
            const specialType = handleTypingStubTypeAnnotation(node);
            if (specialType) {
                return specialType;
            }
        }

        const adjustedOptions: ExpectedTypeOptions = options ? { ...options } : {};

        adjustedOptions.typeExpression = true;
        adjustedOptions.convertEllipsisToAny = true;

        // If the annotation is part of a comment, allow forward references
        // even if it's not enclosed in quotes.
        if (node?.parent?.nodeType === ParseNodeType.Assignment && node.parent.d.annotationComment === node) {
            adjustedOptions.forwardRefs = true;
            adjustedOptions.notParsed = true;
        } else if (node?.parent?.nodeType === ParseNodeType.FunctionAnnotation) {
            if (node.parent.d.returnAnnotation === node || node.parent.d.paramAnnotations.some((n) => n === node)) {
                adjustedOptions.forwardRefs = true;
                adjustedOptions.notParsed = true;
            }
        } else if (node?.parent?.nodeType === ParseNodeType.Parameter) {
            if (node.parent.d.annotationComment === node) {
                adjustedOptions.forwardRefs = true;
                adjustedOptions.notParsed = true;
            }
        }

        const annotationType = getTypeOfExpressionExpectingType(node, adjustedOptions).type;

        if (isModule(annotationType)) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.moduleAsType(), node);
        }

        return convertToInstance(annotationType);
    }

    function canBeFalsy(type: Type, recursionCount = 0): boolean {
        return evaluatorNarrowing.canBeFalsy(type, recursionCount);
    }

    function canBeTruthy(type: Type, recursionCount = 0): boolean {
        return evaluatorNarrowing.canBeTruthy(type, recursionCount);
    }

    // Filters a type such that that no part of it is definitely
    // truthy. For example, if a type is a union of None
    // and a custom class "Foo" that has no __len__ or __nonzero__
    // method, this method would strip off the "Foo"
    // and return only the "None".
    function removeTruthinessFromType(type: Type): Type {
        return evaluatorNarrowing.removeTruthinessFromType(type);
    }

    // Filters a type such that that no part of it is definitely
    // falsy. For example, if a type is a union of None
    // and an "int", this method would strip off the "None"
    // and return only the "int".
    function removeFalsinessFromType(type: Type): Type {
        return evaluatorNarrowing.removeFalsinessFromType(type);
    }

    function stripTypeGuard(type: Type): Type {
        return LiteralTypes.stripTypeGuard(type, prefetched?.boolClass);
    }

    function solveAndApplyConstraints(
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ): Type {
        return evaluatorCore.solveAndApplyConstraints(type, constraints, applyOptions, solveOptions);
    }

    // Gets a member type from an object or class. If it's a function, binds
    // it to the object or class. If selfType is undefined, the binding is done
    // using the objectType parameter. Callers can specify these separately
    // to handle the case where we're fetching the object member from a
    // metaclass but binding to the class.
    function getTypeOfBoundMember(
        errorNode: ExpressionNode | undefined,
        objectType: ClassType,
        memberName: string,
        usage: EvaluatorUsage = { method: 'get' },
        diag: DiagnosticAddendum | undefined = undefined,
        flags = MemberAccessFlags.Default,
        selfType?: ClassType | TypeVarType,
        recursionCount = 0
    ): TypeResult | undefined {
        if (ClassType.isPartiallyEvaluated(objectType)) {
            if (errorNode) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.classDefinitionCycle().format({ name: objectType.shared.name }),
                    errorNode
                );
            }
            return { type: UnknownType.create() };
        }

        // If this is an unspecialized generic class, specialize it using the default
        // values for its type parameters.
        if (
            isInstantiableClass(objectType) &&
            !objectType.priv.includeSubclasses &&
            objectType.shared.typeParams.length > 0
        ) {
            // Skip this if we're suppressing the use of attribute access override,
            // such as with dundered methods (like __call__).
            if ((flags & MemberAccessFlags.SkipAttributeAccessOverride) === 0) {
                objectType = specializeWithDefaultTypeArgs(objectType);
            }
        }

        // Determine the class that was used to instantiate the objectType.
        // If the objectType is a class itself, then the class used to instantiate
        // it is the metaclass.
        const objectTypeIsInstantiable = TypeBase.isInstantiable(objectType);
        const metaclass = objectType.shared.effectiveMetaclass;

        let memberInfo: ClassMemberLookup | undefined;

        // If the object type is an instantiable (i.e. it derives from "type") and
        // we've been asked not to consider instance members, don't look in the class.
        // Consider only the metaclass class variables in this case.
        let skipObjectTypeLookup = objectTypeIsInstantiable && (flags & MemberAccessFlags.SkipInstanceMembers) !== 0;

        // Look up the attribute in the metaclass first. If the member is a descriptor
        // (an object with a __get__ and __set__ method) and the access is a 'get',
        // the Python runtime uses this descriptor to satisfy the lookup. Skip this
        // costly lookup in the common case where the metaclass is 'type' since we know
        // that `type` doesn't have any attributes that are descriptors.
        if (
            usage.method === 'get' &&
            objectTypeIsInstantiable &&
            metaclass &&
            isInstantiableClass(metaclass) &&
            !ClassType.isBuiltIn(metaclass, 'type') &&
            !ClassType.isSameGenericClass(metaclass, objectType)
        ) {
            const descMemberInfo = getTypeOfClassMemberName(
                errorNode,
                metaclass,
                memberName,
                usage,
                /* diag */ undefined,
                flags | MemberAccessFlags.SkipAttributeAccessOverride | MemberAccessFlags.SkipTypedDictEntries,
                objectType,
                recursionCount
            );

            if (descMemberInfo) {
                const isProperty =
                    isClassInstance(descMemberInfo.type) && ClassType.isPropertyClass(descMemberInfo.type);
                if (isDescriptorInstance(descMemberInfo.type, /* requireSetter */ true) || isProperty) {
                    skipObjectTypeLookup = true;
                }
            }
        }

        let subDiag: DiagnosticAddendum | undefined;

        if (!skipObjectTypeLookup) {
            let effectiveFlags = flags | MemberAccessFlags.SkipTypedDictEntries;

            if (objectTypeIsInstantiable) {
                effectiveFlags |=
                    MemberAccessFlags.SkipInstanceMembers |
                    MemberAccessFlags.SkipAttributeAccessOverride |
                    MemberAccessFlags.DisallowGenericInstanceVariableAccess;
                effectiveFlags &= ~MemberAccessFlags.SkipClassMembers;
            } else {
                effectiveFlags |= MemberAccessFlags.DisallowClassVarWrites;
            }

            subDiag = diag ? new DiagnosticAddendum() : undefined;

            // See if the member is present in the object itself.
            memberInfo = getTypeOfClassMemberName(
                errorNode,
                objectType,
                memberName,
                usage,
                subDiag,
                effectiveFlags,
                selfType,
                recursionCount
            );
        }

        // If it wasn't found on the object, see if it's part of the metaclass.
        if (!memberInfo && metaclass && isInstantiableClass(metaclass)) {
            let effectiveFlags = flags;

            // Class members cannot be accessed on a class's metaclass through
            // an instance of a class. Limit access to metaclass instance members
            // in this case.
            if (!objectTypeIsInstantiable) {
                effectiveFlags |=
                    MemberAccessFlags.SkipClassMembers |
                    MemberAccessFlags.SkipAttributeAccessOverride |
                    MemberAccessFlags.SkipTypeBaseClass;
                effectiveFlags &= ~MemberAccessFlags.SkipInstanceMembers;
            }

            const metaclassDiag = diag ? new DiagnosticAddendum() : undefined;
            memberInfo = getTypeOfClassMemberName(
                errorNode,
                ClassType.cloneAsInstance(metaclass),
                memberName,
                usage,
                metaclassDiag,
                effectiveFlags,
                objectTypeIsInstantiable ? objectType : ClassType.cloneAsInstantiable(objectType),
                recursionCount
            );

            // If there was a descriptor error (as opposed to an error where the members
            // was simply not found), use this diagnostic message.
            if (memberInfo?.isDescriptorError) {
                subDiag = metaclassDiag;
            }
        }

        if (memberInfo) {
            if (memberInfo.isDescriptorError && diag && subDiag) {
                diag.addAddendum(subDiag);
            }

            return {
                type:
                    usage.method === 'get'
                        ? getTypeOfIntFlagMember(evaluatorInterface, objectType, memberInfo.type, nodeInfo)
                        : memberInfo.type,
                classType: memberInfo.classType,
                isIncomplete: !!memberInfo.isTypeIncomplete,
                isAsymmetricAccessor: memberInfo.isAsymmetricAccessor,
                narrowedTypeForSet: memberInfo.narrowedTypeForSet,
                memberAccessDeprecationInfo: memberInfo.memberAccessDeprecationInfo,
                typeErrors: memberInfo.isDescriptorError,
            };
        }

        // If this is a type[Any] or type[Unknown], allow any other members.
        if (
            isClassInstance(objectType) &&
            ClassType.isBuiltIn(objectType, 'type') &&
            objectType.priv.includeSubclasses
        ) {
            if ((flags & (MemberAccessFlags.SkipTypeBaseClass | MemberAccessFlags.SkipAttributeAccessOverride)) === 0) {
                const typeArg =
                    objectType.priv.typeArgs && objectType.priv.typeArgs.length >= 1
                        ? objectType.priv.typeArgs[0]
                        : UnknownType.create();

                if (isAnyOrUnknown(typeArg)) {
                    return { type: typeArg, classType: UnknownType.create() };
                }
            }
        }

        if (diag && subDiag) {
            diag.addAddendum(subDiag);
        }

        return undefined;
    }

    function getBoundMagicMethod(
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        diag?: DiagnosticAddendum,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        return evaluatorCore.getBoundMagicMethod(classType, memberName, selfType, errorNode, diag, recursionCount);
    }

    // Returns the signature(s) associated with a call node that contains
    // the specified node. It also returns the index of the argument
    // that contains the node.
    function getCallSignatureInfo(
        callNode: CallNode,
        activeIndex: number,
        activeOrFake: boolean
    ): CallSignatureInfo | undefined {
        const exprNode = callNode.d.leftExpr;
        const callType = getType(exprNode);
        if (!callType) {
            return undefined;
        }

        const argList: Arg[] = [];
        let previousCategory = ArgCategory.Simple;
        let hasFakeArg = false;

        // Empty arguments do not enter the AST as nodes, but instead are left blank.
        // Instead, we detect when we appear to be between two known arguments or at the
        // end of the argument list and insert a fake argument of an unknown type to have
        // something to match later.
        function addFakeArg() {
            hasFakeArg = true;
            argList.push({
                argCategory: previousCategory,
                typeResult: { type: UnknownType.create() },
                active: true,
            });
        }

        callNode.d.args.forEach((arg, index) => {
            let active = false;
            if (index === activeIndex) {
                if (activeOrFake) {
                    active = true;
                } else {
                    addFakeArg();
                }
            }

            previousCategory = arg.d.argCategory;

            argList.push({
                valueExpression: arg.d.valueExpr,
                argCategory: arg.d.argCategory,
                name: arg.d.name,
                active: active,
            });
        });

        if (callNode.d.args.length < activeIndex) {
            addFakeArg();
        }

        let signatures: CallSignature[] = [];

        function addOneFunctionToSignature(type: FunctionType) {
            let callResult: CallResult | undefined;
            const constraints = new ConstraintTracker();

            useSpeculativeMode(callNode, () => {
                callResult = validateArgs(
                    exprNode,
                    argList,
                    { type },
                    constraints,
                    /* skipUnknownArgCheck */ true,
                    /* inferenceContext */ undefined
                );
            });

            let specializedType: Type = type;
            if (FunctionType.getParamSpecFromArgsKwargs(type)) {
                const solution = solveConstraints(evaluatorInterface, constraints);

                // The fake argument is used only to identify the active parameter. Preserve
                // type variables in that parameter while specializing the forwarded ParamSpec.
                if (hasFakeArg && callResult?.activeParam) {
                    const activeParamIndex = type.shared.parameters.indexOf(callResult.activeParam);
                    if (activeParamIndex >= 0) {
                        getTypeVarArgsRecursive(FunctionType.getParamType(type, activeParamIndex)).forEach(
                            (typeVar) => {
                                if (!isParamSpec(typeVar)) {
                                    solution.doForEachSolutionSet((solutionSet) => {
                                        const solvedType = solutionSet.getType(typeVar);
                                        if (!solvedType || isUnknown(solvedType)) {
                                            solutionSet.setType(typeVar, typeVar);
                                        }
                                    });
                                }
                            }
                        );
                    }
                }

                specializedType = applySolvedTypeVars(type, solution);
            }
            const finalType = isFunction(specializedType) ? specializedType : type;
            const hasActiveArg = argList.some((arg) => arg.active);

            // If the type was specialized (e.g. ParamSpec expansion), the activeParam
            // from the original validateArgs refers to parameters in the unspecialized
            // type and won't match the specialized type's parameters. Re-run validateArgs
            // against the specialized type to get the correct activeParam mapping.
            let activeParam = callResult?.activeParam;
            if (hasActiveArg && finalType !== type) {
                let specializedActiveParam: typeof activeParam | undefined;
                useSpeculativeMode(callNode, () => {
                    const specializedResult = validateArgs(
                        exprNode,
                        argList,
                        { type: finalType },
                        new ConstraintTracker(),
                        /* skipUnknownArgCheck */ true,
                        /* inferenceContext */ undefined
                    );
                    specializedActiveParam = specializedResult?.activeParam;
                });
                if (specializedActiveParam) {
                    activeParam = specializedActiveParam;
                }
            }

            signatures.push({
                type: expandTypedKwargs(finalType),
                activeParam,
            });
        }

        function addFunctionToSignature(type: FunctionType | OverloadedType) {
            if (isFunction(type)) {
                addOneFunctionToSignature(type);
            } else {
                OverloadedType.getOverloads(type).forEach((func) => {
                    addOneFunctionToSignature(func);
                });
            }
        }

        doForEachSubtype(callType, (subtype) => {
            switch (subtype.category) {
                case TypeCategory.Function:
                case TypeCategory.Overloaded: {
                    addFunctionToSignature(subtype);
                    break;
                }

                case TypeCategory.Class: {
                    if (TypeBase.isInstantiable(subtype)) {
                        const constructorType = createFunctionFromConstructor(
                            evaluatorInterface,
                            subtype,
                            /* selfType */ undefined,
                            /* recursionCount */ 0,
                            /* retainUnboundNewOverloads */ true
                        );

                        if (constructorType) {
                            doForEachSubtype(constructorType, (subtype) => {
                                if (isFunctionOrOverloaded(subtype)) {
                                    addFunctionToSignature(subtype);
                                }
                            });

                            // It's common for either the `__new__` or `__init__` methods to be
                            // simple (*args: Any, **kwargs: Any) signatures. If so, we'll try
                            // to filter out these signatures if they add nothing of value.
                            const filteredSignatures = signatures.filter(
                                (sig) =>
                                    !FunctionType.isGradualCallableForm(sig.type) ||
                                    sig.type.shared.parameters.length > 2 ||
                                    sig.type.shared.docString ||
                                    sig.type.shared.deprecatedMessage
                            );

                            if (filteredSignatures.length > 0) {
                                signatures = filteredSignatures;
                            }
                        }
                    } else {
                        const methodType = getBoundMagicMethod(subtype, '__call__');
                        if (methodType) {
                            addFunctionToSignature(methodType);
                        }
                    }
                    break;
                }
            }
        });

        if (signatures.length === 0) {
            return undefined;
        }

        return { callNode, signatures };
    }

    // If the function includes a `**kwargs: Unpack[TypedDict]` parameter, the
    // parameter is expanded to include individual keyword args.
    function expandTypedKwargs(functionType: FunctionType): FunctionType {
        return typeVarHandling.expandTypedKwargs(functionType);
    }

    // Determines whether the specified expression is an explicit TypeAlias declaration.
    function isDeclaredTypeAlias(expression: ExpressionNode): boolean {
        return memberResolution.isDeclaredTypeAlias(expression);
    }

    // Given a member symbol and the context in which it was accessed, computes
    // the declared type of the member (applying descriptor setter types, partial
    // specialization, and function binding as appropriate). Returns undefined if
    // the symbol has no declared type.
    function resolveDeclaredMemberType(
        symbol: Symbol,
        classOrObjectBase: ClassType | undefined,
        memberAccessClass: Type | undefined,
        useDescriptorSetterType: boolean,
        bindFunction: boolean,
        selfType: ClassType | TypeVarType | undefined
    ): Type | undefined {
        let declaredType = getDeclaredTypeOfSymbol(symbol)?.type;
        if (!declaredType) {
            return undefined;
        }

        // If it's a descriptor, we need to get the setter type.
        if (useDescriptorSetterType && isClassInstance(declaredType)) {
            const setter = getBoundMagicMethod(declaredType, '__set__');
            if (setter && isFunction(setter) && setter.shared.parameters.length >= 2) {
                declaredType = FunctionType.getParamType(setter, 1);

                if (isAnyOrUnknown(declaredType)) {
                    return undefined;
                }
            }
        }

        if (classOrObjectBase) {
            if (memberAccessClass && isInstantiableClass(memberAccessClass)) {
                declaredType = partiallySpecializeType(declaredType, memberAccessClass, getTypeClassType(), selfType);
            }

            if (isFunctionOrOverloaded(declaredType)) {
                if (bindFunction) {
                    declaredType = bindFunctionToClassOrObject(
                        classOrObjectBase,
                        declaredType,
                        /* memberClass */ undefined,
                        /* treatConstructorAsClassMethod */ undefined,
                        selfType
                    );
                }
            }
        }

        return declaredType;
    }

    // Determines whether the specified expression is a symbol with a declared type.
    function getDeclaredTypeForExpression(expression: ExpressionNode, usage?: EvaluatorUsage): Type | undefined {
        return expressionEvaluation.getDeclaredTypeForExpression(expression, usage);
    }

    // Applies an "await" operation to the specified type and returns
    // the result. According to PEP 492, await operates on an Awaitable
    // (object that provides an __await__ that returns a generator object).
    // If errorNode is undefined, no errors are reported.
    function getTypeOfAwaitable(typeResult: TypeResult, errorNode?: ExpressionNode): TypeResult {
        return evaluatorCore.getTypeOfAwaitable(typeResult, errorNode);
    }

    // Validates that the type is an iterator and returns the iterated type
    // (i.e. the type returned from the '__next__' or '__anext__' method).
    function getTypeOfIterator(
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError = true
    ): TypeResult | undefined {
        return expressionEvaluation.getTypeOfIterator(typeResult, isAsync, errorNode, emitNotIterableError);
    }

    // Validates that the type is an iterable and returns the iterable type argument.
    function getTypeOfIterable(
        typeResult: TypeResult,
        isAsync: boolean,
        errorNode: ExpressionNode,
        emitNotIterableError = true
    ): TypeResult | undefined {
        return expressionEvaluation.getTypeOfIterable(typeResult, isAsync, errorNode, emitNotIterableError);
    }

    function getTypedDictClassType(): ClassType | undefined {
        return evaluatorCore.getTypedDictClassType();
    }

    function getTupleClassType(): ClassType | undefined {
        return evaluatorCore.getTupleClassType();
    }

    function getDictClassType(): ClassType | undefined {
        return evaluatorCore.getDictClassType();
    }

    function getStrClassType(): ClassType | undefined {
        return evaluatorCore.getStrClassType();
    }

    function getObjectType(): Type {
        return evaluatorCore.getObjectType();
    }

    function getNoneType(): Type {
        return evaluatorCore.getNoneType();
    }

    function getUnionClassType(): Type {
        return evaluatorCore.getUnionClassType();
    }

    function getTypeClassType(): ClassType | undefined {
        return evaluatorCore.getTypeClassType();
    }

    function getFunctionClassType(type: FunctionType | OverloadedType): ClassType | undefined {
        const classType = isMethodType(type) ? prefetched?.methodClass : prefetched?.functionClass;
        return classType && isInstantiableClass(classType) ? classType : undefined;
    }

    function getTypingType(node: ParseNode, symbolName: string): Type | undefined {
        return (
            getTypeOfModule(node, symbolName, ['typing']) ?? getTypeOfModule(node, symbolName, ['typing_extensions'])
        );
    }

    function getTypeCheckerInternalsType(node: ParseNode, symbolName: string): Type | undefined {
        return getTypeOfModule(node, symbolName, ['_typeshed', '_type_checker_internals']);
    }

    function getTypesType(node: ParseNode, symbolName: string): Type | undefined {
        return getTypeOfModule(node, symbolName, ['types']);
    }

    function getTypeshedType(node: ParseNode, symbolName: string): Type | undefined {
        return getTypeOfModule(node, symbolName, ['_typeshed']);
    }

    function getTypeOfModule(node: ParseNode, symbolName: string, nameParts: string[]) {
        const fileInfo = nodeInfo.getFileInfo(node);
        const lookupResult = importLookup({ nameParts, importingFileUri: fileInfo.fileUri });

        if (!lookupResult) {
            return undefined;
        }

        const symbol = lookupResult.symbolTable.get(symbolName);
        if (!symbol) {
            return undefined;
        }

        return getEffectiveTypeOfSymbol(symbol);
    }

    function checkCodeFlowTooComplex(node: ParseNode): boolean {
        return flowAnalysis.checkCodeFlowTooComplex(node);
    }

    function isNodeReachable(node: ParseNode, sourceNode?: ParseNode): boolean {
        return flowAnalysis.isNodeReachable(node, sourceNode);
    }

    function isAfterNodeReachable(node: ParseNode): boolean {
        return flowAnalysis.isAfterNodeReachable(node);
    }

    function getNodeReachability(node: ParseNode, sourceNode?: ParseNode): Reachability {
        return flowAnalysis.getNodeReachability(node, sourceNode);
    }

    function getAfterNodeReachability(node: ParseNode): Reachability {
        return flowAnalysis.getAfterNodeReachability(node);
    }

    // Determines whether there is a code flow path from sourceNode to sinkNode.
    function isFlowPathBetweenNodes(sourceNode: ParseNode, sinkNode: ParseNode, allowSelf = true) {
        return flowAnalysis.isFlowPathBetweenNodes(sourceNode, sinkNode, allowSelf);
    }

    function addInformation(message: string, node: ParseNode, range?: TextRange) {
        return diagnostics.addInformation(message, node, range);
    }

    function addUnreachableCode(node: ParseNode, reachability: Reachability, textRange: TextRange) {
        return diagnostics.addUnreachableCode(node, reachability, textRange);
    }

    function addDeprecated(message: string, node: ParseNode) {
        return diagnostics.addDeprecated(message, node);
    }

    // This function is similar to isDiagnosticSuppressedForNode except that it
    // returns false if diagnostics are suppressed for the node but the caller
    // has requested that diagnostics be generated anyway.
    function canSkipDiagnosticForNode(node: ParseNode) {
        return diagnostics.canSkipDiagnosticForNode(node);
    }

    function addDiagnostic(rule: DiagnosticRule, message: string, node: ParseNode, range?: TextRange) {
        return diagnostics.addDiagnostic(rule, message, node, range);
    }

    function addDiagnosticForTextRange(
        fileInfo: AnalyzerFileInfo,
        rule: DiagnosticRule,
        message: string,
        range: TextRange
    ) {
        return diagnostics.addDiagnosticForTextRange(fileInfo, rule, message, range);
    }

    function assignTypeToNameNode(
        nameNode: NameNode,
        typeResult: TypeResult,
        ignoreEmptyContainers: boolean,
        srcExpression?: ParseNode,
        allowAssignmentToFinalVar = false,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        const nameValue = nameNode.d.value;

        const symbolWithScope = lookUpSymbolRecursive(nameNode, nameValue, /* honorCodeFlow */ false);
        if (!symbolWithScope) {
            // This can happen when we are evaluating a piece of code that was
            // determined to be unreachable by the binder.
            return;
        }

        const declarations = symbolWithScope.symbol.getDeclarations();
        let declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol)?.type;
        const fileInfo = nodeInfo.getFileInfo(nameNode);

        // Class-scope aliases need the canonical method type for binding and override checks.
        if (declaredType === undefined && symbolWithScope.scope.type === ScopeType.Class) {
            const methodType = getMethodFromDescriptor(typeResult.type);
            if (methodType) {
                typeResult = { ...typeResult, type: methodType };
            }
        }

        // If this is a class scope and there is no type declared for this class variable,
        // see if a parent class has a type declared.
        if (declaredType === undefined && symbolWithScope.scope.type === ScopeType.Class) {
            const containingClass = ParseTreeUtils.getEnclosingClass(nameNode);
            if (containingClass) {
                const classType = getTypeOfClass(containingClass);
                if (classType) {
                    const memberInfo = lookUpClassMember(
                        classType.classType,
                        nameNode.d.value,
                        MemberAccessFlags.SkipOriginalClass
                    );
                    if (memberInfo?.isTypeDeclared) {
                        declaredType = getTypeOfMember(memberInfo);
                        if (
                            isMethodExemptFromLsp(nameValue) &&
                            memberInfo.symbol
                                .getTypedDeclarations()
                                .some((decl) => decl.type === DeclarationType.Function) &&
                            isFunctionOrOverloaded(typeResult.type) &&
                            isFunctionOrOverloaded(declaredType) &&
                            !isFinalVariable(memberInfo.symbol)
                        ) {
                            const baseMethods = isFunction(declaredType)
                                ? [declaredType]
                                : [
                                      ...OverloadedType.getOverloads(declaredType),
                                      OverloadedType.getImplementation(declaredType),
                                  ];
                            if (
                                !baseMethods.some(
                                    (method) => method && isFunction(method) && FunctionType.isFinal(method)
                                )
                            ) {
                                // Apply the same override exemptions to aliases and method definitions.
                                declaredType = undefined;
                            }
                        }
                    }
                }
            }
        }

        // We found an existing declared type. Make sure the type is assignable.
        let destType = typeResult.type;
        const isTypeAlias =
            !!declaredType && isClassInstance(declaredType) && ClassType.isBuiltIn(declaredType, 'TypeAlias');

        if (declaredType && !isTypeAlias) {
            let diagAddendum = new DiagnosticAddendum();

            const liveScopeIds = getTypeVarScopesForNode(nameNode);
            const boundDeclaredType = makeTypeVarsBound(declaredType, liveScopeIds);
            const srcType = makeTypeVarsBound(typeResult.type, liveScopeIds);

            if (!assignType(boundDeclaredType, srcType, diagAddendum)) {
                // If there was an expected type mismatch, use that diagnostic
                // addendum because it will be more informative.
                if (expectedTypeDiagAddendum) {
                    diagAddendum = expectedTypeDiagAddendum;
                }

                if (!typeResult.isIncomplete) {
                    addDiagnostic(
                        DiagnosticRule.reportAssignmentType,
                        LocMessage.typeAssignmentMismatch().format(printSrcDestTypes(typeResult.type, declaredType)) +
                            diagAddendum.getString(),
                        srcExpression ?? nameNode,
                        diagAddendum.getEffectiveTextRange() ?? srcExpression ?? nameNode
                    );
                }

                // Replace the assigned type with the (unnarrowed) declared type.
                destType = declaredType;
            } else {
                // Constrain the resulting type to match the declared type.
                destType = narrowTypeBasedOnAssignment(declaredType, typeResult).type;
            }
        } else {
            // If this is a member name (within a class scope) and the member name
            // appears to be a constant, use the strict source type. If it's a member
            // variable that can be overridden by a child class, use the more general
            // version by stripping off the literal and TypeForm.
            const scope = getScopeForNode(nameNode);
            if (scope?.type === ScopeType.Class) {
                if (
                    TypeBase.isInstance(destType) &&
                    !isConstantName(nameValue) &&
                    !isFinalVariable(symbolWithScope.symbol)
                ) {
                    destType = stripTypeForm(stripLiteralValue(destType));
                }
            }
        }

        const varDeclIndex = declarations.findIndex((decl) => decl.type === DeclarationType.Variable);
        const varDecl = varDeclIndex >= 0 ? declarations[varDeclIndex] : undefined;

        // Are there any non-var decls before the var decl?
        const nonVarDecl = declarations.find(
            (decl, index) => varDeclIndex < index && decl.type !== DeclarationType.Variable
        );

        if (varDecl && varDecl.type === DeclarationType.Variable) {
            if (varDecl.isConstant) {
                // A constant variable can be assigned only once. If this
                // isn't the first assignment, generate an error.
                if (nameNode !== getNameNodeForDeclaration(declarations[0]) || !!nonVarDecl) {
                    addDiagnostic(
                        DiagnosticRule.reportConstantRedefinition,
                        LocMessage.constantRedefinition().format({ name: nameValue }),
                        nameNode
                    );
                }
            } else if (isFinalVariableDeclaration(varDecl) && !allowAssignmentToFinalVar) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.finalReassigned().format({ name: nameValue }),
                    nameNode
                );
            }
        }

        if (!typeResult.isIncomplete) {
            reportPossibleUnknownAssignment(
                fileInfo.diagnosticRuleSet.reportUnknownVariableType,
                DiagnosticRule.reportUnknownVariableType,
                nameNode,
                typeResult.type,
                nameNode,
                ignoreEmptyContainers
            );
        }

        writeTypeCache(nameNode, { type: destType, isIncomplete: typeResult.isIncomplete }, EvalFlags.None);
    }

    function assignTypeToMemberAccessNode(
        target: MemberAccessNode,
        typeResult: TypeResult,
        srcExpr?: ExpressionNode,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        const baseTypeResult = getTypeOfExpression(target.d.leftExpr, EvalFlags.MemberAccessBaseDefaults);
        const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);
        let enclosingClass: ClassType | undefined;

        // Handle member accesses (e.g. self.x or cls.y).
        if (target.d.leftExpr.nodeType === ParseNodeType.Name) {
            // Determine whether we're writing to a class or instance member.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

            if (enclosingClassNode) {
                const classTypeResults = getTypeOfClass(enclosingClassNode);

                if (classTypeResults && isInstantiableClass(classTypeResults.classType)) {
                    enclosingClass = classTypeResults.classType;

                    if (isClassInstance(baseType)) {
                        if (
                            ClassType.isSameGenericClass(
                                ClassType.cloneAsInstantiable(baseType),
                                classTypeResults.classType
                            )
                        ) {
                            assignTypeToMemberVariable(target, typeResult, /* isInstanceMember */ true, srcExpr);
                        }
                    } else if (isInstantiableClass(baseType)) {
                        if (ClassType.isSameGenericClass(baseType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, typeResult, /* isInstanceMember */ false, srcExpr);
                        }
                    }

                    // Assignments to instance or class variables through "self" or "cls" is not
                    // allowed for protocol classes unless it is also declared within the class.
                    if (ClassType.isProtocolClass(classTypeResults.classType)) {
                        const memberSymbol = ClassType.getSymbolTable(classTypeResults.classType).get(
                            target.d.member.d.value
                        );
                        if (memberSymbol) {
                            const classLevelDecls = memberSymbol.getDeclarations().filter((decl) => {
                                return !ParseTreeUtils.getEnclosingFunction(decl.node);
                            });
                            if (classLevelDecls.length === 0) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.assignmentInProtocol(),
                                    target.d.member
                                );
                            }
                        }
                    }
                }
            }
        }

        const setTypeResult = getTypeOfMemberAccessWithBaseType(
            target,
            baseTypeResult,
            {
                method: 'set',
                setType: typeResult,
                setErrorNode: srcExpr,
                setExpectedTypeDiag: expectedTypeDiagAddendum,
            },
            EvalFlags.None
        );

        if (setTypeResult.isAsymmetricAccessor) {
            setAsymmetricDescriptorAssignment(target);
        }

        const resultToCache: TypeResult = {
            type: setTypeResult.narrowedTypeForSet ?? typeResult.type,
            isIncomplete: typeResult.isIncomplete,
            memberAccessDeprecationInfo: setTypeResult.memberAccessDeprecationInfo,
        };
        writeTypeCache(target, resultToCache, EvalFlags.None);

        // If the target is an instance or class variable, update any class-scoped
        // type variables so the inferred type of the variable uses "external"
        // type variables.
        let memberResultToCache = resultToCache;
        if (enclosingClass?.shared.typeVarScopeId) {
            memberResultToCache = {
                ...resultToCache,
                type: makeTypeVarsFree(resultToCache.type, [enclosingClass.shared.typeVarScopeId]),
                memberAccessDeprecationInfo: setTypeResult.memberAccessDeprecationInfo,
            };
        }
        writeTypeCache(target.d.member, memberResultToCache, EvalFlags.None);
    }

    function assignTypeToMemberVariable(
        node: MemberAccessNode,
        typeResult: TypeResult,
        isInstanceMember: boolean,
        srcExprNode?: ExpressionNode
    ) {
        const memberName = node.d.member.d.value;
        const fileInfo = nodeInfo.getFileInfo(node);

        const classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        const classTypeInfo = getTypeOfClass(classDef);
        if (classTypeInfo && isInstantiableClass(classTypeInfo.classType)) {
            let memberInfo = lookUpClassMember(
                classTypeInfo.classType,
                memberName,
                isInstanceMember ? MemberAccessFlags.Default : MemberAccessFlags.SkipInstanceMembers
            );

            const memberFields = ClassType.getSymbolTable(classTypeInfo.classType);
            if (memberInfo) {
                // Are we accessing an existing member on this class, or is
                // it a member on a parent class?
                const memberClass = isInstantiableClass(memberInfo.classType) ? memberInfo.classType : undefined;
                const isThisClass = memberClass && ClassType.isSameGenericClass(classTypeInfo.classType, memberClass);

                // Check for an attempt to write to an instance variable that is
                // not defined by __slots__.
                if (isThisClass && isInstanceMember && memberClass) {
                    const inheritedSlotsNames = ClassType.getInheritedSlotsNames(memberClass);

                    if (inheritedSlotsNames && memberClass.shared.localSlotsNames) {
                        // Skip this check if the local slots is specified but empty
                        // and the class isn't final. This pattern is used in a
                        // legitimate manner for mix-in classes.
                        if (
                            (memberClass.shared.localSlotsNames.length > 0 || ClassType.isFinal(memberClass)) &&
                            !inheritedSlotsNames.some((name) => name === memberName)
                        ) {
                            // Determine whether the assignment corresponds to a descriptor
                            // that was assigned as a class variable. If so, then slots will not
                            // apply in this case.
                            const classMemberDetails = lookUpClassMember(
                                memberClass,
                                memberName,
                                MemberAccessFlags.SkipInstanceMembers
                            );
                            let isPotentiallyDescriptor = false;

                            if (classMemberDetails) {
                                const classMemberSymbolType = getEffectiveTypeOfSymbol(classMemberDetails.symbol);
                                if (
                                    isAnyOrUnknown(classMemberSymbolType) ||
                                    isUnbound(classMemberSymbolType) ||
                                    isMaybeDescriptorInstance(classMemberSymbolType)
                                ) {
                                    isPotentiallyDescriptor = true;
                                }
                            }

                            if (!isPotentiallyDescriptor) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.slotsAttributeError().format({ name: memberName }),
                                    node.d.member
                                );
                            }
                        }
                    }
                }

                if (isThisClass && memberInfo.isInstanceMember === isInstanceMember) {
                    const symbol = memberFields.get(memberName)!;
                    assert(symbol !== undefined);

                    const typedDecls = symbol.getDeclarations();

                    // Check for an attempt to overwrite a constant member variable.
                    if (
                        typedDecls.length > 0 &&
                        typedDecls[0].type === DeclarationType.Variable &&
                        srcExprNode &&
                        node.d.member !== typedDecls[0].node
                    ) {
                        if (typedDecls[0].isConstant) {
                            addDiagnostic(
                                DiagnosticRule.reportConstantRedefinition,
                                LocMessage.constantRedefinition().format({ name: node.d.member.d.value }),
                                node.d.member
                            );
                        }
                    }
                } else {
                    // Is the target a property?
                    const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol)?.type;
                    if (declaredType && !isProperty(declaredType)) {
                        // Handle the case where there is a class variable defined with the same
                        // name, but there's also now an instance variable introduced. Combine the
                        // type of the class variable with that of the new instance variable.
                        if (!memberInfo.isInstanceMember && isInstanceMember) {
                            // The class variable is accessed in this case.
                            setSymbolAccessed(fileInfo, memberInfo.symbol, node.d.member);
                            const memberType = getTypeOfMember(memberInfo);
                            typeResult = { ...typeResult, type: combineTypes([typeResult.type, memberType]) };
                        }
                    }
                }
            }

            // Look up the member info again, now that we've potentially updated it.
            memberInfo = lookUpClassMember(classTypeInfo.classType, memberName, MemberAccessFlags.DeclaredTypesOnly);

            if (!memberInfo && srcExprNode && !typeResult.isIncomplete) {
                reportPossibleUnknownAssignment(
                    fileInfo.diagnosticRuleSet.reportUnknownMemberType,
                    DiagnosticRule.reportUnknownMemberType,
                    node.d.member,
                    typeResult.type,
                    node,
                    /* ignoreEmptyContainers */ true
                );
            }
        }
    }

    function assignTypeToTupleOrListNode(
        target: TupleNode | ListNode,
        typeResult: TypeResult,
        srcExpr: ExpressionNode
    ) {
        const targetExpressions = target.nodeType === ParseNodeType.List ? target.d.items : target.d.items;

        // Initialize the array of target types, one for each target.
        const targetTypes: Type[][] = new Array(targetExpressions.length);
        for (let i = 0; i < targetExpressions.length; i++) {
            targetTypes[i] = [];
        }
        const targetUnpackIndex = targetExpressions.findIndex((expr) => expr.nodeType === ParseNodeType.Unpack);

        // Do any of the targets use an unpack operator? If so, it will consume all of the
        // entries at that location.
        const unpackIndex = targetExpressions.findIndex((expr) => expr.nodeType === ParseNodeType.Unpack);

        typeResult = { ...typeResult, type: makeTopLevelTypeVarsConcrete(typeResult.type) };

        const diagAddendum = new DiagnosticAddendum();

        doForEachSubtype(typeResult.type, (subtype) => {
            // Is this subtype a tuple?
            const tupleType = getSpecializedTupleType(subtype);
            if (tupleType && tupleType.priv.tupleTypeArgs) {
                const sourceEntryTypes = tupleType.priv.tupleTypeArgs.map((t) =>
                    addConditionToType(t.type, getTypeCondition(subtype), { skipSelfCondition: true })
                );

                const unboundedIndex = tupleType.priv.tupleTypeArgs.findIndex((t) => t.isUnbounded);

                if (unboundedIndex >= 0) {
                    if (sourceEntryTypes.length < targetTypes.length) {
                        const typeToReplicate =
                            sourceEntryTypes.length > 0 ? sourceEntryTypes[unboundedIndex] : AnyType.create();

                        // Add elements to make the count match the target count.
                        while (sourceEntryTypes.length < targetTypes.length) {
                            sourceEntryTypes.splice(unboundedIndex, 0, typeToReplicate);
                        }
                    }

                    if (sourceEntryTypes.length > targetTypes.length) {
                        // Remove elements to make the count match the target count.
                        sourceEntryTypes.splice(unboundedIndex, 1);
                    }
                }

                // If there's an unpack operator in the target and we have too many source elements,
                // combine them to assign to the unpacked target.
                if (targetUnpackIndex >= 0) {
                    if (sourceEntryTypes.length > targetTypes.length) {
                        const removedEntries = sourceEntryTypes.splice(
                            targetUnpackIndex,
                            sourceEntryTypes.length - targetTypes.length + 1
                        );
                        let combinedTypes = combineTypes(removedEntries);
                        if (target.nodeType === ParseNodeType.List) {
                            combinedTypes = stripLiteralValue(combinedTypes);
                        }
                        sourceEntryTypes.splice(targetUnpackIndex, 0, combinedTypes);
                    } else if (sourceEntryTypes.length === targetTypes.length - 1) {
                        sourceEntryTypes.splice(targetUnpackIndex, 0, NeverType.createNever());
                    }
                }

                sourceEntryTypes.forEach((type, targetIndex) => {
                    if (targetIndex < targetTypes.length) {
                        targetTypes[targetIndex].push(type);
                    }
                });

                // Have we accounted for all of the targets and sources? If not, we have a size mismatch.
                if (sourceEntryTypes.length !== targetExpressions.length) {
                    const subDiag = diagAddendum.createAddendum();
                    subDiag.addMessage(
                        (target.nodeType === ParseNodeType.List
                            ? LocAddendum.listAssignmentMismatch()
                            : LocAddendum.tupleAssignmentMismatch()
                        ).format({
                            type: printType(subtype),
                        })
                    );

                    subDiag.createAddendum().addMessage(
                        (unpackIndex >= 0
                            ? LocAddendum.tupleSizeMismatchIndeterminateDest()
                            : LocAddendum.tupleSizeMismatch()
                        ).format({
                            expected: unpackIndex >= 0 ? targetExpressions.length - 1 : targetExpressions.length,
                            received: sourceEntryTypes.length,
                        })
                    );
                }
            } else {
                // The assigned expression isn't a tuple, so it had better
                // be some iterable type.
                const iterableType =
                    getTypeOfIterator(
                        { type: subtype, isIncomplete: typeResult.isIncomplete },
                        /* isAsync */ false,
                        srcExpr
                    )?.type ?? UnknownType.create();
                for (let index = 0; index < targetExpressions.length; index++) {
                    targetTypes[index].push(addConditionToType(iterableType, getTypeCondition(subtype)));
                }
            }
        });

        if (!diagAddendum.isEmpty()) {
            addDiagnostic(
                DiagnosticRule.reportAssignmentType,
                (target.nodeType === ParseNodeType.List
                    ? LocMessage.listAssignmentMismatch()
                    : LocMessage.tupleAssignmentMismatch()
                ).format({
                    type: printType(typeResult.type),
                }) + diagAddendum.getString(),
                target
            );
        }

        // Assign the resulting types to the individual names in the tuple
        // or list target expression.
        targetExpressions.forEach((expr, index) => {
            const typeList = targetTypes[index];
            const targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);

            assignTypeToExpression(
                expr,
                { type: targetType, isIncomplete: typeResult.isIncomplete },
                srcExpr,
                /* ignoreEmptyContainers */ true
            );
        });

        writeTypeCache(target, typeResult, EvalFlags.None);
    }

    // If the type includes promotion types, expand these to their constituent types.
    function expandPromotionTypes(node: ParseNode, type: Type, excludeBytes = false): Type {
        return typeVarHandling.expandPromotionTypes(node, type, excludeBytes);
    }

    // Replaces all of the top-level TypeVars (as opposed to TypeVars
    // used as type arguments in other types) with their concrete form.
    // If conditionFilter is specified and the TypeVar is a constrained
    // TypeVar, only the conditions that match the filter will be included.
    function makeTopLevelTypeVarsConcrete(
        type: Type,
        makeParamSpecsConcrete = false,
        conditionFilter?: TypeCondition[]
    ): Type {
        return typeVarHandling.makeTopLevelTypeVarsConcrete(type, makeParamSpecsConcrete, conditionFilter);
    }

    // Creates a new type by mapping an existing type (which could be a union)
    // to another type or types. The callback is called for each subtype.
    // Top-level TypeVars are expanded (e.g. a bound TypeVar is expanded to
    // its bound type and a constrained TypeVar is expanded to its individual
    // constrained types). If conditionFilter is specified, conditions that
    // do not match will be ignored.
    function mapSubtypesExpandTypeVars(
        type: Type,
        options: MapSubtypesOptions | undefined,
        callback: (expandedSubtype: Type, unexpandedSubtype: Type, isLastIteration: boolean) => Type | undefined,
        recursionCount = 0
    ): Type {
        return typeVarHandling.mapSubtypesExpandTypeVars(type, options, callback, recursionCount);
    }

    function markNamesAccessed(node: ParseNode, names: string[]) {
        const fileInfo = nodeInfo.getFileInfo(node);
        const scope = getScopeForNode(node);

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
        typeResult: TypeResult,
        srcExpr: ExpressionNode,
        ignoreEmptyContainers = false,
        allowAssignmentToFinalVar = false,
        expectedTypeDiagAddendum?: DiagnosticAddendum
    ) {
        // Is the source expression a TypeVar() call?
        if (isTypeVar(typeResult.type)) {
            if (srcExpr && srcExpr.nodeType === ParseNodeType.Call) {
                const callType = getTypeOfExpression(srcExpr.d.leftExpr, EvalFlags.CallBaseDefaults).type;
                if (
                    isInstantiableClass(callType) &&
                    (ClassType.isBuiltIn(callType, 'TypeVar') ||
                        ClassType.isBuiltIn(callType, 'TypeVarTuple') ||
                        ClassType.isBuiltIn(callType, 'ParamSpec'))
                ) {
                    const typeVarTarget =
                        target.nodeType === ParseNodeType.TypeAnnotation ? target.d.valueExpr : target;
                    if (
                        typeVarTarget.nodeType !== ParseNodeType.Name ||
                        typeVarTarget.d.value !== typeResult.type.shared.name
                    ) {
                        const name = TypeVarType.getReadableName(typeResult.type);
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            isParamSpec(typeResult.type)
                                ? LocMessage.paramSpecAssignedName().format({ name })
                                : LocMessage.typeVarAssignedName().format({ name }),
                            typeVarTarget
                        );
                    }
                }
            }
        }

        // If the type was partially unbound, an error will have already been logged.
        // Remove the unbound before assigning to the target expression so the unbound
        // error doesn't propagate.
        if (findSubtype(typeResult.type, (subtype) => isUnbound(subtype))) {
            typeResult = { ...typeResult, type: removeUnbound(typeResult.type) };
        }

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                assignTypeToNameNode(
                    target,
                    typeResult,
                    ignoreEmptyContainers,
                    srcExpr,
                    allowAssignmentToFinalVar,
                    expectedTypeDiagAddendum
                );
                break;
            }

            case ParseNodeType.MemberAccess: {
                assignTypeToMemberAccessNode(target, typeResult, srcExpr, expectedTypeDiagAddendum);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(target.d.leftExpr, EvalFlags.IndexBaseDefaults);

                getTypeOfIndexWithBaseType(
                    target,
                    baseTypeResult,
                    {
                        method: 'set',
                        setType: typeResult,
                        setErrorNode: srcExpr,
                        setExpectedTypeDiag: expectedTypeDiagAddendum,
                    },
                    EvalFlags.None
                );

                writeTypeCache(target, typeResult, EvalFlags.None);
                break;
            }

            case ParseNodeType.List:
            case ParseNodeType.Tuple: {
                assignTypeToTupleOrListNode(target, typeResult, srcExpr);
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                getTypeOfAnnotation(target.d.annotation, {
                    varTypeAnnotation: true,
                    allowFinal: isFinalAllowedForAssignmentTarget(target.d.valueExpr),
                    allowClassVar: isClassVarAllowedForAssignmentTarget(target.d.valueExpr),
                });

                assignTypeToExpression(
                    target.d.valueExpr,
                    typeResult,
                    srcExpr,
                    ignoreEmptyContainers,
                    allowAssignmentToFinalVar,
                    expectedTypeDiagAddendum
                );
                break;
            }

            case ParseNodeType.Unpack: {
                assignTypeToExpression(
                    target.d.expr,
                    {
                        type: getBuiltInObject(target.d.expr, 'list', [typeResult.type]),
                        isIncomplete: typeResult.isIncomplete,
                    },
                    srcExpr,
                    ignoreEmptyContainers,
                    allowAssignmentToFinalVar,
                    expectedTypeDiagAddendum
                );
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                if (target.d.child) {
                    suppressDiagnostics(target.d.child, () => {
                        getTypeOfExpression(target.d.child!);
                    });
                }
                break;
            }

            default: {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.assignmentTargetExpr(), target);
                break;
            }
        }
    }

    function isClassVarAllowedForAssignmentTarget(targetNode: ExpressionNode): boolean {
        // ClassVar is allowed only in a class body.
        const classNode = ParseTreeUtils.getEnclosingClass(targetNode, /* stopAtFunction */ true);
        if (!classNode) {
            return false;
        }

        // ClassVar is not allowed in a TypedDict or a NamedTuple class.
        return !isInTypedDictOrNamedTuple(classNode);
    }

    function isFinalAllowedForAssignmentTarget(targetNode: ExpressionNode): boolean {
        const classNode = ParseTreeUtils.getEnclosingClass(targetNode, /* stopAtFunction */ true);

        // Final is not allowed in the body of a TypedDict or NamedTuple class.
        if (classNode && isInTypedDictOrNamedTuple(classNode)) {
            return false;
        }

        return ParseTreeUtils.isFinalAllowedForAssignmentTarget(targetNode);
    }

    function isInTypedDictOrNamedTuple(classNode: ClassNode): boolean {
        const classType = getTypeOfClass(classNode)?.classType;
        if (!classType) {
            return false;
        }

        return ClassType.isTypedDictClass(classType) || !!classType.shared.namedTupleEntries;
    }

    function verifyRaiseExceptionType(node: ExpressionNode, allowNone: boolean) {
        return evaluatorCore.verifyRaiseExceptionType(node, allowNone);
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
                const baseTypeResult = getTypeOfExpression(node.d.leftExpr, EvalFlags.MemberAccessBaseDefaults);
                const delAccessResult = getTypeOfMemberAccessWithBaseType(
                    node,
                    baseTypeResult,
                    { method: 'del' },
                    EvalFlags.None
                );
                const resultToCache: TypeResult = {
                    type: delAccessResult.type,
                    memberAccessDeprecationInfo: delAccessResult.memberAccessDeprecationInfo,
                };
                writeTypeCache(node.d.member, resultToCache, EvalFlags.None);
                writeTypeCache(node, resultToCache, EvalFlags.None);
                break;
            }

            case ParseNodeType.Index: {
                const baseTypeResult = getTypeOfExpression(node.d.leftExpr, EvalFlags.IndexBaseDefaults);
                getTypeOfIndexWithBaseType(node, baseTypeResult, { method: 'del' }, EvalFlags.None);
                writeTypeCache(node, { type: UnboundType.create() }, EvalFlags.None);
                break;
            }

            case ParseNodeType.Tuple: {
                node.d.items.forEach((expr) => {
                    verifyDeleteExpression(expr);
                });
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                if (node.d.child) {
                    suppressDiagnostics(node.d.child, () => {
                        getTypeOfExpression(node.d.child!);
                    });
                }
                break;
            }

            default: {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.delTargetExpr(), node);
                break;
            }
        }
    }

    function setSymbolAccessed(fileInfo: AnalyzerFileInfo, symbol: Symbol, node: ParseNode) {
        if (!isSpeculativeModeInUse(node)) {
            fileInfo.accessedSymbolSet.add(symbol.id);
        }
    }

    function getTypeOfName(node: NameNode, flags: EvalFlags): TypeResult {
        const fileInfo = nodeInfo.getFileInfo(node);
        const name = node.d.value;
        let symbol: Symbol | undefined;
        let type: Type | undefined;
        let isIncomplete = false;
        const allowForwardReferences = (flags & EvalFlags.ForwardRefs) !== 0 || fileInfo.isStubFile;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        let symbolWithScope = lookUpSymbolRecursive(
            node,
            name,
            !allowForwardReferences,
            allowForwardReferences && (flags & EvalFlags.TypeExpression) !== 0
        );

        if (!symbolWithScope) {
            // If the node is part of a "from X import Y as Z" statement and the node
            // is the "Y" (non-aliased) name, we need to look up the alias symbol
            // since the non-aliased name is not in the symbol table.
            const alias = getAliasFromImport(node);
            if (alias) {
                symbolWithScope = lookUpSymbolRecursive(
                    alias,
                    alias.d.value,
                    !allowForwardReferences,
                    allowForwardReferences && (flags & EvalFlags.TypeExpression) !== 0
                );
            }
        }

        if (symbolWithScope) {
            let useCodeFlowAnalysis = !allowForwardReferences;

            // If the symbol is implicitly imported from the builtin
            // scope, there's no need to use code flow analysis.
            if (symbolWithScope.scope.type === ScopeType.Builtin) {
                useCodeFlowAnalysis = false;
            }

            symbol = symbolWithScope.symbol;
            setSymbolAccessed(fileInfo, symbol, node);

            // If we're not supposed to be analyzing this function, skip the remaining work
            // to determine the name's type. Simply evaluate its type as Any.
            if (!fileInfo.diagnosticRuleSet.analyzeUnannotatedFunctions) {
                const containingFunction = ParseTreeUtils.getEnclosingFunction(node);
                if (containingFunction && ParseTreeUtils.isUnannotatedFunction(containingFunction)) {
                    return {
                        type: AnyType.create(),
                        isIncomplete: false,
                    };
                }
            }

            // Get the effective type (either the declared type or the inferred type).
            // If we're using code flow analysis, pass the usage node so we consider
            // only the assignment nodes that are reachable from this usage.
            const effectiveTypeInfo = getEffectiveTypeOfSymbolForUsage(symbol, useCodeFlowAnalysis ? node : undefined);
            let effectiveType = transformPossibleRecursiveTypeAlias(effectiveTypeInfo.type);

            if (effectiveTypeInfo.isIncomplete) {
                if (isUnbound(effectiveType)) {
                    effectiveType = UnknownType.create(/* isIncomplete */ true);
                }
                isIncomplete = true;
            }

            if (effectiveTypeInfo.isRecursiveDefinition && isNodeReachable(node)) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.recursiveDefinition().format({ name }),
                    node
                );
            }

            const isSpecialBuiltIn =
                !!effectiveType && isInstantiableClass(effectiveType) && ClassType.isSpecialBuiltIn(effectiveType);

            type = effectiveType;
            if (useCodeFlowAnalysis && !isSpecialBuiltIn) {
                // See if code flow analysis can tell us anything more about the type.
                // If the symbol is declared outside of our execution scope, use its effective
                // type. If it's declared inside our execution scope, it generally starts
                // as unbound at the start of the code flow.
                let typeAtStart = effectiveType;
                let isTypeAtStartIncomplete = false;

                if (!symbolWithScope.isBeyondExecutionScope && symbol.isInitiallyUnbound()) {
                    typeAtStart = UnboundType.create();

                    // Is this a module-level scope? If so, see if it's an alias of a builtin.
                    if (symbolWithScope.scope.type === ScopeType.Module) {
                        assert(symbolWithScope.scope.parent);
                        const builtInSymbol = symbolWithScope.scope.parent.lookUpSymbol(name);
                        if (builtInSymbol) {
                            const builtInEffectiveType = getEffectiveTypeOfSymbolForUsage(builtInSymbol);
                            typeAtStart = builtInEffectiveType.type;
                        }
                    }
                }

                if (symbolWithScope.isBeyondExecutionScope) {
                    const outerScopeTypeResult = getCodeFlowTypeForCapturedVariable(
                        node,
                        symbolWithScope,
                        effectiveType
                    );

                    if (outerScopeTypeResult?.type) {
                        type = outerScopeTypeResult.type;
                        typeAtStart = type;
                        isTypeAtStartIncomplete = !!outerScopeTypeResult.isIncomplete;
                    }
                }

                const codeFlowTypeResult = getFlowTypeOfReference(node, /* startNode */ undefined, {
                    targetSymbolId: symbol.id,
                    typeAtStart: { type: typeAtStart, isIncomplete: isTypeAtStartIncomplete },
                    skipConditionalNarrowing: (flags & EvalFlags.TypeExpression) !== 0,
                });

                if (codeFlowTypeResult.type) {
                    type = codeFlowTypeResult.type;
                }

                if (codeFlowTypeResult.isIncomplete) {
                    isIncomplete = true;
                }
            }

            // Detect, report, and fill in missing type arguments if appropriate.
            type = reportMissingTypeArgs(node, type, flags);

            // Report inappropriate use of variables in type expressions.
            if ((flags & EvalFlags.TypeExpression) !== 0) {
                type = validateSymbolIsTypeExpression(node, type, !!effectiveTypeInfo.includesVariableDecl);
            }

            if (isTypeVar(type) && !type.shared.isSynthesized) {
                type = validateTypeVarUsage(node, type, flags);
            }

            // Add TypeForm details if appropriate.
            type = addTypeFormForSymbol(node, type, flags, !!effectiveTypeInfo.includesVariableDecl);
        } else {
            // Handle the special case of "reveal_type" and "reveal_locals".
            if (ParseTreeUtils.isImplicitRevealTypeName(node) || name === 'reveal_locals') {
                type = AnyType.create();
            } else {
                addDiagnostic(
                    DiagnosticRule.reportUndefinedVariable,
                    LocMessage.symbolIsUndefined().format({ name }),
                    node
                );

                type = UnknownType.create();
            }
        }

        if (isParamSpec(type) && type.priv.scopeId) {
            if (flags & EvalFlags.NoParamSpec) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.paramSpecContext(), node);
                type = UnknownType.create();
            }
        }

        if (isTypeVarTuple(type) && (flags & EvalFlags.NoTypeVarTuple) !== 0 && !type.priv.isInUnion) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeVarTupleContext(), node);
            type = UnknownType.create();
        }

        // If we're expecting a type expression and got a sentinel literal instance,
        // treat it as its instantiable counterpart. This is similar to how None
        // is treated in a type expression context.
        if ((flags & EvalFlags.InstantiableType) !== 0 && isClassInstance(type) && isSentinelLiteral(type)) {
            type = ClassType.cloneAsInstantiable(type);
        }

        type = convertSpecialFormToRuntimeValue(type, flags);

        if ((flags & EvalFlags.TypeExpression) === 0) {
            reportUseOfTypeCheckOnly(type, node);
        }

        if ((flags & (EvalFlags.InstantiableType | EvalFlags.TypeFormArg)) !== 0) {
            if ((flags & EvalFlags.AllowGeneric) === 0) {
                if (isInstantiableClass(type) && ClassType.isBuiltIn(type, 'Generic')) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.genericNotAllowed(), node);
                    if ((flags & EvalFlags.TypeFormArg) !== 0) {
                        type = UnknownType.create();
                    }
                }
            }
        }

        // Bare names expose descriptors without changing the canonical types of method declarations.
        if ((flags & EvalFlags.TypeExpression) === 0) {
            type = mapSubtypes(type, (subtype) => {
                if (!isFunctionOrOverloaded(subtype)) {
                    return subtype;
                }
                const signature = isFunction(subtype) ? subtype : OverloadedType.getOverloads(subtype)[0];
                if (
                    !signature ||
                    signature.priv.boundToType ||
                    (!FunctionType.isClassMethod(signature) && !FunctionType.isStaticMethod(signature))
                ) {
                    return subtype;
                }

                const implementation = isOverloaded(subtype) ? OverloadedType.getImplementation(subtype) : undefined;
                const declaration =
                    implementation && isFunction(implementation)
                        ? implementation.shared.declaration
                        : signature.shared.declaration;
                for (const decorator of declaration?.node.d.decorators ?? []) {
                    const decoratedType = readTypeCache(decorator, /* flags */ undefined);
                    if (
                        decoratedType &&
                        isClassInstance(decoratedType) &&
                        ClassType.isBuiltIn(decoratedType, ['classmethod', 'staticmethod'])
                    ) {
                        return createMethodDescriptor(decoratedType, subtype, decorator);
                    }

                    // Only look through outer decorators that preserve the original
                    // callable, rather than a replacement with a similar signature.
                    if (
                        !decoratedType ||
                        !isFunction(decoratedType) ||
                        decoratedType.shared.declaration !== declaration ||
                        FunctionType.isClassMethod(decoratedType) !== FunctionType.isClassMethod(signature) ||
                        FunctionType.isStaticMethod(decoratedType) !== FunctionType.isStaticMethod(signature)
                    ) {
                        break;
                    }
                }
                return subtype;
            });
        }

        return { type, isIncomplete };
    }

    function createMethodDescriptor(
        descriptor: ClassType,
        methodType: FunctionType | OverloadedType,
        decorator: DecoratorNode
    ): ClassType {
        const signature = isFunction(methodType) ? methodType : OverloadedType.getOverloads(methodType)[0];
        const fileInfo = nodeInfo.getFileInfo(decorator);
        const descriptorClass = ClassType.createInstantiable(
            descriptor.shared.name,
            `${signature.shared.fullName}.__descriptor__`,
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.BuiltIn,
            ParseTreeUtils.getTypeSourceId(decorator),
            /* declaredMetaclass */ undefined,
            descriptor.shared.effectiveMetaclass ?? UnknownType.create()
        );
        descriptorClass.shared.baseClasses.push(ClassType.cloneAsInstantiable(descriptor));
        computeMroLinearization(descriptorClass);

        // ParamSpec and return-type arguments cannot represent correlated overloads.
        // Retain the callable itself rather than reconstructing it from those arguments.
        const functionType = mapSignatures(methodType, (overload) =>
            FunctionType.cloneWithNewFlags(
                overload,
                overload.shared.flags & ~(FunctionTypeFlags.ClassMethod | FunctionTypeFlags.StaticMethod)
            )
        );
        const getter = FunctionType.createSynthesizedInstance('__func__');
        FunctionType.addParam(
            getter,
            FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
        );
        getter.shared.declaredReturnType = functionType;
        getter.shared.declaration = signature.shared.declaration;

        const propertyType = getBuiltInType(decorator, 'property');
        assert(isInstantiableClass(propertyType));
        const functionProperty = createProperty(evaluatorInterface, decorator, propertyType, getter, nodeInfo);
        const fields = ClassType.getSymbolTable(descriptorClass);
        fields.set('__func__', Symbol.createWithType(SymbolFlags.ClassMember, functionProperty));
        fields.set('__wrapped__', Symbol.createWithType(SymbolFlags.ClassMember, functionProperty));
        if (ClassType.isBuiltIn(descriptor, 'staticmethod')) {
            fields.set('__call__', Symbol.createWithType(SymbolFlags.ClassMember, methodType));
        }

        const getMethod = getBoundMagicMethod(descriptor, '__get__');
        if (getMethod && isFunctionOrOverloaded(getMethod)) {
            const boundFunction = ClassType.isBuiltIn(descriptor, 'classmethod')
                ? mapSignatures(methodType, (overload) => FunctionType.clone(overload, /* stripFirstParam */ true))
                : functionType;
            const descriptorGet = mapSignatures(getMethod, (overload) => {
                const specializedGet = FunctionType.clone(overload);
                specializedGet.shared.declaredReturnType = boundFunction;
                if (specializedGet.priv.specializedTypes) {
                    specializedGet.priv.specializedTypes.returnType = boundFunction;
                }
                return specializedGet;
            });
            assert(descriptorGet);
            fields.set('__get__', Symbol.createWithType(SymbolFlags.ClassMember, descriptorGet));
        }

        return ClassType.cloneAsInstance(descriptorClass);
    }

    function getMethodFromDescriptor(type: Type): FunctionType | OverloadedType | undefined {
        if (!isClassInstance(type) || !ClassType.isBuiltIn(type, ['classmethod', 'staticmethod'])) {
            return undefined;
        }
        const functionProperty = type.shared.fields.get('__func__')?.getSynthesizedType()?.type;
        const functionType =
            functionProperty && isClassInstance(functionProperty)
                ? getGetterTypeFromProperty(functionProperty)
                : undefined;
        if (!functionType || !isFunctionOrOverloaded(functionType)) {
            return undefined;
        }
        return mapSignatures(functionType, (signature) =>
            FunctionType.cloneWithNewFlags(
                signature,
                signature.shared.flags |
                    (ClassType.isBuiltIn(type, 'classmethod')
                        ? FunctionTypeFlags.ClassMethod
                        : FunctionTypeFlags.StaticMethod)
            )
        );
    }

    const typeFormSpecialFormDiagnosticFactories: [string | string[], () => string][] = [
        ['Final', () => LocMessage.finalContext()],
        ['Optional', () => LocMessage.optionalExtraArgs()],
        ['Protocol', () => LocMessage.protocolNotAllowed()],
        ['TypedDict', () => LocMessage.typedDictNotAllowed()],
        ['TypeAlias', () => LocMessage.typeAnnotationVariable()],
        ['Literal', () => LocMessage.literalNotAllowed()],
        [['TypeGuard', 'TypeIs'], () => LocMessage.typeGuardArgCount()],
        ['Union', () => LocMessage.unionTypeArgCount()],
        ['Annotated', () => LocMessage.annotatedTypeArgMissing()],
        ['ClassVar', () => LocMessage.classVarNotAllowed()],
        ['Required', () => LocMessage.requiredArgCount()],
        ['NotRequired', () => LocMessage.notRequiredArgCount()],
        ['ReadOnly', () => LocMessage.readOnlyArgCount()],
        ['Unpack', () => LocMessage.unpackArgCount()],
        ['Concatenate', () => LocMessage.concatenateContext()],
    ];

    function rejectBareSpecialFormInTypeForm(type: ClassType, node: ExpressionNode): Type | undefined {
        for (const [className, diagnosticFactory] of typeFormSpecialFormDiagnosticFactories) {
            if (ClassType.isBuiltIn(type, className)) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, diagnosticFactory(), node);
                return UnknownType.create();
            }
        }

        return undefined;
    }

    function addTypeFormForSymbol(node: ExpressionNode, type: Type, flags: EvalFlags, includesVarDecl: boolean): Type {
        return typeVarHandling.addTypeFormForSymbol(node, type, flags, includesVarDecl);
    }

    function isSymbolValidTypeExpression(type: Type, includesVarDecl: boolean): boolean {
        return evaluatorCore.isSymbolValidTypeExpression(type, includesVarDecl);
    }

    // Reports diagnostics if type isn't valid within a type expression.
    function validateSymbolIsTypeExpression(node: ExpressionNode, type: Type, includesVarDecl: boolean): Type {
        return memberResolution.validateSymbolIsTypeExpression(node, type, includesVarDecl);
    }

    // If the value is a special form (like a TypeVar or `Any`) and is being
    // evaluated in a value expression context, convert it from its special
    // meaning to its runtime value. If convertModule is true, a module is
    // converted to an instance of types.ModuleType.
    function convertSpecialFormToRuntimeValue(type: Type, flags: EvalFlags, convertModule = false) {
        return evaluatorCore.convertSpecialFormToRuntimeValue(type, flags, convertModule);
    }

    // Handles the case where a variable or parameter is defined in an outer
    // scope and captured by an inner scope (a function, lambda, or comprehension).
    function getCodeFlowTypeForCapturedVariable(
        node: NameNode,
        symbolWithScope: SymbolWithScope,
        effectiveType: Type
    ): FlowNodeTypeResult | undefined {
        // Global bindings and cells that can be unbound in another scope
        // cannot safely retain the type at capture.
        if (symbolWithScope.usesGlobalBinding || symbolWithScope.symbol.isUnboundInOtherScope()) {
            return undefined;
        }

        // This function applies only to variables, parameters, and imports, not to other
        // types of symbols.
        const decls = symbolWithScope.symbol.getDeclarations();
        if (
            !decls.every(
                (decl) =>
                    decl.type === DeclarationType.Variable ||
                    decl.type === DeclarationType.Param ||
                    decl.type === DeclarationType.Alias
            )
        ) {
            return undefined;
        }

        // If the symbol is modified in scopes other than the one in which it is
        // declared (e.g. through a nonlocal or global binding), it is not eligible
        // for code flow analysis.
        if (
            !decls.every(
                (decl) => decl.type === DeclarationType.Param || getScopeForNode(decl.node) === symbolWithScope.scope
            )
        ) {
            return undefined;
        }

        // If the symbol is a non-final variable in the global scope, it is not
        // eligible because it could be modified by other modules.
        if (
            !decls.every(
                (decl) =>
                    decl.type !== DeclarationType.Variable ||
                    decl.isFinal ||
                    getScopeForNode(decl.node)?.type !== ScopeType.Module
            )
        ) {
            return undefined;
        }

        // If the symbol is a variable captured by an inner function
        // or lambda, see if we can infer the type from the outer scope.
        const scopeHierarchy = getScopeHierarchy(node, symbolWithScope.scope);

        if (scopeHierarchy && scopeHierarchy.length >= 2) {
            // Find the parse node associated with the scope that is just inside of the
            // scope that declares the captured variable.
            const innerScopeNode = findTopNodeInScope(node, scopeHierarchy[scopeHierarchy.length - 2]);
            if (
                innerScopeNode?.nodeType === ParseNodeType.Function ||
                innerScopeNode?.nodeType === ParseNodeType.Lambda ||
                innerScopeNode?.nodeType === ParseNodeType.Class
            ) {
                const innerScopeCodeFlowNode = nodeInfo.getFlowNode(innerScopeNode);
                if (innerScopeCodeFlowNode) {
                    // See if any of the assignments of the symbol are reachable
                    // from this node. If so, we cannot apply any narrowing because
                    // the type could change after the capture.
                    if (
                        symbolWithScope.symbol.getDeclarations().every((decl) => {
                            // Parameter declarations always start life at the beginning
                            // of the execution scope, so they are always safe to narrow.
                            if (decl.type === DeclarationType.Param) {
                                return true;
                            }

                            const declCodeFlowNode = nodeInfo.getFlowNode(decl.node);
                            if (!declCodeFlowNode) {
                                return false;
                            }

                            return (
                                codeFlowEngine.getFlowNodeReachability(
                                    declCodeFlowNode,
                                    innerScopeCodeFlowNode,
                                    /* ignoreNoReturn */ true
                                ) !== Reachability.Reachable
                            );
                        })
                    ) {
                        let typeAtStart = effectiveType;
                        if (symbolWithScope.symbol.isInitiallyUnbound()) {
                            typeAtStart = UnboundType.create();
                        }

                        return getFlowTypeOfReference(node, innerScopeNode, {
                            targetSymbolId: symbolWithScope.symbol.id,
                            typeAtStart: { type: typeAtStart },
                        });
                    }
                }
            }
        }

        return undefined;
    }

    // Validates that a TypeVar is valid in this context. If so, it clones it
    // and provides a scope ID defined by its containing scope (class, function
    // or type alias). If not, it emits errors indicating why the TypeVar
    // cannot be used in this location.
    function validateTypeVarUsage(node: ExpressionNode, type: TypeVarType, flags: EvalFlags) {
        if (!TypeBase.isInstantiable(type) || isTypeAliasPlaceholder(type)) {
            return type;
        }

        // If the TypeVar doesn't have a scope ID, try to assign one.
        if (!type.priv.scopeId) {
            type = assignTypeVarScopeId(node, type, flags);
        }

        // If this is a free type var, see if we need to make it into a bound type var.
        if (type.priv.scopeId && !TypeVarType.isBound(type)) {
            // If this is a reference to a TypeVar defined in an outer scope,
            // mark it as bound.
            const scopedNode = findScopedTypeVar(node, type)?.scopeNode;

            if (scopedNode) {
                const enclosingSuite = ParseTreeUtils.getEnclosingClassOrFunctionSuite(node);

                if (enclosingSuite && ParseTreeUtils.isNodeContainedWithin(enclosingSuite, scopedNode)) {
                    if (scopedNode.nodeType !== ParseNodeType.Class || scopedNode.d.suite !== enclosingSuite) {
                        type = TypeVarType.cloneAsBound(type);
                    }
                }
            }
        }

        // If this is a TypeVarTuple, the name refers to the packed form. It
        // must be unpacked in most contexts.
        if (isUnpackedTypeVarTuple(type)) {
            type = TypeVarType.cloneForPacked(type);
        }

        if ((flags & EvalFlags.EnforceClassTypeVarScope) !== 0 && !enforceClassTypeVarScope(node, type)) {
            return UnknownType.create();
        }

        return type;
    }

    function assignTypeVarScopeId(node: ExpressionNode, type: TypeVarType, flags: EvalFlags): TypeVarType {
        const scopedTypeVarInfo = findScopedTypeVar(node, type);
        type = scopedTypeVarInfo.type;

        if ((flags & EvalFlags.NoTypeVarWithScopeId) !== 0 && !!type.priv.scopeId) {
            if (type.shared.isSynthesized || isParamSpec(type)) {
                return type;
            }

            // This TypeVar already has a scope ID assigned to it. See if it
            // originates from type parameter syntax. If so, allow it.
            if (type.shared.isTypeParamSyntax) {
                return type;
            }

            // If this type variable expression is used within a generic class,
            // function, or type alias that uses type parameter syntax, there is
            // no need to report an error here.
            const typeVarScopeNode = ParseTreeUtils.getTypeVarScopeNode(node);
            if (
                typeVarScopeNode &&
                typeVarScopeNode.d.typeParams &&
                !typeVarScopeNode.d.typeParams.d.params.some((t) => t.d.name === node)
            ) {
                return type;
            }

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarUsedByOuterScope().format({ name: type.shared.name }),
                node
            );

            return type;
        }

        if ((flags & EvalFlags.TypeVarGetsCurScope) !== 0) {
            if (type.priv.scopeId) {
                return type;
            }

            if (scopedTypeVarInfo.foundInterveningClass) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarUsedByOuterScope().format({ name: type.shared.name }),
                    node
                );
                return type;
            }

            let enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(node);

            // Handle P.args and P.kwargs as a special case for inner functions.
            if (
                enclosingScope &&
                node.parent?.nodeType === ParseNodeType.MemberAccess &&
                node.parent.d.leftExpr === node
            ) {
                const memberName = node.parent.d.member.d.value;
                if (memberName === 'args' || memberName === 'kwargs') {
                    const outerFunctionScope = ParseTreeUtils.getEnclosingClassOrFunction(enclosingScope);

                    if (outerFunctionScope?.nodeType === ParseNodeType.Function) {
                        enclosingScope = outerFunctionScope;
                    } else if (!scopedTypeVarInfo.type.priv.scopeId) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.paramSpecNotUsedByOuterScope().format({
                                name: type.shared.name,
                            }),
                            node
                        );
                    }
                }
            }

            if (!enclosingScope) {
                fail('AssociateTypeVarsWithCurrentScope flag was set but enclosing scope not found');
            }

            // If the enclosing scope is using type parameter syntax, traditional
            // type variables can't be used in this context.
            if (
                enclosingScope.d.typeParams &&
                !enclosingScope.d.typeParams.d.params.some((param) => param.d.name.d.value === type.shared.name)
            ) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeParameterNotDeclared().format({
                        name: type.shared.name,
                        container: enclosingScope.d.name.d.value,
                    }),
                    node
                );
            }

            const scopeIdToAssign = getScopeIdForNode(enclosingScope);

            return TypeVarType.cloneForScopeId(
                type,
                scopeIdToAssign,
                enclosingScope.d.name.d.value,
                enclosingScope.nodeType === ParseNodeType.Function ? TypeVarScopeType.Function : TypeVarScopeType.Class
            );
        }

        if ((flags & EvalFlags.AllowTypeVarWithoutScopeId) === 0) {
            if (type.priv.scopeId && !scopedTypeVarInfo.foundInterveningClass) {
                return type;
            }

            if (!type.shared.isSynthesized && (flags & EvalFlags.InstantiableType) !== 0) {
                const message = isParamSpec(type)
                    ? LocMessage.paramSpecNotUsedByOuterScope()
                    : LocMessage.typeVarNotUsedByOuterScope();
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, message.format({ name: type.shared.name }), node);
            }
        }

        return type;
    }

    // Enforce that the type variable is scoped to the enclosing class or
    // an outer class that contains the class definition.
    function enforceClassTypeVarScope(node: ExpressionNode, type: TypeVarType): boolean {
        return specialFormCreation.enforceClassTypeVarScope(node, type);
    }

    // Determines if the type is a generic class or type alias with missing
    // type arguments. If so, it fills in these type arguments with Unknown
    // and optionally reports an error.
    function reportMissingTypeArgs(node: ExpressionNode, type: Type, flags: EvalFlags): Type {
        return evaluatorCore.reportMissingTypeArgs(node, type, flags);
    }

    // Walks up the parse tree to find a function, class, or type alias
    // declaration that provides the context for a type variable.
    function findScopedTypeVar(node: ExpressionNode, type: TypeVarType): ScopedTypeVarResult {
        let curNode: ParseNode | undefined = node;
        let nestedClassCount = 0;

        assert(TypeBase.isInstantiable(type));

        while (curNode) {
            const scopeNode = ParseTreeUtils.getTypeVarScopeNode(curNode);
            if (!scopeNode) {
                break;
            }
            curNode = scopeNode;

            let typeParamsForScope: TypeVarType[] | undefined;
            let scopeUsesTypeParamSyntax = false;

            if (curNode.nodeType === ParseNodeType.Class) {
                const classTypeInfo = getTypeOfClass(curNode);
                if (classTypeInfo && !ClassType.isPartiallyEvaluated(classTypeInfo.classType)) {
                    typeParamsForScope = classTypeInfo.classType.shared.typeParams;
                }

                scopeUsesTypeParamSyntax = !!curNode.d.typeParams;
                nestedClassCount++;
            } else if (curNode.nodeType === ParseNodeType.Function) {
                const functionType = getTypeOfFunctionPredecorated(curNode);
                if (functionType) {
                    const functionDetails = functionType.shared;
                    typeParamsForScope = functionDetails.typeParams;
                }

                scopeUsesTypeParamSyntax = !!curNode.d.typeParams;
            } else if (curNode.nodeType === ParseNodeType.TypeAlias) {
                scopeUsesTypeParamSyntax = !!curNode.d.typeParams;
            }

            if (typeParamsForScope) {
                const match = typeParamsForScope.find((typeVar) => typeVar.shared.name === type.shared.name);

                if (
                    match?.priv.scopeId !== undefined &&
                    match.priv.scopeName !== undefined &&
                    match.priv.scopeType !== undefined
                ) {
                    // Use the scoped version of the TypeVar rather than the (unscoped) original type.
                    type = TypeVarType.cloneForScopeId(
                        type,
                        match.priv.scopeId,
                        match.priv.scopeName,
                        match.priv.scopeType
                    );
                    type.shared.declaredVariance = match.shared.declaredVariance;
                    return {
                        type,
                        scopeNode,
                        foundInterveningClass: nestedClassCount > 1 && !scopeUsesTypeParamSyntax,
                    };
                }
            }

            curNode = curNode.parent;
        }

        // See if this is part of an assignment statement that is defining a type alias.
        curNode = node;
        while (curNode) {
            let leftType: Type | undefined;
            let typeAliasNode: TypeAliasNode | undefined;
            let scopeNode: TypeAliasNode | AssignmentNode | undefined;

            if (curNode.nodeType === ParseNodeType.TypeAlias) {
                leftType = readTypeCache(curNode.d.name, EvalFlags.None);
                typeAliasNode = curNode;
                scopeNode = curNode;
            } else if (curNode.nodeType === ParseNodeType.Assignment) {
                leftType = readTypeCache(curNode.d.leftExpr, EvalFlags.None);
                scopeNode = curNode;
            }

            if (leftType && scopeNode) {
                // Is this a placeholder that was temporarily written to the cache for
                // purposes of resolving type aliases?
                if (leftType && isTypeVar(leftType) && leftType.shared.recursiveAlias) {
                    // Type alias statements cannot be used with old-style type variables.
                    if (typeAliasNode && !type.shared.isTypeParamSyntax && !type.props?.typeAliasInfo) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeParameterNotDeclared().format({
                                name: type.shared.name,
                                container: typeAliasNode.d.name.d.value,
                            }),
                            node
                        );
                    } else {
                        // If this is a TypeAliasType call, the recursive type parameters will already
                        // be populated, and we need to verify that the type parameter is in the
                        // list of allowed type parameters.
                        const allowedTypeParams = leftType.shared.recursiveAlias?.typeParams;
                        if (allowedTypeParams) {
                            if (!allowedTypeParams.some((param) => param.shared.name === type.shared.name)) {
                                // Return the original type.
                                return { type, scopeNode, foundInterveningClass: false };
                            }
                        }
                    }

                    return {
                        type: TypeVarType.cloneForScopeId(
                            type,
                            leftType.shared.recursiveAlias.typeVarScopeId,
                            leftType.shared.recursiveAlias.name,
                            TypeVarScopeType.TypeAlias
                        ),
                        scopeNode,
                        foundInterveningClass: false,
                    };
                }
            }

            curNode = curNode.parent;
        }

        // Return the original type.
        return { type, scopeNode: undefined, foundInterveningClass: false };
    }

    function getTypeOfMemberAccess(node: MemberAccessNode, flags: EvalFlags): TypeResult {
        // Compute flags specifically for evaluating the left expression.
        let leftExprFlags = EvalFlags.MemberAccessBaseDefaults;
        leftExprFlags |=
            flags &
            (EvalFlags.TypeExpression |
                EvalFlags.VarTypeAnnotation |
                EvalFlags.ForwardRefs |
                EvalFlags.NotParsed |
                EvalFlags.NoTypeVarWithScopeId |
                EvalFlags.TypeVarGetsCurScope);

        // Handle special casing for ParamSpec "args" and "kwargs" accesses.
        if ((flags & EvalFlags.InstantiableType) !== 0) {
            const memberName = node.d.member.d.value;
            if (memberName === 'args' || memberName === 'kwargs') {
                leftExprFlags |= EvalFlags.NoConvertSpecialForm;
            }
        }
        const baseTypeResult = getTypeOfExpression(node.d.leftExpr, leftExprFlags);

        if (isTypeAliasPlaceholder(baseTypeResult.type)) {
            return {
                type: UnknownType.create(/* isIncomplete */ true),
                isIncomplete: true,
            };
        }

        const typeResult = getTypeOfMemberAccessWithBaseType(
            node,
            baseTypeResult,
            { method: 'get' },
            flags | EvalFlags.NoSpecialize
        );

        if (isCodeFlowSupportedForReference(node)) {
            // Before performing code flow analysis, update the cache to prevent recursion.
            writeTypeCache(node, { ...typeResult, isIncomplete: true }, flags);
            writeTypeCache(node.d.member, { ...typeResult, isIncomplete: true }, flags);

            // If the type is initially unbound, see if there's a parent class that
            // potentially initialized the value.
            let typeAtStart = typeResult.type;
            let isTypeAtStartIncomplete = !!typeResult.isIncomplete;
            if (isUnbound(typeAtStart)) {
                const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);

                let classMemberInfo: ClassMember | undefined;
                if (isInstantiableClass(baseType)) {
                    classMemberInfo = lookUpClassMember(
                        baseType,
                        node.d.member.d.value,
                        MemberAccessFlags.SkipOriginalClass
                    );
                } else if (isClassInstance(baseType)) {
                    classMemberInfo = lookUpObjectMember(
                        baseType,
                        node.d.member.d.value,
                        MemberAccessFlags.SkipOriginalClass
                    );
                }

                if (classMemberInfo) {
                    typeAtStart = getTypeOfMember(classMemberInfo);
                    isTypeAtStartIncomplete = false;
                }
            }

            // See if we can refine the type based on code flow analysis.
            const codeFlowTypeResult = getFlowTypeOfReference(node, /* startNode */ undefined, {
                targetSymbolId: indeterminateSymbolId,
                typeAtStart: { type: typeAtStart, isIncomplete: isTypeAtStartIncomplete },
                skipConditionalNarrowing: (flags & EvalFlags.TypeExpression) !== 0,
            });

            if (codeFlowTypeResult.type) {
                typeResult.type = codeFlowTypeResult.type;
            }

            if (codeFlowTypeResult.isIncomplete) {
                typeResult.isIncomplete = true;
            }

            // Detect, report, and fill in missing type arguments if appropriate.
            typeResult.type = reportMissingTypeArgs(node, typeResult.type, flags);

            // Add TypeForm details if appropriate.
            typeResult.type = addTypeFormForSymbol(node, typeResult.type, flags, /* includesVarDecl */ false);
        }

        if (baseTypeResult.isIncomplete) {
            typeResult.isIncomplete = true;
        }

        // See if we need to log an "unknown member access" diagnostic.
        let skipPartialUnknownCheck = typeResult.isIncomplete;

        // Don't report an error if the type is a partially-specialized
        // class being passed as an argument. This comes up frequently in
        // cases where a type is passed as an argument (e.g. "defaultdict(list)").
        // It can also come up in cases like "isinstance(x, (list, dict))".
        // We need to check for functions as well to handle Callable.
        if (
            (isInstantiableClass(typeResult.type) && !typeResult.type.priv.includeSubclasses) ||
            typeResult.type.props?.specialForm
        ) {
            const argNode = ParseTreeUtils.getParentNodeOfType(node, ParseNodeType.Argument);
            if (argNode && argNode?.parent?.nodeType === ParseNodeType.Call) {
                skipPartialUnknownCheck = true;
            }
        }

        if (!skipPartialUnknownCheck) {
            reportPossibleUnknownAssignment(
                nodeInfo.getFileInfo(node).diagnosticRuleSet.reportUnknownMemberType,
                DiagnosticRule.reportUnknownMemberType,
                node.d.member,
                typeResult.type,
                node,
                /* ignoreEmptyContainers */ false
            );
        }

        // Cache the type information in the member name node.
        writeTypeCache(node.d.member, typeResult, flags);

        return typeResult;
    }

    function getTypeOfMemberAccessWithBaseType(
        node: MemberAccessNode,
        baseTypeResult: TypeResult,
        usage: EvaluatorUsage,
        flags: EvalFlags,
        allowFunctionSignatureAssignment = true
    ): TypeResult {
        let baseType = transformPossibleRecursiveTypeAlias(baseTypeResult.type);
        const memberName = node.d.member.d.value;
        let diag = new DiagnosticAddendum();
        const fileInfo = nodeInfo.getFileInfo(node);
        let type: Type | undefined;
        let narrowedTypeForSet: Type | undefined;
        let typeErrors = false;
        let isIncomplete = !!baseTypeResult.isIncomplete;
        let isAsymmetricAccessor: boolean | undefined;
        const isRequired = false;
        const isNotRequired = false;
        let memberAccessDeprecationInfo: MemberAccessDeprecationInfo | undefined;

        if (usage?.setType?.isIncomplete) {
            isIncomplete = true;
        }

        // If the base type was incomplete and unbound, don't proceed
        // because false positive errors will be generated.
        if (baseTypeResult.isIncomplete && isUnbound(baseType)) {
            return { type: UnknownType.create(/* isIncomplete */ true), isIncomplete: true };
        }

        if (baseType.props?.specialForm && (flags & EvalFlags.TypeExpression) === 0) {
            baseType = baseType.props.specialForm;
        }

        if (isParamSpec(baseType) && baseType.priv.paramSpecAccess) {
            baseType = makeTopLevelTypeVarsConcrete(baseType);
        }

        switch (baseType.category) {
            case TypeCategory.Any:
            case TypeCategory.Unknown:
            case TypeCategory.Never: {
                type = baseType;
                break;
            }

            case TypeCategory.Unbound: {
                break;
            }

            case TypeCategory.TypeVar: {
                if (isParamSpec(baseType)) {
                    // Handle special cases for "P.args" and "P.kwargs".
                    if (memberName === 'args' || memberName === 'kwargs') {
                        const isArgs = memberName === 'args';
                        const paramNode = ParseTreeUtils.getEnclosingParam(node);
                        const expectedCategory = isArgs ? ParamCategory.ArgsList : ParamCategory.KwargsDict;

                        if (!paramNode || paramNode.d.category !== expectedCategory) {
                            const errorMessage = isArgs
                                ? LocMessage.paramSpecArgsUsage()
                                : LocMessage.paramSpecKwargsUsage();
                            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, errorMessage, node);
                            type = UnknownType.create(isIncomplete);
                            break;
                        }

                        type = TypeVarType.cloneForParamSpecAccess(baseType, memberName);
                        break;
                    }

                    if (!isIncomplete) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.paramSpecUnknownMember().format({ name: memberName }),
                            node
                        );
                    }

                    type = UnknownType.create(isIncomplete);
                    break;
                }

                // It's illegal to reference a member from a type variable.
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    if (!isIncomplete) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarNoMember().format({
                                type: printType(baseType),
                                name: memberName,
                            }),
                            node.d.leftExpr
                        );
                    }

                    type = UnknownType.create(isIncomplete);
                    break;
                }

                if (baseType.shared.recursiveAlias) {
                    type = UnknownType.create(/* isIncomplete */ true);
                    isIncomplete = true;
                    break;
                }

                if (isTypeVarTuple(baseType)) {
                    break;
                }

                return getTypeOfMemberAccessWithBaseType(
                    node,
                    {
                        type: makeTopLevelTypeVarsConcrete(baseType),
                        bindToSelfType: TypeBase.isInstantiable(baseType) ? convertToInstance(baseType) : baseType,
                        isIncomplete,
                    },
                    usage,
                    EvalFlags.None
                );
            }

            case TypeCategory.Class: {
                let typeResult: TypeResult | undefined;

                // If this is a class-like function created via NewType, treat
                // it like a function for purposes of member accesses.
                if (
                    ClassType.isNewTypeClass(baseType) &&
                    !baseType.priv.includeSubclasses &&
                    prefetched?.functionClass &&
                    isClass(prefetched.functionClass)
                ) {
                    baseType = ClassType.cloneAsInstance(prefetched.functionClass);
                }

                const enumMemberResult = getTypeOfEnumMember(
                    evaluatorInterface,
                    node,
                    baseType,
                    memberName,
                    isIncomplete,
                    nodeInfo
                );

                if (enumMemberResult) {
                    if (usage.method === 'get') {
                        typeResult = enumMemberResult;
                    } else {
                        // Is this an attempt to delete or overwrite an enum member?
                        if (
                            isClassInstance(enumMemberResult.type) &&
                            ClassType.isSameGenericClass(enumMemberResult.type, ClassType.cloneAsInstance(baseType)) &&
                            enumMemberResult.type.priv.literalValue !== undefined
                        ) {
                            const diagMessage =
                                usage.method === 'set' ? LocMessage.enumMemberSet() : LocMessage.enumMemberDelete();
                            addDiagnostic(
                                DiagnosticRule.reportAttributeAccessIssue,
                                diagMessage.format({ name: memberName }) + diag.getString(),
                                node.d.member,
                                diag.getEffectiveTextRange() ?? node.d.member
                            );
                        }
                    }
                }

                if (!typeResult) {
                    typeResult = getTypeOfBoundMember(
                        node.d.member,
                        baseType,
                        memberName,
                        usage,
                        diag,
                        (flags & EvalFlags.TypeExpression) === 0 ? undefined : MemberAccessFlags.TypeExpression,
                        baseTypeResult.bindToSelfType
                    );
                }

                if (typeResult) {
                    if (!typeResult.typeErrors) {
                        type = addConditionToType(typeResult.type, getTypeCondition(baseType), {
                            skipSelfCondition: true,
                            skipBoundTypeVars: true,
                        });
                    } else {
                        typeErrors = true;
                    }

                    if (typeResult.isAsymmetricAccessor) {
                        isAsymmetricAccessor = true;
                    }

                    if (typeResult.isIncomplete) {
                        isIncomplete = true;
                    }

                    if (typeResult.narrowedTypeForSet) {
                        narrowedTypeForSet = addConditionToType(
                            typeResult.narrowedTypeForSet,
                            getTypeCondition(baseType),
                            { skipSelfCondition: true, skipBoundTypeVars: true }
                        );
                    }

                    if (typeResult.memberAccessDeprecationInfo) {
                        memberAccessDeprecationInfo = typeResult.memberAccessDeprecationInfo;
                    }
                }
                break;
            }

            case TypeCategory.Module: {
                let symbol = ModuleType.getField(baseType, memberName);

                // If the symbol isn't found in the module's symbol table,
                // see if it's defined in the `ModuleType` class. This is
                // needed for modules that are synthesized for namespace
                // packages.
                if (!symbol && prefetched?.moduleTypeClass && isInstantiableClass(prefetched.moduleTypeClass)) {
                    symbol = ClassType.getSymbolTable(prefetched.moduleTypeClass).get(memberName);
                }

                if (symbol && !symbol.isExternallyHidden()) {
                    if (usage.method === 'get') {
                        setSymbolAccessed(fileInfo, symbol, node.d.member);
                    }

                    const typeResult = getEffectiveTypeOfSymbolForUsage(
                        symbol,
                        /* usageNode */ undefined,
                        /* useLastDecl */ true
                    );
                    type = typeResult.type;

                    if ((flags & EvalFlags.TypeExpression) !== 0) {
                        type = validateSymbolIsTypeExpression(node, type, !!typeResult.includesVariableDecl);
                    }

                    // Add TypeForm details if appropriate.
                    type = addTypeFormForSymbol(node, type, flags, !!typeResult.includesVariableDecl);

                    if (isTypeVar(type)) {
                        type = validateTypeVarUsage(node, type, flags);
                    }

                    // If the type resolved to "unbound", treat it as "unknown" in
                    // the case of a module reference because if it's truly unbound,
                    // that error will be reported within the module and should not
                    // leak into other modules that import it.
                    if (isUnbound(type)) {
                        type = UnknownType.create(/* isIncomplete */ true);
                    }

                    if (symbol.isPrivateMember()) {
                        addDiagnostic(
                            DiagnosticRule.reportPrivateUsage,
                            LocMessage.privateUsedOutsideOfModule().format({
                                name: memberName,
                            }),
                            node.d.member
                        );
                    }

                    if (symbol.isPrivatePyTypedImport()) {
                        addDiagnostic(
                            DiagnosticRule.reportPrivateImportUsage,
                            LocMessage.privateImportFromPyTypedModule().format({
                                name: memberName,
                                module: baseType.priv.moduleName,
                            }),
                            node.d.member
                        );
                    }
                } else {
                    // Does the module export a top-level __getattr__ function?
                    if (usage.method === 'get') {
                        const getAttrSymbol = ModuleType.getField(baseType, '__getattr__');
                        if (getAttrSymbol) {
                            const isModuleGetAttrSupported =
                                PythonVersion.isGreaterOrEqualTo(
                                    fileInfo.executionEnvironment.pythonVersion,
                                    pythonVersion3_7
                                ) || getAttrSymbol.getDeclarations().some((decl) => decl.uri.hasExtension('.pyi'));

                            if (isModuleGetAttrSupported) {
                                const getAttrTypeResult = getEffectiveTypeOfSymbolForUsage(getAttrSymbol);
                                if (isFunction(getAttrTypeResult.type)) {
                                    const returnTypeResult = getEffectiveReturnTypeResult(getAttrTypeResult.type);
                                    type = returnTypeResult.type;
                                    if (getAttrTypeResult.isIncomplete || returnTypeResult.isIncomplete) {
                                        isIncomplete = true;
                                    }
                                }
                            }
                        }
                    }

                    // If the field was not found and the module type is marked
                    // such that all fields should be Any/Unknown, return that type.
                    if (!type && baseType.priv.notPresentFieldType) {
                        type = baseType.priv.notPresentFieldType;
                    }

                    if (!type) {
                        if (!isIncomplete) {
                            addDiagnostic(
                                DiagnosticRule.reportAttributeAccessIssue,
                                LocMessage.moduleUnknownMember().format({
                                    memberName,
                                    moduleName: baseType.priv.moduleName,
                                }),
                                node.d.member
                            );
                        }
                        type = evaluatorOptions.evaluateUnknownImportsAsAny ? AnyType.create() : UnknownType.create();
                    }
                }
                break;
            }

            case TypeCategory.Union: {
                type = mapSubtypes(baseType, (subtype) => {
                    if (isUnbound(subtype)) {
                        // Don't do anything if it's unbound. The error will already
                        // be reported elsewhere.
                        return undefined;
                    }

                    if (isNoneInstance(subtype)) {
                        assert(isClassInstance(subtype));
                        const typeResult = getTypeOfBoundMember(node.d.member, subtype, memberName, usage, diag);

                        if (typeResult && !typeResult.typeErrors) {
                            type = addConditionToType(typeResult.type, getTypeCondition(baseType), {
                                skipBoundTypeVars: true,
                            });
                            if (typeResult.isIncomplete) {
                                isIncomplete = true;
                            }

                            return type;
                        }

                        if (!isIncomplete) {
                            addDiagnostic(
                                DiagnosticRule.reportOptionalMemberAccess,
                                LocMessage.noneUnknownMember().format({ name: memberName }),
                                node.d.member
                            );
                        }

                        return undefined;
                    }

                    const typeResult = getTypeOfMemberAccessWithBaseType(
                        node,
                        {
                            type: subtype,
                            isIncomplete: baseTypeResult.isIncomplete,
                        },
                        usage,
                        EvalFlags.None
                    );

                    if (typeResult.isIncomplete) {
                        isIncomplete = true;
                    }

                    if (typeResult.memberAccessDeprecationInfo) {
                        memberAccessDeprecationInfo = typeResult.memberAccessDeprecationInfo;
                    }

                    if (typeResult.typeErrors) {
                        typeErrors = true;
                    }

                    return typeResult.type;
                });
                break;
            }

            case TypeCategory.Function:
            case TypeCategory.Overloaded: {
                const hasSelf = isMethodType(baseType);
                const functionTypes = isFunction(baseType) ? [baseType] : OverloadedType.getOverloads(baseType);
                const isBuiltinsFunction = functionTypes.some(
                    (functionType) =>
                        FunctionType.isBuiltIn(functionType) && functionType.shared.moduleName === 'builtins'
                );

                if (memberName === '__self__' && hasSelf) {
                    // Handle "__self__" specially because MethodType defines
                    // it simply as "object". We can do better here.
                    let functionType: FunctionType | undefined;

                    if (isFunction(baseType)) {
                        functionType = baseType;
                    } else {
                        const overloads = OverloadedType.getOverloads(baseType);
                        if (overloads.length > 0) {
                            functionType = overloads[0];
                        }
                    }

                    type = functionType?.priv.boundToType;
                } else {
                    const altType = hasSelf ? prefetched?.methodClass : prefetched?.functionClass;
                    type = getTypeOfMemberAccessWithBaseType(
                        node,
                        { type: altType ? convertToInstance(altType) : UnknownType.create() },
                        usage,
                        flags,
                        !hasSelf && !isBuiltinsFunction
                    ).type;
                }
                break;
            }

            case TypeCategory.OverloadResult:
                throw new Error('Overload-result member dispatch is not enabled');

            default:
                assertNever(baseType);
        }

        // If type is undefined, emit a general error message indicating that the
        // member could not be accessed.
        if (!type) {
            const isFunctionRule =
                isFunctionOrOverloaded(baseType) ||
                (isClassInstance(baseType) && ClassType.isBuiltIn(baseType, ['function', 'FunctionType']));

            // These signature metadata attributes can be assigned on function objects at runtime.
            const isFunctionSignatureAssignment =
                allowFunctionSignatureAssignment &&
                usage.method === 'set' &&
                (memberName === '__signature__' || memberName === '__text_signature__') &&
                isClassInstance(baseType) &&
                ClassType.isBuiltIn(baseType, ['function', 'FunctionType']);

            if (!baseTypeResult.isIncomplete && !isFunctionSignatureAssignment) {
                let diagMessage = LocMessage.memberAccess();
                if (usage.method === 'set') {
                    diagMessage = LocMessage.memberSet();
                } else if (usage.method === 'del') {
                    diagMessage = LocMessage.memberDelete();
                }

                // If there is an expected type diagnostic addendum (used for assignments),
                // use that rather than the local diagnostic addendum because it will be
                // more informative.
                if (usage.setExpectedTypeDiag && !usage.setExpectedTypeDiag.isEmpty()) {
                    diag = usage.setExpectedTypeDiag;
                }

                // If the class is a TypedDict, and there's a key with the same name,
                // suggest that they user want to use ["key"] name instead.
                if (isClass(baseType) && baseType.shared.typedDictEntries) {
                    const tdKey = baseType.shared.typedDictEntries.knownItems.get(memberName);
                    if (tdKey) {
                        const subDiag = new DiagnosticAddendum();
                        subDiag.addMessage(LocAddendum.typedDictKeyAccess().format({ name: memberName }));
                        diag.addAddendum(subDiag);
                    }
                }

                const rule = isFunctionRule
                    ? DiagnosticRule.reportFunctionMemberAccess
                    : DiagnosticRule.reportAttributeAccessIssue;

                addDiagnostic(
                    rule,
                    diagMessage.format({ name: memberName, type: printType(baseType) }) + diag.getString(),
                    node.d.member,
                    diag.getEffectiveTextRange() ?? node.d.member
                );
            }

            // If this is member access on a function, use "Any" so if the
            // reportFunctionMemberAccess rule is disabled, we don't trigger
            // additional reportUnknownMemberType diagnostics.
            type = isFunctionRule ? AnyType.create() : UnknownType.create();
        }

        if ((flags & EvalFlags.TypeExpression) === 0) {
            reportUseOfTypeCheckOnly(type, node.d.member);
        }

        type = convertSpecialFormToRuntimeValue(type, flags);

        return {
            type,
            isIncomplete,
            isAsymmetricAccessor,
            narrowedTypeForSet,
            isRequired,
            isNotRequired,
            memberAccessDeprecationInfo,
            typeErrors,
        };
    }

    function getTypeOfClassMemberName(
        errorNode: ExpressionNode | undefined,
        classType: ClassType,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum | undefined,
        flags: MemberAccessFlags,
        selfType?: ClassType | TypeVarType,
        recursionCount = 0
    ): ClassMemberLookup | undefined {
        const isAccessedThroughObject = TypeBase.isInstance(classType);

        // Always look for a member with a declared type first.
        let memberInfo = lookUpClassMember(classType, memberName, flags | MemberAccessFlags.DeclaredTypesOnly);

        // A class-level method alias retains its inferred signature, unlike an annotated variable.
        if (
            usage.method === 'get' &&
            memberInfo?.skippedUndeclaredType &&
            memberInfo.symbol.getTypedDeclarations().some((decl) => decl.type === DeclarationType.Function)
        ) {
            const inferredMember = lookUpClassMember(classType, memberName, flags);
            if (
                inferredMember?.isClassMember &&
                !inferredMember.isInstanceMember &&
                isFunctionOrOverloaded(getTypeOfMember(inferredMember))
            ) {
                memberInfo = inferredMember;
            }
        }

        // If we couldn't find a symbol with a declared type, use
        // a symbol with an inferred type.
        if (!memberInfo) {
            memberInfo = lookUpClassMember(classType, memberName, flags);
        }

        if (!memberInfo) {
            // No attribute of that name was found. If this is a member access
            // through an object, see if there's an attribute access override
            // method ("__getattr__", etc.).
            if ((flags & MemberAccessFlags.SkipAttributeAccessOverride) === 0 && errorNode) {
                const generalAttrType = applyAttributeAccessOverride(errorNode, classType, usage, memberName, selfType);
                if (generalAttrType) {
                    return {
                        symbol: undefined,
                        type: generalAttrType.type,
                        isTypeIncomplete: false,
                        isDescriptorError: false,
                        isClassMember: false,
                        isClassVar: false,
                        isAsymmetricAccessor: !!generalAttrType.isAsymmetricAccessor,
                    };
                }
            }

            // Report that the member could not be accessed.
            diag?.addMessage(LocAddendum.memberUnknown().format({ name: memberName }));
            return undefined;
        }

        let type: Type | undefined;
        let isTypeIncomplete = false;
        let narrowedTypeForSet: Type | undefined;

        if (memberInfo.symbol.isInitVar()) {
            diag?.addMessage(LocAddendum.memberIsInitVar().format({ name: memberName }));
            return undefined;
        }

        if (usage.method !== 'get' && errorNode) {
            // If the usage indicates a 'set' or 'delete' and the access is within the
            // class definition itself, use only the declared type to avoid circular
            // type evaluation.
            const containingClass = ParseTreeUtils.getEnclosingClass(errorNode);
            if (containingClass) {
                const containingClassType = getTypeOfClass(containingClass)?.classType;
                if (
                    containingClassType &&
                    isInstantiableClass(containingClassType) &&
                    ClassType.isSameGenericClass(
                        isAccessedThroughObject ? ClassType.cloneAsInstance(containingClassType) : containingClassType,
                        classType
                    )
                ) {
                    type = getDeclaredTypeOfSymbol(memberInfo.symbol)?.type;
                    if (type && isInstantiableClass(memberInfo.classType)) {
                        type = partiallySpecializeType(
                            type,
                            memberInfo.classType,
                            /* typeClassType */ undefined,
                            selfType
                        );
                    }

                    // If we're setting a class variable via a write through an object,
                    // this is normally considered a type violation. But it is allowed
                    // if the class variable is a descriptor object. In this case, we will
                    // clear the flag that causes an error to be generated.
                    if (
                        usage.method === 'set' &&
                        isEffectivelyClassVar(memberInfo.symbol, ClassType.isDataClass(containingClassType)) &&
                        isAccessedThroughObject
                    ) {
                        const selfClass = selfType ?? memberName === '__new__' ? undefined : classType;
                        const typeResult = getTypeOfMemberInternal(errorNode, memberInfo, selfClass, flags);

                        if (typeResult) {
                            if (isDescriptorInstance(typeResult.type, /* requireSetter */ true)) {
                                type = typeResult.type;
                                flags &= MemberAccessFlags.DisallowClassVarWrites;
                            }
                        }
                    }

                    if (!type) {
                        type = UnknownType.create();
                    }
                }
            }
        }

        if (!type) {
            let selfClass: ClassType | TypeVarType | undefined;

            if (selfType) {
                selfClass = convertToInstantiable(selfType) as TypeVarType | ClassType;
            } else {
                // Skip this for __new__ methods because they are not bound
                // to the class but rather assume the type of the cls argument.
                if (memberName !== '__new__') {
                    selfClass = classType;
                }
            }

            const typeResult = getTypeOfMemberInternal(errorNode, memberInfo, selfClass, flags);

            type = typeResult?.type ?? UnknownType.create();
            if (typeResult?.isIncomplete) {
                isTypeIncomplete = true;
            }
        }

        // Don't include variables within typed dict classes.
        if (isClass(memberInfo.classType) && ClassType.isTypedDictClass(memberInfo.classType)) {
            const typedDecls = memberInfo.symbol.getTypedDeclarations();
            if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable) {
                diag?.addMessage(LocAddendum.memberUnknown().format({ name: memberName }));
                return undefined;
            }
        }

        if (usage.method === 'get') {
            // Mark the member accessed if it's not coming from a parent class.
            if (
                errorNode &&
                isInstantiableClass(memberInfo.classType) &&
                ClassType.isSameGenericClass(
                    memberInfo.classType,
                    isAccessedThroughObject ? ClassType.cloneAsInstantiable(classType) : classType
                )
            ) {
                setSymbolAccessed(nodeInfo.getFileInfo(errorNode), memberInfo.symbol, errorNode);
            }

            // Special-case `__init_subclass` and `__class_getitem__` because
            // these are always treated as class methods even if they're not
            // decorated as such.
            if (memberName === '__init_subclass__' || memberName === '__class_getitem__') {
                if (isFunction(type) && !FunctionType.isClassMethod(type)) {
                    type = FunctionType.cloneWithNewFlags(type, type.shared.flags | FunctionTypeFlags.ClassMethod);
                }
            }
        }

        // If the member is a descriptor object, apply the descriptor protocol
        // now. If the member is an instance or class method, bind the method.
        let isDescriptorError = false;
        let isAsymmetricAccessor = false;
        let isDescriptorApplied = false;
        let memberAccessDeprecationInfo: MemberAccessDeprecationInfo | undefined;

        type = mapSubtypes(
            type,
            (subtype) => {
                const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);
                const isClassMember = !memberInfo || (memberInfo.isClassMember && !memberInfo.isSlotsMember);
                let resultType: Type;

                if (isClass(concreteSubtype) && isClassMember && errorNode) {
                    const descResult = applyDescriptorAccessMethod(
                        subtype,
                        concreteSubtype,
                        memberInfo,
                        classType,
                        selfType,
                        flags,
                        errorNode,
                        memberName,
                        usage,
                        diag
                    );

                    if (descResult.isAsymmetricAccessor) {
                        isAsymmetricAccessor = true;
                    }

                    if (descResult.memberAccessDeprecationInfo) {
                        memberAccessDeprecationInfo = descResult.memberAccessDeprecationInfo;
                    }

                    if (descResult.typeErrors) {
                        isDescriptorError = true;
                    }

                    if (descResult.isDescriptorApplied) {
                        isDescriptorApplied = true;
                    }

                    resultType = descResult.type;
                } else if (isFunctionOrOverloaded(concreteSubtype) && TypeBase.isInstance(concreteSubtype)) {
                    const typeResult = bindMethodForMemberAccess(
                        subtype,
                        concreteSubtype,
                        memberInfo,
                        classType,
                        selfType,
                        flags,
                        memberName,
                        usage,
                        diag,
                        recursionCount
                    );

                    resultType = typeResult.type;
                    if (typeResult.typeErrors) {
                        isDescriptorError = true;
                    }
                } else {
                    resultType = subtype;
                }

                // If this is a "set" or "delete" operation, we have a bit more work to do.
                if (usage.method === 'get') {
                    return resultType;
                }

                // Check for an attempt to overwrite or delete a ClassVar member from an instance.
                if (
                    !isDescriptorApplied &&
                    memberInfo &&
                    isEffectivelyClassVar(memberInfo.symbol, ClassType.isDataClass(classType)) &&
                    (flags & MemberAccessFlags.DisallowClassVarWrites) !== 0
                ) {
                    diag?.addMessage(LocAddendum.memberSetClassVar().format({ name: memberName }));
                    isDescriptorError = true;
                }

                // Check for an attempt to overwrite or delete a final member variable.
                const finalVarTypeDecl = memberInfo?.symbol
                    .getDeclarations()
                    .find((decl) => isFinalVariableDeclaration(decl));

                if (
                    finalVarTypeDecl &&
                    errorNode &&
                    !ParseTreeUtils.isNodeContainedWithin(errorNode, finalVarTypeDecl.node)
                ) {
                    // If a Final instance variable is declared in the class body but is
                    // being assigned within an __init__ method, it's allowed.
                    const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(errorNode);
                    if (
                        !enclosingFunctionNode ||
                        enclosingFunctionNode.d.name.d.value !== '__init__' ||
                        (finalVarTypeDecl as VariableDeclaration).inferredTypeSource !== undefined ||
                        isInstantiableClass(classType)
                    ) {
                        diag?.addMessage(LocMessage.finalReassigned().format({ name: memberName }));
                        isDescriptorError = true;
                    }
                }

                // Check for an attempt to overwrite or delete an instance variable that is
                // read-only (e.g. in a named tuple).
                if (memberInfo?.isInstanceMember && isClass(memberInfo.classType) && memberInfo.isReadOnly) {
                    diag?.addMessage(LocAddendum.readOnlyAttribute().format({ name: memberName }));
                    isDescriptorError = true;
                }

                return resultType;
            },
            { retainTypeAlias: true }
        );

        if (!isDescriptorError && usage.method === 'set' && usage.setType) {
            if (errorNode && memberInfo.symbol.hasTypedDeclarations()) {
                // This is an assignment to a member with a declared type. Apply
                // narrowing logic based on the assigned type. Skip this for
                // descriptor-based accesses.
                narrowedTypeForSet = isDescriptorApplied
                    ? usage.setType.type
                    : narrowTypeBasedOnAssignment(type, usage.setType).type;
            }

            // Verify that the assigned type is compatible.
            if (!assignType(type, usage.setType.type, diag?.createAddendum())) {
                if (!usage.setType.isIncomplete) {
                    diag?.addMessage(
                        LocAddendum.memberAssignment().format({
                            type: printType(usage.setType.type),
                            name: memberName,
                            classType: printObjectTypeForClass(classType),
                        })
                    );
                }

                // Do not narrow the type in this case. Assume the declared type.
                narrowedTypeForSet = type;
                isDescriptorError = true;
            }

            if (
                isInstantiableClass(memberInfo.classType) &&
                ClassType.isDataClassFrozen(memberInfo.classType) &&
                isAccessedThroughObject
            ) {
                diag?.addMessage(
                    LocAddendum.dataClassFrozen().format({
                        name: printType(ClassType.cloneAsInstance(memberInfo.classType)),
                    })
                );

                isDescriptorError = true;
            }
        }

        return {
            symbol: memberInfo.symbol,
            type,
            isTypeIncomplete,
            isDescriptorError,
            isClassMember: !memberInfo.isInstanceMember,
            isClassVar: memberInfo.isClassVar,
            classType: memberInfo.classType,
            isAsymmetricAccessor,
            narrowedTypeForSet,
            memberAccessDeprecationInfo,
        };
    }

    // Applies descriptor access methods "__get__", "__set__", or "__delete__"
    // if they apply.
    function applyDescriptorAccessMethod(
        memberType: Type,
        concreteMemberType: ClassType,
        memberInfo: ClassMember | undefined,
        classType: ClassType,
        selfType: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags,
        errorNode: ExpressionNode,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum | undefined
    ): MemberAccessTypeResult {
        const isAccessedThroughObject = TypeBase.isInstance(classType);

        let accessMethodName: string;
        if (usage.method === 'get') {
            accessMethodName = '__get__';
        } else if (usage.method === 'set') {
            accessMethodName = '__set__';
        } else {
            accessMethodName = '__delete__';
        }

        const subDiag = diag ? new DiagnosticAddendum() : undefined;

        const methodTypeResult = getTypeOfBoundMember(
            errorNode,
            concreteMemberType,
            accessMethodName,
            /* usage */ undefined,
            subDiag,
            MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipAttributeAccessOverride
        );

        const deferredMethodType =
            usage.method === 'get'
                ? getDescriptorGetMethodWithDeferredSelfSpecialization(concreteMemberType, subDiag)
                : undefined;

        if ((!methodTypeResult || methodTypeResult.typeErrors) && !deferredMethodType) {
            // Provide special error messages for properties.
            if (ClassType.isPropertyClass(concreteMemberType) && usage.method !== 'get') {
                const message =
                    usage.method === 'set' ? LocAddendum.propertyMissingSetter() : LocAddendum.propertyMissingDeleter();
                diag?.addMessage(message.format({ name: memberName }));
                return { type: AnyType.create(), typeErrors: true };
            }

            if (classType.shared.typeVarScopeId) {
                memberType = makeTypeVarsBound(memberType, [classType.shared.typeVarScopeId]);
            }

            return { type: memberType };
        }

        const methodClassType = methodTypeResult?.classType ?? concreteMemberType;
        let methodType = deferredMethodType ?? methodTypeResult!.type;

        if (!methodClassType) {
            if (diag && subDiag) {
                diag.addAddendum(subDiag);
            }
            return { type: UnknownType.create(), typeErrors: true };
        }

        if (!isFunctionOrOverloaded(methodType)) {
            if (isAnyOrUnknown(methodType)) {
                return { type: methodType };
            }

            // TODO - emit an error for this condition.
            return { type: memberType, typeErrors: true };
        }

        // Special-case logic for properties.
        if (
            ClassType.isPropertyClass(concreteMemberType) &&
            memberInfo &&
            isInstantiableClass(memberInfo.classType) &&
            methodType
        ) {
            // If the property is being accessed from a protocol class (not an instance),
            // flag this as an error because a property within a protocol is meant to be
            // interpreted as a read-only attribute rather than a protocol, so accessing
            // it directly from the class has an ambiguous meaning.
            if ((flags & MemberAccessFlags.SkipInstanceMembers) !== 0 && ClassType.isProtocolClass(classType)) {
                diag?.addMessage(LocAddendum.propertyAccessFromProtocolClass());
                return { type: memberType, typeErrors: true };
            }

            // Infer return types before specializing. Otherwise a generic inferred
            // return type won't be properly specialized.
            inferReturnTypeIfNecessary(methodType);

            // This specialization is required specifically for properties, which should be
            // generic but are not defined that way. Because of this, we use type variables
            // in the synthesized methods (e.g. __get__) for the property class that are
            // defined in the class that declares the fget method.
            let accessMethodClass: ClassType | undefined;
            if (usage.method === 'get') {
                accessMethodClass = concreteMemberType.priv.fgetInfo?.classType;
            } else if (usage.method === 'set') {
                accessMethodClass = concreteMemberType.priv.fsetInfo?.classType;
            } else {
                accessMethodClass = concreteMemberType.priv.fdelInfo?.classType;
            }

            if (accessMethodClass) {
                const constraints = new ConstraintTracker();
                accessMethodClass = selfSpecializeClass(accessMethodClass);
                assignType(
                    ClassType.cloneAsInstance(accessMethodClass),
                    ClassType.cloneAsInstance(memberInfo.classType),
                    /* diag */ undefined,
                    constraints
                );
                accessMethodClass = solveAndApplyConstraints(accessMethodClass, constraints) as ClassType;

                const specializedType = partiallySpecializeType(
                    methodType,
                    accessMethodClass,
                    getTypeClassType(),
                    selfType ? (convertToInstantiable(selfType) as ClassType | TypeVarType) : classType
                );

                if (isFunctionOrOverloaded(specializedType)) {
                    methodType = specializedType;
                }
            }
        }

        // Determine if we're calling __set__ on an asymmetric descriptor or property.
        let isAsymmetricAccessor = false;
        if (usage.method === 'set') {
            if (isAsymmetricDescriptorClass(concreteMemberType)) {
                isAsymmetricAccessor = true;
            }
        }

        if (!methodType) {
            diag?.addMessage(
                LocAddendum.descriptorAccessBindingFailed().format({
                    name: accessMethodName,
                    className: printType(convertToInstance(methodClassType)),
                })
            );

            return {
                type: UnknownType.create(),
                typeErrors: true,
                isDescriptorApplied: true,
                isAsymmetricAccessor,
            };
        }

        // Simulate a call to the access method.
        const argList: Arg[] = [];

        // Provide "obj" argument.
        let objArgType: Type;
        if (ClassType.isClassProperty(concreteMemberType)) {
            // Handle "class properties" as a special case. We need to pass
            // the class rather than the object instance in this case.
            objArgType = isAccessedThroughObject ? ClassType.cloneAsInstantiable(classType) : classType;
        } else if (isAccessedThroughObject) {
            objArgType = selfType ?? ClassType.cloneAsInstance(classType);
        } else {
            objArgType = getNoneType();
        }

        argList.push({
            argCategory: ArgCategory.Simple,
            typeResult: { type: objArgType },
        });

        if (usage.method === 'get') {
            let classArgType: Type;
            if (selfType) {
                classArgType = convertToInstantiable(selfType);
            } else {
                classArgType = isAccessedThroughObject ? ClassType.cloneAsInstantiable(classType) : classType;
            }

            // Provide "owner" argument.
            argList.push({
                argCategory: ArgCategory.Simple,
                typeResult: { type: classArgType },
            });
        } else if (usage.method === 'set') {
            // Provide "value" argument.
            argList.push({
                argCategory: ArgCategory.Simple,
                typeResult: {
                    type: usage.setType?.type ?? UnknownType.create(),
                    isIncomplete: !!usage.setType?.isIncomplete,
                },
            });
        }

        // Suppress diagnostics for these method calls because they would be redundant.
        const callResult = suppressDiagnostics(
            errorNode,
            () => {
                return validateCallArgs(
                    errorNode,
                    argList,
                    { type: methodType },
                    /* constraints */ undefined,
                    /* skipUnknownArgCheck */ true,
                    /* inferenceContext */ undefined
                );
            },
            (suppressedDiags) => {
                // If diagnostics were recorded when suppressed, add them to the
                // diagnostic as messages.
                if (diag) {
                    suppressedDiags.forEach((message) => {
                        diag?.addMessageMultiline(message);
                    });
                }
            }
        );

        // Collect deprecation information associated with the member access method.
        let deprecationInfo: MemberAccessDeprecationInfo | undefined;
        if (callResult.overloadsUsedForCall && callResult.overloadsUsedForCall.length >= 1) {
            const overloadUsed = callResult.overloadsUsedForCall[0];
            if (overloadUsed.shared.deprecatedMessage) {
                deprecationInfo = {
                    deprecatedMessage: overloadUsed.shared.deprecatedMessage,
                    accessType: ClassType.isPropertyClass(concreteMemberType) ? 'property' : 'descriptor',
                    accessMethod: usage.method,
                };
            }
        }

        if (!callResult.argumentErrors) {
            return {
                // For set or delete, always return Any.
                type: usage.method === 'get' ? callResult.returnType ?? UnknownType.create() : AnyType.create(),
                isDescriptorApplied: true,
                isAsymmetricAccessor,
                memberAccessDeprecationInfo: deprecationInfo,
            };
        }

        return {
            type: UnknownType.create(),
            typeErrors: true,
            isDescriptorApplied: true,
            isAsymmetricAccessor,
            memberAccessDeprecationInfo: deprecationInfo,
        };
    }

    function getDescriptorGetMethodWithDeferredSelfSpecialization(
        concreteMemberType: ClassType,
        diag: DiagnosticAddendum | undefined
    ): FunctionType | OverloadedType | undefined {
        const member = lookUpClassMember(concreteMemberType, '__get__');
        if (!member || !isInstantiableClass(member.unspecializedClassType)) {
            return undefined;
        }

        const unspecializedClassType = member.unspecializedClassType;
        const declaringClassType = member.classType;
        if (!isInstantiableClass(declaringClassType)) {
            return undefined;
        }
        const declaringObjectType = ClassType.cloneAsInstance(declaringClassType);

        const unspecializedMethodType = getEffectiveTypeOfSymbol(member.symbol);
        if (!isFunctionOrOverloaded(unspecializedMethodType)) {
            return undefined;
        }

        // A class ParamSpec used in Concatenate within the self annotation needs to be
        // solved from the concrete descriptor, rather than specialized before self is bound.
        const classParamSpecs = ClassType.getTypeParams(unspecializedClassType).filter(isParamSpec);
        if (classParamSpecs.length === 0) {
            return undefined;
        }

        const signatures = isFunction(unspecializedMethodType)
            ? [unspecializedMethodType]
            : OverloadedType.getOverloads(unspecializedMethodType);

        const shouldDefer = signatures.some((signature) => {
            if (signature.shared.parameters.length === 0) {
                return false;
            }

            const selfParamType = FunctionType.getParamType(signature, 0);
            if (!isClassInstance(selfParamType) || !ClassType.isSameGenericClass(selfParamType, declaringObjectType)) {
                return false;
            }

            class ConcatenateParamSpecWalker extends TypeWalker {
                found = false;

                override visitFunction(type: FunctionType): void {
                    const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
                    if (
                        paramSpec &&
                        FunctionType.cloneRemoveParamSpecArgsKwargs(type).shared.parameters.length > 0 &&
                        classParamSpecs.some((classParamSpec) => isTypeSame(paramSpec, classParamSpec))
                    ) {
                        this.found = true;
                        this.cancelWalk();
                        return;
                    }

                    super.visitFunction(type);
                }
            }

            const walker = new ConcatenateParamSpecWalker();
            selfParamType.priv.typeArgs?.forEach((typeArg) => walker.walk(typeArg));

            return walker.found;
        });

        if (!shouldDefer) {
            return undefined;
        }

        return bindFunctionToClassOrObject(
            declaringObjectType,
            unspecializedMethodType,
            declaringClassType,
            /* treatConstructorAsClassMethod */ false,
            concreteMemberType,
            diag
        );
    }

    function bindMethodForMemberAccess(
        type: Type,
        concreteType: FunctionType | OverloadedType,
        memberInfo: ClassMember | undefined,
        classType: ClassType,
        selfType: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum | undefined,
        recursionCount = 0
    ): TypeResult {
        return memberResolution.bindMethodForMemberAccess(
            type,
            concreteType,
            memberInfo,
            classType,
            selfType,
            flags,
            memberName,
            usage,
            diag,
            recursionCount
        );
    }

    function isAsymmetricDescriptorClass(classType: ClassType): boolean {
        return memberResolution.isAsymmetricDescriptorClass(classType);
    }

    // Applies the __getattr__, __setattr__ or __delattr__ method if present.
    // If it's not applicable, returns undefined.
    function applyAttributeAccessOverride(
        errorNode: ExpressionNode,
        classType: ClassType,
        usage: EvaluatorUsage,
        memberName: string,
        selfType?: ClassType | TypeVarType
    ): MemberAccessTypeResult | undefined {
        return memberResolution.applyAttributeAccessOverride(errorNode, classType, usage, memberName, selfType);
    }

    function getTypeOfIndex(node: IndexNode, flags = EvalFlags.None): TypeResult {
        const baseTypeResult = getTypeOfExpression(node.d.leftExpr, flags | EvalFlags.IndexBaseDefaults);

        // If this is meant to be a type and the base expression is a string expression,
        // emit an error because this is an illegal annotation form and will generate a
        // runtime exception.
        if (flags & EvalFlags.InstantiableType) {
            if (node.d.leftExpr.nodeType === ParseNodeType.StringList) {
                addDiagnostic(DiagnosticRule.reportIndexIssue, LocMessage.stringNotSubscriptable(), node.d.leftExpr);
            }
        }

        // Check for builtin classes that will generate runtime exceptions if subscripted.
        if ((flags & EvalFlags.ForwardRefs) === 0) {
            // We can skip this check if the class is used within a PEP 526 variable
            // type annotation within a class or function. For some undocumented reason,
            // they don't result in runtime exceptions when used in this manner.
            let skipSubscriptCheck = (flags & EvalFlags.VarTypeAnnotation) !== 0;
            if (skipSubscriptCheck) {
                const scopeNode = ParseTreeUtils.getExecutionScopeNode(node, nodeInfo);
                if (scopeNode?.nodeType === ParseNodeType.Module) {
                    skipSubscriptCheck = false;
                }
            }

            if (!skipSubscriptCheck) {
                const fileInfo = nodeInfo.getFileInfo(node);
                if (
                    isInstantiableClass(baseTypeResult.type) &&
                    ClassType.isBuiltIn(baseTypeResult.type) &&
                    !baseTypeResult.type.priv.aliasName
                ) {
                    const minPythonVersion = nonSubscriptableBuiltinTypes.get(baseTypeResult.type.shared.fullName);
                    if (
                        minPythonVersion !== undefined &&
                        PythonVersion.isLessThan(fileInfo.executionEnvironment.pythonVersion, minPythonVersion) &&
                        !fileInfo.isStubFile
                    ) {
                        addDiagnostic(
                            DiagnosticRule.reportIndexIssue,
                            LocMessage.classNotRuntimeSubscriptable().format({
                                name: baseTypeResult.type.priv.aliasName || baseTypeResult.type.shared.name,
                            }),
                            node.d.leftExpr
                        );
                    }
                }
            }
        }

        const indexTypeResult = getTypeOfIndexWithBaseType(node, baseTypeResult, { method: 'get' }, flags);

        if (isCodeFlowSupportedForReference(node)) {
            // We limit type narrowing for index expressions to built-in types that are
            // known to have symmetric __getitem__ and __setitem__ methods (i.e. the value
            // passed to __setitem__ is the same type as the value returned by __getitem__).
            let baseTypeSupportsIndexNarrowing = !isAny(baseTypeResult.type);
            mapSubtypesExpandTypeVars(baseTypeResult.type, /* options */ undefined, (subtype) => {
                if (
                    !isClassInstance(subtype) ||
                    !(ClassType.isBuiltIn(subtype) || ClassType.isTypedDictClass(subtype))
                ) {
                    baseTypeSupportsIndexNarrowing = false;
                }

                return undefined;
            });

            if (baseTypeSupportsIndexNarrowing) {
                // Before performing code flow analysis, update the cache to prevent recursion.
                writeTypeCache(node, { ...indexTypeResult, isIncomplete: true }, flags);

                // See if we can refine the type based on code flow analysis.
                const codeFlowTypeResult = getFlowTypeOfReference(node, /* startNode */ undefined, {
                    targetSymbolId: indeterminateSymbolId,
                    typeAtStart: {
                        type: indexTypeResult.type,
                        isIncomplete: !!baseTypeResult.isIncomplete || !!indexTypeResult.isIncomplete,
                    },
                    skipConditionalNarrowing: (flags & EvalFlags.TypeExpression) !== 0,
                });

                if (codeFlowTypeResult.type) {
                    indexTypeResult.type = codeFlowTypeResult.type;
                }

                if (codeFlowTypeResult.isIncomplete) {
                    indexTypeResult.isIncomplete = true;
                }
            }
        }

        if (baseTypeResult.isIncomplete) {
            indexTypeResult.isIncomplete = true;
        }

        return indexTypeResult;
    }

    // If the type is a generic type alias that is not specialized, provides
    // default type arguments for the type alias. It optionally logs diagnostics
    // for missing type arguments.
    function specializeTypeAliasWithDefaults(type: Type, errorNode: ExpressionNode | undefined) {
        return evaluatorCore.specializeTypeAliasWithDefaults(type, errorNode);
    }

    function convertTypeArgToInstance(type: Type, flags: EvalFlags): Type {
        const contextualType = (flags & EvalFlags.TypeFormArg) !== 0 ? type.props?.typeForm ?? type : type;
        return convertToInstance(contextualType);
    }

    // Handles index expressions that are providing type arguments for a
    // generic type alias.
    function createSpecializedTypeAlias(
        node: IndexNode,
        baseType: Type,
        flags: EvalFlags
    ): TypeResultWithNode | undefined {
        let aliasInfo = baseType.props?.typeAliasInfo;
        let aliasBaseType = baseType;

        if (!aliasInfo && baseType.props?.typeForm) {
            aliasInfo = baseType.props.typeForm?.props?.typeAliasInfo;
            aliasBaseType = convertToInstantiable(baseType.props.typeForm);
        }

        if (!aliasInfo?.shared.typeParams || (aliasInfo.shared.typeParams.length === 0 && aliasInfo.typeArgs)) {
            return undefined;
        }

        // If this is not instantiable, then the index expression isn't a specialization.
        if (!TypeBase.isInstantiable(aliasBaseType)) {
            return undefined;
        }

        // If this is already specialized, the index expression isn't a specialization.
        if (aliasInfo.typeArgs) {
            return undefined;
        }

        inferVarianceForTypeAlias(baseType);

        const typeParams = aliasInfo.shared.typeParams;
        let typeArgs: TypeResultWithNode[] | undefined;
        typeArgs = specialFormCreation.adjustTypeArgsForTypeVarTuple(getTypeArgs(node, flags), typeParams, node);
        let reportedError = false;

        typeArgs = transformTypeArgsForParamSpec(typeParams, typeArgs, node);
        if (!typeArgs) {
            typeArgs = [];
            reportedError = true;
        }

        let minTypeArgCount = typeParams.length;
        const firstDefaultParamIndex = typeParams.findIndex((param) => !!param.shared.isDefaultExplicit);
        if (firstDefaultParamIndex >= 0) {
            minTypeArgCount = firstDefaultParamIndex;
        }

        if (typeArgs.length > typeParams.length) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeArgsTooMany().format({
                    name: printType(aliasBaseType),
                    expected: typeParams.length,
                    received: typeArgs.length,
                }),
                typeArgs[typeParams.length].node
            );
            reportedError = true;
        } else if (typeArgs.length < minTypeArgCount) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeArgsTooFew().format({
                    name: printType(aliasBaseType),
                    expected: typeParams.length,
                    received: typeArgs.length,
                }),
                node.d.items[node.d.items.length - 1]
            );
            reportedError = true;
        }

        // Handle the mypy_extensions.FlexibleAlias type specially.
        if (
            isInstantiableClass(aliasBaseType) &&
            aliasBaseType.shared.fullName === 'mypy_extensions.FlexibleAlias' &&
            typeArgs.length >= 1
        ) {
            return { node, type: typeArgs[0].type };
        }

        const constraints = new ConstraintTracker();
        const diag = new DiagnosticAddendum();

        typeParams.forEach((param, index) => {
            if (isParamSpec(param) && index < typeArgs.length) {
                const typeArgType = typeArgs[index].type;
                const typeList = typeArgs[index].typeList;

                if (typeList) {
                    const functionType = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.ParamSpecValue);
                    typeList.forEach((paramTypeResult, paramIndex) => {
                        let paramType = paramTypeResult.type;

                        if (!validateTypeArg(paramTypeResult)) {
                            paramType = UnknownType.create();
                        }

                        FunctionType.addParam(
                            functionType,
                            FunctionParam.create(
                                ParamCategory.Simple,
                                convertToInstance(paramType),
                                FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                `__p${paramIndex}`
                            )
                        );
                    });

                    if (typeList.length > 0) {
                        FunctionType.addPositionOnlyParamSeparator(functionType);
                    }

                    assignTypeVar(
                        evaluatorInterface,
                        param,
                        functionType,
                        diag,
                        constraints,
                        AssignTypeFlags.RetainLiteralsForTypeVar
                    );
                } else if (isParamSpec(typeArgType)) {
                    assignTypeVar(
                        evaluatorInterface,
                        param,
                        convertToInstance(typeArgType),
                        diag,
                        constraints,
                        AssignTypeFlags.RetainLiteralsForTypeVar
                    );
                } else if (isInstantiableClass(typeArgType) && ClassType.isBuiltIn(typeArgType, 'Concatenate')) {
                    const concatTypeArgs = typeArgType.priv.typeArgs;
                    const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);

                    if (concatTypeArgs && concatTypeArgs.length > 0) {
                        concatTypeArgs.forEach((typeArg, index) => {
                            if (index === concatTypeArgs.length - 1) {
                                FunctionType.addPositionOnlyParamSeparator(functionType);

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

                    assignTypeVar(
                        evaluatorInterface,
                        param,
                        functionType,
                        diag,
                        constraints,
                        AssignTypeFlags.RetainLiteralsForTypeVar
                    );
                } else if (isEllipsisType(typeArgType)) {
                    const functionType = FunctionType.createSynthesizedInstance(
                        '',
                        FunctionTypeFlags.ParamSpecValue | FunctionTypeFlags.GradualCallableForm
                    );
                    FunctionType.addDefaultParams(functionType);
                    assignTypeVar(evaluatorInterface, param, functionType, diag, constraints);
                } else {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.typeArgListExpected(),
                        typeArgs[index].node
                    );
                    reportedError = true;
                }
            } else {
                if (index < typeArgs.length && typeArgs[index].typeList) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.typeArgListNotAllowed(),
                        typeArgs[index].node
                    );
                    reportedError = true;
                }

                let typeArgType: Type;
                if (index < typeArgs.length) {
                    typeArgType = convertTypeArgToInstance(typeArgs[index].type, flags);
                } else if (param.shared.isDefaultExplicit) {
                    typeArgType = solveAndApplyConstraints(param, constraints, {
                        replaceUnsolved: {
                            scopeIds: [aliasInfo.shared.typeVarScopeId],
                            tupleClassType: getTupleClassType(),
                        },
                    });
                } else {
                    typeArgType = UnknownType.create();
                }

                if ((flags & EvalFlags.EnforceVarianceConsistency) !== 0) {
                    const usageVariances = inferVarianceForTypeAlias(aliasBaseType);
                    if (usageVariances && index < usageVariances.length) {
                        const usageVariance = usageVariances[index];

                        if (!isVarianceOfTypeArgCompatible(typeArgType, usageVariance)) {
                            const messageDiag = diag.createAddendum();
                            messageDiag.addMessage(
                                LocAddendum.varianceMismatchForTypeAlias().format({
                                    typeVarName: printType(typeArgType),
                                    typeAliasParam: printType(typeParams[index]),
                                })
                            );
                            messageDiag.addTextRange(typeArgs[index].node);
                        }
                    }
                }

                if (isUnpacked(typeArgType) && !isTypeVarTuple(param)) {
                    const messageDiag = diag.createAddendum();
                    messageDiag.addMessage(LocMessage.unpackedArgInTypeArgument());
                    messageDiag.addTextRange(typeArgs[index].node);
                    typeArgType = UnknownType.create();
                }

                assignTypeVar(
                    evaluatorInterface,
                    param,
                    typeArgType,
                    diag,
                    constraints,
                    AssignTypeFlags.RetainLiteralsForTypeVar
                );
            }
        });

        if (!diag.isEmpty()) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeNotSpecializable().format({ type: printType(aliasBaseType) }) + diag.getString(),
                node,
                diag.getEffectiveTextRange() ?? node
            );
            reportedError = true;
        }

        const solutionSet = solveConstraints(evaluatorInterface, constraints).getMainSolutionSet();
        const aliasTypeArgs: Type[] = [];

        aliasInfo.shared.typeParams?.forEach((typeParam) => {
            let typeVarType = solutionSet.getType(typeParam);

            // Fill in any unsolved type arguments with unknown.
            if (!typeVarType) {
                typeVarType = getUnknownForTypeVar(typeParam, getTupleClassType());
                constraints.setBounds(typeParam, typeVarType);
            }

            aliasTypeArgs.push(typeVarType);
        });

        let type = TypeBase.cloneForTypeAlias(solveAndApplyConstraints(aliasBaseType, constraints), {
            ...aliasInfo,
            typeArgs: aliasTypeArgs,
        });

        type = TypeBase.cloneWithTypeForm(type, reportedError ? undefined : convertToInstance(type));

        if (baseType.props?.typeAliasInfo) {
            return { type, node };
        }

        return { type: TypeBase.cloneWithTypeForm(baseType, convertToInstance(type)), node };
    }

    function getTypeOfIndexWithBaseType(
        node: IndexNode,
        baseTypeResult: TypeResult,
        usage: EvaluatorUsage,
        flags: EvalFlags
    ): TypeResult {
        // Handle the case where we're specializing a generic type alias.
        const typeAliasResult = createSpecializedTypeAlias(node, baseTypeResult.type, flags);
        if (typeAliasResult) {
            return typeAliasResult;
        }

        // Handle the case where Never or NoReturn are being specialized.
        if (isNever(baseTypeResult.type) && baseTypeResult.type.props?.specialForm) {
            // Swap in the special form type, which is the Never or NoReturn class.
            baseTypeResult = { ...baseTypeResult, type: baseTypeResult.type.props.specialForm };
        }

        // Handle the case where a TypeAliasType symbol is being specialized
        // in a value expression.
        if (
            isClassInstance(baseTypeResult.type) &&
            ClassType.isBuiltIn(baseTypeResult.type, 'TypeAliasType') &&
            baseTypeResult.type.props?.typeForm
        ) {
            const typeAliasInfo = baseTypeResult.type.props.typeForm.props?.typeAliasInfo;
            if (typeAliasInfo && typeAliasInfo.shared.typeParams) {
                const origTypeAlias = TypeBase.cloneForTypeAlias(
                    convertToInstantiable(baseTypeResult.type.props.typeForm),
                    { ...typeAliasInfo, typeArgs: undefined }
                );
                const typeFormType = createSpecializedTypeAlias(node, origTypeAlias, flags);
                if (typeFormType) {
                    return {
                        type: TypeBase.cloneWithTypeForm(baseTypeResult.type, convertToInstance(typeFormType.type)),
                    };
                }
            }
        }

        if (isTypeVar(baseTypeResult.type) && isTypeAliasPlaceholder(baseTypeResult.type)) {
            const typeArgTypes = getTypeArgs(node, flags).map((t) => convertToInstance(t.type));
            const type = TypeBase.cloneForTypeAlias(baseTypeResult.type, {
                shared: baseTypeResult.type.shared.recursiveAlias!,
                typeArgs: typeArgTypes,
            });
            return { type };
        }

        let isIncomplete = baseTypeResult.isIncomplete;
        let isRequired = false;
        let isNotRequired = false;
        let isReadOnly = false;

        const type = mapSubtypesExpandTypeVars(
            baseTypeResult.type,
            /* options */ undefined,
            (concreteSubtype, unexpandedSubtype) => {
                const selfType = isTypeVar(unexpandedSubtype) ? unexpandedSubtype : undefined;

                if (isAnyOrUnknown(concreteSubtype)) {
                    if ((flags & EvalFlags.TypeExpression) !== 0) {
                        // If we are expecting a type annotation here, assume that
                        // the subscripts are type arguments and evaluate them
                        // accordingly.
                        getTypeArgs(node, flags);
                    }

                    return concreteSubtype;
                }

                if (flags & EvalFlags.InstantiableType) {
                    if (isTypeVar(unexpandedSubtype)) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarNotSubscriptable().format({
                                type: printType(unexpandedSubtype),
                            }),
                            node.d.leftExpr
                        );

                        // Evaluate the index expressions as though they are type arguments for error-reporting.
                        getTypeArgs(node, flags);

                        return UnknownType.create();
                    }
                }

                if (isInstantiableClass(concreteSubtype)) {
                    // See if the class has a custom metaclass that supports __getitem__, etc.
                    if (
                        concreteSubtype.shared.effectiveMetaclass &&
                        isInstantiableClass(concreteSubtype.shared.effectiveMetaclass) &&
                        !ClassType.isBuiltIn(concreteSubtype.shared.effectiveMetaclass, ['type', '_InitVarMeta']) &&
                        (flags & EvalFlags.InstantiableType) === 0
                    ) {
                        const itemMethodType = getBoundMagicMethod(
                            concreteSubtype,
                            getIndexAccessMagicMethodName(usage),
                            /* selfType */ undefined,
                            node.d.leftExpr
                        );

                        if ((flags & EvalFlags.TypeExpression) !== 0) {
                            // If the class doesn't derive from Generic, a type argument should not be allowed.
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeArguments,
                                LocMessage.typeArgsExpectingNone().format({
                                    name: printType(ClassType.cloneAsInstance(concreteSubtype)),
                                }),
                                node
                            );
                        }

                        if (itemMethodType) {
                            return getTypeOfIndexedObjectOrClass(node, concreteSubtype, selfType, usage).type;
                        }
                    }

                    // Setting the value of an indexed class will always result
                    // in an exception.
                    if (usage.method === 'set') {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.genericClassAssigned(),
                            node.d.leftExpr
                        );
                    } else if (usage.method === 'del') {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.genericClassDeleted(),
                            node.d.leftExpr
                        );
                    }

                    if (ClassType.isSpecialBuiltIn(concreteSubtype, 'Literal')) {
                        // Special-case Literal types.
                        return specialFormCreation.createLiteralType(concreteSubtype, node, flags);
                    }

                    if (ClassType.isBuiltIn(concreteSubtype, 'InitVar')) {
                        // Special-case InitVar, used in dataclasses.
                        const typeArgs = getTypeArgs(node, flags);
                        const isTypeFormArg = (flags & EvalFlags.TypeFormArg) !== 0;

                        if ((flags & EvalFlags.TypeExpression) !== 0 || isTypeFormArg) {
                            if (isTypeFormArg || (flags & EvalFlags.VarTypeAnnotation) === 0) {
                                addDiagnostic(
                                    DiagnosticRule.reportInvalidTypeForm,
                                    LocMessage.initVarNotAllowed(),
                                    node.d.leftExpr
                                );
                            }
                        }

                        if (isTypeFormArg) {
                            return UnknownType.create();
                        }

                        if (typeArgs.length === 1) {
                            return typeArgs[0].type;
                        } else {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.typeArgsMismatchOne().format({ received: typeArgs.length }),
                                node.d.leftExpr
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
                        return ClassType.cloneAsInstance(concreteSubtype);
                    }

                    const isAnnotatedClass =
                        isInstantiableClass(concreteSubtype) && ClassType.isBuiltIn(concreteSubtype, 'Annotated');
                    const hasCustomClassGetItem =
                        isInstantiableClass(concreteSubtype) && ClassType.hasCustomClassGetItem(concreteSubtype);
                    const isGenericClass =
                        concreteSubtype.shared.typeParams?.length > 0 ||
                        ClassType.isSpecialBuiltIn(concreteSubtype) ||
                        ClassType.isBuiltIn(concreteSubtype, 'type') ||
                        ClassType.isPartiallyEvaluated(concreteSubtype);
                    const isFinalAnnotation =
                        isInstantiableClass(concreteSubtype) && ClassType.isBuiltIn(concreteSubtype, 'Final');
                    const isClassVarAnnotation =
                        isInstantiableClass(concreteSubtype) && ClassType.isBuiltIn(concreteSubtype, 'ClassVar');

                    // This feature is currently experimental.
                    const supportsTypedDictTypeArg =
                        nodeInfo.getFileInfo(node).diagnosticRuleSet.enableExperimentalFeatures &&
                        ClassType.isBuiltIn(concreteSubtype, 'TypedDict');

                    let typeArgs = getTypeArgs(node, flags, {
                        isAnnotatedClass,
                        hasCustomClassGetItem: hasCustomClassGetItem || !isGenericClass,
                        isFinalAnnotation,
                        isClassVarAnnotation,
                        supportsTypedDictTypeArg,
                    });

                    if (!isAnnotatedClass) {
                        typeArgs = specialFormCreation.adjustTypeArgsForTypeVarTuple(
                            typeArgs,
                            concreteSubtype.shared.typeParams,
                            node
                        );
                    }

                    // If this is a custom __class_getitem__, there's no need to specialize the class.
                    // Just return it as is.
                    if (hasCustomClassGetItem) {
                        return concreteSubtype;
                    }

                    if (concreteSubtype.priv.typeArgs) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.classAlreadySpecialized().format({
                                type: printType(convertToInstance(concreteSubtype), { expandTypeAlias: true }),
                            }),
                            node.d.leftExpr
                        );
                        return concreteSubtype;
                    }

                    const result = specialFormCreation.createSpecializedClassType(
                        concreteSubtype,
                        typeArgs,
                        flags,
                        node
                    );
                    if (result.isRequired) {
                        isRequired = true;
                    } else if (result.isNotRequired) {
                        isNotRequired = true;
                    }

                    if (result.isReadOnly) {
                        isReadOnly = true;
                    }

                    return result.type;
                }

                if (isNoneInstance(concreteSubtype)) {
                    if (!isIncomplete) {
                        addDiagnostic(
                            DiagnosticRule.reportOptionalSubscript,
                            LocMessage.noneNotSubscriptable(),
                            node.d.leftExpr
                        );
                    }

                    return UnknownType.create();
                }

                if (isClassInstance(concreteSubtype)) {
                    const typeResult = getTypeOfIndexedObjectOrClass(node, concreteSubtype, selfType, usage);
                    if (typeResult.isIncomplete) {
                        isIncomplete = true;
                    }
                    return typeResult.type;
                }

                if (isNever(concreteSubtype)) {
                    return NeverType.createNever();
                }

                if (isUnbound(concreteSubtype)) {
                    return UnknownType.create();
                }

                if (!isIncomplete) {
                    addDiagnostic(
                        DiagnosticRule.reportIndexIssue,
                        LocMessage.typeNotSubscriptable().format({ type: printType(concreteSubtype) }),
                        node.d.leftExpr
                    );
                }

                return UnknownType.create();
            }
        );

        // In case we didn't walk the list items above, do so now. TypeForm arguments
        // use a separate cache, so check it when the enclosing expression is a TypeForm.
        if (!baseTypeResult.isIncomplete) {
            const isTypeFormArg = (flags & EvalFlags.TypeFormArg) !== 0;

            node.d.items.forEach((item) => {
                const isItemCached = isTypeFormArg
                    ? isTypeFormTypeCached(item.d.valueExpr, /* expectedType */ undefined)
                    : isTypeCached(item.d.valueExpr);

                if (!isItemCached) {
                    getTypeOfExpression(item.d.valueExpr, flags & (EvalFlags.ForwardRefs | EvalFlags.TypeFormArg));
                }
            });
        }

        return { type, isIncomplete, isReadOnly, isRequired, isNotRequired };
    }

    // Determines the effective variance of the type parameters for a generic
    // type alias. Normally, variance is not important for type aliases, but
    // it can be important in cases where the type alias is used to specify
    // a base class in a class definition.
    function inferVarianceForTypeAlias(type: Type): Variance[] | undefined {
        return typeVarHandling.inferVarianceForTypeAlias(type);
    }

    // Looks at uses of the type parameters within the type and adjusts the
    // variances accordingly. For example, if the type is `Mapping[T1, T2]`,
    // then T1 will be set to invariant and T2 will be set to covariant.
    function updateUsageVariancesRecursive(
        type: Type,
        typeAliasTypeParams: TypeVarType[],
        usageVariances: Variance[],
        varianceContext: Variance,
        pendingTypes: { type: Type; key: string | undefined }[] = [],
        recursionCount = 0
    ) {
        if (recursionCount > maxTypeRecursionCount) {
            return;
        }

        const transformedType = transformPossibleRecursiveTypeAlias(type);
        const isRecursiveTypeAlias = transformedType !== type;

        // Define a helper function that performs the actual usage variant update.
        function updateUsageVarianceForType(type: Type, variance: Variance, variances = usageVariances) {
            doForEachSubtype(type, (subtype) => {
                const typeParamIndex = typeAliasTypeParams.findIndex((param) => isTypeSame(param, subtype));
                if (typeParamIndex >= 0) {
                    variances[typeParamIndex] = combineVariances(variances[typeParamIndex], variance);
                } else {
                    updateUsageVariancesRecursive(
                        subtype,
                        typeAliasTypeParams,
                        variances,
                        variance,
                        pendingTypes,
                        recursionCount
                    );
                }
            });
        }

        // If this is a recursive type alias, see if we've already seen it in
        // the recursion stack. A reference to the alias is keyed by the variance
        // of the type parameters in each of its type arguments, which stays
        // finite when the type arguments grow with each expansion.
        if (isRecursiveTypeAlias) {
            let key: string | undefined;
            const typeArgs = type.props?.typeAliasInfo?.typeArgs;
            if (isTypeVar(type) && type.shared.recursiveAlias && typeArgs) {
                const argVariances = typeArgs.map((typeArg) => {
                    const variances = typeAliasTypeParams.map(() => Variance.Unknown);
                    updateUsageVarianceForType(typeArg, Variance.Covariant, variances);
                    return variances.join(',');
                });
                key = `${type.shared.recursiveAlias.typeVarScopeId}/${varianceContext}/${argVariances.join(';')}`;
            }

            const pendingOverlaps = pendingTypes.filter((pending) =>
                key !== undefined ? pending.key === key : isTypeSame(pending.type, type)
            );
            if (pendingOverlaps.length > (key !== undefined ? 0 : 1)) {
                return;
            }

            pendingTypes.push({ type, key });
        }

        recursionCount++;

        doForEachSubtype(transformedType, (subtype) => {
            if (subtype.category === TypeCategory.Function) {
                subtype.shared.parameters.forEach((param, index) => {
                    const paramType = FunctionType.getParamType(subtype, index);
                    updateUsageVarianceForType(paramType, invertVariance(varianceContext));
                });

                const returnType = FunctionType.getEffectiveReturnType(subtype);
                if (returnType) {
                    updateUsageVarianceForType(returnType, varianceContext);
                }
            } else if (subtype.category === TypeCategory.Class) {
                if (subtype.priv.typeArgs) {
                    // If the class includes type parameters that uses auto variance,
                    // compute the calculated variance.
                    inferVarianceForClass(subtype);

                    // Is the class specialized using any type arguments that correspond to
                    // the type alias' type parameters?
                    subtype.priv.typeArgs.forEach((typeArg, classParamIndex) => {
                        if (isTupleClass(subtype)) {
                            updateUsageVarianceForType(typeArg, varianceContext);
                        } else if (classParamIndex < subtype.shared.typeParams.length) {
                            const classTypeParam = subtype.shared.typeParams[classParamIndex];
                            if (isUnpackedClass(typeArg) && typeArg.priv.tupleTypeArgs) {
                                typeArg.priv.tupleTypeArgs.forEach((tupleTypeArg) => {
                                    updateUsageVarianceForType(tupleTypeArg.type, Variance.Invariant);
                                });
                            } else {
                                const effectiveVariance =
                                    classTypeParam.priv.computedVariance ?? classTypeParam.shared.declaredVariance;
                                updateUsageVarianceForType(
                                    typeArg,
                                    varianceContext === Variance.Contravariant
                                        ? invertVariance(effectiveVariance)
                                        : effectiveVariance
                                );
                            }
                        }
                    });
                }
            }
        });

        if (isRecursiveTypeAlias) {
            pendingTypes.pop();
        }
    }

    function getTypeOfIndexedObjectOrClass(
        node: IndexNode,
        baseType: ClassType,
        selfType: ClassType | TypeVarType | undefined,
        usage: EvaluatorUsage
    ): TypeResult {
        return expressionEvaluation.getTypeOfIndexedObjectOrClass(node, baseType, selfType, usage);
    }

    function getTypeArgs(node: IndexNode, flags: EvalFlags, options?: GetTypeArgsOptions): TypeResultWithNode[] {
        const typeArgs: TypeResultWithNode[] = [];
        let adjFlags = flags | EvalFlags.NoConvertSpecialForm;
        if ((adjFlags & EvalFlags.TypeFormArg) !== 0) {
            adjFlags |= EvalFlags.TypeExpression;
        }

        const allowFinalClassVar = () => {
            // If the annotation is a variable within the body of a dataclass, a
            // Final is allowed with a ClassVar annotation. In all other cases,
            // it's disallowed.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopeAtFunction */ true);
            if (enclosingClassNode) {
                const classTypeInfo = getTypeOfClass(enclosingClassNode);
                if (classTypeInfo && ClassType.isDataClass(classTypeInfo.classType)) {
                    return true;
                }
            }
            return false;
        };

        if (options?.isFinalAnnotation) {
            adjFlags |= EvalFlags.NoFinal;

            if (!allowFinalClassVar()) {
                adjFlags |= EvalFlags.NoClassVar;
            }
        } else if (options?.isClassVarAnnotation) {
            adjFlags |= EvalFlags.NoClassVar;

            if (!allowFinalClassVar()) {
                adjFlags |= EvalFlags.NoFinal;
            }
        } else {
            adjFlags &= ~(
                EvalFlags.NoSpecialize |
                EvalFlags.NoParamSpec |
                EvalFlags.NoTypeVarTuple |
                EvalFlags.AllowRequired |
                EvalFlags.EnforceVarianceConsistency
            );

            if (!options?.isAnnotatedClass) {
                adjFlags |= EvalFlags.NoClassVar | EvalFlags.NoFinal;
            }

            adjFlags |= EvalFlags.AllowUnpackedTuple | EvalFlags.AllowConcatenate;
        }

        // Create a local function that validates a single type argument.
        const getTypeArgTypeResult = (expr: ExpressionNode, argIndex: number) => {
            let typeResult: TypeResultWithNode;

            // If it's a custom __class_getitem__, none of the arguments should be
            // treated as types.
            if (options?.hasCustomClassGetItem) {
                adjFlags =
                    EvalFlags.NoParamSpec | EvalFlags.NoTypeVarTuple | EvalFlags.NoSpecialize | EvalFlags.NoClassVar;
                typeResult = {
                    ...getTypeOfExpression(expr, adjFlags),
                    node: expr,
                };
            } else if (options?.isAnnotatedClass && argIndex > 0) {
                // If it's an Annotated[a, b, c], only the first index should be
                // treated as a type. The others can be regular (non-type) objects.
                adjFlags =
                    EvalFlags.NoParamSpec | EvalFlags.NoTypeVarTuple | EvalFlags.NoSpecialize | EvalFlags.NoClassVar;
                if (isAnnotationEvaluationPostponed(nodeInfo.getFileInfo(node))) {
                    adjFlags |= EvalFlags.ForwardRefs;
                }

                typeResult = {
                    ...getTypeOfExpression(expr, adjFlags),
                    node: expr,
                };
            } else {
                typeResult = getTypeArg(expr, adjFlags, !!options?.supportsTypedDictTypeArg && argIndex === 0);
            }

            return typeResult;
        };

        // A tuple is treated the same as a list of items in the index.
        if (
            node.d.items.length === 1 &&
            !node.d.trailingComma &&
            !node.d.items[0].d.name &&
            node.d.items[0].d.valueExpr.nodeType === ParseNodeType.Tuple
        ) {
            node.d.items[0].d.valueExpr.d.items.forEach((item, index) => {
                typeArgs.push(getTypeArgTypeResult(item, index));
            });

            // Set the node's type so it isn't reevaluated later.
            setTypeResultForNode(node.d.items[0].d.valueExpr, { type: UnknownType.create() });

            return typeArgs;
        }

        node.d.items.forEach((arg, index) => {
            const typeResult = getTypeArgTypeResult(arg.d.valueExpr, index);

            if (arg.d.argCategory !== ArgCategory.Simple) {
                if (arg.d.argCategory === ArgCategory.UnpackedList) {
                    if (!options?.isAnnotatedClass || index === 0) {
                        const unpackedType = applyUnpackToTupleLike(typeResult.type);

                        if (unpackedType) {
                            typeResult.type = unpackedType;
                        } else {
                            if ((flags & EvalFlags.TypeExpression) !== 0) {
                                addDiagnostic(
                                    DiagnosticRule.reportInvalidTypeForm,
                                    LocMessage.unpackNotAllowed(),
                                    arg.d.valueExpr
                                );
                                typeResult.typeErrors = true;
                            } else {
                                typeResult.type = UnknownType.create();
                            }
                        }
                    }
                }
            }

            if (arg.d.name) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.keywordArgInTypeArgument(),
                        arg.d.valueExpr
                    );
                    typeResult.typeErrors = true;
                } else {
                    typeResult.type = UnknownType.create();
                }
            }

            if (
                arg.d.valueExpr.nodeType !== ParseNodeType.Error ||
                arg.d.valueExpr.d.category !== ErrorExpressionCategory.MissingIndexOrSlice
            ) {
                typeArgs.push(typeResult);
            }
        });

        return typeArgs;
    }

    function getTypeArg(node: ExpressionNode, flags: EvalFlags, supportsDictExpression: boolean): TypeResultWithNode {
        return expressionEvaluation.getTypeArg(node, flags, supportsDictExpression);
    }

    function buildTupleTypesList(
        entryTypeResults: TypeResult[],
        stripLiterals: boolean,
        convertModule: boolean
    ): TupleTypeArg[] {
        return evaluatorCore.buildTupleTypesList(entryTypeResults, stripLiterals, convertModule);
    }

    function getTypeOfCall(
        node: CallNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext | undefined
    ): TypeResult {
        let baseTypeResult: TypeResult | undefined;

        // Check for the use of `type(x)` within a type annotation. This isn't
        // allowed, and it's a common mistake, so we want to emit a diagnostic
        // that guides the user to the right solution.
        if (
            (flags & EvalFlags.TypeExpression) !== 0 &&
            node.d.leftExpr.nodeType === ParseNodeType.Name &&
            node.d.leftExpr.d.value === 'type'
        ) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(LocAddendum.useTypeInstead());
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeCallNotAllowed() + diag.getString(),
                node
            );
        }

        // Handle immediate calls of lambdas specially.
        if (node.d.leftExpr.nodeType === ParseNodeType.Lambda) {
            baseTypeResult = getTypeOfLambdaForCall(node, inferenceContext);
        } else {
            baseTypeResult = getTypeOfExpression(
                node.d.leftExpr,
                EvalFlags.CallBaseDefaults | (flags & EvalFlags.ForwardRefs)
            );
        }

        operationRouter?.beforeCall(node);

        const argList = ParseTreeUtils.getArgsByRuntimeOrder(node).map((arg) => {
            const functionArg: Arg = {
                valueExpression: arg.d.valueExpr,
                argCategory: arg.d.argCategory,
                node: arg,
                name: arg.d.name,
            };
            return functionArg;
        });

        let typeResult: TypeResult = { type: UnknownType.create() };

        baseTypeResult.type = ensureSignatureIsUnique(baseTypeResult.type, node);

        if (!isTypeAliasPlaceholder(baseTypeResult.type)) {
            if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.leftExpr.d.value === 'super') {
                // Handle the built-in "super" call specially.
                typeResult = getTypeOfSuperCall(node);
            } else if (
                isAnyOrUnknown(baseTypeResult.type) &&
                ParseTreeUtils.isImplicitRevealTypeName(node.d.leftExpr)
            ) {
                // Handle the implicit "reveal_type" call.
                typeResult = getTypeOfRevealType(node, inferenceContext);
            } else if (isFunction(baseTypeResult.type) && FunctionType.isBuiltIn(baseTypeResult.type, 'reveal_type')) {
                // Handle the "typing.reveal_type" call.
                typeResult = getTypeOfRevealType(node, inferenceContext);
            } else if (isFunction(baseTypeResult.type) && FunctionType.isBuiltIn(baseTypeResult.type, 'assert_type')) {
                // Handle the "typing.assert_type" call.
                typeResult = getTypeOfAssertType(node, inferenceContext);
            } else if (isClass(baseTypeResult.type) && ClassType.isBuiltIn(baseTypeResult.type, 'TypeForm')) {
                // Handle the "typing.TypeForm" call.
                typeResult = getTypeOfTypeForm(node, baseTypeResult.type);
            } else if (
                isAnyOrUnknown(baseTypeResult.type) &&
                node.d.leftExpr.nodeType === ParseNodeType.Name &&
                node.d.leftExpr.d.value === 'reveal_locals'
            ) {
                if (node.d.args.length === 0) {
                    // Handle the special-case "reveal_locals" call.
                    typeResult.type = getTypeOfRevealLocals(node);
                } else {
                    addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.revealLocalsArgs(), node);
                }
            } else {
                const callResult = validateCallArgs(
                    node,
                    argList,
                    baseTypeResult,
                    /* constraints */ undefined,
                    /* skipUnknownArgCheck */ false,
                    inferenceContext
                );

                typeResult.type = callResult.returnType ?? UnknownType.create();

                if (callResult.argumentErrors) {
                    typeResult.typeErrors = true;
                } else {
                    typeResult.overloadsUsedForCall = callResult.overloadsUsedForCall;
                }

                if (callResult.isTypeIncomplete) {
                    typeResult.isIncomplete = true;
                }
            }

            if (baseTypeResult.isIncomplete) {
                typeResult.isIncomplete = true;
            }
        } else {
            typeResult.isIncomplete = true;
        }

        // Don't bother evaluating the arguments if we're speculatively evaluating the call
        // or the base type is incomplete.
        if (!isSpeculativeModeInUse(node) && !baseTypeResult.isIncomplete) {
            // Touch all of the args so they're marked accessed even if there were errors.
            // We skip this if it's a TypeVar() call in the typing.pyi module because
            // this results in a cyclical type resolution problem whereby we try to
            // retrieve the str class, which inherits from Sequence, which inherits from
            // Iterable, which uses a TypeVar. Without this, Iterable and Sequence classes
            // have invalid type parameters.
            const isCyclicalTypeVarCall =
                isInstantiableClass(baseTypeResult.type) &&
                ClassType.isBuiltIn(baseTypeResult.type, 'TypeVar') &&
                nodeInfo.getFileInfo(node).isTypingStubFile;
            const isTypeFormCall = isInstantiableClass(baseTypeResult.type) && isTypeFormClass(baseTypeResult.type);

            if (!isCyclicalTypeVarCall && !isTypeFormCall) {
                argList.forEach((arg) => {
                    const valueExpression = arg.valueExpression;
                    if (
                        valueExpression &&
                        valueExpression.nodeType !== ParseNodeType.StringList &&
                        !isTypeCached(valueExpression)
                    ) {
                        const expectedType = expectedTypeCache.get(valueExpression.id)?.type;
                        if (isTypeFormTypeCached(valueExpression, expectedType)) {
                            suppressDiagnostics(valueExpression, () => getTypeOfExpression(valueExpression));
                        } else {
                            getTypeOfExpression(valueExpression);
                        }
                    }
                });
            }
        }

        if ((flags & EvalFlags.TypeExpression) !== 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeAnnotationCall(), node);

            typeResult = { type: UnknownType.create() };
        }

        return typeResult;
    }

    // This function is used in cases where a lambda is defined and immediately
    // called. In this case, we can't use normal bidirectional type inference
    // to determine the lambda's type. It needs to be inferred from the argument
    // types instead.
    function getTypeOfLambdaForCall(node: CallNode, inferenceContext: InferenceContext | undefined): TypeResult {
        return expressionEvaluation.getTypeOfLambdaForCall(node, inferenceContext);
    }

    function getTypeOfTypeForm(node: CallNode, typeFormClass: ClassType): TypeResult {
        return expressionEvaluation.getTypeOfTypeForm(node, typeFormClass);
    }

    function expandEnumTypeForLiteralComparison(
        typeToExpand: Type,
        comparisonType: Type,
        concretizeTypeVars: boolean
    ): Type {
        // Assignment checks apply this at each recursive assignType call so existing
        // variance and constraint handling remains intact. Keep this equivalence
        // relation aligned with the recursive normalization used by assert_type below.
        if (!containsTopLevelLiteralEnum(comparisonType)) {
            return typeToExpand;
        }

        const literalEnumClasses = collectLiteralEnumClasses(comparisonType);
        if (literalEnumClasses.length === 0) {
            return typeToExpand;
        }

        // Concretize top-level TypeVars only to probe for a matching enum subtype.
        // If no enum expansion actually occurs (for example, an unrelated source
        // TypeVar whose bound is not one of the comparison's enum classes), preserve
        // the original type rather than replacing the TypeVar with its bound. Doing so
        // keeps unrelated invariant comparisons like `list[T]` vs `list[ColorLiterals]`
        // unaffected.
        const concreteType = concretizeTypeVars ? makeTopLevelTypeVarsConcrete(typeToExpand) : typeToExpand;
        const expandedType = expandEnumTypeForLiteralClasses(concreteType, literalEnumClasses);
        return expandedType === concreteType ? typeToExpand : expandedType;
    }

    function containsTopLevelLiteralEnum(type: Type): boolean {
        if (isClassInstance(type) && ClassType.isEnumClass(type) && type.priv.literalValue instanceof EnumLiteral) {
            return true;
        }

        if (!isUnion(type)) {
            return false;
        }

        return type.priv.includesEnumLiteral;
    }

    function expandEnumTypeForLiteralClasses(typeToExpand: Type, literalEnumClasses: ClassType[]): Type {
        if (literalEnumClasses.length === 0) {
            return typeToExpand;
        }

        return mapSubtypes(typeToExpand, (subtype) => {
            if (
                isClassInstance(subtype) &&
                ClassType.isEnumClass(subtype) &&
                !ClassType.isEnumMemberSetMayBeIncomplete(subtype) &&
                subtype.priv.literalValue === undefined &&
                literalEnumClasses.some((enumClass) => ClassType.isSameGenericClass(enumClass, subtype))
            ) {
                const literalTypes = enumerateLiteralsForType(evaluatorInterface, subtype);
                if (literalTypes && literalTypes.length > 0) {
                    return combineTypes(literalTypes);
                }
            }

            return subtype;
        });
    }

    function collectLiteralEnumClasses(
        type: Type,
        literalEnumClasses: ClassType[] = [],
        recursively = false,
        recursionCount = 0
    ): ClassType[] {
        if (recursionCount > maxTypeRecursionCount) {
            return literalEnumClasses;
        }
        recursionCount++;

        if (recursively && isFunction(type)) {
            type.shared.parameters.forEach((_, index) =>
                collectLiteralEnumClasses(
                    FunctionType.getParamType(type, index),
                    literalEnumClasses,
                    recursively,
                    recursionCount
                )
            );

            const returnType = FunctionType.getEffectiveReturnType(type);
            if (returnType) {
                collectLiteralEnumClasses(returnType, literalEnumClasses, recursively, recursionCount);
            }
        } else if (recursively && isOverloaded(type)) {
            OverloadedType.getOverloads(type).forEach((overload) =>
                collectLiteralEnumClasses(overload, literalEnumClasses, recursively, recursionCount)
            );

            const implementation = OverloadedType.getImplementation(type);
            if (implementation) {
                collectLiteralEnumClasses(implementation, literalEnumClasses, recursively, recursionCount);
            }
        }

        doForEachSubtype(type, (subtype) => {
            if (!isClass(subtype)) {
                return;
            }

            if (
                isClassInstance(subtype) &&
                ClassType.isEnumClass(subtype) &&
                subtype.priv.literalValue instanceof EnumLiteral &&
                !literalEnumClasses.some((enumClass) => ClassType.isSameGenericClass(enumClass, subtype))
            ) {
                literalEnumClasses.push(subtype);
            }

            if (recursively && subtype.priv.typeArgs) {
                if (subtype.priv.tupleTypeArgs) {
                    subtype.priv.tupleTypeArgs.forEach((typeArg) =>
                        collectLiteralEnumClasses(typeArg.type, literalEnumClasses, recursively, recursionCount)
                    );
                } else {
                    subtype.priv.typeArgs.forEach((typeArg) =>
                        collectLiteralEnumClasses(typeArg, literalEnumClasses, recursively, recursionCount)
                    );
                }
            }
        });

        return literalEnumClasses;
    }

    function normalizeEnumTypes(typeToNormalize: Type, literalEnumClasses: ClassType[], recursionCount = 0): Type {
        if (recursionCount > maxTypeRecursionCount) {
            return typeToNormalize;
        }
        recursionCount++;

        typeToNormalize = expandEnumTypeForLiteralClasses(typeToNormalize, literalEnumClasses);

        if (isUnion(typeToNormalize)) {
            return mapSubtypes(typeToNormalize, (subtype) =>
                normalizeEnumTypes(subtype, literalEnumClasses, recursionCount)
            );
        }

        if (isFunction(typeToNormalize)) {
            let typeChanged = false;
            const parameterTypes = typeToNormalize.shared.parameters.map((_, index) => {
                const parameterType = FunctionType.getParamType(typeToNormalize, index);
                const normalizedType = normalizeEnumTypes(parameterType, literalEnumClasses, recursionCount);
                typeChanged ||= normalizedType !== parameterType;
                return normalizedType;
            });

            const returnType = FunctionType.getEffectiveReturnType(typeToNormalize);
            const normalizedReturnType = returnType
                ? normalizeEnumTypes(returnType, literalEnumClasses, recursionCount)
                : undefined;
            typeChanged ||= normalizedReturnType !== returnType;

            return typeChanged
                ? FunctionType.specialize(typeToNormalize, {
                      parameterTypes,
                      parameterDefaultTypes: typeToNormalize.priv.specializedTypes?.parameterDefaultTypes,
                      returnType: normalizedReturnType,
                  })
                : typeToNormalize;
        }

        if (isOverloaded(typeToNormalize)) {
            let typeChanged = false;
            const overloads = OverloadedType.getOverloads(typeToNormalize).map((overload) => {
                const normalizedType = normalizeEnumTypes(overload, literalEnumClasses, recursionCount);
                typeChanged ||= normalizedType !== overload;
                return isFunction(normalizedType) ? normalizedType : overload;
            });

            const implementation = OverloadedType.getImplementation(typeToNormalize);
            const normalizedImplementation = implementation
                ? normalizeEnumTypes(implementation, literalEnumClasses, recursionCount)
                : undefined;
            typeChanged ||= normalizedImplementation !== implementation;

            return typeChanged ? OverloadedType.create(overloads, normalizedImplementation) : typeToNormalize;
        }

        if (!isClass(typeToNormalize) || !typeToNormalize.priv.typeArgs) {
            return typeToNormalize;
        }

        if (typeToNormalize.priv.tupleTypeArgs) {
            let typeChanged = false;
            const tupleTypeArgs = typeToNormalize.priv.tupleTypeArgs.map((typeArg) => {
                const normalizedType = normalizeEnumTypes(typeArg.type, literalEnumClasses, recursionCount);
                if (normalizedType !== typeArg.type) {
                    typeChanged = true;
                }

                return { ...typeArg, type: normalizedType };
            });

            return typeChanged
                ? specializeTupleClass(
                      typeToNormalize,
                      tupleTypeArgs,
                      !!typeToNormalize.priv.isTypeArgExplicit,
                      !!typeToNormalize.priv.isUnpacked
                  )
                : typeToNormalize;
        }

        let typeChanged = false;
        const typeArgs = typeToNormalize.priv.typeArgs.map((typeArg) => {
            const normalizedType = normalizeEnumTypes(typeArg, literalEnumClasses, recursionCount);
            if (normalizedType !== typeArg) {
                typeChanged = true;
            }
            return normalizedType;
        });

        return typeChanged
            ? ClassType.specialize(typeToNormalize, typeArgs, typeToNormalize.priv.isTypeArgExplicit)
            : typeToNormalize;
    }

    function getTypeOfAssertType(node: CallNode, inferenceContext: InferenceContext | undefined): TypeResult {
        return expressionEvaluation.getTypeOfAssertType(node, inferenceContext);
    }

    function convertNodeToArg(node: ArgumentNode): ArgWithExpression {
        return evaluatorCore.convertNodeToArg(node);
    }

    function getTypeOfRevealType(node: CallNode, inferenceContext: InferenceContext | undefined): TypeResult {
        let arg0Value: ExpressionNode | undefined;
        let expectedRevealTypeNode: ExpressionNode | undefined;
        let expectedRevealType: Type | undefined;
        let expectedTextNode: ExpressionNode | undefined;
        let expectedText: string | undefined;

        // Make sure there is only one positional argument passed as arg 0.
        node.d.args.forEach((arg, index) => {
            if (index === 0) {
                if (arg.d.argCategory === ArgCategory.Simple && !arg.d.name) {
                    arg0Value = arg.d.valueExpr;
                }
            } else if (arg.d.argCategory !== ArgCategory.Simple || !arg.d.name) {
                arg0Value = undefined;
            } else if (arg.d.name.d.value === 'expected_text') {
                expectedTextNode = arg.d.valueExpr;
                const expectedTextType = getTypeOfExpression(arg.d.valueExpr).type;

                if (
                    !isClassInstance(expectedTextType) ||
                    !ClassType.isBuiltIn(expectedTextType, 'str') ||
                    typeof expectedTextType.priv.literalValue !== 'string'
                ) {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        LocMessage.revealTypeExpectedTextArg(),
                        arg.d.valueExpr
                    );
                } else {
                    expectedText = expectedTextType.priv.literalValue;
                }
            } else if (arg.d.name.d.value === 'expected_type') {
                expectedRevealTypeNode = arg.d.valueExpr;
                expectedRevealType = convertToInstance(
                    getTypeOfArgExpectingType(convertNodeToArg(arg), {
                        typeExpression: true,
                    }).type
                );
            }
        });

        if (!arg0Value) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.revealTypeArgs(), node);
            return { type: UnknownType.create() };
        }

        const typeResult = getTypeOfExpression(arg0Value, /* flags */ undefined, inferenceContext);
        const type = typeResult.type;

        const exprString = ParseTreeUtils.printExpression(arg0Value);
        const typeString = printType(type, { expandTypeAlias: true });

        if (!typeResult.isIncomplete) {
            if (expectedText !== undefined) {
                if (expectedText !== typeString) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.revealTypeExpectedTextMismatch().format({
                            expected: expectedText,
                            received: typeString,
                        }),
                        expectedTextNode ?? arg0Value
                    );
                }
            }

            if (expectedRevealType) {
                if (!isTypeSame(expectedRevealType, type, { ignorePseudoGeneric: true })) {
                    const expectedRevealTypeText = printType(expectedRevealType);
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.revealTypeExpectedTypeMismatch().format({
                            expected: expectedRevealTypeText,
                            received: typeString,
                        }),
                        expectedRevealTypeNode ?? arg0Value
                    );
                }
            }

            addInformation(LocAddendum.typeOfSymbol().format({ name: exprString, type: typeString }), node.d.args[0]);
        }

        return { type, isIncomplete: typeResult.isIncomplete };
    }

    function getTypeOfRevealLocals(node: CallNode) {
        return expressionEvaluation.getTypeOfRevealLocals(node);
    }

    function getTypeOfSuperCall(node: CallNode): TypeResult {
        return expressionEvaluation.getTypeOfSuperCall(node);
    }

    // Attempts to find an overloaded function for each set of argument
    // types in the expandedArgTypes list. If an argument type is undefined,
    // its type is evaluated from the argument's expression using the
    // corresponding parameter's expected type. The first time this is called,
    // there will be only one argument list in expandedArgTypes, and all entries
    // (one for each argument) will be undefined. On subsequent calls, this
    // list will grow to include union expansions.
    function validateOverloadsWithExpandedTypes(
        errorNode: ExpressionNode,
        expandedArgTypes: (Type | undefined)[][],
        argParamMatches: MatchArgsToParamsResult[],
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        skipFinalValidation = false
    ): CallResult {
        const returnTypes: Type[] = [];
        const specializedInitSelfTypes: Type[] = [];
        let matchedOverloads: MatchedOverloadInfo[] = [];
        let isTypeIncomplete = false;
        let overloadsUsedForCall: FunctionType[] = [];
        let isDefinitiveMatchFound = false;
        const speculativeNode = getSpeculativeNodeForCall(errorNode);

        for (let expandedTypesIndex = 0; expandedTypesIndex < expandedArgTypes.length; expandedTypesIndex++) {
            let matchedOverload: FunctionType | undefined;
            const argTypeOverride = expandedArgTypes[expandedTypesIndex];
            const hasArgTypeOverride = argTypeOverride.some((a) => a !== undefined);
            let possibleMatchResults: MatchedOverloadInfo[] = [];
            let possibleMatchInvolvesIncompleteUnknown = false;
            isDefinitiveMatchFound = false;

            for (let overloadIndex = 0; overloadIndex < argParamMatches.length; overloadIndex++) {
                const overload = argParamMatches[overloadIndex].overload;

                let matchResults = argParamMatches[overloadIndex];
                if (hasArgTypeOverride) {
                    matchResults = { ...argParamMatches[overloadIndex] };
                    matchResults.argParams = matchResults.argParams.map((argParam, argIndex) => {
                        if (!argTypeOverride[argIndex]) {
                            return argParam;
                        }
                        const argParamCopy = { ...argParam };
                        argParamCopy.argType = argTypeOverride[argIndex];
                        return argParamCopy;
                    });
                }

                // Clone the constraints so we don't modify the original.
                const effectiveConstraints = constraints?.clone() ?? new ConstraintTracker();

                // Use speculative mode so we don't output any diagnostics or
                // record any final types in the type cache.
                const callResult = useSpeculativeMode(speculativeNode, () => {
                    return validateArgTypesWithContext(
                        errorNode,
                        matchResults,
                        effectiveConstraints,
                        /* skipUnknownArgCheck */ true,
                        inferenceContext
                    );
                });

                if (callResult.isTypeIncomplete) {
                    isTypeIncomplete = true;
                }

                if (!callResult.argumentErrors && callResult.returnType) {
                    if (
                        evaluatorOptions.experimentalOverloadResult &&
                        !callResult.isTypeIncomplete &&
                        errorNode.nodeType === ParseNodeType.Call &&
                        isAutomaticOverloadSeedSyntax(errorNode) &&
                        expandedArgTypes.length === 1 &&
                        !hasArgTypeOverride
                    ) {
                        const receiver = overload.priv.boundToType;
                        evaluatorOptions.experimentalOverloadResult.considerActivation(
                            errorNode,
                            receiver && isClassInstance(receiver)
                                ? [{ argType: receiver }, ...(callResult.argResults ?? [])]
                                : callResult.argResults ?? []
                        );
                    }
                    overloadsUsedForCall.push(overload);

                    matchedOverload = overload;
                    const matchedOverloadInfo: MatchedOverloadInfo = {
                        overload: matchedOverload,
                        matchResults,
                        constraints: effectiveConstraints,
                        returnType: callResult.returnType,
                        argResults: callResult.argResults ?? [],
                    };
                    matchedOverloads.push(matchedOverloadInfo);

                    if (callResult.anyOrUnknownArg || matchResults.unpackedArgOfUnknownLength) {
                        possibleMatchResults.push(matchedOverloadInfo);

                        if (callResult.anyOrUnknownArg) {
                            if (isIncompleteUnknown(callResult.anyOrUnknownArg)) {
                                possibleMatchInvolvesIncompleteUnknown = true;
                            }
                        }
                    } else {
                        returnTypes.push(callResult.returnType);
                        // Each definitive union branch needs its own constructed type;
                        // __init__ return types alone cannot represent the specialization.
                        const boundToType = overload.priv.boundToType;
                        if (
                            expandedArgTypes.length > 1 &&
                            overload.shared.name === '__init__' &&
                            boundToType &&
                            isClassInstance(boundToType)
                        ) {
                            specializedInitSelfTypes.push(
                                callResult.specializedInitSelfType ??
                                    solveAndApplyConstraints(boundToType, effectiveConstraints, {
                                        replaceUnsolved: {
                                            scopeIds: getTypeVarScopeIds(boundToType),
                                            tupleClassType: getTupleClassType(),
                                        },
                                    })
                            );
                        }
                        isDefinitiveMatchFound = true;
                        break;
                    }
                }
            }

            // If we didn't find a definitive match that doesn't depend on
            // an Any or Unknown argument, fall back on the possible match.
            // If there were multiple possible matches, evaluate the type as
            // Unknown, but include the "possible types" to allow for completion
            // suggestions.
            if (!isDefinitiveMatchFound && possibleMatchResults.length > 0) {
                possibleMatchResults = filterOverloadMatchesForUnpackedArgs(possibleMatchResults);
                possibleMatchResults = filterOverloadMatchesForAnyArgs(possibleMatchResults);

                // Did the filtering produce a single result? If so, we're done.
                if (possibleMatchResults.length === 1) {
                    overloadsUsedForCall = [possibleMatchResults[0].overload];
                    returnTypes.push(possibleMatchResults[0].returnType);
                    matchedOverloads = [possibleMatchResults[0]];
                } else {
                    // Eliminate any return types that are subsumed by other return types.
                    let dedupedMatchResults: Type[] = [];
                    let dedupedResultsIncludeAny = false;

                    possibleMatchResults.forEach((result) => {
                        let isSubtypeSubsumed = false;

                        for (let dedupedIndex = 0; dedupedIndex < dedupedMatchResults.length; dedupedIndex++) {
                            if (assignType(dedupedMatchResults[dedupedIndex], result.returnType)) {
                                const anyOrUnknown = containsAnyOrUnknown(
                                    dedupedMatchResults[dedupedIndex],
                                    /* recurse */ false
                                );
                                if (!anyOrUnknown) {
                                    isSubtypeSubsumed = true;
                                } else if (isAny(anyOrUnknown)) {
                                    dedupedResultsIncludeAny = true;
                                }
                                break;
                            } else if (assignType(result.returnType, dedupedMatchResults[dedupedIndex])) {
                                const anyOrUnknown = containsAnyOrUnknown(result.returnType, /* recurse */ false);
                                if (!anyOrUnknown) {
                                    dedupedMatchResults[dedupedIndex] = NeverType.createNever();
                                } else if (isAny(anyOrUnknown)) {
                                    dedupedResultsIncludeAny = true;
                                }
                                break;
                            }
                        }

                        if (!isSubtypeSubsumed) {
                            dedupedMatchResults.push(result.returnType);
                        }
                    });

                    dedupedMatchResults = dedupedMatchResults.filter((t) => !isNever(t));
                    const combinedTypes = combineTypes(dedupedMatchResults);

                    let returnType = combinedTypes;
                    if (dedupedMatchResults.length > 1) {
                        // If one or more of the deduped types is Any or contains Any,
                        // we will assume that the person who defined the overload really
                        // wanted Any rather than Unknown. In cases where the deduped types
                        // simply contains conflicting results without an Any, we'll use
                        // an UnknownType.
                        if (dedupedResultsIncludeAny) {
                            returnType = AnyType.create();
                        } else {
                            returnType = UnknownType.createPossibleType(
                                combinedTypes,
                                possibleMatchInvolvesIncompleteUnknown
                            );
                        }
                    }

                    returnTypes.push(returnType);
                }
            }

            if (!matchedOverload) {
                return { argumentErrors: true, isTypeIncomplete, overloadsUsedForCall };
            }
        }

        // We found a match for all of the expanded argument lists. Copy the
        // resulting type var context back into the caller's type var context.
        // Constructor results for separate union branches are carried through
        // specializedInitSelfTypes rather than the last branch's constraints.
        if (constraints && isDefinitiveMatchFound) {
            constraints.copyFromClone(matchedOverloads[matchedOverloads.length - 1].constraints);
        }

        // A speculative refinement does not need to populate the type cache;
        // the original call has already performed the normal final validation.
        if (skipFinalValidation) {
            return {
                argumentErrors: false,
                returnType: combineTypes(returnTypes),
                isTypeIncomplete,
                overloadsUsedForCall,
            };
        }

        // And run through the first expanded argument list one more time to
        // populate the type cache, without applying a different branch's constraints.
        const finalConstraints =
            expandedArgTypes.length > 1
                ? matchedOverloads[0].constraints
                : constraints ?? matchedOverloads[0].constraints;
        const finalCallResult = validateArgTypesWithContext(
            errorNode,
            matchedOverloads[0].matchResults,
            finalConstraints,
            skipUnknownArgCheck,
            inferenceContext
        );

        if (finalCallResult.isTypeIncomplete) {
            isTypeIncomplete = true;
        }

        return {
            argumentErrors: finalCallResult.argumentErrors,
            anyOrUnknownArg: finalCallResult.anyOrUnknownArg,
            returnType: combineTypes(returnTypes),
            isTypeIncomplete,
            specializedInitSelfType:
                specializedInitSelfTypes.length === expandedArgTypes.length
                    ? combineTypes(specializedInitSelfTypes)
                    : finalCallResult.specializedInitSelfType,
            overloadsUsedForCall,
        };
    }

    // Determines whether one or more overloads can be eliminated because they
    // rely on an unpacked argument of unknown length when there is at least
    // one overload that doesn't because it maps to an *args parameter.
    function filterOverloadMatchesForUnpackedArgs(matches: MatchedOverloadInfo[]): MatchedOverloadInfo[] {
        if (matches.length < 2) {
            return matches;
        }

        // Is there at least one overload that relies on unpacked args for a match?
        const unpackedArgsOverloads = matches.filter((match) => match.matchResults.unpackedArgMapsToVariadic);
        if (unpackedArgsOverloads.length === matches.length || unpackedArgsOverloads.length === 0) {
            return matches;
        }

        return unpackedArgsOverloads;
    }

    // Determines whether multiple incompatible overloads match
    // due to an Any or Unknown argument type.
    function filterOverloadMatchesForAnyArgs(matches: MatchedOverloadInfo[]): MatchedOverloadInfo[] {
        if (matches.length < 2) {
            return matches;
        }

        // If all of the return types match, select the first one.
        if (
            areTypesSame(
                matches.map((match) => match.returnType),
                { treatAnySameAsUnknown: true }
            )
        ) {
            return [matches[0]];
        }

        const firstArgResults = matches[0].argResults;
        if (!firstArgResults) {
            return matches;
        }

        let foundAmbiguousAnyArg = false;
        for (let i = 0; i < firstArgResults.length; i++) {
            // If the arg is Any or Unknown, see if the corresponding
            // parameter types differ in any way.
            if (isAnyOrUnknown(firstArgResults[i].argType)) {
                const paramTypes = matches.map((match) =>
                    i < match.matchResults.argParams.length
                        ? match.matchResults.argParams[i].paramType
                        : UnknownType.create()
                );
                if (!areTypesSame(paramTypes, { treatAnySameAsUnknown: true })) {
                    foundAmbiguousAnyArg = true;
                }
            }
        }

        // If the first overload has a different number of effective arguments
        // than latter overloads, don't filter any of them. This typically means
        // that one of the arguments is an unpacked iterator, and it maps to
        // an indeterminate number of parameters, which means that the overload
        // selection is ambiguous.
        if (foundAmbiguousAnyArg || matches.some((match) => match.argResults.length !== firstArgResults.length)) {
            return matches;
        }

        return [matches[0]];
    }

    function getBestOverloadForArgs(
        errorNode: ExpressionNode,
        typeResult: TypeResult<OverloadedType>,
        argList: Arg[]
    ): FunctionType | undefined {
        let overloadIndex = 0;
        const matches: MatchArgsToParamsResult[] = [];
        const speculativeNode = getSpeculativeNodeForCall(errorNode);

        useSignatureTracker(errorNode, () => {
            // Create a list of potential overload matches based on arguments.
            OverloadedType.getOverloads(typeResult.type).forEach((overload) => {
                useSpeculativeMode(speculativeNode, () => {
                    const matchResults = matchArgsToParams(
                        errorNode,
                        argList,
                        { type: overload, isIncomplete: typeResult.isIncomplete },
                        overloadIndex
                    );

                    if (!matchResults.argumentErrors) {
                        matches.push(matchResults);
                    }

                    overloadIndex++;
                });
            });
        });

        let winningOverloadIndex: number | undefined;

        matches.forEach((match, matchIndex) => {
            if (winningOverloadIndex === undefined) {
                useSpeculativeMode(speculativeNode, () => {
                    const callResult = validateArgTypes(
                        errorNode,
                        match,
                        new ConstraintTracker(),
                        /* skipUnknownArgCheck */ true
                    );

                    if (callResult && !callResult.argumentErrors) {
                        winningOverloadIndex = matchIndex;
                    }
                });
            }
        });

        return winningOverloadIndex === undefined ? undefined : matches[winningOverloadIndex].overload;
    }

    function selectAutomaticOverloadResult(
        node: CallNode,
        limit: number,
        proofUnits: number
    ): AutomaticOverloadSelection {
        const budget = new OverloadSelectionBudget(proofUnits);
        const coverage: OverloadCoverage[] = [];
        const matches: number[] = [];
        const decline = (reason: string): AutomaticOverloadSelection => ({
            candidates: [],
            reason: budget.exceeded ? 'proof-limit' : reason,
            coverage,
            matches,
            units: budget.used,
        });
        return useSpeculativeMode(node, () => {
            const callee = getTypeOfExpression(node.d.leftExpr, EvalFlags.NoSpecialize);
            if (callee.isIncomplete || callee.typeErrors || !isOverloaded(callee.type)) {
                return decline('not-complete-overloaded-function');
            }
            const overloads = OverloadedType.getOverloads(callee.type);
            if (overloads.length > limit) {
                return decline('candidate-limit');
            }
            const args: Arg[] = node.d.args.map((arg) => ({
                argCategory: arg.d.argCategory,
                valueExpression: arg.d.valueExpr,
                node: arg,
                name: arg.d.name,
            }));
            const sources = node.d.args.map((arg) => getTypeOfExpression(arg.d.valueExpr));
            const receiver =
                node.d.leftExpr.nodeType === ParseNodeType.MemberAccess
                    ? getTypeOfExpression(node.d.leftExpr.d.leftExpr)
                    : undefined;
            if (
                [...sources, ...(receiver ? [receiver] : [])].some(
                    (s) =>
                        s.isIncomplete || s.typeErrors || isAny(s.type) || !isFixedOverloadArgumentShape(s.type, budget)
                )
            ) {
                return decline('unsupported-argument-shape');
            }
            if (![...sources, ...(receiver ? [receiver] : [])].some((s) => hasNestedOverloadAny(s.type))) {
                return decline('no-invariant-any');
            }
            const returns: Type[] = [];
            for (let index = 0; index < overloads.length; index++) {
                checkForCancellation();
                const overload = overloads[index];
                const declaration = overload.shared.declaration;
                const declaredReturnType = overload.shared.declaredReturnType;
                const returnType = FunctionType.getEffectiveReturnType(overload);
                const receiverParam = overload.priv.strippedFirstParamType;
                const supportedBinding = receiver
                    ? declaration?.isMethod &&
                      FunctionType.isInstanceMethod(overload) &&
                      overload.priv.boundToType &&
                      isClassInstance(overload.priv.boundToType) &&
                      receiverParam &&
                      isClassInstance(receiverParam) &&
                      isClassInstance(receiver.type) &&
                      ClassType.isSameGenericClass(receiver.type, receiverParam) &&
                      overload.shared.methodClass &&
                      ClassType.isSameGenericClass(
                          receiver.type,
                          ClassType.cloneAsInstance(overload.shared.methodClass)
                      ) &&
                      isFixedOverloadArgumentShape(receiverParam, budget)
                    : !declaration?.isMethod && !overload.shared.methodClass && !overload.priv.boundToType;
                if (
                    !declaration ||
                    !supportedBinding ||
                    overload.shared.typeParams.length ||
                    !declaredReturnType ||
                    !returnType ||
                    declaration.node.d.decorators.length !== 1 ||
                    overload.shared.parameters.some(
                        (p, i) =>
                            p.category !== ParamCategory.Simple ||
                            !p.name ||
                            p.defaultExpr ||
                            FunctionType.getParamDefaultType(overload, i)
                    )
                ) {
                    return decline('unsupported-signature');
                }
                if (
                    !isFixedOverloadReturnShape(declaredReturnType, budget) ||
                    (returnType !== declaredReturnType && !isFixedOverloadReturnShape(returnType, budget))
                ) {
                    return decline('unsupported-return-shape');
                }
                const mapping = matchArgsToParams(node, args, { type: overload, isIncomplete: false }, index);
                if (mapping.isTypeIncomplete) {
                    return decline('incomplete-mapping');
                }
                if (mapping.argumentErrors) {
                    continue;
                }
                if (
                    mapping.argParams.length !== args.length ||
                    mapping.argParams.some(
                        (p, i) =>
                            p.argument !== args[i] ||
                            p.isDefaultArg ||
                            p.requiresTypeVarMatching ||
                            !isFixedOverloadArgumentShape(p.paramType, budget)
                    )
                ) {
                    return decline('unsupported-mapping');
                }
                // This is the ordinary matcher and solver, not a parallel
                // assignability algorithm. Only complete successful matches count.
                const matched = useSpeculativeMode(node, () =>
                    validateArgTypesWithContext(node, mapping, new ConstraintTracker(), true, undefined)
                );
                if (matched.isTypeIncomplete || !matched.returnType) {
                    return decline('incomplete-solution');
                }
                if (!isFixedOverloadReturnShape(matched.returnType, budget)) {
                    return decline('unsupported-solved-return-shape');
                }
                if (matched.argumentErrors) {
                    continue;
                }
                const proof = mapping.argParams.map((p, i) =>
                    getFixedOverloadCoverage(sources[i].type, p.paramType, budget)
                );
                if (receiver && receiverParam) {
                    proof.unshift(getFixedOverloadCoverage(receiver.type, receiverParam, budget));
                }
                const covered = proof.includes('unsupported')
                    ? 'unsupported'
                    : proof.includes('not-covered')
                    ? 'not-covered'
                    : 'covered';
                coverage.push(covered);
                matches.push(index);
                if (covered === 'unsupported') {
                    return decline('unsupported-coverage');
                }
                if (!returns.some((type) => isTypeSame(type, matched.returnType!))) {
                    returns.push(matched.returnType);
                }
                // A covering overload ends the retained prefix; earlier
                // non-covering matches remain live alternatives.
                if (covered === 'covered') {
                    break;
                }
            }
            return returns.length > 1
                ? { candidates: returns, reason: 'selected', coverage, matches, units: budget.used }
                : decline('equivalent-or-single-return');
        });
    }

    function validateOverloadedArgTypes(
        errorNode: ExpressionNode,
        argList: Arg[],
        typeResult: TypeResult<OverloadedType>,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        candidateOverloads?: FunctionType[]
    ): CallResult {
        const filteredMatchResults: MatchArgsToParamsResult[] = [];
        let contextFreeArgTypes: Type[] | undefined;
        let isTypeIncomplete = !!typeResult.isIncomplete;
        const type = typeResult.type;
        const overloads = candidateOverloads ?? OverloadedType.getOverloads(type);
        const speculativeNode = getSpeculativeNodeForCall(errorNode);

        // Start by evaluating the types of the arguments without any expected
        // type. Also, filter the list of overloads based on the number of
        // positional and keyword arguments that are present. We do all of this
        // speculatively because we don't want to record any types in the type
        // cache or record any diagnostics at this stage.
        useSpeculativeMode(speculativeNode, () => {
            let overloadIndex = 0;
            overloads.forEach((overload) => {
                // Consider only the functions that have the @overload decorator,
                // not the final function that omits the overload. This is the
                // intended behavior according to PEP 484.
                const matchResults = matchArgsToParams(
                    errorNode,
                    argList,
                    { type: overload, isIncomplete: typeResult.isIncomplete },
                    overloadIndex
                );

                if (!matchResults.argumentErrors) {
                    filteredMatchResults.push(matchResults);
                }

                overloadIndex++;
            });
        });

        // If there are no possible arg/param matches among the overloads,
        // emit an error that includes the argument types.
        if (filteredMatchResults.length === 0) {
            // Skip the error message if we're in speculative mode because it's very
            // expensive, and we're going to suppress the diagnostic anyway.
            if (!canSkipDiagnosticForNode(errorNode)) {
                const functionName =
                    overloads.length > 0 && overloads[0].shared.name
                        ? overloads[0].shared.name
                        : '<anonymous function>';
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map((t) => {
                    const typeString = printType(getTypeOfArg(t, /* inferenceContext */ undefined).type);

                    if (t.argCategory === ArgCategory.UnpackedList) {
                        return `*${typeString}`;
                    }

                    if (t.argCategory === ArgCategory.UnpackedDictionary) {
                        return `**${typeString}`;
                    }

                    return typeString;
                });

                diagAddendum.addMessage(LocAddendum.argumentTypes().format({ types: argTypes.join(', ') }));
                addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.noOverload().format({ name: functionName }) + diagAddendum.getString(),
                    errorNode
                );
            }

            return { argumentErrors: true, isTypeIncomplete, overloadsUsedForCall: [] };
        }

        // Create a helper function that evaluates the overload that best
        // matches the arg/param lists.
        function evaluateUsingBestMatchingOverload(skipUnknownArgCheck: boolean, emitNoOverloadFoundError: boolean) {
            // Find the match with the smallest argument match score. If there
            // are more than one with the same score, use the one with the
            // largest index. Later overloads tend to be more general.
            const bestMatch = filteredMatchResults.reduce((previous, current) => {
                if (current.argumentMatchScore === previous.argumentMatchScore) {
                    return current.overloadIndex > previous.overloadIndex ? current : previous;
                }
                return current.argumentMatchScore < previous.argumentMatchScore ? current : previous;
            });

            // If there is more than one filtered match, report that no match
            // was possible and emit a diagnostic that provides the most likely.
            if (emitNoOverloadFoundError) {
                const functionName = bestMatch.overload.shared.name || '<anonymous function>';
                const diagnostic = addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.noOverload().format({ name: functionName }),
                    errorNode
                );

                const overrideDecl = bestMatch.overload.shared.declaration;
                if (diagnostic && overrideDecl) {
                    diagnostic.addRelatedInfo(
                        LocAddendum.overloadIndex().format({ index: bestMatch.overloadIndex + 1 }),
                        overrideDecl.uri,
                        overrideDecl.range
                    );
                }
            }

            const effectiveConstraints = constraints ?? new ConstraintTracker();

            return validateArgTypesWithContext(
                errorNode,
                bestMatch,
                effectiveConstraints,
                skipUnknownArgCheck,
                inferenceContext
            );
        }

        // If there is only one possible arg/param match among the overloads,
        // use the normal type matching mechanism because it is faster and
        // will provide a clearer error message.
        if (filteredMatchResults.length === 1) {
            return evaluateUsingBestMatchingOverload(
                /* skipUnknownArgCheck */ false,
                /* emitNoOverloadFoundError */ false
            );
        }

        let expandedArgTypes: (Type | undefined)[][] | undefined = [argList.map((arg) => undefined)];

        while (true) {
            const callResult = validateOverloadsWithExpandedTypes(
                errorNode,
                expandedArgTypes,
                filteredMatchResults,
                constraints,
                skipUnknownArgCheck,
                inferenceContext,
                /* skipFinalValidation */ candidateOverloads !== undefined
            );

            if (callResult.isTypeIncomplete) {
                isTypeIncomplete = true;
            }

            if (!callResult.argumentErrors) {
                return callResult;
            }

            // We didn't find an overload match. Try to expand the next union
            // argument type into individual types and retry with the expanded types.
            if (!contextFreeArgTypes) {
                useSpeculativeMode(getSpeculativeNodeForCall(errorNode), () => {
                    // Evaluate the types of each argument expression without regard to
                    // the context. We'll use this to determine whether we need to do
                    // union expansion.
                    contextFreeArgTypes = argList.map((arg) => {
                        if (arg.typeResult) {
                            return arg.typeResult.type;
                        }

                        if (arg.valueExpression) {
                            const valueExpressionNode = arg.valueExpression;
                            return useSpeculativeMode(valueExpressionNode, () => {
                                return getTypeOfExpression(valueExpressionNode).type;
                            });
                        }

                        return AnyType.create();
                    });
                });
            }

            expandedArgTypes = expressionEvaluation.expandArgTypes(contextFreeArgTypes!, expandedArgTypes);

            // Check for combinatoric explosion and break out of loop.
            if (!expandedArgTypes || expandedArgTypes.length > maxTotalOverloadArgTypeExpansionCount) {
                break;
            }
        }

        // We couldn't find any valid overloads. Skip the error message if we're
        // in speculative mode because it's very expensive, and we're going to
        // suppress the diagnostic anyway.
        if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
            const result = evaluateUsingBestMatchingOverload(
                /* skipUnknownArgCheck */ true,
                /* emitNoOverloadFoundError */ true
            );

            // Replace the result with an unknown type since we don't know
            // what overload should have been used.
            result.returnType = UnknownType.create();
            return { ...result, argumentErrors: true };
        }

        return { argumentErrors: true, isTypeIncomplete, overloadsUsedForCall: [] };
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and sets argumentErrors to true.
    function validateCallArgs(
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount = 0
    ): CallResult {
        let argumentErrors = false;
        let isTypeIncomplete = false;
        let specializedInitSelfType: Type | undefined;
        const overloadsUsedForCall: FunctionType[] = [];

        if (recursionCount > maxTypeRecursionCount) {
            return { returnType: UnknownType.create(), argumentErrors: true, overloadsUsedForCall };
        }
        recursionCount++;

        // Special forms are not callable.
        if (callTypeResult.type.props?.specialForm) {
            const exprNode = errorNode.nodeType === ParseNodeType.Call ? errorNode.d.leftExpr : errorNode;
            addDiagnostic(
                DiagnosticRule.reportCallIssue,
                LocMessage.objectNotCallable().format({
                    type: printType(callTypeResult.type.props.specialForm, { expandTypeAlias: true }),
                }),
                exprNode
            );
            return { returnType: UnknownType.create(), argumentErrors: true, overloadsUsedForCall };
        }

        const concreteCallType = makeTopLevelTypeVarsConcrete(callTypeResult.type);
        const lambdaNodes = isUnion(concreteCallType)
            ? argList
                  .map((arg) => arg.valueExpression)
                  .filter((node): node is LambdaNode => node?.nodeType === ParseNodeType.Lambda)
            : undefined;
        const lambdaTypeCache: ContextualLambdaTypeCache | undefined = lambdaNodes?.length
            ? { lambdaNodes, entries: new Map(), branchIndex: 0 }
            : undefined;

        const previousCache = contextualLambdaTypeCache;
        let returnType: Type;
        try {
            if (lambdaTypeCache) {
                contextualLambdaTypeCache = lambdaTypeCache;
            }
            returnType = mapSubtypesExpandTypeVars(
                callTypeResult.type,
                { sortSubtypes: true },
                (expandedSubtype, unexpandedSubtype, isLastIteration) => {
                    if (lambdaTypeCache) {
                        lambdaTypeCache.branchIndex++;
                    }
                    return useSpeculativeMode(
                        isLastIteration ? undefined : getSpeculativeNodeForCall(errorNode),
                        () => {
                            const callResult = validateCallArgsForSubtype(
                                errorNode,
                                argList,
                                expandedSubtype,
                                unexpandedSubtype,
                                !!callTypeResult.isIncomplete,
                                constraints,
                                skipUnknownArgCheck,
                                inferenceContext,
                                recursionCount
                            );

                            if (callResult.argumentErrors) {
                                argumentErrors = true;
                            }

                            if (callResult.isTypeIncomplete) {
                                isTypeIncomplete = true;
                            }

                            if (callResult.overloadsUsedForCall) {
                                appendArray(overloadsUsedForCall, callResult.overloadsUsedForCall);
                            }

                            specializedInitSelfType = callResult.specializedInitSelfType;

                            return callResult.returnType;
                        },
                        {
                            allowDiagnostics: true,
                        }
                    );
                }
            );
        } finally {
            contextualLambdaTypeCache = previousCache;
        }

        // Keep branch-specific checking and return inference separate from the
        // combined contextual types retained for subsequent queries.
        if (!isTypeIncomplete && lambdaTypeCache && lambdaTypeCache.branchIndex > 1) {
            invalidateTypeCacheIfCanceled(() => combineContextualLambdaTypes(lambdaTypeCache));
        }

        // If we ended up with a "Never" type because all code paths returned
        // undefined due to argument errors, transform the result into an Unknown
        // to avoid subsequent false positives.
        if (argumentErrors && isNever(returnType) && !returnType.priv.isNoReturn) {
            returnType = UnknownType.create();
        }

        return {
            argumentErrors,
            returnType,
            isTypeIncomplete,
            specializedInitSelfType,
            overloadsUsedForCall,
        };
    }

    function validateCallArgsForSubtype(
        errorNode: ExpressionNode,
        argList: Arg[],
        expandedCallType: Type,
        unexpandedCallType: Type,
        isCallTypeIncomplete: boolean,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount: number
    ): CallResult {
        function touchArgTypes() {
            if (!isCallTypeIncomplete) {
                argList.forEach((arg) => {
                    if (arg.valueExpression && !isSpeculativeModeInUse(arg.valueExpression)) {
                        getTypeOfArg(arg, /* inferenceContext */ undefined);
                    }
                });
            }
        }

        switch (expandedCallType.category) {
            case TypeCategory.Never:
            case TypeCategory.Unknown:
            case TypeCategory.Any: {
                // Create a dummy callable that accepts all arguments and validate
                // that the argument expressions are valid.
                const dummyFunctionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);
                FunctionType.addDefaultParams(dummyFunctionType);

                const dummyCallResult = validateCallForFunction(
                    errorNode,
                    argList,
                    dummyFunctionType,
                    isCallTypeIncomplete,
                    constraints,
                    skipUnknownArgCheck,
                    inferenceContext
                );

                return { ...dummyCallResult, returnType: expandedCallType };
            }

            case TypeCategory.Function: {
                return validateCallForFunction(
                    errorNode,
                    argList,
                    expandedCallType,
                    isCallTypeIncomplete,
                    constraints,
                    skipUnknownArgCheck,
                    inferenceContext
                );
            }

            case TypeCategory.Overloaded: {
                return validateCallForOverloaded(
                    errorNode,
                    argList,
                    expandedCallType,
                    isCallTypeIncomplete,
                    constraints,
                    skipUnknownArgCheck,
                    inferenceContext
                );
            }

            case TypeCategory.Class: {
                if (isNoneInstance(expandedCallType)) {
                    addDiagnostic(DiagnosticRule.reportOptionalCall, LocMessage.noneNotCallable(), errorNode);

                    touchArgTypes();
                    return { argumentErrors: true };
                }

                if (TypeBase.isInstantiable(expandedCallType)) {
                    return validateCallForInstantiableClass(
                        errorNode,
                        argList,
                        expandedCallType,
                        unexpandedCallType,
                        skipUnknownArgCheck,
                        inferenceContext
                    );
                }

                return validateCallForClassInstance(
                    errorNode,
                    argList,
                    expandedCallType,
                    unexpandedCallType,
                    constraints,
                    skipUnknownArgCheck,
                    inferenceContext,
                    recursionCount
                );
            }

            // TypeVars should have been expanded in most cases,
            // but we still need to handle the case of Type[T] where
            // T is a constrained type that contains a union. We also
            // need to handle recursive type aliases.
            case TypeCategory.TypeVar: {
                return validateCallArgs(
                    errorNode,
                    argList,
                    { type: transformPossibleRecursiveTypeAlias(expandedCallType), isIncomplete: isCallTypeIncomplete },
                    constraints,
                    skipUnknownArgCheck,
                    inferenceContext,
                    recursionCount
                );
            }

            case TypeCategory.Module: {
                addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.moduleNotCallable(), errorNode);

                touchArgTypes();
                return { argumentErrors: true };
            }
        }

        touchArgTypes();
        return { argumentErrors: true };
    }

    function validateCallForFunction(
        errorNode: ExpressionNode,
        argList: Arg[],
        type: FunctionType,
        isCallTypeIncomplete: boolean,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined
    ): CallResult {
        if (TypeBase.isInstantiable(type)) {
            addDiagnostic(
                DiagnosticRule.reportCallIssue,
                LocMessage.callableNotInstantiable().format({
                    type: printType(type),
                }),
                errorNode
            );
            return { returnType: undefined, argumentErrors: true };
        }

        // The stdlib collections/__init__.pyi stub file defines namedtuple
        // as a function rather than a class, so we need to check for it here.
        if (FunctionType.isBuiltIn(type, 'namedtuple')) {
            addDiagnostic(DiagnosticRule.reportUntypedNamedTuple, LocMessage.namedTupleNoTypes(), errorNode);

            const result: CallResult = {
                returnType: createNamedTupleType(
                    evaluatorInterface,
                    errorNode,
                    argList,
                    /* includesTypes */ false,
                    nodeInfo
                ),
            };

            validateArgs(errorNode, argList, { type: type }, constraints, skipUnknownArgCheck, inferenceContext);

            return result;
        }

        // Handle the NewType specially, replacing the normal return type.
        if (FunctionType.isBuiltIn(type, 'NewType')) {
            return { returnType: createNewType(errorNode, argList) };
        }

        const functionResult = validateArgs(
            errorNode,
            argList,
            { type, isIncomplete: isCallTypeIncomplete },
            constraints,
            skipUnknownArgCheck,
            inferenceContext
        );

        let isTypeIncomplete = !!functionResult.isTypeIncomplete;
        let returnType = functionResult.returnType;

        let argumentErrors = !!functionResult.argumentErrors;
        if (!argumentErrors) {
            // Call the function transform logic to handle special-cased functions.
            const transformed = applyFunctionTransform(evaluatorInterface, errorNode, argList, type, {
                argumentErrors: !!functionResult.argumentErrors,
                returnType: functionResult.returnType ?? UnknownType.create(isTypeIncomplete),
                isTypeIncomplete,
            });

            returnType = transformed.returnType;
            if (transformed.isTypeIncomplete) {
                isTypeIncomplete = true;
            }
            if (transformed.argumentErrors) {
                argumentErrors = true;
            }
        }

        if (FunctionType.isBuiltIn(type, '__import__')) {
            // For the special __import__ type, we'll override the return type to be "Any".
            // This is required because we don't know what module was imported, and we don't
            // want to fail type checks when accessing members of the resulting module type.
            returnType = AnyType.create();
        }

        return {
            returnType,
            isTypeIncomplete,
            argumentErrors,
            overloadsUsedForCall: functionResult.overloadsUsedForCall,
            specializedInitSelfType: functionResult.specializedInitSelfType,
        };
    }

    // Determines whether a symbol is abstract. In an ABC class, this means a function
    // is specifically decorated with @abstractmethod. In a protocol class, the rules
    // are more complicated and depend on whether the method is defined in a stub file.
    function getAbstractSymbolInfo(classType: ClassType, symbolName: string): AbstractSymbol | undefined {
        return evaluatorCore.getAbstractSymbolInfo(classType, symbolName);
    }

    // The synthesized "get" and "pop" methods for a TypedDict include a
    // catch-all overload that accepts any str key. When the key argument is a
    // union of str literals, that catch-all overload matches before union
    // expansion is attempted, which produces an overly-wide return type. This
    // function evaluates the call separately for each literal key subtype
    // (speculatively) and, if every subtype is accepted, returns the union of
    // the resulting return types.
    function refineTypedDictMethodCallForUnionKey(
        errorNode: ExpressionNode,
        argList: Arg[],
        overloadedType: OverloadedType,
        isCallTypeIncomplete: boolean,
        constraints: ConstraintTracker | undefined,
        inferenceContext: InferenceContext | undefined
    ): { returnType: Type; isTypeIncomplete: boolean; overloadsUsedForCall: FunctionType[] } | undefined {
        const overloads = OverloadedType.getOverloads(overloadedType);
        const overload = overloads[0];
        if (!overload || !FunctionType.isSynthesizedMethod(overload)) {
            return undefined;
        }

        const methodName = overload.shared.name;
        if (methodName !== 'get' && methodName !== 'pop') {
            return undefined;
        }

        const isBound = isMethodType(overload);
        const receiverType = isBound
            ? overload.priv.strippedFirstParamType
            : overload.shared.parameters.length > 0
            ? FunctionType.getParamType(overload, 0)
            : undefined;
        if (!receiverType || !isClassInstance(receiverType) || !ClassType.isTypedDictClass(receiverType)) {
            return undefined;
        }

        // Unbound generic methods have not specialized their field types from the
        // receiver. Keep the normal result rather than refining it to Unknown.
        if (
            !isBound &&
            (requiresSpecialization(receiverType) || containsAnyOrUnknown(receiverType, /* recurse */ true))
        ) {
            return undefined;
        }

        // Handle only simple positional calls: (key) or (key, default).
        const keyIndex = isBound ? 0 : 1;
        if (argList.length <= keyIndex || argList.length > keyIndex + 2) {
            return undefined;
        }
        if (!argList.every((arg) => !arg.name && arg.argCategory === ArgCategory.Simple)) {
            return undefined;
        }

        const keyArg = argList[keyIndex];
        const keyTypeResult =
            keyArg.typeResult ?? (keyArg.valueExpression ? getTypeOfExpression(keyArg.valueExpression) : undefined);
        if (!keyTypeResult || !isUnion(keyTypeResult.type)) {
            return undefined;
        }

        // Every subtype must be a str literal; otherwise keep the normal result.
        const keySubtypes: ClassType[] = [];
        let allStrLiterals = true;
        doForEachSubtype(keyTypeResult.type, (subtype) => {
            if (
                isClassInstance(subtype) &&
                ClassType.isBuiltIn(subtype, 'str') &&
                typeof subtype.priv.literalValue === 'string'
            ) {
                keySubtypes.push(subtype);
            } else {
                allStrLiterals = false;
            }
        });
        if (!allStrLiterals || keySubtypes.length < 2 || keySubtypes.length > maxSingleOverloadArgTypeExpansionCount) {
            return undefined;
        }

        let isTypeIncomplete = !!keyTypeResult.isIncomplete;
        const returnTypes: Type[] = [];
        const overloadsUsedForCall = new Set<FunctionType>();

        const succeeded = useSpeculativeMode(getSpeculativeNodeForCall(errorNode), () => {
            for (const keySubtype of keySubtypes) {
                // Avoid revalidating unrelated keys and their default parameters.
                const candidates = overloads.filter((candidate) => {
                    const paramType = FunctionType.getParamType(candidate, keyIndex);
                    return (
                        isClassInstance(paramType) &&
                        ClassType.isBuiltIn(paramType, 'str') &&
                        (paramType.priv.literalValue === undefined ||
                            paramType.priv.literalValue === keySubtype.priv.literalValue)
                    );
                });
                if (candidates.length === 0) {
                    return false;
                }

                const subtypeArgList = [...argList];
                subtypeArgList[keyIndex] = {
                    argCategory: ArgCategory.Simple,
                    typeResult: { type: keySubtype, isIncomplete: keyTypeResult.isIncomplete },
                };

                const subtypeResult = validateOverloadedArgTypes(
                    errorNode,
                    subtypeArgList,
                    { type: overloadedType, isIncomplete: isCallTypeIncomplete },
                    constraints?.clone(),
                    /* skipUnknownArgCheck */ true,
                    inferenceContext,
                    candidates
                );

                if (subtypeResult.isTypeIncomplete) {
                    isTypeIncomplete = true;
                }

                if (subtypeResult.argumentErrors || !subtypeResult.returnType) {
                    return false;
                }

                returnTypes.push(subtypeResult.returnType);
                subtypeResult.overloadsUsedForCall?.forEach((matched) => overloadsUsedForCall.add(matched));
            }

            return true;
        });

        if (!succeeded) {
            return undefined;
        }

        return {
            returnType: combineTypes(returnTypes),
            isTypeIncomplete,
            overloadsUsedForCall: [...overloadsUsedForCall],
        };
    }

    function validateCallForOverloaded(
        errorNode: ExpressionNode,
        argList: Arg[],
        expandedCallType: OverloadedType,
        isCallTypeIncomplete: boolean,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined
    ): CallResult {
        const overloads = OverloadedType.getOverloads(expandedCallType);
        // Handle the 'cast' call as a special case.
        if (
            overloads.length > 0 &&
            FunctionType.isBuiltIn(overloads[0], ['typing.cast', 'typing_extensions.cast']) &&
            argList.length === 2
        ) {
            return { returnType: evaluateCastCall(argList, errorNode) };
        }

        const callResult = validateOverloadedArgTypes(
            errorNode,
            argList,
            { type: expandedCallType, isIncomplete: isCallTypeIncomplete },
            constraints,
            skipUnknownArgCheck,
            inferenceContext
        );

        let returnType = callResult.returnType ?? UnknownType.create();
        let isTypeIncomplete = !!callResult.isTypeIncomplete;
        let argumentErrors = !!callResult.argumentErrors;
        let overloadsUsedForCall = callResult.overloadsUsedForCall;

        if (!argumentErrors) {
            const refinedResult = refineTypedDictMethodCallForUnionKey(
                errorNode,
                argList,
                expandedCallType,
                isCallTypeIncomplete,
                constraints,
                inferenceContext
            );
            if (refinedResult?.isTypeIncomplete) {
                isTypeIncomplete = true;
            }
            if (refinedResult) {
                overloadsUsedForCall = refinedResult.overloadsUsedForCall;
            }

            // Call the function transform logic to handle special-cased functions.
            const transformed = applyFunctionTransform(evaluatorInterface, errorNode, argList, expandedCallType, {
                argumentErrors: !!callResult.argumentErrors,
                returnType: refinedResult?.returnType ?? callResult.returnType ?? UnknownType.create(isTypeIncomplete),
                isTypeIncomplete,
            });

            returnType = transformed.returnType;
            if (transformed.isTypeIncomplete) {
                isTypeIncomplete = true;
            }

            if (transformed.argumentErrors) {
                argumentErrors = true;
            }
        }

        return {
            returnType,
            isTypeIncomplete,
            argumentErrors,
            overloadsUsedForCall,
            specializedInitSelfType: callResult.specializedInitSelfType,
        };
    }

    function validateCallForInstantiableClass(
        errorNode: ExpressionNode,
        argList: Arg[],
        expandedCallType: ClassType,
        unexpandedCallType: Type,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined
    ): CallResult {
        if (expandedCallType.priv.literalValue !== undefined) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.literalNotCallable(), errorNode);

            return { returnType: UnknownType.create(), argumentErrors: true };
        }

        if (ClassType.isBuiltIn(expandedCallType)) {
            const className = expandedCallType.priv.aliasName ?? expandedCallType.shared.name;

            // Handle a call to a metaclass explicitly.
            if (isInstantiableMetaclass(expandedCallType)) {
                if (expandedCallType.priv.typeArgs && expandedCallType.priv.isTypeArgExplicit) {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        LocMessage.objectNotCallable().format({
                            type: printType(expandedCallType),
                        }),
                        errorNode
                    );
                    return { returnType: UnknownType.create(), argumentErrors: true };
                }

                // Validate the constructor arguments.
                validateConstructorArgs(
                    evaluatorInterface,
                    errorNode,
                    argList,
                    expandedCallType,
                    skipUnknownArgCheck,
                    inferenceContext
                );

                // The one-parameter form of "type" returns the class
                // for the specified object.
                if (expandedCallType.shared.name === 'type' && argList.length === 1) {
                    const argTypeResult = getTypeOfArg(argList[0], /* inferenceContext */ undefined);
                    const argType = argTypeResult.type;
                    const returnType = mapSubtypes(argType, (subtype) => {
                        if (isNever(subtype)) {
                            return subtype;
                        }

                        if (isClass(subtype)) {
                            // Specifically handle the case where the subtype is a class-like
                            // object created by calling NewType. At runtime, it's actually
                            // a FunctionType object.
                            if (
                                isClassInstance(subtype) &&
                                ClassType.isNewTypeClass(subtype) &&
                                !subtype.priv.includeSubclasses
                            ) {
                                if (prefetched?.functionClass) {
                                    return prefetched.functionClass;
                                }
                            }

                            // stripLiteralValue retains sentinel literals, but type() of a
                            // sentinel evaluates to its class, not the sentinel object.
                            const classSubtype = isSentinelLiteral(subtype)
                                ? ClassType.cloneWithLiteral(subtype, /* value */ undefined)
                                : stripLiteralValue(subtype);
                            return convertToInstantiable(classSubtype);
                        }

                        if (TypeBase.isInstance(subtype)) {
                            if (isFunction(subtype) || isTypeVar(subtype)) {
                                return convertToInstantiable(subtype);
                            }
                        }

                        return ClassType.specialize(ClassType.cloneAsInstance(expandedCallType), [
                            UnknownType.create(),
                        ]);
                    });

                    return { returnType, isTypeIncomplete: argTypeResult.isIncomplete };
                }

                if (argList.length >= 2) {
                    // The two-parameter form of a call to a metaclass returns a new class
                    // built from the specified base types.
                    return {
                        returnType: createClassFromMetaclass(errorNode, argList, expandedCallType) || AnyType.create(),
                    };
                }

                // If the parameter to type() is not statically known,
                // fall back to Any.
                return { returnType: AnyType.create() };
            }

            if (className === 'TypeVar') {
                return {
                    returnType: createTypeVarType(errorNode, expandedCallType, argList),
                };
            }

            if (className === 'TypeVarTuple') {
                return {
                    returnType: createTypeVarTupleType(errorNode, expandedCallType, argList),
                };
            }

            if (className === 'ParamSpec') {
                return {
                    returnType: createParamSpecType(errorNode, expandedCallType, argList),
                };
            }

            if (className === 'TypeAliasType') {
                const newTypeAlias = createTypeAliasType(errorNode, argList);
                if (newTypeAlias) {
                    return { returnType: newTypeAlias };
                }
            }

            if (className === 'NamedTuple') {
                const result: CallResult = {
                    returnType: createNamedTupleType(
                        evaluatorInterface,
                        errorNode,
                        argList,
                        /* includesTypes */ true,
                        nodeInfo
                    ),
                };

                const initTypeResult = getBoundInitMethod(
                    evaluatorInterface,
                    errorNode,
                    ClassType.cloneAsInstance(expandedCallType),
                    /* diag */ undefined,
                    /* additionalFlags */ MemberAccessFlags.Default
                );

                if (initTypeResult && isOverloaded(initTypeResult.type)) {
                    validateOverloadedArgTypes(
                        errorNode,
                        argList,
                        { type: initTypeResult.type },
                        /* constraints */ undefined,
                        skipUnknownArgCheck,
                        /* inferenceContext */ undefined
                    );
                }

                return result;
            }

            if (className === 'NewType') {
                return { returnType: createNewType(errorNode, argList) };
            }

            // Handle sentinel calls specially.
            if (
                expandedCallType.shared.fullName === 'builtins.sentinel' ||
                expandedCallType.shared.fullName === 'typing_extensions.sentinel' ||
                expandedCallType.shared.fullName === 'typing_extensions.Sentinel'
            ) {
                return {
                    returnType: createSentinelType(evaluatorInterface, errorNode, argList, expandedCallType, nodeInfo),
                };
            }

            if (ClassType.isSpecialFormClass(expandedCallType)) {
                addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.typeNotIntantiable().format({ type: className }),
                    errorNode
                );

                return { returnType: UnknownType.create(), argumentErrors: true };
            }

            if (className === 'TypedDict') {
                return {
                    returnType: createTypedDictType(evaluatorInterface, errorNode, expandedCallType, argList, nodeInfo),
                };
            }

            if (className === 'auto' && argList.length === 0) {
                return { returnType: getEnumAutoValueType(evaluatorInterface, errorNode) };
            }
        }

        // Is it a call to an Enum class factory?
        if (
            isClass(expandedCallType) &&
            expandedCallType.shared.effectiveMetaclass &&
            isClass(expandedCallType.shared.effectiveMetaclass) &&
            isEnumMetaclass(expandedCallType.shared.effectiveMetaclass) &&
            !isEnumClassWithMembers(evaluatorInterface, expandedCallType, nodeInfo)
        ) {
            return {
                returnType:
                    createEnumType(evaluatorInterface, errorNode, expandedCallType, argList, nodeInfo) ??
                    convertToInstance(unexpandedCallType),
            };
        }

        if (ClassType.supportsAbstractMethods(expandedCallType)) {
            const abstractSymbols = getAbstractSymbols(expandedCallType);

            if (
                abstractSymbols.length > 0 &&
                !expandedCallType.priv.includeSubclasses &&
                !isTypeVar(unexpandedCallType)
            ) {
                // If the class is abstract, it can't be instantiated.
                const diagAddendum = new DiagnosticAddendum();
                const errorsToDisplay = 2;

                abstractSymbols.forEach((abstractMethod, index) => {
                    if (index === errorsToDisplay) {
                        diagAddendum.addMessage(
                            LocAddendum.memberIsAbstractMore().format({
                                count: abstractSymbols.length - errorsToDisplay,
                            })
                        );
                    } else if (index < errorsToDisplay) {
                        if (isInstantiableClass(abstractMethod.classType)) {
                            const className = abstractMethod.classType.shared.name;
                            diagAddendum.addMessage(
                                LocAddendum.memberIsAbstract().format({
                                    type: className,
                                    name: abstractMethod.symbolName,
                                })
                            );
                        }
                    }
                });

                addDiagnostic(
                    DiagnosticRule.reportAbstractUsage,
                    LocMessage.instantiateAbstract().format({
                        type: expandedCallType.shared.name,
                    }) + diagAddendum.getString(),
                    errorNode
                );
            }
        }

        if (ClassType.isProtocolClass(expandedCallType) && !expandedCallType.priv.includeSubclasses) {
            // If the class is a protocol, it can't be instantiated.
            addDiagnostic(
                DiagnosticRule.reportAbstractUsage,
                LocMessage.instantiateProtocol().format({
                    type: expandedCallType.shared.name,
                }),
                errorNode
            );
        }

        // Assume this is a call to the constructor.
        const constructorResult = validateConstructorArgs(
            evaluatorInterface,
            errorNode,
            argList,
            expandedCallType,
            skipUnknownArgCheck,
            inferenceContext
        );

        const overloadsUsedForCall = constructorResult.overloadsUsedForCall;
        const argumentErrors = constructorResult.argumentErrors;
        const isTypeIncomplete = constructorResult.isTypeIncomplete;
        const usesBuiltInTypeNew = overloadsUsedForCall?.some((overload) =>
            FunctionType.isBuiltIn(overload, 'builtins.type.__new__')
        );

        let returnType = constructorResult.returnType;

        // If the expandedCallType originated from a TypeVar, convert
        // the constructed type back to the TypeVar. For example, if
        // we have `cls: Type[_T]` followed by `_T()`.
        if (isTypeVar(unexpandedCallType)) {
            returnType = convertToInstance(unexpandedCallType);
        }

        // If we instantiated the "deprecated" class, attach the deprecation
        // message to the instance.
        if (
            errorNode.nodeType === ParseNodeType.Call &&
            returnType &&
            isClassInstance(returnType) &&
            ClassType.isBuiltIn(returnType, 'deprecated')
        ) {
            returnType = ClassType.cloneForDeprecatedInstance(returnType, getDeprecatedMessageFromCall(errorNode));
        }

        // If we instantiated a type, transform it into a class.
        // This can happen if someone directly instantiates a metaclass
        // deriving from type.
        if (
            returnType &&
            isClassInstance(returnType) &&
            returnType.shared.mro.some(
                (baseClass) => isInstantiableClass(baseClass) && ClassType.isBuiltIn(baseClass, 'type')
            )
        ) {
            let newClassName = '__class_' + returnType.shared.name;
            if (argList.length === 3) {
                const firstArgType = getTypeOfArg(argList[0], /* inferenceContext */ undefined).type;

                if (
                    isClassInstance(firstArgType) &&
                    ClassType.isBuiltIn(firstArgType, 'str') &&
                    typeof firstArgType.priv.literalValue === 'string'
                ) {
                    newClassName = firstArgType.priv.literalValue;
                }
            }

            const newClassType = ClassType.createInstantiable(
                newClassName,
                '',
                '',
                nodeInfo.getFileInfo(errorNode).fileUri,
                ClassTypeFlags.None,
                ParseTreeUtils.getTypeSourceId(errorNode),
                ClassType.cloneAsInstantiable(returnType),
                ClassType.cloneAsInstantiable(returnType)
            );
            if (usesBuiltInTypeNew && argList.length >= 2) {
                const baseTupleType = getTypeOfArg(argList[1], /* inferenceContext */ undefined).type;
                if (isClassInstance(baseTupleType)) {
                    const baseClasses = getBaseClassesFromTypeCall(baseTupleType);
                    if (baseClasses) {
                        newClassType.shared.baseClasses.push(...baseClasses);
                    }
                }
            }

            if (newClassType.shared.baseClasses.length === 0) {
                newClassType.shared.baseClasses.push(getBuiltInType(errorNode, 'object'));
            }
            newClassType.shared.effectiveMetaclass = expandedCallType;
            newClassType.shared.declaration = returnType.shared.declaration;

            if (!computeMroLinearization(newClassType)) {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.methodOrdering(), errorNode);
            }
            returnType = newClassType;
        }

        return { returnType, overloadsUsedForCall, argumentErrors, isTypeIncomplete };
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
        return evaluatorCore.validateCallForClassInstance(
            errorNode,
            argList,
            expandedCallType,
            unexpandedCallType,
            constraints,
            skipUnknownArgCheck,
            inferenceContext,
            recursionCount
        );
    }

    // Evaluates the type of the "cast" call.
    function evaluateCastCall(argList: Arg[], errorNode: ExpressionNode) {
        return expressionEvaluation.evaluateCastCall(argList, errorNode);
    }

    // Matches the arguments passed to a function to the corresponding parameters in that
    // function. This matching is done based on positions and keywords. Type evaluation and
    // validation is left to the caller.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    function matchArgsToParams(
        errorNode: ExpressionNode,
        argList: Arg[],
        typeResult: TypeResult<FunctionType>,
        overloadIndex: number
    ): MatchArgsToParamsResult {
        const overload = typeResult.type;
        const unexpandedArgList =
            isIntFlagBitwiseFunction(overload) && !overload.priv.strippedFirstParamType ? argList : undefined;
        const paramDetails = getParamListDetails(overload, { disallowExtraKwargsForTd: true });
        const paramSpec = FunctionType.getParamSpecFromArgsKwargs(overload);

        let argIndex = 0;
        let unpackedArgOfUnknownLength = false;
        let unpackedArgMapsToVariadic = false;
        let reportedArgError = false;
        let isTypeIncomplete = !!typeResult.isIncomplete;
        let isTypeVarTupleFullyMatched = false;

        // Expand any unpacked tuples in the arg list.
        argList = expressionEvaluation.expandArgList(argList);

        // Construct an object that racks which parameters have been assigned arguments.
        const paramTracker = new ParamAssignmentTracker(paramDetails.params);

        let positionalOnlyLimitIndex = paramDetails.positionOnlyParamCount;
        let positionParamLimitIndex = paramDetails.firstKeywordOnlyIndex ?? paramDetails.params.length;

        const varArgListParamIndex = paramDetails.argsIndex;
        const varArgDictParamIndex = paramDetails.kwargsIndex;

        // Is this an function that uses the *args and **kwargs
        // from a param spec? If so, we need to treat all positional parameters
        // prior to the *args as positional-only according to PEP 612.
        let paramSpecArgList: Arg[] | undefined;
        let paramSpecTarget: ParamSpecType | undefined;
        let hasParamSpecArgsKwargs = false;

        // Determine how many positional args are being passed before
        // we see a keyword arg.
        let positionalArgCount = argList.findIndex(
            (arg) => arg.argCategory === ArgCategory.UnpackedDictionary || arg.name !== undefined
        );
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        if (varArgListParamIndex !== undefined && varArgDictParamIndex !== undefined) {
            assert(paramDetails.params[varArgListParamIndex], 'varArgListParamIndex params entry is undefined');
            const varArgListParamType = paramDetails.params[varArgListParamIndex].type;
            assert(paramDetails.params[varArgDictParamIndex], 'varArgDictParamIndex params entry is undefined');
            const varArgDictParamType = paramDetails.params[varArgDictParamIndex].type;

            if (
                isParamSpec(varArgListParamType) &&
                varArgListParamType.priv.paramSpecAccess === 'args' &&
                isParamSpec(varArgDictParamType) &&
                varArgDictParamType.priv.paramSpecAccess === 'kwargs' &&
                varArgListParamType.shared.name === varArgDictParamType.shared.name
            ) {
                hasParamSpecArgsKwargs = true;

                // Does this function define the param spec, or is it an inner
                // function nested within another function that defines the param
                // spec? We need to handle these two cases differently.
                const paramSpecScopeId = varArgListParamType.priv.scopeId;

                if (getTypeVarScopeIds(overload).some((id) => id === paramSpecScopeId)) {
                    paramSpecArgList = [];
                    paramSpecTarget = TypeVarType.cloneForParamSpecAccess(varArgListParamType, /* access */ undefined);
                } else {
                    positionalOnlyLimitIndex = varArgListParamIndex;
                    positionalArgCount = Math.min(varArgListParamIndex, positionalArgCount);
                    positionParamLimitIndex = varArgListParamIndex;
                }
            }
        } else if (paramSpec) {
            if (getTypeVarScopeIds(overload).some((id) => id === paramSpec.priv.scopeId)) {
                hasParamSpecArgsKwargs = true;
                paramSpecArgList = [];
                paramSpecTarget = paramSpec;
            }
        }

        // If there are keyword arguments present after a *args argument,
        // the keyword arguments may target one or more parameters that are positional.
        // In this case, we will limit the number of positional parameters so the
        // *args doesn't consume them all.
        if (argList.some((arg) => arg.argCategory === ArgCategory.UnpackedList)) {
            argList.forEach((arg) => {
                if (arg.name) {
                    const keywordParamIndex = paramDetails.params.findIndex((paramInfo) => {
                        assert(paramInfo, 'paramInfo entry is undefined fork kwargs check');
                        return (
                            paramInfo.param.name === arg.name!.d.value &&
                            paramInfo.param.category === ParamCategory.Simple
                        );
                    });

                    // Is this a parameter that can be interpreted as either a keyword or a positional?
                    // If so, we'll treat it as a keyword parameter in this case because it's being
                    // targeted by a keyword argument.
                    if (keywordParamIndex >= 0 && keywordParamIndex >= positionalOnlyLimitIndex) {
                        if (positionParamLimitIndex < 0 || keywordParamIndex < positionParamLimitIndex) {
                            positionParamLimitIndex = keywordParamIndex;
                        }
                    }
                }
            });
        }

        // If we didn't see any special cases, then all parameters are positional.
        if (positionParamLimitIndex < 0) {
            positionParamLimitIndex = paramDetails.params.length;
        }

        let validateArgTypeParams: ValidateArgTypeParams[] = [];

        let activeParam: FunctionParam | undefined;
        function trySetActive(arg: Arg, param: FunctionParam) {
            if (arg.active) {
                activeParam = param;
            }
        }

        const foundUnpackedListArg = argList.find((arg) => arg.argCategory === ArgCategory.UnpackedList) !== undefined;

        // Map the positional args to parameters.
        let paramIndex = 0;

        while (argIndex < positionalArgCount) {
            if (argIndex < positionalOnlyLimitIndex && argList[argIndex].name) {
                const nameNode = argList[argIndex].name;
                if (nameNode) {
                    addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.argPositional(), nameNode);
                    reportedArgError = true;
                }
            }

            const remainingArgCount = positionalArgCount - argIndex;
            const remainingParamCount = positionParamLimitIndex - paramIndex - 1;

            if (paramIndex >= positionParamLimitIndex) {
                if (paramSpecArgList) {
                    // Push the remaining positional args onto the param spec arg list.
                    while (argIndex < positionalArgCount) {
                        paramSpecArgList.push(argList[argIndex]);
                        argIndex++;
                    }
                } else {
                    let tooManyPositionals = false;

                    if (argList[argIndex].argCategory === ArgCategory.UnpackedList) {
                        // If this is an unpacked iterable, we will conservatively assume that it
                        // might have zero iterations unless we can tell from its type that it
                        // definitely has at least one iterable value.
                        const argType = getTypeOfArg(argList[argIndex], /* inferenceContext */ undefined).type;

                        if (
                            isClassInstance(argType) &&
                            isTupleClass(argType) &&
                            !isUnboundedTupleClass(argType) &&
                            argType.priv.tupleTypeArgs !== undefined &&
                            argType.priv.tupleTypeArgs.length > 0
                        ) {
                            tooManyPositionals = true;
                        } else {
                            unpackedArgOfUnknownLength = true;
                        }
                    } else {
                        tooManyPositionals = true;
                    }

                    if (tooManyPositionals) {
                        if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                            addDiagnostic(
                                DiagnosticRule.reportCallIssue,
                                positionParamLimitIndex === 1
                                    ? LocMessage.argPositionalExpectedOne()
                                    : LocMessage.argPositionalExpectedCount().format({
                                          expected: positionParamLimitIndex,
                                      }),
                                argList[argIndex].valueExpression ?? errorNode
                            );
                        }
                        reportedArgError = true;
                    }
                }
                break;
            }

            if (paramIndex >= paramDetails.params.length) {
                break;
            }

            assert(paramDetails.params[paramIndex], 'paramIndex params entry is undefined');
            const paramInfo = paramDetails.params[paramIndex];
            const paramType = paramInfo.type;
            const paramName = paramInfo.param.name;

            const isParamVariadic = paramInfo.param.category === ParamCategory.ArgsList && isUnpacked(paramType);

            if (argList[argIndex].argCategory === ArgCategory.UnpackedList) {
                let isArgCompatibleWithVariadic = false;

                const argTypeResult = getTypeOfArg(argList[argIndex], /* inferenceContext */ undefined);

                let listElementType: Type | undefined;
                let enforceIterable = false;
                let advanceToNextArg = false;

                // Handle the case where *args is being passed to a function defined
                // with a ParamSpec and a Concatenate operator. PEP 612 indicates that
                // all positional parameters specified in the Concatenate must be
                // filled explicitly.
                if (paramIndex < positionParamLimitIndex) {
                    if (
                        isParamSpec(argTypeResult.type) &&
                        argTypeResult.type.priv.paramSpecAccess === 'args' &&
                        paramInfo.param.category !== ParamCategory.ArgsList
                    ) {
                        if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                            addDiagnostic(
                                DiagnosticRule.reportCallIssue,
                                positionParamLimitIndex === 1
                                    ? LocMessage.argPositionalExpectedOne()
                                    : LocMessage.argPositionalExpectedCount().format({
                                          expected: positionParamLimitIndex,
                                      }),
                                argList[argIndex].valueExpression ?? errorNode
                            );
                        }
                        reportedArgError = true;
                    }
                }

                const argType = argTypeResult.type;

                if (isParamVariadic && isUnpackedTypeVarTuple(argType)) {
                    // Allow an unpacked TypeVarTuple arg to satisfy an
                    // unpacked TypeVarTuple param.
                    listElementType = argType;
                    isArgCompatibleWithVariadic = true;
                    advanceToNextArg = true;
                    isTypeVarTupleFullyMatched = true;
                } else if (
                    isClassInstance(argType) &&
                    isTupleClass(argType) &&
                    argType.priv.tupleTypeArgs &&
                    argType.priv.tupleTypeArgs.length === 1 &&
                    isUnpackedTypeVarTuple(argType.priv.tupleTypeArgs[0].type)
                ) {
                    // Handle the case where an unpacked TypeVarTuple has
                    // been packaged into a tuple.
                    listElementType = argType.priv.tupleTypeArgs[0].type;
                    isArgCompatibleWithVariadic = true;
                    advanceToNextArg = true;
                    isTypeVarTupleFullyMatched = true;
                } else if (isParamVariadic && isClassInstance(argType) && isTupleClass(argType)) {
                    // Handle the case where an unpacked tuple argument is
                    // matched to a TypeVarTuple parameter.
                    isArgCompatibleWithVariadic = true;
                    advanceToNextArg = true;

                    // Determine whether we should treat the variadic type as fully matched.
                    // This depends on how many args and unmatched parameters exist.
                    if (remainingArgCount < remainingParamCount) {
                        isTypeVarTupleFullyMatched = true;
                    }

                    listElementType = ClassType.cloneForUnpacked(argType);
                } else if (isParamSpec(argType) && argType.priv.paramSpecAccess === 'args') {
                    listElementType = undefined;
                } else {
                    listElementType = getTypeOfIterator(
                        { type: argType, isIncomplete: argTypeResult.isIncomplete },
                        /* isAsync */ false,
                        errorNode,
                        /* emitNotIterableError */ false
                    )?.type;

                    if (!listElementType) {
                        enforceIterable = true;
                    }

                    unpackedArgOfUnknownLength = true;

                    if (paramInfo.param.category === ParamCategory.ArgsList) {
                        unpackedArgMapsToVariadic = true;
                    }

                    if (isParamVariadic && listElementType) {
                        isArgCompatibleWithVariadic = true;
                        listElementType = makeTupleObject(
                            evaluatorInterface,
                            [{ type: listElementType, isUnbounded: true }],
                            /* isUnpacked */ true
                        );
                    }
                }

                const funcArg: Arg | undefined = listElementType
                    ? {
                          argCategory: ArgCategory.Simple,
                          typeResult: { type: listElementType, isIncomplete: argTypeResult.isIncomplete },
                      }
                    : { ...argList[argIndex], enforceIterable };

                if (argTypeResult.isIncomplete) {
                    isTypeIncomplete = true;
                }

                // It's not allowed to use unpacked arguments with a variadic *args
                // parameter unless the argument is a variadic arg as well.
                if (isParamVariadic && !isArgCompatibleWithVariadic) {
                    if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                        addDiagnostic(
                            DiagnosticRule.reportCallIssue,
                            LocMessage.unpackedArgWithVariadicParam(),
                            argList[argIndex].valueExpression || errorNode
                        );
                    }
                    reportedArgError = true;
                } else {
                    if (paramSpecArgList && paramInfo.param.category !== ParamCategory.Simple) {
                        paramSpecArgList.push(argList[argIndex]);
                    }

                    if (funcArg) {
                        validateArgTypeParams.push({
                            paramCategory: paramInfo.param.category,
                            paramType,
                            requiresTypeVarMatching: requiresSpecialization(paramType),
                            argument: funcArg,
                            errorNode: argList[argIndex].valueExpression ?? errorNode,
                            paramName,
                            isParamNameSynthesized: FunctionParam.isNameSynthesized(paramInfo.param),
                            mapsToVarArgList: isParamVariadic && remainingArgCount > remainingParamCount,
                        });
                    }
                }

                trySetActive(argList[argIndex], paramDetails.params[paramIndex].param);

                // Note that the parameter has received an argument.
                if (paramName && paramDetails.params[paramIndex].param.category === ParamCategory.Simple) {
                    paramTracker.markArgReceived(paramInfo);
                }

                if (advanceToNextArg || paramDetails.params[paramIndex].param.category === ParamCategory.ArgsList) {
                    argIndex++;
                }

                if (
                    isTypeVarTupleFullyMatched ||
                    paramDetails.params[paramIndex].param.category !== ParamCategory.ArgsList
                ) {
                    paramIndex++;
                }
            } else if (paramDetails.params[paramIndex].param.category === ParamCategory.ArgsList) {
                trySetActive(argList[argIndex], paramDetails.params[paramIndex].param);

                if (paramSpecArgList) {
                    paramSpecArgList.push(argList[argIndex]);
                    argIndex++;
                } else {
                    let paramCategory = paramDetails.params[paramIndex].param.category;
                    let effectiveParamType = paramType;
                    const paramName = paramDetails.params[paramIndex].param.name;

                    if (
                        isUnpackedClass(paramType) &&
                        paramType.priv.tupleTypeArgs &&
                        paramType.priv.tupleTypeArgs.length > 0
                    ) {
                        effectiveParamType = paramType.priv.tupleTypeArgs[0].type;
                    }

                    paramCategory = isUnpacked(effectiveParamType) ? ParamCategory.ArgsList : ParamCategory.Simple;

                    if (remainingArgCount <= remainingParamCount) {
                        if (remainingArgCount < remainingParamCount) {
                            if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                // Have we run out of arguments and still have parameters left to fill?
                                addDiagnostic(
                                    DiagnosticRule.reportCallIssue,
                                    remainingArgCount === 1
                                        ? LocMessage.argMorePositionalExpectedOne()
                                        : LocMessage.argMorePositionalExpectedCount().format({
                                              expected: remainingArgCount,
                                          }),
                                    argList[argIndex].valueExpression || errorNode
                                );
                            }
                            reportedArgError = true;
                        }

                        paramIndex++;
                    } else {
                        validateArgTypeParams.push({
                            paramCategory,
                            paramType: effectiveParamType,
                            requiresTypeVarMatching: requiresSpecialization(paramType),
                            argument: argList[argIndex],
                            errorNode: argList[argIndex].valueExpression || errorNode,
                            paramName,
                            isParamNameSynthesized: FunctionParam.isNameSynthesized(
                                paramDetails.params[paramIndex].param
                            ),
                            mapsToVarArgList: true,
                        });

                        argIndex++;
                    }
                }
            } else {
                const paramInfo = paramDetails.params[paramIndex];
                const paramName = paramInfo.param.name;

                validateArgTypeParams.push({
                    paramCategory: paramInfo.param.category,
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName,
                    isParamNameSynthesized: FunctionParam.isNameSynthesized(paramInfo.param),
                });
                trySetActive(argList[argIndex], paramInfo.param);

                // Note that the parameter has received an argument.
                paramTracker.markArgReceived(paramInfo);

                argIndex++;
                paramIndex++;
            }
        }

        // If there weren't enough positional arguments to populate all of the
        // positional-only parameters and the next positional-only parameter is
        // an unbounded tuple, skip past it.
        let skippedArgsParam = false;
        if (
            positionalOnlyLimitIndex >= 0 &&
            paramIndex < positionalOnlyLimitIndex &&
            paramIndex < paramDetails.params.length &&
            paramDetails.params[paramIndex].param.category === ParamCategory.ArgsList &&
            !isParamSpec(paramDetails.params[paramIndex].type)
        ) {
            paramIndex++;
            skippedArgsParam = true;
        }

        // Check if there weren't enough positional arguments to populate all of
        // the positional-only parameters.
        if (
            positionalOnlyLimitIndex >= 0 &&
            paramIndex < positionalOnlyLimitIndex &&
            (!foundUnpackedListArg || hasParamSpecArgsKwargs)
        ) {
            const firstParamWithDefault = paramDetails.params.findIndex((paramInfo) => !!paramInfo.defaultType);
            const positionOnlyWithoutDefaultsCount =
                firstParamWithDefault >= 0 && firstParamWithDefault < positionalOnlyLimitIndex
                    ? firstParamWithDefault
                    : positionalOnlyLimitIndex;

            // Calculate the number of remaining positional parameters to report.
            let argsRemainingCount = positionOnlyWithoutDefaultsCount - positionalArgCount;
            if (skippedArgsParam) {
                // If we skipped an args parameter above, reduce the count by one
                // because it's permitted to pass zero arguments to *args.
                argsRemainingCount--;
            }

            const firstArgsParam = paramDetails.params.findIndex(
                (paramInfo) => paramInfo.param.category === ParamCategory.ArgsList && !isParamSpec(paramInfo.type)
            );
            if (firstArgsParam >= paramIndex && firstArgsParam < positionalOnlyLimitIndex) {
                // If there is another args parameter beyond the current param index,
                // reduce the count by one because it's permitted to pass zero arguments
                // to *args.
                argsRemainingCount--;
            }

            if (argsRemainingCount > 0) {
                if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        argsRemainingCount === 1
                            ? LocMessage.argMorePositionalExpectedOne()
                            : LocMessage.argMorePositionalExpectedCount().format({
                                  expected: argsRemainingCount,
                              }),
                        argList.length > positionalArgCount
                            ? argList[positionalArgCount].valueExpression || errorNode
                            : errorNode
                    );
                }
                reportedArgError = true;
            }
        }

        if (!reportedArgError) {
            let unpackedDictKeyNames: string[] | undefined;
            let unpackedDictArgType: Type | undefined;

            // Now consume any keyword arguments.
            while (argIndex < argList.length) {
                if (argList[argIndex].argCategory === ArgCategory.UnpackedDictionary) {
                    // Verify that the type used in this expression is a SupportsKeysAndGetItem[str, T].
                    const argTypeResult = getTypeOfArg(
                        argList[argIndex],
                        makeInferenceContext(paramDetails.unpackedKwargsTypedDictType)
                    );
                    const argType = argTypeResult.type;

                    if (argTypeResult.isIncomplete) {
                        isTypeIncomplete = true;
                    }

                    if (isAnyOrUnknown(argType)) {
                        unpackedDictArgType = argType;
                    } else if (isClassInstance(argType) && ClassType.isTypedDictClass(argType)) {
                        // Handle the special case where it is a TypedDict and we know which
                        // keys are present.
                        const tdEntries = getTypedDictMembersForClass(evaluatorInterface, argType);
                        const diag = new DiagnosticAddendum();

                        tdEntries.knownItems.forEach((entry, name) => {
                            const paramEntry = paramTracker.lookupName(name);
                            if (paramEntry) {
                                if (paramEntry.argsReceived > 0) {
                                    diag.addMessage(LocMessage.paramAlreadyAssigned().format({ name }));
                                } else {
                                    paramEntry.argsReceived++;

                                    const paramInfoIndex = paramDetails.params.findIndex(
                                        (paramInfo) => paramInfo.param.name === name
                                    );
                                    assert(paramInfoIndex >= 0);
                                    const paramType = paramDetails.params[paramInfoIndex].type;

                                    validateArgTypeParams.push({
                                        paramCategory: ParamCategory.Simple,
                                        paramType,
                                        requiresTypeVarMatching: requiresSpecialization(paramType),
                                        argument: {
                                            argCategory: ArgCategory.Simple,
                                            typeResult: { type: entry.valueType },
                                        },
                                        errorNode: argList[argIndex].valueExpression ?? errorNode,
                                        paramName: name,
                                    });
                                }
                            } else if (paramDetails.kwargsIndex !== undefined) {
                                const paramType = paramDetails.params[paramDetails.kwargsIndex].type;
                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.KwargsDict,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: {
                                        argCategory: ArgCategory.Simple,
                                        typeResult: { type: entry.valueType },
                                    },
                                    errorNode: argList[argIndex].valueExpression ?? errorNode,
                                    paramName: name,
                                });

                                // Remember that this parameter has already received a value.
                                paramTracker.addKeywordParam(name, paramDetails.params[paramDetails.kwargsIndex]);
                            } else {
                                // If the function doesn't have a **kwargs parameter, we need to emit an error.
                                // However, it's possible that there was a **kwargs but it was eliminated by
                                // getParamListDetails because it was associated with an unpacked TypedDict.
                                // In this case, we can skip the error.
                                if (!paramDetails.hasUnpackedTypedDict) {
                                    diag.addMessage(LocMessage.paramNameMissing().format({ name }));
                                }
                            }
                        });

                        const extraItemsType = tdEntries.extraItems?.valueType ?? getObjectType();
                        if (!isNever(extraItemsType)) {
                            if (paramDetails.kwargsIndex !== undefined) {
                                const kwargsParam = paramDetails.params[paramDetails.kwargsIndex];

                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.KwargsDict,
                                    paramType: kwargsParam.type,
                                    requiresTypeVarMatching: requiresSpecialization(kwargsParam.type),
                                    argument: {
                                        argCategory: ArgCategory.UnpackedDictionary,
                                        typeResult: { type: extraItemsType },
                                    },
                                    errorNode: argList[argIndex].valueExpression ?? errorNode,
                                    paramName: kwargsParam.param.name,
                                });
                            }
                        }

                        if (!diag.isEmpty()) {
                            if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                addDiagnostic(
                                    DiagnosticRule.reportCallIssue,
                                    LocMessage.unpackedTypedDictArgument() + diag.getString(),
                                    argList[argIndex].valueExpression || errorNode
                                );
                            }
                            reportedArgError = true;
                        }
                    } else if (paramSpec && isParamSpecKwargs(paramSpec, argType)) {
                        unpackedDictArgType = AnyType.create();

                        if (!paramSpecArgList) {
                            validateArgTypeParams.push({
                                paramCategory: ParamCategory.KwargsDict,
                                paramType: paramSpec,
                                requiresTypeVarMatching: false,
                                argument: argList[argIndex],
                                argType: isParamSpec(argType) ? undefined : AnyType.create(),
                                errorNode: argList[argIndex].valueExpression || errorNode,
                            });
                        }
                    } else {
                        const strObjType = getBuiltInObject(errorNode, 'str');

                        if (
                            prefetched?.supportsKeysAndGetItemClass &&
                            isInstantiableClass(prefetched.supportsKeysAndGetItemClass) &&
                            strObjType &&
                            isClassInstance(strObjType)
                        ) {
                            const mappingConstraints = new ConstraintTracker();
                            let isValidMappingType = false;

                            // If this was a TypeVar (e.g. for pseudo-generic classes),
                            // don't emit this error.
                            if (isTypeVar(argType)) {
                                isValidMappingType = true;
                            } else if (
                                assignType(
                                    ClassType.cloneAsInstance(prefetched.supportsKeysAndGetItemClass),
                                    argType,
                                    /* diag */ undefined,
                                    mappingConstraints
                                )
                            ) {
                                const specializedMapping = solveAndApplyConstraints(
                                    prefetched.supportsKeysAndGetItemClass,
                                    mappingConstraints
                                ) as ClassType;
                                const typeArgs = specializedMapping.priv.typeArgs;
                                if (typeArgs && typeArgs.length >= 2) {
                                    if (assignType(strObjType, typeArgs[0])) {
                                        isValidMappingType = true;
                                    }

                                    unpackedDictKeyNames = [];
                                    doForEachSubtype(typeArgs[0], (keyType) => {
                                        if (isClassInstance(keyType) && typeof keyType.priv.literalValue === 'string') {
                                            unpackedDictKeyNames?.push(keyType.priv.literalValue);
                                        } else {
                                            unpackedDictKeyNames = undefined;
                                        }
                                    });

                                    unpackedDictArgType = typeArgs[1];
                                } else {
                                    isValidMappingType = true;
                                    unpackedDictArgType = UnknownType.create();
                                }
                            }

                            unpackedArgOfUnknownLength = true;

                            if (paramDetails.kwargsIndex !== undefined && unpackedDictArgType) {
                                const paramType = paramDetails.params[paramDetails.kwargsIndex].type;
                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.Simple,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argType: unpackedDictArgType,
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramDetails.params[paramDetails.kwargsIndex].param.name,
                                });

                                unpackedArgMapsToVariadic = true;
                            }

                            if (!isValidMappingType) {
                                if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                    addDiagnostic(
                                        DiagnosticRule.reportCallIssue,
                                        LocMessage.unpackedDictArgumentNotMapping(),
                                        argList[argIndex].valueExpression || errorNode
                                    );
                                }
                                reportedArgError = true;
                            }
                        }
                    }

                    if (paramSpecArgList) {
                        paramSpecArgList.push(argList[argIndex]);
                    }
                } else {
                    // Protect against the case where a non-keyword argument appears after
                    // a keyword argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = argList[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.d.value;
                        const paramEntry = paramTracker.lookupName(paramNameValue);

                        if (paramEntry) {
                            if (paramEntry.argsReceived > 0) {
                                if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                    addDiagnostic(
                                        DiagnosticRule.reportCallIssue,
                                        LocMessage.paramAlreadyAssigned().format({ name: paramNameValue }),
                                        paramName
                                    );
                                }
                                reportedArgError = true;
                            } else {
                                paramEntry.argsReceived++;

                                const paramInfoIndex = paramDetails.params.findIndex(
                                    (paramInfo) =>
                                        paramInfo.param.name === paramNameValue &&
                                        paramInfo.kind !== ParamKind.Positional
                                );
                                assert(paramInfoIndex >= 0);
                                const paramType = paramDetails.params[paramInfoIndex].type;

                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.Simple,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression ?? errorNode,
                                    paramName: paramNameValue,
                                });
                                trySetActive(argList[argIndex], paramDetails.params[paramInfoIndex].param);
                            }
                        } else if (paramSpecArgList) {
                            paramSpecArgList.push(argList[argIndex]);
                        } else if (paramDetails.kwargsIndex !== undefined) {
                            const paramType = paramDetails.params[paramDetails.kwargsIndex].type;
                            if (isParamSpec(paramType)) {
                                if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                    addDiagnostic(
                                        DiagnosticRule.reportCallIssue,
                                        LocMessage.paramNameMissing().format({ name: paramName.d.value }),
                                        paramName
                                    );
                                }
                                reportedArgError = true;
                            } else {
                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.KwargsDict,
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression ?? errorNode,
                                    paramName: paramNameValue,
                                });

                                assert(
                                    paramDetails.params[paramDetails.kwargsIndex],
                                    'paramDetails.kwargsIndex params entry is undefined'
                                );

                                // Remember that this parameter has already received a value.
                                paramTracker.addKeywordParam(
                                    paramNameValue,
                                    paramDetails.params[paramDetails.kwargsIndex]
                                );
                            }
                            trySetActive(argList[argIndex], paramDetails.params[paramDetails.kwargsIndex].param);
                        } else {
                            if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                addDiagnostic(
                                    DiagnosticRule.reportCallIssue,
                                    LocMessage.paramNameMissing().format({ name: paramName.d.value }),
                                    paramName
                                );
                            }
                            reportedArgError = true;
                        }
                    } else if (argList[argIndex].argCategory === ArgCategory.Simple) {
                        if (paramSpecArgList) {
                            paramSpecArgList.push(argList[argIndex]);
                        } else {
                            if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                addDiagnostic(
                                    DiagnosticRule.reportCallIssue,
                                    positionParamLimitIndex === 1
                                        ? LocMessage.argPositionalExpectedOne()
                                        : LocMessage.argPositionalExpectedCount().format({
                                              expected: positionParamLimitIndex,
                                          }),
                                    argList[argIndex].valueExpression || errorNode
                                );
                            }
                            reportedArgError = true;
                        }
                    } else if (argList[argIndex].argCategory === ArgCategory.UnpackedList) {
                        // Handle the case where a *args: P.args (or *args: Any) is passed as an
                        // argument to a function that accepts a ParamSpec.
                        if (paramSpec) {
                            const argTypeResult = getTypeOfArg(argList[argIndex], /* inferenceContext */ undefined);
                            const argType = argTypeResult.type;

                            if (argTypeResult.isIncomplete) {
                                isTypeIncomplete = true;
                            }

                            if (isParamSpecArgs(paramSpec, argType)) {
                                validateArgTypeParams.push({
                                    paramCategory: ParamCategory.ArgsList,
                                    paramType: paramSpec,
                                    requiresTypeVarMatching: false,
                                    argument: argList[argIndex],
                                    argType: isParamSpec(argType) ? undefined : AnyType.create(),
                                    errorNode: argList[argIndex].valueExpression ?? errorNode,
                                });
                            }
                        }
                    }
                }

                argIndex++;
            }

            // If there are keyword-only parameters that haven't been matched but we
            // have an unpacked dictionary arg, assume that it applies to them.
            if (unpackedDictArgType && (!foundUnpackedListArg || paramDetails.argsIndex !== undefined)) {
                // Don't consider any position-only parameters, since they cannot be matched to
                // **kwargs arguments. Consider parameters that are either positional or keyword
                // if there is no *args argument.
                paramDetails.params.forEach((paramInfo, paramIndex) => {
                    const param = paramInfo.param;
                    if (
                        paramIndex >= paramDetails.firstPositionOrKeywordIndex &&
                        param.category === ParamCategory.Simple &&
                        param.name &&
                        paramTracker.lookupDetails(paramInfo).argsReceived === 0
                    ) {
                        const paramType = paramDetails.params[paramIndex].type;

                        if (!unpackedDictKeyNames || unpackedDictKeyNames.includes(param.name)) {
                            validateArgTypeParams.push({
                                paramCategory: ParamCategory.Simple,
                                paramType,
                                requiresTypeVarMatching: requiresSpecialization(paramType),
                                argument: {
                                    argCategory: ArgCategory.Simple,
                                    typeResult: { type: unpackedDictArgType! },
                                },
                                errorNode:
                                    argList.find((arg) => arg.argCategory === ArgCategory.UnpackedDictionary)
                                        ?.valueExpression ?? errorNode,
                                paramName: param.name,
                                isParamNameSynthesized: FunctionParam.isNameSynthesized(param),
                            });

                            paramTracker.markArgReceived(paramDetails.params[paramIndex]);
                        }
                    }
                });
            }

            // Determine whether there are any parameters that require arguments
            // but have not yet received them. If we received a dictionary argument
            // (i.e. an arg starting with a "**"), we will assume that all parameters
            // are matched.
            if (!unpackedDictArgType && !FunctionType.isDefaultParamCheckDisabled(overload)) {
                const unassignedParams = paramTracker.getUnassignedParams();

                if (unassignedParams.length > 0) {
                    if (!canSkipDiagnosticForNode(errorNode)) {
                        const missingParamNames = unassignedParams.map((p) => `"${p}"`).join(', ');
                        if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                            addDiagnostic(
                                DiagnosticRule.reportCallIssue,
                                unassignedParams.length === 1
                                    ? LocMessage.argMissingForParam().format({ name: missingParamNames })
                                    : LocMessage.argMissingForParams().format({ names: missingParamNames }),
                                errorNode
                            );
                        }
                    }
                    reportedArgError = true;
                }

                // Add any implicit (default) arguments that are needed for resolving
                // generic types. For example, if the function is defined as
                // def foo(v1: _T = 'default')
                // and _T is a TypeVar, we need to match the TypeVar to the default
                // value's type if it's not provided by the caller.
                paramDetails.params.forEach((paramInfo) => {
                    const param = paramInfo.param;
                    if (param.category === ParamCategory.Simple && param.name) {
                        const entry = paramTracker.lookupDetails(paramInfo);

                        if (entry.argsNeeded === 0 && entry.argsReceived === 0) {
                            const defaultArgType = paramInfo.defaultType;

                            if (
                                defaultArgType &&
                                !isEllipsisType(defaultArgType) &&
                                requiresSpecialization(paramInfo.declaredType, { ignorePseudoGeneric: true })
                            ) {
                                validateArgTypeParams.push({
                                    paramCategory: param.category,
                                    paramType: paramInfo.type,
                                    requiresTypeVarMatching: true,
                                    argument: {
                                        argCategory: ArgCategory.Simple,
                                        typeResult: { type: defaultArgType },
                                    },
                                    isDefaultArg: true,
                                    errorNode,
                                    paramName: param.name,
                                    isParamNameSynthesized: FunctionParam.isNameSynthesized(param),
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
        if (!reportedArgError || !isSpeculativeModeInUse(undefined)) {
            // If there are arguments that map to a variadic *args parameter that hasn't
            // already been matched, see if the type of that *args parameter is a
            // TypeVarTuple. If so, we'll preprocess those arguments and combine them
            // into a tuple.
            assert(
                paramDetails.argsIndex === undefined || paramDetails.argsIndex < paramDetails.params.length,
                'paramDetails.argsIndex params entry is invalid'
            );
            if (
                paramDetails.argsIndex !== undefined &&
                paramDetails.argsIndex >= 0 &&
                FunctionParam.isTypeDeclared(paramDetails.params[paramDetails.argsIndex].param) &&
                !isTypeVarTupleFullyMatched
            ) {
                const paramType = paramDetails.params[paramDetails.argsIndex].type;
                const variadicArgs = validateArgTypeParams.filter((argParam) => argParam.mapsToVarArgList);

                if (isUnpacked(paramType) && (!isTypeVarTuple(paramType) || !paramType.priv.isInUnion)) {
                    const tupleTypeArgs: TupleTypeArg[] = variadicArgs.map((argParam) => {
                        const argType = getTypeOfArg(argParam.argument, /* inferenceContext */ undefined).type;

                        const containsTypeVarTuple =
                            isUnpackedTypeVarTuple(argType) ||
                            (isClassInstance(argType) &&
                                isTupleClass(argType) &&
                                argType.priv.tupleTypeArgs &&
                                argType.priv.tupleTypeArgs.length === 1 &&
                                isUnpackedTypeVarTuple(argType.priv.tupleTypeArgs[0].type));

                        if (
                            containsTypeVarTuple &&
                            argParam.argument.argCategory !== ArgCategory.UnpackedList &&
                            !argParam.mapsToVarArgList
                        ) {
                            if (!canSkipDiagnosticForNode(errorNode) && !isTypeIncomplete) {
                                addDiagnostic(
                                    DiagnosticRule.reportCallIssue,
                                    LocMessage.typeVarTupleMustBeUnpacked(),
                                    argParam.argument.valueExpression ?? errorNode
                                );
                            }
                            reportedArgError = true;
                        }

                        return {
                            type: argType,
                            isUnbounded: argParam.argument.argCategory === ArgCategory.UnpackedList,
                        };
                    });

                    let specializedTuple: Type | undefined;
                    if (tupleTypeArgs.length === 1 && !tupleTypeArgs[0].isUnbounded) {
                        const entryType = tupleTypeArgs[0].type;

                        if (isUnpacked(entryType)) {
                            specializedTuple = makePacked(entryType);
                        }
                    }

                    if (!specializedTuple) {
                        specializedTuple = makeTupleObject(evaluatorInterface, tupleTypeArgs, /* isUnpacked */ false);
                    }

                    const combinedArg: ValidateArgTypeParams = {
                        paramCategory: ParamCategory.Simple,
                        paramType: makePacked(paramType),
                        requiresTypeVarMatching: true,
                        argument: {
                            argCategory: ArgCategory.Simple,
                            typeResult: { type: specializedTuple },
                        },
                        errorNode,
                        paramName: paramDetails.params[paramDetails.argsIndex].param.name,
                        isParamNameSynthesized: FunctionParam.isNameSynthesized(
                            paramDetails.params[paramDetails.argsIndex].param
                        ),
                        mapsToVarArgList: true,
                    };

                    validateArgTypeParams = [
                        ...validateArgTypeParams.filter((argParam) => !argParam.mapsToVarArgList),
                        combinedArg,
                    ];
                }
            }
        }

        // Special-case the builtin isinstance and issubclass functions.
        if (FunctionType.isBuiltIn(overload, ['isinstance', 'issubclass']) && validateArgTypeParams.length === 2) {
            validateArgTypeParams[1].isinstanceParam = true;
        }

        return {
            overload,
            overloadIndex,
            argumentErrors: reportedArgError,
            isTypeIncomplete,
            argParams: validateArgTypeParams,
            unexpandedArgList,
            paramSpecTarget,
            paramSpecArgList,
            activeParam,
            unpackedArgOfUnknownLength,
            unpackedArgMapsToVariadic,
            argumentMatchScore: 0,
        };
    }

    // After having matched arguments with parameters, this function evaluates the
    // types of each argument expression and validates that the resulting type is
    // compatible with the declared type of the corresponding parameter.
    function validateArgTypesWithContext(
        errorNode: ExpressionNode,
        matchResults: MatchArgsToParamsResult,
        constraints: ConstraintTracker,
        skipUnknownArgCheck = false,
        inferenceContext: InferenceContext | undefined
    ): CallResult {
        const type = matchResults.overload;

        let expectedType: Type | undefined = inferenceContext?.expectedType;

        // Can we safely ignore the inference context, either because it's not provided
        // or will have no effect? If so, avoid the extra work.
        const returnType = inferenceContext?.returnTypeOverride ?? getEffectiveReturnType(type);
        if (!returnType || !requiresSpecialization(returnType)) {
            expectedType = undefined;
        }

        const tryExpectedType = (expectedSubtype: Type): number => {
            const clonedConstraints = constraints.clone();
            const callResult = validateArgTypesWithExpectedType(
                errorNode,
                matchResults,
                clonedConstraints,
                /* skipUnknownArgCheck */ true,
                expectedSubtype,
                returnType
            );

            // Use a heuristic to pick a subtype that is most likely to be correct.
            // We'll look for a subtype that produces no argument errors and has
            // no Unknowns in the return type.
            if (!callResult.argumentErrors && callResult.returnType) {
                const returnType = inferenceContext?.returnTypeOverride
                    ? solveAndApplyConstraints(inferenceContext.returnTypeOverride, clonedConstraints)
                    : callResult.returnType;

                if (
                    assignType(
                        expectedSubtype,
                        returnType,
                        /* diag */ undefined,
                        /* constraints */ undefined,
                        AssignTypeFlags.Default
                    )
                ) {
                    const anyOrUnknown = containsAnyOrUnknown(callResult.returnType, /* recurse */ true);
                    // Prefer return types that have no unknown or Any.
                    if (!anyOrUnknown) {
                        return 3;
                    }

                    // Prefer Any over Unknown.
                    return isAny(anyOrUnknown) ? 2 : 1;
                }
            }

            return 0;
        };

        // Refine the expected type by speculatively evaluating arg types. If the
        // expected type is a union, we may need to perform multiple evaluations
        // to determine whether one of the subtypes works.
        if (expectedType) {
            expectedType = useSpeculativeMode(getSpeculativeNodeForCall(errorNode), () => {
                let validExpectedSubtype: Type | undefined;
                let bestSubtypeScore = -1;

                // If the expected type is a union, we don't know which type is expected.
                // We may or may not be able to make use of the expected type. We'll evaluate
                // speculatively to see if using one of the expected subtypes works.
                if (isUnion(expectedType!)) {
                    doForEachSubtype(
                        expectedType!,
                        (expectedSubtype) => {
                            if (bestSubtypeScore < 3) {
                                const score = tryExpectedType(expectedSubtype);
                                if (score > 0 && score > bestSubtypeScore) {
                                    validExpectedSubtype = expectedSubtype;
                                    bestSubtypeScore = score;
                                }
                            }
                        },
                        /* sortSubtypes */ true
                    );
                }

                if (bestSubtypeScore < 3) {
                    const score = tryExpectedType(expectedType!);
                    if (score > 0 && score > bestSubtypeScore) {
                        validExpectedSubtype = expectedType;
                    }
                }

                return validExpectedSubtype;
            });
        }

        // If there is no expected type, or the expected type is Any or Unknown,
        // there's nothing left to do here.
        if (!expectedType || isAnyOrUnknown(expectedType) || isNever(expectedType)) {
            return validateArgTypes(errorNode, matchResults, constraints, skipUnknownArgCheck);
        }

        return validateArgTypesWithExpectedType(
            errorNode,
            matchResults,
            constraints,
            skipUnknownArgCheck,
            expectedType,
            returnType
        );
    }

    function validateArgTypesWithExpectedType(
        errorNode: ExpressionNode,
        matchResults: MatchArgsToParamsResult,
        constraints: ConstraintTracker,
        skipUnknownArgCheck = false,
        expectedType: Type,
        returnType: Type
    ): CallResult {
        const liveTypeVarScopes = getTypeVarScopesForNode(errorNode);
        let assignFlags = AssignTypeFlags.PopulateExpectedType;
        if (containsLiteralType(expectedType, /* includeTypeArgs */ true)) {
            assignFlags |= AssignTypeFlags.RetainLiteralsForTypeVar;
        }

        // Prepopulate the constraints based on the specialized expected type.
        // This will allow us to more closely match the expected type if possible.
        if (isClassInstance(returnType) && isClassInstance(expectedType) && !isTypeSame(returnType, expectedType)) {
            const tempConstraints = new ConstraintTracker();
            if (
                addConstraintsForExpectedType(
                    evaluatorInterface,
                    returnType,
                    expectedType,
                    tempConstraints,
                    liveTypeVarScopes,
                    errorNode.start
                )
            ) {
                const genericReturnType = selfSpecializeClass(returnType, {
                    overrideTypeArgs: true,
                });

                expectedType = solveAndApplyConstraints(genericReturnType, tempConstraints, {
                    replaceUnsolved: {
                        scopeIds: getTypeVarScopeIds(returnType),
                        useUnknown: true,
                        tupleClassType: getTupleClassType(),
                    },
                });

                assignFlags |= AssignTypeFlags.SkipPopulateUnknownExpectedType;
            }
        }

        expectedType = transformExpectedType(expectedType, liveTypeVarScopes, errorNode.start);

        assignType(returnType, expectedType, /* diag */ undefined, constraints, assignFlags);

        return validateArgTypes(errorNode, matchResults, constraints, skipUnknownArgCheck);
    }

    function validateArgTypes(
        errorNode: ExpressionNode,
        matchResults: MatchArgsToParamsResult,
        constraints: ConstraintTracker,
        skipUnknownArgCheck: boolean | undefined
    ): CallResult {
        const type = matchResults.overload;
        let isTypeIncomplete = matchResults.isTypeIncomplete;
        let argumentErrors = false;
        let argumentMatchScore = 0;
        let specializedInitSelfType: Type | undefined;
        let anyOrUnknownArg: UnknownType | AnyType | undefined;
        const speculativeNode = getSpeculativeNodeForCall(errorNode);
        const typeCondition = getTypeCondition(type);
        const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);

        // Check for an attempt to invoke an unimplemented abstract method.
        if (type.priv.boundToType && !type.priv.boundToType.priv.includeSubclasses && type.shared.methodClass) {
            const abstractSymbolInfo = getAbstractSymbolInfo(type.shared.methodClass, type.shared.name);

            if (abstractSymbolInfo && !abstractSymbolInfo.hasImplementation) {
                addDiagnostic(
                    DiagnosticRule.reportAbstractUsage,
                    LocMessage.abstractMethodInvocation().format({
                        method: type.shared.name,
                    }),
                    errorNode.nodeType === ParseNodeType.Call ? errorNode.d.leftExpr : errorNode
                );
            }
        }

        // The type annotation for the "self" parameter in an __init__ method to
        // can influence the type being constructed.
        if (
            type.shared.name === '__init__' &&
            type.priv.strippedFirstParamType &&
            type.priv.boundToType &&
            isClassInstance(type.priv.strippedFirstParamType) &&
            isClassInstance(type.priv.boundToType) &&
            ClassType.isSameGenericClass(type.priv.strippedFirstParamType, type.priv.boundToType) &&
            type.priv.strippedFirstParamType.priv.typeArgs
        ) {
            const typeParams = type.priv.strippedFirstParamType.shared.typeParams;
            specializedInitSelfType = type.priv.strippedFirstParamType;
            type.priv.strippedFirstParamType.priv.typeArgs.forEach((typeArg, index) => {
                if (index < typeParams.length) {
                    const typeParam = typeParams[index];
                    if (!isTypeSame(typeParam, typeArg, { ignorePseudoGeneric: true })) {
                        constraints.setBounds(typeParams[index], typeArg);
                    }
                }
            });
        }

        // Special-case a few built-in calls that are often used for
        // casting or checking for unknown types.
        if (
            FunctionType.isBuiltIn(type, [
                'typing.cast',
                'typing_extensions.cast',
                'builtins.isinstance',
                'builtins.issubclass',
            ])
        ) {
            skipUnknownArgCheck = true;
        }

        // Run through all args and validate them against their matched parameter.
        // We'll do two phases. The first one establishes constraints for type
        // variables. The second perform type validation using the solved
        // types. We can skip the first pass if there are no type vars to solve.
        const typeVarCount = matchResults.argParams.filter((arg) => arg.requiresTypeVarMatching).length;
        if (typeVarCount > 0) {
            // Do up to two passes.
            let passCount = Math.min(typeVarCount, 2);

            for (let i = 0; i < passCount; i++) {
                useSpeculativeMode(speculativeNode, () => {
                    matchResults.argParams.forEach((argParam) => {
                        if (!argParam.requiresTypeVarMatching) {
                            return;
                        }

                        const argResult = validateArgType(
                            argParam,
                            constraints,
                            { type, isIncomplete: matchResults.isTypeIncomplete },
                            {
                                skipUnknownArgCheck,
                                isArgFirstPass: passCount > 1 && i === 0,
                                conditionFilter: typeCondition,
                                skipReportError: true,
                            }
                        );

                        if (argResult.isTypeIncomplete) {
                            isTypeIncomplete = true;
                        }

                        // If we skipped a bare type var during the first pass, add
                        // another pass to ensure that we handle all of the type variables.
                        if (i === 0 && passCount < 2 && argResult.skippedBareTypeVarExpectedType) {
                            passCount++;
                        }
                    });
                });
            }
        }

        let sawParamSpecArgs = false;
        let sawParamSpecKwargs = false;

        let condition: TypeCondition[] = [];
        const argResults: ArgResult[] = [];

        matchResults.argParams.forEach((argParam, argParamIndex) => {
            const argResult = validateArgType(
                argParam,
                constraints,
                { type, isIncomplete: matchResults.isTypeIncomplete },
                {
                    skipUnknownArgCheck,
                    conditionFilter: typeCondition,
                }
            );

            argResults.push(argResult);

            if (!argResult.isCompatible) {
                argumentErrors = true;

                // Add the inverse index so earlier parameters represent larger errors.
                // This will help the heuristics in the overload error paths to pick the
                // most likely intended overload if none of them match.
                argumentMatchScore += 1 + (matchResults.argParams.length - argParamIndex);
            }

            if (argResult.isTypeIncomplete) {
                isTypeIncomplete = true;
            }

            if (argResult.condition) {
                condition = TypeCondition.combine(condition, argResult.condition) ?? [];
            }

            if (isAnyOrUnknown(argResult.argType)) {
                anyOrUnknownArg = anyOrUnknownArg
                    ? preserveUnknown(argResult.argType, anyOrUnknownArg)
                    : argResult.argType;
            }

            if (paramSpec) {
                if (argParam.argument.argCategory === ArgCategory.UnpackedList) {
                    if (isParamSpecArgs(paramSpec, argResult.argType)) {
                        if (sawParamSpecArgs) {
                            addDiagnostic(
                                DiagnosticRule.reportCallIssue,
                                LocMessage.paramSpecArgsKwargsDuplicate().format({ type: printType(paramSpec) }),
                                argParam.errorNode
                            );
                        }

                        sawParamSpecArgs = true;
                    }
                }

                if (argParam.argument.argCategory === ArgCategory.UnpackedDictionary) {
                    if (isParamSpecKwargs(paramSpec, argResult.argType)) {
                        if (sawParamSpecKwargs) {
                            addDiagnostic(
                                DiagnosticRule.reportCallIssue,
                                LocMessage.paramSpecArgsKwargsDuplicate().format({ type: printType(paramSpec) }),
                                argParam.errorNode
                            );
                        }

                        sawParamSpecKwargs = true;
                    }
                }
            }
        });

        let paramSpecConstraints: (ConstraintTracker | undefined)[] = [];

        // Handle the assignment of additional arguments that map to a param spec.
        if (matchResults.paramSpecArgList && matchResults.paramSpecTarget) {
            const paramSpecArgResult = validateArgTypesForParamSpec(
                errorNode,
                matchResults.paramSpecArgList,
                matchResults.paramSpecTarget,
                constraints
            );

            if (paramSpecArgResult.argumentErrors) {
                argumentErrors = true;
                argumentMatchScore += 1;
            }

            paramSpecConstraints = paramSpecArgResult.constraintTrackers;
        } else if (paramSpec) {
            if (!sawParamSpecArgs || !sawParamSpecKwargs) {
                if (!isTypeIncomplete) {
                    addDiagnostic(
                        DiagnosticRule.reportCallIssue,
                        LocMessage.paramSpecArgsMissing().format({ type: printType(paramSpec) }),
                        errorNode
                    );
                }
                argumentErrors = true;
                argumentMatchScore += 1;
            }
        }

        // Calculate the return type.
        const returnTypeResult = getEffectiveReturnTypeResult(type, {
            callSiteInfo: { args: matchResults.argParams, errorNode },
        });
        let returnType = returnTypeResult.type;
        if (returnTypeResult.isIncomplete) {
            isTypeIncomplete = true;
        }

        if (condition.length > 0) {
            returnType = TypeBase.cloneForCondition(returnType, condition);
        }

        let eliminateUnsolvedInUnions = true;

        // If the function is returning a callable, don't eliminate unsolved
        // type vars within a union. There are legit uses for unsolved type vars
        // within a callable.
        if (isFunctionOrOverloaded(returnType)) {
            eliminateUnsolvedInUnions = false;
        }

        let specializedReturnType = solveAndApplyConstraints(returnType, constraints, {
            replaceUnsolved: {
                scopeIds: getTypeVarScopeIds(type),
                unsolvedExemptTypeVars: getUnknownExemptTypeVarsForReturnType(type, returnType),
                tupleClassType: getTupleClassType(),
                eliminateUnsolvedInUnions,
            },
        });
        specializedReturnType = addConditionToType(specializedReturnType, typeCondition, { skipBoundTypeVars: true });

        // If the function includes a ParamSpec and the captured signature(s) includes
        // generic types, we may need to apply those solved TypeVars.
        if (paramSpecConstraints.length > 0) {
            paramSpecConstraints.forEach((paramSpecConstraints) => {
                if (paramSpecConstraints) {
                    specializedReturnType = solveAndApplyConstraints(specializedReturnType, paramSpecConstraints);

                    // It's possible that one or more of the TypeVars or ParamSpecs
                    // in the constraints refer to TypeVars that were solved in
                    // the paramSpecConstraints. Apply these solved TypeVars accordingly.
                    applySourceSolutionToConstraints(
                        constraints,
                        solveConstraints(evaluatorInterface, paramSpecConstraints)
                    );
                }
            });
        }

        // If the final return type is an unpacked tuple, turn it into a normal (unpacked) tuple.
        if (isUnpackedClass(specializedReturnType)) {
            specializedReturnType = ClassType.cloneForPacked(specializedReturnType);
        }

        const liveTypeVarScopes = getTypeVarScopesForNode(errorNode);
        specializedReturnType = adjustCallableReturnType(errorNode, specializedReturnType, liveTypeVarScopes);

        if (specializedInitSelfType) {
            specializedInitSelfType = solveAndApplyConstraints(specializedInitSelfType, constraints);
        }

        matchResults.argumentMatchScore = argumentMatchScore;

        if (!argumentErrors && isIntFlagBitwiseFunction(type)) {
            const transformed = applyIntFlagCallTransform(errorNode, matchResults, argResults, {
                argumentErrors,
                returnType: specializedReturnType,
                isTypeIncomplete,
            });
            specializedReturnType = transformed.returnType;
            isTypeIncomplete = transformed.isTypeIncomplete;
        }

        return {
            argumentErrors,
            argResults,
            anyOrUnknownArg,
            returnType: specializedReturnType,
            isTypeIncomplete,
            activeParam: matchResults.activeParam,
            specializedInitSelfType,
            overloadsUsedForCall: argumentErrors ? [] : [type],
        };
    }

    function applyIntFlagCallTransform(
        errorNode: ExpressionNode,
        matchResults: MatchArgsToParamsResult,
        argResults: ArgResult[],
        result: FunctionResult
    ): FunctionResult {
        const argumentTypes = new Map<string, Type>();
        matchResults.argParams.forEach((param, index) => {
            if (param.paramName) {
                argumentTypes.set(param.paramName, argResults[index].argType);
            }
        });
        result = applyIntFlagTransform(evaluatorInterface, matchResults.overload, argumentTypes, result);

        const argList = matchResults.unexpandedArgList;
        if (!argList?.some((arg) => arg.argCategory !== ArgCategory.Simple)) {
            return result;
        }

        // Keep correlated packed alternatives together rather than treating their
        // independently combined parameter types as a Cartesian product.
        const contextFreeArgTypes = argList.map((arg) =>
            arg.argCategory === ArgCategory.Simple
                ? UnknownType.create()
                : getTypeOfArg(arg, /* inferenceContext */ undefined).type
        );
        let expandedArgTypes: (Type | undefined)[][] = [argList.map(() => undefined)];
        while (true) {
            const expanded = expressionEvaluation.expandArgTypes(contextFreeArgTypes, expandedArgTypes);
            if (!expanded) {
                break;
            }
            if (expanded.length > maxTotalOverloadArgTypeExpansionCount) {
                return result;
            }
            expandedArgTypes = expanded;
        }
        if (expandedArgTypes.length === 1) {
            return result;
        }

        const returnTypes: Type[] = [];
        let isTypeIncomplete = result.isTypeIncomplete;
        for (const expandedTypes of expandedArgTypes) {
            const expandedArgs = argList.map((arg, index): Arg => {
                const type = expandedTypes[index];
                return type
                    ? {
                          ...arg,
                          valueExpression: undefined,
                          typeResult: { type, isIncomplete: result.isTypeIncomplete },
                      }
                    : arg;
            });
            const expandedMatch = useSpeculativeMode(getSpeculativeNodeForCall(errorNode), () =>
                matchArgsToParams(
                    errorNode,
                    expandedArgs,
                    { type: matchResults.overload, isIncomplete: result.isTypeIncomplete },
                    matchResults.overloadIndex
                )
            );
            isTypeIncomplete ||= expandedMatch.isTypeIncomplete;
            if (expandedMatch.argumentErrors) {
                return { ...result, isTypeIncomplete };
            }

            const expandedArgumentTypes = new Map(argumentTypes);
            expandedMatch.argParams.forEach((param) => {
                const type = param.argType ?? param.argument.typeResult?.type;
                if (param.paramName && type) {
                    expandedArgumentTypes.set(param.paramName, type);
                }
            });
            returnTypes.push(
                applyIntFlagTransform(evaluatorInterface, matchResults.overload, expandedArgumentTypes, result)
                    .returnType
            );
        }
        return { ...result, returnType: combineTypes(returnTypes), isTypeIncomplete };
    }

    // In general, all in-scope type variables left in a return type should be
    // replaced with Unknown. However, if the return type is a callable that uses
    // type vars that are found nowhere within the function's input parameters,
    // we'll treat these as though they're scoped to the callable and leave them
    // unsolved.
    function getUnknownExemptTypeVarsForReturnType(functionType: FunctionType, returnType: Type): TypeVarType[] {
        return typeVarHandling.getUnknownExemptTypeVarsForReturnType(functionType, returnType);
    }

    // If the return type includes a generic Callable type, set the type var
    // scope to the scope of the function it was originally associated with
    // to allow these type vars to be solved. This won't work with overloads
    // or unions of callables. It's intended for a specific use case. We may
    // need to make this more sophisticated in the future.
    function adjustCallableReturnType(
        callNode: ExpressionNode,
        returnType: Type,
        liveTypeVarScopes: TypeVarScopeId[]
    ): Type {
        return evaluatorCore.adjustCallableReturnType(callNode, returnType, liveTypeVarScopes);
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    function validateArgs(
        errorNode: ExpressionNode,
        argList: Arg[],
        typeResult: TypeResult<FunctionType>,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck = false,
        inferenceContext: InferenceContext | undefined
    ): CallResult {
        const matchResults = matchArgsToParams(errorNode, argList, typeResult, 0);

        if (matchResults.argumentErrors) {
            // Evaluate types of all args. This will ensure that referenced symbols are
            // not reported as unaccessed. Also pass the expected parameter type as
            // inference context to enable proper completions even when there are errors.
            matchResults.argParams.forEach((argParam) => {
                if (argParam.argument.valueExpression && !isSpeculativeModeInUse(argParam.argument.valueExpression)) {
                    getTypeOfExpression(
                        argParam.argument.valueExpression,
                        /* flags */ undefined,
                        makeInferenceContext(argParam.paramType)
                    );
                }
            });

            // Also evaluate any arguments that weren't matched to parameters
            argList.forEach((arg) => {
                if (arg.valueExpression && !isSpeculativeModeInUse(arg.valueExpression)) {
                    // Check if this argument was already evaluated above
                    const wasEvaluated = matchResults.argParams.some((argParam) => argParam.argument === arg);
                    if (!wasEvaluated) {
                        getTypeOfExpression(arg.valueExpression);
                    }
                }
            });
            // Use a return type of Unknown but attach a "possible type" to it
            // so the completion provider can suggest better completions.
            const possibleType = FunctionType.getEffectiveReturnType(typeResult.type);
            return {
                returnType:
                    possibleType && !isAnyOrUnknown(possibleType)
                        ? UnknownType.createPossibleType(possibleType, /* isIncomplete */ false)
                        : undefined,
                argumentErrors: true,
                activeParam: matchResults.activeParam,
                overloadsUsedForCall: [],
            };
        }

        return validateArgTypesWithContext(
            errorNode,
            matchResults,
            constraints ?? new ConstraintTracker(),
            skipUnknownArgCheck,
            makeInferenceContext(
                inferenceContext?.expectedType,
                inferenceContext?.isTypeIncomplete,
                inferenceContext?.returnTypeOverride
            )
        );
    }

    // Determines whether the specified argument list satisfies the function
    // signature bound to the specified ParamSpec. Return value indicates success.
    function validateArgTypesForParamSpec(
        errorNode: ExpressionNode,
        argList: Arg[],
        paramSpec: ParamSpecType,
        destConstraints: ConstraintTracker
    ): ParamSpecArgResult {
        const sets = destConstraints.getConstraintSets();

        // Handle the common case where there is only one signature context.
        if (sets.length === 1) {
            return validateArgTypesForParamSpecSignature(errorNode, argList, paramSpec, sets[0]);
        }

        const filteredSets: ConstraintSet[] = [];
        const constraintTrackers: (ConstraintTracker | undefined)[] = [];
        const speculativeNode = getSpeculativeNodeForCall(errorNode);

        sets.forEach((context) => {
            // Use speculative mode to avoid emitting errors or caching types.
            useSpeculativeMode(speculativeNode, () => {
                const paramSpecArgResult = validateArgTypesForParamSpecSignature(
                    errorNode,
                    argList,
                    paramSpec,
                    context
                );

                if (!paramSpecArgResult.argumentErrors) {
                    filteredSets.push(context);
                }

                appendArray(constraintTrackers, paramSpecArgResult.constraintTrackers);
            });
        });

        // Copy back any compatible signature contexts if any were compatible.
        if (filteredSets.length > 0) {
            destConstraints.addConstraintSets(filteredSets);
        }

        // Evaluate non-speculatively to produce a final result and cache types.
        const paramSpecArgResult = validateArgTypesForParamSpecSignature(
            errorNode,
            argList,
            paramSpec,
            filteredSets.length > 0 ? filteredSets[0] : sets[0]
        );

        return { argumentErrors: paramSpecArgResult.argumentErrors, constraintTrackers: constraintTrackers };
    }

    function validateArgTypesForParamSpecSignature(
        errorNode: ExpressionNode,
        argList: Arg[],
        paramSpec: ParamSpecType,
        constraintSet: ConstraintSet
    ): ParamSpecArgResult {
        const solutionSet = solveConstraintSet(evaluatorInterface, constraintSet);
        let paramSpecType = solutionSet.getType(paramSpec);
        paramSpecType = convertTypeToParamSpecValue(paramSpecType ?? paramSpec);

        const matchResults = matchArgsToParams(errorNode, argList, { type: paramSpecType }, 0);
        const functionType = matchResults.overload;
        const constraints = new ConstraintTracker();

        if (matchResults.argumentErrors) {
            // Evaluate types of all args. This will ensure that referenced symbols are
            // not reported as unaccessed.
            argList.forEach((arg) => {
                if (arg.valueExpression && !isSpeculativeModeInUse(arg.valueExpression)) {
                    getTypeOfExpression(arg.valueExpression);
                }
            });

            return { argumentErrors: true, constraintTrackers: [constraints] };
        }

        const functionParamSpec = FunctionType.getParamSpecFromArgsKwargs(functionType);
        const functionWithoutParamSpec = FunctionType.cloneRemoveParamSpecArgsKwargs(functionType);

        // Handle the recursive case where we're passing (*args: P.args, **kwargs: P.args)
        // a remaining function of type (*P).
        if (
            functionParamSpec &&
            functionWithoutParamSpec.shared.parameters.length === 0 &&
            isTypeSame(functionParamSpec, paramSpec)
        ) {
            // If there are any arguments other than *args: P.args or **kwargs: P.kwargs,
            // report an error.
            let argsCount = 0;
            let kwargsCount = 0;
            let argumentErrors = false;
            let argErrorNode: ExpressionNode | undefined;

            for (const arg of argList) {
                const argType = getTypeOfArg(arg, /* inferenceContext */ undefined)?.type;

                if (arg.argCategory === ArgCategory.UnpackedList) {
                    if (isParamSpecArgs(paramSpec, argType)) {
                        argsCount++;
                    }
                } else if (arg.argCategory === ArgCategory.UnpackedDictionary) {
                    if (isParamSpecKwargs(paramSpec, argType)) {
                        kwargsCount++;
                    }
                } else {
                    argErrorNode = argErrorNode ?? arg.valueExpression;
                    argumentErrors = true;
                }
            }

            if (argsCount !== 1 || kwargsCount !== 1) {
                argumentErrors = true;
            }

            if (argumentErrors) {
                addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.paramSpecArgsMissing().format({
                        type: printType(functionParamSpec),
                    }),
                    argErrorNode ?? errorNode
                );
            }

            return { argumentErrors, constraintTrackers: [constraints] };
        }

        const result = validateArgTypes(errorNode, matchResults, constraints, /* skipUnknownArgCheck */ undefined);
        return { argumentErrors: !!result.argumentErrors, constraintTrackers: [constraints] };
    }

    function validateArgType(
        argParam: ValidateArgTypeParams,
        constraints: ConstraintTracker,
        typeResult: TypeResult<FunctionType> | undefined,
        options: ValidateArgTypeOptions
    ): ArgResult {
        let argType: Type | undefined;
        let expectedTypeDiag: DiagnosticAddendum | undefined;
        let isTypeIncomplete = !!typeResult?.isIncomplete;
        let isCompatible = true;
        const functionName = typeResult?.type.shared.name;
        let skippedBareTypeVarExpectedType = false;

        if (argParam.argument.valueExpression) {
            let expectedType: Type | undefined;

            // Is the expected type a "bare" in-scope TypeVar or a union of bare in-scope TypeVars?
            let isExpectedTypeBareTypeVar = true;
            doForEachSubtype(argParam.paramType, (subtype) => {
                if (!isTypeVar(subtype) || subtype.priv.scopeId !== typeResult?.type.shared.typeVarScopeId) {
                    isExpectedTypeBareTypeVar = false;
                }
            });

            if (!options.isArgFirstPass || !isExpectedTypeBareTypeVar) {
                expectedType = argParam.paramType;

                // If the parameter type is a function with a ParamSpec, don't apply
                // the solved TypeVars if the constraint tracker has more than one signature.
                // This will expand the ParamSpec into an overload, which will cause problems.
                const skipApplySolvedTypeVars =
                    isFunction(argParam.paramType) &&
                    FunctionType.getParamSpecFromArgsKwargs(argParam.paramType) &&
                    constraints.getConstraintSets().length > 1;

                if (!skipApplySolvedTypeVars) {
                    expectedType = solveAndApplyConstraints(expectedType, constraints, /* applyOptions */ undefined, {
                        useLowerBoundOnly: !!options.isArgFirstPass,
                    });
                }
            } else {
                skippedBareTypeVarExpectedType = true;
            }

            // If the expected type is unknown, don't use an expected type. Instead,
            // use default rules for evaluating the expression type.
            if (expectedType && isUnknown(expectedType)) {
                expectedType = undefined;
            }

            // Was the argument's type precomputed by the caller?
            if (argParam.argType) {
                argType = argParam.argType;
            } else {
                const flags = argParam.isinstanceParam
                    ? EvalFlags.IsInstanceArgDefaults
                    : EvalFlags.NoFinal | EvalFlags.NoSpecialize;
                const exprTypeResult = getTypeOfExpression(
                    argParam.argument.valueExpression,
                    flags,
                    makeInferenceContext(expectedType, !!typeResult?.isIncomplete)
                );

                argType = exprTypeResult.type;

                // If the argument is unpacked and we are supposed to enforce
                // that it's an iterator, do so now.
                if (argParam.argument.argCategory === ArgCategory.UnpackedList && argParam.argument.enforceIterable) {
                    const iteratorType = getTypeOfIterator(
                        exprTypeResult,
                        /* isAsync */ false,
                        argParam.argument.valueExpression
                    );
                    // Try to prevent cascading errors if it was not iterable.
                    argType = iteratorType?.type ?? UnknownType.create();
                }

                if (exprTypeResult.isIncomplete) {
                    isTypeIncomplete = true;
                }

                if (expectedType && requiresSpecialization(expectedType)) {
                    // Assign the argument type back to the expected type to assign
                    // values to any unification variables.
                    const clonedConstraints = constraints.clone();
                    if (
                        assignType(
                            expectedType,
                            argType,
                            /* diag */ undefined,
                            clonedConstraints,
                            options?.isArgFirstPass ? AssignTypeFlags.ArgAssignmentFirstPass : AssignTypeFlags.Default
                        )
                    ) {
                        constraints.copyFromClone(clonedConstraints);
                    } else {
                        isCompatible = false;
                    }
                }

                expectedTypeDiag = exprTypeResult.expectedTypeDiagAddendum;
            }

            if (argParam.argument && argParam.argument.name && !isSpeculativeModeInUse(argParam.errorNode)) {
                writeTypeCache(
                    argParam.argument.name,
                    { type: expectedType ?? argType, isIncomplete: isTypeIncomplete },
                    EvalFlags.None
                );
            }
        } else {
            // Was the argument's type precomputed by the caller?
            if (argParam.argType) {
                argType = argParam.argType;
            } else {
                const argTypeResult = getTypeOfArg(
                    argParam.argument,
                    makeInferenceContext(argParam.paramType, isTypeIncomplete)
                );
                argType = argTypeResult.type;
                if (argTypeResult.isIncomplete) {
                    isTypeIncomplete = true;
                }
            }

            // If the argument came from a parameter's default argument value,
            // we may need to specialize the type.
            if (argParam.isDefaultArg) {
                argType = solveAndApplyConstraints(argType, constraints);
            }
        }

        // If we're assigning to a var arg dictionary with a TypeVar type,
        // strip literals before performing the assignment. This is used in
        // places like a dict constructor.
        if (argParam.paramCategory === ParamCategory.KwargsDict && isTypeVar(argParam.paramType)) {
            argType = stripLiteralValue(argType);
        }

        // If there's a constraint filter, apply it to top-level type variables
        // if appropriate. This doesn't properly handle non-top-level constrained
        // type variables.
        if (options.conditionFilter) {
            argType = mapSubtypesExpandTypeVars(
                argType,
                { conditionFilter: options.conditionFilter },
                (expandedSubtype) => {
                    return expandedSubtype;
                }
            );
        }

        const condition = argType.props?.condition;

        let diag = options?.skipReportError ? undefined : new DiagnosticAddendum();

        if (isParamSpec(argParam.paramType)) {
            // Handle the case where we're assigning a *args or **kwargs argument
            // to a *P.args or **P.kwargs parameter.
            if (argParam.paramType.priv.paramSpecAccess !== undefined) {
                return { isCompatible, argType, isTypeIncomplete, condition };
            }

            // Handle the case where we're assigning a *P.args or **P.kwargs argument
            // to a *P.args or **P.kwargs parameter.
            if (isParamSpec(argType) && argType.priv.paramSpecAccess !== undefined) {
                return { isCompatible, argType, isTypeIncomplete, condition };
            }
        }

        let assignTypeFlags = AssignTypeFlags.Default;

        if (argParam.isinstanceParam) {
            assignTypeFlags |= AssignTypeFlags.AllowIsinstanceSpecialForms;
        }

        if (options?.isArgFirstPass) {
            assignTypeFlags |= AssignTypeFlags.ArgAssignmentFirstPass;
        }

        if (!assignType(argParam.paramType, argType, diag?.createAddendum(), constraints, assignTypeFlags)) {
            if (!options?.skipReportError) {
                // Mismatching parameter types are common in untyped code; don't bother spending time
                // printing types if the diagnostic is disabled.
                const fileInfo = nodeInfo.getFileInfo(argParam.errorNode);
                if (
                    fileInfo.diagnosticRuleSet.reportArgumentType !== 'none' &&
                    !canSkipDiagnosticForNode(argParam.errorNode) &&
                    !isTypeIncomplete
                ) {
                    const argTypeText = printType(argType);
                    const paramTypeText = printType(argParam.paramType);

                    let message: string;
                    if (argParam.paramName && !argParam.isParamNameSynthesized) {
                        if (functionName) {
                            message = LocMessage.argAssignmentParamFunction().format({
                                argType: argTypeText,
                                paramType: paramTypeText,
                                functionName,
                                paramName: argParam.paramName,
                            });
                        } else {
                            message = LocMessage.argAssignmentParam().format({
                                argType: argTypeText,
                                paramType: paramTypeText,
                                paramName: argParam.paramName,
                            });
                        }
                    } else {
                        if (functionName) {
                            message = LocMessage.argAssignmentFunction().format({
                                argType: argTypeText,
                                paramType: paramTypeText,
                                functionName,
                            });
                        } else {
                            message = LocMessage.argAssignment().format({
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
                        DiagnosticRule.reportArgumentType,
                        message + diag?.getString(),
                        argParam.errorNode,
                        diag?.getEffectiveTextRange() ?? argParam.errorNode
                    );
                }
            }

            // Retain the wrapped signature for inference after an invalid descriptor
            // argument without treating the descriptor itself as callable.
            if (requiresSpecialization(argParam.paramType)) {
                let methodType = getMethodFromDescriptor(argType);
                if (methodType && isOverloaded(methodType)) {
                    // Recover the runtime signature, not a single overload's
                    // parameters selected when the returned decorator is called.
                    const implementation = OverloadedType.getImplementation(methodType);
                    if (implementation && isFunction(implementation)) {
                        methodType = implementation;
                    }
                }
                if (methodType) {
                    const recoveryConstraints = constraints.clone();
                    if (
                        assignType(
                            argParam.paramType,
                            methodType,
                            /* diag */ undefined,
                            recoveryConstraints,
                            assignTypeFlags
                        )
                    ) {
                        constraints.copyFromClone(recoveryConstraints);
                    }
                }
            }

            return { isCompatible: false, argType, isTypeIncomplete, skippedBareTypeVarExpectedType, condition };
        }

        if (!options.skipUnknownArgCheck) {
            const simplifiedType = makeTopLevelTypeVarsConcrete(removeUnbound(argType));
            const fileInfo = nodeInfo.getFileInfo(argParam.errorNode);

            function getDiagAddendum() {
                const diagAddendum = new DiagnosticAddendum();
                if (argParam.paramName) {
                    diagAddendum.addMessage(
                        (functionName
                            ? LocAddendum.argParamFunction().format({
                                  paramName: argParam.paramName,
                                  functionName,
                              })
                            : LocAddendum.argParam().format({ paramName: argParam.paramName })) +
                            diagAddendum.getString()
                    );
                }
                return diagAddendum;
            }

            // Do not check for unknown types if the expected type is "Any".
            // Don't print types if reportUnknownArgumentType is disabled for performance.
            if (
                fileInfo.diagnosticRuleSet.reportUnknownArgumentType !== 'none' &&
                !isAny(argParam.paramType) &&
                !isTypeIncomplete
            ) {
                if (isUnknown(simplifiedType)) {
                    const diagAddendum = getDiagAddendum();
                    addDiagnostic(
                        DiagnosticRule.reportUnknownArgumentType,
                        LocMessage.argTypeUnknown() + diagAddendum.getString(),
                        argParam.errorNode
                    );
                } else if (isPartlyUnknown(simplifiedType)) {
                    // If the parameter type is also partially unknown, don't report
                    // the error because it's likely that the partially-unknown type
                    // arose due to bidirectional type matching.
                    if (!isPartlyUnknown(argParam.paramType)) {
                        const diagAddendum = getDiagAddendum();
                        diagAddendum.addMessage(
                            LocAddendum.argumentType().format({
                                type: printType(simplifiedType, { expandTypeAlias: true }),
                            })
                        );
                        addDiagnostic(
                            DiagnosticRule.reportUnknownArgumentType,
                            LocMessage.argTypePartiallyUnknown() + diagAddendum.getString(),
                            argParam.errorNode
                        );
                    }
                }
            }
        }

        return { isCompatible, argType, isTypeIncomplete, skippedBareTypeVarExpectedType, condition };
    }

    function createTypeVarType(errorNode: ExpressionNode, classType: ClassType, argList: Arg[]): Type | undefined {
        return typeVarHandling.createTypeVarType(errorNode, classType, argList);
    }

    function createTypeVarTupleType(errorNode: ExpressionNode, classType: ClassType, argList: Arg[]): Type | undefined {
        return typeVarHandling.createTypeVarTupleType(errorNode, classType, argList);
    }

    function createParamSpecType(errorNode: ExpressionNode, classType: ClassType, argList: Arg[]): Type | undefined {
        if (argList.length === 0) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.paramSpecFirstArg(), errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        let paramSpecName = '';
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            paramSpecName = firstArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        } else {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.paramSpecFirstArg(),
                firstArg.valueExpression || errorNode
            );
        }

        const paramSpec = TypeBase.cloneAsSpecialForm(
            TypeVarType.createInstantiable(paramSpecName, TypeVarKind.ParamSpec),
            ClassType.cloneAsInstance(classType)
        );

        paramSpec.shared.defaultType = ParamSpecType.getUnknown();

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.d.value : undefined;

            if (paramName) {
                if (paramName === 'default') {
                    const expr = argList[i].valueExpression;
                    if (expr) {
                        const defaultType = getParamSpecDefaultType(expr, /* isPep695Syntax */ false);
                        if (defaultType) {
                            paramSpec.shared.defaultType = defaultType;
                            paramSpec.shared.isDefaultExplicit = true;
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
                        LocMessage.paramSpecUnknownParam().format({ name: paramName }),
                        paramNameNode || argList[i].valueExpression || errorNode
                    );
                }
            } else {
                addDiagnostic(
                    DiagnosticRule.reportCallIssue,
                    LocMessage.paramSpecUnknownArg(),
                    argList[i].valueExpression || errorNode
                );
                break;
            }
        }

        return paramSpec;
    }

    function getParamSpecDefaultType(node: ExpressionNode, isPep695Syntax: boolean): Type | undefined {
        const functionType = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.ParamSpecValue);

        if (node.nodeType === ParseNodeType.Ellipsis) {
            FunctionType.addDefaultParams(functionType);
            functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
            return functionType;
        }

        if (node.nodeType === ParseNodeType.List) {
            node.d.items.forEach((paramExpr, index) => {
                const typeResult = getTypeOfExpressionExpectingType(paramExpr, {
                    allowTypeVarsWithoutScopeId: true,
                    forwardRefs: isPep695Syntax,
                    typeExpression: true,
                });

                FunctionType.addParam(
                    functionType,
                    FunctionParam.create(
                        ParamCategory.Simple,
                        convertToInstance(typeResult.type),
                        FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                        `__p${index}`
                    )
                );
            });

            if (node.d.items.length > 0) {
                FunctionType.addPositionOnlyParamSeparator(functionType);
            }

            // Update the type cache so we don't attempt to re-evaluate this node.
            // The type doesn't matter, so use Any.
            writeTypeCache(node, { type: AnyType.create() }, /* flags */ undefined);
            return functionType;
        } else {
            const typeResult = getTypeOfExpressionExpectingType(node, {
                allowParamSpec: true,
                allowTypeVarsWithoutScopeId: true,
                allowEllipsis: true,
                typeExpression: true,
            });

            if (typeResult.typeErrors) {
                return undefined;
            }

            if (isParamSpec(typeResult.type)) {
                FunctionType.addParamSpecVariadics(functionType, typeResult.type);
                return functionType;
            }

            if (
                isClassInstance(typeResult.type) &&
                ClassType.isBuiltIn(typeResult.type, ['EllipsisType', 'ellipsis'])
            ) {
                FunctionType.addDefaultParams(functionType);
                return functionType;
            }
        }

        addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.paramSpecDefaultNotTuple(), node);

        return undefined;
    }

    // Handles a call to TypeAliasType(). This special form allows a caller to programmatically
    // create a type alias as defined in PEP 695. If one or more of the arguments is incorrect,
    // it returns undefined so the normal constructor evaluation can be performed (and type errors
    // emitted).
    function createTypeAliasType(errorNode: ExpressionNode, argList: Arg[]): Type | undefined {
        if (errorNode.nodeType !== ParseNodeType.Call || !errorNode.parent || argList.length < 2) {
            return undefined;
        }

        if (
            errorNode.parent.nodeType !== ParseNodeType.Assignment ||
            errorNode.parent.d.rightExpr !== errorNode ||
            errorNode.parent.d.leftExpr.nodeType !== ParseNodeType.Name
        ) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.typeAliasTypeMustBeAssigned(), errorNode);
            return undefined;
        }

        const scope = getScopeForNode(errorNode);
        if (scope) {
            if (scope.type !== ScopeType.Class && scope.type !== ScopeType.Module && scope.type !== ScopeType.Builtin) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeAliasTypeBadScope(),
                    errorNode.parent.d.leftExpr
                );
            }
        }

        const nameNode = errorNode.parent.d.leftExpr;

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            const typeAliasName = firstArg.valueExpression.d.strings.map((s) => s.d.value).join('');
            if (typeAliasName !== nameNode.d.value) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeAliasTypeNameMismatch(),
                    firstArg.valueExpression
                );
            }
        } else {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeAliasTypeNameArg(),
                firstArg.valueExpression || errorNode
            );
            return undefined;
        }

        let valueExpr: ExpressionNode | undefined;
        let typeParamsExpr: ExpressionNode | undefined;

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.d.value : undefined;

            if (paramName) {
                if (paramName === 'type_params' && !typeParamsExpr) {
                    typeParamsExpr = argList[i].valueExpression;
                } else if (paramName === 'value' && !valueExpr) {
                    valueExpr = argList[i].valueExpression;
                } else {
                    return undefined;
                }
            } else if (i === 1) {
                valueExpr = argList[i].valueExpression;
            } else {
                return undefined;
            }
        }

        // The value expression is not optional, so bail if it's not present.
        if (!valueExpr) {
            return undefined;
        }

        let typeParams: TypeVarType[] | undefined;
        if (typeParamsExpr) {
            if (typeParamsExpr.nodeType !== ParseNodeType.Tuple) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeAliasTypeParamInvalid(),
                    typeParamsExpr
                );
                return undefined;
            }

            typeParams = [];
            let isTypeParamListValid = true;
            typeParamsExpr.d.items.map((expr) => {
                let entryType = getTypeOfExpression(
                    expr,
                    EvalFlags.InstantiableType | EvalFlags.AllowTypeVarWithoutScopeId
                ).type;

                if (isTypeVar(entryType)) {
                    if (entryType.priv.scopeId || (isTypeVarTuple(entryType) && entryType.priv.isUnpacked)) {
                        isTypeParamListValid = false;
                    } else {
                        entryType = TypeVarType.cloneForScopeId(
                            entryType,
                            getScopeIdForNode(nameNode),
                            nameNode.d.value,
                            TypeVarScopeType.TypeAlias
                        );
                    }

                    typeParams!.push(entryType);
                } else {
                    isTypeParamListValid = false;
                }
            });

            if (!isTypeParamListValid) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeAliasTypeParamInvalid(),
                    typeParamsExpr
                );
                return undefined;
            }
        }

        return getTypeOfTypeAliasCommon(
            nameNode,
            nameNode,
            valueExpr,
            /* isPep695Syntax */ false,
            /* typeParamNodes */ undefined,
            () => typeParams
        );
    }

    function getFunctionFullName(functionNode: ParseNode, moduleName: string, functionName: string): string {
        return evaluatorCore.getFunctionFullName(functionNode, moduleName, functionName);
    }

    // Implements the semantics of the NewType call as documented
    // in the Python specification: The static type checker will treat
    // the new type as if it were a subclass of the original type.
    function createNewType(errorNode: ExpressionNode, argList: Arg[]): ClassType | undefined {
        return classConstruction.createNewType(errorNode, argList);
    }

    function getBaseClassesFromTypeCall(baseTupleType: ClassType): Type[] | undefined {
        if (!isTupleClass(baseTupleType) || baseTupleType.priv.tupleTypeArgs === undefined) {
            return undefined;
        }

        return baseTupleType.priv.tupleTypeArgs.map((typeArg) => {
            const specializedType = makeTopLevelTypeVarsConcrete(typeArg.type);
            return isEffectivelyInstantiable(specializedType) ? specializedType : UnknownType.create();
        });
    }

    // Implements the semantics of the multi-parameter variant of the "type" call.
    function createClassFromMetaclass(
        errorNode: ExpressionNode,
        argList: Arg[],
        metaclass: ClassType
    ): ClassType | undefined {
        return classConstruction.createClassFromMetaclass(errorNode, argList, metaclass);
    }

    function getTypeOfConstant(node: ConstantNode, flags: EvalFlags): TypeResult {
        return expressionEvaluation.getTypeOfConstant(node, flags);
    }

    function getTypeOfMagicMethodCall(
        objType: Type,
        methodName: string,
        argList: TypeResult[],
        errorNode: ExpressionNode,
        inferenceContext?: InferenceContext,
        diag?: DiagnosticAddendum
    ): TypeResult | undefined {
        return expressionEvaluation.getTypeOfMagicMethodCall(
            objType,
            methodName,
            argList,
            errorNode,
            inferenceContext,
            diag
        );
    }

    function getTypeOfDictionary(
        node: DictionaryNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext | undefined
    ): TypeResult {
        if ((flags & EvalFlags.TypeExpression) !== 0 && node.parent?.nodeType !== ParseNodeType.Argument) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(LocAddendum.useDictInstead());
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.dictInAnnotation() + diag.getString(), node);
        }

        // If the expected type is a union, analyze for each of the subtypes
        // to find one that matches.
        let expectedType = inferenceContext?.expectedType;

        if (inferenceContext && isUnion(inferenceContext.expectedType)) {
            let matchingSubtype: Type | undefined;
            let matchingSubtypeResult: TypeResult | undefined;

            doForEachSubtype(
                inferenceContext.expectedType,
                (subtype) => {
                    // Use shortcut if we've already found a match.
                    if (matchingSubtypeResult && !matchingSubtypeResult.typeErrors) {
                        return;
                    }

                    const subtypeResult = useSpeculativeMode(node, () => {
                        return getTypeOfDictionaryWithContext(node, flags, makeInferenceContext(subtype));
                    });

                    if (subtypeResult && assignType(subtype, subtypeResult.type)) {
                        // If this is the first result we're seeing or it's the first result
                        // without errors, select it as the match.
                        if (!matchingSubtypeResult || (matchingSubtypeResult.typeErrors && !subtypeResult.typeErrors)) {
                            matchingSubtype = subtype;
                            matchingSubtypeResult = subtypeResult;
                        }
                    }
                },
                /* sortSubtypes */ true
            );

            expectedType = matchingSubtype;
        }

        let expectedTypeDiagAddendum = undefined;
        if (expectedType) {
            expectedTypeDiagAddendum = new DiagnosticAddendum();
            const result = getTypeOfDictionaryWithContext(
                node,
                flags,
                makeInferenceContext(expectedType),
                expectedTypeDiagAddendum
            );
            if (result) {
                return result;
            }
        }

        // Don't force strict inference when the expected type is a TypeVar that
        // couldn't constrain the dict's key/value structure. A TypeVar like _T
        // from sorted(Iterable[_T], key=...) doesn't provide useful type
        // information for dict inference, and forcing strict inference would
        // widen heterogeneous value types into a union that can cause false
        // positives (e.g., dict[str, Path | str | dict[Any, Any]] when the
        // user meant each key to have a specific type).
        // Note: bounded/constrained TypeVars with dict-like bounds are handled
        // by getTypeOfDictionaryWithContext above (via makeTopLevelTypeVarsConcrete),
        // so they don't reach this fallback.
        const hasUsefulExpectedType = !!inferenceContext?.expectedType && !isTypeVar(inferenceContext.expectedType);
        const result = getTypeOfDictionaryInferred(node, flags, /* hasExpectedType */ hasUsefulExpectedType);
        return { ...result, expectedTypeDiagAddendum };
    }

    function getTypeOfDictionaryWithContext(
        node: DictionaryNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext,
        expectedDiagAddendum?: DiagnosticAddendum
    ): TypeResult | undefined {
        return collectionInference.getTypeOfDictionaryWithContext(node, flags, inferenceContext, expectedDiagAddendum);
    }

    // Attempts to infer the type of a dictionary statement. If hasExpectedType
    // is true, strict inference is used for the subexpressions.
    function getTypeOfDictionaryInferred(node: DictionaryNode, flags: EvalFlags, hasExpectedType: boolean): TypeResult {
        return collectionInference.getTypeOfDictionaryInferred(node, flags, hasExpectedType);
    }

    function getTypeOfListOrSet(
        node: ListNode | SetNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext | undefined
    ): TypeResult {
        if (
            (flags & EvalFlags.TypeExpression) !== 0 &&
            node.nodeType === ParseNodeType.List &&
            node.parent?.nodeType !== ParseNodeType.Argument
        ) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(LocAddendum.useListInstead());
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.listInAnnotation() + diag.getString(), node);
        }

        flags &= ~(EvalFlags.TypeExpression | EvalFlags.StrLiteralAsType | EvalFlags.InstantiableType);

        // If the expected type is a union, recursively call for each of the subtypes
        // to find one that matches.
        let expectedType = inferenceContext?.expectedType;

        if (inferenceContext && isUnion(inferenceContext.expectedType)) {
            let matchingSubtype: Type | undefined;
            let matchingSubtypeResult: TypeResult | undefined;

            doForEachSubtype(
                inferenceContext.expectedType,
                (subtype) => {
                    // Use shortcut if we've already found a match.
                    if (matchingSubtypeResult && !matchingSubtypeResult.typeErrors) {
                        return;
                    }

                    const subtypeResult = useSpeculativeMode(node, () => {
                        return getTypeOfListOrSetWithContext(node, flags, makeInferenceContext(subtype));
                    });

                    if (subtypeResult && assignType(subtype, subtypeResult.type)) {
                        // If this is the first result we're seeing or it's the first result
                        // without errors, select it as the match.
                        if (!matchingSubtypeResult || (matchingSubtypeResult.typeErrors && !subtypeResult.typeErrors)) {
                            matchingSubtype = subtype;
                            matchingSubtypeResult = subtypeResult;
                        }
                    }
                },
                /* sortSubtypes */ true
            );

            expectedType = matchingSubtype;
        }

        let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;
        if (expectedType) {
            const result = getTypeOfListOrSetWithContext(node, flags, makeInferenceContext(expectedType));
            if (result && !result.typeErrors) {
                return result;
            }

            expectedTypeDiagAddendum = result?.expectedTypeDiagAddendum;
        }

        const typeResult = getTypeOfListOrSetInferred(
            node,
            flags,
            /* hasExpectedType */ !!inferenceContext?.expectedType
        );
        return { ...typeResult, expectedTypeDiagAddendum };
    }

    // Attempts to determine the type of a list or set statement based on an expected type.
    // Returns undefined if that type cannot be honored.
    function getTypeOfListOrSetWithContext(
        node: ListNode | SetNode,
        flags: EvalFlags,
        inferenceContext: InferenceContext
    ): TypeResult | undefined {
        return collectionInference.getTypeOfListOrSetWithContext(node, flags, inferenceContext);
    }

    // Attempts to infer the type of a list or set statement with no "expected type".
    function getTypeOfListOrSetInferred(
        node: ListNode | SetNode,
        flags: EvalFlags,
        hasExpectedType: boolean
    ): TypeResult {
        return collectionInference.getTypeOfListOrSetInferred(node, flags, hasExpectedType);
    }

    function getTypeOfYield(node: YieldNode): TypeResult {
        return expressionEvaluation.getTypeOfYield(node);
    }

    function getTypeOfYieldFrom(node: YieldFromNode): TypeResult {
        return expressionEvaluation.getTypeOfYieldFrom(node);
    }

    function getTypeOfLambda(node: LambdaNode, inferenceContext: InferenceContext | undefined): TypeResult {
        let expectedFunctionTypes: FunctionType[] = [];
        if (inferenceContext) {
            mapSubtypes(inferenceContext.expectedType, (subtype) => {
                if (isFunction(subtype)) {
                    expectedFunctionTypes.push(subtype);
                }

                if (isClassInstance(subtype)) {
                    const boundMethod = getBoundMagicMethod(subtype, '__call__');
                    if (boundMethod && isFunction(boundMethod)) {
                        expectedFunctionTypes.push(boundMethod as FunctionType);
                    }
                }

                return undefined;
            });
        }

        let expectedSubtype: FunctionType | undefined;

        // If there's more than one type, try each in turn until we find one that works.
        if (expectedFunctionTypes.length > 1) {
            // Sort the expected types for deterministic results.
            expectedFunctionTypes = sortTypes(expectedFunctionTypes) as FunctionType[];

            for (const subtype of expectedFunctionTypes) {
                const result = getTypeOfLambdaWithExpectedType(
                    node,
                    subtype,
                    inferenceContext,
                    /* forceSpeculative */ true
                );

                if (!result.typeErrors) {
                    expectedSubtype = subtype;
                    break;
                }
            }
        }

        if (!expectedSubtype && expectedFunctionTypes.length > 0) {
            expectedSubtype = expectedFunctionTypes[0];
        }

        return getTypeOfLambdaWithExpectedType(node, expectedSubtype, inferenceContext, /* forceSpeculative */ false);
    }

    function getTypeOfLambdaWithExpectedType(
        node: LambdaNode,
        expectedType: FunctionType | undefined,
        inferenceContext: InferenceContext | undefined,
        forceSpeculative: boolean
    ): TypeResult {
        let isIncomplete = !!inferenceContext?.isTypeIncomplete;
        let paramsArePositionOnly = true;

        let expectedReturnType: Type | undefined;
        let expectedParamDetails: ParamListDetails | undefined;

        if (expectedType) {
            const liveTypeVarScopes = getTypeVarScopesForNode(node);
            expectedType = transformExpectedType(expectedType, liveTypeVarScopes, node.start) as FunctionType;

            expectedParamDetails = getParamListDetails(expectedType);
            expectedReturnType = getEffectiveReturnType(expectedType);
        }

        let functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.PartiallyEvaluated);
        functionType.shared.typeVarScopeId = getScopeIdForNode(node);

        return invalidateTypeCacheIfCanceled(() => {
            // Pre-cache the incomplete function type in case the evaluation of the
            // lambda depends on itself.
            writeTypeCache(node, { type: functionType, isIncomplete: true }, EvalFlags.None);

            // Match positional parameters in order, but allow keyword-only parameters
            // to be reordered. Unmatched parameters without defaults use Unknown.
            let sawParamMismatch = false;
            let expectedParamIndex = 0;
            let expectedKeywordParams: Map<string, VirtualParamDetails> | undefined;
            const positionOnlySeparatorIndex = node.d.params.findIndex(
                (param) => param.d.category === ParamCategory.Simple && !param.d.name
            );

            node.d.params.forEach((param, index) => {
                let paramType: Type | undefined;

                if (expectedParamDetails && !sawParamMismatch) {
                    const isKeywordOnlySeparator = param.d.category === ParamCategory.ArgsList && !param.d.name;

                    if (isKeywordOnlySeparator) {
                        if (
                            expectedParamIndex < expectedParamDetails.params.length &&
                            expectedParamDetails.params[expectedParamIndex].kind !== ParamKind.Keyword
                        ) {
                            sawParamMismatch = true;
                        }
                    } else if (expectedParamIndex < expectedParamDetails.params.length) {
                        let expectedParam = expectedParamDetails.params[expectedParamIndex];
                        const isPositionOnlyParam =
                            (positionOnlySeparatorIndex >= 0 && index < positionOnlySeparatorIndex) ||
                            (positionOnlySeparatorIndex < 0 &&
                                paramsArePositionOnly &&
                                !!param.d.name &&
                                isPrivateName(param.d.name.d.value));

                        if (
                            expectedParam.kind === ParamKind.Keyword &&
                            expectedParam.param.category === ParamCategory.Simple &&
                            param.d.category === ParamCategory.Simple &&
                            param.d.name &&
                            !isPositionOnlyParam &&
                            param.d.name.d.value !== expectedParam.param.name
                        ) {
                            if (!expectedKeywordParams) {
                                expectedKeywordParams = new Map();
                                for (const keywordParam of expectedParamDetails.params) {
                                    if (
                                        keywordParam.kind === ParamKind.Keyword &&
                                        keywordParam.param.category === ParamCategory.Simple &&
                                        keywordParam.param.name
                                    ) {
                                        expectedKeywordParams.set(keywordParam.param.name, keywordParam);
                                    }
                                }
                            }
                            expectedParam = expectedKeywordParams.get(param.d.name.d.value) ?? expectedParam;
                        }

                        const isCompatibleKeywordParam =
                            expectedParam.kind !== ParamKind.Keyword ||
                            expectedParam.param.category === ParamCategory.KwargsDict ||
                            (!isPositionOnlyParam && param.d.name?.d.value === expectedParam.param.name);

                        // If the parameter category matches and both of the parameters are
                        // either separators (/ or *) or not separators, copy the type
                        // from the expected parameter.
                        if (
                            expectedParam.param.category === param.d.category &&
                            !param.d.name === !expectedParam.param.name &&
                            isCompatibleKeywordParam
                        ) {
                            paramType = expectedParam.type;
                        } else {
                            sawParamMismatch = true;
                        }

                        expectedParamIndex++;
                    } else if (param.d.defaultValue) {
                        // If the lambda param has a default value but there is no associated
                        // parameter in the expected type, assume that the default value is
                        // being used to explicitly capture a value from an outer scope. Infer
                        // its type from the default value expression.
                        paramType = getTypeOfExpression(param.d.defaultValue, undefined, inferenceContext).type;
                    }
                } else if (param.d.defaultValue) {
                    // If there is no inference context but we have a default value,
                    // use the default value to infer the parameter's type.
                    paramType = inferParamTypeFromDefaultValue(param.d.defaultValue);
                }

                if (param.d.defaultValue) {
                    const defaultValueResult = getTypeOfExpression(
                        param.d.defaultValue,
                        EvalFlags.ConvertEllipsisToAny,
                        makeInferenceContext(paramType)
                    );
                    if (defaultValueResult.isIncomplete) {
                        isIncomplete = true;
                    }

                    // The lambda can also be called with its own default value.
                    if (paramType && !assignType(paramType, defaultValueResult.type)) {
                        paramType = combineTypes([paramType, stripLiteralValue(defaultValueResult.type)]);
                    }
                }

                if (param.d.name) {
                    writeTypeCache(
                        param.d.name,
                        {
                            type: transformVariadicParamType(node, param.d.category, paramType ?? UnknownType.create()),
                        },
                        EvalFlags.None
                    );
                }

                // Determine whether we need to insert an implied position-only parameter.
                // This is needed when a function's parameters are named using the old-style
                // way of specifying position-only parameters.
                if (index >= 0) {
                    let isImplicitPositionOnlyParam = false;

                    if (param.d.category === ParamCategory.Simple && param.d.name) {
                        if (isPrivateName(param.d.name.d.value)) {
                            isImplicitPositionOnlyParam = true;
                        }
                    } else {
                        paramsArePositionOnly = false;
                    }

                    if (
                        paramsArePositionOnly &&
                        !isImplicitPositionOnlyParam &&
                        functionType.shared.parameters.length > 0
                    ) {
                        FunctionType.addPositionOnlyParamSeparator(functionType);
                    }

                    if (!isImplicitPositionOnlyParam) {
                        paramsArePositionOnly = false;
                    }
                }

                const functionParam = FunctionParam.create(
                    param.d.category,
                    paramType ?? UnknownType.create(),
                    FunctionParamFlags.TypeDeclared,
                    param.d.name ? param.d.name.d.value : undefined,
                    param.d.defaultValue ? AnyType.create(/* isEllipsis */ true) : undefined,
                    param.d.defaultValue
                );

                FunctionType.addParam(functionType, functionParam);
            });

            if (paramsArePositionOnly && functionType.shared.parameters.length > 0) {
                FunctionType.addPositionOnlyParamSeparator(functionType);
            }

            let typeErrors = false;

            // If we're speculatively evaluating the lambda, create another speculative
            // evaluation scope for the return expression and do not allow retention
            // of the cached types.
            // We need to set allowCacheRetention to false because we don't want to
            // cache the type of the lambda return expression because it depends on
            // the parameter types that we set above, and the speculative type cache
            // doesn't know about that context.
            useSpeculativeMode(
                forceSpeculative || isSpeculativeModeInUse(node) || inferenceContext?.isTypeIncomplete
                    ? node.d.expr
                    : undefined,
                () => {
                    const returnTypeResult = getTypeOfExpression(
                        node.d.expr,
                        /* flags */ undefined,
                        makeInferenceContext(expectedReturnType)
                    );

                    functionType.shared.inferredReturnType = {
                        type: returnTypeResult.type,
                    };
                    if (returnTypeResult.isIncomplete) {
                        isIncomplete = true;
                    }

                    if (returnTypeResult.typeErrors) {
                        typeErrors = true;
                    } else if (expectedReturnType) {
                        // If the expectedReturnType is generic, see if the actual return type
                        // provides types for some or all type variables.
                        if (requiresSpecialization(expectedReturnType)) {
                            const constraints = new ConstraintTracker();
                            if (
                                assignType(expectedReturnType, returnTypeResult.type, /* diag */ undefined, constraints)
                            ) {
                                functionType = solveAndApplyConstraints(functionType, constraints, {
                                    replaceUnsolved: {
                                        scopeIds: [],
                                        tupleClassType: getTupleClassType(),
                                    },
                                }) as FunctionType;
                            }
                        }
                    }

                    if (expectedType && !forceSpeculative && !isIncomplete) {
                        captureContextualLambdaTypes(node);
                    }
                },
                {
                    dependentType: inferenceContext?.expectedType,
                    allowDiagnostics:
                        !forceSpeculative && !canSkipDiagnosticForNode(node) && !inferenceContext?.isTypeIncomplete,
                }
            );

            // Mark the function type as no longer being evaluated.
            functionType.shared.flags &= ~FunctionTypeFlags.PartiallyEvaluated;

            // Is the resulting function compatible with the expected type?
            if (expectedType && !assignType(expectedType, functionType)) {
                typeErrors = true;
            }

            const typeResult = { type: functionType, isIncomplete, typeErrors };
            if (expectedType && !forceSpeculative && !isIncomplete) {
                captureContextualLambdaTypes(node, typeResult);
            }
            return typeResult;
        });
    }

    function getTypeOfComprehension(
        node: ComprehensionNode,
        flags: EvalFlags,
        inferenceContext?: InferenceContext
    ): TypeResult {
        return collectionInference.getTypeOfComprehension(node, flags, inferenceContext);
    }

    function reportPossibleUnknownAssignment(
        diagLevel: DiagnosticLevel,
        rule: DiagnosticRule,
        target: NameNode,
        type: Type,
        errorNode: ExpressionNode,
        ignoreEmptyContainers: boolean
    ) {
        return evaluatorCore.reportPossibleUnknownAssignment(
            diagLevel,
            rule,
            target,
            type,
            errorNode,
            ignoreEmptyContainers
        );
    }

    function evaluateComprehensionForIf(node: ComprehensionForIfNode) {
        return collectionInference.evaluateComprehensionForIf(node);
    }

    function getTypeOfSlice(node: SliceNode): TypeResult {
        return expressionEvaluation.getTypeOfSlice(node);
    }

    // Verifies that a type argument's type is not disallowed.
    function validateTypeArg(argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions): boolean {
        return specialFormCreation.validateTypeArg(argResult, options);
    }

    function cloneBuiltinObjectWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        return evaluatorCore.cloneBuiltinObjectWithLiteral(node, builtInName, value);
    }

    // Determines whether the metadata object is compatible with the base type.
    function validateTypeMetadata(errorNode: ExpressionNode, baseType: Type, metaArg: TypeResultWithNode): boolean {
        // This function was added for draft PEP 746, but the functionality
        // has been removed for now while the PEP is being revised.
        return true;
    }

    function transformTypeForTypeAlias(
        type: Type,
        errorNode: ExpressionNode,
        typeAliasPlaceholder: TypeVarType,
        isPep695TypeVarType: boolean,
        typeParamNodes?: TypeParameterNode[]
    ): Type {
        return specialFormCreation.transformTypeForTypeAlias(
            type,
            errorNode,
            typeAliasPlaceholder,
            isPep695TypeVarType,
            typeParamNodes
        );
    }

    function createSpecialBuiltInClass(node: ParseNode, assignedName: string, aliasMapEntry: AliasMapEntry): ClassType {
        const fileInfo = nodeInfo.getFileInfo(node);
        let specialClassType = ClassType.createInstantiable(
            assignedName,
            ParseTreeUtils.getClassFullName(node, fileInfo.moduleName, assignedName),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.BuiltIn | ClassTypeFlags.SpecialBuiltIn,
            /* typeSourceId */ 0,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined
        );

        if (aliasMapEntry.isSpecialForm) {
            specialClassType.shared.flags |= ClassTypeFlags.SpecialFormClass;
        }

        if (aliasMapEntry.isIllegalInIsinstance) {
            specialClassType.shared.flags |= ClassTypeFlags.IllegalIsinstanceClass;
        }

        // Synthesize a single type parameter with the specified variance if
        // specified in the alias map entry.
        if (aliasMapEntry.typeParamVariance !== undefined) {
            let typeParam = TypeVarType.createInstance('T');
            typeParam = TypeVarType.cloneForScopeId(
                typeParam,
                getScopeIdForNode(node),
                assignedName,
                TypeVarScopeType.Class
            );
            typeParam.shared.declaredVariance = aliasMapEntry.typeParamVariance;
            specialClassType.shared.typeParams.push(typeParam);
        }

        const specialBuiltInClassDeclaration = (nodeInfo.getDeclaration(node) ??
            (node.parent ? nodeInfo.getDeclaration(node.parent) : undefined)) as
            | SpecialBuiltInClassDeclaration
            | undefined;

        specialClassType.shared.declaration = specialBuiltInClassDeclaration;

        if (fileInfo.isTypingExtensionsStubFile) {
            specialClassType.shared.flags |= ClassTypeFlags.TypingExtensionClass;
        }

        const baseClassName = aliasMapEntry.implicitBaseClass || aliasMapEntry.alias || 'object';

        let baseClass: Type | undefined;
        if (aliasMapEntry.module === 'builtins') {
            baseClass = getBuiltInType(node, baseClassName);
        } else if (aliasMapEntry.module === 'collections') {
            // The typing.pyi file imports collections.
            baseClass = getTypeOfModule(node, baseClassName, ['collections']);
        } else if (aliasMapEntry.module === 'internals') {
            // Handle TypedDict specially.
            assert(baseClassName === 'TypedDictFallback');
            baseClass = fileInfo.isTypingExtensionsStubFile
                ? getTypeOfModule(node, '_TypedDict', ['typing_extensions']) ?? prefetched?.typedDictPrivateClass
                : prefetched?.typedDictPrivateClass;
            if (baseClass) {
                // The TypedDictFallback class is marked as abstract, but the
                // methods that are abstract are overridden and shouldn't
                // cause the TypedDict to be marked as abstract.
                if (
                    isInstantiableClass(baseClass) &&
                    ClassType.isBuiltIn(baseClass, ['_TypedDict', 'TypedDictFallback'])
                ) {
                    baseClass = ClassType.cloneWithNewFlags(
                        baseClass,
                        baseClass.shared.flags &
                            ~(ClassTypeFlags.SupportsAbstractMethods | ClassTypeFlags.TypeCheckOnly)
                    );
                }
            }
        }

        if (baseClass && isInstantiableClass(baseClass)) {
            if (aliasMapEntry.alias) {
                specialClassType = ClassType.cloneForTypingAlias(baseClass, assignedName);
            } else {
                specialClassType.shared.baseClasses.push(baseClass);
                specialClassType.shared.effectiveMetaclass = baseClass.shared.effectiveMetaclass;
                computeMroLinearization(specialClassType);
            }
        } else {
            specialClassType.shared.baseClasses.push(UnknownType.create());
            specialClassType.shared.effectiveMetaclass = UnknownType.create();
            computeMroLinearization(specialClassType);
        }

        return specialClassType;
    }

    // Handles some special-case type annotations that are found
    // within the typings.pyi file.
    function handleTypingStubTypeAnnotation(node: ExpressionNode): Type | undefined {
        if (!node.parent || node.parent.nodeType !== ParseNodeType.TypeAnnotation) {
            return undefined;
        }

        if (node.parent.d.valueExpr.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.parent.d.valueExpr;
        const assignedName = nameNode.d.value;

        const specialTypes: Map<string, AliasMapEntry> = new Map([
            ['Tuple', { alias: 'tuple', module: 'builtins' }],
            ['Generic', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Protocol', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Callable', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Type', { alias: 'type', module: 'builtins' }],
            ['ClassVar', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Final', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Literal', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['TypedDict', { alias: 'TypedDictFallback', module: 'internals' }],
            ['Union', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Optional', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Annotated', { alias: '', module: 'builtins', isSpecialForm: true, isIllegalInIsinstance: true }],
            ['TypeAlias', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Concatenate', { alias: '', module: 'builtins', isSpecialForm: true }],
            [
                'TypeGuard',
                {
                    alias: '',
                    module: 'builtins',
                    implicitBaseClass: 'bool',
                    isSpecialForm: true,
                    typeParamVariance: Variance.Covariant,
                },
            ],
            ['Unpack', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Required', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['NotRequired', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Self', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['NoReturn', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['Never', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['LiteralString', { alias: '', module: 'builtins', isSpecialForm: true }],
            ['ReadOnly', { alias: '', module: 'builtins', isSpecialForm: true }],
            [
                'TypeIs',
                {
                    alias: '',
                    module: 'builtins',
                    implicitBaseClass: 'bool',
                    isSpecialForm: true,
                    typeParamVariance: Variance.Invariant,
                },
            ],
            [
                'TypeForm',
                {
                    alias: '',
                    module: 'builtins',
                    isSpecialForm: true,
                    typeParamVariance: Variance.Covariant,
                    isIllegalInIsinstance: true,
                },
            ],
        ]);

        const aliasMapEntry = specialTypes.get(assignedName);

        if (aliasMapEntry) {
            const cachedType = readTypeCache(node, EvalFlags.None);
            if (cachedType) {
                return cachedType;
            }

            let specialType: Type = createSpecialBuiltInClass(node, assignedName, aliasMapEntry);

            // Handle 'LiteralString' specially because we want it to act as
            // though it derives from 'str'.
            if (assignedName === 'LiteralString') {
                specialType.shared.baseClasses.push(prefetched?.strClass ?? AnyType.create());
                computeMroLinearization(specialType);

                specialType = TypeBase.cloneWithTypeForm(specialType, convertToInstance(specialType));
            }

            // Handle 'Never' and 'NoReturn' specially.
            if (assignedName === 'Never' || assignedName === 'NoReturn') {
                specialType = TypeBase.cloneAsSpecialForm(
                    assignedName === 'Never' ? NeverType.createNever() : NeverType.createNoReturn(),
                    specialType
                );

                specialType = TypeBase.cloneWithTypeForm(specialType, convertToInstance(specialType));
            }

            writeTypeCache(node, { type: specialType }, EvalFlags.None);
            return specialType;
        }

        return undefined;
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    function handleTypingStubAssignment(node: AssignmentNode): Type | undefined {
        if (node.d.leftExpr.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.d.leftExpr;
        const assignedName = nameNode.d.value;

        if (assignedName === 'Any') {
            return AnyType.createSpecialForm();
        }

        const specialTypes: Map<string, AliasMapEntry> = new Map([
            ['overload', { alias: '', module: 'builtins' }],
            ['TypeVar', { alias: '', module: 'builtins' }],
            ['_promote', { alias: '', module: 'builtins' }],
            ['no_type_check', { alias: '', module: 'builtins' }],
            ['NoReturn', { alias: '', module: 'builtins' }],
            ['Never', { alias: '', module: 'builtins' }],
            ['Counter', { alias: 'Counter', module: 'collections' }],
            ['List', { alias: 'list', module: 'builtins' }],
            ['Dict', { alias: 'dict', module: 'builtins' }],
            ['DefaultDict', { alias: 'defaultdict', module: 'collections' }],
            ['Set', { alias: 'set', module: 'builtins' }],
            ['FrozenSet', { alias: 'frozenset', module: 'builtins' }],
            ['Deque', { alias: 'deque', module: 'collections' }],
            ['ChainMap', { alias: 'ChainMap', module: 'collections' }],
            ['OrderedDict', { alias: 'OrderedDict', module: 'collections' }],
        ]);

        const aliasMapEntry = specialTypes.get(assignedName);
        if (aliasMapEntry) {
            // Evaluate the expression so symbols are marked as accessed.
            getTypeOfExpression(node.d.rightExpr);
            return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
        }

        return undefined;
    }

    function cachedAssignmentTargetMayHaveDeclaredType(expression: ExpressionNode): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.Name: {
                const symbolWithScope = lookUpSymbolRecursive(expression, expression.d.value, /* honorCodeFlow */ true);
                return (
                    !!symbolWithScope &&
                    (symbolWithScope.symbol.hasTypedDeclarations() || symbolWithScope.scope.type === ScopeType.Class)
                );
            }

            case ParseNodeType.TypeAnnotation:
            case ParseNodeType.MemberAccess:
            case ParseNodeType.Index:
                return true;

            case ParseNodeType.Tuple:
                return (
                    expression.d.items.length > 0 &&
                    !expression.d.items.some((item) => item.nodeType === ParseNodeType.Unpack) &&
                    expression.d.items.every((item) => cachedAssignmentTargetMayHaveDeclaredType(item))
                );

            default:
                return false;
        }
    }

    function evaluateTypesForAssignmentStatement(node: AssignmentNode): void {
        if (
            operationRouter?.route?.({
                kind: 'statement',
                node,
                evaluate: () => evaluateTypesForAssignmentStatement(node),
            })
        ) {
            return;
        }
        const fileInfo = nodeInfo.getFileInfo(node);

        // If the entire statement has already been evaluated, don't
        // re-evaluate it.
        if (isTypeCached(node)) {
            return;
        }

        let flags: EvalFlags = EvalFlags.None;
        if (fileInfo.isStubFile) {
            // An assignment of ellipsis means "Any" within a type stub file.
            flags |= EvalFlags.ConvertEllipsisToAny;
        }

        if (
            node.d.rightExpr.nodeType === ParseNodeType.Name ||
            node.d.rightExpr.nodeType === ParseNodeType.MemberAccess
        ) {
            // Don't specialize a generic class on assignment (e.g. "x = list"
            // or "x = collections.OrderedDict") because we may want to later
            // specialize it (e.g. "x[int]").
            flags |= EvalFlags.NoSpecialize;
        }

        // Is this type already cached?
        let rightHandType = readTypeCache(node.d.rightExpr, /* flags */ undefined);
        let isIncomplete = false;
        let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;
        let declaredType: Type | undefined;
        let declaredTypeResolved = false;

        // A runtime-first query may have cached the RHS without its assignment
        // context. Re-evaluate it when the annotation expects a TypeForm so the
        // ordinary cache cannot suppress contextual validation and conversion.
        if (rightHandType && cachedAssignmentTargetMayHaveDeclaredType(node.d.leftExpr)) {
            declaredType = getDeclaredTypeForExpression(node.d.leftExpr, { method: 'set' });
            declaredTypeResolved = true;
            if (declaredType && expectedTypeWantsTypeForm(declaredType)) {
                rightHandType = undefined;
            }
        }

        if (!rightHandType) {
            // Special-case the typing.pyi file, which contains some special
            // types that the type analyzer needs to interpret differently.
            if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
                rightHandType = handleTypingStubAssignment(node);
                if (rightHandType) {
                    writeTypeCache(node.d.rightExpr, { type: rightHandType }, EvalFlags.None);
                }
            }
        }

        if (!rightHandType) {
            let typeAliasNameNode: NameNode | undefined;
            let typeAliasPlaceholder: TypeVarType | undefined;
            let isSpeculativeTypeAlias = false;

            if (isDeclaredTypeAlias(node.d.leftExpr)) {
                flags =
                    EvalFlags.InstantiableType |
                    EvalFlags.TypeExpression |
                    EvalFlags.StrLiteralAsType |
                    EvalFlags.NoParamSpec |
                    EvalFlags.NoTypeVarTuple |
                    EvalFlags.NoClassVar;

                typeAliasNameNode = (node.d.leftExpr as TypeAnnotationNode).d.valueExpr as NameNode;

                if (!isLegalTypeAliasExpressionForm(node.d.rightExpr, /* allowStrLiteral */ true)) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.typeAliasIllegalExpressionForm(),
                        node.d.rightExpr
                    );
                }
            } else if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
                const symbolWithScope = lookUpSymbolRecursive(
                    node.d.leftExpr,
                    node.d.leftExpr.d.value,
                    /* honorCodeFlow */ false
                );

                if (symbolWithScope) {
                    const decls = symbolWithScope.symbol.getDeclarations();

                    if (decls.length === 1) {
                        if (isPossibleTypeAliasDeclaration(decls[0])) {
                            typeAliasNameNode = node.d.leftExpr;
                            isSpeculativeTypeAlias = true;
                            flags |= EvalFlags.NoConvertSpecialForm;
                        } else if (isPossibleTypeDictFactoryCall(decls[0])) {
                            // Handle calls to TypedDict factory functions like type
                            // aliases to support recursive field type definitions.
                            typeAliasNameNode = node.d.leftExpr;
                        }
                    }
                }
            }

            if (typeAliasNameNode) {
                typeAliasPlaceholder = synthesizeTypeAliasPlaceholder(typeAliasNameNode);

                writeTypeCache(node, { type: typeAliasPlaceholder }, /* flags */ undefined);
                writeTypeCache(node.d.leftExpr, { type: typeAliasPlaceholder }, /* flags */ undefined);

                if (node.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation) {
                    writeTypeCache(node.d.leftExpr.d.valueExpr, { type: typeAliasPlaceholder }, /* flags */ undefined);
                }
            }

            if (!declaredTypeResolved) {
                declaredType = getDeclaredTypeForExpression(node.d.leftExpr, { method: 'set' });
            }

            if (declaredType) {
                const liveTypeVarScopes = getTypeVarScopesForNode(node);
                declaredType = makeTypeVarsBound(declaredType, liveTypeVarScopes);
            }

            const srcTypeResult = getTypeOfExpression(node.d.rightExpr, flags, makeInferenceContext(declaredType));

            rightHandType = srcTypeResult.type;
            expectedTypeDiagAddendum = srcTypeResult.expectedTypeDiagAddendum;
            if (srcTypeResult.isIncomplete) {
                isIncomplete = true;
            }

            // If this was a speculative type alias, it becomes a real type alias
            // only if the evaluated type is an instantiable type.
            if (isSpeculativeTypeAlias && !isLegalImplicitTypeAliasType(rightHandType)) {
                typeAliasNameNode = undefined;
            }

            if (typeAliasNameNode) {
                assert(typeAliasPlaceholder !== undefined);

                // If this is a type alias, record its name based on the assignment target.
                rightHandType = transformTypeForTypeAlias(
                    rightHandType,
                    typeAliasNameNode,
                    typeAliasPlaceholder,
                    /* isPep695TypeVarType */ false
                );

                if (isTypeAliasRecursive(typeAliasPlaceholder, rightHandType)) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeAliasIsRecursiveDirect().format({
                            name: typeAliasNameNode.d.value,
                        }),
                        node.d.rightExpr
                    );

                    rightHandType = UnknownType.create();
                }

                // Set the resulting type to the boundType of the original type alias
                // to support recursive type aliases.
                typeAliasPlaceholder.shared.boundType = rightHandType;

                // Record the type parameters within the recursive type alias so it
                // can be specialized.
                typeAliasPlaceholder.shared.recursiveAlias!.typeParams =
                    rightHandType.props?.typeAliasInfo?.shared.typeParams;
            } else {
                // If the RHS is a constant boolean expression, assign it a literal type.
                const constExprValue = evaluateStaticBoolExpression(
                    node.d.rightExpr,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );

                if (constExprValue !== undefined) {
                    const boolType = getBuiltInObject(node, 'bool');
                    if (isClassInstance(boolType)) {
                        rightHandType = ClassType.cloneWithLiteral(boolType, constExprValue);
                    }
                }
            }
        }

        assignTypeToExpression(
            node.d.leftExpr,
            { type: rightHandType, isIncomplete },
            node.d.rightExpr,
            /* ignoreEmptyContainers */ true,
            /* allowAssignmentToFinalVar */ true,
            expectedTypeDiagAddendum
        );

        writeTypeCache(node, { type: rightHandType, isIncomplete }, EvalFlags.None);
    }

    // Synthesize a TypeVar that acts as a placeholder for a type alias. This allows
    // the type alias definition to refer to itself.
    function synthesizeTypeAliasPlaceholder(nameNode: NameNode, isTypeAliasType: boolean = false): TypeVarType {
        return memberResolution.synthesizeTypeAliasPlaceholder(nameNode, isTypeAliasType);
    }

    // Evaluates the type of a type alias (i.e. "type") statement. This code
    // path does not handle traditional type aliases, which are treated as
    // variables since they use normal variable assignment syntax.
    function getTypeOfTypeAlias(node: TypeAliasNode): Type {
        return getTypeOfTypeAliasCommon(
            node,
            node.d.name,
            node.d.expr,
            /* isPep695Syntax */ true,
            node.d.typeParams?.d.params,
            () => {
                if (node.d.typeParams) {
                    return evaluateTypeParamList(node.d.typeParams);
                }
                return undefined;
            }
        );
    }

    // This function is common to the handling of "type" statements and explicit
    // calls to the TypeAliasType constructor.
    function getTypeOfTypeAliasCommon(
        declNode: ParseNode,
        nameNode: NameNode,
        valueNode: ExpressionNode,
        isPep695Syntax: boolean,
        typeParamNodes: TypeParameterNode[] | undefined,
        getTypeParamCallback: () => TypeVarType[] | undefined
    ) {
        const cachedType = readTypeCache(nameNode, EvalFlags.None);
        if (cachedType) {
            return cachedType;
        }

        // Synthesize a type variable that represents the type alias while we're
        // evaluating it. This allows us to handle recursive definitions.
        const typeAliasTypeVar = synthesizeTypeAliasPlaceholder(nameNode, /* isTypeAliasType */ true);

        // Write the type to the type cache to support recursive type alias definitions.
        writeTypeCache(nameNode, { type: typeAliasTypeVar }, /* flags */ undefined);

        // Set a partial type to handle recursive (self-referential) type aliases.
        const scope = getScopeForNode(declNode);
        const typeAliasSymbol = scope?.lookUpSymbolRecursive(nameNode.d.value);
        const typeAliasDecl = nodeInfo.getDeclaration(declNode);
        if (typeAliasDecl && typeAliasSymbol) {
            setSymbolResolutionPartialType(typeAliasSymbol.symbol, typeAliasDecl, typeAliasTypeVar);
        }

        const typeParams = getTypeParamCallback();
        if (typeAliasTypeVar.shared.recursiveAlias) {
            typeAliasTypeVar.shared.recursiveAlias.typeParams = typeParams ?? [];
        }

        let aliasTypeResult: TypeResult;
        if (isPep695Syntax) {
            aliasTypeResult = getTypeOfExpressionExpectingType(valueNode, {
                forwardRefs: true,
                typeExpression: true,
            });
        } else {
            const flags =
                EvalFlags.InstantiableType |
                EvalFlags.TypeExpression |
                EvalFlags.StrLiteralAsType |
                EvalFlags.NoParamSpec |
                EvalFlags.NoTypeVarTuple |
                EvalFlags.NoClassVar;
            aliasTypeResult = getTypeOfExpression(valueNode, flags);
        }

        let isIncomplete = false;
        let aliasType = aliasTypeResult.type;
        if (aliasTypeResult.isIncomplete) {
            isIncomplete = true;
        }

        aliasType = transformTypeForTypeAlias(
            aliasType,
            nameNode,
            typeAliasTypeVar,
            /* isPep695TypeVarType */ true,
            typeParamNodes
        );

        // See if the type alias relies on itself in a way that cannot be resolved.
        if (isTypeAliasRecursive(typeAliasTypeVar, aliasType)) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeAliasIsRecursiveDirect().format({
                    name: nameNode.d.value,
                }),
                valueNode
            );

            aliasType = UnknownType.create();
        }

        // Set the resulting type to the boundType of the original type alias
        // to support recursive type aliases.
        typeAliasTypeVar.shared.boundType = aliasType;

        writeTypeCache(nameNode, { type: aliasType, isIncomplete }, EvalFlags.None);

        return aliasType;
    }

    function evaluateTypesForAugmentedAssignment(node: AugmentedAssignmentNode): void {
        if (isTypeCached(node)) {
            return;
        }

        const destTypeResult = getTypeOfAugmentedAssignment(evaluatorInterface, node, /* inferenceContext */ undefined);

        writeTypeCache(node, destTypeResult, EvalFlags.None);
    }

    function getPseudoGenericTypeVarName(paramName: string) {
        return typeVarHandling.getPseudoGenericTypeVarName(paramName);
    }

    // Creates a new class type that is a subclass of two other specified classes.
    function createSubclass(errorNode: ExpressionNode, type1: ClassType, type2: ClassType): ClassType {
        return classConstruction.createSubclass(errorNode, type1, type2);
    }

    function getTypeOfClass(node: ClassNode): ClassTypeResult | undefined {
        initializePrefetchedTypes(node);

        // Is this type already cached?
        const cachedClassType = readTypeCache(node.d.name, EvalFlags.None);

        if (cachedClassType) {
            if (!isInstantiableClass(cachedClassType)) {
                // This can happen in rare circumstances where the class declaration
                // is located in an unreachable code block.
                return undefined;
            }
            return {
                classType: cachedClassType,
                decoratedType: readTypeCache(node, EvalFlags.None) || UnknownType.create(),
            };
        }

        // The type wasn't cached, so we need to create a new one.
        const scope = getScopeForNode(node);

        const fileInfo = nodeInfo.getFileInfo(node);
        let classFlags = ClassTypeFlags.None;
        if (
            scope?.type === ScopeType.Builtin ||
            fileInfo.isTypingStubFile ||
            fileInfo.isTypingExtensionsStubFile ||
            fileInfo.isBuiltInStubFile ||
            fileInfo.isTypeshedStubFile
        ) {
            classFlags |= ClassTypeFlags.BuiltIn;

            if (fileInfo.isTypingExtensionsStubFile) {
                classFlags |= ClassTypeFlags.TypingExtensionClass;
            }

            if (node.d.name.d.value === 'property') {
                classFlags |= ClassTypeFlags.PropertyClass;
            }

            if (node.d.name.d.value === 'tuple') {
                classFlags |= ClassTypeFlags.TupleClass;
            }
        }

        if (fileInfo.isStubFile) {
            classFlags |= ClassTypeFlags.DefinedInStub;
        }

        const classType = ClassType.createInstantiable(
            node.d.name.d.value,
            ParseTreeUtils.getClassFullName(node, fileInfo.moduleName, node.d.name.d.value),
            fileInfo.moduleName,
            fileInfo.fileUri,
            classFlags,
            ParseTreeUtils.getTypeSourceId(node),
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined,
            ParseTreeUtils.getDocString(node.d.suite.d.statements)
        );

        classType.shared.typeVarScopeId = getScopeIdForNode(node);

        // Is this a special type that supports type promotions according to PEP 484?
        if (typePromotions.has(classType.shared.fullName)) {
            classType.priv.includePromotions = true;
        }

        // Some classes refer to themselves within type arguments used within
        // base classes. We'll register the partially-constructed class type
        // to allow these to be resolved.
        const classSymbol = scope?.lookUpSymbol(node.d.name.d.value);
        let classDecl: ClassDeclaration | undefined;
        const decl = nodeInfo.getDeclaration(node);
        if (decl) {
            classDecl = decl as ClassDeclaration;
        }
        if (classDecl && classSymbol) {
            setSymbolResolutionPartialType(classSymbol, classDecl, classType);
        }
        classType.shared.flags |= ClassTypeFlags.PartiallyEvaluated;
        classType.shared.declaration = classDecl;

        return invalidateTypeCacheIfCanceled(() => {
            writeTypeCache(node, { type: classType }, /* flags */ undefined);
            writeTypeCache(node.d.name, { type: classType }, /* flags */ undefined);

            // Keep a list of unique type parameters that are used in the
            // base class arguments.
            let typeParams: TypeVarType[] = [];

            if (node.d.typeParams) {
                typeParams = evaluateTypeParamList(node.d.typeParams).map((t) => TypeVarType.cloneAsInstance(t));
            }

            // If the class derives from "Generic" directly, it will provide
            // all of the type parameters in the specified order.
            let genericTypeParams: TypeVarType[] | undefined;
            let protocolTypeParams: TypeVarType[] | undefined;
            let isNamedTupleSubclass = false;

            const initSubclassArgs: Arg[] = [];
            let metaclassNode: ExpressionNode | undefined;
            let exprFlags =
                EvalFlags.InstantiableType |
                EvalFlags.AllowGeneric |
                EvalFlags.NoNakedGeneric |
                EvalFlags.NoTypeVarWithScopeId |
                EvalFlags.TypeVarGetsCurScope |
                EvalFlags.EnforceVarianceConsistency;
            if (fileInfo.isStubFile) {
                exprFlags |= EvalFlags.ForwardRefs;
            }
            let sawClosedOrExtraItems = false;

            node.d.arguments.forEach((arg) => {
                // Ignore unpacked arguments.
                if (arg.d.argCategory === ArgCategory.UnpackedDictionary) {
                    // Evaluate the expression's type so symbols are marked accessed
                    // and errors are reported.
                    getTypeOfExpression(arg.d.valueExpr);
                    return;
                }

                if (!arg.d.name) {
                    let argType: Type;

                    if (arg.d.argCategory === ArgCategory.UnpackedList) {
                        getTypeOfExpression(arg.d.valueExpr);
                        argType = UnknownType.create();
                    } else {
                        argType = getTypeOfExpression(arg.d.valueExpr, exprFlags).type;

                        if (
                            isTypeVar(argType) &&
                            argType.props?.specialForm &&
                            TypeBase.isInstance(argType.props.specialForm)
                        ) {
                            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.baseClassInvalid(), arg);
                            argType = UnknownType.create();
                        }

                        argType = makeTopLevelTypeVarsConcrete(argType);
                    }

                    // In some stub files, classes are conditionally defined (e.g. based
                    // on platform type). We'll assume that the conditional logic is correct
                    // and strip off the "unbound" union.
                    if (isUnion(argType)) {
                        argType = removeUnbound(argType);
                    }

                    // Any is allowed as a base class. Remove its "special form" flag to avoid
                    // false positive errors.
                    if (isAny(argType) && argType.props?.specialForm) {
                        argType = AnyType.create();
                    }

                    argType = stripTypeFormRecursive(argType);

                    if (!isAnyOrUnknown(argType) && !isUnbound(argType)) {
                        // If the specified base class is type(T), use the metaclass
                        // of T if it's known.
                        if (
                            isClass(argType) &&
                            TypeBase.getInstantiableDepth(argType) > 0 &&
                            argType.shared.effectiveMetaclass &&
                            isClass(argType.shared.effectiveMetaclass)
                        ) {
                            argType = argType.shared.effectiveMetaclass;
                        }

                        if (isMetaclassInstance(argType)) {
                            assert(isClassInstance(argType));
                            argType =
                                argType.priv.typeArgs && argType.priv.typeArgs.length > 0
                                    ? argType.priv.typeArgs[0]
                                    : UnknownType.create();
                        } else if (!isInstantiableClass(argType)) {
                            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.baseClassInvalid(), arg);
                            argType = UnknownType.create();
                        } else {
                            if (
                                ClassType.isPartiallyEvaluated(argType) ||
                                argType.shared.mro.some((t) => isClass(t) && ClassType.isPartiallyEvaluated(t))
                            ) {
                                // If the base class is partially evaluated, install a callback
                                // so we can fix up this class (e.g. compute the MRO) when the
                                // dependent class is completed.
                                registerDeferredClassCompletion(node, argType);
                            }

                            if (ClassType.isBuiltIn(argType, 'Protocol')) {
                                if (
                                    !fileInfo.isStubFile &&
                                    !ClassType.isTypingExtensionClass(argType) &&
                                    PythonVersion.isLessThan(
                                        fileInfo.executionEnvironment.pythonVersion,
                                        pythonVersion3_7
                                    )
                                ) {
                                    addDiagnostic(
                                        DiagnosticRule.reportInvalidTypeForm,
                                        LocMessage.protocolIllegal(),
                                        arg.d.valueExpr
                                    );
                                }
                                classType.shared.flags |= ClassTypeFlags.ProtocolClass;
                            }

                            if (ClassType.isBuiltIn(argType, 'property')) {
                                classType.shared.flags |= ClassTypeFlags.PropertyClass;
                            }

                            // If the class directly derives from NamedTuple (in Python 3.6 or
                            // newer), it's considered a (read-only) dataclass.
                            if (
                                PythonVersion.isGreaterOrEqualTo(
                                    fileInfo.executionEnvironment.pythonVersion,
                                    pythonVersion3_6
                                )
                            ) {
                                if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                                    isNamedTupleSubclass = true;
                                }
                            }

                            // If the class directly derives from TypedDict or from a class that is
                            // a TypedDict, it is considered a TypedDict.
                            if (ClassType.isBuiltIn(argType, 'TypedDict') || ClassType.isTypedDictClass(argType)) {
                                classType.shared.flags |= ClassTypeFlags.TypedDictClass;

                                // Propagate the "effectively closed" flag from base classes.
                                if (ClassType.isTypedDictEffectivelyClosed(argType)) {
                                    classType.shared.flags |= ClassTypeFlags.TypedDictEffectivelyClosed;
                                }
                            }

                            // Validate that the class isn't deriving from itself, creating a
                            // circular dependency.
                            if (derivesFromClassRecursive(argType, classType, /* ignoreUnknown */ true)) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.baseClassCircular(),
                                    arg
                                );
                                argType = UnknownType.create();
                            }

                            // If the class is attempting to derive from a TypeAliasType,
                            // generate an error.
                            if (
                                argType.props?.specialForm &&
                                ClassType.isBuiltIn(argType.props.specialForm, 'TypeAliasType')
                            ) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.typeAliasTypeBaseClass(),
                                    arg
                                );
                                argType = UnknownType.create();
                            }
                        }
                    }

                    if (isUnknown(argType)) {
                        addDiagnostic(DiagnosticRule.reportUntypedBaseClass, LocMessage.baseClassUnknown(), arg);
                    }

                    // Check for a duplicate class.
                    if (
                        classType.shared.baseClasses.some((prevBaseClass) => {
                            return (
                                isInstantiableClass(prevBaseClass) &&
                                isInstantiableClass(argType) &&
                                ClassType.isSameGenericClass(argType, prevBaseClass)
                            );
                        })
                    ) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.duplicateBaseClass(),
                            arg.d.name || arg
                        );
                    }

                    classType.shared.baseClasses.push(argType);
                    if (isInstantiableClass(argType)) {
                        if (ClassType.isEnumClass(argType)) {
                            classType.shared.flags |= ClassTypeFlags.EnumClass;
                        }

                        // Determine if the class is abstract. Protocol classes support abstract methods
                        // because they are constructed by the _ProtocolMeta metaclass, which derives
                        // from ABCMeta.
                        if (ClassType.supportsAbstractMethods(argType) || ClassType.isProtocolClass(argType)) {
                            classType.shared.flags |= ClassTypeFlags.SupportsAbstractMethods;
                        }

                        if (ClassType.isPropertyClass(argType)) {
                            classType.shared.flags |= ClassTypeFlags.PropertyClass;
                        }

                        if (ClassType.isFinal(argType)) {
                            const className = printObjectTypeForClass(argType);
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.baseClassFinal().format({ type: className }),
                                arg.d.valueExpr
                            );
                        }
                    }

                    addTypeVarsToListIfUnique(typeParams, getTypeVarArgsRecursive(argType));
                    if (isInstantiableClass(argType)) {
                        if (ClassType.isBuiltIn(argType, 'Generic')) {
                            // 'Generic' is implicitly added if type parameter syntax is used.
                            if (node.d.typeParams) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.genericBaseClassNotAllowed(),
                                    arg.d.valueExpr
                                );
                            } else {
                                if (!genericTypeParams) {
                                    if (protocolTypeParams) {
                                        addDiagnostic(
                                            DiagnosticRule.reportGeneralTypeIssues,
                                            LocMessage.duplicateGenericAndProtocolBase(),
                                            arg.d.valueExpr
                                        );
                                    }
                                    genericTypeParams = buildTypeParamsFromTypeArgs(argType);
                                }
                            }
                        } else if (
                            ClassType.isBuiltIn(argType, 'Protocol') &&
                            argType.priv.typeArgs &&
                            argType.priv.typeArgs.length > 0
                        ) {
                            if (!protocolTypeParams) {
                                if (genericTypeParams) {
                                    addDiagnostic(
                                        DiagnosticRule.reportGeneralTypeIssues,
                                        LocMessage.duplicateGenericAndProtocolBase(),
                                        arg.d.valueExpr
                                    );
                                }
                                protocolTypeParams = buildTypeParamsFromTypeArgs(argType);

                                if (node.d.typeParams && protocolTypeParams.length > 0) {
                                    addDiagnostic(
                                        DiagnosticRule.reportGeneralTypeIssues,
                                        LocMessage.protocolBaseClassWithTypeArgs(),
                                        arg.d.valueExpr
                                    );
                                    protocolTypeParams = [];
                                }
                            }
                        }
                    }
                } else if (ClassType.isTypedDictClass(classType)) {
                    if (arg.d.name.d.value === 'total' || arg.d.name.d.value === 'closed') {
                        // The "total" and "readonly" parameters apply only for TypedDict classes.
                        // PEP 589 specifies that the parameter must be either True or False.
                        const constArgValue = evaluateStaticBoolExpression(
                            arg.d.valueExpr,
                            fileInfo.executionEnvironment,
                            fileInfo.definedConstants
                        );

                        if (constArgValue === undefined) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typedDictBoolParam().format({ name: arg.d.name.d.value }),
                                arg.d.valueExpr
                            );
                        } else if (arg.d.name.d.value === 'total' && !constArgValue) {
                            classType.shared.flags |= ClassTypeFlags.CanOmitDictValues;
                        } else if (arg.d.name.d.value === 'closed') {
                            if (constArgValue) {
                                classType.shared.flags |=
                                    ClassTypeFlags.TypedDictMarkedClosed | ClassTypeFlags.TypedDictEffectivelyClosed;

                                if (classType.shared.typedDictExtraItemsExpr) {
                                    addDiagnostic(
                                        DiagnosticRule.reportGeneralTypeIssues,
                                        LocMessage.typedDictExtraItemsClosed(),
                                        classType.shared.typedDictExtraItemsExpr
                                    );
                                }
                            } else {
                                // PEP 728: A class that subclasses from a non-open TypedDict
                                // cannot specify closed=False.
                                const nonOpenBase = classType.shared.baseClasses.find(
                                    (base) =>
                                        isInstantiableClass(base) &&
                                        ClassType.isTypedDictClass(base) &&
                                        ClassType.isTypedDictEffectivelyClosed(base)
                                );
                                if (nonOpenBase) {
                                    addDiagnostic(
                                        DiagnosticRule.reportGeneralTypeIssues,
                                        LocMessage.typedDictClosedFalseNonOpenBase().format({
                                            name: (nonOpenBase as ClassType).shared.name,
                                        }),
                                        arg.d.valueExpr
                                    );
                                }
                            }

                            if (sawClosedOrExtraItems) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.typedDictExtraItemsClosed(),
                                    arg.d.valueExpr
                                );
                            }

                            sawClosedOrExtraItems = true;
                        }
                    } else if (arg.d.name.d.value === 'extra_items') {
                        // Record a reference to the expression but don't evaluate it yet.
                        // It may refer to the class itself.
                        classType.shared.typedDictExtraItemsExpr = arg.d.valueExpr;
                        classType.shared.flags |= ClassTypeFlags.TypedDictEffectivelyClosed;

                        if (ClassType.isTypedDictMarkedClosed(classType)) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typedDictExtraItemsClosed(),
                                classType.shared.typedDictExtraItemsExpr
                            );
                        }

                        if (sawClosedOrExtraItems) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typedDictExtraItemsClosed(),
                                arg.d.valueExpr
                            );
                        }

                        sawClosedOrExtraItems = true;
                    } else {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typedDictInitsubclassParameter().format({ name: arg.d.name.d.value }),
                            arg
                        );
                    }
                } else if (arg.d.name.d.value === 'metaclass') {
                    if (metaclassNode) {
                        addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.metaclassDuplicate(), arg);
                    } else {
                        metaclassNode = arg.d.valueExpr;
                    }
                } else {
                    // Collect arguments that will be passed to the `__init_subclass__`
                    // method described in PEP 487.
                    initSubclassArgs.push({
                        argCategory: ArgCategory.Simple,
                        node: arg,
                        name: arg.d.name,
                        valueExpression: arg.d.valueExpr,
                    });
                }
            });

            // Check for NamedTuple multiple inheritance.
            if (classType.shared.baseClasses.length > 1) {
                let derivesFromNamedTuple = false;
                let foundIllegalBaseClass = false;

                classType.shared.baseClasses.forEach((baseClass) => {
                    if (isInstantiableClass(baseClass)) {
                        if (ClassType.isBuiltIn(baseClass, 'NamedTuple')) {
                            derivesFromNamedTuple = true;
                        } else if (!ClassType.isBuiltIn(baseClass, 'Generic')) {
                            foundIllegalBaseClass = true;
                        }
                    }
                });

                if (derivesFromNamedTuple && foundIllegalBaseClass) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.namedTupleMultipleInheritance(),
                        node.d.name
                    );
                }
            }

            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (
                !ClassType.isBuiltIn(classType, 'object') &&
                classType.shared.baseClasses.filter((baseClass) => isClass(baseClass)).length === 0
            ) {
                // If there are no other (known) base classes, the class implicitly derives from object.
                classType.shared.baseClasses.push(getBuiltInType(node, 'object'));
            }

            // If genericTypeParams or protocolTypeParams are provided,
            // make sure that typeParams is a proper subset.
            genericTypeParams = genericTypeParams ?? protocolTypeParams;
            if (genericTypeParams && !node.d.typeParams) {
                verifyGenericTypeParams(node.d.name, typeParams, genericTypeParams);
            }
            classType.shared.typeParams = genericTypeParams ?? typeParams;

            // Determine if one or more type parameters is autovariance.
            if (
                classType.shared.typeParams.some(
                    (param) =>
                        param.shared.declaredVariance === Variance.Auto && param.priv.computedVariance === undefined
                )
            ) {
                classType.shared.requiresVarianceInference = true;
            }

            // Make sure there's at most one TypeVarTuple.
            const variadics = typeParams.filter((param) => isTypeVarTuple(param));
            if (variadics.length > 1) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.variadicTypeParamTooManyClass().format({
                        names: variadics.map((v) => `"${v.shared.name}"`).join(', '),
                    }),
                    node.d.name,
                    TextRange.combine(node.d.arguments) || node.d.name
                );
            } else if (variadics.length > 0) {
                // Make sure a TypeVar with a default doesn't come after a TypeVarTuple.
                const firstVariadicIndex = typeParams.findIndex((param) => isTypeVarTuple(param));
                const typeVarWithDefaultIndex = typeParams.findIndex(
                    (param, index) =>
                        index > firstVariadicIndex && !isParamSpec(param) && param.shared.isDefaultExplicit
                );

                if (typeVarWithDefaultIndex >= 0) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeVarWithDefaultFollowsVariadic().format({
                            typeVarName: typeParams[typeVarWithDefaultIndex].shared.name,
                            variadicName: typeParams[firstVariadicIndex].shared.name,
                        }),
                        node.d.typeParams ? node.d.typeParams.d.params[typeVarWithDefaultIndex].d.name : node.d.name
                    );
                }
            }

            // Validate the default types for all type parameters.
            classType.shared.typeParams.forEach((typeParam, index) => {
                let bestErrorNode: ExpressionNode = node.d.name;
                if (node.d.typeParams && index < node.d.typeParams.d.params.length) {
                    const typeParamNode = node.d.typeParams.d.params[index];
                    bestErrorNode = typeParamNode.d.defaultExpr ?? typeParamNode.d.name;
                }
                validateTypeParamDefault(
                    bestErrorNode,
                    typeParam,
                    classType.shared.typeParams.slice(0, index),
                    classType.shared.typeVarScopeId!
                );
            });

            if (!computeMroLinearization(classType)) {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.methodOrdering(), node.d.name);
            }

            // The scope for this class becomes the "fields" for the corresponding type.
            const innerScope = getScopeForNode(node.d.suite);
            classType.shared.fields = innerScope?.symbolTable
                ? new Map<string, Symbol>(innerScope.symbolTable)
                : new Map<string, Symbol>();

            // Determine whether the class should inherit __hash__. If a class defines
            // __eq__ but doesn't define __hash__ then __hash__ is set to None.
            if (classType.shared.fields.has('__eq__') && !classType.shared.fields.has('__hash__')) {
                classType.shared.fields.set(
                    '__hash__',
                    Symbol.createWithType(
                        SymbolFlags.ClassMember |
                            SymbolFlags.ClassVar |
                            SymbolFlags.IgnoredForProtocolMatch |
                            SymbolFlags.IgnoredForOverrideChecks,
                        getNoneType()
                    )
                );
            }

            // Determine whether the class's instance variables are constrained
            // to those defined by __slots__. We need to do this prior to dataclass
            // processing because dataclasses can implicitly add to the slots
            // list.
            const slotsNames = innerScope?.getSlotsNames();
            if (slotsNames) {
                classType.shared.localSlotsNames = slotsNames;
            }
            classType.shared.hasNonEmptySlots = innerScope?.hasNonEmptySlots;

            // Determine if the class should be a "pseudo-generic" class, characterized
            // by having an __init__ method with parameters that lack type annotations.
            // For such classes, we'll treat them as generic, with the type arguments provided
            // by the callers of the constructor.
            if (!fileInfo.isStubFile && classType.shared.typeParams.length === 0) {
                const initMethod = classType.shared.fields.get('__init__');
                if (initMethod) {
                    const initDecls = initMethod.getTypedDeclarations();
                    if (initDecls.length === 1 && initDecls[0].type === DeclarationType.Function) {
                        const initDeclNode = initDecls[0].node;
                        const initParams = initDeclNode.d.params;

                        if (
                            initParams.length > 1 &&
                            !initParams.some(
                                (param, index) => !!ParseTreeUtils.getTypeAnnotationForParam(initDeclNode, index)
                            )
                        ) {
                            const genericParams = initParams.filter(
                                (param, index) =>
                                    index > 0 &&
                                    param.d.name &&
                                    param.d.category === ParamCategory.Simple &&
                                    !param.d.defaultValue
                            );

                            if (genericParams.length > 0) {
                                classType.shared.flags |= ClassTypeFlags.PseudoGenericClass;

                                // Create a type parameter for each simple, named parameter
                                // in the __init__ method.
                                classType.shared.typeParams = genericParams.map((param) => {
                                    const typeVar = TypeVarType.createInstance(
                                        getPseudoGenericTypeVarName(param.d.name!.d.value)
                                    );
                                    typeVar.shared.isSynthesized = true;
                                    typeVar.priv.scopeId = getScopeIdForNode(initDeclNode);
                                    typeVar.shared.boundType = UnknownType.create();
                                    return TypeVarType.cloneForScopeId(
                                        typeVar,
                                        getScopeIdForNode(node),
                                        node.d.name.d.value,
                                        TypeVarScopeType.Class
                                    );
                                });
                            }
                        }
                    }
                }
            }

            // Determine if the class has a custom __class_getitem__ method. This applies
            // only to classes that have no type parameters, since those with type parameters
            // are assumed to follow normal subscripting semantics for generic classes.
            if (classType.shared.typeParams.length === 0 && !ClassType.isBuiltIn(classType, 'type')) {
                if (
                    classType.shared.baseClasses.some(
                        (baseClass) => isInstantiableClass(baseClass) && ClassType.hasCustomClassGetItem(baseClass)
                    ) ||
                    classType.shared.fields.has('__class_getitem__')
                ) {
                    classType.shared.flags |= ClassTypeFlags.HasCustomClassGetItem;
                }
            }

            // Determine the effective metaclass.
            if (metaclassNode) {
                let metaclassType = getTypeOfExpression(metaclassNode, exprFlags).type;
                if (isAny(metaclassType)) {
                    metaclassType = UnknownType.create();
                }
                if (isInstantiableClass(metaclassType) || isUnknown(metaclassType)) {
                    if (requiresSpecialization(metaclassType, { ignorePseudoGeneric: true })) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.metaclassIsGeneric(),
                            metaclassNode
                        );
                    }

                    // If the specified metaclass is type(T), use the metaclass
                    // of T if it's known.
                    if (
                        TypeBase.getInstantiableDepth(metaclassType) > 0 &&
                        isClass(metaclassType) &&
                        metaclassType.shared.effectiveMetaclass &&
                        isClass(metaclassType.shared.effectiveMetaclass)
                    ) {
                        metaclassType = metaclassType.shared.effectiveMetaclass;
                    }

                    classType.shared.declaredMetaclass = metaclassType;
                    if (isInstantiableClass(metaclassType)) {
                        if (isEnumMetaclass(metaclassType)) {
                            classType.shared.flags |= ClassTypeFlags.EnumClass;
                        }

                        if (derivesFromStdlibClass(metaclassType, 'ABCMeta')) {
                            classType.shared.flags |= ClassTypeFlags.SupportsAbstractMethods;
                        }
                    }
                } else {
                    // Callable metaclasses can return classes with different equality semantics.
                    classType.shared.flags |= ClassTypeFlags.HasUnresolvedMetaclass;
                }
            }

            const effectiveMetaclass = computeEffectiveMetaclass(classType, node.d.name);
            const enumMemberSetMayBeDynamicallyModified =
                ClassType.isEnumClass(classType) &&
                (nodeInfo.getScope(node)?.hasPotentiallyDynamicSymbolTable ||
                    classType.shared.mro.some(
                        (mroClass) => isClass(mroClass) && ClassType.isEnumMemberSetMayBeDynamicallyModified(mroClass)
                    ));

            if (enumMemberSetMayBeDynamicallyModified) {
                classType.shared.flags |= ClassTypeFlags.EnumMemberSetMayBeDynamicallyModified;
            }

            if (
                ClassType.isEnumClass(classType) &&
                (node.d.decorators.length > 0 ||
                    enumMemberSetMayBeDynamicallyModified ||
                    !isInstantiableClass(effectiveMetaclass) ||
                    !ClassType.isBuiltIn(effectiveMetaclass, ['EnumMeta', 'EnumType']) ||
                    classType.shared.mro.some(
                        (mroClass) =>
                            isClass(mroClass) &&
                            (ClassType.isEnumMemberSetMayBeIncomplete(mroClass) ||
                                (!ClassType.isBuiltIn(mroClass, 'Enum') &&
                                    ClassType.getSymbolTable(mroClass).has('_missing_')))
                    ))
            ) {
                classType.shared.flags |= ClassTypeFlags.EnumMemberSetMayBeIncomplete;
            }

            // Clear the "partially constructed" flag.
            classType.shared.flags &= ~ClassTypeFlags.PartiallyEvaluated;
            synthesizeEnumBoundary(evaluatorInterface, classType, initSubclassArgs);

            // Now determine the decorated type of the class.
            let decoratedType: Type = classType;
            let isDecoratedTypeUnknown = false;
            let foundUnknown = false;

            for (let i = node.d.decorators.length - 1; i >= 0; i--) {
                const decorator = node.d.decorators[i];

                const newDecoratedType = useSignatureTracker(node.parent ?? node, () =>
                    applyClassDecorator(
                        evaluatorInterface,
                        decoratedType,
                        classType,
                        decorator,
                        nodeInfo,
                        isDecoratedTypeUnknown
                    )
                );
                const unknownOrAny = containsAnyOrUnknown(newDecoratedType, /* recurse */ false);

                if (unknownOrAny && isUnknown(unknownOrAny)) {
                    isDecoratedTypeUnknown = true;

                    // Report this error only on the first unknown type.
                    if (!foundUnknown) {
                        addDiagnostic(
                            DiagnosticRule.reportUntypedClassDecorator,
                            LocMessage.classDecoratorTypeUnknown(),
                            node.d.decorators[i].d.expr
                        );

                        foundUnknown = true;
                    }
                } else {
                    // Preserving the recovery type also preserves its uncertainty.
                    isDecoratedTypeUnknown = isDecoratedTypeUnknown && isTypeSame(newDecoratedType, decoratedType);

                    // Apply the decorator only if the type is known.
                    decoratedType = newDecoratedType;
                }
            }

            // Determine whether this class derives from (or has a metaclass) that imbues
            // it with dataclass-like behaviors. If so, we'll apply those here.
            let dataClassBehaviors: DataClassBehaviors | undefined;
            if (isInstantiableClass(effectiveMetaclass) && effectiveMetaclass.shared.classDataClassTransform) {
                dataClassBehaviors = effectiveMetaclass.shared.classDataClassTransform;
            } else {
                const baseClassDataTransform = classType.shared.mro.find((mroClass) => {
                    return (
                        isClass(mroClass) &&
                        mroClass.shared.classDataClassTransform !== undefined &&
                        !ClassType.isSameGenericClass(mroClass, classType)
                    );
                });

                if (baseClassDataTransform) {
                    dataClassBehaviors = (baseClassDataTransform as ClassType).shared.classDataClassTransform;
                }
            }

            if (dataClassBehaviors) {
                applyDataClassClassBehaviorOverrides(
                    evaluatorInterface,
                    node.d.name,
                    classType,
                    initSubclassArgs,
                    dataClassBehaviors,
                    nodeInfo
                );
            }

            // Run any deferred class completions that depend on this class.
            runDeferredClassCompletions(classType);

            // If there are any outstanding deferred class completions registered that
            // were not removed by the call to runDeferredClassCompletions, assume that
            // the current class may depend on them and register for deferred completion.
            registerDeferredClassCompletion(node, /* dependsUpon */ undefined);

            // Synthesize TypedDict methods.
            if (ClassType.isTypedDictClass(classType)) {
                // TypedDict classes must derive only from other TypedDict classes.
                let foundInvalidBaseClass = false;
                const diag = new DiagnosticAddendum();

                classType.shared.baseClasses.forEach((baseClass) => {
                    if (
                        isClass(baseClass) &&
                        !ClassType.isTypedDictClass(baseClass) &&
                        !ClassType.isBuiltIn(baseClass, ['_TypedDict', 'TypedDictFallback', 'Generic'])
                    ) {
                        foundInvalidBaseClass = true;
                        diag.addMessage(LocAddendum.typedDictBaseClass().format({ type: baseClass.shared.name }));
                    }
                });

                if (foundInvalidBaseClass) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typedDictBaseClass() + diag.getString(),
                        node.d.name
                    );
                }

                synthesizeTypedDictClassMethods(evaluatorInterface, node, classType, nodeInfo);
            }

            // Synthesize dataclass methods.
            if (ClassType.isDataClass(classType) || isNamedTupleSubclass) {
                const skipSynthesizedInit = ClassType.isDataClassSkipGenerateInit(classType);
                let hasExistingInitMethod = skipSynthesizedInit;

                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                if (!skipSynthesizedInit) {
                    const initSymbol = classType.shared.fields.get('__init__');
                    if (initSymbol && initSymbol.isClassMember()) {
                        hasExistingInitMethod = true;
                    }
                }

                let skipSynthesizeHash = false;
                const hashSymbol = classType.shared.fields.get('__hash__');

                // If there is a hash symbol defined in the class (i.e. one that we didn't
                // synthesize above), then we shouldn't synthesize a new one for the dataclass.
                if (hashSymbol && hashSymbol.isClassMember() && !hashSymbol.getSynthesizedType()) {
                    skipSynthesizeHash = true;
                }

                const synthesizeMethods = () =>
                    synthesizeDataClassMethods(
                        evaluatorInterface,
                        node,
                        classType,
                        isNamedTupleSubclass,
                        skipSynthesizedInit,
                        hasExistingInitMethod,
                        skipSynthesizeHash,
                        nodeInfo
                    );

                // If this is a NamedTuple subclass, immediately synthesize dataclass methods
                // because we also need to update the MRO classes in this case. For regular
                // dataclasses, we'll defer the  method synthesis to avoid circular dependencies.
                if (isNamedTupleSubclass) {
                    synthesizeMethods();
                } else {
                    if (ClassType.isDataClassGenerateSlots(classType)) {
                        classType.shared.synthesizeDataClassSlotsDeferred = () =>
                            synthesizeDataClassSlots(evaluatorInterface, classType);
                    }

                    classType.shared.synthesizeMethodsDeferred = () => {
                        delete classType.shared.synthesizeMethodsDeferred;
                        synthesizeMethods();
                    };
                }
            }

            // Build a complete list of all slots names defined by the class hierarchy.
            // This needs to be done after dataclass processing.
            classType.shared.calculateInheritedSlotsNamesDeferred = () => {
                delete classType.shared.calculateInheritedSlotsNamesDeferred;

                if (classType.shared.localSlotsNames) {
                    let isLimitedToSlots = true;
                    const extendedSlotsNames = Array.from(classType.shared.localSlotsNames);

                    classType.shared.baseClasses.forEach((baseClass) => {
                        if (isInstantiableClass(baseClass)) {
                            if (
                                !ClassType.isBuiltIn(baseClass, 'object') &&
                                !ClassType.isBuiltIn(baseClass, 'type') &&
                                !ClassType.isBuiltIn(baseClass, 'Generic')
                            ) {
                                const inheritedSlotsNames = ClassType.getInheritedSlotsNames(baseClass);
                                if (inheritedSlotsNames) {
                                    appendArray(extendedSlotsNames, inheritedSlotsNames);
                                } else {
                                    isLimitedToSlots = false;
                                }
                            }
                        } else {
                            isLimitedToSlots = false;
                        }
                    });

                    if (isLimitedToSlots) {
                        classType.shared.inheritedSlotsNamesCached = extendedSlotsNames;
                    }
                }
            };

            // If Any is defined using a class statement, treat it as a special form.
            if (node.d.name.d.value === 'Any' && fileInfo.isTypingStubFile) {
                decoratedType = AnyType.createSpecialForm();
            }

            // Update the undecorated class type.
            writeTypeCache(node.d.name, { type: classType }, EvalFlags.None);

            // Update the decorated class type.
            writeTypeCache(node, { type: decoratedType }, EvalFlags.None);

            return { classType, decoratedType };
        });
    }

    function buildTypeParamsFromTypeArgs(classType: ClassType): TypeVarType[] {
        return classConstruction.buildTypeParamsFromTypeArgs(classType);
    }

    // Determines whether the type parameters has a default that refers to another
    // type parameter. If so, validates that it is in the list of "live" type
    // parameters and updates the scope of the type parameter referred to in the
    // default type expression.
    function validateTypeParamDefault(
        errorNode: ExpressionNode,
        typeParam: TypeVarType,
        otherLiveTypeParams: TypeVarType[],
        scopeId: TypeVarScopeId
    ) {
        return specialFormCreation.validateTypeParamDefault(errorNode, typeParam, otherLiveTypeParams, scopeId);
    }

    function inferVarianceForClass(classType: ClassType): void {
        return typeVarHandling.inferVarianceForClass(classType);
    }

    function evaluateTypeParamList(node: TypeParameterListNode): TypeVarType[] {
        const paramTypes: TypeVarType[] = [];
        const typeParamScope = nodeInfo.getScope(node);

        node.d.params.forEach((param) => {
            const paramSymbol = typeParamScope?.symbolTable.get(param.d.name.d.value);
            if (!paramSymbol) {
                // This can happen if the code is unreachable.
                return;
            }

            const typeOfParam = getDeclaredTypeOfSymbol(paramSymbol, param.d.name)?.type;
            if (!typeOfParam || !isTypeVar(typeOfParam)) {
                return;
            }

            writeTypeCache(param.d.name, { type: typeOfParam }, EvalFlags.None);
            paramTypes.push(typeOfParam);
        });

        return paramTypes;
    }

    function computeEffectiveMetaclass(classType: ClassType, errorNode: ParseNode) {
        return classConstruction.computeEffectiveMetaclass(classType, errorNode);
    }

    // Verifies that the type variables provided outside of "Generic"
    // or "Protocol" are also provided within the "Generic". For example:
    //    class Foo(Mapping[K, V], Generic[V])
    // is illegal because K is not included in Generic.
    function verifyGenericTypeParams(
        errorNode: ExpressionNode,
        typeVars: TypeVarType[],
        genericTypeVars: TypeVarType[]
    ) {
        return specialFormCreation.verifyGenericTypeParams(errorNode, typeVars, genericTypeVars);
    }

    // Records the fact that the specified class requires "deferred completion" because
    // one of its base classes has not yet been fully evaluated. If the caller passes
    // undefined for "dependsUpon", then the class is added to all outstanding deferred
    // completions.
    function registerDeferredClassCompletion(classToComplete: ClassNode, dependsUpon: ClassType | undefined) {
        if (dependsUpon) {
            // See if there is an existing entry for this dependency.
            const entry = deferredClassCompletions.find((e) =>
                ClassType.isSameGenericClass(e.dependsUpon, dependsUpon)
            );
            if (entry) {
                entry.classesToComplete.push(classToComplete);
            } else {
                deferredClassCompletions.push({ dependsUpon, classesToComplete: [classToComplete] });
            }
        } else {
            deferredClassCompletions.forEach((e) => {
                e.classesToComplete.push(classToComplete);
            });
        }
    }

    // Runs any registered "deferred class completions" that depend on the specified
    // class type. This allows us to complete any work that requires dependent classes
    // to be completed.
    function runDeferredClassCompletions(type: ClassType) {
        deferredClassCompletions.forEach((e) => {
            if (ClassType.isSameGenericClass(e.dependsUpon, type)) {
                e.classesToComplete.forEach((classNode) => {
                    const classType = readTypeCache(classNode.d.name, EvalFlags.None);
                    if (classType) {
                        completeClassTypeDeferred(classType as ClassType, classNode.d.name);
                    }
                });
            }
        });

        // Remove any completions that depend on this type.
        deferredClassCompletions = deferredClassCompletions.filter(
            (e) => !ClassType.isSameGenericClass(e.dependsUpon, type)
        );
    }

    // Recomputes the MRO and effective metaclass for the class after dependent
    // classes have been fully constructed.
    function completeClassTypeDeferred(type: ClassType, errorNode: ParseNode) {
        // Recompute the MRO linearization.
        if (!computeMroLinearization(type)) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.methodOrdering(), errorNode);
        }

        // Recompute the effective metaclass.
        computeEffectiveMetaclass(type, errorNode);
    }

    function validateInitSubclassArgs(node: ClassNode, classType: ClassType) {
        // Collect arguments that will be passed to the `__init_subclass__`
        // method described in PEP 487 and validate it.
        const argList: Arg[] = [];

        node.d.arguments.forEach((arg) => {
            if (arg.d.name && arg.d.name.d.value !== 'metaclass') {
                argList.push({
                    argCategory: ArgCategory.Simple,
                    node: arg,
                    name: arg.d.name,
                    valueExpression: arg.d.valueExpr,
                });
            }
        });

        let newMethodMember: ClassMember | undefined;

        // See if the class has a metaclass that overrides `__new__`. If so, we
        // will validate the signature of the `__new__` method.
        if (classType.shared.effectiveMetaclass && isClass(classType.shared.effectiveMetaclass)) {
            // If the metaclass is 'type' or 'ABCMeta', we'll assume it will call through to
            // __init_subclass__, so we'll skip the `__new__` method check. We need to exclude
            // TypedDict classes here because _TypedDict uses ABCMeta as its metaclass, but its
            // typeshed definition doesn't override __init_subclass__.
            const metaclassCallsInitSubclass =
                ClassType.isBuiltIn(classType.shared.effectiveMetaclass, ['ABCMeta', 'type']) &&
                !ClassType.isTypedDictClass(classType);

            if (!metaclassCallsInitSubclass) {
                // See if the metaclass has a `__new__` method that accepts keyword parameters.
                newMethodMember = lookUpClassMember(
                    classType.shared.effectiveMetaclass,
                    '__new__',
                    MemberAccessFlags.SkipTypeBaseClass
                );
            }
        }

        if (newMethodMember) {
            const newMethodType = getTypeOfMember(newMethodMember);
            if (isFunction(newMethodType)) {
                const paramListDetails = getParamListDetails(newMethodType);

                if (paramListDetails.firstKeywordOnlyIndex !== undefined) {
                    // Build a map of the keyword-only parameters.
                    const paramMap = new Map<string, number>();
                    for (let i = paramListDetails.firstKeywordOnlyIndex; i < paramListDetails.params.length; i++) {
                        const paramInfo = paramListDetails.params[i];
                        if (
                            paramInfo.param.category === ParamCategory.Simple &&
                            paramInfo.param.name &&
                            paramInfo.kind !== ParamKind.Positional
                        ) {
                            paramMap.set(paramInfo.param.name, i);
                        }
                    }

                    argList.forEach((arg) => {
                        if (arg.argCategory === ArgCategory.Simple && arg.name) {
                            const paramIndex = paramMap.get(arg.name.d.value) ?? paramListDetails.kwargsIndex;

                            if (paramIndex !== undefined) {
                                const paramInfo = paramListDetails.params[paramIndex];
                                const argParam: ValidateArgTypeParams = {
                                    paramCategory: paramInfo.param.category,
                                    paramType: paramInfo.type,
                                    requiresTypeVarMatching: false,
                                    argument: arg,
                                    errorNode: arg.valueExpression ?? node.d.name,
                                };

                                validateArgType(
                                    argParam,
                                    new ConstraintTracker(),
                                    { type: newMethodType },
                                    { skipUnknownArgCheck: true }
                                );
                                paramMap.delete(arg.name.d.value);
                            } else {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.paramNameMissing().format({ name: arg.name.d.value }),
                                    arg.name ?? node.d.name
                                );
                            }
                        }
                    });

                    // See if we have any remaining unmatched parameters without
                    // default values.
                    const unassignedParams: string[] = [];
                    paramMap.forEach((index, paramName) => {
                        const paramInfo = paramListDetails.params[index];
                        if (!paramInfo.defaultType) {
                            unassignedParams.push(paramName);
                        }
                    });

                    if (unassignedParams.length > 0) {
                        const missingParamNames = unassignedParams.map((p) => `"${p}"`).join(', ');
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            unassignedParams.length === 1
                                ? LocMessage.argMissingForParam().format({ name: missingParamNames })
                                : LocMessage.argMissingForParams().format({ names: missingParamNames }),
                            node.d.name
                        );
                    }
                }
            }
        } else {
            // If there was no custom metaclass __new__ method, see if there is an __init_subclass__
            // method present somewhere in the class hierarchy.
            const initSubclassMethodInfo = getTypeOfBoundMember(
                node.d.name,
                classType,
                '__init_subclass__',
                /* usage */ undefined,
                /* diag */ undefined,
                MemberAccessFlags.SkipClassMembers |
                    MemberAccessFlags.SkipOriginalClass |
                    MemberAccessFlags.SkipAttributeAccessOverride
            );

            if (initSubclassMethodInfo) {
                const initSubclassMethodType = initSubclassMethodInfo.type;

                if (initSubclassMethodType && initSubclassMethodInfo.classType) {
                    const callResult = validateCallArgs(
                        node.d.name,
                        argList,
                        { type: initSubclassMethodType },
                        /* constraints */ undefined,
                        /* skipUnknownArgCheck */ false,
                        makeInferenceContext(getNoneType())
                    );

                    if (callResult.argumentErrors) {
                        const diag = addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.initSubclassCallFailed(),
                            node.d.name
                        );

                        const initSubclassFunction = isOverloaded(initSubclassMethodType)
                            ? OverloadedType.getOverloads(initSubclassMethodType)[0]
                            : initSubclassMethodType;
                        const initSubclassDecl = isFunction(initSubclassFunction)
                            ? initSubclassFunction.shared.declaration
                            : undefined;

                        if (diag && initSubclassDecl) {
                            diag.addRelatedInfo(
                                LocAddendum.initSubclassLocation().format({
                                    name: printType(convertToInstance(initSubclassMethodInfo.classType)),
                                }),
                                initSubclassDecl.uri,
                                initSubclassDecl.range
                            );
                        }
                    }
                }
            }
        }

        // Evaluate all of the expressions so they are checked and marked referenced.
        argList.forEach((arg) => {
            if (arg.valueExpression) {
                getTypeOfExpression(arg.valueExpression);
            }
        });
    }

    function getTypeOfFunction(node: FunctionNode): FunctionTypeResult | undefined {
        initializePrefetchedTypes(node);

        // Is this predecorated function type cached?
        let functionType = readTypeCache(node.d.name, EvalFlags.None);

        if (functionType) {
            if (!isFunction(functionType)) {
                // This can happen in certain rare circumstances where the
                // function declaration falls within an unreachable code block.
                return undefined;
            }

            if (FunctionType.isPartiallyEvaluated(functionType)) {
                return { functionType, decoratedType: functionType };
            }
        } else {
            functionType = getTypeOfFunctionPredecorated(node);
        }

        // Is the decorated function type cached?
        let decoratedType = readTypeCache(node, EvalFlags.None);
        if (decoratedType) {
            return { functionType, decoratedType };
        }

        // Populate the cache with a temporary value to handle recursion.
        writeTypeCache(node, { type: functionType }, /* flags */ undefined);

        // If it's an async function, wrap the return type in an Awaitable or Generator.
        // Set the "partially evaluated" flag around this logic to detect recursion.
        functionType.shared.flags |= FunctionTypeFlags.PartiallyEvaluated;
        const preDecoratedType = node.d.isAsync ? createAsyncFunction(node, functionType) : functionType;

        // Apply all of the decorators in reverse order.
        decoratedType = preDecoratedType;
        let foundUnknown = false;
        for (let i = node.d.decorators.length - 1; i >= 0; i--) {
            const decorator = node.d.decorators[i];

            const newDecoratedType = useSignatureTracker(node.parent ?? node, () => {
                assert(decoratedType !== undefined);
                return applyFunctionDecorator(
                    evaluatorInterface,
                    decoratedType,
                    functionType,
                    decorator,
                    node,
                    nodeInfo
                );
            });

            const unknownOrAny = containsAnyOrUnknown(newDecoratedType, /* recurse */ false);

            if (unknownOrAny && isUnknown(unknownOrAny)) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        DiagnosticRule.reportUntypedFunctionDecorator,
                        LocMessage.functionDecoratorTypeUnknown(),
                        node.d.decorators[i].d.expr
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
            if (
                (FunctionType.isClassMethod(decoratedType) || FunctionType.isStaticMethod(decoratedType)) &&
                decoratedType.shared.declaration !== functionType.shared.declaration
            ) {
                // A wrapper can replace the signature without replacing the
                // declaration that supplies the enclosing method descriptor.
                decoratedType = FunctionType.clone(decoratedType);
                decoratedType.shared.declaration = functionType.shared.declaration;
            }
            decoratedType.shared.deprecatedMessage = functionType.shared.deprecatedMessage;

            if (FunctionType.isOverloaded(decoratedType)) {
                // Mark all the parameters as accessed.
                node.d.params.forEach((param) => {
                    markParamAccessed(param);
                });
            }
        }

        decoratedType = addOverloadsToFunctionType(evaluatorInterface, node, decoratedType, nodeInfo);

        writeTypeCache(node, { type: decoratedType }, EvalFlags.None);

        // Now that the decorator has been applied, we can clear the
        // "partially evaluated" flag.
        functionType.shared.flags &= ~FunctionTypeFlags.PartiallyEvaluated;

        return { functionType, decoratedType };
    }

    // Evaluates the type of a "def" statement without applying an async
    // modifier or any decorators.
    function getTypeOfFunctionPredecorated(node: FunctionNode): FunctionType {
        const fileInfo = nodeInfo.getFileInfo(node);

        // Is this type already cached?
        const cachedFunctionType = readTypeCache(node.d.name, EvalFlags.None);

        if (cachedFunctionType && isFunction(cachedFunctionType)) {
            return cachedFunctionType;
        }

        let functionDecl: FunctionDeclaration | undefined;
        const decl = nodeInfo.getDeclaration(node);
        if (decl) {
            functionDecl = decl as FunctionDeclaration;
        }

        // There was no cached type, so create a new one.
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
        let containingClassType: ClassType | undefined;
        if (containingClassNode) {
            containingClassType = getTypeOfClass(containingClassNode)?.classType;
        }

        const functionInfo = getFunctionInfoFromDecorators(evaluatorInterface, node, !!containingClassNode, nodeInfo);
        let functionFlags = functionInfo.flags;
        if (functionDecl?.isGenerator) {
            functionFlags |= FunctionTypeFlags.Generator;
        }

        if (fileInfo.isStubFile) {
            functionFlags |= FunctionTypeFlags.StubDefinition;
        } else if (fileInfo.isInPyTypedPackage) {
            functionFlags |= FunctionTypeFlags.PyTypedDefinition;
        }

        if (node.d.isAsync) {
            functionFlags |= FunctionTypeFlags.Async;
        }

        const functionType = FunctionType.createInstance(
            node.d.name.d.value,
            getFunctionFullName(node, fileInfo.moduleName, node.d.name.d.value),
            fileInfo.moduleName,
            functionFlags | FunctionTypeFlags.PartiallyEvaluated,
            ParseTreeUtils.getDocString(node.d.suite.d.statements)
        );

        functionType.shared.typeVarScopeId = getScopeIdForNode(node);
        functionType.shared.deprecatedMessage = functionInfo.deprecationMessage;
        functionType.shared.methodClass = containingClassType;

        if (node.d.name.d.value === '__init__' || node.d.name.d.value === '__new__') {
            if (containingClassNode) {
                functionType.priv.constructorTypeVarScopeId = getScopeIdForNode(containingClassNode);
            }
        }

        if (fileInfo.isBuiltInStubFile || fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
            // Mark the function as a built-in stdlib function.
            functionType.shared.flags |= FunctionTypeFlags.BuiltIn;
        }

        functionType.shared.declaration = functionDecl;

        // Allow recursion by caching and registering the partially-constructed function type.
        const scope = getScopeForNode(node);
        const functionSymbol = scope?.lookUpSymbolRecursive(node.d.name.d.value);
        if (functionDecl && functionSymbol) {
            setSymbolResolutionPartialType(functionSymbol.symbol, functionDecl, functionType);
        }

        return invalidateTypeCacheIfCanceled(() => {
            writeTypeCache(node.d.name, { type: functionType }, /* flags */ undefined);

            // Is this an "__init__" method within a pseudo-generic class? If so,
            // we'll add generic types to the constructor's parameters.
            const addGenericParamTypes =
                containingClassType &&
                ClassType.isPseudoGenericClass(containingClassType) &&
                node.d.name.d.value === '__init__';

            const paramTypes: Type[] = [];

            // Determine if the first parameter should be skipped for comment-based
            // function annotations.
            let firstCommentAnnotationIndex = 0;
            if (containingClassType && (functionType.shared.flags & FunctionTypeFlags.StaticMethod) === 0) {
                firstCommentAnnotationIndex = 1;
            }

            // If there is a function annotation comment, validate that it has the correct
            // number of parameter annotations.
            if (node.d.funcAnnotationComment && !node.d.funcAnnotationComment.d.isEllipsis) {
                const expected = node.d.params.length - firstCommentAnnotationIndex;
                const received = node.d.funcAnnotationComment.d.paramAnnotations.length;

                // For methods with "self" or "cls" parameters, the annotation list
                // can either include or exclude the annotation for the first parameter.
                if (firstCommentAnnotationIndex > 0 && received === node.d.params.length) {
                    firstCommentAnnotationIndex = 0;
                } else if (received !== expected) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.annotatedParamCountMismatch().format({
                            expected,
                            received,
                        }),
                        node.d.funcAnnotationComment
                    );
                }
            }

            // If this function uses PEP 695 syntax for type parameters,
            // accumulate the list of type parameters upfront.
            const typeParamsSeen: TypeVarType[] = [];
            if (node.d.typeParams) {
                functionType.shared.typeParams = evaluateTypeParamList(node.d.typeParams).map((typeParam) =>
                    convertToInstance(typeParam)
                );
            } else {
                functionType.shared.typeParams = typeParamsSeen;
            }

            let paramsArePositionOnly = true;
            const isFirstParamClsOrSelf =
                containingClassType &&
                (FunctionType.isClassMethod(functionType) ||
                    FunctionType.isInstanceMethod(functionType) ||
                    FunctionType.isConstructorMethod(functionType));
            const firstNonClsSelfParamIndex = isFirstParamClsOrSelf ? 1 : 0;

            node.d.params.forEach((param, index) => {
                let paramType: Type | undefined;
                let annotatedType: Type | undefined;
                let paramTypeNode: ExpressionNode | undefined;

                if (param.d.name) {
                    if (index === 0 && isFirstParamClsOrSelf) {
                        // Mark "self/cls" as accessed.
                        markParamAccessed(param);
                    } else if (FunctionType.isAbstractMethod(functionType)) {
                        // Mark all parameters in abstract methods as accessed.
                        markParamAccessed(param);
                    } else if (containingClassType && ClassType.isProtocolClass(containingClassType)) {
                        // Mark all parameters in protocol methods as accessed.
                        markParamAccessed(param);
                    }
                }

                if (param.d.annotation) {
                    paramTypeNode = param.d.annotation;
                } else if (param.d.annotationComment) {
                    paramTypeNode = param.d.annotationComment;
                } else if (node.d.funcAnnotationComment && !node.d.funcAnnotationComment.d.isEllipsis) {
                    const adjustedIndex = index - firstCommentAnnotationIndex;
                    if (adjustedIndex >= 0 && adjustedIndex < node.d.funcAnnotationComment.d.paramAnnotations.length) {
                        paramTypeNode = node.d.funcAnnotationComment.d.paramAnnotations[adjustedIndex];
                    }
                }

                if (paramTypeNode) {
                    if ((functionInfo.flags & FunctionTypeFlags.NoTypeCheck) !== 0) {
                        annotatedType = UnknownType.create();
                    } else {
                        annotatedType = getTypeOfParamAnnotation(paramTypeNode, param.d.category);
                    }

                    if (annotatedType) {
                        addTypeVarsToListIfUnique(
                            typeParamsSeen,
                            getTypeVarArgsRecursive(annotatedType),
                            functionType.shared.typeVarScopeId
                        );
                    }

                    if (isTypeVarTuple(annotatedType) && !annotatedType.priv.isUnpacked) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.unpackedTypeVarTupleExpected().format({
                                name1: annotatedType.shared.name,
                                name2: annotatedType.shared.name,
                            }),
                            paramTypeNode
                        );
                        annotatedType = UnknownType.create();
                    }
                }

                if (!annotatedType && addGenericParamTypes) {
                    if (
                        index > 0 &&
                        param.d.category === ParamCategory.Simple &&
                        param.d.name &&
                        !param.d.defaultValue
                    ) {
                        const typeParamName = getPseudoGenericTypeVarName(param.d.name.d.value);
                        annotatedType = containingClassType!.shared.typeParams.find(
                            (param) => param.shared.name === typeParamName
                        );
                    }
                }

                if (annotatedType) {
                    const adjustedAnnotatedType = adjustParamAnnotatedType(param, annotatedType);
                    if (adjustedAnnotatedType !== annotatedType) {
                        annotatedType = adjustedAnnotatedType;
                    }
                }

                let defaultValueType: Type | undefined;
                if (param.d.defaultValue) {
                    // If this is a stub file, a protocol, an overload, or a class
                    // whose body is a placeholder implementation, treat a "...", as
                    // an "Any" value.
                    let treatEllipsisAsAny = fileInfo.isStubFile || ParseTreeUtils.isSuiteEmpty(node.d.suite);
                    if (containingClassType && ClassType.isProtocolClass(containingClassType)) {
                        treatEllipsisAsAny = true;
                    }
                    if (FunctionType.isOverloaded(functionType) || FunctionType.isAbstractMethod(functionType)) {
                        treatEllipsisAsAny = true;
                    }

                    defaultValueType = getTypeOfExpression(
                        param.d.defaultValue,
                        treatEllipsisAsAny ? EvalFlags.ConvertEllipsisToAny : EvalFlags.None,
                        makeInferenceContext(annotatedType)
                    ).type;
                }

                if (annotatedType) {
                    // If there was both a type annotation and a default value, verify
                    // that the default value matches the annotation.
                    if (param.d.defaultValue && defaultValueType) {
                        const diagAddendum = new DiagnosticAddendum();

                        if (!assignType(annotatedType, defaultValueType, diagAddendum)) {
                            addDiagnostic(
                                DiagnosticRule.reportArgumentType,
                                LocMessage.paramAssignmentMismatch().format({
                                    sourceType: printType(defaultValueType),
                                    paramType: printType(annotatedType),
                                }) + diagAddendum.getString(),
                                param.d.defaultValue
                            );
                        }
                    }

                    paramType = annotatedType;
                }

                // Determine whether we need to insert an implied position-only parameter.
                // This is needed when a function's parameters are named using the old-style
                // way of specifying position-only parameters.
                if (index >= firstNonClsSelfParamIndex) {
                    let isImplicitPositionOnlyParam = false;

                    if (param.d.category === ParamCategory.Simple && param.d.name) {
                        if (
                            isPrivateName(param.d.name.d.value) &&
                            !node.d.params.some((p) => p.d.category === ParamCategory.Simple && !p.d.name)
                        ) {
                            isImplicitPositionOnlyParam = true;

                            // If the parameter name indicates an implicit position-only parameter
                            // but we have already seen non-position-only parameters, report an error.
                            if (
                                !paramsArePositionOnly &&
                                functionType.shared.parameters.every((p) => p.category === ParamCategory.Simple)
                            ) {
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.positionOnlyAfterNon(),
                                    param.d.name
                                );
                            }
                        }
                    } else {
                        paramsArePositionOnly = false;
                    }

                    if (
                        paramsArePositionOnly &&
                        !isImplicitPositionOnlyParam &&
                        functionType.shared.parameters.length > firstNonClsSelfParamIndex
                    ) {
                        FunctionType.addPositionOnlyParamSeparator(functionType);
                    }

                    if (!isImplicitPositionOnlyParam) {
                        paramsArePositionOnly = false;
                    }
                }

                // If there was no annotation for the parameter, infer its type if possible.
                let isTypeInferred = false;
                if (!paramTypeNode) {
                    isTypeInferred = true;
                    const inferredType = inferParamType(node, functionType.shared.flags, index, containingClassType);
                    if (inferredType) {
                        paramType = inferredType;
                    }
                }

                paramType = paramType ?? UnknownType.create();

                const functionParam = FunctionParam.create(
                    param.d.category,
                    paramType,
                    (isTypeInferred ? FunctionParamFlags.TypeInferred : FunctionParamFlags.None) |
                        (paramTypeNode ? FunctionParamFlags.TypeDeclared : FunctionParamFlags.None),
                    param.d.name ? param.d.name.d.value : undefined,
                    defaultValueType,
                    param.d.defaultValue
                );

                FunctionType.addParam(functionType, functionParam);

                if (FunctionParam.isTypeDeclared(functionParam)) {
                    addTypeVarsToListIfUnique(
                        typeParamsSeen,
                        getTypeVarArgsRecursive(paramType),
                        functionType.shared.typeVarScopeId
                    );
                }

                if (param.d.name) {
                    const variadicParamType = transformVariadicParamType(node, param.d.category, paramType);
                    paramTypes.push(variadicParamType);
                } else {
                    paramTypes.push(paramType);
                }
            });

            if (paramsArePositionOnly && functionType.shared.parameters.length > firstNonClsSelfParamIndex) {
                FunctionType.addPositionOnlyParamSeparator(functionType);
            }

            // Update the types for the nodes associated with the parameters.
            const scopeIds = getTypeVarScopesForNode(node);
            paramTypes.forEach((paramType, index) => {
                const paramNameNode = node.d.params[index].d.name;
                if (paramNameNode) {
                    if (isUnknown(paramType)) {
                        functionType.shared.flags |= FunctionTypeFlags.UnannotatedParams;
                    }

                    paramType = makeTypeVarsBound(paramType, scopeIds);

                    writeTypeCache(paramNameNode, { type: paramType }, EvalFlags.None);
                }
            });

            // If the function ends in P.args and P.kwargs parameters, make it exempt from
            // args/kwargs compatibility checks. This is important for protocol comparisons.
            if (paramTypes.length >= 2) {
                const paramType1 = paramTypes[paramTypes.length - 2];
                const paramType2 = paramTypes[paramTypes.length - 1];
                if (
                    isParamSpec(paramType1) &&
                    paramType1.priv.paramSpecAccess === 'args' &&
                    isParamSpec(paramType2) &&
                    paramType2.priv.paramSpecAccess === 'kwargs'
                ) {
                    functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                }
            }

            // If the function contains an *args and a **kwargs parameter and both
            // are annotated as Any or are unannotated, make it exempt from
            // args/kwargs compatibility checks.
            const variadicsWithAnyType = functionType.shared.parameters.filter(
                (param, index) =>
                    param.category !== ParamCategory.Simple &&
                    param.name &&
                    isAnyOrUnknown(FunctionType.getParamType(functionType, index))
            );
            if (variadicsWithAnyType.length >= 2) {
                functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
            }

            // If there was a defined return type, analyze that first so when we
            // walk the contents of the function, return statements can be
            // validated against this type.
            const returnTypeAnnotationNode =
                node.d.returnAnnotation ?? node.d.funcAnnotationComment?.d.returnAnnotation;
            if (returnTypeAnnotationNode) {
                // Temporarily set the return type to unknown in case of recursion.
                functionType.shared.declaredReturnType = UnknownType.create();

                const returnType = getTypeOfAnnotation(returnTypeAnnotationNode, {
                    typeVarGetsCurScope: true,
                });
                functionType.shared.declaredReturnType = returnType;
            } else {
                // If there was no return type annotation and this is a type stub,
                // we have no opportunity to infer the return type, so we'll indicate
                // that it's unknown.
                if (fileInfo.isStubFile) {
                    // Special-case the __init__ method, which is commonly left without
                    // an annotated return type, but we can assume it returns None.
                    if (node.d.name.d.value === '__init__') {
                        functionType.shared.declaredReturnType = getNoneType();
                    } else {
                        functionType.shared.declaredReturnType = UnknownType.create();
                    }
                }
            }

            // Accumulate any type parameters used in the return type.
            if (functionType.shared.declaredReturnType && returnTypeAnnotationNode) {
                addTypeVarsToListIfUnique(
                    typeParamsSeen,
                    getTypeVarArgsRecursive(functionType.shared.declaredReturnType),
                    functionType.shared.typeVarScopeId
                );
            }

            // Validate the default types for all type parameters.
            functionType.shared.typeParams.forEach((typeParam, index) => {
                let bestErrorNode: ExpressionNode = node.d.name;
                if (node.d.typeParams && index < node.d.typeParams.d.params.length) {
                    const typeParamNode = node.d.typeParams.d.params[index];
                    bestErrorNode = typeParamNode.d.defaultExpr ?? typeParamNode.d.name;
                }

                validateTypeParamDefault(
                    bestErrorNode,
                    typeParam,
                    functionType.shared.typeParams.slice(0, index),
                    functionType.shared.typeVarScopeId!
                );
            });

            // Clear the "partially evaluated" flag to indicate that the functionType
            // is fully evaluated.
            functionType.shared.flags &= ~FunctionTypeFlags.PartiallyEvaluated;

            writeTypeCache(node.d.name, { type: functionType }, EvalFlags.None);

            return functionType;
        });
    }

    function markParamAccessed(param: ParameterNode) {
        if (param.d.name) {
            const symbolWithScope = lookUpSymbolRecursive(
                param.d.name,
                param.d.name.d.value,
                /* honorCodeFlow */ false
            );
            if (symbolWithScope) {
                setSymbolAccessed(nodeInfo.getFileInfo(param), symbolWithScope.symbol, param.d.name);
            }
        }
    }

    // Attempts to infer an unannotated parameter type from available context.
    function inferParamType(
        functionNode: FunctionNode,
        functionFlags: FunctionTypeFlags,
        paramIndex: number,
        containingClassType: ClassType | undefined
    ) {
        // Is the function a method within a class? If so, see if a base class
        // defines the same method and provides annotations.
        if (containingClassType) {
            if (paramIndex === 0) {
                if ((functionFlags & FunctionTypeFlags.StaticMethod) === 0) {
                    const hasClsParam =
                        (functionFlags & (FunctionTypeFlags.ClassMethod | FunctionTypeFlags.ConstructorMethod)) !== 0;
                    return synthesizeTypeVarForSelfCls(containingClassType, hasClsParam);
                }
            }

            const methodName = functionNode.d.name.d.value;

            const baseClassMemberInfo = lookUpClassMember(
                containingClassType,
                methodName,
                MemberAccessFlags.SkipOriginalClass
            );

            if (baseClassMemberInfo) {
                const memberDecls = baseClassMemberInfo.symbol.getDeclarations();
                if (memberDecls.length === 1 && memberDecls[0].type === DeclarationType.Function) {
                    const baseClassMethodNode = memberDecls[0].node;

                    // Does the signature match exactly with the exception of annotations?
                    if (
                        baseClassMethodNode.d.params.length === functionNode.d.params.length &&
                        baseClassMethodNode.d.params.every((param, index) => {
                            const overrideParam = functionNode.d.params[index];
                            return (
                                overrideParam.d.name?.d.value === param.d.name?.d.value &&
                                overrideParam.d.category === param.d.category
                            );
                        })
                    ) {
                        const baseClassParam = baseClassMethodNode.d.params[paramIndex];
                        const baseClassParamAnnotation =
                            baseClassParam.d.annotation ?? baseClassParam.d.annotationComment;
                        if (baseClassParamAnnotation) {
                            let inferredParamType = getTypeOfParamAnnotation(
                                baseClassParamAnnotation,
                                functionNode.d.params[paramIndex].d.category
                            );

                            // If the parameter type is generic, specialize it in the context
                            // of the child class.
                            if (requiresSpecialization(inferredParamType) && isClass(baseClassMemberInfo.classType)) {
                                const scopeIds: TypeVarScopeId[] = getTypeVarScopeIds(baseClassMemberInfo.classType);
                                const solution = buildSolutionFromSpecializedClass(baseClassMemberInfo.classType);

                                scopeIds.push(getScopeIdForNode(baseClassMethodNode));

                                // Replace any unsolved TypeVars with Unknown (including all function-scoped TypeVars).
                                inferredParamType = applySolvedTypeVars(inferredParamType, solution, {
                                    replaceUnsolved: {
                                        scopeIds,
                                        tupleClassType: getTupleClassType(),
                                    },
                                });
                            }

                            const fileInfo = nodeInfo.getFileInfo(functionNode);
                            if (fileInfo.isInPyTypedPackage && !fileInfo.isStubFile) {
                                inferredParamType = TypeBase.cloneForAmbiguousType(inferredParamType);
                            }

                            return inferredParamType;
                        }
                    }
                }
            }
        }

        // If the parameter has a default argument value, we may be able to infer its
        // type from this information.
        const paramValueExpr = functionNode.d.params[paramIndex].d.defaultValue;
        if (paramValueExpr) {
            return inferParamTypeFromDefaultValue(paramValueExpr);
        }

        return undefined;
    }

    function createAsyncFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
        assert(FunctionType.isAsync(functionType));

        // Clone the original function and replace its return type with an
        // Awaitable[<returnType>]. Mark the new function as no longer async.
        const awaitableFunctionType = FunctionType.cloneWithNewFlags(
            functionType,
            functionType.shared.flags & ~(FunctionTypeFlags.Async | FunctionTypeFlags.PartiallyEvaluated)
        );

        if (functionType.shared.declaredReturnType) {
            awaitableFunctionType.shared.declaredReturnType = createAwaitableReturnType(
                node,
                functionType.shared.declaredReturnType,
                FunctionType.isGenerator(functionType)
            );
        } else {
            awaitableFunctionType.shared.inferredReturnType = {
                type: createAwaitableReturnType(
                    node,
                    getInferredReturnType(functionType),
                    FunctionType.isGenerator(functionType)
                ),
            };
        }

        return awaitableFunctionType;
    }

    function createAwaitableReturnType(
        node: ParseNode,
        returnType: Type,
        isGenerator: boolean,
        useCoroutine = true
    ): Type {
        let awaitableReturnType: Type | undefined;

        if (isClassInstance(returnType)) {
            if (ClassType.isBuiltIn(returnType)) {
                if (returnType.shared.name === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = getTypingType(node, 'AsyncGenerator');
                    if (asyncGeneratorType && isInstantiableClass(asyncGeneratorType)) {
                        const typeArgs: Type[] = [];
                        const generatorTypeArgs = returnType.priv.typeArgs;
                        if (generatorTypeArgs && generatorTypeArgs.length > 0) {
                            typeArgs.push(generatorTypeArgs[0]);
                        }
                        if (generatorTypeArgs && generatorTypeArgs.length > 1) {
                            typeArgs.push(generatorTypeArgs[1]);
                        }
                        awaitableReturnType = ClassType.cloneAsInstance(
                            ClassType.specialize(asyncGeneratorType, typeArgs)
                        );
                    }
                } else if (['AsyncIterator', 'AsyncIterable'].some((name) => name === returnType.shared.name)) {
                    // If it's already an AsyncIterator or AsyncIterable, leave it as is.
                    awaitableReturnType = returnType;
                } else if (returnType.shared.name === 'AsyncGenerator') {
                    // If it's already an AsyncGenerator and the function is a generator,
                    // leave it as is.
                    if (isGenerator) {
                        awaitableReturnType = returnType;
                    }
                }
            }
        }

        if (!awaitableReturnType || !isGenerator) {
            // Wrap in either an Awaitable or a CoroutineType, which is a subclass of Awaitable.
            const awaitableType = useCoroutine ? getTypesType(node, 'CoroutineType') : getTypingType(node, 'Awaitable');
            if (awaitableType && isInstantiableClass(awaitableType)) {
                awaitableReturnType = ClassType.cloneAsInstance(
                    ClassType.specialize(
                        awaitableType,
                        useCoroutine ? [AnyType.create(), AnyType.create(), returnType] : [returnType]
                    )
                );
            } else {
                awaitableReturnType = UnknownType.create();
            }
        }

        return awaitableReturnType;
    }

    function inferFunctionReturnType(
        node: FunctionNode,
        isAbstract: boolean,
        callerNode: ExpressionNode | undefined
    ): TypeResult | undefined {
        const returnAnnotation = node.d.returnAnnotation || node.d.funcAnnotationComment?.d.returnAnnotation;

        // This shouldn't be called if there is a declared return type, but it
        // can happen if there are unexpected cycles between decorators and
        // classes that they decorate. We'll just return an undefined type
        // in this case.
        if (returnAnnotation) {
            return undefined;
        }

        // Is this type already cached?
        let inferredReturnType = readTypeCache(node.d.suite, EvalFlags.None);
        let isIncomplete = false;

        if (inferredReturnType) {
            return { type: inferredReturnType, isIncomplete };
        }

        const recursionEntry = functionRecursionMap.get(node.id) ?? [];

        if (functionRecursionMap.size >= maxInferFunctionReturnRecursionCount) {
            inferredReturnType = UnknownType.create();
            isIncomplete = true;
        } else if (recursionEntry.some((entry) => entry.callerNode === callerNode)) {
            inferredReturnType = UnknownType.create();
            isIncomplete = true;
        } else {
            recursionEntry.push({ callerNode });
            functionRecursionMap.set(node.id, recursionEntry);

            try {
                let functionDecl: FunctionDeclaration | undefined;
                const decl = nodeInfo.getDeclaration(node);
                if (decl) {
                    functionDecl = decl as FunctionDeclaration;
                }

                const functionNeverReturns = !isAfterNodeReachable(node);
                const implicitlyReturnsNone = isAfterNodeReachable(node.d.suite);

                // Infer the return type based on all of the return statements in the function's body.
                if (nodeInfo.getFileInfo(node).isStubFile) {
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
                            inferredReturnType = NeverType.createNoReturn();
                        }
                    } else {
                        const inferredReturnTypes: Type[] = [];
                        if (functionDecl?.returnStatements) {
                            functionDecl.returnStatements.forEach((returnNode) => {
                                if (isNodeReachable(returnNode)) {
                                    if (returnNode.d.expr) {
                                        const returnTypeResult = getTypeOfExpression(returnNode.d.expr);
                                        if (returnTypeResult.isIncomplete) {
                                            isIncomplete = true;
                                        }

                                        let returnType = returnTypeResult.type;

                                        // If the type is a special form, use the special form instead.
                                        if (returnType.props?.specialForm) {
                                            returnType = returnType.props.specialForm;
                                        }

                                        // If the return type includes an instance of a class with isEmptyContainer
                                        // set, clear that because we don't want this flag to "leak" into the
                                        // inferred return type.
                                        returnType = mapSubtypes(returnType, (subtype) => {
                                            if (isClassInstance(subtype) && subtype.priv.isEmptyContainer) {
                                                return ClassType.specialize(
                                                    subtype,
                                                    subtype.priv.typeArgs,
                                                    !!subtype.priv.isTypeArgExplicit,
                                                    subtype.priv.includeSubclasses,
                                                    subtype.priv.tupleTypeArgs,
                                                    /* isEmptyContainer */ false
                                                );
                                            }
                                            return subtype;
                                        });

                                        // Do not retain TypeForm types in inferred return types.
                                        returnType = stripTypeForm(returnType);

                                        // If we're returning a function value (or overload), force
                                        // lazy return-type inference before caching this function's
                                        // inferred return. Without this, a partially evaluated
                                        // function can leak a temporary Any return type (for example,
                                        // immediately after an edit), and that Any then gets cached
                                        // as though it were final for the enclosing function.
                                        inferReturnTypeIfNecessary(returnType);

                                        inferredReturnTypes.push(returnType);
                                    } else {
                                        inferredReturnTypes.push(getNoneType());
                                    }
                                }
                            });
                        }

                        if (!functionNeverReturns && implicitlyReturnsNone) {
                            inferredReturnTypes.push(getNoneType());
                        }

                        inferredReturnType = combineTypes(inferredReturnTypes);

                        // Remove any unbound values since those would generate an exception
                        // before being returned.
                        inferredReturnType = removeUnbound(inferredReturnType);
                    }

                    // Is it a generator?
                    if (functionDecl?.isGenerator) {
                        const inferredYieldTypes: Type[] = [];
                        let useAwaitableGenerator = false;
                        let isYieldResultUsed = false;

                        if (functionDecl.yieldStatements) {
                            functionDecl.yieldStatements.forEach((yieldNode) => {
                                if (isNodeReachable(yieldNode)) {
                                    if (yieldNode.nodeType === ParseNodeType.YieldFrom) {
                                        isYieldResultUsed = true;
                                        const iteratorTypeResult = getTypeOfExpression(yieldNode.d.expr);
                                        if (
                                            isClassInstance(iteratorTypeResult.type) &&
                                            ClassType.isBuiltIn(iteratorTypeResult.type, ['Coroutine', 'CoroutineType'])
                                        ) {
                                            const yieldType =
                                                iteratorTypeResult.type.priv.typeArgs &&
                                                iteratorTypeResult.type.priv.typeArgs.length > 0
                                                    ? iteratorTypeResult.type.priv.typeArgs[0]
                                                    : UnknownType.create();

                                            // Handle old-style (pre-await) Coroutines.
                                            inferredYieldTypes.push(yieldType);
                                            useAwaitableGenerator = true;
                                        } else {
                                            const yieldType = getTypeOfIterator(
                                                iteratorTypeResult,
                                                /* isAsync */ false,
                                                yieldNode
                                            )?.type;

                                            inferredYieldTypes.push(yieldType ?? UnknownType.create());
                                        }
                                    } else {
                                        // If the yield expression is not by itself in a statement list,
                                        // assume that its result is consumed.
                                        if (yieldNode?.parent?.nodeType !== ParseNodeType.StatementList) {
                                            isYieldResultUsed = true;
                                        }

                                        if (yieldNode.d.expr) {
                                            const yieldType = getTypeOfExpression(yieldNode.d.expr).type;
                                            inferredYieldTypes.push(yieldType ?? UnknownType.create());
                                        } else {
                                            inferredYieldTypes.push(getNoneType());
                                        }
                                    }
                                }
                            });
                        }

                        const inferredYieldType = combineTypes(inferredYieldTypes);

                        // Inferred yield types need to be wrapped in a Generator or
                        // AwaitableGenerator to produce the final result.
                        const generatorType = useAwaitableGenerator
                            ? getTypeCheckerInternalsType(node, 'AwaitableGenerator') ??
                              getTypingType(node, 'AwaitableGenerator')
                            : getTypingType(node, 'Generator');

                        if (generatorType && isInstantiableClass(generatorType)) {
                            const typeArgs: Type[] = [];

                            // The "send type" for the generator (the second type argument) is
                            // not generally inferrable, but we can assume that it's Any
                            // if the function never uses the value and Unknown if it does.
                            // This eliminates any "partially unknown" errors in strict mode
                            // in the common case.
                            const sendType = isYieldResultUsed ? UnknownType.create() : AnyType.create();

                            typeArgs.push(inferredYieldType, sendType, inferredReturnType);

                            if (useAwaitableGenerator) {
                                typeArgs.push(AnyType.create());
                            }

                            inferredReturnType = ClassType.cloneAsInstance(
                                ClassType.specialize(generatorType, typeArgs)
                            );
                        } else {
                            inferredReturnType = UnknownType.create();
                        }
                    }
                }

                writeTypeCache(node.d.suite, { type: inferredReturnType, isIncomplete }, EvalFlags.None);
            } catch (err) {
                // Attempt to handle a stack overflow without crashing. In rare
                // cases, we can get very deep stacks when inferring return types
                // within untyped code.
                if ((err as any)?.message === 'Maximum call stack size exceeded') {
                    const fileInfo = nodeInfo.getFileInfo(node);
                    console.error(
                        `Overflowed stack when inferring return type for function: ${
                            node.d.name.d.value
                        } in file ${fileInfo.fileUri.toUserVisibleString()}`
                    );
                    return;
                }
                throw err;
            } finally {
                recursionEntry.pop();
                if (recursionEntry.length === 0) {
                    functionRecursionMap.delete(node.id);
                }
            }
        }

        return inferredReturnType ? { type: inferredReturnType, isIncomplete } : undefined;
    }

    // Determines whether the method consists only of a "raise" statement
    // and the exception type raised is a NotImplementedError or a subclass
    // thereof. This is commonly used for abstract methods.
    function methodAlwaysRaisesNotImplemented(functionDecl?: FunctionDeclaration): boolean {
        return evaluatorCore.methodAlwaysRaisesNotImplemented(functionDecl);
    }

    function evaluateTypesForForStatement(node: ForNode): void {
        if (isTypeCached(node)) {
            return;
        }

        const iteratorTypeResult = getTypeOfExpression(node.d.iterableExpr);
        const iteratedType =
            getTypeOfIterator(iteratorTypeResult, !!node.d.isAsync, node.d.iterableExpr)?.type ?? UnknownType.create();

        assignTypeToExpression(
            node.d.targetExpr,
            { type: iteratedType, isIncomplete: iteratorTypeResult.isIncomplete },
            node.d.targetExpr
        );

        writeTypeCache(node, { type: iteratedType, isIncomplete: !!iteratorTypeResult.isIncomplete }, EvalFlags.None);
    }

    function evaluateTypesForExceptStatement(node: ExceptNode): void {
        // This should be called only if the except node has a target exception.
        assert(node.d.typeExpr !== undefined);

        if (isTypeCached(node)) {
            return;
        }

        const exceptionTypeResult = getTypeOfExpression(node.d.typeExpr!);
        const exceptionTypes = exceptionTypeResult.type;
        let includesBaseException = false;

        function getExceptionType(exceptionType: Type, errorNode: ExpressionNode) {
            exceptionType = makeTopLevelTypeVarsConcrete(exceptionType);

            if (isAnyOrUnknown(exceptionType)) {
                return exceptionType;
            }

            if (isInstantiableClass(exceptionType)) {
                if (
                    derivesFromStdlibClass(exceptionType, 'BaseException') &&
                    !derivesFromStdlibClass(exceptionType, 'Exception')
                ) {
                    includesBaseException = true;
                }
                return ClassType.cloneAsInstance(exceptionType);
            }

            if (isClassInstance(exceptionType)) {
                const iterableType =
                    getTypeOfIterator(
                        { type: exceptionType, isIncomplete: exceptionTypeResult.isIncomplete },
                        /* isAsync */ false,
                        errorNode,
                        /* emitNotIterableError */ false
                    )?.type ?? UnknownType.create();

                return mapSubtypes(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        return subtype;
                    }

                    return UnknownType.create();
                });
            }

            return UnknownType.create();
        }

        let targetType = mapSubtypes(exceptionTypes, (subType) => {
            // If more than one type was specified for the exception, we'll receive
            // a specialized tuple object here.
            const tupleType = getSpecializedTupleType(subType);
            if (tupleType && tupleType.priv.tupleTypeArgs) {
                const entryTypes = tupleType.priv.tupleTypeArgs.map((t) => {
                    return getExceptionType(t.type, node.d.typeExpr!);
                });
                return combineTypes(entryTypes);
            }

            return getExceptionType(subType, node.d.typeExpr!);
        });

        // If this is an except group, use a BaseExceptionGroup when it can contain
        // an exception outside the Exception hierarchy.
        if (node.d.isExceptGroup) {
            targetType = getBuiltInObject(node, includesBaseException ? 'BaseExceptionGroup' : 'ExceptionGroup', [
                targetType,
            ]);
        }

        if (node.d.name) {
            assignTypeToExpression(node.d.name, { type: targetType }, node.d.name);
        }

        writeTypeCache(node, { type: targetType }, EvalFlags.None);
    }

    function evaluateTypesForWithStatement(node: WithItemNode): void {
        if (isTypeCached(node)) {
            return;
        }

        const exprTypeResult = getTypeOfExpression(node.d.expr);
        let isIncomplete = exprTypeResult.isIncomplete;
        let exprType = exprTypeResult.type;
        const isAsync = node.parent && node.parent.nodeType === ParseNodeType.With && !!node.parent.d.isAsync;

        if (isOptionalType(exprType)) {
            addDiagnostic(
                DiagnosticRule.reportOptionalContextManager,
                isAsync ? LocMessage.noneNotUsableWithAsync() : LocMessage.noneNotUsableWith(),
                node.d.expr
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

            const enterDiag = new DiagnosticAddendum();

            if (isClass(subtype)) {
                const enterTypeResult = getTypeOfMagicMethodCall(
                    subtype,
                    enterMethodName,
                    [],
                    node.d.expr,
                    /* inferenceContext */ undefined,
                    enterDiag.createAddendum()
                );

                if (enterTypeResult) {
                    if (isAsync) {
                        if (enterTypeResult.isIncomplete) {
                            isIncomplete = true;
                        }

                        const asyncResult = getTypeOfAwaitable({ type: enterTypeResult.type }, node.d.expr);
                        if (asyncResult.isIncomplete) {
                            isIncomplete = true;
                        }

                        return asyncResult.type;
                    }
                    return enterTypeResult.type;
                }

                if (!isAsync) {
                    if (
                        getTypeOfMagicMethodCall(
                            subtype,
                            '__aenter__',
                            [],
                            node.d.expr,
                            /* inferenceContext */ undefined
                        )?.type
                    ) {
                        enterDiag.addMessage(LocAddendum.asyncHelp());
                    }
                }
            }

            const message = isAsync ? LocMessage.typeNotUsableWithAsync() : LocMessage.typeNotUsableWith();
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                message.format({ type: printType(subtype), method: enterMethodName }) + enterDiag.getString(),
                node.d.expr
            );
            return UnknownType.create();
        });

        // Verify that the target has an __exit__ or __aexit__ method defined.
        const exitMethodName = isAsync ? '__aexit__' : '__exit__';
        const exitDiag = new DiagnosticAddendum();

        doForEachSubtype(exprType, (subtype) => {
            subtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isAnyOrUnknown(subtype)) {
                return;
            }

            if (isClass(subtype)) {
                const anyArg: TypeResult = { type: AnyType.create() };
                const exitTypeResult = getTypeOfMagicMethodCall(
                    subtype,
                    exitMethodName,
                    [anyArg, anyArg, anyArg],
                    node.d.expr,
                    /* inferenceContext */ undefined,
                    exitDiag
                );

                if (exitTypeResult) {
                    if (exitTypeResult.isIncomplete) {
                        isIncomplete = true;
                    }

                    if (isAsync) {
                        const asyncResult = getTypeOfAwaitable({ type: exitTypeResult.type }, node.d.expr);
                        if (asyncResult.isIncomplete) {
                            isIncomplete = true;
                        }

                        return asyncResult.type;
                    }

                    return exitTypeResult.type;
                }
            }

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeNotUsableWith().format({ type: printType(subtype), method: exitMethodName }) +
                    exitDiag.getString(),
                node.d.expr
            );
            return UnknownType.create();
        });

        if (node.d.target) {
            assignTypeToExpression(node.d.target, { type: scopedType, isIncomplete }, node.d.target);
        }

        writeTypeCache(node, { type: scopedType, isIncomplete }, EvalFlags.None);
    }

    function evaluateTypesForImportAs(node: ImportAsNode): void {
        if (isTypeCached(node)) {
            return;
        }

        let symbolNameNode: NameNode;
        if (node.d.alias) {
            // The symbol name is defined by the alias.
            symbolNameNode = node.d.alias;
        } else {
            // There was no alias, so we need to use the first element of
            // the name parts as the symbol.
            symbolNameNode = node.d.module.d.nameParts[0];
        }

        if (!symbolNameNode) {
            // This can happen in certain cases where there are parse errors.
            return;
        }

        // Look up the symbol to find the alias declaration.
        let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.d.value) ?? UnknownType.create();

        // Is there a cached module type associated with this node? If so, use
        // it instead of the type we just created.
        const cachedModuleType = readTypeCache(node, EvalFlags.None) as ModuleType;
        if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
            if (isTypeSame(symbolType, cachedModuleType)) {
                symbolType = cachedModuleType;
            }
        }

        assignTypeToNameNode(symbolNameNode, { type: symbolType }, /* ignoreEmptyContainers */ false);

        writeTypeCache(node, { type: symbolType }, EvalFlags.None);
    }

    function evaluateTypesForImportFromAs(node: ImportFromAsNode): void {
        if (isTypeCached(node)) {
            return;
        }

        const aliasNode = node.d.alias || node.d.name;
        const fileInfo = nodeInfo.getFileInfo(node);

        // If this is a redundant form of an import, assume it is an intentional
        // export and mark the symbol as accessed.
        if (node.d.alias?.d.value === node.d.name.d.value) {
            const symbolInScope = lookUpSymbolRecursive(node, node.d.name.d.value, /* honorCodeFlow */ true);
            if (symbolInScope) {
                setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
            }
        }

        // If this is an import into a class scope, mark the symbol as accessed.
        const classNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
        if (classNode) {
            const symbolInScope = lookUpSymbolRecursive(node, aliasNode.d.value, /* honorCodeFlow */ true);
            if (symbolInScope) {
                setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
            }
        }

        let symbolType = getAliasedSymbolTypeForName(node, aliasNode.d.value);
        if (!symbolType) {
            const parentNode = node.parent as ImportFromNode;
            assert(parentNode && parentNode.nodeType === ParseNodeType.ImportFrom);
            assert(!parentNode.d.isWildcardImport);

            const importInfo = nodeInfo.getImportInfo(parentNode.d.module);
            if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
                const resolvedPath = importInfo.resolvedUris[importInfo.resolvedUris.length - 1];

                const importLookupInfo = importLookup(resolvedPath);
                let reportError = false;

                // If we were able to resolve the import, report the error as
                // an unresolved symbol.
                if (importLookupInfo) {
                    reportError = true;

                    // Handle PEP 562 support for module-level __getattr__ function,
                    // introduced in Python 3.7.
                    if (
                        PythonVersion.isGreaterOrEqualTo(
                            fileInfo.executionEnvironment.pythonVersion,
                            pythonVersion3_7
                        ) ||
                        fileInfo.isStubFile
                    ) {
                        const getAttrSymbol = importLookupInfo.symbolTable.get('__getattr__');
                        if (getAttrSymbol) {
                            const getAttrType = getEffectiveTypeOfSymbol(getAttrSymbol);
                            if (isFunction(getAttrType)) {
                                symbolType = getEffectiveReturnType(getAttrType);
                                reportError = false;
                            }
                        }
                    }
                } else if (resolvedPath.isEmpty()) {
                    // This corresponds to the "from . import a" form.
                    reportError = true;
                }

                if (reportError) {
                    addDiagnostic(
                        DiagnosticRule.reportAttributeAccessIssue,
                        LocMessage.importSymbolUnknown().format({ name: node.d.name.d.value }),
                        node.d.name
                    );
                }
            }

            if (!symbolType) {
                symbolType = UnknownType.create();
            }
        }

        assignTypeToNameNode(aliasNode, { type: symbolType }, /* ignoreEmptyContainers */ false);
        writeTypeCache(node, { type: symbolType }, EvalFlags.None);
    }

    function evaluateTypesForMatchStatement(node: MatchNode): void {
        if (isTypeCached(node)) {
            return;
        }

        const subjectTypeResult = getTypeOfExpression(node.d.expr);
        let subjectType = subjectTypeResult.type;

        // Apply negative narrowing for each of the cases that doesn't have a guard statement.
        for (const caseStatement of node.d.cases) {
            if (!caseStatement.d.guardExpr) {
                subjectType = narrowTypeBasedOnPattern(
                    evaluatorInterface,
                    subjectType,
                    caseStatement.d.pattern,
                    /* isPositiveTest */ false,
                    nodeInfo
                );
            }
        }

        writeTypeCache(node, { type: subjectType, isIncomplete: !!subjectTypeResult.isIncomplete }, EvalFlags.None);
    }

    function evaluateTypesForCaseStatement(node: CaseNode): void {
        if (isTypeCached(node)) {
            return;
        }

        if (!node.parent || node.parent.nodeType !== ParseNodeType.Match) {
            fail('Expected parent of case statement to be match statement');
            return;
        }

        const fileInfo = nodeInfo.getFileInfo(node);
        const subjectTypeResult = getTypeOfExpression(node.parent.d.expr);
        let subjectType = subjectTypeResult.type;

        // Apply negative narrowing for each of the cases prior to the current one
        // except for those that have a guard expression.
        for (const caseStatement of node.parent.d.cases) {
            if (caseStatement === node) {
                if (fileInfo.diagnosticRuleSet.reportUnnecessaryComparison !== 'none') {
                    if (!subjectTypeResult.isIncomplete) {
                        checkForUnusedPattern(evaluatorInterface, node.d.pattern, subjectType, nodeInfo);
                    }
                }
                break;
            }

            if (!caseStatement.d.guardExpr) {
                subjectType = narrowTypeBasedOnPattern(
                    evaluatorInterface,
                    subjectType,
                    caseStatement.d.pattern,
                    /* isPositiveTest */ false,
                    nodeInfo
                );
            }
        }

        const narrowedSubjectType = assignTypeToPatternTargets(
            evaluatorInterface,
            subjectType,
            !!subjectTypeResult.isIncomplete,
            node.d.pattern,
            nodeInfo
        );

        writeTypeCache(
            node,
            { type: narrowedSubjectType, isIncomplete: !!subjectTypeResult.isIncomplete },
            EvalFlags.None
        );
    }

    function evaluateTypesForImportFrom(node: ImportFromNode): void {
        if (isTypeCached(node)) {
            return;
        }

        if (node.d.isWildcardImport) {
            // Write back a dummy type so we don't evaluate this node again.
            writeTypeCache(node, { type: AnyType.create() }, EvalFlags.None);

            const flowNode = nodeInfo.getFlowNode(node);
            if (flowNode && (flowNode.flags & FlowFlags.WildcardImport) !== 0) {
                const wildcardFlowNode = flowNode as FlowWildcardImport;
                wildcardFlowNode.names.forEach((name) => {
                    const importedSymbolType = getAliasedSymbolTypeForName(node, name);

                    if (!importedSymbolType) {
                        return;
                    }

                    const symbolWithScope = lookUpSymbolRecursive(node, name, /* honorCodeFlow */ false);
                    if (!symbolWithScope) {
                        return;
                    }

                    const declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol)?.type;
                    if (!declaredType) {
                        return;
                    }

                    const diagAddendum = new DiagnosticAddendum();

                    if (!assignType(declaredType, importedSymbolType, diagAddendum)) {
                        addDiagnostic(
                            DiagnosticRule.reportAssignmentType,
                            LocMessage.typeAssignmentMismatchWildcard().format({
                                ...printSrcDestTypes(importedSymbolType, declaredType),
                                name,
                            }) + diagAddendum.getString(),
                            node,
                            node.d.wildcardToken ?? node
                        );
                    }
                });
            }
        } else {
            // Use the first element of the name parts as the symbol.
            const symbolNameNode = node.d.module.d.nameParts[0];

            // Look up the symbol to find the alias declaration.
            let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.d.value);
            if (!symbolType) {
                return;
            }

            // Is there a cached module type associated with this node? If so, use
            // it instead of the type we just created.
            const cachedModuleType = readTypeCache(node, EvalFlags.None) as ModuleType;
            if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
                if (isTypeSame(symbolType, cachedModuleType)) {
                    symbolType = cachedModuleType;
                }
            }

            assignTypeToNameNode(symbolNameNode, { type: symbolType }, /* ignoreEmptyContainers */ false);

            writeTypeCache(node, { type: symbolType }, EvalFlags.None);
        }
    }

    function evaluateTypesForTypeAnnotationNode(node: TypeAnnotationNode) {
        // If this node is part of an assignment statement, use specialized
        // logic that performs bidirectional inference and assignment
        // type narrowing.
        if (node.parent?.nodeType === ParseNodeType.Assignment) {
            evaluateTypesForAssignmentStatement(node.parent);
        } else {
            const annotationType = getTypeOfAnnotation(node.d.annotation, {
                varTypeAnnotation: true,
                allowFinal: isFinalAllowedForAssignmentTarget(node.d.valueExpr),
                allowClassVar: isClassVarAllowedForAssignmentTarget(node.d.valueExpr),
            });

            writeTypeCache(node.d.valueExpr, { type: annotationType }, EvalFlags.None);
        }
    }

    function getAliasedSymbolTypeForName(
        node: ImportAsNode | ImportFromAsNode | ImportFromNode,
        name: string
    ): Type | undefined {
        return memberResolution.getAliasedSymbolTypeForName(node, name);
    }

    // In some cases, an expression must be evaluated in the context of another
    // expression or statement that contains it. This contextual evaluation
    // allows for bidirectional type evaluation.
    function evaluateTypesForExpressionInContext(node: ExpressionNode): void {
        // Check for a couple of special cases where the node is a NameNode but
        // is technically not part of an expression. We'll handle these here so
        // callers don't need to include special-case logic.
        if (node.nodeType === ParseNodeType.Name && node.parent) {
            if (node.parent.nodeType === ParseNodeType.Function && node.parent.d.name === node) {
                getTypeOfFunction(node.parent);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.Class && node.parent.d.name === node) {
                getTypeOfClass(node.parent);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.ImportFromAs) {
                evaluateTypesForImportFromAs(node.parent);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.ImportAs) {
                evaluateTypesForImportAs(node.parent);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.TypeAlias && node.parent.d.name === node) {
                getTypeOfTypeAlias(node.parent);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.Global || node.parent.nodeType === ParseNodeType.Nonlocal) {
                // For global and nonlocal statements, allow forward references so
                // we don't use code flow during symbol lookups.
                getTypeOfExpression(node, EvalFlags.ForwardRefs);
                return;
            }

            if (node.parent.nodeType === ParseNodeType.ModuleName) {
                // A name within a module name isn't an expression,
                // so there's nothing we can evaluate here.
                return;
            }
        }

        // If the expression is part of a type annotation, we need to evaluate
        // it with special evaluation flags.
        const annotationNode = ParseTreeUtils.getParentAnnotationNode(node);
        if (annotationNode) {
            // Annotations need to be evaluated with specialized evaluation flags.
            const annotationParent = annotationNode.parent;
            assert(annotationParent !== undefined);

            if (annotationParent.nodeType === ParseNodeType.Assignment) {
                if (annotationNode === annotationParent.d.annotationComment) {
                    getTypeOfAnnotation(annotationNode, {
                        varTypeAnnotation: true,
                        allowFinal: isFinalAllowedForAssignmentTarget(annotationParent.d.leftExpr),
                        allowClassVar: isClassVarAllowedForAssignmentTarget(annotationParent.d.leftExpr),
                    });
                } else {
                    evaluateTypesForAssignmentStatement(annotationParent);
                }
                return;
            }

            if (annotationParent.nodeType === ParseNodeType.TypeAnnotation) {
                evaluateTypesForTypeAnnotationNode(annotationParent);
                return;
            }

            if (
                annotationParent.nodeType === ParseNodeType.Function &&
                annotationNode === annotationParent.d.returnAnnotation
            ) {
                getTypeOfAnnotation(annotationNode, {
                    typeVarGetsCurScope: true,
                });
                return;
            }

            getTypeOfAnnotation(annotationNode, {
                varTypeAnnotation: annotationNode.parent?.nodeType === ParseNodeType.TypeAnnotation,
                allowUnpackedTuple:
                    annotationParent.nodeType === ParseNodeType.Parameter &&
                    annotationParent.d.category === ParamCategory.ArgsList,
                allowUnpackedTypedDict:
                    annotationParent.nodeType === ParseNodeType.Parameter &&
                    annotationParent.d.category === ParamCategory.KwargsDict,
            });
            return;
        }

        // See if the expression is part of a pattern used in a case statement.
        const possibleCaseNode = ParseTreeUtils.getParentNodeOfType<CaseNode>(node, ParseNodeType.Case);
        if (possibleCaseNode) {
            if (ParseTreeUtils.isNodeContainedWithin(node, possibleCaseNode.d.pattern)) {
                evaluateTypesForCaseStatement(possibleCaseNode);
                return;
            }
        }

        // Scan up the parse tree until we find a node that doesn't
        // require any context to be evaluated.
        let nodeToEvaluate: ExpressionNode = node;
        let flags = EvalFlags.None;

        while (true) {
            // If we're within an argument node in a call or index expression, skip
            // all of the nodes between because the entire argument expression
            // needs to be evaluated contextually.
            const argumentNode = ParseTreeUtils.getParentNodeOfType(nodeToEvaluate, ParseNodeType.Argument);
            if (argumentNode && argumentNode !== nodeToEvaluate) {
                assert(argumentNode.parent !== undefined);

                if (
                    argumentNode.parent.nodeType === ParseNodeType.Call ||
                    argumentNode.parent.nodeType === ParseNodeType.Index
                ) {
                    nodeToEvaluate = argumentNode.parent;
                    continue;
                }

                if (argumentNode.parent.nodeType === ParseNodeType.Class) {
                    // If this is an argument node within a class declaration,
                    // evaluate the full class declaration node.
                    getTypeOfClass(argumentNode.parent);
                    return;
                }
            }

            let parent = nodeToEvaluate.parent;
            if (!parent) {
                break;
            }

            // If this is the target of an assignment expression, evaluate the
            // assignment expression node instead.
            if (parent.nodeType === ParseNodeType.AssignmentExpression && nodeToEvaluate === parent.d.name) {
                nodeToEvaluate = parent;
                continue;
            }

            // Forward-declared type annotation expressions need to be be evaluated
            // in context so they have the appropriate flags set. Most of these cases
            // will have been detected above when calling getParentAnnotationNode,
            // but TypeAlias expressions are not handled there.
            const stringEnclosure = ParseTreeUtils.getParentNodeOfType(parent, ParseNodeType.StringList);
            if (stringEnclosure) {
                nodeToEvaluate = stringEnclosure as StringListNode;
                continue;
            }

            // The left expression of a call or member access expression is not generally contextual.
            if (parent.nodeType === ParseNodeType.Call || parent.nodeType === ParseNodeType.MemberAccess) {
                if (nodeToEvaluate === parent.d.leftExpr) {
                    // Handle the special case where the LHS is a call to super().
                    if (
                        nodeToEvaluate.nodeType === ParseNodeType.Call &&
                        nodeToEvaluate.d.leftExpr.nodeType === ParseNodeType.Name &&
                        nodeToEvaluate.d.leftExpr.d.value === 'super'
                    ) {
                        nodeToEvaluate = parent;
                        continue;
                    }

                    // Handle the special case where the LHS is a call to a lambda.
                    if (parent.nodeType === ParseNodeType.Call && nodeToEvaluate.nodeType === ParseNodeType.Lambda) {
                        nodeToEvaluate = parent;
                        continue;
                    }

                    flags = EvalFlags.CallBaseDefaults;
                    break;
                }
            } else if (parent.nodeType === ParseNodeType.Index) {
                // The base expression of an index expression is not contextual.
                if (nodeToEvaluate === parent.d.leftExpr) {
                    flags = EvalFlags.IndexBaseDefaults;
                }
            }

            if (!isExpressionNode(parent)) {
                // If we've hit a non-expression node, we generally want to
                // stop. However, there are a few special "pass through"
                // node types that we can skip over to get to a known
                // expression node.
                if (
                    parent.nodeType === ParseNodeType.DictionaryKeyEntry ||
                    parent.nodeType === ParseNodeType.DictionaryExpandEntry ||
                    parent.nodeType === ParseNodeType.ComprehensionFor ||
                    parent.nodeType === ParseNodeType.ComprehensionIf
                ) {
                    assert(parent.parent !== undefined && isExpressionNode(parent.parent));
                    parent = parent.parent;
                } else if (parent.nodeType === ParseNodeType.Parameter) {
                    assert(parent.parent !== undefined);

                    // Parameters are contextual for lambdas.
                    if (parent.parent.nodeType === ParseNodeType.Lambda) {
                        parent = parent.parent;
                    } else {
                        break;
                    }
                } else if (parent.nodeType === ParseNodeType.TypeParameter) {
                    // If this is a bound or default expression in a type parameter list,
                    // we need to evaluate it in the context of the type parameter.
                    if (node === parent.d.boundExpr || node === parent.d.defaultExpr) {
                        getTypeOfTypeParam(parent);
                        return;
                    }

                    break;
                } else {
                    break;
                }
            }

            nodeToEvaluate = parent;
        }

        const parent = nodeToEvaluate.parent!;
        assert(parent !== undefined);

        switch (parent.nodeType) {
            case ParseNodeType.Del: {
                verifyDeleteExpression(nodeToEvaluate);
                return;
            }

            case ParseNodeType.TypeParameter: {
                // If this is the name node within a type parameter list, see if it's a type alias
                // definition. If so, we need to evaluate the type alias contextually.
                if (
                    nodeToEvaluate === parent.d.name &&
                    parent.parent?.nodeType === ParseNodeType.TypeParameterList &&
                    parent.parent.parent?.nodeType === ParseNodeType.TypeAlias
                ) {
                    getTypeOfTypeAlias(parent.parent.parent);
                    return;
                }
                break;
            }

            case ParseNodeType.TypeAlias: {
                getTypeOfTypeAlias(parent);
                return;
            }

            case ParseNodeType.Decorator: {
                if (parent.parent?.nodeType === ParseNodeType.Class) {
                    getTypeOfClass(parent.parent);
                } else if (parent.parent?.nodeType === ParseNodeType.Function) {
                    getTypeOfFunction(parent.parent);
                }
                return;
            }

            case ParseNodeType.Parameter: {
                if (nodeToEvaluate !== parent.d.defaultValue) {
                    evaluateTypeOfParam(parent);
                    return;
                }
                break;
            }

            case ParseNodeType.Argument: {
                if (nodeToEvaluate === parent.d.name) {
                    // A name used to specify a named parameter in an argument isn't an
                    // expression, so there's nothing we can evaluate here.
                    return;
                }

                if (parent.parent?.nodeType === ParseNodeType.Class) {
                    // A class argument must be evaluated in the context of the class declaration.
                    getTypeOfClass(parent.parent);
                    return;
                }
                break;
            }

            case ParseNodeType.Return: {
                // Return expressions must be evaluated in the context of the expected return type.
                if (parent.d.expr) {
                    const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
                    let declaredReturnType = enclosingFunctionNode
                        ? getDeclaredReturnType(enclosingFunctionNode)
                        : undefined;
                    if (declaredReturnType) {
                        const liveScopeIds = getTypeVarScopesForNode(node);
                        declaredReturnType = makeTypeVarsBound(declaredReturnType, liveScopeIds);
                    }
                    getTypeOfExpression(parent.d.expr, EvalFlags.None, makeInferenceContext(declaredReturnType));
                    return;
                }
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                evaluateTypesForTypeAnnotationNode(parent);
                return;
            }

            case ParseNodeType.Assignment: {
                evaluateTypesForAssignmentStatement(parent);
                return;
            }

            case ParseNodeType.AugmentedAssignment: {
                evaluateTypesForAugmentedAssignment(parent);
                return;
            }
        }

        if (nodeToEvaluate.nodeType === ParseNodeType.TypeAnnotation) {
            evaluateTypesForTypeAnnotationNode(nodeToEvaluate);
            return;
        }

        getTypeOfExpression(nodeToEvaluate, flags);
    }

    function evaluateTypeOfParam(node: ParameterNode): void {
        // If this parameter has no name, we have nothing to do.
        if (!node.d.name) {
            return;
        }

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

        const paramIndex = functionNode.d.params.findIndex((param) => param === node);
        const typeAnnotation = ParseTreeUtils.getTypeAnnotationForParam(functionNode, paramIndex);

        if (typeAnnotation) {
            const param = functionNode.d.params[paramIndex];
            let annotatedType = getTypeOfParamAnnotation(typeAnnotation, functionNode.d.params[paramIndex].d.category);

            const liveTypeVarScopes = getTypeVarScopesForNode(param);
            annotatedType = makeTypeVarsBound(annotatedType, liveTypeVarScopes);

            const adjType = transformVariadicParamType(
                node,
                node.d.category,
                adjustParamAnnotatedType(param, annotatedType)
            );

            writeTypeCache(node.d.name, { type: adjType }, EvalFlags.None);
            return;
        }

        const containingClassNode = ParseTreeUtils.getEnclosingClass(functionNode, /* stopAtFunction */ true);
        const classInfo = containingClassNode ? getTypeOfClass(containingClassNode) : undefined;

        if (
            classInfo &&
            ClassType.isPseudoGenericClass(classInfo?.classType) &&
            functionNode.d.name.d.value === '__init__'
        ) {
            const typeParamName = getPseudoGenericTypeVarName(node.d.name.d.value);
            const paramType = classInfo.classType.shared.typeParams.find(
                (param) => param.shared.name === typeParamName
            );

            if (paramType) {
                writeTypeCache(node.d.name, { type: TypeVarType.cloneAsBound(paramType) }, EvalFlags.None);
                return;
            }
        }

        // See if the function is a method in a child class. We may be able to
        // infer the type of the parameter from a method of the same name in
        // a parent class if it has an annotated type.
        const functionFlags = getFunctionInfoFromDecorators(
            evaluatorInterface,
            functionNode,
            /* isInClass */ true,
            nodeInfo
        ).flags;

        let inferredParamType =
            inferParamType(functionNode, functionFlags, paramIndex, classInfo?.classType) ?? UnknownType.create();
        const liveTypeVarScopes = getTypeVarScopesForNode(node);
        inferredParamType = makeTypeVarsBound(inferredParamType, liveTypeVarScopes);

        writeTypeCache(
            node.d.name,
            { type: transformVariadicParamType(node, node.d.category, inferredParamType) },
            EvalFlags.None
        );
    }

    // Evaluates the types that are assigned within the statement that contains
    // the specified parse node. In some cases, a broader statement may need to
    // be evaluated to provide sufficient context for the type. Evaluated types
    // are written back to the type cache for later retrieval.
    function evaluateTypesForStatement(node: ParseNode): void {
        if (evaluatorOptions.experimentalOverloadResult?.needsActivationBoundary()) {
            return runWithOverloadActivation(() => evaluateTypesForStatement(node));
        }
        initializePrefetchedTypes(node);

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
                        curNode.parent.d.rightExpr === curNode;
                    if (!isInAssignmentChain) {
                        evaluateTypesForAssignmentStatement(curNode);
                        return;
                    }
                    break;
                }

                case ParseNodeType.TypeAlias: {
                    getTypeOfTypeAlias(curNode);
                    return;
                }

                case ParseNodeType.AssignmentExpression: {
                    evaluateTypesForExpressionInContext(curNode);
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
                    evaluateTypeOfParam(curNode);
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

                case ParseNodeType.ComprehensionFor: {
                    const comprehension = curNode.parent as ComprehensionNode;
                    assert(comprehension.nodeType === ParseNodeType.Comprehension);
                    if (curNode === comprehension.d.expr) {
                        evaluateTypesForExpressionInContext(comprehension);
                    } else {
                        // Evaluate the individual iterations starting with the first
                        // up to the curNode.
                        for (const forIfNode of comprehension.d.forIfNodes) {
                            evaluateComprehensionForIf(forIfNode);
                            if (forIfNode === curNode) {
                                break;
                            }
                        }
                    }
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
                    evaluateTypesForCaseStatement(curNode);
                    return;
                }
            }

            curNode = curNode.parent;
        }

        fail('Unexpected statement');
        return undefined;
    }

    // Helper function for cases where we need to evaluate the types
    // for a subtree so we can determine the type of one of the subnodes
    // within that tree. If the type cannot be determined (because it's part
    // of a cyclical dependency), the function returns undefined.
    function evaluateTypeForSubnode(subnode: ParseNode, callback: () => void): TypeResult | undefined {
        return evaluateTypeForSubnodeWithCache(subnode, callback, readTypeCacheEntry);
    }

    function evaluateContextualTypeForSubnode(subnode: ParseNode, callback: () => void): TypeResult | undefined {
        return evaluateTypeForSubnodeWithCache(subnode, callback, readContextualTypeCacheEntryForNode);
    }

    function evaluateTypeForSubnodeWithCache(
        subnode: ParseNode,
        callback: () => void,
        readCacheEntry: (node: ParseNode) => TypeCacheEntry | undefined
    ): TypeResult | undefined {
        // If the type cache is already populated with a complete type,
        // don't bother doing additional work.
        let cacheEntry = readCacheEntry(subnode);
        if (cacheEntry && !cacheEntry.typeResult.isIncomplete) {
            const typeResult = cacheEntry.typeResult;

            // Handle the special case where a function or class is partially evaluated.
            // Indicate that these are not complete types.
            if (isFunction(typeResult.type) && FunctionType.isPartiallyEvaluated(typeResult.type)) {
                return { ...typeResult, isIncomplete: true };
            }

            if (isClass(typeResult.type) && ClassType.isPartiallyEvaluated(typeResult.type)) {
                return { ...typeResult, isIncomplete: true };
            }

            return typeResult;
        }

        callback();
        cacheEntry = readCacheEntry(subnode);
        if (cacheEntry) {
            return cacheEntry.typeResult;
        }

        return undefined;
    }

    // Attempts to determine the type of the reference expression at the
    // point in the code. If the code flow analysis has nothing to say
    // about that expression, it returns un undefined type. Normally
    // flow analysis starts from the reference node, but startNode can be
    // specified to override this in a few special cases (functions and
    // lambdas) to support analysis of captured variables.
    function getFlowTypeOfReference(
        reference: CodeFlowReferenceExpressionNode,
        startNode?: ClassNode | FunctionNode | LambdaNode,
        options?: FlowNodeTypeOptions
    ): FlowNodeTypeResult {
        return flowAnalysis.getFlowTypeOfReference(reference, startNode, options);
    }

    // PEP 612 says that if the class has only one type parameter consisting
    // of a ParamSpec, the list of arguments does not need to be enclosed in
    // a list. We'll handle that case specially here.
    function transformTypeArgsForParamSpec(
        typeParams: TypeVarType[],
        typeArgs: TypeResultWithNode[] | undefined,
        errorNode: ExpressionNode
    ): TypeResultWithNode[] | undefined {
        return specialFormCreation.transformTypeArgsForParamSpec(typeParams, typeArgs, errorNode);
    }

    function getTypeOfArg(arg: Arg, inferenceContext: InferenceContext | undefined): TypeResult {
        return expressionEvaluation.getTypeOfArg(arg, inferenceContext);
    }

    // This function is like getTypeOfArg except that it is
    // used in cases where the argument is expected to be a type
    // and therefore follows the normal rules of types (e.g. they
    // can be forward-declared in stubs, etc.).
    function getTypeOfArgExpectingType(arg: Arg, options?: ExpectedTypeOptions): TypeResult {
        return evaluatorCore.getTypeOfArgExpectingType(arg, options);
    }

    function getTypeOfExpressionExpectingType(node: ExpressionNode, options?: ExpectedTypeOptions): TypeResult {
        return expressionEvaluation.getTypeOfExpressionExpectingType(node, options);
    }

    function getBuiltInType(node: ParseNode, name: string): Type {
        return evaluatorCore.getBuiltInType(node, name);
    }

    function getBuiltInObject(node: ParseNode, name: string, typeArgs?: Type[]) {
        return evaluatorCore.getBuiltInObject(node, name, typeArgs);
    }

    function lookUpSymbolRecursive(
        node: ParseNode,
        name: string,
        honorCodeFlow: boolean,
        preferGlobalScope = false
    ): SymbolWithScope | undefined {
        return memberResolution.lookUpSymbolRecursive(node, name, honorCodeFlow, preferGlobalScope);
    }

    // Disables recording of errors and warnings.
    function suppressDiagnostics<T>(
        node: ParseNode,
        callback: () => T,
        diagCallback?: (suppressedDiags: string[]) => void
    ) {
        return diagnostics.suppressDiagnostics<T>(node, callback, diagCallback);
    }

    function getSignatureTrackerForNode(node: ParseNode): UniqueSignatureTracker | undefined {
        for (let i = signatureTrackerStack.length - 1; i >= 0; i--) {
            const rootNode = signatureTrackerStack[i].rootNode;
            if (ParseTreeUtils.isNodeContainedWithin(node, rootNode)) {
                return signatureTrackerStack[i].tracker;
            }
        }

        return undefined;
    }

    function useSignatureTracker<T>(node: ParseNode, callback: () => T): T {
        const tracker = getSignatureTrackerForNode(node);

        try {
            // If a signature tracker doesn't already exist, allocate one.
            if (!tracker) {
                signatureTrackerStack.push({
                    tracker: new UniqueSignatureTracker(),
                    rootNode: node,
                });
            }

            const result = callback();

            if (!tracker) {
                signatureTrackerStack.pop();
            }

            return result;
        } catch (e) {
            // We don't use finally here because the TypeScript debugger doesn't
            // handle finally well when single stepping.
            if (!tracker) {
                signatureTrackerStack.pop();
            }

            throw e;
        }
    }

    function ensureSignatureIsUnique<T extends Type>(type: T, node: ParseNode): T {
        const tracker = getSignatureTrackerForNode(node);
        if (!tracker) {
            return type;
        }

        if (isFunctionOrOverloaded(type)) {
            return ensureSignaturesAreUnique(type, tracker, node.start);
        }

        return type;
    }

    // Disables recording of errors and warnings and disables any caching of
    // types, under the assumption that we're performing speculative evaluations.
    // If speculativeNode is undefined, speculative mode is not used. This is
    // useful in cases where we conditionally want to use speculative mode.
    function useSpeculativeMode<T>(
        speculativeNode: ParseNode | undefined,
        callback: () => T,
        options?: SpeculativeModeOptions
    ) {
        if (!speculativeNode) {
            return callback();
        }

        speculativeTypeTracker.enterSpeculativeContext(speculativeNode, options);

        try {
            const result = callback();
            speculativeTypeTracker.leaveSpeculativeContext();
            return result;
        } catch (e) {
            // We don't use finally here because the TypeScript debugger doesn't
            // handle finally well when single stepping.
            speculativeTypeTracker.leaveSpeculativeContext();
            throw e;
        }
    }

    function disableSpeculativeMode(callback: () => void) {
        const stack = speculativeTypeTracker.disableSpeculativeMode();

        try {
            callback();
            speculativeTypeTracker.enableSpeculativeMode(stack);
        } catch (e) {
            // We don't use finally here because the TypeScript debugger doesn't
            // handle finally well when single stepping.
            speculativeTypeTracker.enableSpeculativeMode(stack);
            throw e;
        }
    }

    // Indicates whether the specified node is within a context that
    // is currently being evaluated speculative. If node is undefined,
    // returns true if any node is being evaluated speculatively.
    function isSpeculativeModeInUse(node: ParseNode | undefined) {
        return speculativeTypeTracker.isSpeculative(node);
    }

    function getDeclarationFromKeywordParam(type: FunctionType, paramName: string): Declaration | undefined {
        return memberResolution.getDeclarationFromKeywordParam(type, paramName);
    }

    // functools.partial(func, kw=value) forwards keyword arguments to the wrapped callable, but
    // partial's own signature absorbs them through **kwargs, so they don't resolve to a declaration.
    // Resolve the keyword against the wrapped callable (the first positional argument) instead so IDE
    // features like go-to-definition and rename bind to the underlying parameter. Returns true when
    // baseType is functools.partial, so the caller suppresses the default keyword-argument handling.
    function _tryAddPartialKeywordParamDecls(
        baseType: Type,
        callNode: CallNode,
        paramName: string,
        decls: Declaration[]
    ): boolean {
        if (!isInstantiableClass(baseType) || baseType.shared.fullName !== 'functools.partial') {
            return false;
        }

        const wrappedArg = callNode.d.args.find((arg) => arg.d.argCategory === ArgCategory.Simple && !arg.d.name);
        if (!wrappedArg) {
            return true;
        }

        const wrappedType = getType(wrappedArg.d.valueExpr);
        if (!wrappedType) {
            return true;
        }

        if (isFunction(wrappedType)) {
            const paramDecl = getDeclarationFromKeywordParam(wrappedType, paramName);
            if (paramDecl) {
                decls.push(paramDecl);
            }
        } else if (isOverloaded(wrappedType)) {
            OverloadedType.getOverloads(wrappedType).forEach((f) => {
                const paramDecl = getDeclarationFromKeywordParam(f, paramName);
                if (paramDecl) {
                    decls.push(paramDecl);
                }
            });
        } else if (isInstantiableClass(wrappedType)) {
            const initMethodType = getBoundInitMethod(
                evaluatorInterface,
                wrappedArg.d.valueExpr,
                ClassType.cloneAsInstance(wrappedType)
            )?.type;
            if (initMethodType && isFunction(initMethodType)) {
                const paramDecl = getDeclarationFromKeywordParam(initMethodType, paramName);
                if (paramDecl) {
                    decls.push(paramDecl);
                }
            }
        }

        return true;
    }

    function _shouldFallBackToClassEntryForKeywordArg(baseType: ClassType, paramName: string) {
        return (
            ClassType.isDataClass(baseType) ||
            ClassType.isTypedDictClass(baseType) ||
            ClassType.hasNamedTupleEntry(baseType, paramName)
        );
    }

    function _addSymbolDeclInfo(
        symbol: Symbol,
        decls: Declaration[],
        synthesizedTypes: SynthesizedTypeInfo[],
        preferTypedDeclarations = false
    ) {
        const declCountBeforeAdd = decls.length;
        const typedDecls = preferTypedDeclarations ? symbol.getTypedDeclarations() : undefined;
        appendArray(decls, typedDecls?.length ? typedDecls : symbol.getDeclarations());

        const synthTypeInfo = symbol.getSynthesizedType();
        if (synthTypeInfo) {
            synthesizedTypes.push(synthTypeInfo);

            // Some module members are represented only by a synthesized module type,
            // with no concrete declaration node to navigate to. Synthesize a matching
            // alias declaration so definition/declaration/reference features can still
            // bind to the submodule's file.
            if (
                decls.length === declCountBeforeAdd &&
                isModule(synthTypeInfo.type) &&
                !synthTypeInfo.type.priv.fileUri.isEmpty()
            ) {
                decls.push(synthesizeAliasDeclaration(synthTypeInfo.type.priv.fileUri));
            }
        }
    }

    function _addClassEntryDeclsForKeywordArgIfPresent(
        baseType: ClassType,
        paramName: string,
        decls: Declaration[],
        synthesizedTypes: SynthesizedTypeInfo[]
    ) {
        const lookupResults = lookUpClassMember(baseType, paramName);
        if (!lookupResults) {
            return;
        }

        _addSymbolDeclInfo(lookupResults.symbol, decls, synthesizedTypes);
    }

    // In general, string nodes don't have any declarations associated with them, but
    // we need to handle the special case of string literals used as keys within a
    // dictionary expression where those keys are associated with a known TypedDict.
    function getDeclInfoForStringNode(node: StringNode): SymbolDeclInfo | undefined {
        return memberResolution.getDeclInfoForStringNode(node);
    }

    function getAliasFromImport(node: NameNode): NameNode | undefined {
        return memberResolution.getAliasFromImport(node);
    }

    function getDeclInfoForNameNode(node: NameNode, skipUnreachableCode = true): SymbolDeclInfo | undefined {
        return memberResolution.getDeclInfoForNameNode(node, skipUnreachableCode);
    }

    function getTypeForDeclaration(declaration: Declaration): DeclaredSymbolTypeInfo {
        switch (declaration.type) {
            case DeclarationType.Intrinsic: {
                if (declaration.intrinsicType === 'Any') {
                    return { type: AnyType.create() };
                }

                if (declaration.intrinsicType === '__class__') {
                    const classNode = ParseTreeUtils.getEnclosingClass(declaration.node) as ClassNode;
                    const classTypeInfo = getTypeOfClass(classNode);
                    return {
                        type: classTypeInfo
                            ? specializeWithUnknownTypeArgs(classTypeInfo.classType, getTupleClassType())
                            : UnknownType.create(),
                    };
                }

                const strType = getBuiltInObject(declaration.node, 'str');
                const intType = getBuiltInObject(declaration.node, 'int');
                if (isClassInstance(intType) && isClassInstance(strType)) {
                    if (declaration.intrinsicType === 'str') {
                        return { type: strType };
                    }

                    if (declaration.intrinsicType === 'str | None') {
                        return { type: combineTypes([strType, getNoneType()]) };
                    }

                    if (declaration.intrinsicType === 'int') {
                        return { type: intType };
                    }

                    if (declaration.intrinsicType === 'MutableSequence[str]') {
                        const sequenceType = getBuiltInType(declaration.node, 'MutableSequence');
                        if (isInstantiableClass(sequenceType)) {
                            return {
                                type: ClassType.cloneAsInstance(ClassType.specialize(sequenceType, [strType])),
                            };
                        }
                    }

                    if (declaration.intrinsicType === 'dict[str, Any]') {
                        const dictType = getBuiltInType(declaration.node, 'dict');
                        if (isInstantiableClass(dictType)) {
                            return {
                                type: ClassType.cloneAsInstance(
                                    ClassType.specialize(dictType, [strType, AnyType.create()])
                                ),
                            };
                        }
                    }
                }

                return { type: UnknownType.create() };
            }

            case DeclarationType.Class: {
                const classTypeInfo = getTypeOfClass(declaration.node);
                return { type: classTypeInfo?.decoratedType };
            }

            case DeclarationType.SpecialBuiltInClass: {
                return { type: getTypeOfAnnotation(declaration.node.d.annotation) };
            }

            case DeclarationType.Function: {
                const functionTypeInfo = getTypeOfFunction(declaration.node);
                return { type: functionTypeInfo?.decoratedType };
            }

            case DeclarationType.TypeAlias: {
                return { type: getTypeOfTypeAlias(declaration.node) };
            }

            case DeclarationType.Param: {
                let typeAnnotationNode = declaration.node.d.annotation ?? declaration.node.d.annotationComment;

                // If there wasn't an annotation, see if the parent function
                // has a function-level annotation comment that provides
                // this parameter's annotation type.
                if (!typeAnnotationNode) {
                    if (declaration.node.parent?.nodeType === ParseNodeType.Function) {
                        const functionNode = declaration.node.parent;
                        if (
                            functionNode.d.funcAnnotationComment &&
                            !functionNode.d.funcAnnotationComment.d.isEllipsis
                        ) {
                            const paramIndex = functionNode.d.params.findIndex((param) => param === declaration.node);
                            typeAnnotationNode = ParseTreeUtils.getTypeAnnotationForParam(functionNode, paramIndex);
                        }
                    }
                }

                if (typeAnnotationNode) {
                    let declaredType = getTypeOfParamAnnotation(typeAnnotationNode, declaration.node.d.category);

                    const liveTypeVarScopes = getTypeVarScopesForNode(declaration.node);
                    declaredType = makeTypeVarsBound(declaredType, liveTypeVarScopes);

                    return {
                        type: transformVariadicParamType(
                            declaration.node,
                            declaration.node.d.category,
                            adjustParamAnnotatedType(declaration.node, declaredType)
                        ),
                    };
                }

                return { type: undefined };
            }

            case DeclarationType.TypeParam: {
                return { type: getTypeOfTypeParam(declaration.node) };
            }

            case DeclarationType.Variable: {
                const typeAnnotationNode = declaration.typeAnnotationNode;

                if (typeAnnotationNode) {
                    let declaredType: Type | undefined;

                    if (declaration.isRuntimeTypeExpression) {
                        declaredType = convertToInstance(
                            getTypeOfExpressionExpectingType(typeAnnotationNode, {
                                allowFinal: true,
                                allowRequired: true,
                                allowReadOnly: true,
                                runtimeTypeExpression: true,
                            }).type
                        );
                    } else {
                        const declNode =
                            declaration.isDefinedByMemberAccess &&
                            declaration.node.parent?.nodeType === ParseNodeType.MemberAccess
                                ? declaration.node.parent
                                : declaration.node;
                        const allowClassVar = isClassVarAllowedForAssignmentTarget(declNode);
                        const allowFinal = isFinalAllowedForAssignmentTarget(declNode);
                        const allowRequired =
                            ParseTreeUtils.isRequiredAllowedForAssignmentTarget(declNode) ||
                            !!declaration.isInInlinedTypedDict;

                        declaredType = getTypeOfAnnotation(typeAnnotationNode, {
                            varTypeAnnotation: true,
                            allowClassVar,
                            allowFinal,
                            allowRequired,
                            allowReadOnly: allowRequired,
                            enforceClassTypeVarScope: declaration.isDefinedByMemberAccess,
                        });
                    }

                    if (declaredType) {
                        // If this is a declaration for a member variable within a method,
                        // we need to convert any bound TypeVars associated with the
                        // class to their free counterparts.
                        if (declaration.isDefinedByMemberAccess) {
                            const enclosingClass = ParseTreeUtils.getEnclosingClass(declaration.node);

                            if (enclosingClass) {
                                declaredType = makeTypeVarsFree(declaredType, [getScopeIdForNode(enclosingClass)]);
                            }
                        }

                        if (isClassInstance(declaredType) && ClassType.isBuiltIn(declaredType, 'TypeAlias')) {
                            return { type: undefined, isTypeAlias: true };
                        }

                        return { type: declaredType };
                    }
                }

                return { type: undefined };
            }

            case DeclarationType.Alias: {
                return { type: undefined };
            }
        }
    }

    function getTypeOfTypeParam(node: TypeParameterNode): TypeVarType {
        // Is this type already cached?
        const cachedTypeVarType = readTypeCache(node.d.name, EvalFlags.None) as FunctionType;
        if (cachedTypeVarType && isTypeVar(cachedTypeVarType)) {
            return cachedTypeVarType;
        }

        let runtimeClassName = 'TypeVar';
        let kind: TypeVarKind = TypeVarKind.TypeVar;
        if (node.d.typeParamKind === TypeParamKind.TypeVarTuple) {
            runtimeClassName = 'TypeVarTuple';
            kind = TypeVarKind.TypeVarTuple;
        } else if (node.d.typeParamKind === TypeParamKind.ParamSpec) {
            runtimeClassName = 'ParamSpec';
            kind = TypeVarKind.ParamSpec;
        }
        const runtimeType = getTypingType(node, runtimeClassName);
        const runtimeClass = runtimeType && isInstantiableClass(runtimeType) ? runtimeType : undefined;

        let typeVar = TypeVarType.createInstantiable(node.d.name.d.value, kind);
        if (runtimeClass) {
            typeVar = TypeBase.cloneAsSpecialForm(typeVar, ClassType.cloneAsInstance(runtimeClass));
        }
        typeVar.shared.isTypeParamSyntax = true;

        // Cache the value before we evaluate the bound or the default type in
        // case it refers to itself in a circular manner.
        writeTypeCache(node, { type: typeVar }, /* flags */ undefined);
        writeTypeCache(node.d.name, { type: typeVar }, /* flags */ undefined);

        if (node.d.boundExpr) {
            if (node.d.boundExpr.nodeType === ParseNodeType.Tuple) {
                const constraints = node.d.boundExpr.d.items.map((constraint) => {
                    const constraintType = getTypeOfExpressionExpectingType(constraint, {
                        noNonTypeSpecialForms: true,
                        forwardRefs: true,
                        typeExpression: true,
                    }).type;

                    if (
                        requiresSpecialization(constraintType, {
                            ignorePseudoGeneric: true,
                            ignoreImplicitTypeArgs: true,
                        })
                    ) {
                        addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeVarBoundGeneric(),
                            constraint
                        );
                    }

                    return convertToInstance(constraintType);
                });

                if (constraints.length < 2) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeVarSingleConstraint(),
                        node.d.boundExpr
                    );
                } else if (node.d.typeParamKind === TypeParamKind.TypeVar) {
                    typeVar.shared.constraints = constraints;
                }
            } else {
                const boundType = getTypeOfExpressionExpectingType(node.d.boundExpr, {
                    noNonTypeSpecialForms: true,
                    forwardRefs: true,
                    typeExpression: true,
                }).type;

                if (requiresSpecialization(boundType, { ignorePseudoGeneric: true })) {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeVarConstraintGeneric(),
                        node.d.boundExpr
                    );
                }

                if (node.d.typeParamKind === TypeParamKind.TypeVar) {
                    typeVar.shared.boundType = convertToInstance(boundType);
                }
            }
        }

        if (node.d.typeParamKind === TypeParamKind.ParamSpec) {
            const defaultType = node.d.defaultExpr
                ? getParamSpecDefaultType(node.d.defaultExpr, /* isPep695Syntax */ true)
                : undefined;

            if (defaultType) {
                typeVar.shared.defaultType = defaultType;
                typeVar.shared.isDefaultExplicit = true;
            } else {
                typeVar.shared.defaultType = ParamSpecType.getUnknown();
            }
        } else if (node.d.typeParamKind === TypeParamKind.TypeVarTuple) {
            const defaultType = node.d.defaultExpr
                ? typeVarHandling.getTypeVarTupleDefaultType(node.d.defaultExpr, /* isPep695Syntax */ true)
                : undefined;

            if (defaultType) {
                typeVar.shared.defaultType = defaultType;
                typeVar.shared.isDefaultExplicit = true;
            } else {
                typeVar.shared.defaultType = makeTupleObject(evaluatorInterface, [
                    { type: UnknownType.create(), isUnbounded: true },
                ]);
            }
        } else {
            const defaultType = node.d.defaultExpr
                ? convertToInstance(
                      getTypeOfExpressionExpectingType(node.d.defaultExpr, {
                          forwardRefs: true,
                          typeExpression: true,
                      }).type
                  )
                : undefined;

            if (defaultType) {
                typeVar.shared.defaultType = defaultType;
                typeVar.shared.isDefaultExplicit = true;
            } else {
                typeVar.shared.defaultType = UnknownType.create();
            }
        }

        // If a default is provided, make sure it is compatible with the bound
        // or constraint.
        if (typeVar.shared.isDefaultExplicit && node.d.defaultExpr) {
            typeVarHandling.verifyTypeVarDefaultIsCompatible(typeVar, node.d.defaultExpr);
        }

        // Associate the type variable with the owning scope.
        const scopeNode = ParseTreeUtils.getTypeVarScopeNode(node);
        if (scopeNode) {
            let scopeType: TypeVarScopeType;
            if (scopeNode.nodeType === ParseNodeType.Class) {
                scopeType = TypeVarScopeType.Class;

                // Set the variance to "auto" for class-scoped TypeVars.
                typeVar.shared.declaredVariance =
                    isParamSpec(typeVar) || isTypeVarTuple(typeVar) ? Variance.Invariant : Variance.Auto;
            } else if (scopeNode.nodeType === ParseNodeType.Function) {
                scopeType = TypeVarScopeType.Function;
            } else {
                assert(scopeNode.nodeType === ParseNodeType.TypeAlias);
                scopeType = TypeVarScopeType.TypeAlias;
                typeVar.shared.declaredVariance =
                    isParamSpec(typeVar) || isTypeVarTuple(typeVar) ? Variance.Invariant : Variance.Auto;
            }

            typeVar = TypeVarType.cloneForScopeId(
                typeVar,
                getScopeIdForNode(scopeNode.nodeType === ParseNodeType.TypeAlias ? scopeNode.d.name : scopeNode),
                scopeNode.d.name.d.value,
                scopeType
            );
        }

        writeTypeCache(node, { type: typeVar }, /* flags */ undefined);
        writeTypeCache(node.d.name, { type: typeVar }, /* flags */ undefined);

        return typeVar;
    }

    function getInferredTypeOfDeclaration(symbol: Symbol, decl: Declaration): Type | undefined {
        const resolvedDecl = resolveAliasDeclaration(decl, /* resolveLocalNames */ true, {
            allowExternallyHiddenAccess: nodeInfo.getFileInfo(decl.node).isStubFile,
        });

        // We couldn't resolve the alias. Substitute an unknown
        // type in this case.
        if (!resolvedDecl) {
            return evaluatorOptions.evaluateUnknownImportsAsAny ? AnyType.create() : UnknownType.create();
        }

        function applyLoaderActionsToModuleType(
            moduleType: ModuleType,
            loaderActions: ModuleLoaderActions,
            importLookup: ImportLookup
        ): Type {
            if (!loaderActions.uri.isEmpty() && loaderActions.loadSymbolsFromPath) {
                const lookupResults = importLookup(loaderActions.uri);
                if (lookupResults) {
                    moduleType.priv.fields = lookupResults.symbolTable;
                    moduleType.priv.docString = lookupResults.docString;
                } else {
                    // Note that all module attributes that are not found in the
                    // symbol table should be treated as Any or Unknown rather than
                    // as an error.
                    moduleType.priv.notPresentFieldType = evaluatorOptions.evaluateUnknownImportsAsAny
                        ? AnyType.create()
                        : UnknownType.create();
                }
            }

            if (loaderActions.implicitImports) {
                loaderActions.implicitImports.forEach((implicitImport, name) => {
                    const existingLoaderField = moduleType.priv.loaderFields.get(name);

                    // Recursively apply loader actions.
                    let symbolType: Type;

                    if (implicitImport.isUnresolved) {
                        symbolType = UnknownType.create();
                    } else {
                        let importedModuleType: ModuleType;

                        const existingType = existingLoaderField?.getSynthesizedType();
                        if (existingType?.type && isModule(existingType.type)) {
                            importedModuleType = existingType.type;
                        } else {
                            const moduleName = moduleType.priv.moduleName
                                ? moduleType.priv.moduleName + '.' + name
                                : '';
                            importedModuleType = ModuleType.create(moduleName, implicitImport.uri);
                        }

                        symbolType = applyLoaderActionsToModuleType(importedModuleType, implicitImport, importLookup);
                    }

                    if (!existingLoaderField) {
                        const importedModuleSymbol = Symbol.createWithType(SymbolFlags.None, symbolType);
                        moduleType.priv.loaderFields.set(name, importedModuleSymbol);
                    }
                });
            }

            return moduleType;
        }

        // If the resolved declaration is still an alias, the alias
        // is pointing at a module, and we need to synthesize a
        // module type.
        if (resolvedDecl.type === DeclarationType.Alias) {
            let moduleType: ModuleType | undefined;

            // See if this is an import that shares a ModuleType with another
            // import statement. If so, used the cached type. This happens when
            // multiple import statements start with the same module name, such
            // as "import a.b" and "import a.c".
            if (resolvedDecl.node.nodeType === ParseNodeType.ImportAs) {
                const cachedType = readTypeCache(resolvedDecl.node.d.module, EvalFlags.None);
                if (cachedType && isModule(cachedType)) {
                    moduleType = cachedType;
                }
            }

            if (!moduleType) {
                // Build a module type that corresponds to the declaration and
                // its associated loader actions.
                moduleType = ModuleType.create(resolvedDecl.moduleName, resolvedDecl.uri);

                if (resolvedDecl.node.nodeType === ParseNodeType.ImportAs) {
                    writeTypeCache(resolvedDecl.node.d.module, { type: moduleType }, EvalFlags.None);
                }
            }

            return applyLoaderActionsToModuleType(
                moduleType,
                resolvedDecl.symbolName && resolvedDecl.submoduleFallback
                    ? resolvedDecl.submoduleFallback
                    : resolvedDecl,
                importLookup
            );
        }

        const declaredType = getTypeForDeclaration(resolvedDecl);
        if (declaredType.type) {
            return declaredType.type;
        }

        // If this is part of a "py.typed" package, don't fall back on type inference
        // unless it's marked Final, is a constant, or is a declared type alias.
        const fileInfo = nodeInfo.getFileInfo(resolvedDecl.node);
        let isUnambiguousType = !fileInfo.isInPyTypedPackage || fileInfo.isStubFile;

        // If this is a py.typed package, determine if this is a case where an unannotated
        // variable is considered "unambiguous" because all type checkers are almost
        // guaranteed to infer its type the same.
        if (!isUnambiguousType) {
            if (resolvedDecl.type === DeclarationType.Variable) {
                // Special-case variables within an enum class. These are effectively
                // constants, so we'll treat them as unambiguous.
                const enclosingClass = ParseTreeUtils.getEnclosingClass(resolvedDecl.node, /* stopAtFunction */ true);
                if (enclosingClass) {
                    const classTypeInfo = getTypeOfClass(enclosingClass);
                    if (classTypeInfo && ClassType.isEnumClass(classTypeInfo.classType)) {
                        isUnambiguousType = true;
                    }
                }

                // Special-case constants, which are treated as unambiguous.
                if (isFinalVariableDeclaration(resolvedDecl) || resolvedDecl.isConstant) {
                    isUnambiguousType = true;
                }

                // Special-case calls to certain built-in type functions.
                if (resolvedDecl.inferredTypeSource?.nodeType === ParseNodeType.Call) {
                    const baseTypeResult = getTypeOfExpression(
                        resolvedDecl.inferredTypeSource.d.leftExpr,
                        EvalFlags.CallBaseDefaults
                    );
                    const callType = baseTypeResult.type;

                    const exemptBuiltins = [
                        'TypeVar',
                        'ParamSpec',
                        'TypeVarTuple',
                        'TypedDict',
                        'NamedTuple',
                        'NewType',
                        'TypeAliasType',
                    ];

                    if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, exemptBuiltins)) {
                        isUnambiguousType = true;
                    } else if (
                        isFunction(callType) &&
                        exemptBuiltins.some((name) => FunctionType.isBuiltIn(callType, name))
                    ) {
                        isUnambiguousType = true;
                    }
                }
            }
        }

        // If the resolved declaration had no defined type, use the
        // inferred type for this node.
        if (resolvedDecl.type === DeclarationType.Param) {
            assert(resolvedDecl.node.d.name !== undefined);
            return evaluateTypeForSubnode(resolvedDecl.node.d.name, () => {
                evaluateTypeOfParam(resolvedDecl.node);
            })?.type;
        }

        if (resolvedDecl.type === DeclarationType.Variable && resolvedDecl.inferredTypeSource) {
            const isTypeAlias =
                isExplicitTypeAliasDeclaration(resolvedDecl) || isPossibleTypeAliasOrTypedDict(resolvedDecl);

            // If this is a type alias, evaluate types for the entire assignment
            // statement rather than just the RHS of the assignment.
            const typeSource =
                isTypeAlias && resolvedDecl.inferredTypeSource.parent
                    ? resolvedDecl.inferredTypeSource.parent
                    : resolvedDecl.inferredTypeSource;
            let inferredType = evaluateTypeForSubnode(resolvedDecl.node, () => {
                evaluateTypesForStatement(typeSource);
            })?.type;

            if (inferredType && isTypeAlias && resolvedDecl.typeAliasName) {
                // If this was a speculative type alias, it becomes a real type alias only
                // in the event that its inferred type is instantiable or explicitly Any
                // (but not an ellipsis).
                if (isLegalImplicitTypeAliasType(inferredType)) {
                    const typeAliasTypeVar = synthesizeTypeAliasPlaceholder(resolvedDecl.typeAliasName);

                    inferredType = transformTypeForTypeAlias(
                        inferredType,
                        resolvedDecl.node,
                        typeAliasTypeVar,
                        /* isPep695TypeVarType */ false
                    );

                    isUnambiguousType = true;
                }
            }

            // Determine whether we need to mark the annotation as ambiguous.
            if (inferredType && fileInfo.isInPyTypedPackage && !fileInfo.isStubFile) {
                if (!isUnambiguousType) {
                    // See if this particular inference can be considered "unambiguous".
                    // Any symbol that is assigned more than once is considered ambiguous.
                    if (isUnambiguousInference(symbol, decl, inferredType)) {
                        isUnambiguousType = true;
                    }
                }

                if (!isUnambiguousType) {
                    inferredType = TypeBase.cloneForAmbiguousType(inferredType);
                }
            }

            return inferredType;
        }

        return undefined;
    }

    // Applies some heuristics to determine whether it's likely that all Python
    // type checkers will infer the same type.
    function isUnambiguousInference(symbol: Symbol, decl: Declaration, inferredType: Type): boolean {
        return evaluatorCore.isUnambiguousInference(symbol, decl, inferredType);
    }

    // If the specified declaration is an alias declaration that points to a symbol,
    // it resolves the alias and looks up the symbol, then returns the first declaration
    // associated with that symbol. It does this recursively if necessary. If a symbol
    // lookup fails, undefined is returned. If resolveLocalNames is true, the method
    // resolves aliases through local renames ("as" clauses found in import statements).
    function resolveAliasDeclaration(
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ): Declaration | undefined {
        return resolveAliasDeclarationUtil(importLookup, declaration, {
            resolveLocalNames,
            allowExternallyHiddenAccess: options?.allowExternallyHiddenAccess ?? false,
            skipFileNeededCheck: options?.skipFileNeededCheck ?? false,
        })?.declaration;
    }

    function resolveAliasDeclarationWithInfo(
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ): ResolvedAliasInfo | undefined {
        return resolveAliasDeclarationUtil(importLookup, declaration, {
            resolveLocalNames,
            allowExternallyHiddenAccess: options?.allowExternallyHiddenAccess ?? false,
            skipFileNeededCheck: options?.skipFileNeededCheck ?? false,
        });
    }

    // Returns the type of the symbol. If the type is explicitly declared, that type
    // is returned. If not, the type is inferred from assignments to the symbol. All
    // assigned types are evaluated and combined into a union.
    function getEffectiveTypeOfSymbol(symbol: Symbol): Type {
        return getEffectiveTypeOfSymbolForUsage(symbol).type;
    }

    // If a "usageNode" node is specified, only declarations that are outside
    // of the current execution scope or that are reachable (as determined by
    // code flow analysis) are considered. This helps in cases where there
    // are cyclical dependencies between symbols.
    function getEffectiveTypeOfSymbolForUsage(
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl = false
    ): EffectiveTypeResult {
        let declaredTypeInfo: DeclaredSymbolTypeInfo | undefined;

        // If there's a declared type, it takes precedence over inferred types.
        if (symbol.hasTypedDeclarations()) {
            declaredTypeInfo = getDeclaredTypeOfSymbol(symbol, usageNode);
            const declaredType = declaredTypeInfo?.type;

            let isIncomplete = false;
            if (declaredType) {
                if (isFunction(declaredType) && FunctionType.isPartiallyEvaluated(declaredType)) {
                    isIncomplete = true;
                } else if (isClass(declaredType) && ClassType.isPartiallyEvaluated(declaredType)) {
                    isIncomplete = true;
                }
            }

            // If the "declared" type uses a "TypeAlias" type annotation, then
            // we need to use the inferred type path to evaluate its type.
            if (declaredType || !declaredTypeInfo.isTypeAlias) {
                const typedDecls = symbol.getTypedDeclarations();

                // If we received an undefined declared type, this can be caused by
                // exceeding the max number of type declarations, speculative
                // evaluation, or a recursive definition.
                const isRecursiveDefinition =
                    !declaredType &&
                    !declaredTypeInfo.exceedsMaxDecls &&
                    !speculativeTypeTracker.isSpeculative(/* node */ undefined);

                const result: EffectiveTypeResult = {
                    type: declaredType ?? UnknownType.create(),
                    isIncomplete,
                    includesVariableDecl: includesVariableTypeDecl(typedDecls),
                    includesIllegalTypeAliasDecl: !typedDecls.every((decl) => isPossibleTypeAliasDeclaration(decl)),
                    includesSpeculativeResult: false,
                    isRecursiveDefinition,
                };

                return result;
            }
        }

        return inferTypeOfSymbolForUsage(symbol, usageNode, useLastDecl);
    }

    // Determines whether the set of declarations includes a variable declaration
    // that is not part of a typing.pyi or typingExtensions.pyi file.
    function includesVariableTypeDecl(decls: Declaration[]): boolean {
        return memberResolution.includesVariableTypeDecl(decls);
    }

    function inferTypeOfSymbolForUsage(symbol: Symbol, usageNode?: NameNode, useLastDecl = false): EffectiveTypeResult {
        // Look in the inferred type cache to see if we've computed this already.
        let cacheEntries = effectiveTypeCache.get(symbol.id);
        const usageNodeId = usageNode ? usageNode.id : undefined;
        const effectiveTypeCacheKey = `${usageNodeId === undefined ? '.' : usageNodeId.toString()}${
            useLastDecl ? '*' : ''
        }`;
        const cacheEntry = cacheEntries?.get(effectiveTypeCacheKey);

        if (cacheEntry && !cacheEntry.isIncomplete) {
            return cacheEntry;
        }

        // Infer the type.
        const decls = symbol.getDeclarations();

        let declIndexToConsider: number | undefined;

        // Limit the number of declarations to explore.
        if (decls.length > maxDeclarationsToUseForInference) {
            const result: EffectiveTypeResult = {
                type: UnknownType.create(),
                isIncomplete: false,
                includesVariableDecl: false,
                includesIllegalTypeAliasDecl: !decls.every((decl) => isPossibleTypeAliasDeclaration(decl)),
                includesSpeculativeResult: false,
                isRecursiveDefinition: false,
            };

            addToEffectiveTypeCache(result);
            return result;
        }

        // If the caller has requested that we use only the last decl, we
        // will use only the last one, but we'll ignore decls that are in
        // except clauses.
        if (useLastDecl) {
            decls.forEach((decl, index) => {
                if (!decl.isInExceptSuite) {
                    declIndexToConsider = index;
                }
            });
        } else {
            // Handle the case where there are multiple imports — one of them in
            // a try block and one or more in except blocks. In this case, we'll
            // use the one in the try block rather than the excepts.
            if (decls.length > 1 && decls.every((decl) => decl.type === DeclarationType.Alias)) {
                const nonExceptDecls = decls.filter(
                    (decl) => decl.type === DeclarationType.Alias && !decl.isInExceptSuite
                );
                if (nonExceptDecls.length === 1) {
                    declIndexToConsider = decls.findIndex((decl) => decl === nonExceptDecls[0]);
                }
            }
        }

        // Determine which declarations to use for inference.
        const declsToConsider: Declaration[] = [];
        let includesVariableDecl = false;
        let includesIllegalTypeAliasDecl = false;

        let sawExplicitTypeAlias = false;
        decls.forEach((decl, index) => {
            const resolvedDecl =
                resolveAliasDeclaration(decl, /* resolveLocalNames */ true, {
                    allowExternallyHiddenAccess: nodeInfo.getFileInfo(decl.node).isStubFile,
                }) ?? decl;

            if (!isPossibleTypeAliasDeclaration(resolvedDecl) && !isExplicitTypeAliasDeclaration(resolvedDecl)) {
                includesIllegalTypeAliasDecl = true;
            }

            if (includesVariableTypeDecl([resolvedDecl])) {
                includesVariableDecl = true;
            }

            if (declIndexToConsider !== undefined && declIndexToConsider !== index) {
                return;
            }

            // If we have already seen an explicit type alias, do not consider
            // additional decls. This can happen if multiple TypeAlias declarations
            // are provided -- normally an error, but it can happen in stdlib stubs
            // if the user sets the pythonPlatform to "All".
            if (sawExplicitTypeAlias) {
                return;
            }

            // If the symbol is explicitly marked as a ClassVar, consider only the
            // declarations that assign to it from within the class body, not through
            // a member access expression.
            if (
                isEffectivelyClassVar(symbol, /* isDataclass */ false) &&
                decl.type === DeclarationType.Variable &&
                decl.isDefinedByMemberAccess
            ) {
                return;
            }

            if (usageNode !== undefined) {
                if (decl.type !== DeclarationType.Alias) {
                    // Is the declaration in the same execution scope as the "usageNode" node?
                    // If so, we can skip it because code flow analysis will allow us
                    // to determine the type in this context.
                    const usageScope = ParseTreeUtils.getExecutionScopeNode(usageNode, nodeInfo);
                    const declScope = ParseTreeUtils.getExecutionScopeNode(decl.node, nodeInfo);
                    if (usageScope === declScope) {
                        // Skip declarations that appear after the usage in the source.
                        // Such declarations are typically only reached via loop back-edges,
                        // and including them causes circular evaluation (producing Unknown).
                        // Declarations that textually precede the usage are retained so
                        // that order-independent type aliases resolve correctly; for
                        // branching constructs (if/else, try/except), a retained
                        // declaration may be flow-unreachable at the usage site, but the
                        // code-flow engine overrides the effective type for local
                        // variables, so the narrowed type at the usage site is correct.
                        // Note: for the cases filtered out here (decl after usage in same
                        // scope), the code-flow engine handles loop-carried narrowing when
                        // it evaluates the type at the actual usage site.
                        if (decl.node.start >= usageNode.start) {
                            return;
                        }
                    }
                }
            }

            const isExplicitTypeAlias = isExplicitTypeAliasDeclaration(resolvedDecl);
            const isTypeAlias = isExplicitTypeAlias || isPossibleTypeAliasOrTypedDict(resolvedDecl);

            if (isExplicitTypeAlias) {
                sawExplicitTypeAlias = true;
            }

            // If this is a type alias, evaluate it outside of the recursive symbol
            // resolution check so we can evaluate the full assignment statement.
            if (
                isTypeAlias &&
                resolvedDecl.type === DeclarationType.Variable &&
                resolvedDecl.inferredTypeSource?.parent?.nodeType === ParseNodeType.Assignment
            ) {
                evaluateTypesForAssignmentStatement(resolvedDecl.inferredTypeSource.parent);
            }

            declsToConsider.push(resolvedDecl);
        });

        // If all of the decls come from augmented assignments, we won't be able to
        // determine its type. At least one declaration must be a simple assignment.
        if (
            declsToConsider.every(
                (decl) =>
                    isVariableDeclaration(decl) &&
                    ParseTreeUtils.isNodeContainedWithinNodeType(decl.node, ParseNodeType.AugmentedAssignment)
            )
        ) {
            declsToConsider.splice(0);
        }

        const result = getTypeOfSymbolForDecls(symbol, declsToConsider, effectiveTypeCacheKey);
        result.includesVariableDecl = includesVariableDecl;
        result.includesIllegalTypeAliasDecl = includesIllegalTypeAliasDecl;

        // Add the result to the effective type cache if it doesn't include speculative results.
        if (!result.includesSpeculativeResult) {
            addToEffectiveTypeCache(result);
        }

        return result;

        function addToEffectiveTypeCache(result: EffectiveTypeResult) {
            // Add the entry to the cache so we don't need to compute it next time.
            if (!cacheEntries) {
                cacheEntries = new Map<string, EffectiveTypeResult>();
                effectiveTypeCache.set(symbol.id, cacheEntries);
            }

            cacheEntries.set(effectiveTypeCacheKey, result);
        }
    }

    // Returns the type of a symbol based on a subset of its declarations.
    function getTypeOfSymbolForDecls(symbol: Symbol, decls: Declaration[], typeCacheKey: string): EffectiveTypeResult {
        const typesToCombine: Type[] = [];
        let isIncomplete = false;
        let sawPendingEvaluation = false;
        let includesSpeculativeResult = false;

        decls.forEach((decl) => {
            if (pushSymbolResolution(symbol, decl)) {
                let symbolPopped = false;
                try {
                    let type = getInferredTypeOfDeclaration(symbol, decl);

                    if (!popSymbolResolution(symbol)) {
                        isIncomplete = true;
                    }
                    symbolPopped = true;

                    if (type) {
                        if (decl.type === DeclarationType.Variable) {
                            let isConstant = false;
                            if (decl.type === DeclarationType.Variable) {
                                if (decl.isConstant || isFinalVariableDeclaration(decl)) {
                                    isConstant = true;
                                }
                            }

                            // Treat enum values declared within an enum class as though they are const even
                            // though they may not be named as such.
                            if (
                                isClassInstance(type) &&
                                ClassType.isEnumClass(type) &&
                                isDeclInEnumClass(evaluatorInterface, decl)
                            ) {
                                isConstant = true;
                            }

                            // If the symbol is constant, we can retain the literal
                            // value and TypeForm types. Otherwise, strip literal values
                            // and TypeForm types to widen.
                            if (TypeBase.isInstance(type) && !isConstant && !isExplicitTypeAliasDeclaration(decl)) {
                                type = stripTypeForm(stripLiteralValue(type));
                            }
                        }

                        typesToCombine.push(type);

                        if (isSpeculativeModeInUse(decl.node)) {
                            includesSpeculativeResult = true;
                        }
                    } else {
                        isIncomplete = true;
                    }
                } catch (e: any) {
                    // Clean up the stack before rethrowing, but only if we haven't already popped.
                    if (!symbolPopped) {
                        popSymbolResolution(symbol);
                    }
                    throw e;
                }
            } else {
                if (decl.type === DeclarationType.Class) {
                    const classTypeInfo = getTypeOfClass(decl.node);
                    if (classTypeInfo?.decoratedType) {
                        typesToCombine.push(classTypeInfo.decoratedType);
                    }
                }

                isIncomplete = true;

                // Note that at least one decl could not be evaluated because
                // it was already in the process of being evaluated.
                sawPendingEvaluation = true;
            }
        });

        // How many times have we already attempted to evaluate this declaration already?
        const cacheEntries = effectiveTypeCache.get(symbol.id);
        const evaluationAttempts = (cacheEntries?.get(typeCacheKey)?.evaluationAttempts ?? 0) + 1;

        let type: Type;

        if (typesToCombine.length > 0) {
            // Ignore the pending evaluation flag if we've already attempted the
            // type evaluation many times because this probably means there's a
            // cyclical dependency that cannot be broken.
            isIncomplete = sawPendingEvaluation && evaluationAttempts < maxEffectiveTypeEvaluationAttempts;

            type = combineTypes(typesToCombine);
        } else {
            // We can encounter this situation in the case of a bare ClassVar annotation.
            if (symbol.isClassVar()) {
                type = UnknownType.create();
                isIncomplete = false;
            } else {
                type = UnboundType.create();
            }
        }

        return { type, isIncomplete, includesSpeculativeResult, evaluationAttempts };
    }

    // If a declaration has an explicit type (e.g. a variable with an annotation),
    // this function evaluates the type and returns it. If the symbol has no
    // explicit declared type, its type will need to be inferred instead. In some
    // cases, non-type information (such as Final or ClassVar attributes) may be
    // provided, but type inference is still required. In such cases, the attributes
    // are returned as flags.
    function getDeclaredTypeOfSymbol(symbol: Symbol, usageNode?: NameNode): DeclaredSymbolTypeInfo {
        const synthesizedType = symbol.getSynthesizedType()?.type;
        if (synthesizedType) {
            return { type: synthesizedType };
        }

        let typedDecls = symbol.getTypedDeclarations();

        if (typedDecls.length === 0) {
            // If the symbol has no type declaration but is assigned many times,
            // treat it as though it has an explicit type annotation of "Unknown".
            // This will avoid a pathological performance condition for unannotated
            // code that reassigns the same variable hundreds of times. If the symbol
            // effectively has an "Any" annotation, it won't be narrowed.
            const declarations = symbol.getDeclarations();
            if (declarations.length > maxDeclarationsToUseForInference) {
                let isExceptionVariable = exceptionTargetSymbolCache.get(symbol.id);
                if (isExceptionVariable === undefined) {
                    isExceptionVariable = declarations.every((decl) => {
                        if (decl.type !== DeclarationType.Variable) {
                            return false;
                        }

                        const parent = decl.node.parent;
                        return parent?.nodeType === ParseNodeType.Except && parent.d.name === decl.node;
                    });
                    exceptionTargetSymbolCache.set(symbol.id, isExceptionVariable);
                }

                // Exception targets get their types from code flow. Don't let the
                // declaration-count safeguard turn repeated targets into declared Unknown.
                if (!isExceptionVariable) {
                    return { type: UnknownType.create() };
                }
            }

            // There was no declaration with a defined type.
            return { type: undefined };
        }

        // If there is more than one typed decl, filter out any that are not
        // reachable from the usage node (if specified). This can happen in
        // cases where a property symbol is redefined to add a setter, deleter,
        // etc.
        let exceedsMaxDecls = false;
        if (usageNode && typedDecls.length > 1) {
            if (typedDecls.length > maxTypedDeclsPerSymbol) {
                // If there are too many typed decls, don't bother filtering them
                // because this can be very expensive. Simply use the last one
                // in this case.
                typedDecls = [typedDecls[typedDecls.length - 1]];
                exceedsMaxDecls = true;
            } else {
                const filteredTypedDecls = typedDecls.filter((decl) => {
                    if (decl.type !== DeclarationType.Alias) {
                        // Is the declaration in the same execution scope as the "usageNode" node?
                        const usageScope = ParseTreeUtils.getExecutionScopeNode(usageNode, nodeInfo);
                        const declScope = ParseTreeUtils.getExecutionScopeNode(decl.node, nodeInfo);

                        if (usageScope === declScope) {
                            // For typed declarations we use the precise flow-graph reachability
                            // check rather than a simple position comparison, because typed decls
                            // (e.g. explicit annotations) can legitimately appear after the usage
                            // in the source text (e.g. a class attribute annotated below a method
                            // that references it) and must not be excluded by position alone.
                            if (!isFlowPathBetweenNodes(decl.node, usageNode, /* allowSelf */ false)) {
                                return false;
                            }
                        }
                    }
                    return true;
                });

                if (filteredTypedDecls.length === 0) {
                    return { type: UnboundType.create() };
                }

                typedDecls = filteredTypedDecls;
            }
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
                return { type: partialType };
            }

            if (getIndexOfSymbolResolution(symbol, decl) < 0) {
                if (pushSymbolResolution(symbol, decl)) {
                    try {
                        const declaredTypeInfo = getTypeForDeclaration(decl);

                        // If there was recursion detected, don't use this declaration.
                        // The exception is it's a class declaration because getTypeOfClass
                        // handles recursion by populating a partially-created class type
                        // in the type cache. This exception is required to handle the
                        // circular dependency between the "type" and "object" classes in
                        // builtins.pyi (since "object" is a "type" and "type" is an "object").
                        if (popSymbolResolution(symbol) || decl.type === DeclarationType.Class) {
                            return declaredTypeInfo;
                        }
                    } catch (e: any) {
                        // Clean up the stack before rethrowing.
                        popSymbolResolution(symbol);
                        throw e;
                    }
                }
            }

            declIndex--;
        }

        return { type: undefined, exceedsMaxDecls };
    }

    function inferReturnTypeIfNecessary(type: Type) {
        if (isFunction(type)) {
            getEffectiveReturnType(type);
        } else if (isOverloaded(type)) {
            OverloadedType.getOverloads(type).forEach((overload) => {
                getEffectiveReturnType(overload);
            });

            const impl = OverloadedType.getImplementation(type);
            if (impl && isFunction(impl)) {
                getEffectiveReturnType(impl);
            }
        }
    }

    function getEffectiveReturnType(type: FunctionType): Type {
        return getEffectiveReturnTypeResult(type).type;
    }

    function getInferredReturnType(type: FunctionType): Type {
        return getInferredReturnTypeResult(type).type;
    }

    // Returns the return type of the function. If the type is explicitly provided in
    // a type annotation, that type is returned. If not, an attempt is made to infer
    // the return type. If a list of args is provided, the inference logic may take
    // into account argument types to infer the return type.
    function getEffectiveReturnTypeResult(type: FunctionType, options?: EffectiveReturnTypeOptions): TypeResult {
        const specializedReturnType = FunctionType.getEffectiveReturnType(type, /* includeInferred */ false);
        if (specializedReturnType && !isUnknown(specializedReturnType)) {
            // A partially-unknown *inferred* return type (e.g. `Foo | Unknown`) can be
            // cached on a specialized/bound copy of an unannotated function. Because
            // `isUnknown` matches only a fully-unknown type, such a partial type would
            // otherwise short-circuit here and prevent call-site return-type inference
            // from ever running (e.g. an unannotated factory whose body narrows a
            // parameter-derived local with `isinstance`). When a call site is available,
            // fall through so the argument types can refine the inferred return type.
            //
            // NOTE: This gate intentionally mirrors a subset of the downstream call-site
            // refinement guard in `_getInferredReturnTypeResult` (search `isPartlyUnknown(returnType)`),
            // but tests the cached *specialized* return type here rather than the freshly-inferred
            // one, and omits the `!isStubDefinition`/`!isPyTypedDefinition`/`!isIncomplete`
            // conjuncts (not yet known at this point). Keep the two in sync if either is edited.
            const canRefineWithCallSite =
                options?.callSiteInfo !== undefined &&
                !type.shared.declaredReturnType &&
                FunctionType.hasUnannotatedParams(type) &&
                isPartlyUnknown(specializedReturnType);
            if (!canRefineWithCallSite) {
                return { type: specializedReturnType };
            }

            // Refine the cached partly-unknown return type using the call site. If the
            // refinement comes back incomplete -- e.g. a self- or mutually-recursive
            // factory whose base case returns the isinstance-narrowed local -- fall back
            // to the already-cached specialized return type rather than propagating the
            // incomplete result. The cached type is already correct in that case, and
            // propagating `isIncomplete` would suppress caller-side diagnostics that only
            // fire on a complete type (for example, `reveal_type`).
            const refinedResult = getInferredReturnTypeResult(type, options?.callSiteInfo);
            return refinedResult.isIncomplete ? { type: specializedReturnType } : refinedResult;
        }

        return getInferredReturnTypeResult(type, options?.callSiteInfo);
    }

    function _getInferredReturnTypeResult(type: FunctionType, callSiteInfo?: CallSiteEvaluationInfo): TypeResult {
        let returnType: Type | undefined;
        let isIncomplete = false;
        const analyzeUnannotatedFunctions = true;

        // Don't attempt to infer the return type for a stub file.
        if (FunctionType.isStubDefinition(type)) {
            return { type: UnknownType.create() };
        }

        // Don't infer the return type for a ParamSpec value.
        if (FunctionType.isParamSpecValue(type)) {
            return { type: UnknownType.create() };
        }

        // Don't infer the return type for an overloaded function (unless it's synthesized,
        // which is needed for proper operation of the __get__ method in properties).
        if (FunctionType.isOverloaded(type) && !FunctionType.isSynthesizedMethod(type)) {
            return { type: UnknownType.create() };
        }

        const evalCount = type.shared.inferredReturnType?.evaluationCount ?? 0;

        // If the return type has already been lazily evaluated,
        // don't bother computing it again.
        if (type.shared.inferredReturnType && !type.shared.inferredReturnType.isIncomplete) {
            returnType = type.shared.inferredReturnType.type;
        } else if (evalCount > maxReturnTypeInferenceAttempts) {
            // Detect a case where a return type won't converge because of recursion.
            returnType = UnknownType.create();
        } else {
            // Don't bother inferring the return type of __init__ because it's
            // always None.
            if (FunctionType.isInstanceMethod(type) && type.shared.name === '__init__') {
                returnType = getNoneType();
            } else if (type.shared.declaration) {
                const functionNode = type.shared.declaration.node;
                const skipUnannotatedFunction =
                    !nodeInfo.getFileInfo(functionNode).diagnosticRuleSet.analyzeUnannotatedFunctions &&
                    ParseTreeUtils.isUnannotatedFunction(functionNode);

                // Skip return type inference if we are in "skip unannotated function" mode.
                if (!skipUnannotatedFunction && !checkCodeFlowTooComplex(functionNode.d.suite)) {
                    const codeFlowComplexity = nodeInfo.getCodeFlowComplexity(functionNode);

                    // For very complex functions that have no annotated parameter types,
                    // don't attempt to infer the return type because it can be extremely
                    // expensive.
                    const parametersAreAnnotated =
                        type.shared.parameters.length <= 1 ||
                        type.shared.parameters.some((param) => FunctionParam.isTypeDeclared(param));

                    if (parametersAreAnnotated || codeFlowComplexity < maxReturnTypeInferenceCodeFlowComplexity) {
                        // Temporarily disable speculative mode while we
                        // lazily evaluate the return type.
                        let returnTypeResult: TypeResult | undefined;
                        disableSpeculativeMode(() => {
                            returnTypeResult = inferFunctionReturnType(
                                functionNode,
                                FunctionType.isAbstractMethod(type),
                                callSiteInfo?.errorNode
                            );
                        });

                        returnType = returnTypeResult?.type;
                        if (returnTypeResult?.isIncomplete) {
                            isIncomplete = true;
                        }
                    }
                }
            }

            if (!returnType) {
                returnType = UnknownType.create();
            }

            // Externalize any TypeVars that appear in the type.
            const typeVarScopes: TypeVarScopeId[] = [];
            if (type.shared.typeVarScopeId) {
                typeVarScopes.push(type.shared.typeVarScopeId);
            }
            if (type.shared.methodClass?.shared.typeVarScopeId) {
                typeVarScopes.push(type.shared.methodClass.shared.typeVarScopeId);
            }
            returnType = makeTypeVarsFree(returnType, typeVarScopes);

            // Cache the type for next time.
            type.shared.inferredReturnType = { type: returnType, isIncomplete, evaluationCount: evalCount + 1 };
        }

        // If the type is partially unknown and the function has one or more unannotated
        // params, try to analyze the function with the provided argument types and
        // attempt to do a better job at inference.
        if (
            !isIncomplete &&
            analyzeUnannotatedFunctions &&
            isPartlyUnknown(returnType) &&
            FunctionType.hasUnannotatedParams(type) &&
            !FunctionType.isStubDefinition(type) &&
            !FunctionType.isPyTypedDefinition(type) &&
            callSiteInfo
        ) {
            let hasDecorators = false;
            let isAsync = false;
            const declNode = type.shared.declaration?.node;
            if (declNode) {
                if (declNode.d.decorators.length > 0) {
                    hasDecorators = true;
                }
                if (declNode.d.isAsync) {
                    isAsync = true;
                }
            }

            // We can't use this technique if decorators or async are used because they
            // would need to be applied to the inferred return type.
            if (!hasDecorators && !isAsync) {
                const contextualReturnType = inferReturnTypeForCallSite(type, callSiteInfo);
                if (contextualReturnType) {
                    returnType = contextualReturnType;

                    if (type.shared.declaration?.node) {
                        // Externalize any TypeVars that appear in the type.
                        const liveScopeIds = getTypeVarScopesForNode(type.shared.declaration.node);
                        returnType = makeTypeVarsFree(returnType, liveScopeIds);
                    }
                }
            }
        }

        const methodClass = type.shared.methodClass;
        if (
            type.priv.boundToType &&
            methodClass &&
            !FunctionType.isStaticMethod(type) &&
            type.priv.boundToType.shared.mro.some(
                (base) => isClass(base) && ClassType.isSameGenericClass(base, methodClass)
            )
        ) {
            // A synthesized property's __get__ retains the getter's methodClass but binds
            // to the descriptor, which must not replace the getter's Self.
            // Preserve a conditional receiver's original Self rather than its class bound.
            const selfType = getTypeCondition(type.priv.boundToType)?.find((condition) =>
                TypeVarType.isSelf(condition.typeVar)
            )?.typeVar;
            returnType = partiallySpecializeType(
                returnType,
                methodClass,
                getTypeClassType(),
                selfType ?? type.priv.boundToType
            );
        }

        return { type: returnType, isIncomplete };
    }

    function inferReturnTypeForCallSite(type: FunctionType, callSiteInfo: CallSiteEvaluationInfo): Type | undefined {
        return returnTypeInference.inferReturnTypeForCallSite(type, callSiteInfo);
    }

    // If the function has an explicitly-declared return type, it is returned
    // unaltered unless the function is a generator, in which case it is
    // modified to return only the return type for the generator.
    function getDeclaredReturnType(node: FunctionNode): Type | undefined {
        return memberResolution.getDeclaredReturnType(node);
    }

    function getTypeOfMember(member: ClassMember): Type {
        return memberResolution.getTypeOfMember(member);
    }

    function getTypeOfMemberInternal(
        errorNode: ExpressionNode | undefined,
        member: ClassMember,
        selfClass: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags
    ): TypeResult | undefined {
        return memberResolution.getTypeOfMemberInternal(errorNode, member, selfClass, flags);
    }

    function assignClass(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number,
        reportErrorsUsingObjType: boolean
    ): boolean {
        return typeCompatibility.assignClass(
            destType,
            srcType,
            diag,
            constraints,
            flags,
            recursionCount,
            reportErrorsUsingObjType
        );
    }

    // This function is used to validate or infer the variance of type
    // parameters within a class. If ignoreBaseClassVariance is set to false,
    // the type parameters for the base class are honored. This is useful for
    // variance inference (PEP 695). For validation of protocol variance, we
    // want to ignore the variance for all base classes in the class hierarchy.
    function assignClassToSelf(
        destType: ClassType,
        srcType: ClassType,
        assumedVariance: Variance,
        ignoreBaseClassVariance = true,
        recursionCount = 0
    ): boolean {
        assert(ClassType.isSameGenericClass(destType, srcType));
        assert(destType.shared.typeParams.length > 0);

        srcType = makeTypeVarsBound(srcType, getTypeVarScopeIds(srcType));
        destType = makeTypeVarsBound(destType, getTypeVarScopeIds(destType));

        let isAssignable = true;

        // Use a try/catch block here to make sure that we reset
        // the assignClassToSelfClass to undefined if an exception occurs.
        try {
            // Stash the current class type so any references to it are treated
            // as though all type parameters are invariant.
            assignClassToSelfStack.push({ class: destType, assumedVariance });

            ClassType.getSymbolTable(destType).forEach((symbol, name) => {
                if (!isAssignable || symbol.isIgnoredForProtocolMatch()) {
                    return;
                }

                // Constructor methods are exempt from variance calculations.
                if (name === '__new__' || name === '__init__') {
                    return;
                }

                const memberInfo = lookUpClassMember(srcType, name);
                assert(memberInfo !== undefined);

                let destMemberType = getEffectiveTypeOfSymbol(symbol);

                // The synthesized NamedTuple _replace method adds typed field
                // parameters to typeshed's "**kwargs: Any" signature. Don't let
                // them change the variance inferred from the typeshed declaration.
                if (
                    name === '_replace' &&
                    ClassType.isNamedTupleClass(destType) &&
                    symbol.getSynthesizedType() &&
                    isFunction(destMemberType) &&
                    FunctionType.isSynthesizedMethod(destMemberType)
                ) {
                    return;
                }

                const srcMemberType = getTypeOfMember(memberInfo);
                destMemberType = partiallySpecializeType(destMemberType, destType, getTypeClassType());

                // Properties require special processing.
                if (
                    isClassInstance(destMemberType) &&
                    ClassType.isPropertyClass(destMemberType) &&
                    isClassInstance(srcMemberType) &&
                    ClassType.isPropertyClass(srcMemberType)
                ) {
                    if (
                        !assignProperty(
                            evaluatorInterface,
                            ClassType.cloneAsInstantiable(destMemberType),
                            ClassType.cloneAsInstantiable(srcMemberType),
                            destType,
                            srcType,
                            /* diag */ undefined,
                            /* constraints */ undefined,
                            /* selfConstraints */ undefined,
                            AssignTypeFlags.Default,
                            recursionCount
                        )
                    ) {
                        isAssignable = false;
                    }
                } else {
                    const primaryDecl = symbol.getDeclarations()[0];

                    let flags = AssignTypeFlags.Default;
                    if (
                        primaryDecl?.type === DeclarationType.Variable &&
                        !isFinalVariableDeclaration(primaryDecl) &&
                        !isMemberReadOnly(destType, name)
                    ) {
                        // Class and instance variables that are mutable need to
                        // enforce invariance. We will exempt variables that are
                        // private or protected, since these are presumably
                        // not modifiable outside of the class.
                        if (!isPrivateOrProtectedName(name)) {
                            flags |= AssignTypeFlags.Invariant;
                        }
                    }

                    if (
                        !assignType(
                            destMemberType,
                            srcMemberType,
                            /* diag */ undefined,
                            /* constraints */ undefined,
                            flags | AssignTypeFlags.SkipSelfClsParamCheck,
                            recursionCount
                        )
                    ) {
                        isAssignable = false;
                    }
                }
            });

            if (!isAssignable) {
                return false;
            }

            // Now handle generic base classes.
            destType.shared.baseClasses.forEach((baseClass) => {
                if (
                    !isAssignable ||
                    !isInstantiableClass(baseClass) ||
                    ClassType.isBuiltIn(baseClass, ['object', 'Protocol', 'Generic']) ||
                    baseClass.shared.typeParams.length === 0
                ) {
                    return;
                }

                const specializedDestBaseClass = specializeForBaseClass(destType, baseClass);
                const specializedSrcBaseClass = specializeForBaseClass(srcType, baseClass);

                if (!ignoreBaseClassVariance) {
                    specializedDestBaseClass.shared.typeParams.forEach((param, index) => {
                        if (isParamSpec(param) || isTypeVarTuple(param) || param.shared.isSynthesized) {
                            return;
                        }

                        if (
                            !specializedSrcBaseClass.priv.typeArgs ||
                            index >= specializedSrcBaseClass.priv.typeArgs.length ||
                            !specializedDestBaseClass.priv.typeArgs ||
                            index >= specializedDestBaseClass.priv.typeArgs.length
                        ) {
                            return;
                        }

                        const paramVariance = param.shared.declaredVariance;
                        if (isTypeVar(specializedSrcBaseClass.priv.typeArgs[index])) {
                            if (paramVariance === Variance.Invariant || paramVariance === Variance.Contravariant) {
                                isAssignable = false;
                                return;
                            }
                        }

                        if (isTypeVar(specializedDestBaseClass.priv.typeArgs[index])) {
                            if (paramVariance === Variance.Invariant || paramVariance === Variance.Covariant) {
                                isAssignable = false;
                                return;
                            }
                        }
                    });
                }

                if (!isAssignable) {
                    return;
                }

                // Handle tuples specially since their type arguments are variadic.
                if (ClassType.isTupleClass(specializedDestBaseClass)) {
                    return;
                }

                if (
                    !assignClassToSelf(
                        specializedDestBaseClass,
                        specializedSrcBaseClass,
                        assumedVariance,
                        ignoreBaseClassVariance,
                        recursionCount
                    )
                ) {
                    isAssignable = false;
                }
            });

            return isAssignable;
        } finally {
            assignClassToSelfStack.pop();
        }
    }

    function getGetterTypeFromProperty(propertyClass: ClassType): Type | undefined {
        if (!ClassType.isPropertyClass(propertyClass)) {
            return undefined;
        }

        if (propertyClass.priv.fgetInfo && isFunction(propertyClass.priv.fgetInfo.methodType)) {
            return getEffectiveReturnType(propertyClass.priv.fgetInfo.methodType);
        }

        return undefined;
    }

    function assignTypeArgs(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        assert(ClassType.isSameGenericClass(destType, srcType));

        inferVarianceForClass(destType);

        const destTypeParams = ClassType.getTypeParams(destType);
        let destTypeArgs: Type[];
        let srcTypeArgs: Type[] | undefined;

        // Are we performing protocol variance validation for this class? If so,
        // treat all of the type parameters as invariant even if they are declared
        // otherwise.
        const assignClassToSelfInfo = assignClassToSelfStack.find((info) =>
            ClassType.isSameGenericClass(info.class, destType)
        );
        const assumedVariance = assignClassToSelfInfo?.assumedVariance;

        // If either source or dest type arguments are missing, they are
        // treated as "Any", so they are assumed to be assignable.
        if (!destType.priv.typeArgs || !srcType.priv.typeArgs) {
            return true;
        }

        if (ClassType.isTupleClass(destType)) {
            destTypeArgs = destType.priv.tupleTypeArgs?.map((t) => t.type) ?? [];
            srcTypeArgs = srcType.priv.tupleTypeArgs?.map((t) => t.type);
        } else {
            destTypeArgs = destType.priv.typeArgs;
            srcTypeArgs = srcType.priv.typeArgs;
        }

        let isCompatible = true;

        srcTypeArgs?.forEach((srcTypeArg, srcArgIndex) => {
            // In most cases, the number of type args should match the number
            // of type arguments, but there are a few special cases where this
            // isn't true (e.g. assigning a Tuple[X, Y, Z] to a tuple[W]).
            const destArgIndex = srcArgIndex >= destTypeArgs.length ? destTypeArgs.length - 1 : srcArgIndex;
            const destTypeArg = destArgIndex >= 0 ? destTypeArgs[destArgIndex] : UnknownType.create();
            const destTypeParam = destArgIndex < destTypeParams.length ? destTypeParams[destArgIndex] : undefined;
            const assignmentDiag = new DiagnosticAddendum();
            const variance =
                assumedVariance ?? (destTypeParam ? TypeVarType.getVariance(destTypeParam) : Variance.Covariant);
            let effectiveFlags: AssignTypeFlags;
            let errorSource: () => ParameterizedString<{ name: string; sourceType: string; destType: string }>;
            let includeDiagAddendum = true;

            if (variance === Variance.Covariant) {
                effectiveFlags = flags | AssignTypeFlags.RetainLiteralsForTypeVar;
                errorSource = LocAddendum.typeVarIsCovariant;
            } else if (variance === Variance.Contravariant) {
                effectiveFlags = flags | AssignTypeFlags.Contravariant | AssignTypeFlags.RetainLiteralsForTypeVar;
                errorSource = LocAddendum.typeVarIsContravariant;
            } else {
                effectiveFlags = flags | AssignTypeFlags.Invariant | AssignTypeFlags.RetainLiteralsForTypeVar;
                errorSource = LocAddendum.typeVarIsInvariant;

                // Omit the diagnostic addendum for the invariant case because it's obvious
                // why two types are not the same.
                includeDiagAddendum = false;
            }

            // Special-case TypeForm to retain literals when solving TypeVars.
            if (ClassType.isBuiltIn(destType, 'TypeForm')) {
                effectiveFlags |= AssignTypeFlags.RetainLiteralsForTypeVar;
            }

            if (
                !assignType(
                    variance === Variance.Contravariant ? srcTypeArg : destTypeArg,
                    variance === Variance.Contravariant ? destTypeArg : srcTypeArg,
                    assignmentDiag,
                    constraints,
                    effectiveFlags,
                    recursionCount
                )
            ) {
                // Don't report errors with type variables in "pseudo-random"
                // classes since these type variables are not real.
                if (!ClassType.isPseudoGenericClass(destType)) {
                    if (diag) {
                        if (destTypeParam) {
                            const childDiag = diag.createAddendum();

                            childDiag.addMessage(
                                errorSource().format({
                                    name: TypeVarType.getReadableName(destTypeParam),
                                    ...printSrcDestTypes(srcTypeArg, destTypeArg),
                                })
                            );

                            if (includeDiagAddendum) {
                                childDiag.addAddendum(assignmentDiag);
                            }

                            if (isCompatible && ClassType.isSameGenericClass(destType, srcType)) {
                                // Add additional notes to help the user if this is a common type mismatch.
                                if (ClassType.isBuiltIn(destType, 'dict') && srcArgIndex === 1) {
                                    childDiag.addMessage(LocAddendum.invariantSuggestionDict());
                                } else if (ClassType.isBuiltIn(destType, 'list')) {
                                    childDiag.addMessage(LocAddendum.invariantSuggestionList());
                                } else if (ClassType.isBuiltIn(destType, 'set')) {
                                    childDiag.addMessage(LocAddendum.invariantSuggestionSet());
                                }
                            }
                        } else {
                            diag.addAddendum(assignmentDiag);
                        }
                    }
                    isCompatible = false;
                }
            }
        });

        return isCompatible;
    }

    // Determines if the source type can be assigned to the dest type.
    // If constraint are provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    function assignType(
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags = AssignTypeFlags.Default,
        recursionCount = 0
    ): boolean {
        // Handle the case where the dest and src types are the same object.
        // We can normally shortcut this and say that they are compatible,
        // but if the type includes TypeVars, we need to go through
        // the rest of the logic.
        if (destType === srcType && !requiresSpecialization(destType)) {
            return true;
        }

        // If the source type is a special form, use the literal special form
        // class rather than the symbolic form.
        const specialForm = srcType.props?.specialForm;
        if (specialForm) {
            let isSpecialFormExempt = false;

            // A few special forms that are normally not compatible with type[T]
            // are compatible specifically in the context of isinstance and issubclass.
            if ((flags & AssignTypeFlags.AllowIsinstanceSpecialForms) !== 0) {
                if (ClassType.isBuiltIn(specialForm, ['Callable', 'UnionType', 'Generic'])) {
                    isSpecialFormExempt = true;
                }
            }

            if (!isSpecialFormExempt) {
                if (srcType.props?.typeForm && !specialForm.props?.typeForm) {
                    srcType = TypeBase.cloneWithTypeForm(specialForm, srcType.props.typeForm);
                } else {
                    srcType = specialForm;
                }
            }
        }

        // A subscripted runtime built-in such as list[int] is represented as its
        // precise class type, but it is also a types.GenericAlias object at runtime.
        if (
            isClassInstance(destType) &&
            ClassType.isBuiltIn(destType, 'GenericAlias') &&
            isInstantiableClass(srcType) &&
            !ClassType.isSpecialBuiltIn(srcType) &&
            !srcType.priv.aliasName &&
            srcType.shared.moduleName === 'builtins' &&
            srcType.priv.typeArgs !== undefined &&
            srcType.props?.typeForm &&
            classGetItemReturnsGenericAlias(srcType)
        ) {
            return true;
        }

        // If the source is a class-like type created by a call to NewType, treat it
        // as a FunctionClass instance rather than an instantiable class for
        // purposes of assignability. This reflects its actual runtime type.
        if (isInstantiableClass(srcType) && ClassType.isNewTypeClass(srcType) && !srcType.priv.includeSubclasses) {
            if (prefetched?.functionClass && isInstantiableClass(prefetched?.functionClass)) {
                srcType = ClassType.cloneAsInstance(prefetched.functionClass);
            }
        }

        if (recursionCount > maxTypeRecursionCount) {
            noteAssignTypeRecursionLimit();
            return true;
        }
        recursionCount++;

        // If the source and dest refer to the recursive type aliases, handle
        // the case specially to avoid recursing down both type aliases.
        if (
            isTypeVar(destType) &&
            destType.shared.recursiveAlias &&
            isTypeVar(srcType) &&
            srcType.shared.recursiveAlias
        ) {
            const destAliasInfo = destType.props?.typeAliasInfo;
            const srcAliasInfo = srcType.props?.typeAliasInfo;

            // Do the source and dest refer to the same recursive type alias?
            if (
                destAliasInfo?.typeArgs &&
                srcAliasInfo?.typeArgs &&
                destType.shared.recursiveAlias.typeVarScopeId === srcType.shared.recursiveAlias.typeVarScopeId
            ) {
                return assignRecursiveTypeAliasToSelf(
                    destAliasInfo,
                    srcAliasInfo,
                    diag,
                    constraints,
                    flags,
                    recursionCount
                );
            } else {
                // Have we already recursed once?
                if ((flags & AssignTypeFlags.SkipRecursiveTypeCheck) !== 0) {
                    return true;
                }

                // Note that we are comparing two recursive types and do
                // not recursive more than once.
                flags |= AssignTypeFlags.SkipRecursiveTypeCheck;
            }
        }

        // If one or both of the types has an instantiable depth greater than
        // zero, convert both to instances first.
        if (TypeBase.isInstantiable(destType) && TypeBase.isInstantiable(srcType)) {
            if (TypeBase.getInstantiableDepth(destType) > 0 || TypeBase.getInstantiableDepth(srcType) > 0) {
                return assignType(
                    convertToInstance(destType),
                    convertToInstance(srcType),
                    diag,
                    constraints,
                    flags,
                    recursionCount
                );
            }
        }

        // Transform recursive type aliases if necessary.
        const transformedDestType = transformPossibleRecursiveTypeAlias(destType);
        const transformedSrcType = transformPossibleRecursiveTypeAlias(srcType);

        // Did either the source or dest include recursive type aliases?
        // If so, we could be dealing with different recursive type aliases
        // or a recursive type alias and a recursive protocol definition.
        if (
            (transformedDestType !== destType && isUnion(transformedDestType)) ||
            (transformedSrcType !== srcType && isUnion(transformedSrcType))
        ) {
            // Use a smaller recursive limit in this case to prevent runaway recursion.
            if (recursionCount > maxRecursiveTypeAliasRecursionCount) {
                // Add a special case for when the source is a str, which is itself
                // a recursive type (since it derives from Sequence[str]).
                if (isClassInstance(srcType) && ClassType.isBuiltIn(srcType, 'str') && isUnion(transformedDestType)) {
                    return transformedDestType.priv.subtypes.some(
                        (subtype) => isClassInstance(subtype) && ClassType.isBuiltIn(subtype, ['object', 'str'])
                    );
                }
                return true;
            }
        }

        destType = transformedDestType;
        srcType = transformedSrcType;

        // If the source or dest is unbound, allow the assignment. The
        // error will be reported elsewhere.
        if (isUnbound(destType) || isUnbound(srcType)) {
            return true;
        }

        if (isTypeVar(destType)) {
            if (isTypeVarSame(destType, srcType)) {
                return true;
            }

            // If the dest is a constrained or bound type variable and all of the
            // types in the source are conditioned on that same type variable
            // and have compatible types, we'll consider it assignable.
            if (assignConditionalTypeToTypeVar(destType, srcType, recursionCount)) {
                return true;
            }

            // If the source is a conditional type associated with a bound TypeVar
            // and the bound TypeVar matches the condition, the types are compatible.
            const destTypeVar = destType;
            if (
                TypeBase.isInstantiable(destType) === TypeBase.isInstantiable(srcType) &&
                srcType.props?.condition &&
                srcType.props.condition.some((cond) => {
                    return (
                        !TypeVarType.hasConstraints(cond.typeVar) &&
                        cond.typeVar.priv.nameWithScope === destTypeVar.priv.nameWithScope
                    );
                })
            ) {
                return true;
            }

            if (isUnion(srcType)) {
                const srcWithoutAny = removeFromUnion(srcType, (type) => isAnyOrUnknown(type));
                // TypeForm metadata can keep equivalent TypeVars as separate union arms.
                if (!someSubtypes(srcWithoutAny, (subtype) => !isTypeSame(destTypeVar, subtype))) {
                    return true;
                }
            }

            // Handle the special case where both types are Self types. We'll allow
            // them to be treated as equivalent to handle certain common idioms.
            if (
                isTypeVar(srcType) &&
                TypeVarType.isSelf(srcType) &&
                TypeVarType.hasBound(srcType) &&
                TypeVarType.isSelf(destType) &&
                TypeVarType.hasBound(destType) &&
                TypeVarType.isBound(destType) === TypeVarType.isBound(srcType) &&
                TypeBase.isInstance(srcType) === TypeBase.isInstance(destType)
            ) {
                if ((flags & AssignTypeFlags.Contravariant) === 0 && constraints) {
                    assignTypeVar(evaluatorInterface, destType, srcType, diag, constraints, flags, recursionCount);
                }
                return true;
            }

            // If the dest is a TypeVarTuple, and the source is a tuple
            // with a single entry that is the same TypeVarTuple, it's a match.
            if (
                isTypeVarTuple(destType) &&
                isClassInstance(srcType) &&
                isTupleClass(srcType) &&
                srcType.priv.tupleTypeArgs &&
                srcType.priv.tupleTypeArgs.length === 1
            ) {
                if (isTypeSame(destType, srcType.priv.tupleTypeArgs[0].type, {}, recursionCount)) {
                    return true;
                }
            }

            if ((flags & AssignTypeFlags.Contravariant) === 0 || !isTypeVar(srcType)) {
                if (!assignTypeVar(evaluatorInterface, destType, srcType, diag, constraints, flags, recursionCount)) {
                    return false;
                }

                if (isAnyOrUnknown(srcType) && (flags & AssignTypeFlags.OverloadOverlap) !== 0) {
                    return false;
                }

                return true;
            }
        }

        if (isTypeVar(srcType)) {
            if ((flags & AssignTypeFlags.Contravariant) !== 0) {
                if (TypeVarType.isBound(srcType)) {
                    return assignType(
                        makeTopLevelTypeVarsConcrete(destType),
                        makeTopLevelTypeVarsConcrete(srcType),
                        diag,
                        /* constraints */ undefined,
                        flags,
                        recursionCount
                    );
                }

                if (assignTypeVar(evaluatorInterface, srcType, destType, diag, constraints, flags, recursionCount)) {
                    return true;
                }

                // If the dest type is a union, only one of the subtypes needs to match.
                let isAssignable = false;
                if (isUnion(destType)) {
                    doForEachSubtype(destType, (destSubtype) => {
                        if (
                            assignTypeVar(
                                evaluatorInterface,
                                srcType as TypeVarType,
                                destSubtype,
                                diag,
                                constraints,
                                flags,
                                recursionCount
                            )
                        ) {
                            isAssignable = true;
                        }
                    });
                }
                return isAssignable;
            }

            if ((flags & AssignTypeFlags.Invariant) !== 0) {
                if (isAnyOrUnknown(destType)) {
                    return true;
                }

                // If the source is a ParamSpec and the dest is a "...", this is
                // effectively like an "Any" signature, so we'll treat it as though
                // it's Any.
                if (
                    isParamSpec(srcType) &&
                    isFunction(destType) &&
                    FunctionType.isGradualCallableForm(destType) &&
                    destType.shared.parameters.length <= 2
                ) {
                    return true;
                }

                // If the source is an unpacked TypeVarTuple and the dest is a
                // *tuple[Any, ...], we'll treat it as compatible.
                if (
                    isUnpackedTypeVarTuple(srcType) &&
                    isClassInstance(destType) &&
                    isUnpackedClass(destType) &&
                    destType.priv.tupleTypeArgs &&
                    destType.priv.tupleTypeArgs.length === 1 &&
                    destType.priv.tupleTypeArgs[0].isUnbounded &&
                    isAnyOrUnknown(destType.priv.tupleTypeArgs[0].type)
                ) {
                    return true;
                }

                if (!isUnion(destType)) {
                    diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                    return false;
                }
            }
        }

        if (isAnyOrUnknown(destType)) {
            return true;
        }

        if (isAnyOrUnknown(srcType) && !srcType.props?.specialForm) {
            if (constraints) {
                // If it's an ellipsis type, convert it to a regular "Any"
                // type. These are functionally equivalent, but "Any" looks
                // better in the text representation.
                const typeVarSubstitution = isEllipsisType(srcType) ? AnyType.create() : srcType;
                setConstraintsForFreeTypeVars(destType, typeVarSubstitution, constraints);
            }
            if ((flags & AssignTypeFlags.OverloadOverlap) === 0) {
                return true;
            }
        }

        if (isNever(srcType)) {
            if ((flags & AssignTypeFlags.Invariant) !== 0) {
                if (isNever(destType)) {
                    return true;
                }

                diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                return false;
            }

            if (constraints) {
                setConstraintsForFreeTypeVars(destType, UnknownType.create(), constraints);
            }
            return true;
        }

        const isInvariant = (flags & AssignTypeFlags.Invariant) !== 0;
        srcType = expandEnumTypeForLiteralComparison(srcType, destType, /* concretizeTypeVars */ !isInvariant);
        if (isInvariant) {
            destType = expandEnumTypeForLiteralComparison(destType, srcType, /* concretizeTypeVars */ false);
        }

        if (isUnion(destType)) {
            // If both the source and dest are unions, use assignFromUnionType which has
            // special-case logic to handle this case.
            if (isUnion(srcType)) {
                return assignFromUnionType(destType, srcType, diag, constraints, flags, recursionCount);
            }

            const clonedConstraints = constraints?.clone();
            if (assignToUnionType(destType, srcType, /* diag */ undefined, clonedConstraints, flags, recursionCount)) {
                if (constraints && clonedConstraints) {
                    constraints.copyFromClone(clonedConstraints);
                }
                return true;
            }
        }

        const expandedSrcType = makeTopLevelTypeVarsConcrete(srcType);
        if (isUnion(expandedSrcType)) {
            return assignFromUnionType(destType, expandedSrcType, diag, constraints, flags, recursionCount);
        }

        if (isUnion(destType)) {
            return assignToUnionType(destType, srcType, diag, constraints, flags, recursionCount);
        }

        // Is the src a specialized "type" object?
        if (isClassInstance(expandedSrcType) && ClassType.isBuiltIn(expandedSrcType, 'type')) {
            const srcTypeArgs = expandedSrcType.priv.typeArgs;
            let typeTypeArg: Type;

            if (srcTypeArgs && srcTypeArgs.length >= 1) {
                typeTypeArg = srcTypeArgs[0];
            } else {
                typeTypeArg = UnknownType.create();
            }

            if (isAnyOrUnknown(typeTypeArg)) {
                if (isEffectivelyInstantiable(destType)) {
                    return true;
                }
            } else if (isClassInstance(typeTypeArg) || isTypeVar(typeTypeArg)) {
                if (
                    assignType(
                        destType,
                        convertToInstantiable(typeTypeArg),
                        diag?.createAddendum(),
                        constraints,
                        flags,
                        recursionCount
                    )
                ) {
                    return true;
                }

                diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                return false;
            }
        }

        if (isInstantiableClass(destType)) {
            if (isInstantiableClass(expandedSrcType)) {
                // PEP 544 says that if the dest type is a type[Proto] class,
                // the source must be a "concrete" (non-protocol) class.
                if (ClassType.isProtocolClass(destType)) {
                    if (
                        (flags & AssignTypeFlags.AllowProtocolClassSource) === 0 &&
                        ClassType.isProtocolClass(expandedSrcType) &&
                        isInstantiableClass(srcType) &&
                        !srcType.priv.includeSubclasses
                    ) {
                        diag?.addMessage(
                            LocAddendum.protocolSourceIsNotConcrete().format({
                                sourceType: printType(convertToInstance(srcType)),
                                destType: printType(destType),
                            })
                        );
                        return false;
                    }
                }

                if (ClassType.isBuiltIn(destType, 'type') && (srcType.props?.instantiableDepth ?? 0) > 0) {
                    return true;
                }

                if (isSpecialFormClass(expandedSrcType, flags)) {
                    // Special form classes are compatible only with other special form
                    // classes, not with 'object' or 'type'.
                    const destSpecialForm = destType.props?.specialForm ?? destType;
                    if (isSpecialFormClass(destSpecialForm, flags)) {
                        return assignType(destSpecialForm, expandedSrcType, diag, constraints, flags, recursionCount);
                    }
                } else if (
                    assignClass(
                        destType,
                        expandedSrcType,
                        diag,
                        constraints,
                        flags,
                        recursionCount,
                        /* reportErrorsUsingObjType */ false
                    )
                ) {
                    return true;
                }

                diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                return false;
            }
        }

        if (isClassInstance(destType)) {
            if (ClassType.isBuiltIn(destType, 'type')) {
                if (
                    isInstantiableClass(srcType) &&
                    isSpecialFormClass(srcType, flags) &&
                    TypeBase.getInstantiableDepth(srcType) === 0
                ) {
                    return false;
                }

                if (isAnyOrUnknown(srcType) && (flags & AssignTypeFlags.OverloadOverlap) !== 0) {
                    return false;
                }

                const destTypeArgs = destType.priv.typeArgs;
                if (destTypeArgs && destTypeArgs.length >= 1) {
                    if (TypeBase.isInstance(destTypeArgs[0]) && TypeBase.isInstantiable(srcType)) {
                        return assignType(
                            destTypeArgs[0],
                            convertToInstance(srcType),
                            diag,
                            constraints,
                            flags,
                            recursionCount
                        );
                    }
                }

                // Is the dest a "type" object? Assume that all instantiable
                // types are assignable to "type".
                if (TypeBase.isInstantiable(srcType)) {
                    const isLiteral = isClass(srcType) && srcType.priv.literalValue !== undefined;
                    return !isLiteral;
                }
            }

            let concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

            // Handle the TypeForm special form. Add a special case for
            // type[T] to be assignable to TypeForm[T].
            if (ClassType.isBuiltIn(destType, 'TypeForm')) {
                const destTypeArg =
                    destType.priv.typeArgs && destType.priv.typeArgs.length > 0
                        ? destType.priv.typeArgs[0]
                        : AnyType.create();

                let srcTypeArg: Type | undefined;
                if (isClassInstance(concreteSrcType) && ClassType.isBuiltIn(concreteSrcType, 'type')) {
                    srcTypeArg = concreteSrcType;
                } else if (isInstantiableClass(concreteSrcType)) {
                    srcTypeArg = convertToInstance(concreteSrcType);
                }

                if (srcTypeArg) {
                    return assignType(destTypeArg, srcTypeArg, diag, constraints, flags, recursionCount);
                }
            }

            if (isClass(concreteSrcType) && TypeBase.isInstance(concreteSrcType)) {
                // Handle the case where the source is an unpacked tuple.
                if (
                    !destType.priv.isUnpacked &&
                    concreteSrcType.priv.isUnpacked &&
                    concreteSrcType.priv.tupleTypeArgs
                ) {
                    return assignType(
                        destType,
                        combineTupleTypeArgs(concreteSrcType.priv.tupleTypeArgs),
                        diag,
                        constraints,
                        flags,
                        recursionCount
                    );
                }

                if (
                    destType.priv.literalValue !== undefined &&
                    ClassType.isSameGenericClass(destType, concreteSrcType)
                ) {
                    const srcLiteral = concreteSrcType.priv.literalValue;
                    if (srcLiteral === undefined || !ClassType.isLiteralValueSame(concreteSrcType, destType)) {
                        diag?.addMessage(
                            LocAddendum.literalAssignmentMismatch().format({
                                sourceType: printType(srcType),
                                destType: printType(destType),
                            })
                        );

                        return false;
                    }
                }

                // Handle LiteralString special form.
                if (ClassType.isBuiltIn(destType, 'LiteralString')) {
                    if (
                        ClassType.isBuiltIn(concreteSrcType, 'str') &&
                        concreteSrcType.priv.literalValue !== undefined
                    ) {
                        return (flags & AssignTypeFlags.Invariant) === 0;
                    } else if (ClassType.isBuiltIn(concreteSrcType, 'LiteralString')) {
                        return true;
                    }
                } else if (
                    ClassType.isBuiltIn(concreteSrcType, 'LiteralString') &&
                    prefetched?.strClass &&
                    isInstantiableClass(prefetched.strClass) &&
                    (flags & AssignTypeFlags.Invariant) === 0
                ) {
                    concreteSrcType = ClassType.cloneAsInstance(prefetched.strClass);
                }

                if (
                    !assignClass(
                        ClassType.cloneAsInstantiable(destType),
                        ClassType.cloneAsInstantiable(concreteSrcType),
                        diag,
                        constraints,
                        flags,
                        recursionCount,
                        /* reportErrorsUsingObjType */ true
                    )
                ) {
                    return false;
                }

                return true;
            } else if (isFunctionOrOverloaded(concreteSrcType)) {
                // Is the destination a callback protocol (defined in PEP 544)?
                const destCallbackType = getCallbackProtocolType(destType, recursionCount);
                if (destCallbackType) {
                    return assignType(destCallbackType, concreteSrcType, diag, constraints, flags, recursionCount);
                }

                // All functions are considered instances of "types.FunctionType" or "types.MethodType".
                const altClass = isMethodType(concreteSrcType) ? prefetched?.methodClass : prefetched?.functionClass;
                if (altClass) {
                    return assignType(destType, convertToInstance(altClass), diag, constraints, flags, recursionCount);
                }
            } else if (isModule(concreteSrcType)) {
                // Is the destination the built-in "ModuleType"?
                if (ClassType.isBuiltIn(destType, 'ModuleType')) {
                    return true;
                }

                if (ClassType.isProtocolClass(destType)) {
                    return assignModuleToProtocol(
                        evaluatorInterface,
                        ClassType.cloneAsInstantiable(destType),
                        concreteSrcType,
                        diag,
                        constraints,
                        flags,
                        recursionCount
                    );
                }
            } else if (isInstantiableClass(concreteSrcType)) {
                // See if the destType is an instantiation of a Protocol
                // class that is effectively a function.
                const callbackType = getCallbackProtocolType(destType, recursionCount);
                if (callbackType) {
                    return assignType(callbackType, concreteSrcType, diag, constraints, flags, recursionCount);
                }

                // If the destType is an instantiation of a Protocol,
                // see if the class type itself satisfies the protocol.
                if (ClassType.isProtocolClass(destType)) {
                    return assignClassToProtocol(
                        evaluatorInterface,
                        ClassType.cloneAsInstantiable(destType),
                        concreteSrcType,
                        diag,
                        constraints,
                        flags,
                        recursionCount
                    );
                }

                // Determine if the metaclass can be assigned to the object.
                const metaclass = concreteSrcType.shared.effectiveMetaclass;
                if (metaclass) {
                    if (!isAnyOrUnknown(metaclass)) {
                        if (
                            assignClass(
                                ClassType.cloneAsInstantiable(destType),
                                metaclass,
                                /* diag */ undefined,
                                constraints,
                                flags,
                                recursionCount,
                                /* reportErrorsUsingObjType */ true
                            )
                        ) {
                            return true;
                        }
                    }
                }
            } else if (isAnyOrUnknown(concreteSrcType) && !concreteSrcType.props?.specialForm) {
                return (flags & AssignTypeFlags.OverloadOverlap) === 0;
            } else if (isUnion(concreteSrcType)) {
                return assignType(destType, concreteSrcType, diag, constraints, flags, recursionCount);
            }
        }

        if (isFunction(destType)) {
            let concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

            if (isClassInstance(concreteSrcType)) {
                const boundMethod = getBoundMagicMethod(
                    concreteSrcType,
                    '__call__',
                    /* selfType */ undefined,
                    /* errorNode */ undefined,
                    /* diag */ undefined,
                    recursionCount
                );
                if (boundMethod) {
                    concreteSrcType = boundMethod;
                }
            }

            // If it's a class, use the constructor for type compatibility checking.
            if (isInstantiableClass(concreteSrcType) && concreteSrcType.priv.literalValue === undefined) {
                const constructor = createFunctionFromConstructor(
                    evaluatorInterface,
                    concreteSrcType,
                    isTypeVar(srcType) ? convertToInstance(srcType) : undefined,
                    recursionCount
                );
                if (constructor) {
                    concreteSrcType = constructor;

                    // The constructor conversion may result in a union of the
                    // __init__ and __new__ callables.
                    if (isUnion(concreteSrcType)) {
                        return assignType(destType, concreteSrcType, diag, constraints, flags, recursionCount);
                    }
                }
            }

            if (isAnyOrUnknown(concreteSrcType)) {
                return (flags & AssignTypeFlags.OverloadOverlap) === 0;
            }

            if (isOverloaded(concreteSrcType)) {
                // If this is the first pass of an argument assignment, skip
                // all attempts to assign an overloaded function to a function
                // because we probably don't have enough information to properly
                // filter the overloads at this time. We will do this work on
                // subsequent passes.
                if ((flags & AssignTypeFlags.ArgAssignmentFirstPass) !== 0) {
                    return true;
                }

                // Find all of the overloaded functions that match the parameters.
                const overloads = OverloadedType.getOverloads(concreteSrcType);
                const filteredOverloads: FunctionType[] = [];
                const typeVarSignatures: ConstraintSet[] = [];

                overloads.forEach((overload) => {
                    const overloadScopeId = getTypeVarScopeId(overload) ?? '';
                    const constraintsClone = constraints?.cloneWithSignature(overloadScopeId);

                    if (assignType(destType, overload, /* diag */ undefined, constraintsClone, flags, recursionCount)) {
                        filteredOverloads.push(overload);

                        if (constraintsClone) {
                            appendArray(typeVarSignatures, constraintsClone.getConstraintSets());
                        }
                    }
                });

                if (filteredOverloads.length === 0) {
                    diag?.addMessage(LocAddendum.noOverloadAssignable().format({ type: printType(destType) }));
                    return false;
                }

                if (filteredOverloads.length === 1 || (flags & AssignTypeFlags.ArgAssignmentFirstPass) === 0) {
                    if (constraints) {
                        constraints.addConstraintSets(typeVarSignatures);
                    }
                }

                return true;
            }

            if (isFunction(concreteSrcType)) {
                if (
                    assignFunction(
                        destType,
                        concreteSrcType,
                        diag?.createAddendum(),
                        constraints ?? new ConstraintTracker(),
                        flags,
                        recursionCount
                    )
                ) {
                    return true;
                }
            }
        }

        if (isOverloaded(destType)) {
            const overloadDiag = diag?.createAddendum();

            // All overloads in the dest must be assignable.
            const destOverloads = OverloadedType.getOverloads(destType);

            // If the source is also an overload with the same number of overloads,
            // there's a good chance that there's a one-to-one mapping. Try this
            // first before using an n^2 algorithm.
            if (isOverloaded(srcType)) {
                const srcOverloads = OverloadedType.getOverloads(srcType);
                if (destOverloads.length === srcOverloads.length) {
                    if (
                        destOverloads.every((destOverload, index) => {
                            const srcOverload = srcOverloads[index];
                            return assignType(
                                destOverload,
                                srcOverload,
                                /* diag */ undefined,
                                constraints,
                                flags,
                                recursionCount
                            );
                        })
                    ) {
                        return true;
                    }
                }
            }

            const isAssignable = destOverloads.every((destOverload) => {
                const result = assignType(
                    destOverload,
                    srcType,
                    overloadDiag?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                );
                return result;
            });

            if (!isAssignable) {
                const overloads = OverloadedType.getOverloads(destType);

                if (overloadDiag && overloads.length > 0) {
                    overloadDiag.addMessage(
                        LocAddendum.overloadNotAssignable().format({
                            name: overloads[0].shared.name,
                        })
                    );
                }
                return false;
            }

            return true;
        }

        if (isClass(destType) && ClassType.isBuiltIn(destType, 'object')) {
            if ((isInstantiableClass(destType) && TypeBase.isInstantiable(srcType)) || isClassInstance(destType)) {
                if ((flags & AssignTypeFlags.Invariant) === 0) {
                    // All types (including None, Module, Overloaded) derive from object.
                    return true;
                }
            }
        }

        // Are we trying to assign None to a protocol?
        if (isNoneInstance(srcType) && isClassInstance(destType) && ClassType.isProtocolClass(destType)) {
            if (prefetched?.noneTypeClass && isInstantiableClass(prefetched.noneTypeClass)) {
                return assignClassToProtocol(
                    evaluatorInterface,
                    ClassType.cloneAsInstantiable(destType),
                    ClassType.cloneAsInstance(prefetched.noneTypeClass),
                    diag,
                    constraints,
                    flags,
                    recursionCount
                );
            }
        }

        if (isNoneInstance(destType)) {
            diag?.addMessage(LocAddendum.assignToNone());
            return false;
        }

        diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));

        return false;
    }

    // Determines whether a recursive type alias can be assigned to itself
    // given the source and dest type args and computed variance for its
    // type params.
    function assignRecursiveTypeAliasToSelf(
        destAliasInfo: TypeAliasInfo,
        srcAliasInfo: TypeAliasInfo,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags = AssignTypeFlags.Default,
        recursionCount = 0
    ) {
        return typeCompatibility.assignRecursiveTypeAliasToSelf(
            destAliasInfo,
            srcAliasInfo,
            diag,
            constraints,
            flags,
            recursionCount
        );
    }

    function isTypeFormClass(type: ClassType): boolean {
        return (
            ClassType.isBuiltIn(type, 'TypeForm') ||
            (ClassType.isSpecialBuiltIn(type) &&
                (type.shared.name === 'TypeForm' || type.priv.aliasName === 'TypeForm'))
        );
    }

    function isTypeFormType(type: Type): boolean {
        return isClassInstance(type) && isTypeFormClass(type);
    }

    function classGetItemReturnsGenericAlias(classType: ClassType): boolean {
        const member = lookUpClassMember(classType, '__class_getitem__', MemberAccessFlags.SkipInstanceMembers);
        if (!member) {
            return false;
        }

        const memberType = getTypeOfMember(member);
        const functionReturnsGenericAlias = (functionType: FunctionType) => {
            const returnType = FunctionType.getEffectiveReturnType(functionType);
            return !!returnType && isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'GenericAlias');
        };

        if (isFunction(memberType)) {
            return functionReturnsGenericAlias(memberType);
        }

        if (isOverloaded(memberType)) {
            return OverloadedType.getOverloads(memberType).every(functionReturnsGenericAlias);
        }

        return false;
    }

    function expectedTypeRequiresTypeForm(expectedType: Type): boolean {
        return (
            someSubtypes(expectedType, isTypeFormType) &&
            !someSubtypes(expectedType, (subtype) => !isTypeFormType(subtype))
        );
    }

    function expectedTypeWantsTypeForm(expectedType: Type): boolean {
        return someSubtypes(expectedType, isTypeFormType);
    }

    // If the expected type is an explicit TypeForm type, see if the source
    // type has an implicit TypeForm type that can be assigned to it. If so,
    // convert to an explicit TypeForm type.
    function convertToTypeFormType(expectedType: Type, srcType: Type): Type {
        return typeVarHandling.convertToTypeFormType(expectedType, srcType);
    }

    function assignFromUnionType(
        destType: Type,
        srcType: UnionType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        return typeCompatibility.assignFromUnionType(destType, srcType, diag, constraints, flags, recursionCount);
    }

    function isSpecialFormClass(classType: ClassType, flags: AssignTypeFlags): boolean {
        return evaluatorCore.isSpecialFormClass(classType, flags);
    }

    // Finds unsolved type variables in the destType and establishes constraints
    // in the constraint tracker for them based on the srcType.
    function setConstraintsForFreeTypeVars(
        destType: Type,
        srcType: UnknownType | AnyType,
        constraints: ConstraintTracker
    ) {
        return typeVarHandling.setConstraintsForFreeTypeVars(destType, srcType, constraints);
    }

    // Determines whether a type is "subsumed by" (i.e. is a proper subtype of) another type.
    function isTypeSubsumedByOtherType(type: Type, otherType: Type, allowAnyToSubsume: boolean, recursionCount = 0) {
        return evaluatorCore.isTypeSubsumedByOtherType(type, otherType, allowAnyToSubsume, recursionCount);
    }

    // Types like "bytes", "bytearray" and "memoryview" support cross-type
    // content comparisons via "==" and "!=", even though they're otherwise
    // unrelated (non-overlapping) types. Use derivesFromStdlibClass to check
    // membership in this group across the MRO.
    function isBytesLikeType(type: ClassType) {
        return (
            derivesFromStdlibClass(type, 'bytes') ||
            derivesFromStdlibClass(type, 'bytearray') ||
            derivesFromStdlibClass(type, 'memoryview')
        );
    }

    // Determines whether the two types are both members of the "bytes-like"
    // group of types ("bytes", "bytearray" and "memoryview"). Pyright models
    // this relationship as a "type promotion" (used elsewhere for
    // assignability), but that grouping is also useful for determining
    // whether two otherwise-disjoint built-in types can be compared with
    // "==" or "!=", since these types share compatible "__eq__" semantics
    // regardless of whether the "disableBytesTypePromotions" setting allows
    // the assignment.
    function isTypePromotionRelated(leftType: ClassType, rightType: ClassType) {
        return isBytesLikeType(leftType) && isBytesLikeType(rightType);
    }

    // Determines whether the two types are potentially comparable -- i.e.
    // their types overlap in such a way that it makes sense for them to
    // be compared with an == or != operator. The functional also supports
    // a special variant that can be used for the "is" and "is not" operator.
    // This variant can be less conservative in some cases.
    function isTypeComparable(leftType: Type, rightType: Type, assumeIsOperator = false) {
        return evaluatorCore.isTypeComparable(leftType, rightType, assumeIsOperator);
    }

    function assignToUnionType(
        destType: UnionType,
        srcType: Type,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        return typeCompatibility.assignToUnionType(destType, srcType, diag, constraints, flags, recursionCount);
    }

    function assignConditionalTypeToTypeVar(destType: TypeVarType, srcType: Type, recursionCount: number): boolean {
        return typeCompatibility.assignConditionalTypeToTypeVar(destType, srcType, recursionCount);
    }

    // If the class is a protocol and it has a `__call__` method but no other methods
    // or attributes that would be incompatible with a function, this method returns
    // the signature of the call implied by the `__call__` method. Otherwise it returns
    // undefined.
    function getCallbackProtocolType(
        objType: ClassType,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        return memberResolution.getCallbackProtocolType(objType, recursionCount);
    }

    function assignParam(
        destType: Type,
        srcType: Type,
        paramIndex: number | undefined,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ) {
        return typeCompatibility.assignParam(destType, srcType, paramIndex, diag, constraints, flags, recursionCount);
    }

    // Determines whether the source's variadic **kwargs keyword parameter
    // is assignable to the keyword form of a destination positional-or-keyword
    // parameter.
    function assignNamedParam(
        destDetails: ParamListDetails,
        srcDetails: ParamListDetails,
        paramIndex: number,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        const destParam = destDetails.params[paramIndex];
        if (srcDetails.kwargsIndex === undefined) {
            diag?.addMessage(
                LocAddendum.namedParamMissingInSource().format({
                    name: destParam.param.name ?? '',
                })
            );
            return false;
        } else if (
            !assignParam(
                destParam.type,
                srcDetails.params[srcDetails.kwargsIndex].type,
                paramIndex,
                diag?.createAddendum(),
                constraints,
                flags,
                recursionCount
            )
        ) {
            return (flags & AssignTypeFlags.PartialOverloadOverlap) !== 0;
        } else {
            return true;
        }
    }

    // Determines whether the dest accepts every argument list the source
    // accepts, apart from parameters that overlap only when omitted.
    function isParamListOverlapOnlyByOmission(
        destType: FunctionType,
        srcType: FunctionType,
        destParamDetails: ParamListDetails,
        srcParamDetails: ParamListDetails,
        recursionCount: number
    ): boolean {
        if (destParamDetails.params.length !== srcParamDetails.params.length) {
            return false;
        }

        const destScopeIds = getTypeVarScopeIds(destType);
        const srcScopeIds = getTypeVarScopeIds(srcType);
        const constraints = new ConstraintTracker();

        return destParamDetails.params.every((destParam, index) => {
            const srcParam = srcParamDetails.params[index];

            if (
                destParam.kind !== srcParam.kind ||
                destParam.param.category !== srcParam.param.category ||
                destParam.param.name !== srcParam.param.name
            ) {
                return false;
            }

            if (destParam.defaultType && srcParam.defaultType) {
                if (isOverlapOnlyByOmission(destParam.type, destParam.defaultType, srcParam.type)) {
                    return true;
                }
            } else if (srcParam.defaultType) {
                return false;
            }

            return assignType(
                makeTypeVarsFree(destParam.type, destScopeIds),
                makeTypeVarsBound(srcParam.type, srcScopeIds),
                /* diag */ undefined,
                constraints,
                AssignTypeFlags.Default,
                recursionCount
            );
        });
    }

    function assignFunction(
        destType: FunctionType,
        srcType: FunctionType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        return typeCompatibility.assignFunction(destType, srcType, diag, constraints, flags, recursionCount);
    }

    // When a value is assigned to a variable with a declared type,
    // we may be able to narrow the type based on the assignment.
    function narrowTypeBasedOnAssignment(declaredType: Type, assignedTypeResult: TypeResult): TypeResult {
        return evaluatorNarrowing.narrowTypeBasedOnAssignment(declaredType, assignedTypeResult);
    }

    function validateOverrideMethod(
        baseMethod: Type,
        overrideMethod: FunctionType | OverloadedType,
        baseClass: ClassType | undefined,
        diag: DiagnosticAddendum,
        enforceParamNames = true,
        baseClassSelf?: ClassType,
        childClassSelf?: ClassType
    ): boolean {
        return overrideValidation.validateOverrideMethod(
            baseMethod,
            overrideMethod,
            baseClass,
            diag,
            enforceParamNames,
            baseClassSelf,
            childClassSelf
        );
    }

    // Returns a list of unimplemented abstract symbols (methods or variables) for
    // the specified class.
    function getAbstractSymbols(classType: ClassType): AbstractSymbol[] {
        return memberResolution.getAbstractSymbols(classType);
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it. If treatConstructorAsClassMethod is true, the function is
    // treated like a class method even if it's not marked as such. That's
    // needed to special-case the __new__ magic method when it's invoked as
    // a constructor (as opposed to by name).
    function bindFunctionToClassOrObject(
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedType,
        memberClass?: ClassType,
        treatConstructorAsClassMethod = false,
        selfType?: ClassType | TypeVarType,
        diag?: DiagnosticAddendum,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        return memberResolution.bindFunctionToClassOrObject(
            baseType,
            memberType,
            memberClass,
            treatConstructorAsClassMethod,
            selfType,
            diag,
            recursionCount
        );
    }

    // Specializes the specified function for the specified class,
    // optionally stripping the first first parameter (the "self" or "cls")
    // off of the specialized function in the process. The baseType
    // is the type used to reference the member.
    function partiallySpecializeBoundMethod(
        baseType: ClassType,
        memberType: FunctionType,
        diag: DiagnosticAddendum | undefined,
        recursionCount: number,
        firstParamType: ClassType | TypeVarType | undefined,
        stripFirstParam = true
    ): FunctionType | undefined {
        return boundMethodSpecialization.partiallySpecializeBoundMethod(
            baseType,
            memberType,
            diag,
            recursionCount,
            firstParamType,
            stripFirstParam
        );
    }

    function isFinalVariable(symbol: Symbol): boolean {
        return evaluatorCore.isFinalVariable(symbol);
    }

    function isFinalVariableDeclaration(decl: Declaration): boolean {
        return evaluatorCore.isFinalVariableDeclaration(decl);
    }

    function isExplicitTypeAliasDeclaration(decl: Declaration): boolean {
        return memberResolution.isExplicitTypeAliasDeclaration(decl);
    }

    function isPossibleTypeAliasDeclaration(decl: Declaration): boolean {
        return memberResolution.isPossibleTypeAliasDeclaration(decl);
    }

    function isLegalTypeAliasExpressionForm(node: ExpressionNode, allowStrLiteral: boolean): boolean {
        return evaluatorCore.isLegalTypeAliasExpressionForm(node, allowStrLiteral);
    }

    function isLegalImplicitTypeAliasType(type: Type) {
        return memberResolution.isLegalImplicitTypeAliasType(type);
    }

    function isPossibleTypeAliasOrTypedDict(decl: Declaration) {
        return isPossibleTypeAliasDeclaration(decl) || isPossibleTypeDictFactoryCall(decl);
    }

    function isPossibleTypeDictFactoryCall(decl: Declaration) {
        return evaluatorCore.isPossibleTypeDictFactoryCall(decl);
    }

    function printObjectTypeForClass(type: ClassType): string {
        return TypePrinter.printObjectTypeForClass(type, evaluatorOptions.printTypeFlags, getEffectiveReturnType);
    }

    function printFunctionParts(type: FunctionType, extraFlags?: TypePrinter.PrintTypeFlags): [string[], string] {
        const flags = extraFlags ? evaluatorOptions.printTypeFlags | extraFlags : evaluatorOptions.printTypeFlags;
        return TypePrinter.printFunctionParts(type, flags, getEffectiveReturnType);
    }

    // Prints two types and determines whether they need to be output in
    // fully-qualified form for disambiguation.
    function printSrcDestTypes(
        srcType: Type,
        destType: Type,
        options?: PrintTypeOptions
    ): { sourceType: string; destType: string } {
        return diagnostics.printSrcDestTypes(srcType, destType, options);
    }

    function printType(type: Type, options?: PrintTypeOptions): string {
        let flags = evaluatorOptions.printTypeFlags;

        if (options?.expandTypeAlias) {
            flags |= TypePrinter.PrintTypeFlags.ExpandTypeAlias;
        }
        if (options?.enforcePythonSyntax) {
            flags |= TypePrinter.PrintTypeFlags.PythonSyntax;
        }
        if (options?.useTypingUnpack) {
            flags |= TypePrinter.PrintTypeFlags.UseTypingUnpack;
        }
        if (options?.printUnknownWithAny) {
            flags |= TypePrinter.PrintTypeFlags.PrintUnknownWithAny;
        }
        if (options?.printTypeVarVariance) {
            flags |= TypePrinter.PrintTypeFlags.PrintTypeVarVariance;
        }
        if (options?.omitTypeArgsIfUnknown) {
            flags |= TypePrinter.PrintTypeFlags.OmitTypeArgsIfUnknown;
        }
        if (options?.useFullyQualifiedNames) {
            flags |= TypePrinter.PrintTypeFlags.UseFullyQualifiedNames;
        }
        if (options?.disablePep604) {
            flags &= ~TypePrinter.PrintTypeFlags.PEP604;
        }

        return TypePrinter.printType(type, flags, getEffectiveReturnType);
    }

    // Given a code flow node and a constrained TypeVar, determines whether that type
    // var can be "narrowed" to a single one of its constraints based on isinstance
    // checks within the code flow.
    function narrowConstrainedTypeVar(node: ParseNode, typeVar: TypeVarType): Type | undefined {
        return flowAnalysis.narrowConstrainedTypeVar(node, typeVar);
    }

    function getPrintExpressionTypesSpaces() {
        return ' '.repeat(printExpressionSpaceCount);
    }

    function getLineNum(node: ParseNode) {
        return diagnostics.getLineNum(node);
    }

    function printControlFlowGraph(
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) {
        return flowAnalysis.printControlFlowGraph(flowNode, reference, callName, logger);
    }

    // Track these apis internal usages when logging is on. otherwise, it should be noop.
    const getInferredReturnTypeResult = wrapWithLogger(_getInferredReturnTypeResult);

    const evaluatorInterface: TypeEvaluator = {
        runWithCancellationToken,
        getAnalyzerNodeInfoReader: () => nodeInfo,
        getType,
        getTypeResult,
        getTypeResultForDecorator,
        getCachedType,
        getTypeOfExpression,
        getTypeOfAnnotation,
        getTypeOfClass,
        createSubclass,
        getTypeOfFunction,
        getTypeOfExpressionExpectingType,
        getExpectedType,
        evaluateTypeForSubnode,
        evaluateTypesForStatement,
        evaluateTypesForMatchStatement,
        evaluateTypesForCaseStatement,
        evaluateTypeOfParam,
        canBeTruthy,
        canBeFalsy,
        stripLiteralValue,
        removeTruthinessFromType,
        removeFalsinessFromType,
        stripTypeGuard,
        solveAndApplyConstraints,
        verifyRaiseExceptionType,
        verifyDeleteExpression,
        validateOverloadedArgTypes,
        validateInitSubclassArgs,
        isNodeReachable,
        isAfterNodeReachable,
        isKeyPresentInTypedDict: (node) => codeFlowEngine.isKeyPresentInTypedDict(node),
        getNodeReachability,
        getAfterNodeReachability,
        isAsymmetricAccessorAssignment,
        suppressDiagnostics,
        isSpecialFormClass,
        getDeclInfoForStringNode,
        getDeclInfoForNameNode,
        getTypeForDeclaration,
        resolveAliasDeclaration,
        resolveAliasDeclarationWithInfo,
        getTypeOfIterable,
        getTypeOfIterator,
        getGetterTypeFromProperty,
        getTypeOfArg,
        convertNodeToArg,
        buildTupleTypesList,
        markNamesAccessed,
        expandPromotionTypes,
        makeTopLevelTypeVarsConcrete,
        mapSubtypesExpandTypeVars,
        isTypeSubsumedByOtherType,
        lookUpSymbolRecursive,
        getDeclaredTypeOfSymbol,
        getEffectiveTypeOfSymbol,
        getEffectiveTypeOfSymbolForUsage,
        getInferredTypeOfDeclaration,
        getDeclaredTypeForExpression,
        getDeclaredReturnType,
        getInferredReturnType,
        getBestOverloadForArgs,
        getBuiltInType,
        getTypeOfMember,
        getTypeOfBoundMember,
        getBoundMagicMethod,
        getTypeOfMagicMethodCall,
        bindFunctionToClassOrObject,
        getCallbackProtocolType,
        getCallSignatureInfo,
        getAbstractSymbols,
        narrowConstrainedTypeVar,
        isTypeComparable,
        assignType,
        validateOverrideMethod,
        validateCallArgs,
        validateTypeArg,
        assignTypeToExpression,
        assignClassToSelf,
        getTypedDictClassType,
        getTupleClassType,
        getDictClassType,
        getStrClassType,
        getObjectType,
        getNoneType,
        getUnionClassType,
        getTypeClassType,
        getFunctionClassType,
        getBuiltInObject,
        getTypingType,
        getTypeCheckerInternalsType,
        assignTypeArgs,
        reportMissingTypeArgs,
        inferReturnTypeIfNecessary,
        inferVarianceForClass,
        isFinalVariable,
        isFinalVariableDeclaration,
        isExplicitTypeAliasDeclaration,
        addInformation,
        addUnreachableCode,
        addDeprecated,
        addDiagnostic,
        addDiagnosticForTextRange,
        printType,
        printSrcDestTypes,
        printFunctionParts,
        getTypeCacheEntryCount,
        disposeEvaluator,
        useSpeculativeMode,
        isSpeculativeModeInUse,
        setTypeResultForNode,
        getMaxCodeComplexity,
        checkForCancellation,
        printControlFlowGraph,
    };

    // Topic factories must only capture dependencies here; injected callbacks can
    // reach topics that are not initialized until later in this construction block.
    const codeFlowEngine = getCodeFlowEngine(evaluatorInterface, speculativeTypeTracker, nodeInfo);

    const boundMethodSpecialization = createBoundMethodSpecialization({
        assignType,
        getEffectiveReturnType,
        printType,
        solveAndApplyConstraints,
    });

    const memberResolution = createMemberResolution({
        addClassEntryDeclsForKeywordArgIfPresent: _addClassEntryDeclsForKeywordArgIfPresent,
        addSymbolDeclInfo: _addSymbolDeclInfo,
        shouldFallBackToClassEntryForKeywordArg: _shouldFallBackToClassEntryForKeywordArg,
        tryAddPartialKeywordParamDecls: _tryAddPartialKeywordParamDecls,
        addDiagnostic,
        codeFlowEngine,
        evaluateTypesForStatement,
        evaluatorOptions,
        getAbstractSymbolInfo,
        getBoundMagicMethod,
        getEffectiveTypeOfSymbol,
        getEffectiveTypeOfSymbolForUsage,
        getExpectedType,
        getInferredTypeOfDeclaration,
        getScopeForNode,
        getScopeIdForNode,
        getType,
        getTypeClassType,
        getTypeOfAnnotation,
        getTypeOfBoundMember,
        getTypeOfClass,
        getTypeOfFunction,
        inferReturnTypeIfNecessary,
        isFlowPathBetweenNodes,
        isLegalTypeAliasExpressionForm,
        isSymbolValidTypeExpression,
        makeTopLevelTypeVarsConcrete,
        nodeInfo,
        partiallySpecializeBoundMethod,
        get prefetched() {
            return prefetched;
        },
        resolveAliasDeclarationWithInfo,
        symbolResolutionStack,
        validateCallArgs,
        validateInitSubclassArgs,
    });

    const expressionEvaluation = createExpressionEvaluation({
        addDiagnostic,
        addInformation,
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
        getNoneType,
        getObjectType,
        getScopeForNode,
        getTypeOfArgExpectingType,
        getTypeOfAwaitable,
        getTypeOfClass,
        getTypeOfExpression,
        getTypeOfFunction,
        getTypeVarScopesForNode,
        getTypingType,
        isSpeculativeModeInUse,
        lookUpSymbolRecursive,
        makeTopLevelTypeVarsConcrete,
        mapSubtypesExpandTypeVars,
        nodeInfo,
        normalizeEnumTypes,
        get prefetched() {
            return prefetched;
        },
        printSrcDestTypes,
        printType,
        resolveDeclaredMemberType,
        setTypeResultForNode,
        stripTypeGuard,
        useSpeculativeMode,
        validateCallArgs,
        maxSingleOverloadArgTypeExpansionCount,
    });

    const returnTypeInference = createReturnTypeInference({
        codeFlowEngine,
        convertSpecialFormToRuntimeValue,
        getTypeOfExpression,
        getTypeOfFunction,
        inferFunctionReturnType,
        maxCallSiteReturnTypeCacheSize,
        maxReturnCallSiteTypeInferenceCodeFlowComplexity,
        maxReturnTypeInferenceArgCount,
        maxReturnTypeInferenceStackSize,
        nodeInfo,
        returnTypeInferenceContextStack,
        get returnTypeInferenceTypeCache() {
            return returnTypeInferenceTypeCache;
        },
        set returnTypeInferenceTypeCache(value) {
            returnTypeInferenceTypeCache = value;
        },
        get returnTypeInferenceTypeFormTypeCache() {
            return returnTypeInferenceTypeFormTypeCache;
        },
        set returnTypeInferenceTypeFormTypeCache(value) {
            returnTypeInferenceTypeFormTypeCache = value;
        },
        speculativeTypeTracker,
        stripLiteralValue,
        suppressDiagnostics,
        writeTypeCache,
    });

    const classConstruction = createClassConstruction({
        addDiagnostic,
        assignType,
        getBaseClassesFromTypeCall,
        getBuiltInType,
        getNoneType,
        getTypeOfArg,
        getTypeOfArgExpectingType,
        nodeInfo,
        get prefetched() {
            return prefetched;
        },
        printType,
    });

    const evaluatorCore = createEvaluatorCore({
        // Core is initialized before special forms; defer this recursive lookup until evaluation.
        createSpecializedClassType: (classType, typeArgs, flags, errorNode) =>
            specialFormCreation.createSpecializedClassType(classType, typeArgs, flags, errorNode),
        addDiagnostic,
        assignType,
        evaluatorInterface,
        getEffectiveTypeOfSymbol,
        getScopeForNode,
        getScopeIdForNode,
        getTypeOfBoundMember,
        getTypeOfExpression,
        getTypeOfExpressionExpectingType,
        inferReturnTypeIfNecessary,
        isTypeFormClass,
        isTypePromotionRelated,
        makeTopLevelTypeVarsConcrete,
        nodeInfo,
        get prefetched() {
            return prefetched;
        },
        printType,
        stripLiteralValue,
        suppressDiagnostics,
        validateCallArgs,
    });

    const {
        getSpeculativeNodeForCall,
        adjustParamAnnotatedType,
        inferParamTypeFromDefaultValue,
        transformVariadicParamType,
    } = evaluatorCore;

    const typeCompatibility = createTypeCompatibility({
        assignNamedParam,
        assignType,
        assignTypeArgs,
        evaluatorInterface,
        getEffectiveReturnType,
        inferVarianceForClass,
        isParamListOverlapOnlyByOmission,
        isTypeSubsumedByOtherType,
        makeTopLevelTypeVarsConcrete,
        get prefetched() {
            return prefetched;
        },
        printSrcDestTypes,
        printType,
        solveAndApplyConstraints,
        stripLiteralValue,
        typePromotions,
    });

    // This direct function reference requires evaluatorCore to be initialized first.
    const collectionInference = createCollectionInference({
        addDiagnostic,
        assignType,
        assignTypeToExpression,
        convertSpecialFormToRuntimeValue,
        evaluatorInterface,
        getBuiltInObject,
        getBuiltInType,
        getNoneType,
        getObjectType,
        getTupleClassType,
        getTypeOfExpression,
        getTypeOfIterator,
        getTypeVarScopesForNode,
        getTypingType,
        inferVarianceForClass,
        isTypeHashable: evaluatorCore.isTypeHashable,
        makeTopLevelTypeVarsConcrete,
        maxEntriesToUseForInference,
        nodeInfo,
        get prefetched() {
            return prefetched;
        },
        printType,
        solveAndApplyConstraints,
        stripLiteralValue,
    });

    const specialFormCreation = createSpecialFormCreation({
        addDiagnostic,
        applyUnpackToTupleLike,
        getScopeIdForNode,
        getTypeOfClass,
        getTupleClassType,
        getTypeVarScopesForNode,
        getTypingType,
        nodeInfo,
        get prefetched() {
            return prefetched;
        },
        validateTypeMetadata,
        assignType,
        convertTypeArgToInstance,
        getTypeOfAnnotation,
        makeTopLevelTypeVarsConcrete,
        printType,
        getBuiltInType,
        solveAndApplyConstraints,
        getTypeOfExpression,
    });

    const typeVarHandling = createTypeVarHandling({
        addDiagnostic,
        assignClassToSelf,
        assignType,
        createSelfType: specialFormCreation.createSelfType,
        createTypeFormType: specialFormCreation.createTypeFormType,
        getBuiltInType,
        getObjectType,
        getTupleClassType,
        getTypeOfExpressionExpectingType,
        getTypeVarScopesForNode,
        isSymbolValidTypeExpression,
        isTypeFormClass,
        nodeInfo,
        get prefetched() {
            return prefetched;
        },
        rejectBareSpecialFormInTypeForm,
        solveAndApplyConstraints,
        specializeTypeAliasWithDefaults,
        typePromotions,
        updateUsageVariancesRecursive,
    });

    const overrideValidation = createOverrideValidation({
        assignType,
        getEffectiveReturnType,
        printType,
        solveAndApplyConstraints,
    });

    const diagnostics = createDiagnostics({
        evaluatorOptions,
        getTypeOfExpression,
        isNodeReachable,
        nodeInfo,
        printType,
        speculativeTypeTracker,
        suppressedNodeStack,
    });

    const flowAnalysis = createFlowAnalysis({
        addDiagnosticForTextRange,
        get codeFlowAnalyzerCache() {
            return codeFlowAnalyzerCache;
        },
        codeFlowEngine,
        getCodeFlowAnalyzerForReturnTypeInferenceContext,
        isNodeInReturnTypeInferenceContext,
        maxCodeComplexity,
        nodeInfo,
    });

    const evaluatorNarrowing = createEvaluatorNarrowing({
        assignType,
        evaluatorInterface,
        getTypeOfMember,
        makeTopLevelTypeVarsConcrete,
    });

    if (evaluatorOptions.testOnlyMemberAccess) {
        const { nodes, install } = evaluatorOptions.testOnlyMemberAccess;
        install((node, baseTypeResult) => {
            assert(nodes.has(node));
            return getTypeOfMemberAccessWithBaseType(node, baseTypeResult, { method: 'get' }, EvalFlags.NoSpecialize);
        });
    }

    evaluatorOptions.experimentalOverloadResult?.installSelector(selectAutomaticOverloadResult);
    evaluatorOptions.experimentalOverloadResult?.installActivationBoundary(
        () => !returnTypeInferenceTypeCache && !isSpeculativeModeInUse(undefined),
        finishOverloadActivation
    );
    evaluatorOptions.experimentalOverloadResult?.installCheckerHandoff((root, expression, result, callback) => {
        const ids = evaluatorOptions.experimentalOverloadResult!.roots.get(root);
        const isComplete = (value: TypeResult) =>
            !value.isIncomplete &&
            !value.typeErrors &&
            !(isFunction(value.type) && FunctionType.isPartiallyEvaluated(value.type)) &&
            !(isClass(value.type) && ClassType.isPartiallyEvaluated(value.type));
        if (
            !ids ||
            returnTypeInferenceTypeCache ||
            isSpeculativeModeInUse(undefined) ||
            typeCache.get(expression.id)?.typeResult !== result ||
            typeCache.get(expression.id)?.flags !== EvalFlags.None ||
            !isComplete(result)
        ) {
            return false;
        }
        for (const id of ids) {
            const entry = typeCache.get(id);
            if ((entry && !isComplete(entry.typeResult)) || typeFormTypeCache.has(id)) {
                return false;
            }
        }
        // Continue synchronously before this candidate's isolation unwinds. No
        // saved cache set or result is restored, and the checker reads live entries.
        checkForCancellation();
        callback();
        return true;
    });
    evaluatorOptions.experimentalOverloadResult?.installQueryCache((root, node) => {
        const roots = evaluatorOptions.experimentalOverloadResult!.roots;
        const ids = roots.get(root);
        const isOrdinaryContext = () => !returnTypeInferenceTypeCache && !isSpeculativeModeInUse(undefined);
        if (!ids || !isOrdinaryContext()) {
            return undefined;
        }
        const isComplete = (result: TypeResult) =>
            !result.isIncomplete &&
            !(isFunction(result.type) && FunctionType.isPartiallyEvaluated(result.type)) &&
            !(isClass(result.type) && ClassType.isPartiallyEvaluated(result.type));
        const queryEntry = readContextualTypeCacheEntryForNode(node);
        if (!queryEntry || !isComplete(queryEntry.typeResult)) {
            return undefined;
        }
        const entries = [...ids].map((id) => ({
            id,
            runtime: typeCache.get(id),
            expected: expectedTypeCache.get(id),
            typeForm: typeFormTypeCache.get(id),
        }));
        const areComplete = () =>
            entries.every(
                (entry) =>
                    (!entry.runtime || isComplete(entry.runtime.typeResult)) &&
                    (!entry.typeForm || entry.typeForm.every((e) => isComplete(e.typeResult)))
            );
        if (!areComplete()) {
            return undefined;
        }
        // This is a validity guard, not a saved public answer. Reuse only while
        // the complete, privately restored cache set is still installed.
        return () => {
            const valid =
                isOrdinaryContext() &&
                roots.get(root) === ids &&
                readContextualTypeCacheEntryForNode(node) === queryEntry &&
                areComplete() &&
                entries.every(
                    (entry) =>
                        typeCache.get(entry.id) === entry.runtime &&
                        expectedTypeCache.get(entry.id) === entry.expected &&
                        typeFormTypeCache.get(entry.id) === entry.typeForm
                );
            if (valid) {
                checkForCancellation();
            }
            return valid;
        };
    });

    if (operationController) {
        const { roots } = operationController;
        operationController.installCacheIsolation({
            evict(root) {
                const ids = roots.get(root);
                assert(ids && ids.size <= 256);
                assert(!returnTypeInferenceTypeCache && !isSpeculativeModeInUse(undefined));
                ids.forEach((id) => {
                    typeCache.delete(id);
                    expectedTypeCache.delete(id);
                    typeFormTypeCache.delete(id);
                });
                speculativeTypeTracker.evictCacheEntries(ids);
            },
            isolate(root, callback, retain = false) {
                const ids = roots.get(root);
                assert(ids && ids.size <= 256);
                // Native argument speculation can query earlier, disjoint operations
                // through code flow. Never isolate a root that overlaps that context.
                assert(!returnTypeInferenceTypeCache && speculativeTypeTracker.canUseNodeCacheIsolation(root));
                return useNodeCacheIsolation(
                    typeCache,
                    ids,
                    () =>
                        useNodeCacheIsolation(
                            expectedTypeCache,
                            ids,
                            () =>
                                useNodeCacheIsolation(
                                    typeFormTypeCache,
                                    ids,
                                    () => speculativeTypeTracker.useNodeCacheIsolation(ids, callback, root),
                                    retain
                                ),
                            retain
                        ),
                    retain
                );
            },
        });
    }

    return evaluatorInterface;
}
