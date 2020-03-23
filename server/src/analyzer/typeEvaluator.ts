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
import { getEmptyRange } from '../common/textRange';
import { TextRange } from '../common/textRange';
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
    SetNode,
    SliceNode,
    StringListNode,
    TernaryNode,
    TupleNode,
    TypeAnnotationNode,
    UnaryOperationNode,
    WithItemNode,
    YieldFromNode,
    YieldNode
} from '../parser/parseNodes';
import { ParseOptions, Parser } from '../parser/parser';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookup, ImportLookupResult } from './analyzerFileInfo';
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
    isCodeFlowSupportedForReference
} from './codeFlow';
import {
    AliasDeclaration,
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    ModuleLoaderActions,
    VariableDeclaration
} from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName } from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable } from './symbolUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    DataClassEntry,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    isAnyOrUnknown,
    isNoneOrNever,
    isPossiblyUnbound,
    isSameWithoutLiteralValue,
    isTypeSame,
    isUnbound,
    LiteralValue,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    ObjectType,
    OverloadedFunctionType,
    removeNoneFromUnion,
    removeUnboundFromUnion,
    Type,
    TypeCategory,
    TypeSourceId,
    TypeVarType,
    UnboundType,
    UnknownType
} from './types';
import {
    addDefaultFunctionParameters,
    addTypeVarsToListIfUnique,
    areTypesSame,
    buildTypeVarMap,
    buildTypeVarMapFromSpecializedClass,
    CanAssignFlags,
    canBeFalsy,
    canBeTruthy,
    ClassMember,
    ClassMemberLookupFlags,
    computeMroLinearization,
    containsUnknown,
    convertClassToObject,
    derivesFromClassRecursive,
    doForSubtypes,
    getConcreteTypeFromTypeVar,
    getDeclaredGeneratorReturnType,
    getDeclaredGeneratorSendType,
    getMetaclass,
    getSpecializedTupleType,
    getTypeVarArgumentsRecursive,
    isEllipsisType,
    isNoReturnType,
    isOptionalType,
    isProperty,
    lookUpClassMember,
    lookUpObjectMember,
    partiallySpecializeType,
    printLiteralType,
    printLiteralValue,
    removeFalsinessFromType,
    removeTruthinessFromType,
    requiresSpecialization,
    selfSpecializeClassType,
    setTypeArgumentsRecursive,
    specializeType,
    stripFirstParameter,
    stripLiteralTypeArgsValue,
    stripLiteralValue,
    transformTypeObjectToClass,
    TypedDictEntry
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

interface TypeResult {
    type: Type;
    node: ExpressionNode;

    unpackedType?: Type;
    typeList?: TypeResult[];
    isResolutionCyclical?: boolean;
}

interface FunctionArgument {
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    type?: Type;
    valueExpression?: ExpressionNode;
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
    classType: Type;
    isAbstract: boolean;
}

type TypeNarrowingCallback = (type: Type) => Type | undefined;

export const enum EvaluatorFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 2,

    // Allow forward references. Don't report unbound errors.
    AllowForwardReferences = 4,

    // Skip the check for unknown arguments.
    DoNotCheckForUnknownArgs = 8,

    // Treat string literal as a type.
    EvaluateStringLiteralAsType = 16
}

interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: Type;
    setErrorNode?: ExpressionNode;

    // Used only for get methods
    expectedType?: Type;
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

    // By default, if the class has a __get__ magic method, this is
    // followed to determine the final type. Properties use this
    // technique.
    SkipGetCheck = 1 << 4,

    // This set of flags is appropriate for looking up methods.
    SkipForMethodLookup = SkipInstanceMembers | SkipGetAttributeCheck | SkipGetCheck
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
    [OperatorType.MatrixMultiply]: ['__matmul__', '']
};

const bitwiseOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__']
};

const comparisonOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Equals]: ['__eq__', '__ne__'],
    [OperatorType.NotEquals]: ['__ne__', '__eq__'],
    [OperatorType.LessThan]: ['__lt__', '__gt__'],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__'],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__'],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__']
};

const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true
};

export interface ClassTypeResult {
    classType: ClassType;
    decoratedType: Type;
}

export interface FunctionTypeResult {
    functionType: FunctionType;
    decoratedType: Type;
}

export interface CallSignatureInfo {
    callNode: CallNode | DecoratorNode;
    signatures: FunctionType[];
    activeArgumentIndex: number;
    activeArgumentName?: string;
}

export interface CallResult {
    returnType?: Type;
    argumentErrors: boolean;
}

export interface TypeEvaluator {
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

    getType: (node: ExpressionNode) => Type | undefined;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    evaluateTypesForStatement: (node: ParseNode) => void;

    getDeclaredTypeForExpression: (expression: ExpressionNode) => Type | undefined;
    verifyDeleteExpression: (node: ExpressionNode) => void;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode) => boolean;

    getDeclarationsForNameNode: (node: NameNode) => Declaration[] | undefined;
    getTypeForDeclaration: (declaration: Declaration) => Type | undefined;
    resolveAliasDeclaration: (declaration: Declaration) => Declaration | undefined;
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
    ) => Type;
    getBoundMethod: (
        classType: ClassType,
        memberName: string,
        treatAsClassMember: boolean
    ) => FunctionType | OverloadedFunctionType | undefined;
    getCallSignatureInfo: (node: ParseNode, insertionOffset: number) => CallSignatureInfo | undefined;

    canAssignType: (destType: Type, srcType: Type, diag: DiagnosticAddendum, typeVarMap?: TypeVarMap) => boolean;
    canOverrideMethod: (baseMethod: Type, overrideMethod: FunctionType, diag: DiagnosticAddendum) => boolean;

    addError: (message: string, node: ParseNode) => Diagnostic | undefined;
    addWarning: (message: string, node: ParseNode) => Diagnostic | undefined;
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

    printType: (type: Type) => string;
    printFunctionParts: (type: FunctionType) => [string[], string];

    hasGrownTooLarge: () => boolean;
}

interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        reference: NameNode | MemberAccessNode,
        targetSymbolId: number,
        initialType: Type | undefined
    ) => FlowNodeTypeResult;
}

type CachedType = Type | PartialType;

// Each time we enter speculative mode, we increment
// the speculative mode ID so we can distinguish between
// types that were cached in a previous speculative mode.
let nextSpeculativeModeId = 1;
const invalidSpeculativeModeId = 0;

const partialTypeCategory = -1;
interface PartialType {
    category: -1;
    type: Type | undefined;
    isIncomplete?: boolean;
    speculativeModeId: number;
}

interface FlowNodeTypeResult {
    type: Type | undefined;
    isIncomplete: boolean;
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

export function createTypeEvaluator(importLookup: ImportLookup): TypeEvaluator {
    const symbolResolutionStack: SymbolResolutionStackEntry[] = [];
    const isReachableRecursionMap = new Map<number, true>();
    const functionRecursionMap = new Map<number, true>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzer>();
    const typeCache = new Map<number, CachedType>();

    let speculativeModeId = invalidSpeculativeModeId;
    let cancellationToken: CancellationToken | undefined;

    const returnTypeInferenceContextStack: ReturnTypeInferenceContext[] = [];
    let returnTypeInferenceTypeCache: Map<number, CachedType> | undefined;

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

    function hasGrownTooLarge(): boolean {
        // We may need to discard the evaluator instance and its caches if they
        // grow too large. Otherwise we risk overflowing the heap and getting killed.
        // The value below has been tuned empirically.
        return typeCache.size > 750000;
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

        if (cachedType.category === partialTypeCategory) {
            if (!isSpeculativeMode()) {
                return undefined;
            }

            const partialType = cachedType as PartialType;

            // If the cached type was written as part of an older
            // speculative mode, we will ignore it. If it was generated
            // as part of a newer speculative mode, it is OK to use.
            if (partialType.speculativeModeId < speculativeModeId) {
                return undefined;
            }

            return partialType.type;
        }

        return cachedType;
    }

    function writeTypeCache(node: ParseNode, type: Type) {
        const cachedType = !isSpeculativeMode()
            ? type
            : {
                  category: partialTypeCategory,
                  speculativeModeId,
                  type
              };

        // Should we use a temporary cache associated with a contextual
        // analysis of a function, contextualized based on call-site argument types?
        if (returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)) {
            returnTypeInferenceTypeCache.set(node.id, cachedType);
        } else {
            typeCache.set(node.id, cachedType);
        }
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
            entry => entry.symbolId === symbol.id && entry.declaration === declaration
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
            isResultValid: true
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
        if (AnalyzerNodeInfo.isCodeUnreachable(node)) {
            return undefined;
        }

        evaluateTypesForExpressionInContext(node);

        // We assume here that the type for the node in question
        // will be populated in the cache. Some nodes don't have
        // defined types (e.g. a raw list comprehension outside
        // of its containing list), so we'll return undefined in those
        // cases.
        return readTypeCache(node);
    }

    function getTypeOfExpression(node: ExpressionNode, expectedType?: Type, flags = EvaluatorFlags.None): TypeResult {
        // This is a frequently-called routine, so it's a good place to call
        // the cancellation check. If the operation is canceled, an exception
        // will be thrown at this point.
        checkForCancellation();

        // Is this type already cached?
        const cachedType = readTypeCache(node);
        if (cachedType) {
            return { type: cachedType, node };
        }

        let typeResult: TypeResult | undefined;

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
                typeResult = getTypeFromIndex(node, expectedType, flags);
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
                typeResult = getTypeFromConstant(node);
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
                            flags | EvaluatorFlags.AllowForwardReferences
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
                                flags | EvaluatorFlags.AllowForwardReferences
                            );
                        }
                    }
                }

                if (expectingType) {
                    if (!typeResult) {
                        addError(`Expecting type but received a string literal`, node);
                        typeResult = { node, type: UnknownType.create() };
                    }
                } else {
                    // Evaluate the format string expressions in this context.
                    node.strings.forEach(str => {
                        if (str.nodeType === ParseNodeType.FormatString) {
                            str.expressions.forEach(expr => {
                                getTypeOfExpression(expr);
                            });
                        }
                    });

                    const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;

                    // Don't create a literal type if it's an f-string.
                    if (node.strings.some(str => str.nodeType === ParseNodeType.FormatString)) {
                        typeResult = {
                            node,
                            type: getBuiltInObject(node, isBytes ? 'bytes' : 'str')
                        };
                    } else {
                        typeResult = {
                            node,
                            type: cloneBuiltinTypeWithLiteral(
                                node,
                                isBytes ? 'bytes' : 'str',
                                node.strings.map(s => s.value).join('')
                            )
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
                typeResult = { node, type: cloneBuiltinTypeWithLiteral(node, builtInType, node.value) };
                break;
            }

            case ParseNodeType.Ellipsis: {
                if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                    typeResult = { type: AnyType.create(true), node };
                } else {
                    const ellipsisType = getBuiltInType(node, 'ellipsis') || AnyType.create();
                    typeResult = { type: ellipsisType, node };
                }
                break;
            }

            case ParseNodeType.UnaryOperation: {
                typeResult = getTypeFromUnaryOperation(node);
                break;
            }

            case ParseNodeType.BinaryOperation: {
                typeResult = getTypeFromBinaryOperation(node);
                break;
            }

            case ParseNodeType.AugmentedAssignment: {
                const type = getTypeFromAugmentedAssignment(node);
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
                    node
                };
                break;
            }

            case ParseNodeType.Ternary: {
                typeResult = getTypeFromTernary(node, flags);
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
                const type = getTypeFromIterable(iterType, false, node, false);
                typeResult = { type, unpackedType: iterType, node };
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                typeResult = getTypeOfExpression(
                    node.typeAnnotation,
                    undefined,
                    EvaluatorFlags.EvaluateStringLiteralAsType
                );
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                useSpeculativeMode(() => {
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
            typeResult = { type: UnknownType.create(), node };
        }

        writeTypeCache(node, typeResult.type);

        return typeResult;
    }

    function getTypeOfAnnotation(node: ExpressionNode): Type {
        const fileInfo = getFileInfo(node);

        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (fileInfo.isTypingStubFile) {
            const specialType = handleTypingStubTypeAnnotation(node);
            if (specialType) {
                writeTypeCache(node, specialType);
                return specialType;
            }
        }

        let evaluatorFlags = EvaluatorFlags.ConvertEllipsisToAny | EvaluatorFlags.EvaluateStringLiteralAsType;

        const isAnnotationEvaluationPostponed =
            fileInfo.futureImports.get('annotations') !== undefined || fileInfo.isStubFile;

        if (isAnnotationEvaluationPostponed) {
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        return convertClassToObject(getTypeOfExpression(node, undefined, evaluatorFlags).type);
    }

    function getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, EvaluatorFlags.DoNotSpecialize);

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map(arg => {
                const functionArg: FunctionArgument = {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name
                };
                return functionArg;
            });

            // Evaluate the decorator. Don't check for unknown arguments
            // because these errors will already be reported as unknown
            // parameters.
            decoratorCall = getTypeFromCallWithBaseType(
                node.leftExpression,
                argList,
                decoratorCall,
                undefined,
                EvaluatorFlags.DoNotCheckForUnknownArgs
            );
        }

        const argList = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: functionOrClassType
            }
        ];

        return getTypeFromCallWithBaseType(
            node.leftExpression,
            argList,
            decoratorCall,
            undefined,
            EvaluatorFlags.DoNotCheckForUnknownArgs
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
            memberAccessFlags
        );

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (
                resultType.category === TypeCategory.Function ||
                resultType.category === TypeCategory.OverloadedFunction
            ) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(bindToClass || objectType, resultType, !!bindToClass);
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
        const memberInfo = getTypeFromClassMemberName(
            errorNode,
            classType,
            memberName,
            usage,
            diag,
            memberAccessFlags | MemberAccessFlags.SkipInstanceMembers
        );

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (
                resultType.category === TypeCategory.Function ||
                resultType.category === TypeCategory.OverloadedFunction
            ) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(classType, resultType);
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

                if (
                    boundMethod.category === TypeCategory.Function ||
                    boundMethod.category === TypeCategory.OverloadedFunction
                ) {
                    return boundMethod;
                }
            }
        }

        return undefined;
    }

    // Returns the signature(s) associated with a call node that contains
    // the specified node. It also returns the index of the argument
    // that contains the node.
    function getCallSignatureInfo(node: ParseNode, insertionOffset: number): CallSignatureInfo | undefined {
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

        if (insertionOffset > TextRange.getEnd(callNode)) {
            return undefined;
        }

        const signatures: FunctionType[] = [];
        let activeArgumentIndex = 0;
        let activeArgumentName: string | undefined;

        const callType = getType(callNode.leftExpression);
        if (callType === undefined) {
            return undefined;
        }

        // Determine which argument is currently "active".
        const args = callNode.arguments;
        for (let i = args.length - 1; i >= 0; i--) {
            if (insertionOffset > TextRange.getEnd(args[i].valueExpression)) {
                activeArgumentIndex = i + 1;
                break;
            }

            if (insertionOffset >= args[i].valueExpression.start) {
                activeArgumentIndex = i;
                break;
            }
        }

        if (activeArgumentIndex < callNode.arguments.length) {
            const argName = callNode.arguments[activeArgumentIndex].name;
            if (argName) {
                activeArgumentName = argName.value;
            }
        }

        function addFunctionToSignature(type: FunctionType | OverloadedFunctionType) {
            if (type.category === TypeCategory.Function) {
                signatures.push(type);
            } else {
                signatures.push(...type.overloads);
            }
        }

        doForSubtypes(callType, subtype => {
            switch (subtype.category) {
                case TypeCategory.Function:
                case TypeCategory.OverloadedFunction: {
                    addFunctionToSignature(subtype);
                    break;
                }

                case TypeCategory.Class: {
                    // Try to get the __new__ method first. We skip the base "object",
                    // which typically provides the __new__ method. We'll fall back on
                    // the __init__ if there is no custom __new__.
                    let methodType: FunctionType | OverloadedFunctionType | undefined;

                    // Skip the __new__ lookup for data classes, which always have a
                    // generic synthesized new method.
                    if (!ClassType.isDataClass(subtype)) {
                        methodType = getBoundMethod(subtype, '__new__', true);
                    }
                    if (!methodType) {
                        methodType = getBoundMethod(subtype, '__init__', false);
                    }
                    if (methodType) {
                        addFunctionToSignature(methodType);
                    }
                    break;
                }

                case TypeCategory.Object: {
                    const methodType = getBoundMethod(subtype.classType, '__call__', false);
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
            activeArgumentIndex,
            activeArgumentName
        };
    }

    // Determines whether the specified expression is a symbol with a declared type
    // (either a simple name or a member variable). If so, the type is returned.
    function getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
        let symbol: Symbol | undefined;
        let classOrObjectBase: ClassType | ObjectType | undefined;

        switch (expression.nodeType) {
            case ParseNodeType.Name: {
                const symbolWithScope = lookUpSymbolRecursive(expression, expression.value);
                if (symbolWithScope) {
                    symbol = symbolWithScope.symbol;
                }
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                return getDeclaredTypeForExpression(expression.valueExpression);
            }

            case ParseNodeType.MemberAccess: {
                const baseType = getTypeOfExpression(expression.leftExpression).type;
                let classMemberInfo: ClassMember | undefined;

                if (baseType.category === TypeCategory.Object) {
                    classMemberInfo = lookUpObjectMember(
                        baseType,
                        expression.memberName.value,
                        ClassMemberLookupFlags.DeclaredTypesOnly
                    );
                    classOrObjectBase = baseType;
                } else if (baseType.category === TypeCategory.Class) {
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
                if (baseType && baseType.category === TypeCategory.Object) {
                    const setItemMember = lookUpClassMember(baseType.classType, '__setitem__');
                    if (setItemMember) {
                        const setItemType = getTypeOfMember(setItemMember);
                        if (setItemType.category === TypeCategory.Function) {
                            const boundFunction = bindFunctionToClassOrObject(baseType, setItemType);
                            if (boundFunction.category === TypeCategory.Function) {
                                if (boundFunction.details.parameters.length === 2) {
                                    return FunctionType.getEffectiveParameterType(boundFunction, 1);
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
                    declaredType = bindFunctionToClassOrObject(classOrObjectBase, declaredType);
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
        return doForSubtypes(type, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const generatorReturnType = getReturnTypeFromGenerator(subtype);
            if (generatorReturnType) {
                return generatorReturnType;
            }

            if (subtype.category === TypeCategory.Object) {
                const awaitReturnType = getSpecializedReturnType(subtype, '__await__');
                if (awaitReturnType) {
                    if (isAnyOrUnknown(awaitReturnType)) {
                        return awaitReturnType;
                    }

                    if (awaitReturnType.category === TypeCategory.Object) {
                        const iterReturnType = getSpecializedReturnType(awaitReturnType, '__iter__');

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
                addError(`'${printType(subtype)}' is not awaitable`, errorNode);
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

        if (type.category === TypeCategory.TypeVar) {
            type = specializeType(type, undefined);
        }

        if (type.category === TypeCategory.Union && type.subtypes.some(t => isNoneOrNever(t))) {
            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticSettings.reportOptionalIterable,
                    DiagnosticRule.reportOptionalIterable,
                    `Object of type 'None' cannot be used as iterable value`,
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
                ? getSpecializedReturnTypeForMetaclassMethod(metaclass, objType.classType, iterMethodName)
                : getSpecializedReturnType(objType, iterMethodName);
            if (!iterReturnType) {
                // There was no __iter__. See if we can fall back to
                // the __getitem__ method instead.
                if (getItemMethodName) {
                    const getItemReturnType = getSpecializedReturnType(objType, getItemMethodName);
                    if (getItemReturnType) {
                        return getItemReturnType;
                    }
                }

                diag.addMessage(`'${iterMethodName}' method not defined`);
            } else {
                if (isAnyOrUnknown(iterReturnType)) {
                    return iterReturnType;
                }

                if (iterReturnType.category === TypeCategory.Object) {
                    const nextReturnType = getSpecializedReturnType(iterReturnType, nextMethodName);

                    if (!nextReturnType) {
                        diag.addMessage(
                            `'${nextMethodName}' method not defined on type ` + `'${printType(iterReturnType)}'`
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
                    diag.addMessage(`'${iterMethodName}' method does not return an object`);
                }
            }

            return undefined;
        };

        return doForSubtypes(type, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (subtype.category === TypeCategory.Object) {
                const returnType = getIteratorReturnType(subtype, undefined, diag);
                if (returnType) {
                    return returnType;
                }
            } else if (subtype.category === TypeCategory.Class) {
                // Handle the case where the class itself is iterable.
                // This is true for classes that derive from Enum, for example.
                const metaclassType = getMetaclass(subtype);
                if (metaclassType) {
                    if (metaclassType.category === TypeCategory.Class) {
                        const returnType = getIteratorReturnType(ObjectType.create(subtype), metaclassType, diag);
                        if (returnType) {
                            return returnType;
                        }
                    }
                }
            }

            if (errorNode) {
                addError(`'${printType(subtype)}' is not iterable` + diag.getString(), errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods.
    function synthesizeDataClassMethods(node: ClassNode, classType: ClassType, skipSynthesizeInit: boolean) {
        assert(ClassType.isDataClass(classType));

        const newType = FunctionType.create(FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
        const initType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);

        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });
        addDefaultFunctionParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType)
        });
        initType.details.declaredReturnType = NoneType.create();

        // Maintain a list of all dataclass entries (including
        // those from inherited classes) plus a list of only those
        // entries added by this class.
        const localDataClassEntries: DataClassEntry[] = [];
        const fullDataClassEntries: DataClassEntry[] = [];
        addInheritedDataClassEntries(classType, fullDataClassEntries);

        // Maintain a list of "type evaluators".
        type TypeEvaluator = () => Type;
        const localEntryTypeEvaluator: { entry: DataClassEntry; evaluator: TypeEvaluator }[] = [];

        node.suite.statements.forEach(statementList => {
            if (statementList.nodeType === ParseNodeType.StatementList) {
                statementList.statements.forEach(statement => {
                    let variableNameNode: NameNode | undefined;
                    let variableTypeEvaluator: TypeEvaluator | undefined;
                    let hasDefaultValue = false;

                    if (statement.nodeType === ParseNodeType.Assignment) {
                        if (statement.leftExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.leftExpression;
                            variableTypeEvaluator = () =>
                                stripLiteralValue(getTypeOfExpression(statement.rightExpression).type);
                        } else if (
                            statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                            statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name
                        ) {
                            variableNameNode = statement.leftExpression.valueExpression;
                            variableTypeEvaluator = () =>
                                convertClassToObject(
                                    getTypeOfExpression(
                                        (statement.leftExpression as TypeAnnotationNode).typeAnnotation,
                                        undefined,
                                        EvaluatorFlags.ConvertEllipsisToAny
                                    ).type
                                );
                        }

                        hasDefaultValue = true;
                    } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                        if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.valueExpression;
                            variableTypeEvaluator = () =>
                                convertClassToObject(
                                    getTypeOfExpression(
                                        statement.typeAnnotation,
                                        undefined,
                                        EvaluatorFlags.ConvertEllipsisToAny | EvaluatorFlags.EvaluateStringLiteralAsType
                                    ).type
                                );
                        }
                    }

                    if (variableNameNode && variableTypeEvaluator) {
                        const variableName = variableNameNode.value;

                        // Create a new data class entry, but defer evaluation of the type until
                        // we've compiled the full list of data class entries for this class. This
                        // allows us to handle circular references in types.
                        const dataClassEntry: DataClassEntry = {
                            name: variableName,
                            hasDefault: hasDefaultValue,
                            type: UnknownType.create()
                        };
                        localEntryTypeEvaluator.push({ entry: dataClassEntry, evaluator: variableTypeEvaluator });

                        // Add the new entry to the local entry list.
                        let insertIndex = localDataClassEntries.findIndex(e => e.name === variableName);
                        if (insertIndex >= 0) {
                            localDataClassEntries[insertIndex] = dataClassEntry;
                        } else {
                            localDataClassEntries.push(dataClassEntry);
                        }

                        // Add the new entry to the full entry list.
                        insertIndex = fullDataClassEntries.findIndex(p => p.name === variableName);
                        if (insertIndex >= 0) {
                            fullDataClassEntries[insertIndex] = dataClassEntry;
                        } else {
                            fullDataClassEntries.push(dataClassEntry);
                            insertIndex = fullDataClassEntries.length - 1;
                        }

                        // If we've already seen a entry with a default value defined,
                        // all subsequent entries must also have default values.
                        const firstDefaultValueIndex = fullDataClassEntries.findIndex(p => p.hasDefault);
                        if (!hasDefaultValue && firstDefaultValueIndex >= 0 && firstDefaultValueIndex < insertIndex) {
                            addError(
                                `Data fields without default value cannot appear after ` +
                                    `data fields with default values`,
                                variableNameNode
                            );
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
        localEntryTypeEvaluator.forEach(entryEvaluator => {
            entryEvaluator.entry.type = entryEvaluator.evaluator();
        });

        if (!skipSynthesizeInit) {
            fullDataClassEntries.forEach(entry => {
                const functionParam: FunctionParameter = {
                    category: ParameterCategory.Simple,
                    name: entry.name,
                    hasDefault: entry.hasDefault,
                    type: entry.type
                };

                FunctionType.addParameter(initType, functionParam);
            });

            const symbolTable = classType.details.fields;
            symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
            symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        }
    }

    function synthesizeTypedDictClassMethods(node: ClassNode | ExpressionNode, classType: ClassType) {
        assert(ClassType.isTypedDictClass(classType));

        // Synthesize a __new__ method.
        const newType = FunctionType.create(FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });
        addDefaultFunctionParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);

        // Synthesize an __init__ method.
        const initType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType)
        });
        initType.details.declaredReturnType = NoneType.create();

        // All parameters must be named, so insert an empty "*".
        FunctionType.addParameter(initType, {
            category: ParameterCategory.VarArgList,
            type: AnyType.create()
        });

        const entries = getTypedDictMembersForClass(classType);
        entries.forEach((entry, name) => {
            FunctionType.addParameter(initType, {
                category: ParameterCategory.Simple,
                name,
                hasDefault: !entry.isRequired,
                type: entry.valueType
            });
        });

        const symbolTable = classType.details.fields;
        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

        // Synthesize a "get" method for each named entry.
        const strClass = getBuiltInType(node, 'str');
        if (strClass.category === TypeCategory.Class) {
            const getOverloads: FunctionType[] = [];

            entries.forEach((entry, name) => {
                const getOverload = FunctionType.create(
                    FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
                );
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'self',
                    type: ObjectType.create(classType)
                });
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'k',
                    type: ObjectType.cloneWithLiteral(ObjectType.create(strClass), name)
                });
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    type: entry.valueType,
                    hasDefault: true
                });
                getOverload.details.declaredReturnType = entry.valueType;
                getOverloads.push(getOverload);
            });

            if (getOverloads.length > 0) {
                const mappingClass = getBuiltInType(node, 'Mapping');
                if (mappingClass.category === TypeCategory.Class) {
                    const overriddenGet = getTypeFromClassMemberName(
                        node as ExpressionNode,
                        mappingClass,
                        'get',
                        { method: 'get' },
                        new DiagnosticAddendum(),
                        MemberAccessFlags.SkipBaseClasses
                    );
                    if (overriddenGet && overriddenGet.type.category === TypeCategory.OverloadedFunction) {
                        getOverloads.push(overriddenGet.type.overloads[overriddenGet.type.overloads.length - 1]);
                    }
                }

                const getMethod = OverloadedFunctionType.create();
                getMethod.overloads = getOverloads;
                symbolTable.set('get', Symbol.createWithType(SymbolFlags.ClassMember, getMethod));
            }
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

    // Determines whether the specified string literal is part
    // of a Literal['xxx'] statement. If so, we will not treat
    // the string as a normal forward-declared type annotation.
    function isAnnotationLiteralValue(node: StringListNode): boolean {
        if (node.parent && node.parent.nodeType === ParseNodeType.IndexItems) {
            const indexItemsNode = node.parent;
            if (indexItemsNode.parent && indexItemsNode.parent.nodeType === ParseNodeType.Index) {
                const indexNode = indexItemsNode.parent;
                const baseType = getTypeOfExpression(indexNode.baseExpression).type;
                if (baseType && baseType.category === TypeCategory.Class) {
                    if (ClassType.isSpecialBuiltIn(baseType, 'Literal')) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function addWarning(message: string, node: ParseNode) {
        if (!isSpeculativeMode()) {
            const fileInfo = getFileInfo(node);
            return fileInfo.diagnosticSink.addWarningWithTextRange(message, node);
        }

        return undefined;
    }

    function addError(message: string, node: ParseNode) {
        if (!isSpeculativeMode()) {
            const fileInfo = getFileInfo(node);
            return fileInfo.diagnosticSink.addErrorWithTextRange(message, node);
        }

        return undefined;
    }

    function addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, node: ParseNode) {
        let diagnostic: Diagnostic | undefined;

        if (diagLevel === 'error') {
            diagnostic = addError(message, node);
        } else if (diagLevel === 'warning') {
            diagnostic = addWarning(message, node);
        }

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
        let diagnostic: Diagnostic | undefined;

        if (diagLevel === 'error') {
            diagnostic = fileInfo.diagnosticSink.addErrorWithTextRange(message, range);
        } else if (diagLevel === 'warning') {
            diagnostic = fileInfo.diagnosticSink.addWarningWithTextRange(message, range);
        }

        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    function assignTypeToNameNode(nameNode: NameNode, type: Type, srcExpression?: ParseNode) {
        const nameValue = nameNode.value;

        const symbolWithScope = lookUpSymbolRecursive(nameNode, nameValue);
        if (!symbolWithScope) {
            fail(`Missing symbol '${nameValue}'`);
            return;
        }

        const declarations = symbolWithScope.symbol.getDeclarations();
        const declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol);
        const fileInfo = getFileInfo(nameNode);

        // We found an existing declared type. Make sure the type is assignable.
        let destType = type;
        if (declaredType && srcExpression) {
            const diagAddendum = new DiagnosticAddendum();

            if (!canAssignType(declaredType, type, diagAddendum)) {
                addError(
                    `Expression of type '${printType(type)}' cannot be ` +
                        `assigned to declared type '${printType(declaredType)}'` +
                        diagAddendum.getString(),
                    srcExpression || nameNode
                );
                destType = declaredType;
            } else {
                // Constrain the resulting type to match the declared type.
                destType = narrowDeclaredTypeBasedOnAssignedType(declaredType, type);
            }
        } else {
            destType = stripLiteralTypeArgsValue(destType);

            // If this is a member name (within a class scope) and the member name
            // appears to be a constant, use the strict source type. If it's a member
            // variable that can be overridden by a child class, use the more general
            // version by stripping off the literal.
            const scope = ScopeUtils.getScopeForNode(nameNode);
            if (scope.type === ScopeType.Class) {
                const isConstant = isConstantName(nameValue);
                const isPrivate = isPrivateOrProtectedName(nameValue);

                if (
                    !isConstant &&
                    (!isPrivate || getFileInfo(nameNode).diagnosticSettings.reportPrivateUsage === 'none')
                ) {
                    destType = stripLiteralValue(destType);
                }
            }
        }

        const varDecl: Declaration | undefined = declarations.find(decl => decl.type === DeclarationType.Variable);

        if (varDecl && varDecl.type === DeclarationType.Variable && srcExpression) {
            if (varDecl.isConstant) {
                // A constant variable can be assigned only once. If this
                // isn't the first assignment, generate an error.
                if (nameNode !== declarations[0].node) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportConstantRedefinition,
                        DiagnosticRule.reportConstantRedefinition,
                        `'${nameValue}' is constant and cannot be redefined`,
                        nameNode
                    );
                }
            }
        }

        writeTypeCache(nameNode, destType);
    }

    function assignTypeToMemberAccessNode(target: MemberAccessNode, type: Type, srcExpr?: ExpressionNode) {
        const baseTypeResult = getTypeOfExpression(target.leftExpression);

        // Handle member accesses (e.g. self.x or cls.y).
        if (target.leftExpression.nodeType === ParseNodeType.Name) {
            // Determine whether we're writing to a class or instance member.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

            if (enclosingClassNode) {
                const classTypeResults = getTypeOfClass(enclosingClassNode);

                if (classTypeResults && classTypeResults.classType.category === TypeCategory.Class) {
                    if (baseTypeResult.type.category === TypeCategory.Object) {
                        if (ClassType.isSameGenericClass(baseTypeResult.type.classType, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, true, srcExpr);
                        }
                    } else if (baseTypeResult.type.category === TypeCategory.Class) {
                        if (ClassType.isSameGenericClass(baseTypeResult.type, classTypeResults.classType)) {
                            assignTypeToMemberVariable(target, type, false, srcExpr);
                        }
                    }

                    // Assignments to instance or class variables through "self" or "cls" is not
                    // allowed for protocol classes.
                    if (ClassType.isProtocolClass(classTypeResults.classType)) {
                        addError(
                            `Assignment to instance or class variables not allowed within a Protocol class`,
                            target.memberName
                        );
                    }
                }
            }
        }

        getTypeFromMemberAccessWithBaseType(
            target,
            baseTypeResult,
            { method: 'set', setType: type, setErrorNode: srcExpr },
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

        let destType = srcType;

        const classTypeInfo = getTypeOfClass(classDef);
        if (classTypeInfo && classTypeInfo.classType.category === TypeCategory.Class) {
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
                    memberInfo.classType.category === TypeCategory.Class &&
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
                                fileInfo.diagnosticSettings.reportConstantRedefinition,
                                DiagnosticRule.reportConstantRedefinition,
                                `'${node.memberName.value}' is constant and cannot be redefined`,
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
                                `'${node.memberName.value}' is declared as Final and cannot be reassigned`,
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
                            setSymbolAccessed(fileInfo, memberInfo.symbol);
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
            if (memberInfo) {
                const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol);
                if (declaredType && !isAnyOrUnknown(declaredType)) {
                    if (declaredType.category === TypeCategory.Function) {
                        // Overwriting an existing method.
                        // TODO - not sure what assumption to make here.
                    } else if (isProperty(declaredType)) {
                        // TODO - need to validate property setter type.
                    } else {
                        const diagAddendum = new DiagnosticAddendum();
                        if (canAssignType(declaredType, srcType, diagAddendum)) {
                            // Constrain the resulting type to match the declared type.
                            destType = narrowDeclaredTypeBasedOnAssignedType(destType, srcType);
                        }
                    }
                }
            } else {
                // There was no declared type, so we need to infer the type.
                if (srcExprNode) {
                    reportPossibleUnknownAssignment(
                        fileInfo.diagnosticSettings.reportUnknownMemberType,
                        DiagnosticRule.reportUnknownMemberType,
                        node.memberName,
                        srcType,
                        node
                    );
                }
            }
        }
    }

    function assignTypeToTupleNode(target: TupleNode, type: Type, srcExpr?: ExpressionNode) {
        // Initialize the array of target types, one for each target.
        const targetTypes: Type[][] = new Array(target.expressions.length);
        for (let i = 0; i < target.expressions.length; i++) {
            targetTypes[i] = [];
        }

        doForSubtypes(type, subtype => {
            // Is this subtype a tuple?
            const tupleType = getSpecializedTupleType(subtype);
            if (tupleType && tupleType.typeArguments) {
                const entryTypes = tupleType.typeArguments;
                let entryCount = entryTypes.length;

                const sourceEndsInEllipsis = entryCount > 1 && isEllipsisType(entryTypes[entryCount - 1]);
                if (sourceEndsInEllipsis) {
                    entryCount--;
                }

                const targetEndsWithUnpackOperator =
                    target.expressions.length > 0 &&
                    target.expressions[target.expressions.length - 1].nodeType === ParseNodeType.Unpack;

                if (targetEndsWithUnpackOperator) {
                    if (entryCount >= target.expressions.length) {
                        for (let index = 0; index < target.expressions.length - 1; index++) {
                            const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                            targetTypes[index].push(entryType);
                        }

                        const remainingTypes: Type[] = [];
                        for (let index = target.expressions.length - 1; index < entryCount; index++) {
                            const entryType = entryTypes[index];
                            remainingTypes.push(entryType);
                        }

                        targetTypes[target.expressions.length - 1].push(combineTypes(remainingTypes));
                    } else {
                        addError(
                            `Tuple size mismatch: expected at least ${target.expressions.length} entries` +
                                ` but got ${entryCount}`,
                            target
                        );
                    }
                } else {
                    if (target.expressions.length === entryCount || sourceEndsInEllipsis) {
                        for (let index = 0; index < target.expressions.length; index++) {
                            const entryType = index < entryCount ? entryTypes[index] : entryTypes[entryCount - 1];
                            targetTypes[index].push(entryType);
                        }
                    } else {
                        addError(
                            `Tuple size mismatch: expected ${target.expressions.length}` + ` but got ${entryCount}`,
                            target
                        );
                    }
                }
            } else {
                // The assigned expression isn't a tuple, so it had better
                // be some iterable type.
                const iterableType = getTypeFromIterable(subtype, false, srcExpr, false);
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
            const targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);
            assignTypeToExpression(expr, targetType, srcExpr);
        });

        writeTypeCache(target, type);
    }

    function assignTypeToExpression(target: ExpressionNode, type: Type, srcExpr?: ExpressionNode) {
        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target;
                // Handle '__all__' as a special case in the module scope.
                if (name.value === '__all__' && srcExpr) {
                    const scope = ScopeUtils.getScopeForNode(target);
                    if (scope.type === ScopeType.Module) {
                        // It's common for modules to include the expression
                        // __all__ = ['a', 'b', 'c']
                        // We will mark the symbols referenced by these strings as accessed.
                        if (srcExpr.nodeType === ParseNodeType.List) {
                            const fileInfo = getFileInfo(target);
                            srcExpr.entries.forEach(entryExpr => {
                                if (
                                    entryExpr.nodeType === ParseNodeType.StringList ||
                                    entryExpr.nodeType === ParseNodeType.String
                                ) {
                                    const symbolName =
                                        entryExpr.nodeType === ParseNodeType.String
                                            ? entryExpr.value
                                            : entryExpr.strings.map(s => s.value).join('');
                                    const symbolInScope = scope.lookUpSymbolRecursive(symbolName);
                                    if (symbolInScope) {
                                        setSymbolAccessed(fileInfo, symbolInScope.symbol);
                                    }
                                }
                            });
                        }
                    }
                }

                reportPossibleUnknownAssignment(
                    getFileInfo(target).diagnosticSettings.reportUnknownVariableType,
                    DiagnosticRule.reportUnknownVariableType,
                    target,
                    type,
                    target
                );

                assignTypeToNameNode(target, type, srcExpr);
                break;
            }

            case ParseNodeType.MemberAccess: {
                assignTypeToMemberAccessNode(target, type, srcExpr);
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
                    { method: 'set', setType: type, setErrorNode: srcExpr },
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
                const typeHintType = getTypeOfAnnotation(target.typeAnnotation);
                const diagAddendum = new DiagnosticAddendum();
                if (canAssignType(typeHintType, type, diagAddendum)) {
                    type = narrowDeclaredTypeBasedOnAssignedType(typeHintType, type);
                }

                assignTypeToExpression(target.valueExpression, type, srcExpr);
                break;
            }

            case ParseNodeType.Unpack: {
                if (target.expression.nodeType === ParseNodeType.Name) {
                    if (!isAnyOrUnknown(type)) {
                        // Make a list type from the source.
                        const listType = getBuiltInType(target, 'List');
                        if (listType.category === TypeCategory.Class) {
                            type = ObjectType.create(ClassType.cloneForSpecialization(listType, [type]));
                        } else {
                            type = UnknownType.create();
                        }
                    }
                    assignTypeToNameNode(target.expression, type);
                }
                break;
            }

            case ParseNodeType.List: {
                // The assigned expression had better be some iterable type.
                const iteratedType = getTypeFromIterable(type, false, srcExpr, false);

                target.entries.forEach(entry => {
                    assignTypeToExpression(entry, iteratedType, srcExpr);
                });
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                useSpeculativeMode(() => {
                    if (target.child) {
                        getTypeOfExpression(target.child);
                    }
                });
                break;
            }

            default: {
                addError(`Expression cannot be assignment target`, target);
                break;
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
                useSpeculativeMode(() => {
                    if (node.child) {
                        getTypeOfExpression(node.child);
                    }
                });
                break;
            }

            default: {
                addError(`Expression cannot be deleted`, node);
                break;
            }
        }
    }

    function setSymbolAccessed(fileInfo: AnalyzerFileInfo, symbol: Symbol) {
        if (!isSpeculativeMode()) {
            fileInfo.accessedSymbolMap.set(symbol.id, true);
        }
    }

    // Builds a sorted list of dataclass entries that are inherited by
    // the specified class. These entries must be unique and in reverse-MRO
    // order.
    function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
        for (let i = classType.details.mro.length - 1; i >= 0; i--) {
            const mroClass = classType.details.mro[i];

            if (mroClass.category === TypeCategory.Class) {
                const dataClassEntries = ClassType.getDataClassEntries(mroClass);

                // Add the entries to the end of the list, replacing same-named
                // entries if found.
                dataClassEntries.forEach(entry => {
                    const existingIndex = entries.findIndex(e => e.name === entry.name);
                    if (existingIndex >= 0) {
                        entries[existingIndex] = entry;
                    } else {
                        entries.push(entry);
                    }
                });
            }
        }
    }

    function getReturnTypeFromGenerator(type: Type): Type | undefined {
        if (isAnyOrUnknown(type)) {
            return type;
        }

        if (type.category === TypeCategory.Object) {
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

    function getSpecializedReturnType(objType: ObjectType, memberName: string) {
        const classMember = lookUpObjectMember(objType, memberName, ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (memberType.category === TypeCategory.Function) {
            const methodType = bindFunctionToClassOrObject(objType, memberType) as FunctionType;
            return getFunctionEffectiveReturnType(methodType);
        }

        return undefined;
    }

    // This is similar to _getSpecializedReturnType except that
    // the method lookup occurs on a metaclass rather than
    // the object that derives from it.
    function getSpecializedReturnTypeForMetaclassMethod(
        metaclass: ClassType,
        classType: ClassType,
        memberName: string
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
            const methodType = bindFunctionToClassOrObject(classType, memberType, true) as FunctionType;
            return getFunctionEffectiveReturnType(methodType);
        }

        return undefined;
    }

    function getTypeFromName(node: NameNode, flags: EvaluatorFlags): TypeResult {
        const fileInfo = getFileInfo(node);
        const name = node.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = lookUpSymbolRecursive(node, name);

        if (symbolWithScope) {
            const symbol = symbolWithScope.symbol;

            const effectiveType = getEffectiveTypeOfSymbol(symbol);

            const isSpecialBuiltIn =
                !!effectiveType &&
                effectiveType.category === TypeCategory.Class &&
                ClassType.isSpecialBuiltIn(effectiveType);
            let useCodeFlowAnalysis = !isSpecialBuiltIn;

            // Don't use code-flow analysis if forward references are allowed.
            if (flags & EvaluatorFlags.AllowForwardReferences) {
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

            type = effectiveType;
            if (useCodeFlowAnalysis) {
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
                if (type.category === TypeCategory.Class) {
                    if (!type.typeArguments) {
                        type = createSpecializedClassType(type, undefined, node);
                    }
                } else if (type.category === TypeCategory.Object) {
                    // If this is an object that contains a Type[X], transform it
                    // into class X.
                    const typeType = getClassFromPotentialTypeObject(type);
                    if (typeType) {
                        type = typeType;
                    }
                }
            }

            if (isUnbound(type)) {
                addError(`'${name}' is unbound`, node);
            } else if (isPossiblyUnbound(type)) {
                addError(`'${name}' is possibly unbound`, node);
            }

            setSymbolAccessed(fileInfo, symbol);
        } else {
            // Handle the special case of "reveal_type".
            if (name !== 'reveal_type') {
                addError(`'${name}' is not defined`, node);
            }
            type = UnknownType.create();
        }

        return { type, node };
    }

    function getTypeFromMemberAccess(node: MemberAccessNode, flags: EvaluatorFlags): TypeResult {
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, EvaluatorFlags.DoNotSpecialize);
        const memberType = getTypeFromMemberAccessWithBaseType(node, baseTypeResult, { method: 'get' }, flags);

        if (isCodeFlowSupportedForReference(node)) {
            // Before performing code fow analysis, update the cache to prevent
            // recursion.
            writeTypeCache(node, memberType.type);
            writeTypeCache(node.memberName, memberType.type);

            // See if we can refine the type based on code flow analysis.
            const codeFlowType = getFlowTypeOfReference(node, indeterminateSymbolId, memberType.type);
            if (codeFlowType) {
                memberType.type = codeFlowType;
            }
        }

        // Cache the type information in the member name node as well.
        writeTypeCache(node.memberName, memberType.type);

        return memberType;
    }

    function getTypeFromMemberAccessWithBaseType(
        node: MemberAccessNode,
        baseTypeResult: TypeResult,
        usage: EvaluatorUsage,
        flags: EvaluatorFlags
    ): TypeResult {
        const baseType = baseTypeResult.type;
        const memberName = node.memberName.value;
        const diag = new DiagnosticAddendum();
        let type: Type | undefined;

        switch (baseType.category) {
            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                type = baseType;
                break;
            }

            case TypeCategory.Class: {
                type = getTypeFromClassMember(node.memberName, baseType, node.memberName.value, usage, diag);
                break;
            }

            case TypeCategory.TypeVar: {
                return getTypeFromMemberAccessWithBaseType(
                    node,
                    {
                        type: specializeType(baseType, undefined),
                        node
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

                type = getTypeFromObjectMember(
                    node.memberName,
                    baseType,
                    node.memberName.value,
                    usage,
                    diag,
                    MemberAccessFlags.None
                );
                break;
            }

            case TypeCategory.Module: {
                const symbol = ModuleType.getField(baseType, memberName);
                if (symbol) {
                    if (usage.method === 'get') {
                        setSymbolAccessed(getFileInfo(node), symbol);
                    }

                    type = getEffectiveTypeOfSymbol(symbol);

                    // If the type resolved to "unbound", treat it as "unknown" in
                    // the case of a module reference because if it's truly unbound,
                    // that error will be reported within the module and should not
                    // leak into other modules that import it.
                    if (type.category === TypeCategory.Unbound) {
                        type = UnknownType.create();
                    }
                } else {
                    addError(`'${memberName}' is not a known member of module`, node.memberName);
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.Union: {
                type = doForSubtypes(baseType, subtype => {
                    if (isNoneOrNever(subtype)) {
                        addDiagnostic(
                            getFileInfo(node).diagnosticSettings.reportOptionalMemberAccess,
                            DiagnosticRule.reportOptionalMemberAccess,
                            `'${memberName}' is not a known member of 'None'`,
                            node.memberName
                        );
                        return undefined;
                    } else if (subtype.category === TypeCategory.Unbound) {
                        // Don't do anything if it's unbound. The error will already
                        // be reported elsewhere.
                        return undefined;
                    } else {
                        const typeResult = getTypeFromMemberAccessWithBaseType(
                            node,
                            {
                                type: subtype,
                                node
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
                type = UnknownType.create();
                break;
            }

            default:
                diag.addMessage(`Unsupported type '${printType(baseType)}'`);
                break;
        }

        if (!type) {
            let operationName = 'access';
            if (usage.method === 'set') {
                operationName = 'assign';
            } else if (usage.method === 'del') {
                operationName = 'delete';
            }

            addError(
                `Cannot ${operationName} member '${memberName}' ` +
                    `for type '${printType(baseType)}'` +
                    diag.getString(),
                node.memberName
            );
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class && !type.typeArguments) {
                type = createSpecializedClassType(type, undefined, node);
            }
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

                // If the type arg is a type var itself, specialize it in
                // case it's bound or constrained.
                if (firstTypeArg.category === TypeCategory.TypeVar) {
                    firstTypeArg = getConcreteTypeFromTypeVar(firstTypeArg);
                }

                if (firstTypeArg.category === TypeCategory.Object) {
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
        flags: MemberAccessFlags
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

            // Don't include variables within typed dict classes.
            if (ClassType.isTypedDictClass(classType)) {
                const typedDecls = memberInfo.symbol.getTypedDeclarations();
                if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable) {
                    diag.addMessage(`Member '${memberName}' is unknown`);
                    return undefined;
                }
            }

            if (usage.method === 'get') {
                // Mark the member accessed if it's not coming from a parent class.
                if (memberInfo.classType === classType) {
                    setSymbolAccessed(getFileInfo(errorNode), memberInfo.symbol);
                }
            }

            if (!(flags & MemberAccessFlags.SkipGetCheck)) {
                if (type.category === TypeCategory.Object) {
                    // See if there's a magic "__get__", "__set__", or "__delete__"
                    // method on the object.
                    let accessMethodName: string;

                    if (usage.method === 'get') {
                        accessMethodName = '__get__';
                    } else if (usage.method === 'set') {
                        accessMethodName = '__set__';
                    } else {
                        accessMethodName = '__delete__';
                    }

                    const memberClassType = type.classType;
                    const accessMethod = lookUpClassMember(
                        memberClassType,
                        accessMethodName,
                        ClassMemberLookupFlags.SkipInstanceVariables
                    );

                    // Handle properties specially.
                    if (ClassType.isPropertyClass(type.classType)) {
                        if (usage.method === 'set') {
                            if (!accessMethod) {
                                diag.addMessage(`Property '${memberName}' has no defined setter`);
                                return undefined;
                            }
                        } else if (usage.method === 'del') {
                            if (!accessMethod) {
                                diag.addMessage(`Property '${memberName}' has no defined deleter`);
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
                                    type: ObjectType.create(memberClassType)
                                },
                                {
                                    argumentCategory: ArgumentCategory.Simple,
                                    type:
                                        flags & MemberAccessFlags.SkipInstanceMembers
                                            ? NoneType.create()
                                            : ObjectType.create(classType)
                                },
                                {
                                    argumentCategory: ArgumentCategory.Simple,
                                    type: AnyType.create()
                                }
                            ];

                            const overload = findOverloadedFunctionType(errorNode, argList, accessMethodType);
                            if (overload) {
                                accessMethodType = overload;
                            }
                        }

                        if (accessMethodType.category === TypeCategory.Function) {
                            // Bind the accessor to the base object type.
                            accessMethodType = bindFunctionToClassOrObject(
                                ObjectType.create(classType),
                                accessMethodType
                            ) as FunctionType;

                            if (usage.method === 'get') {
                                type = getFunctionEffectiveReturnType(accessMethodType);
                                type = partiallySpecializeType(type, classType);
                            } else {
                                if (usage.method === 'set') {
                                    // Verify that the setter's parameter type matches
                                    // the type of the value being assigned.
                                    if (accessMethodType.details.parameters.length >= 2) {
                                        const setValueType = accessMethodType.details.parameters[1].type;
                                        if (!canAssignType(setValueType, usage.setType!, diag)) {
                                            return undefined;
                                        }
                                    }
                                }

                                // The type isn't important for set or delete usage.
                                // We just need to return some defined type.
                                type = AnyType.create();
                            }
                        }

                        return {
                            type,
                            isClassMember: !memberInfo.isInstanceMember
                        };
                    }
                }
            }

            if (usage.method === 'set') {
                let enforceTargetType = false;

                if (memberInfo.symbol.hasTypedDeclarations()) {
                    // If the member has a declared type, we will enforce it.
                    enforceTargetType = true;
                } else {
                    // If the member has no declared type, we will enforce it
                    // if this assignment isn't within the enclosing class. If
                    // it is within the enclosing class, the assignment is used
                    // to infer the type of the member.
                    if (!memberInfo.symbol.getDeclarations().some(decl => decl.node === errorNode)) {
                        enforceTargetType = true;
                    }
                }

                if (enforceTargetType) {
                    let effectiveType = type;

                    // If the code is patching a method (defined on the class)
                    // with an object-level function, strip the "self" parameter
                    // off the original type. This is sometimes done for test
                    // purposes to override standard behaviors of specific methods.
                    if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                        if (!memberInfo.isInstanceMember && type.category === TypeCategory.Function) {
                            if (FunctionType.isClassMethod(type) || FunctionType.isInstanceMethod(type)) {
                                effectiveType = stripFirstParameter(type);
                            }
                        }
                    }

                    // Verify that the assigned type is compatible.
                    if (!canAssignType(effectiveType, usage.setType!, diag.createAddendum())) {
                        diag.addMessage(
                            `Expression of type '${printType(usage.setType!)}'` +
                                ` cannot be assigned to member '${memberName}'` +
                                ` of class '${printObjectTypeForClass(classType)}'`
                        );
                        return undefined;
                    }
                }
            }

            return {
                type,
                isClassMember: !memberInfo.isInstanceMember
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
                        isClassMember: false
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
                        isClassMember: false
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
                        isClassMember: false
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
                        isClassMember: false
                    };
                }
            }
        }

        diag.addMessage(`Member '${memberName}' is unknown`);
        return undefined;
    }

    function getTypeFromIndex(node: IndexNode, expectedType?: Type, flags = EvaluatorFlags.None): TypeResult {
        const baseTypeResult = getTypeOfExpression(
            node.baseExpression,
            undefined,
            flags | EvaluatorFlags.DoNotSpecialize
        );

        return getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'get', expectedType }, flags);
    }

    function getTypeFromIndexWithBaseType(
        node: IndexNode,
        baseType: Type,
        usage: EvaluatorUsage,
        flags: EvaluatorFlags
    ): TypeResult {
        // Handle the special case where we're specializing a
        // generic union of classes or callable.
        if (baseType.category === TypeCategory.Union || baseType.category === TypeCategory.Function) {
            const typeParameters: TypeVarType[] = [];
            let isUnionOfClasses = true;

            doForSubtypes(baseType, subtype => {
                if (
                    subtype.category === TypeCategory.Class ||
                    subtype.category === TypeCategory.TypeVar ||
                    subtype.category === TypeCategory.Function ||
                    subtype.category === TypeCategory.None
                ) {
                    addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(subtype));
                } else {
                    isUnionOfClasses = false;
                }
                return undefined;
            });

            if (isUnionOfClasses && typeParameters.length > 0) {
                const typeArgs = getTypeArgs(node.items, flags).map(t => convertClassToObject(t.type));
                const typeVarMap = buildTypeVarMap(typeParameters, typeArgs);
                const type = specializeType(baseType, typeVarMap);
                return { type, node };
            }
        }

        const type = doForSubtypes(baseType, subtype => {
            if (subtype.category === TypeCategory.TypeVar) {
                subtype = specializeType(subtype, undefined);
            }

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (subtype.category === TypeCategory.Class) {
                // Setting the value of an indexed class will always result
                // in an exception.
                if (usage.method === 'set') {
                    addError(`Generic class type cannot be assigned`, node.baseExpression);
                } else if (usage.method === 'del') {
                    addError(`Generic class type cannot be deleted`, node.baseExpression);
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
                            `Expected one type argument for 'InitVar' but got ${typeArgs.length}`,
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

                const typeArgs = getTypeArgs(node.items, flags);
                return createSpecializedClassType(subtype, typeArgs, node.items);
            }

            if (subtype.category === TypeCategory.Object) {
                return getTypeFromIndexedObject(node, subtype, usage);
            }

            if (isNoneOrNever(subtype)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticSettings.reportOptionalSubscript,
                    DiagnosticRule.reportOptionalSubscript,
                    `Optional of type 'None' cannot be subscripted`,
                    node.baseExpression
                );

                return UnknownType.create();
            }

            if (!isUnbound(subtype)) {
                addError(`Object of type '${printType(subtype)}' cannot be subscripted`, node.baseExpression);
            }

            return UnknownType.create();
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.items.forEach(item => {
            getTypeOfExpression(item);
        });

        return { type, node };
    }

    function getTypeFromIndexedObject(node: IndexNode, baseType: ObjectType, usage: EvaluatorUsage): Type {
        // Handle index operations for TypedDict classes specially.
        if (ClassType.isTypedDictClass(baseType.classType)) {
            if (node.items.items.length !== 1) {
                addError('Expected a one index argument', node);
                return UnknownType.create();
            }

            const entries = getTypedDictMembersForClass(baseType.classType);

            const indexType = getTypeOfExpression(node.items.items[0]).type;
            const diag = new DiagnosticAddendum();
            const resultingType = doForSubtypes(indexType, subtype => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                }

                if (subtype.category === TypeCategory.Object && ClassType.isBuiltIn(subtype.classType, 'str')) {
                    if (!subtype.literalValue) {
                        // If it's a plain str with no literal value, we can't
                        // make any determination about the resulting type.
                        return UnknownType.create();
                    }

                    // Look up the entry in the typed dict to get its type.
                    const entryName = subtype.literalValue as string;
                    const entry = entries.get(entryName);
                    if (!entry) {
                        diag.addMessage(`'${entryName}' is not a defined key in '${printType(baseType)}'`);
                        return UnknownType.create();
                    }

                    if (usage.method === 'set') {
                        canAssignType(entry.valueType, usage.setType!, diag);
                    } else if (usage.method === 'del' && entry.isRequired) {
                        addError(`'${entryName}' is a required key and cannot be deleted`, node);
                    }

                    return entry.valueType;
                }

                diag.addMessage(`'${printType(subtype)}' is not a string literal`);
                return UnknownType.create();
            });

            if (diag.getMessageCount() > 0) {
                let operationName = 'get';
                if (usage.method === 'set') {
                    operationName = 'set';
                } else if (usage.method === 'del') {
                    operationName = 'delete';
                }
                addError(`Could not ${operationName} item in TypedDict` + diag.getString(), node);
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
            addError(
                `Object of type '${printType(baseType)}' does not define ` + `'${magicMethodName}'`,
                node.baseExpression
            );
            return UnknownType.create();
        }

        const indexTypeList = node.items.items.map(item => getTypeOfExpression(item).type);

        let indexType: Type;
        if (indexTypeList.length === 1) {
            indexType = indexTypeList[0];

            // Handle the special case where the object is a Tuple and
            // the index is a constant number. In such case, we can determine
            // the exact type by indexing into the tuple type array.
            const baseTypeClass = baseType.classType;

            if (
                baseTypeClass.category === TypeCategory.Class &&
                ClassType.isBuiltIn(baseTypeClass, 'Tuple') &&
                baseTypeClass.typeArguments
            ) {
                if (
                    node.items.items[0].nodeType === ParseNodeType.Number &&
                    node.items.items[0].isInteger &&
                    !node.items.items[0].isImaginary
                ) {
                    const numberNode = node.items.items[0];

                    if (
                        numberNode.isInteger &&
                        numberNode.value >= 0 &&
                        numberNode.value < baseTypeClass.typeArguments.length
                    ) {
                        return baseTypeClass.typeArguments[numberNode.value];
                    }
                }
            }
        } else {
            // Handle the case where the index expression is a tuple. This
            // isn't used in most cases, but it is supported by the language.
            const builtInTupleType = getBuiltInType(node, 'Tuple');
            if (builtInTupleType.category === TypeCategory.Class) {
                indexType = convertClassToObject(ClassType.cloneForSpecialization(builtInTupleType, indexTypeList));
            } else {
                indexType = UnknownType.create();
            }
        }

        const argList: FunctionArgument[] = [
            {
                argumentCategory: ArgumentCategory.Simple,
                type: indexType
            }
        ];

        if (usage.method === 'set') {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                type: usage.setType || AnyType.create()
            });
        }

        const callResult = validateCallArguments(node, argList, itemMethodType, new TypeVarMap(), false);

        return callResult.returnType || UnknownType.create();
    }

    function getTypeArgs(node: IndexItemsNode, flags: EvaluatorFlags): TypeResult[] {
        const typeArgs: TypeResult[] = [];

        node.items.forEach(expr => {
            typeArgs.push(getTypeArg(expr, flags));
        });

        return typeArgs;
    }

    function getTypeArg(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        let typeResult: TypeResult;

        if (node.nodeType === ParseNodeType.List) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => getTypeOfExpression(entry, undefined, flags)),
                node
            };
        } else {
            typeResult = getTypeOfExpression(
                node,
                undefined,
                flags | EvaluatorFlags.ConvertEllipsisToAny | EvaluatorFlags.EvaluateStringLiteralAsType
            );
        }

        return typeResult;
    }

    function getTypeFromTuple(node: TupleNode, expectedType?: Type): TypeResult {
        // Build an array of expected types.
        const expectedTypes: Type[] = [];
        if (expectedType && expectedType.category === TypeCategory.Object) {
            const tupleClass = expectedType.classType;

            if (ClassType.isBuiltIn(tupleClass, 'Tuple') && tupleClass.typeArguments) {
                // Is this a homogeneous tuple of indeterminate length? If so,
                // match the number of expected types to the number of entries
                // in the tuple expression.
                if (tupleClass.typeArguments.length === 2 && isEllipsisType(tupleClass.typeArguments[1])) {
                    for (let i = 0; i < node.expressions.length; i++) {
                        expectedTypes.push(tupleClass.typeArguments[0]);
                    }
                } else {
                    tupleClass.typeArguments.forEach(typeArg => {
                        expectedTypes.push(typeArg);
                    });
                }
            }
        }

        const entryTypeResults = node.expressions.map((expr, index) =>
            getTypeOfExpression(expr, index < expectedTypes.length ? expectedTypes[index] : undefined)
        );

        let type: Type = UnknownType.create();
        const builtInTupleType = getBuiltInType(node, 'Tuple');

        if (builtInTupleType.category === TypeCategory.Class) {
            let tupleTypes: Type[] = [];
            for (const typeResult of entryTypeResults) {
                if (typeResult.unpackedType) {
                    // Is this an unpacked tuple? If so, we can append the individual
                    // unpacked entries onto the new tuple. If it's not an upacked tuple
                    // but some other iterator (e.g. a List), we won't know the number of
                    // items, so we'll need to leave the Tuple open-ended.
                    if (
                        typeResult.unpackedType.category === TypeCategory.Object &&
                        ClassType.isBuiltIn(typeResult.unpackedType.classType, 'Tuple')
                    ) {
                        const typeArgs = typeResult.unpackedType.classType.typeArguments;

                        // If the Tuple wasn't specialized or has a "..." type parameter, we can't
                        // make any determination about its contents.
                        if (!typeArgs || typeArgs.some(t => t.category === TypeCategory.Any && t.isEllipsis)) {
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

            type = convertClassToObject(ClassType.cloneForSpecialization(builtInTupleType, tupleTypes));
        }

        return { type, node };
    }

    function getTypeFromCall(node: CallNode, expectedType: Type | undefined, flags: EvaluatorFlags): TypeResult {
        const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, EvaluatorFlags.DoNotSpecialize);

        // Handle the built-in "super" call specially.
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'super') {
            return {
                type: getTypeFromSuperCall(node),
                node
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
            addWarning(`Type of '${exprString}' is '${printType(type)}'`, node.arguments[0]);
            return { type: AnyType.create(), node };
        }

        const argList = node.arguments.map(arg => {
            const functionArg: FunctionArgument = {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name
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
            addError(`Expecting no more than two arguments to super'`, node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = getTypeOfExpression(node.arguments[0].valueExpression).type;

            if (!isAnyOrUnknown(targetClassType) && !(targetClassType.category === TypeCategory.Class)) {
                addError(
                    `Expected class type as first argument to super() call but received ` +
                        `'${printType(targetClassType)}'`,
                    node.arguments[0].valueExpression
                );
            }
        } else {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                const classTypeInfo = getTypeOfClass(enclosingClass);
                targetClassType = classTypeInfo ? classTypeInfo.classType : UnknownType.create();
            } else {
                addError(`Zero-argument form of super call is valid only within a class'`, node.leftExpression);
                targetClassType = UnknownType.create();
            }
        }

        // Determine whether there is a further constraint.
        let constrainedClassType: Type;
        if (node.arguments.length > 1) {
            constrainedClassType = getTypeOfExpression(node.arguments[1].valueExpression).type;

            let reportError = false;

            if (isAnyOrUnknown(constrainedClassType)) {
                // Ignore unknown or any types.
            } else if (constrainedClassType.category === TypeCategory.Object) {
                const childClassType = constrainedClassType.classType;
                if (targetClassType.category === TypeCategory.Class) {
                    if (!derivesFromClassRecursive(childClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else if (constrainedClassType.category === TypeCategory.Class) {
                if (targetClassType.category === TypeCategory.Class) {
                    if (!derivesFromClassRecursive(constrainedClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else {
                reportError = true;
            }

            if (reportError) {
                addError(
                    `Second argument to super() call must be object or class that derives from '${printType(
                        targetClassType
                    )}'`,
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
            if (lookupResults && lookupResults.classType.category === TypeCategory.Class) {
                return ObjectType.create(lookupResults.classType);
            }
        }

        // If the lookup failed, try to return the first base class. An error
        // will be reported by the member lookup logic at a later time.
        if (targetClassType.category === TypeCategory.Class) {
            const baseClasses = targetClassType.details.baseClasses;
            if (baseClasses.length > 0) {
                const baseClassType = baseClasses[0];
                if (baseClassType.category === TypeCategory.Class) {
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
        let callType = baseTypeResult.type;
        const skipUnknownArgCheck = (flags & EvaluatorFlags.DoNotCheckForUnknownArgs) !== 0;

        if (callType.category === TypeCategory.TypeVar) {
            callType = specializeType(callType, undefined);
        }

        switch (callType.category) {
            case TypeCategory.Class: {
                if (ClassType.isBuiltIn(callType)) {
                    const className = callType.details.name;

                    if (className === 'type') {
                        // Handle the 'type' call specially.
                        if (argList.length === 1) {
                            // The one-parameter form of "type" returns the class
                            // for the specified object.
                            const argType = getTypeForArgument(argList[0]);
                            if (argType.category === TypeCategory.Object) {
                                type = argType.classType;
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
                        type = createTypeVarType(errorNode, argList);
                    } else if (className === 'NamedTuple') {
                        type = createNamedTupleType(errorNode, argList, true);
                    } else if (
                        className === 'Protocol' ||
                        className === 'Generic' ||
                        className === 'Callable' ||
                        className === 'Type'
                    ) {
                        addError(`'${className}' cannot be instantiated directly`, errorNode);
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
                } else if (ClassType.hasAbstractMethods(callType)) {
                    // If the class is abstract, it can't be instantiated.
                    const symbolTable = new Map<string, AbstractMethod>();
                    getAbstractMethodsRecursive(callType, symbolTable);

                    const diagAddendum = new DiagnosticAddendum();
                    const symbolTableKeys = [...symbolTable.keys()].filter(key => symbolTable.get(key)!.isAbstract);
                    const errorsToDisplay = 2;

                    symbolTableKeys.forEach((symbolName, index) => {
                        if (index === errorsToDisplay) {
                            diagAddendum.addMessage(`and ${symbolTableKeys.length - errorsToDisplay} more...`);
                        } else if (index < errorsToDisplay) {
                            const symbolWithClass = symbolTable.get(symbolName);

                            if (symbolWithClass && symbolWithClass.classType.category === TypeCategory.Class) {
                                const className = symbolWithClass.classType.details.name;
                                diagAddendum.addMessage(`'${className}.${symbolName}' is abstract`);
                            }
                        }
                    });

                    addError(
                        `Cannot instantiate abstract class '${callType.details.name}'` + diagAddendum.getString(),
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
                        getFileInfo(errorNode).diagnosticSettings.reportUntypedNamedTuple,
                        DiagnosticRule.reportUntypedNamedTuple,
                        `'namedtuple' provides no types for tuple entries. Use 'NamedTuple' instead.`,
                        errorNode
                    );
                    type = createNamedTupleType(errorNode, argList, false);
                } else if (callType.details.builtInName === 'NewType') {
                    const callResult = validateCallArguments(
                        errorNode,
                        argList,
                        callType,
                        new TypeVarMap(),
                        skipUnknownArgCheck
                    );

                    // If the call's arguments were validated, replace the
                    // type with a new synthesized subclass.
                    type = callResult.argumentErrors ? callResult.returnType : createNewType(errorNode, argList);
                } else {
                    type = validateCallArguments(errorNode, argList, callType, new TypeVarMap(), skipUnknownArgCheck)
                        .returnType;

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
                const functionType = findOverloadedFunctionType(errorNode, argList, callType);

                if (functionType) {
                    if (functionType.details.builtInName === 'cast' && argList.length === 2) {
                        // Verify that the cast is necessary.
                        const castToType = getTypeForArgument(argList[0], true);
                        const castFromType = getTypeForArgument(argList[1]);
                        if (
                            castToType.category === TypeCategory.Class &&
                            castFromType.category === TypeCategory.Object
                        ) {
                            if (isTypeSame(castToType, castFromType.classType)) {
                                addDiagnostic(
                                    getFileInfo(errorNode).diagnosticSettings.reportUnnecessaryCast,
                                    DiagnosticRule.reportUnnecessaryCast,
                                    `Unnecessary call to cast: type is already ${printType(castFromType)}`,
                                    errorNode
                                );
                            }
                        }

                        type = convertClassToObject(castToType);
                    } else {
                        type = validateCallArguments(
                            errorNode,
                            argList,
                            functionType,
                            new TypeVarMap(),
                            skipUnknownArgCheck
                        ).returnType;
                        if (!type) {
                            type = UnknownType.create();
                        }
                    }
                } else {
                    const exprString = ParseTreeUtils.printExpression(errorNode);
                    const diagAddendum = new DiagnosticAddendum();
                    const argTypes = argList.map(t => printType(getTypeForArgument(t)));
                    diagAddendum.addMessage(`Argument types: (${argTypes.join(', ')})`);
                    addError(`No overloads for '${exprString}' match parameters` + diagAddendum.getString(), errorNode);
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
                    } else if (classFromTypeObject.category === TypeCategory.Class) {
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
                            skipUnknownArgCheck
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
                callType.subtypes.forEach(typeEntry => {
                    if (isNoneOrNever(typeEntry)) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticSettings.reportOptionalCall,
                            DiagnosticRule.reportOptionalCall,
                            `Object of type 'None' cannot be called`,
                            errorNode
                        );
                    } else {
                        const typeResult = getTypeFromCallWithBaseType(
                            errorNode,
                            argList,
                            {
                                type: typeEntry,
                                node: baseTypeResult.node
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
                argList.forEach(arg => getTypeForArgument(arg));
                type = callType;
                break;
            }
        }

        if (!type) {
            addError(
                `'${ParseTreeUtils.printExpression(errorNode)}' has type ` +
                    `'${printType(callType)}' and is not callable`,
                errorNode
            );
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class) {
                type = createSpecializedClassType(type, undefined, errorNode);
            }
        }

        return { type, node: baseTypeResult.node };
    }

    function findOverloadedFunctionType(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: OverloadedFunctionType
    ): FunctionType | undefined {
        let validOverload: FunctionType | undefined;

        for (const overload of callType.overloads) {
            // Temporarily disable diagnostic output.
            useSpeculativeMode(() => {
                const callResult = validateCallArguments(errorNode, argList, overload, new TypeVarMap(), true);
                if (!callResult.argumentErrors) {
                    validOverload = overload;
                }
            });

            if (validOverload) {
                break;
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
        expectedType?: Type
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
            const callResult = validateCallArguments(
                errorNode,
                argList,
                initMethodType,
                typeVarMap,
                skipUnknownArgCheck
            );
            if (!callResult.argumentErrors) {
                const specializedClassType = applyExpectedTypeForConstructor(
                    specializeType(type, typeVarMap) as ClassType,
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
                const constructorMethodType = bindFunctionToClassOrObject(type, constructorMethodInfo.type, true);
                const typeVarMap = new TypeVarMap();

                // Skip the unknown argument check if we've already checked for __init__.
                const callResult = validateCallArguments(
                    errorNode,
                    argList,
                    constructorMethodType,
                    typeVarMap,
                    skipUnknownArgCheck
                );
                if (!callResult.argumentErrors) {
                    reportedErrors = true;
                }

                if (!returnType) {
                    const specializedClassType = applyExpectedTypeForConstructor(
                        specializeType(type, typeVarMap) as ClassType,
                        expectedType
                    );
                    returnType = ObjectType.create(specializedClassType);
                }
                validatedTypes = true;
            }
        }

        if (!validatedTypes && argList.length > 0) {
            addError(`Expected no arguments to '${type.details.name}' constructor`, errorNode);
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            const specializedClassType = applyExpectedTypeForConstructor(type, expectedType);
            returnType = ObjectType.create(specializedClassType);
        }

        return { argumentErrors: reportedErrors, returnType };
    }

    function applyExpectedTypeForConstructor(type: ClassType, expectedType?: Type): ClassType {
        if (!expectedType) {
            return type;
        }

        // It's common for the expected type to contain a None. Strip
        // this out because we're trying to match the non-optional part.
        const expectedTypeWithoutNone = removeNoneFromUnion(expectedType);
        if (expectedTypeWithoutNone.category !== TypeCategory.Object) {
            return type;
        }

        if (expectedTypeWithoutNone.category !== TypeCategory.Object) {
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

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    function validateCallArguments(
        errorNode: ExpressionNode,
        argList: FunctionArgument[],
        callType: Type,
        typeVarMap: TypeVarMap,
        skipUnknownArgCheck: boolean
    ): CallResult {
        let callResult: CallResult = { argumentErrors: false };

        switch (callType.category) {
            case TypeCategory.Unknown:
            case TypeCategory.Any: {
                // Touch all of the args so they're marked accessed.
                argList.forEach(arg => getTypeForArgument(arg));
                callResult.returnType = callType;
                break;
            }

            case TypeCategory.Function: {
                callResult = validateFunctionArguments(errorNode, argList, callType, typeVarMap, skipUnknownArgCheck);
                break;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedFunctionType = findOverloadedFunctionType(errorNode, argList, callType);
                if (overloadedFunctionType) {
                    callResult = validateFunctionArguments(
                        errorNode,
                        argList,
                        overloadedFunctionType,
                        typeVarMap,
                        skipUnknownArgCheck
                    );
                } else {
                    const exprString = ParseTreeUtils.printExpression(errorNode);
                    const diagAddendum = new DiagnosticAddendum();
                    const argTypes = argList.map(t => printType(getTypeForArgument(t)));
                    diagAddendum.addMessage(`Argument types: (${argTypes.join(', ')})`);
                    addError(`No overloads for '${exprString}' match parameters` + diagAddendum.getString(), errorNode);
                }
                break;
            }

            case TypeCategory.Class: {
                if (!ClassType.isSpecialBuiltIn(callType)) {
                    callResult = validateConstructorArguments(errorNode, argList, callType, skipUnknownArgCheck);
                } else {
                    addError(`'${callType.details.name}' cannot be instantiated`, errorNode);
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
                        skipUnknownArgCheck
                    );
                }
                break;
            }

            case TypeCategory.Union: {
                const returnTypes: Type[] = [];

                for (const type of callType.subtypes) {
                    if (isNoneOrNever(type)) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticSettings.reportOptionalCall,
                            DiagnosticRule.reportOptionalCall,
                            `Object of type 'None' cannot be called`,
                            errorNode
                        );
                    } else {
                        const subtypeCallResult = validateCallArguments(
                            errorNode,
                            argList,
                            type,
                            typeVarMap,
                            skipUnknownArgCheck
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
        skipUnknownArgCheck: boolean
    ): CallResult {
        let argIndex = 0;
        const typeParams = type.details.parameters;

        // The last parameter might be a var arg dictionary. If so, strip it off.
        const varArgDictParam = typeParams.find(param => param.category === ParameterCategory.VarArgDictionary);
        let reportedArgError = false;

        // Build a map of parameters by name.
        const paramMap = new Map<string, ParamAssignmentInfo>();
        typeParams.forEach(param => {
            if (param.name) {
                paramMap.set(param.name, {
                    argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
                    argsReceived: 0
                });
            }
        });

        // Is there a bare (nameless) "*" parameter? If so, it signifies the end
        // of the positional parameter list.
        let positionalParamCount = typeParams.findIndex(
            param => param.category === ParameterCategory.VarArgList && !param.name
        );

        // Is there a positional-only "/" parameter? If so, it separates the
        // positional-only from positional or keyword parameters.
        const positionalOnlyIndex = typeParams.findIndex(
            param => param.category === ParameterCategory.Simple && !param.name
        );

        // Is there a var-arg (named "*") parameter? If so, it is the last of
        // the positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(param => param.category === ParameterCategory.VarArgList);
            if (positionalParamCount >= 0) {
                positionalParamCount++;
            }
        }

        // Is there a keyword var-arg ("**") parameter? If so, it's not included
        // in the list of positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(param => param.category === ParameterCategory.VarArgDictionary);
        }

        // If we didn't see any special cases, then all parameters are positional.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.length;
        }

        // Determine how many positional args are being passed before
        // we see a named arg.
        let positionalArgCount = argList.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.UnpackedDictionary || arg.name !== undefined
        );
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        // If there weren't enough positional arguments to populate all of
        // the positional-only parameters, force the named parameters
        // into positional-only slots so we can report errors for them.
        if (positionalOnlyIndex >= 0 && positionalArgCount < positionalOnlyIndex) {
            positionalArgCount = Math.min(positionalOnlyIndex, argList.length);
        }

        const validateArgTypeParams: ValidateArgTypeParams[] = [];

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex === positionalOnlyIndex) {
                paramIndex++;
                continue;
            }

            if (argIndex < positionalOnlyIndex && argList[argIndex].name) {
                addError(`Expected positional argument`, argList[argIndex].name!);
            }

            if (paramIndex >= positionalParamCount) {
                if (argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    const adjustedCount = positionalParamCount;
                    addError(
                        `Expected ${adjustedCount} positional ` + `${adjustedCount === 1 ? 'argument' : 'arguments'}`,
                        argList[argIndex].valueExpression || errorNode
                    );
                    reportedArgError = true;
                }
                break;
            }

            const paramType = FunctionType.getEffectiveParameterType(type, paramIndex);
            if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedList) {
                // Assume the unpacked list fills the remaining positional args.
                if (argList[argIndex].valueExpression) {
                    const listElementType = getTypeFromIterable(
                        getTypeForArgument(argList[argIndex]),
                        false,
                        argList[argIndex].valueExpression!,
                        false
                    );
                    const funcArg: FunctionArgument = {
                        argumentCategory: ArgumentCategory.Simple,
                        type: listElementType
                    };

                    validateArgTypeParams.push({
                        paramType,
                        requiresTypeVarMatching: requiresSpecialization(paramType),
                        argument: funcArg,
                        errorNode: argList[argIndex].valueExpression || errorNode
                    });
                }
                break;
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].name
                });
                argIndex++;
            } else {
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].name
                });

                // Note that the parameter has received an argument.
                const paramName = typeParams[paramIndex].name;
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                argIndex++;
                paramIndex++;
            }
        }

        if (!reportedArgError) {
            let foundUnpackedDictionaryArg = false;
            const foundUnpackedListArg =
                argList.find(arg => arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

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
                                addError(`Parameter '${paramNameValue}' is already assigned`, paramName);
                                reportedArgError = true;
                            } else {
                                paramMap.get(paramName.value)!.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex(param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);

                                validateArgTypeParams.push({
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramNameValue
                                });
                            }
                        } else if (varArgDictParam) {
                            validateArgTypeParams.push({
                                paramType: varArgDictParam.type,
                                requiresTypeVarMatching: requiresSpecialization(varArgDictParam.type),
                                argument: argList[argIndex],
                                errorNode: argList[argIndex].valueExpression || errorNode,
                                paramName: paramNameValue
                            });
                        } else {
                            addError(`No parameter named '${paramName.value}'`, paramName);
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
                const unassignedParams = [...paramMap.keys()].filter(name => {
                    const entry = paramMap.get(name)!;
                    return entry.argsReceived < entry.argsNeeded;
                });

                if (unassignedParams.length > 0) {
                    addError(
                        `Argument missing for parameter${unassignedParams.length === 1 ? '' : 's'} ` +
                            unassignedParams.map(p => `'${p}'`).join(', '),
                        errorNode
                    );
                    reportedArgError = true;
                }

                // Add any implicit (default) arguments that are needed for resolving
                // generic types. For example, if the function is defined as
                // def foo(v1: _T = 'default')
                // and _T is a TypeVar, we need to match the TypeVar to the default
                // value's type if it's not provided by the caller.
                typeParams.forEach(param => {
                    if (param.category === ParameterCategory.Simple && param.name) {
                        const entry = paramMap.get(param.name)!;
                        if (entry.argsNeeded === 0 && entry.argsReceived === 0) {
                            if (param.defaultType && requiresSpecialization(param.type)) {
                                validateArgTypeParams.push({
                                    paramType: param.type,
                                    requiresTypeVarMatching: true,
                                    argument: {
                                        argumentCategory: ArgumentCategory.Simple,
                                        type: param.defaultType
                                    },
                                    errorNode: errorNode,
                                    paramName: param.name
                                });
                            }
                        }
                    }
                });
            }
        }

        // Special-case a few built-in calls that are often used for
        // casting or checking for unknown types.
        if (['cast', 'isinstance', 'issubclass'].some(name => name === type.details.builtInName)) {
            skipUnknownArgCheck = true;
        }

        // Run through all args and validate them against their matched parameter.
        // We'll do two passes. The first one will match any type arguments. The second
        // will perform the actual validation. We can skip the first pass if there
        // are no type vars to match.
        if (validateArgTypeParams.some(arg => arg.requiresTypeVarMatching)) {
            useSpeculativeMode(() => {
                validateArgTypeParams.forEach(argParam => {
                    if (argParam.requiresTypeVarMatching) {
                        validateArgType(argParam, typeVarMap, skipUnknownArgCheck);
                    }
                });
            });

            // Lock the type var map so it cannot be modified and revalidate the
            // arguments in a second pass.
            typeVarMap.lock();
        }

        validateArgTypeParams.forEach(argParam => {
            if (!validateArgType(argParam, typeVarMap, skipUnknownArgCheck)) {
                reportedArgError = true;
            }
        });

        // Run through all the args that were not validated and evaluate their types
        // to ensure that we haven't missed any (due to arg/param mismatches). This will
        // ensure that referenced symbols are not reported as unaccessed.
        if (!isSpeculativeMode()) {
            argList.forEach(arg => {
                if (arg.valueExpression) {
                    if (!validateArgTypeParams.some(validatedArg => validatedArg.argument === arg)) {
                        getTypeOfExpression(arg.valueExpression);
                    }
                }
            });
        }

        const returnType = specializeType(getFunctionEffectiveReturnType(type, validateArgTypeParams), typeVarMap);

        return { argumentErrors: reportedArgError, returnType };
    }

    function validateArgType(
        argParam: ValidateArgTypeParams,
        typeVarMap: TypeVarMap,
        skipUnknownCheck: boolean
    ): boolean {
        let argType: Type | undefined;

        if (argParam.argument.valueExpression) {
            let expectedType: Type | undefined = specializeType(argParam.paramType, typeVarMap);

            // If the expected type is unknown, don't use an expected type. Instead,
            // use default rules for evaluating the expression type.
            if (expectedType.category === TypeCategory.Unknown) {
                expectedType = undefined;
            }

            const exprType = getTypeOfExpression(argParam.argument.valueExpression, expectedType);
            argType = exprType.type;

            if (argParam.argument && argParam.argument.name && !isSpeculativeMode()) {
                writeTypeCache(argParam.argument.name, argType);
            }
        } else {
            argType = getTypeForArgument(argParam.argument);
        }

        const diag = new DiagnosticAddendum();
        if (!canAssignType(argParam.paramType, argType, diag.createAddendum(), typeVarMap)) {
            const optionalParamName = argParam.paramName ? `'${argParam.paramName}' ` : '';
            addError(
                `Argument of type '${printType(argType)}'` +
                    ` cannot be assigned to parameter ${optionalParamName}` +
                    `of type '${printType(argParam.paramType)}'` +
                    diag.getString(),
                argParam.errorNode
            );
            return false;
        } else if (!skipUnknownCheck) {
            const simplifiedType = removeUnboundFromUnion(argType);
            const fileInfo = getFileInfo(argParam.errorNode);
            if (simplifiedType.category === TypeCategory.Unknown) {
                addDiagnostic(
                    fileInfo.diagnosticSettings.reportUnknownArgumentType,
                    DiagnosticRule.reportUnknownArgumentType,
                    `Type of argument is unknown`,
                    argParam.errorNode
                );
            } else if (containsUnknown(simplifiedType, true)) {
                // Don't report an error if the type is a partially-specialized
                // class. This comes up frequently in cases where a type is passed
                // as an argument (e.g. "defaultdict(list)").

                // If the parameter type is also partially unknown, don't report
                // the error because it's likely that the partially-unknown type
                // arose due to bidirectional type matching.
                if (!containsUnknown(argParam.paramType) && simplifiedType.category !== TypeCategory.Class) {
                    const diagAddendum = new DiagnosticAddendum();
                    diagAddendum.addMessage(`Argument type is '${printType(simplifiedType)}'`);
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUnknownArgumentType,
                        DiagnosticRule.reportUnknownArgumentType,
                        `Type of argument is partially unknown` + diagAddendum.getString(),
                        argParam.errorNode
                    );
                }
            }
        }

        return true;
    }

    function createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';
        if (argList.length === 0) {
            addError('Expected name of type var', errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map(s => s.value).join('');
        } else {
            addError('Expected name of type var as first parameter', firstArg.valueExpression || errorNode);
        }

        const typeVar = TypeVarType.create(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.value : undefined;
            const paramNameMap = new Map<string, string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    addError(
                        `Duplicate parameter name '${paramName}' not allowed`,
                        argList[i].valueExpression || errorNode
                    );
                }

                if (paramName === 'bound') {
                    if (typeVar.constraints.length > 0) {
                        addError(
                            `A TypeVar cannot be both bound and constrained`,
                            argList[i].valueExpression || errorNode
                        );
                    } else {
                        const argType = getTypeForArgument(argList[i], true);
                        if (requiresSpecialization(argType)) {
                            addError(`A TypeVar bound type cannot be generic`, argList[i].valueExpression || errorNode);
                        }
                        typeVar.boundType = convertClassToObject(argType);
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!
                            );
                        } else {
                            typeVar.isCovariant = true;
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!
                            );
                        } else {
                            typeVar.isContravariant = true;
                        }
                    }
                } else {
                    addError(`'${paramName}' is unknown parameter to TypeVar`, argList[i].valueExpression || errorNode);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.boundType) {
                    addError(`A TypeVar cannot be both bound and constrained`, argList[i].valueExpression || errorNode);
                } else {
                    const argType = getTypeForArgument(argList[i], true);
                    if (requiresSpecialization(argType)) {
                        addError(
                            `A TypeVar constraint type cannot be generic`,
                            argList[i].valueExpression || errorNode
                        );
                    }
                    TypeVarType.addConstraint(typeVar, convertClassToObject(argType));
                }
            }
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

        addError('Expected True or False', node);
        return false;
    }

    // Creates a new custom enum class with named values.
    function createEnumType(errorNode: ExpressionNode, enumClass: ClassType, argList: FunctionArgument[]): ClassType {
        let className = 'enum';
        if (argList.length === 0) {
            addError('Expected enum class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError('Expected enum class name as first parameter', argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.EnumClass, errorNode.id);
        classType.details.baseClasses.push(enumClass);
        computeMroLinearization(classType);

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        if (argList.length < 2) {
            addError('Expected enum item string as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (
                entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                !entriesArg.valueExpression ||
                entriesArg.valueExpression.nodeType !== ParseNodeType.StringList
            ) {
                addError('Expected enum item string as second parameter', errorNode);
            } else {
                const entries = entriesArg.valueExpression.strings
                    .map(s => s.value)
                    .join('')
                    .split(' ');
                entries.forEach(entryName => {
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
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: stringNode as StringListNode,
                            path: getFileInfo(errorNode).filePath,
                            range: convertOffsetsToRange(
                                stringNode.start,
                                TextRange.getEnd(stringNode),
                                getFileInfo(errorNode).lines
                            )
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
        let className = '_';
        if (argList.length >= 1) {
            const nameArg = argList[0];
            if (nameArg.argumentCategory === ArgumentCategory.Simple) {
                if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                    className = nameArg.valueExpression.strings.map(s => s.value).join('');
                }
            }
        }

        if (argList.length >= 2) {
            const baseClass = getTypeForArgument(argList[1], true);

            if (baseClass.category === TypeCategory.Class) {
                const classFlags =
                    baseClass.details.flags & ~(ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn);
                const classType = ClassType.create(className, classFlags, errorNode.id);
                classType.details.baseClasses.push(baseClass);
                computeMroLinearization(classType);
                return classType;
            }
        }

        return undefined;
    }

    // Implements the semantics of the multi-parameter variant of the "type" call.
    function createType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
        const arg0Type = getTypeForArgument(argList[0]);
        if (arg0Type.category !== TypeCategory.Object || !ClassType.isBuiltIn(arg0Type.classType, 'str')) {
            addError('Expected name of type as first argument', argList[0].valueExpression || errorNode);
            return undefined;
        }
        const className = (arg0Type.literalValue as string) || '_';

        const arg1Type = getTypeForArgument(argList[1]);
        if (
            arg1Type.category !== TypeCategory.Object ||
            !ClassType.isBuiltIn(arg1Type.classType, 'Tuple') ||
            arg1Type.classType.typeArguments === undefined
        ) {
            addError('Expected tuple of base class types as second argument', argList[1].valueExpression || errorNode);
            return undefined;
        }

        const classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);
        arg1Type.classType.typeArguments.forEach(baseClass => {
            if (baseClass.category === TypeCategory.Class || isAnyOrUnknown(baseClass)) {
                classType.details.baseClasses.push(baseClass);
            } else {
                addError(
                    `Expected class type but received ${printType(baseClass)}`,
                    argList[1].valueExpression || errorNode
                );
            }
        });

        if (!computeMroLinearization(classType)) {
            addError('Cannot create consistent method ordering', errorNode);
        }

        return classType;
    }

    // Creates a new custom TypedDict factory class.
    // Supports both typed and untyped variants.
    function createTypedDictType(
        errorNode: ExpressionNode,
        typedDictClass: ClassType,
        argList: FunctionArgument[]
    ): ClassType {
        let className = 'TypedDict';
        if (argList.length === 0) {
            addError('Expected TypedDict class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (
                nameArg.argumentCategory !== ArgumentCategory.Simple ||
                !nameArg.valueExpression ||
                nameArg.valueExpression.nodeType !== ParseNodeType.StringList
            ) {
                addError('Expected TypedDict class name as first parameter', argList[0].valueExpression || errorNode);
            } else {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.TypedDictClass, errorNode.id);
        classType.details.baseClasses.push(typedDictClass);
        computeMroLinearization(classType);

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
                addError(
                    `Expected 'total' parameter to have a value of 'True' or 'False'`,
                    argList[2].valueExpression || errorNode
                );
            } else if (argList[2].valueExpression.constType === KeywordType.False) {
                classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
            }
        }

        if (argList.length > 3) {
            addError('Extra TypedDict arguments not supported', argList[3].valueExpression || errorNode);
        }

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        if (argList.length < 2) {
            addError('Expected dict as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (
                entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                !entriesArg.valueExpression ||
                entriesArg.valueExpression.nodeType !== ParseNodeType.Dictionary
            ) {
                addError('Expected dict as second parameter', errorNode);
            } else {
                const entryDict = entriesArg.valueExpression;
                const entryMap = new Map<string, boolean>();

                entryDict.entries.forEach(entry => {
                    if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                        addError('Expected simple dictionary entry', entry);
                        return;
                    }

                    if (entry.keyExpression.nodeType !== ParseNodeType.StringList) {
                        addError('Expected string literal for entry name', entry.keyExpression);
                        return;
                    }

                    const entryName = entry.keyExpression.strings.map(s => s.value).join('');
                    if (!entryName) {
                        addError('Names within a TypedDict cannot be empty', entry.keyExpression);
                        return;
                    }

                    if (entryMap.get(entryName)) {
                        addError('Names within a named tuple must be unique', entry.keyExpression);
                        return;
                    }

                    // Record names in a map to detect duplicates.
                    entryMap.set(entryName, true);

                    // Cache the annotation type.
                    getTypeOfAnnotation(entry.valueExpression);

                    const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: entry.keyExpression,
                        path: getFileInfo(errorNode).filePath,
                        typeAnnotationNode: entry.valueExpression,
                        range: convertOffsetsToRange(
                            entry.keyExpression.start,
                            TextRange.getEnd(entry.keyExpression),
                            getFileInfo(errorNode).lines
                        )
                    };
                    newSymbol.addDeclaration(declaration);

                    classFields.set(entryName, newSymbol);
                });
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
        let className = 'namedtuple';
        if (argList.length === 0) {
            addError('Expected named tuple class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError('Expected named tuple class name as first parameter', argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);
        const builtInNamedTuple = getTypingType(errorNode, 'NamedTuple') || UnknownType.create();
        classType.details.baseClasses.push(builtInNamedTuple);
        computeMroLinearization(classType);

        const classFields = classType.details.fields;
        classFields.set(
            '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
        );

        const builtInTupleType = getBuiltInType(errorNode, 'Tuple');
        if (builtInTupleType.category === TypeCategory.Class) {
            const constructorType = FunctionType.create(
                FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
            );
            constructorType.details.declaredReturnType = ObjectType.create(classType);
            if (ParseTreeUtils.isAssignmentToDefaultsFollowingNamedTuple(errorNode)) {
                constructorType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
            }
            FunctionType.addParameter(constructorType, {
                category: ParameterCategory.Simple,
                name: 'cls',
                type: classType
            });

            const selfParameter: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'self',
                type: ObjectType.create(classType)
            };

            let addGenericGetAttribute = false;

            if (argList.length < 2) {
                addError('Expected named tuple entry list as second parameter', errorNode);
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
                            .map(s => s.value)
                            .join('')
                            .split(/[,\s]+/);
                        entries.forEach(entryName => {
                            entryName = entryName.trim();
                            if (entryName) {
                                const entryType = UnknownType.create();
                                const paramInfo: FunctionParameter = {
                                    category: ParameterCategory.Simple,
                                    name: entryName,
                                    type: entryType
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
                                    path: getFileInfo(errorNode).filePath,
                                    range: convertOffsetsToRange(
                                        stringNode.start,
                                        TextRange.getEnd(stringNode),
                                        getFileInfo(errorNode).lines
                                    )
                                };
                                newSymbol.addDeclaration(declaration);
                                classFields.set(entryName, newSymbol);
                            }
                        });
                    } else if (
                        entriesArg.valueExpression &&
                        entriesArg.valueExpression.nodeType === ParseNodeType.List
                    ) {
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
                                        EvaluatorFlags.EvaluateStringLiteralAsType
                                    );
                                    if (entryTypeInfo) {
                                        entryType = convertClassToObject(entryTypeInfo.type);
                                    }
                                } else {
                                    addError('Expected two-entry tuple specifying entry name and type', entry);
                                }
                            } else {
                                entryNameNode = entry;
                                entryType = UnknownType.create();
                            }

                            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                                entryName = entryNameNode.strings.map(s => s.value).join('');
                                if (!entryName) {
                                    addError('Names within a named tuple cannot be empty', entryNameNode);
                                }
                            } else {
                                addError('Expected string literal for entry name', entryNameNode || entry);
                            }

                            if (!entryName) {
                                entryName = `_${index.toString()}`;
                            }

                            if (entryMap.has(entryName)) {
                                addError('Names within a named tuple must be unique', entryNameNode || entry);
                            }

                            // Record names in a map to detect duplicates.
                            entryMap.set(entryName, entryName);

                            if (!entryType) {
                                entryType = UnknownType.create();
                            }

                            const paramInfo: FunctionParameter = {
                                category: ParameterCategory.Simple,
                                name: entryName,
                                type: entryType
                            };

                            FunctionType.addParameter(constructorType, paramInfo);

                            const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
                            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                                const declaration: VariableDeclaration = {
                                    type: DeclarationType.Variable,
                                    node: entryNameNode,
                                    path: getFileInfo(errorNode).filePath,
                                    typeAnnotationNode: entryTypeNode,
                                    range: convertOffsetsToRange(
                                        entryNameNode.start,
                                        TextRange.getEnd(entryNameNode),
                                        getFileInfo(errorNode).lines
                                    )
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
                addDefaultFunctionParameters(constructorType);
            }

            // Always use generic parameters for __init__. The __new__ method
            // will handle property type checking. We may need to disable default
            // parameter processing for __new__ (see isAssignmentToDefaultsFollowingNamedTuple),
            // and we don't want to do it for __init__ as well.
            const initType = FunctionType.create(
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.SkipConstructorCheck
            );
            FunctionType.addParameter(initType, selfParameter);
            addDefaultFunctionParameters(initType);
            initType.details.declaredReturnType = NoneType.create();

            classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
            classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

            const keysItemType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
            keysItemType.details.declaredReturnType = getBuiltInObject(errorNode, 'list', [
                getBuiltInObject(errorNode, 'str')
            ]);
            classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
            classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));

            const lenType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
            lenType.details.declaredReturnType = getBuiltInObject(errorNode, 'int');
            FunctionType.addParameter(lenType, selfParameter);
            classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

            if (addGenericGetAttribute) {
                const getAttribType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
                getAttribType.details.declaredReturnType = AnyType.create();
                FunctionType.addParameter(getAttribType, selfParameter);
                FunctionType.addParameter(getAttribType, {
                    category: ParameterCategory.Simple,
                    name: 'name',
                    type: getBuiltInObject(errorNode, 'str')
                });
                classFields.set('__getattribute__', Symbol.createWithType(SymbolFlags.ClassMember, getAttribType));
            }
        }

        return classType;
    }

    function getTypeFromConstant(node: ConstantNode): TypeResult | undefined {
        let type: Type | undefined;

        if (node.constType === KeywordType.None) {
            type = NoneType.create();
        } else if (
            node.constType === KeywordType.True ||
            node.constType === KeywordType.False ||
            node.constType === KeywordType.Debug
        ) {
            type = getBuiltInObject(node, 'bool');

            // For True and False, we can create truthy and falsy
            // versions of 'bool'.
            if (type && type.category === TypeCategory.Object) {
                if (node.constType === KeywordType.True) {
                    type = ObjectType.cloneWithLiteral(type, true);
                } else if (node.constType === KeywordType.False) {
                    type = ObjectType.cloneWithLiteral(type, false);
                }
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    function getTypeFromUnaryOperation(node: UnaryOperationNode): TypeResult {
        let exprType = getTypeOfExpression(node.expression).type;
        if (exprType.category === TypeCategory.TypeVar) {
            exprType = specializeType(exprType, undefined);
        }

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '__pos__',
            [OperatorType.Subtract]: '__neg__',
            [OperatorType.BitwiseInvert]: '__invert__'
        };

        let type: Type | undefined;

        if (node.operator !== OperatorType.Not) {
            if (isOptionalType(exprType)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticSettings.reportOptionalOperand,
                    DiagnosticRule.reportOptionalOperand,
                    `Operator '${ParseTreeUtils.printOperator(node.operator)}' not ` + `supported for 'None' type`,
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
                type = getTypeFromMagicMethodReturn(exprType, [], magicMethodName, node);
            }

            if (!type) {
                addError(
                    `Operator '${ParseTreeUtils.printOperator(node.operator)}'` +
                        ` not supported for type '${printType(exprType)}'`,
                    node
                );
                type = UnknownType.create();
            }
        }

        return { type, node };
    }

    function getTypeFromBinaryOperation(node: BinaryOperationNode): TypeResult {
        let leftExpression = node.leftExpression;

        // If this is a comparison and the left expression is also a comparison,
        // we need to change the behavior to accommodate python's "chained
        // comparisons" feature.
        if (comparisonOperatorMap[node.operator]) {
            if (
                node.leftExpression.nodeType === ParseNodeType.BinaryOperation &&
                comparisonOperatorMap[node.leftExpression.operator]
            ) {
                leftExpression = node.leftExpression.rightExpression;
            }
        }

        let leftType = getTypeOfExpression(leftExpression).type;
        if (leftType.category === TypeCategory.TypeVar) {
            leftType = specializeType(leftType, undefined);
        }
        let rightType = getTypeOfExpression(node.rightExpression).type;
        if (rightType.category === TypeCategory.TypeVar) {
            rightType = specializeType(rightType, undefined);
        }

        // Optional checks apply to all operations except for boolean operations.
        if (booleanOperatorMap[node.operator] === undefined) {
            if (isOptionalType(leftType)) {
                // Skip the optional error reporting for == and !=, since
                // None is a valid operand for these operators.
                if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticSettings.reportOptionalOperand,
                        DiagnosticRule.reportOptionalOperand,
                        `Operator '${ParseTreeUtils.printOperator(node.operator)}' not ` + `supported for 'None' type`,
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
            type: validateBinaryOperation(node.operator, leftType, rightType, node),
            node
        };
    }

    function getTypeFromAugmentedAssignment(node: AugmentedAssignmentNode): Type {
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
            [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift]
        };

        let type: Type | undefined;

        // Don't write to the cache when we evaluate the left-hand side.
        // We'll write the result as part of the "set" method.
        let leftType: Type | undefined;
        useSpeculativeMode(() => {
            leftType = getTypeOfExpression(node.leftExpression).type;
        });
        if (leftType!.category === TypeCategory.TypeVar) {
            leftType = specializeType(leftType!, undefined);
        }

        let rightType = getTypeOfExpression(node.rightExpression).type;
        if (rightType.category === TypeCategory.TypeVar) {
            rightType = specializeType(rightType, undefined);
        }

        type = doForSubtypes(leftType!, leftSubtype => {
            return doForSubtypes(rightType, rightSubtype => {
                if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                    // If either type is "Unknown" (versus Any), propagate the Unknown.
                    if (
                        leftSubtype.category === TypeCategory.Unknown ||
                        rightSubtype.category === TypeCategory.Unknown
                    ) {
                        return UnknownType.create();
                    } else {
                        return AnyType.create();
                    }
                }

                const magicMethodName = operatorMap[node.operator][0];
                return getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype], magicMethodName, node);
            });
        });

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type || type.category === TypeCategory.Never) {
            const binaryOperator = operatorMap[node.operator][1];
            type = validateBinaryOperation(binaryOperator, leftType!, rightType, node);
        }

        return type;
    }

    function validateBinaryOperation(
        operator: OperatorType,
        leftType: Type,
        rightType: Type,
        errorNode: ExpressionNode
    ): Type {
        let type: Type | undefined;

        if (arithmeticOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (
                            leftSubtype.category === TypeCategory.Unknown ||
                            rightSubtype.category === TypeCategory.Unknown
                        ) {
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
                        errorNode
                    );
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = arithmeticOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(rightSubtype, [leftSubtype], altMagicMethodName, errorNode);
                });
            });
        } else if (bitwiseOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (
                            leftSubtype.category === TypeCategory.Unknown ||
                            rightSubtype.category === TypeCategory.Unknown
                        ) {
                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    // Handle the general case.
                    const magicMethodName = bitwiseOperatorMap[operator][0];
                    return getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype], magicMethodName, errorNode);
                });
            });
        } else if (comparisonOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (
                            leftSubtype.category === TypeCategory.Unknown ||
                            rightSubtype.category === TypeCategory.Unknown
                        ) {
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
                        errorNode
                    );
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = comparisonOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(rightSubtype, [leftSubtype], altMagicMethodName, errorNode);
                });
            });
        } else if (booleanOperatorMap[operator]) {
            // If it's an AND or OR, we need to handle short-circuiting by
            // eliminating any known-truthy or known-falsy types.
            if (operator === OperatorType.And) {
                leftType = removeTruthinessFromType(leftType);
            } else if (operator === OperatorType.Or) {
                leftType = removeFalsinessFromType(leftType);
            }

            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    // If the operator is an AND or OR, we need to combine the two types.
                    if (operator === OperatorType.And || operator === OperatorType.Or) {
                        return combineTypes([leftSubtype, rightSubtype]);
                    }
                    // The other boolean operators always return a bool value.
                    return getBuiltInObject(errorNode, 'bool');
                });
            });
        }

        if (!type || type.category === TypeCategory.Never) {
            addError(
                `Operator '${ParseTreeUtils.printOperator(operator)}' not ` +
                    `supported for types '${printType(leftType)}' and '${printType(rightType)}'`,
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
        errorNode: ExpressionNode
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
                const functionArgs = args.map(arg => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg
                    };
                });

                let callResult: CallResult | undefined;

                useSpeculativeMode(() => {
                    callResult = validateCallArguments(
                        errorNode,
                        functionArgs,
                        magicMethodType,
                        new TypeVarMap(),
                        true
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

        const returnType = doForSubtypes(objType, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (subtype.category === TypeCategory.Object) {
                return handleObjectSubtype(subtype);
            } else if (subtype.category === TypeCategory.Class) {
                // See if the class has a metaclass that handles the operation.
                const metaclass = getMetaclass(subtype);
                if (metaclass && metaclass.category === TypeCategory.Class) {
                    return handleObjectSubtype(ObjectType.create(metaclass), subtype);
                }
            } else if (isNoneOrNever(subtype)) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = getBuiltInObject(errorNode, 'object');
                if (obj.category === TypeCategory.Object) {
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

    function getTypeFromSet(node: SetNode, expectedType?: Type): TypeResult {
        const entryTypes = node.entries.map(entryNode => {
            if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                return getElementTypeFromListComprehension(entryNode);
            }
            return getTypeOfExpression(entryNode).type;
        });

        // If there is an expected type, see if we can match it.
        if (expectedType && entryTypes.length > 0) {
            const narrowedExpectedType = doForSubtypes(expectedType, subtype => {
                if (subtype.category === TypeCategory.Object) {
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

            if (narrowedExpectedType.category !== TypeCategory.Never) {
                return { type: narrowedExpectedType, node };
            }
        }

        const inferredEntryType =
            entryTypes.length > 0 ? combineTypes(entryTypes.map(t => stripLiteralValue(t))) : AnyType.create();

        const type = getBuiltInObject(node, 'set', [inferredEntryType]);

        return { type, node };
    }

    function getTypeFromDictionary(node: DictionaryNode, expectedType?: Type): TypeResult {
        let keyType: Type = AnyType.create();
        let valueType: Type = AnyType.create();

        let keyTypes: Type[] = [];
        let valueTypes: Type[] = [];

        let expectedKeyType: Type | undefined;
        let expectedValueType: Type | undefined;
        let expectedTypedDictEntries: Map<string, TypedDictEntry> | undefined;

        if (expectedType && expectedType.category === TypeCategory.Object) {
            const expectedClass = expectedType.classType;
            if (ClassType.isBuiltIn(expectedClass, 'Dict') || ClassType.isBuiltIn(expectedClass, 'dict')) {
                if (expectedClass.typeArguments && expectedClass.typeArguments.length === 2) {
                    expectedKeyType = specializeType(expectedClass.typeArguments[0], undefined);
                    expectedValueType = specializeType(expectedClass.typeArguments[1], undefined);
                }
            } else if (ClassType.isTypedDictClass(expectedClass)) {
                expectedTypedDictEntries = getTypedDictMembersForClass(expectedClass);
            }
        }

        // Infer the key and value types if possible.
        node.entries.forEach(entryNode => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                const keyType = getTypeOfExpression(entryNode.keyExpression, expectedKeyType).type;
                let valueType: Type | undefined;

                if (
                    expectedTypedDictEntries &&
                    keyType.category === TypeCategory.Object &&
                    ClassType.isBuiltIn(keyType.classType, 'str') &&
                    keyType.literalValue &&
                    expectedTypedDictEntries.has(keyType.literalValue as string)
                ) {
                    valueType = getTypeOfExpression(
                        entryNode.valueExpression,
                        expectedTypedDictEntries.get(keyType.literalValue as string)!.valueType
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
                    if (unexpandedType.category === TypeCategory.Object) {
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
                const dictEntryType = getElementTypeFromListComprehension(node.entries[0] as ListComprehensionNode);

                // The result should be a Tuple
                if (dictEntryType.category === TypeCategory.Object) {
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
            const narrowedExpectedType = doForSubtypes(expectedType, subtype => {
                if (subtype.category !== TypeCategory.Object) {
                    return undefined;
                }

                if (
                    ClassType.isTypedDictClass(subtype.classType) &&
                    canAssignToTypedDict(subtype.classType, keyTypes, valueTypes)
                ) {
                    return subtype;
                }

                const classAlias = subtype.classType.details.aliasClass || subtype.classType;
                if (ClassType.isBuiltIn(classAlias, 'dict') && subtype.classType.typeArguments) {
                    const typeArg0 = subtype.classType.typeArguments[0];
                    const typeArg1 = subtype.classType.typeArguments[1];
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

            if (narrowedExpectedType.category !== TypeCategory.Never) {
                return { type: narrowedExpectedType, node };
            }
        }

        // Strip any literal values.
        keyTypes = keyTypes.map(t => stripLiteralValue(t));
        valueTypes = valueTypes.map(t => stripLiteralValue(t));

        keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : AnyType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (getFileInfo(node).diagnosticSettings.strictDictionaryInference) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = areTypesSame(valueTypes) ? valueTypes[0] : UnknownType.create();
            }
        } else {
            valueType = AnyType.create();
        }

        const type = getBuiltInObject(node, 'dict', [keyType, valueType]);

        return { type, node };
    }

    function getTypeFromList(node: ListNode, expectedType?: Type): TypeResult {
        // Define a local helper function that determines whether a
        // type is a list and returns the list element type if it is.
        const getListTypeArg = (potentialList: Type) => {
            if (potentialList.category !== TypeCategory.Object) {
                return undefined;
            }

            const classAlias = potentialList.classType.details.aliasClass || potentialList.classType;
            if (!ClassType.isBuiltIn(classAlias, 'list') || !potentialList.classType.typeArguments) {
                return undefined;
            }

            return potentialList.classType.typeArguments[0];
        };

        const expectedEntryType = expectedType ? getListTypeArg(expectedType) : undefined;

        let entryTypes = node.entries.map(entry => {
            if (entry.nodeType === ParseNodeType.ListComprehension) {
                return getElementTypeFromListComprehension(entry);
            }
            return getTypeOfExpression(entry, expectedEntryType).type;
        });

        // If there is an expected type, see if we can match it.
        if (expectedType && entryTypes.length > 0) {
            const narrowedExpectedType = doForSubtypes(expectedType, subtype => {
                const listElementType = getListTypeArg(subtype);
                if (listElementType) {
                    const typeVarMap = new TypeVarMap();

                    for (const entryType of entryTypes) {
                        if (!canAssignType(listElementType, entryType, new DiagnosticAddendum(), typeVarMap)) {
                            return undefined;
                        }
                    }

                    return specializeType(subtype, typeVarMap);
                }

                return undefined;
            });

            if (narrowedExpectedType.category !== TypeCategory.Never) {
                return { type: narrowedExpectedType, node };
            }
        }

        entryTypes = entryTypes.map(t => stripLiteralValue(t));

        let inferredEntryType: Type = AnyType.create();
        if (entryTypes.length > 0) {
            // If there was an expected type or we're using strict list inference,
            // combine the types into a union.
            if (expectedType || getFileInfo(node).diagnosticSettings.strictListInference) {
                inferredEntryType = combineTypes(entryTypes);
            } else {
                // Is the list homogeneous? If so, use stricter rules. Otherwise relax the rules.
                inferredEntryType = areTypesSame(entryTypes) ? entryTypes[0] : UnknownType.create();
            }
        }

        const type = getBuiltInObject(node, 'list', [inferredEntryType]);

        return { type, node };
    }

    function getTypeFromTernary(node: TernaryNode, flags: EvaluatorFlags): TypeResult {
        getTypeOfExpression(node.testExpression);

        const ifType = getTypeOfExpression(node.ifExpression, undefined, flags);
        const elseType = getTypeOfExpression(node.elseExpression, undefined, flags);

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

    function getTypeFromLambda(node: LambdaNode, expectedType?: Type): TypeResult {
        const functionType = FunctionType.create(FunctionTypeFlags.None);

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
                    t => t.category === TypeCategory.Function
                ) as FunctionType;
            }
        }

        node.parameters.forEach((param, index) => {
            let paramType: Type = UnknownType.create();
            if (expectedFunctionType && index < expectedFunctionType.details.parameters.length) {
                paramType = FunctionType.getEffectiveParameterType(expectedFunctionType, index);
                paramType = specializeType(paramType, undefined, true);
            }

            if (param.name) {
                writeTypeCache(param.name, paramType);
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.value : undefined,
                hasDefault: !!param.defaultValue,
                type: paramType
            };
            FunctionType.addParameter(functionType, functionParam);
        });

        functionType.inferredReturnType = getTypeOfExpression(node.expression).type;

        return { type: functionType, node };
    }

    function getTypeFromListComprehension(node: ListComprehensionNode): TypeResult {
        const elementType = getElementTypeFromListComprehension(node);

        let type: Type = UnknownType.create();
        const builtInIteratorType = getTypingType(node, 'Generator');

        if (builtInIteratorType && builtInIteratorType.category === TypeCategory.Class) {
            type = ObjectType.create(ClassType.cloneForSpecialization(builtInIteratorType, [elementType]));
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

        if (simplifiedType.category === TypeCategory.Unknown) {
            addDiagnostic(diagLevel, rule, `Type of '${nameValue}' is unknown`, errorNode);
        } else if (containsUnknown(simplifiedType)) {
            const diagAddendum = new DiagnosticAddendum();
            diagAddendum.addMessage(`Type of ${nameValue} is '${printType(simplifiedType)}'`);
            addDiagnostic(
                diagLevel,
                rule,
                `Type of '${nameValue}' is partially unknown` + diagAddendum.getString(),
                errorNode
            );
        }
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    function getElementTypeFromListComprehension(node: ListComprehensionNode): Type {
        // "Execute" the list comprehensions from start to finish.
        for (const comprehension of node.comprehensions) {
            if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                const iterableType = stripLiteralValue(getTypeOfExpression(comprehension.iterableExpression).type);
                const itemType = getTypeFromIterable(
                    iterableType,
                    !!comprehension.isAsync,
                    comprehension.iterableExpression,
                    false
                );

                const targetExpr = comprehension.targetExpression;
                assignTypeToExpression(targetExpr, itemType, comprehension.iterableExpression);
            } else {
                assert(comprehension.nodeType === ParseNodeType.ListComprehensionIf);

                // Evaluate the test expression to validate it and mark symbols
                // as referenced. Don't bother doing this if we're in speculative
                // mode because it doesn't affect the element type.
                if (!isSpeculativeMode()) {
                    getTypeOfExpression(comprehension.testExpression);
                }
            }
        }

        let type: Type = UnknownType.create();
        if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
            // Create a tuple with the key/value types.
            const keyType = stripLiteralValue(getTypeOfExpression(node.expression.keyExpression).type);
            const valueType = stripLiteralValue(getTypeOfExpression(node.expression.valueExpression).type);

            type = getBuiltInObject(node, 'Tuple', [keyType, valueType]);
        } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
            getTypeOfExpression(node.expression.expandExpression);

            // TODO - need to implement
        } else if (isExpressionNode(node)) {
            type = stripLiteralValue(getTypeOfExpression(node.expression as ExpressionNode).type);
        }

        return type;
    }

    function getTypeFromSlice(node: SliceNode): TypeResult {
        const intObject = getBuiltInObject(node, 'int');
        const optionalIntObject = combineTypes([intObject, NoneType.create()]);

        const validateIndexType = (indexExpr: ExpressionNode) => {
            const exprType = stripLiteralValue(getTypeOfExpression(indexExpr).type);

            const diag = new DiagnosticAddendum();
            if (!canAssignType(optionalIntObject, exprType, diag)) {
                addError(`Index for slice operation must be an int value or None` + diag.getString(), indexExpr);
            }
        };

        // Validate the index values.
        if (node.startValue) {
            validateIndexType(node.startValue);
        }

        if (node.endValue) {
            validateIndexType(node.endValue);
        }

        if (node.stepValue) {
            validateIndexType(node.stepValue);
        }

        const sliceObject = getBuiltInObject(node, 'slice');
        return { type: sliceObject, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    function createCallableType(typeArgs?: TypeResult[]): FunctionType {
        const functionType = FunctionType.create(FunctionTypeFlags.None);
        functionType.details.declaredReturnType = AnyType.create();

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    if (isEllipsisType(entry.type)) {
                        addError(`'...' not allowed in this context`, entry.node);
                    } else if (entry.type.category === TypeCategory.Module) {
                        addError(`Module not allowed in this context`, entry.node);
                    }

                    FunctionType.addParameter(functionType, {
                        category: ParameterCategory.Simple,
                        name: `p${index.toString()}`,
                        isNameSynthesized: true,
                        type: convertClassToObject(entry.type)
                    });
                });
            } else if (isEllipsisType(typeArgs[0].type)) {
                addDefaultFunctionParameters(functionType);
            } else {
                addError(`Expected parameter type list or '...'`, typeArgs[0].node);
            }
        } else {
            addDefaultFunctionParameters(functionType);
        }

        if (typeArgs && typeArgs.length > 1) {
            if (isEllipsisType(typeArgs[1].type)) {
                addError(`'...' not allowed in this context`, typeArgs[1].node);
            } else if (typeArgs[1].type.category === TypeCategory.Module) {
                addError(`Module not allowed in this context`, typeArgs[1].node);
            }
            functionType.details.declaredReturnType = convertClassToObject(typeArgs[1].type);
        } else {
            functionType.details.declaredReturnType = AnyType.create();
        }

        if (typeArgs && typeArgs.length > 2) {
            addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional[X, Y, Z] type.
    function createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        if (isEllipsisType(typeArgs[0].type)) {
            addError(`'...' not allowed in this context`, typeArgs[0].node);
        } else if (typeArgs[0].type.category === TypeCategory.Module) {
            addError(`Module not allowed in this context`, typeArgs[0].node);
        }

        return combineTypes([typeArgs[0].type, NoneType.create()]);
    }

    function cloneBuiltinTypeWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        let type = getBuiltInObject(node, builtInName);
        if (type.category === TypeCategory.Object) {
            type = ObjectType.cloneWithLiteral(type, value);
        }

        return type;
    }

    // Creates a type that represents a Literal. This is not an officially-supported
    // feature of Python but is instead a mypy extension described here:
    // https://mypy.readthedocs.io/en/latest/literal_types.html
    function createLiteralType(node: IndexNode): Type {
        if (node.items.items.length === 0) {
            addError(`Expected a type parameter after Literal`, node.baseExpression);
            return UnknownType.create();
        }

        // As per the specification, we support None, int, bool, str, and bytes literals.
        const literalTypes: Type[] = [];

        for (const item of node.items.items) {
            let type: Type | undefined;

            if (item.nodeType === ParseNodeType.StringList) {
                const isBytes = (item.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                const value = item.strings.map(s => s.value).join('');
                if (isBytes) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bytes', value);
                } else {
                    type = cloneBuiltinTypeWithLiteral(node, 'str', value);
                }
            } else if (item.nodeType === ParseNodeType.Number) {
                if (!item.isImaginary && item.isInteger) {
                    type = cloneBuiltinTypeWithLiteral(node, 'int', item.value);
                }
            } else if (item.nodeType === ParseNodeType.Constant) {
                if (item.constType === KeywordType.True) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bool', true);
                } else if (item.constType === KeywordType.False) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bool', false);
                } else if (item.constType === KeywordType.None) {
                    type = NoneType.create();
                }
            }

            if (!type) {
                addError(`Type arguments for Literal must be None, int, bool, str, or bytes value`, item);
                type = UnknownType.create();
            }

            literalTypes.push(type);
        }

        return convertClassToObject(combineTypes(literalTypes));
    }

    // Creates a ClassVar type.
    function createClassVarType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            addError(`Expected a type argument after ClassVar`, errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            addError(`Expected only one type argument after ClassVar`, typeArgs[1].node);
            return UnknownType.create();
        }

        let type = typeArgs[0].type;

        if (requiresSpecialization(type)) {
            // A ClassVar should not allow generic types, but the typeshed
            // stubs use this in a few cases. For now, just specialize
            // it in a general way.
            type = specializeType(type, undefined);
        }

        return convertClassToObject(type);
    }

    // Creates a "Final" type.
    function createFinalType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            return AnyType.create();
        }

        if (typeArgs.length > 1) {
            addError(`Expected a single type argument after Final`, errorNode);
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
        allowEllipsis = false
    ): Type {
        if (typeArgs) {
            // Verify that we didn't receive any inappropriate ellipses or modules.
            typeArgs.forEach((typeArg, index) => {
                if (isEllipsisType(typeArg.type)) {
                    if (!allowEllipsis) {
                        addError(`'...' not allowed in this context`, typeArgs[index].node);
                    } else if (typeArgs.length !== 2 || index !== 1) {
                        addError(`'...' allowed only as the second of two arguments`, typeArgs[index].node);
                    }
                    if (typeArg.type.category === TypeCategory.Module) {
                        addError(`Module not allowed in this context`, typeArg.node);
                    }
                }
            });
        }

        let typeArgTypes = typeArgs ? typeArgs.map(t => convertClassToObject(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                addError(
                    `Expected at most ${paramLimit} type ` + `${paramLimit === 1 ? 'argument' : 'arguments'}`,
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

        // If no type args are provided and ellipses are allowed,
        // default to [Any, ...]. For example, Tuple is equivalent
        // to Tuple[Any, ...].
        if (!typeArgs && allowEllipsis) {
            typeArgTypes.push(AnyType.create(false));
            typeArgTypes.push(AnyType.create(true));
        }

        const specializedType = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedType;
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    function createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                types.push(typeArg.type);

                // Verify that we didn't receive any inappropriate ellipses.
                if (isEllipsisType(typeArg.type)) {
                    addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    addError(`Module not allowed in this context`, typeArg.node);
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
            addError(`'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                if (!(typeArg.type.category === TypeCategory.TypeVar)) {
                    addError(`Type argument for 'Generic' must be a type variable`, typeArg.node);
                } else {
                    for (const typeVar of uniqueTypeVars) {
                        if (typeVar === typeArg.type) {
                            addError(`Type argument for 'Generic' must be unique`, typeArg.node);
                            break;
                        }
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return createSpecialType(classType, typeArgs);
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
                    if (builtInEnumClasses.find(c => c === className)) {
                        return typeOfExpr;
                    }
                }

                return ObjectType.create(enumClassInfo.classType);
            }
        }

        return typeOfExpr;
    }

    function createSpecialBuiltInClass(node: ParseNode, assignedName: string, aliasMapEntry: AliasMapEntry): ClassType {
        const specialClassType = ClassType.create(
            assignedName,
            ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
            node.id
        );

        const baseClassName = aliasMapEntry.alias ? aliasMapEntry.alias : 'object';

        let aliasClass: Type | undefined;
        if (aliasMapEntry.module === 'builtins') {
            aliasClass = getBuiltInType(node, baseClassName);
        } else if (aliasMapEntry.module === 'collections') {
            // The typing.pyi file imports collections.
            const fileInfo = getFileInfo(node);
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
            const symbolWithScope = lookUpSymbolRecursive(node, baseClassName);
            if (symbolWithScope) {
                aliasClass = getEffectiveTypeOfSymbol(symbolWithScope.symbol);
            }
        }

        if (
            aliasClass &&
            aliasClass.category === TypeCategory.Class &&
            specialClassType.category === TypeCategory.Class
        ) {
            specialClassType.details.baseClasses.push(aliasClass);

            if (aliasMapEntry.alias) {
                specialClassType.details.aliasClass = aliasClass;
            }
        } else {
            specialClassType.details.baseClasses.push(UnknownType.create());
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
            TypedDict: { alias: '_TypedDict', module: 'self' }
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
            Union: { alias: '', module: 'builtins' },
            Optional: { alias: '', module: 'builtins' },
            List: { alias: 'list', module: 'builtins' },
            Dict: { alias: 'dict', module: 'builtins' },
            DefaultDict: { alias: 'defaultdict', module: 'collections' },
            Set: { alias: 'set', module: 'builtins' },
            FrozenSet: { alias: 'frozenset', module: 'builtins' },
            Deque: { alias: 'deque', module: 'collections' },
            ChainMap: { alias: 'ChainMap', module: 'collections' }
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

        // If there was a cached value and no target of interest or the entire
        // LHS is the target of interest, there's no need to do additional work.
        if (!rightHandType) {
            // Special-case the typing.pyi file, which contains some special
            // types that the type analyzer needs to interpret differently.
            if (fileInfo.isTypingStubFile) {
                rightHandType = handleTypingStubAssignment(node);
                if (rightHandType) {
                    writeTypeCache(node.rightExpression, rightHandType);
                }
            }

            if (!rightHandType) {
                // Determine whether there is a declared type.
                const declaredType = getDeclaredTypeForExpression(node.leftExpression);

                // Evaluate the type of the right-hand side.
                // Don't specialize it in case it's a type alias with generic
                // type arguments.
                let flags: EvaluatorFlags = EvaluatorFlags.DoNotSpecialize;
                if (fileInfo.isStubFile) {
                    // An assignment of ellipsis means "Any" within a type stub file.
                    flags |= EvaluatorFlags.ConvertEllipsisToAny;
                }
                let srcType = getTypeOfExpression(node.rightExpression, declaredType, flags).type;

                // Determine if the RHS is a constant boolean expression.
                // If so, assign it a literal type.
                const constExprValue = evaluateStaticBoolExpression(
                    node.rightExpression,
                    fileInfo.executionEnvironment
                );
                if (constExprValue !== undefined) {
                    const boolType = getBuiltInObject(node, 'bool');
                    if (boolType.category === TypeCategory.Object) {
                        srcType = ObjectType.cloneWithLiteral(boolType, constExprValue);
                    }
                }

                // If there was a declared type, make sure the RHS value is compatible.
                if (declaredType) {
                    const diagAddendum = new DiagnosticAddendum();
                    if (canAssignType(declaredType, srcType, diagAddendum)) {
                        // Constrain the resulting type to match the declared type.
                        srcType = narrowDeclaredTypeBasedOnAssignedType(declaredType, srcType);
                    }
                }

                // If this is an enum, transform the type as required.
                rightHandType = srcType;
                if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
                    rightHandType = transformTypeForPossibleEnumClass(node.leftExpression, rightHandType);
                }
            }
        }

        assignTypeToExpression(node.leftExpression, rightHandType, node.rightExpression);

        writeTypeCache(node, rightHandType);
    }

    function evaluateTypesForAugmentedAssignment(node: AugmentedAssignmentNode): void {
        if (readTypeCache(node)) {
            return;
        }

        const destType = getTypeFromAugmentedAssignment(node);
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
        if (scope.type === ScopeType.Builtin || fileInfo.isTypingStubFile || fileInfo.isBuiltInStubFile) {
            classFlags |= ClassTypeFlags.BuiltInClass;

            if (node.name.value === 'property') {
                classFlags |= ClassTypeFlags.PropertyClass;
            }
        }

        classType = ClassType.create(
            node.name.value,
            classFlags,
            node.id,
            ParseTreeUtils.getDocString(node.suite.statements)
        );

        // Some classes refer to themselves within type arguments used within
        // base classes. We'll register the partially-constructed class type
        // to allow these to be resolved.
        const classSymbol = scope.lookUpSymbol(node.name.value);
        const classDecl = AnalyzerNodeInfo.getDeclaration(node)!;
        setSymbolResolutionPartialType(classSymbol!, classDecl, classType);
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
        node.arguments.forEach(arg => {
            // Ignore keyword parameters other than metaclass or total.
            if (!arg.name || arg.name.value === 'metaclass') {
                let argType = getTypeOfExpression(arg.valueExpression).type;
                const isMetaclass = !!arg.name;

                if (isMetaclass) {
                    if (sawMetaclass) {
                        addError(`Only one metaclass can be provided`, arg);
                    }
                    sawMetaclass = true;
                }

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType.category === TypeCategory.Union) {
                    argType = removeUnboundFromUnion(argType);
                }

                if (!isAnyOrUnknown(argType) && argType.category !== TypeCategory.Unbound) {
                    // Handle "Type[X]" object.
                    argType = transformTypeObjectToClass(argType);
                    if (argType.category !== TypeCategory.Class) {
                        addError(`Argument to class must be a base class`, arg);
                        argType = UnknownType.create();
                    } else {
                        if (ClassType.isBuiltIn(argType, 'Protocol')) {
                            if (
                                !fileInfo.isStubFile &&
                                fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37
                            ) {
                                addError(`Use of 'Protocol' requires Python 3.7 or newer`, arg.valueExpression);
                            }
                            classType.details.flags |= ClassTypeFlags.ProtocolClass;
                        }

                        if (ClassType.isBuiltIn(argType, 'property')) {
                            classType.details.flags |= ClassTypeFlags.PropertyClass;
                        }

                        // If the class directly derives from NamedTuple (in Python 3.6 or
                        // newer), it's considered a dataclass.
                        if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
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
                            addError(`All base classes for TypedDict classes must also be TypedDict classes`, arg);
                        }

                        // Validate that the class isn't deriving from itself, creating a
                        // circular dependency.
                        if (derivesFromClassRecursive(argType, classType)) {
                            addError(`Class cannot derive from itself`, arg);
                            argType = UnknownType.create();
                        }
                    }
                }

                if (
                    argType.category === TypeCategory.Unknown ||
                    (argType.category === TypeCategory.Union &&
                        argType.subtypes.some(t => t.category === TypeCategory.Unknown))
                ) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedBaseClass,
                        DiagnosticRule.reportUntypedBaseClass,
                        `Base class type is unknown, obscuring type of derived class`,
                        arg
                    );
                }

                if (isMetaclass) {
                    if (argType.category === TypeCategory.Class || argType.category === TypeCategory.Unknown) {
                        classType.details.metaClass = argType;
                        if (argType.category === TypeCategory.Class) {
                            if (ClassType.isBuiltIn(argType, 'EnumMeta')) {
                                classType.details.flags |= ClassTypeFlags.EnumClass;
                            } else if (ClassType.isBuiltIn(argType, 'ABCMeta')) {
                                classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
                            }
                        }
                    }
                } else {
                    classType.details.baseClasses.push(argType);
                    if (argType.category === TypeCategory.Class) {
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
                                `Base class '${className}' is marked final and cannot be subclassed`,
                                arg.valueExpression
                            );
                        }
                    }
                }

                addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(argType));
                if (argType.category === TypeCategory.Class && ClassType.isBuiltIn(argType, 'Generic')) {
                    if (genericTypeParameters) {
                        addError(`Class cannot derive from 'Generic' more than once`, arg.valueExpression);
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
                        addError('Value for total parameter must be True or False', arg.valueExpression);
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

        // TODO - validate that we are not adding type parameters that
        // are unique type vars but have conflicting names.
        // TODO - if genericTypeParameters are provided, make sure that
        // typeParameters is a proper subset.
        classType.details.typeParameters = genericTypeParameters || typeParameters;

        if (!computeMroLinearization(classType)) {
            addError('Cannot create consistent method ordering', node.name);
        }

        // The scope for this class becomes the "fields" for the corresponding type.
        const innerScope = ScopeUtils.getScopeForNode(node.suite);
        classType.details.fields = innerScope.symbolTable;

        if (ClassType.isTypedDictClass(classType)) {
            synthesizeTypedDictClassMethods(node, classType);
        }

        // Determine if the class is abstract.
        if (ClassType.supportsAbstractMethods(classType)) {
            if (doesClassHaveAbstractMethods(classType)) {
                classType.details.flags |= ClassTypeFlags.HasAbstractMethods;
            }
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
                    if (initParams.length > 1 && !initParams.some(param => param.typeAnnotation)) {
                        const genericParams = initParams.filter(
                            (param, index) => index > 0 && param.name && param.category === ParameterCategory.Simple
                        );

                        if (genericParams.length > 0) {
                            classType.details.flags |= ClassTypeFlags.PseudoGenericClass;

                            // Create a type parameter for each simple, named parameter
                            // in the __init__ method.
                            classType.details.typeParameters = genericParams.map(param =>
                                TypeVarType.create(`__type_of_${param.name!.value}`, true)
                            );
                        }
                    }
                }
            }
        }

        // Now determine the decorated type of the class.
        decoratedType = classType;
        let foundUnknown = false;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyClassDecorator(decoratedType, classType, decorator);
            if (newDecoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        `Untyped class decorator obscures type of class, ignoring decorator`,
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
                    decoratorNode.arguments.forEach(arg => {
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

        const functionDecl = AnalyzerNodeInfo.getDeclaration(node) as FunctionDeclaration;

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
        if (functionDecl.isGenerator) {
            functionFlags |= FunctionTypeFlags.Generator;
        }

        if (fileInfo.isStubFile) {
            functionFlags |= FunctionTypeFlags.StubDefinition;
        }

        if (node.isAsync) {
            functionFlags |= FunctionTypeFlags.Async;
        }

        functionType = FunctionType.create(functionFlags, ParseTreeUtils.getDocString(node.suite.statements));

        if (fileInfo.isBuiltInStubFile || fileInfo.isTypingStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod', 'dataclass' and 'NewType'
            // specially.
            functionType.details.builtInName = node.name.value;
        }

        functionType.details.declaration = functionDecl;

        // Allow recursion by registering the partially-constructed
        // function type.
        const scope = ScopeUtils.getScopeForNode(node);
        const functionSymbol = scope.lookUpSymbol(node.name.value);
        setSymbolResolutionPartialType(functionSymbol!, functionDecl, functionType);
        writeTypeCache(node, functionType);
        writeTypeCache(node.name, functionType);

        // Is this an "__init__" method within a pseudo-generic class? If so,
        // we'll add generic types to the constructor's parameters.
        const addGenericParamTypes =
            containingClassType &&
            ClassType.isPseudoGenericClass(containingClassType) &&
            node.name.value === '__init__';

        // If there was a defined return type, analyze that first so when we
        // walk the contents of the function, return statements can be
        // validated against this type.
        if (node.returnTypeAnnotation) {
            const returnType = getTypeOfAnnotation(node.returnTypeAnnotation);
            functionType.details.declaredReturnType = returnType;
        }

        const paramTypes: Type[] = [];
        let typeParamIndex = 0;

        node.parameters.forEach((param, index) => {
            let paramType: Type | undefined;
            let annotatedType: Type | undefined;
            let concreteAnnotatedType: Type | undefined;
            let isNoneWithoutOptional = false;

            if (param.typeAnnotation) {
                annotatedType = getTypeOfAnnotation(param.typeAnnotation);
            } else if (addGenericParamTypes) {
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

                        if (!fileInfo.diagnosticSettings.strictParameterNoneValue) {
                            annotatedType = combineTypes([annotatedType, NoneType.create()]);
                        }
                    }
                }

                concreteAnnotatedType = specializeType(annotatedType, undefined);
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
                        const diag = addError(
                            `Value of type '${printType(defaultValueType)}' cannot` +
                                ` be assigned to parameter of type '${printType(annotatedType)}'` +
                                diagAddendum.getString(),
                            param.defaultValue
                        );

                        if (isNoneWithoutOptional && param.typeAnnotation) {
                            const addOptionalAction: AddMissingOptionalToParamAction = {
                                action: Commands.addMissingOptionalToParam,
                                offsetOfTypeNode: param.typeAnnotation.start + 1
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
                type: paramType || UnknownType.create()
            };

            FunctionType.addParameter(functionType, functionParam);

            if (param.name) {
                const variadicParamType = transformVariadicParamType(node, param.category, functionParam.type);
                paramTypes.push(variadicParamType);
            } else {
                paramTypes.push(functionParam.type);
            }
        });

        if (containingClassNode) {
            // If the first parameter doesn't have an explicit type annotation,
            // provide a type if it's an instance, class or constructor method.
            if (functionType.details.parameters.length > 0 && !node.parameters[0].typeAnnotation) {
                if (containingClassType) {
                    const inferredParamType = inferFirstParamType(functionType.details.flags, containingClassType);
                    if (inferredParamType) {
                        functionType.details.parameters[0].type = inferredParamType;
                        paramTypes[0] = inferredParamType;
                    }
                }
            }
        }

        // Update the types for the nodes associated with the parameters.
        paramTypes.forEach((paramType, index) => {
            const paramNameNode = node.parameters[index].name;
            if (paramNameNode) {
                if (paramType.category === TypeCategory.Unknown) {
                    functionType.details.flags |= FunctionTypeFlags.UnannotatedParams;
                }
                writeTypeCache(paramNameNode, paramType);
            }
        });

        // If it's an async function, wrap the return type in an Awaitable or Generator.
        const preDecoratedType = node.isAsync ? createAwaitableFunction(node, functionType) : functionType;

        // Apply all of the decorators in reverse order.
        decoratedType = preDecoratedType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            const newDecoratedType = applyFunctionDecorator(decoratedType, functionType, decorator);
            if (newDecoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedFunctionDecorator,
                        DiagnosticRule.reportUntypedFunctionDecorator,
                        `Untyped function decorator obscures type of function, ignoring decorator`,
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

    function inferFirstParamType(flags: FunctionTypeFlags, containingClassType: ClassType): Type | undefined {
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
                    return selfSpecializeClassType(containingClassType, true);
                } else if ((flags & FunctionTypeFlags.StaticMethod) === 0) {
                    const specializedClassType = selfSpecializeClassType(containingClassType);
                    return ObjectType.create(specializedClassType);
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
                if (tupleType && tupleType.category === TypeCategory.Class) {
                    return ObjectType.create(ClassType.cloneForSpecialization(tupleType, [type, AnyType.create(true)]));
                }

                return UnknownType.create();
            }

            case ParameterCategory.VarArgDictionary: {
                const dictType = getBuiltInType(node, 'Dict');
                const strType = getBuiltInObject(node, 'str');

                if (dictType.category === TypeCategory.Class && strType.category === TypeCategory.Object) {
                    return ObjectType.create(ClassType.cloneForSpecialization(dictType, [strType, type]));
                }

                return UnknownType.create();
            }
        }
    }

    // Scans through the decorators to find a few built-in decorators
    // that affect the function flags.
    function getFunctionFlagsFromDecorators(node: FunctionNode, isInClass: boolean) {
        let flags = FunctionTypeFlags.None;

        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        if (node.name.value === '__new__' && isInClass) {
            flags |= FunctionTypeFlags.ConstructorMethod;
        }

        for (const decoratorNode of node.decorators) {
            const decoratorType = getTypeOfExpression(
                decoratorNode.leftExpression,
                undefined,
                EvaluatorFlags.DoNotSpecialize
            ).type;
            if (decoratorType.category === TypeCategory.Function) {
                if (decoratorType.details.builtInName === 'abstractmethod') {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.AbstractMethod;
                    }
                } else if (decoratorType.details.builtInName === 'final') {
                    flags |= FunctionTypeFlags.Final;
                }
            } else if (decoratorType.category === TypeCategory.Class) {
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
        decoratorNode: DecoratorNode
    ): Type {
        const decoratorType = getTypeOfExpression(
            decoratorNode.leftExpression,
            undefined,
            EvaluatorFlags.DoNotSpecialize
        ).type;

        // Special-case the "overload" because it has no definition.
        if (decoratorType.category === TypeCategory.Class && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) {
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
                        return clonePropertyWithSetter(baseType, originalFunctionType);
                    } else if (memberName === 'deleter') {
                        return clonePropertyWithDeleter(baseType, originalFunctionType);
                    }
                }
            }
        } else if (decoratorType.category === TypeCategory.Class) {
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
                    return createProperty(decoratorType.details.name, inputFunctionType, decoratorNode.id);
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

    function createProperty(className: string, fget: FunctionType, typeSourceId: TypeSourceId): ObjectType {
        const propertyClass = ClassType.create(className, ClassTypeFlags.PropertyClass, typeSourceId);
        computeMroLinearization(propertyClass);

        const propertyObject = ObjectType.create(propertyClass);

        // Fill in the fget method.
        const fields = propertyClass.details.fields;
        const fgetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fget);
        fields.set('fget', fgetSymbol);

        // Fill in the __get__ method.
        const getFunction = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
        getFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fget.details.parameters.length > 0 ? fget.details.parameters[0].type : AnyType.create()
        });
        getFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject
        });
        getFunction.details.declaredReturnType = fget.details.declaredReturnType;
        getFunction.details.declaration = fget.details.declaration;
        const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunction);
        fields.set('__get__', getSymbol);

        // Fill in the getter, setter and deleter methods.
        const accessorFunction = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
        accessorFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: propertyObject
        });
        accessorFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'accessor',
            type: AnyType.create()
        });
        accessorFunction.details.declaredReturnType = propertyObject;
        const accessorSymbol = Symbol.createWithType(SymbolFlags.ClassMember, accessorFunction);
        fields.set('getter', accessorSymbol);
        fields.set('setter', accessorSymbol);
        fields.set('deleter', accessorSymbol);

        return propertyObject;
    }

    function clonePropertyWithSetter(prop: Type, fset: FunctionType): Type {
        if (!isProperty(prop)) {
            return prop;
        }

        const classType = (prop as ObjectType).classType;
        const propertyClass = ClassType.create(
            classType.details.name,
            classType.details.flags,
            classType.details.typeSourceId
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

        // Fill in the fset method.
        const fsetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fset);
        fields.set('fset', fsetSymbol);

        // Fill in the __set__ method.
        const setFunction = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fset.details.parameters.length > 0 ? fset.details.parameters[0].type : AnyType.create()
        });
        setFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject
        });
        setFunction.details.declaredReturnType = NoneType.create();
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
            type: setParamType
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
            classType.details.flags,
            classType.details.typeSourceId
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
        const delFunction = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'self',
            type: fdel.details.parameters.length > 0 ? fdel.details.parameters[0].type : AnyType.create()
        });
        delFunction.details.parameters.push({
            category: ParameterCategory.Simple,
            name: 'obj',
            type: propertyObject
        });
        delFunction.details.declaredReturnType = NoneType.create();
        const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
        fields.set('__delete__', delSymbol);

        return propertyObject;
    }

    // Given a function node and the function type associated with it, this
    // method search for prior function nodes that are marked as @overload
    // and creates an OverloadedFunctionType that includes this function and
    // all previous ones.
    function addOverloadsToFunctionType(node: FunctionNode, type: FunctionType): Type {
        const functionDecl = AnalyzerNodeInfo.getDeclaration(node) as FunctionDeclaration;
        const symbolWithScope = lookUpSymbolRecursive(node, node.name.value);
        if (symbolWithScope) {
            const decls = symbolWithScope.symbol.getDeclarations();

            // Find this function's declaration.
            let declIndex = decls.findIndex(decl => decl === functionDecl);
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
                    return newOverload;
                }
            }
        }

        return type;
    }

    function createAwaitableFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
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

        if (returnType.category === TypeCategory.Object) {
            const classType = returnType.classType;
            if (ClassType.isBuiltIn(classType)) {
                if (classType.details.name === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = getTypingType(node, 'AsyncGenerator');
                    if (asyncGeneratorType && asyncGeneratorType.category === TypeCategory.Class) {
                        const typeArgs: Type[] = [];
                        const generatorTypeArgs = classType.typeArguments;
                        if (generatorTypeArgs && generatorTypeArgs.length > 0) {
                            typeArgs.push(generatorTypeArgs[0]);
                        }
                        if (generatorTypeArgs && generatorTypeArgs.length > 1) {
                            typeArgs.push(generatorTypeArgs[1]);
                        }
                        awaitableReturnType = ObjectType.create(
                            ClassType.cloneForSpecialization(asyncGeneratorType, typeArgs)
                        );
                    }
                } else if (
                    ['AsyncGenerator', 'AsyncIterator', 'AsyncIterable'].some(name => name === classType.details.name)
                ) {
                    // If it's already an AsyncGenerator, AsyncIterator or AsyncIterable,
                    // leave it as is.
                    awaitableReturnType = returnType;
                }
            }
        }

        if (!awaitableReturnType) {
            const awaitableType = getTypingType(node, 'Awaitable');
            if (awaitableType && awaitableType.category === TypeCategory.Class) {
                awaitableReturnType = ObjectType.create(ClassType.cloneForSpecialization(awaitableType, [returnType]));
            } else {
                awaitableReturnType = UnknownType.create();
            }
        }

        return awaitableReturnType;
    }

    function inferFunctionReturnType(node: FunctionNode, isAbstract: boolean): Type | undefined {
        // This shouldn't be called if there is a declared return type.
        assert(!node.returnTypeAnnotation);

        // Is this type already cached?
        let inferredReturnType = readTypeCache(node.suite);
        if (inferredReturnType) {
            return inferredReturnType;
        }

        if (!functionRecursionMap.has(node.id)) {
            functionRecursionMap.set(node.id, true);

            const functionDecl = AnalyzerNodeInfo.getDeclaration(node) as FunctionDeclaration;

            // Is it a generator?
            if (functionDecl.yieldExpressions) {
                const inferredYieldTypes: Type[] = [];
                functionDecl.yieldExpressions.forEach(yieldNode => {
                    if (isNodeReachable(yieldNode)) {
                        if (yieldNode.expression) {
                            const cachedType = getTypeOfExpression(yieldNode.expression).type;
                            inferredYieldTypes.push(cachedType || UnknownType.create());
                        } else {
                            inferredYieldTypes.push(NoneType.create());
                        }
                    }
                });

                if (inferredYieldTypes.length === 0) {
                    inferredYieldTypes.push(NoneType.create());
                }
                inferredReturnType = combineTypes(inferredYieldTypes);

                // Inferred yield types need to be wrapped in a Generator to
                // produce the final result.
                const generatorType = getTypingType(node, 'Generator');
                if (generatorType && generatorType.category === TypeCategory.Class) {
                    inferredReturnType = ObjectType.create(
                        ClassType.cloneForSpecialization(generatorType, [inferredReturnType])
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
                    if (isAbstract) {
                        inferredReturnType = UnknownType.create();
                    } else {
                        const noReturnClass = getTypingType(node, 'NoReturn');
                        if (noReturnClass && noReturnClass.category === TypeCategory.Class) {
                            inferredReturnType = ObjectType.create(noReturnClass);
                        } else {
                            inferredReturnType = UnknownType.create();
                        }
                    }
                } else {
                    const inferredReturnTypes: Type[] = [];
                    if (functionDecl.returnExpressions) {
                        functionDecl.returnExpressions.forEach(returnNode => {
                            if (isNodeReachable(returnNode)) {
                                if (returnNode.returnExpression) {
                                    const returnType = getTypeOfExpression(returnNode.returnExpression).type;
                                    inferredReturnTypes.push(returnType || UnknownType.create());
                                } else {
                                    inferredReturnTypes.push(NoneType.create());
                                }
                            }
                        });
                    }

                    if (!functionNeverReturns && implicitlyReturnsNone) {
                        inferredReturnTypes.push(NoneType.create());
                    }

                    inferredReturnType = combineTypes(inferredReturnTypes);
                }
            }

            // Remove any unbound values since those would generate an exception
            // before being returned.
            inferredReturnType = removeUnboundFromUnion(inferredReturnType);

            writeTypeCache(node.suite, inferredReturnType);
            functionRecursionMap.delete(node.id);
        }

        return inferredReturnType;
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

            if (exceptionType.category === TypeCategory.Class) {
                return ObjectType.create(exceptionType);
            }

            if (exceptionType.category === TypeCategory.Object) {
                const iterableType = getTypeFromIterable(exceptionType, false, errorNode, false);

                return doForSubtypes(iterableType, subtype => {
                    if (isAnyOrUnknown(subtype)) {
                        return subtype;
                    }

                    const transformedSubtype = transformTypeObjectToClass(subtype);
                    if (transformedSubtype.category === TypeCategory.Class) {
                        return ObjectType.create(transformedSubtype);
                    }

                    return UnknownType.create();
                });
            }

            return UnknownType.create();
        }

        const targetType = doForSubtypes(exceptionTypes, subType => {
            // If more than one type was specified for the exception, we'll receive
            // a specialized tuple object here.
            const tupleType = getSpecializedTupleType(subType);
            if (tupleType && tupleType.typeArguments) {
                const entryTypes = tupleType.typeArguments.map(t => {
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
                fileInfo.diagnosticSettings.reportOptionalContextManager,
                DiagnosticRule.reportOptionalContextManager,
                `Object of type 'None' cannot be used with 'with'`,
                node.expression
            );
            exprType = removeNoneFromUnion(exprType);
        }

        const enterMethodName = isAsync ? '__aenter__' : '__enter__';
        const scopedType = doForSubtypes(exprType, subtype => {
            if (subtype.category === TypeCategory.TypeVar) {
                subtype = specializeType(subtype, undefined);
            }

            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (subtype.category === TypeCategory.Object) {
                const memberType = getTypeFromObjectMember(
                    node.expression,
                    subtype,
                    enterMethodName,
                    { method: 'get' },
                    diag,
                    MemberAccessFlags.None
                );

                if (memberType) {
                    let memberReturnType: Type;
                    if (memberType.category === TypeCategory.Function) {
                        memberReturnType = getFunctionEffectiveReturnType(memberType);
                    } else {
                        memberReturnType = UnknownType.create();
                    }

                    // For "async while", an implicit "await" is performed.
                    if (isAsync) {
                        memberReturnType = getTypeFromAwaitable(memberReturnType, node);
                    }

                    return memberReturnType;
                }
            }

            addError(
                `Type ${printType(subtype)} cannot be used ` +
                    `with 'with' because it does not implement '${enterMethodName}'` +
                    diag.getString(),
                node.expression
            );
            return UnknownType.create();
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
        if (cachedModuleType && cachedModuleType.category === TypeCategory.Module && symbolType) {
            if (isTypeSame(symbolType, cachedModuleType)) {
                symbolType = cachedModuleType;
            }
        }

        assignTypeToNameNode(symbolNameNode, symbolType);

        writeTypeCache(node, symbolType);
    }

    function evaluateTypesForImportFrom(node: ImportFromAsNode): void {
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
            if (importInfo && importInfo.isImportFound) {
                const resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];

                // If we were able to resolve the import, report the error as
                // an unresolved symbol.
                const importLookupInfo = importLookup(resolvedPath);
                if (importLookupInfo) {
                    const fileInfo = getFileInfo(node);

                    // Handle PEP 562 support for module-level __getattr__ function,
                    // introduced in Python 3.7.
                    if (
                        fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37 ||
                        !importLookupInfo.symbolTable.get('__getattr__')
                    ) {
                        addError(`'${node.name.value}' is unknown import symbol`, node.name);
                    }
                }
            }

            symbolType = UnknownType.create();
        }

        assignTypeToNameNode(aliasNode, symbolType);
        writeTypeCache(node, symbolType);
    }

    function getAliasedSymbolTypeForName(node: ParseNode, name: string): Type | undefined {
        const symbolWithScope = lookUpSymbolRecursive(node, name);
        if (!symbolWithScope) {
            return undefined;
        }

        const aliasDecl = symbolWithScope.symbol.getDeclarations().find(decl => decl.type === DeclarationType.Alias);
        if (!aliasDecl) {
            return undefined;
        }

        const resolvedDecl = resolveAliasDeclaration(aliasDecl);
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
        while (curNode && (isExpressionNode(curNode) || isContextual(curNode))) {
            if (isContextual(curNode)) {
                lastContextualExpression = curNode as ExpressionNode;
            }

            curNode = curNode.parent;
        }

        const parent = lastContextualExpression.parent!;
        if (parent.nodeType === ParseNodeType.Assignment) {
            if (lastContextualExpression === parent.typeAnnotationComment) {
                getTypeOfAnnotation(lastContextualExpression);
            } else {
                evaluateTypesForAssignmentStatement(parent);
            }
            return;
        }

        if (parent.nodeType === ParseNodeType.AugmentedAssignment) {
            evaluateTypesForAugmentedAssignment(parent);
            return;
        }

        if (parent.nodeType === ParseNodeType.TypeAnnotation) {
            getTypeOfAnnotation(parent.typeAnnotation);
            return;
        }

        if (parent.nodeType === ParseNodeType.ModuleName) {
            // Names within a module name isn't an expression,
            // so there's nothing we can evaluate here.
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
        getTypeOfExpression(nodeToEvaluate);
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

        if (node.typeAnnotation) {
            writeTypeCache(node.name!, getTypeOfAnnotation(node.typeAnnotation));
            return;
        }

        const paramIndex = functionNode.parameters.findIndex(param => param === node);

        // We may be able to infer the type of the first parameter.
        if (paramIndex === 0) {
            const containingClassNode = ParseTreeUtils.getEnclosingClass(functionNode, true);
            if (containingClassNode) {
                const classInfo = getTypeOfClass(containingClassNode);
                if (classInfo) {
                    const functionFlags = getFunctionFlagsFromDecorators(functionNode, true);
                    // If the first parameter doesn't have an explicit type annotation,
                    // provide a type if it's an instance, class or constructor method.
                    const inferredParamType = inferFirstParamType(functionFlags, classInfo.classType);
                    writeTypeCache(node.name!, inferredParamType || UnknownType.create());
                    return;
                }
            }
        }

        // We weren't able to infer the input parameter type. Set its
        // type to unknown.
        writeTypeCache(node.name!, UnknownType.create());
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
                    evaluateTypesForAssignmentStatement(curNode);
                    return;
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

        const symbolWithScope = lookUpSymbolRecursive(flowNode.node, name);
        assert(symbolWithScope !== undefined);
        const decls = symbolWithScope!.symbol.getDeclarations();
        const wildcardDecl = decls.find(decl => decl.node === flowNode.node);

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
            const symbolWithScope = lookUpSymbolRecursive(node, node.value);

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
            const baseType = getDeclaredCallBaseType(node.leftExpression);
            if (!baseType) {
                return undefined;
            }

            let symbol: Symbol | undefined;
            if (baseType.category === TypeCategory.Module) {
                symbol = ModuleType.getField(baseType, memberName);
            } else if (baseType.category === TypeCategory.Class) {
                const classMemberInfo = lookUpClassMember(baseType, memberName);
                symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
            } else if (baseType.category === TypeCategory.Object) {
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

            if (functionType) {
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
                        !functionType.details.declaration.yieldExpressions &&
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

        return analyzer.getTypeFromCodeFlow(reference, targetSymbolId, initialType).type;
    }

    // Creates a new code flow analyzer that can be used to narrow the types
    // of the expressions within an execution context. Each code flow analyzer
    // instance maintains a cache of types it has already determined.
    function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
        const flowNodeTypeCacheSet = new Map<string, Map<number, CachedType | undefined>>();

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
                // For speculative or incomplete types, we'll create a separate
                // object. For non-speculative and complete types, we'll store
                // the type directly.
                const entry: PartialType | Type | undefined =
                    isSpeculativeMode() || isIncomplete
                        ? {
                              category: partialTypeCategory,
                              type,
                              speculativeModeId,
                              isIncomplete
                          }
                        : type;

                flowNodeTypeCache!.set(flowNode.id, entry);

                return {
                    type,
                    isIncomplete
                };
            }

            function deleteCacheEntry(flowNode: FlowNode) {
                flowNodeTypeCache!.delete(flowNode.id);
            }

            function getCacheEntry(flowNode: FlowNode): FlowNodeTypeResult | undefined {
                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (!cachedEntry) {
                    return undefined;
                }

                if (cachedEntry.category !== partialTypeCategory) {
                    return {
                        type: cachedEntry,
                        isIncomplete: false
                    };
                }

                const partialType = cachedEntry as PartialType;

                if (partialType.speculativeModeId !== invalidSpeculativeModeId) {
                    if (!isSpeculativeMode()) {
                        return undefined;
                    }
                }

                return {
                    type: partialType.type,
                    isIncomplete: !!partialType.isIncomplete
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
                    if (!cachedType) {
                        fail('evaluateAssignmentFlowNode failed to evaluate target');
                        cachedType = UnknownType.create();
                    }
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

                while (true) {
                    // Have we already been here? If so, use the cached value.
                    const cachedEntry = getCacheEntry(curFlowNode);
                    if (cachedEntry) {
                        return cachedEntry;
                    }

                    if (curFlowNode.flags & FlowFlags.Unreachable) {
                        // We can get here if there are nodes in a compound logical expression
                        // (e.g. "False and x") that are never executed but are evaluated.
                        // The type doesn't matter in this case.
                        return setCacheEntry(curFlowNode, undefined, false);
                    }

                    if (curFlowNode.flags & FlowFlags.Call) {
                        const callFlowNode = curFlowNode as FlowCall;

                        // If this function returns a "NoReturn" type, that means
                        // it always raises an exception or otherwise doesn't return,
                        // so we can assume that the code before this is unreachable.
                        if (isCallNoReturn(callFlowNode.node)) {
                            return setCacheEntry(curFlowNode, undefined, false);
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
                                return setCacheEntry(curFlowNode, UnboundType.create(), false);
                            }

                            // Set the cache entry to undefined before evaluating the
                            // expression in case it depends on itself. This will prevent
                            // an infinite loop.
                            setCacheEntry(curFlowNode, undefined, false);
                            const flowType = evaluateAssignmentFlowNode(assignmentFlowNode);
                            return setCacheEntry(curFlowNode, flowType, false);
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

                    if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                        const labelNode = curFlowNode as FlowLabel;
                        const typesToCombine: Type[] = [];

                        let effectiveType: Type | undefined;
                        let sawIncomplete = false;
                        let firstWasIncomplete = false;
                        const isLoop = (curFlowNode.flags & FlowFlags.LoopLabel) !== 0;

                        if (isLoop) {
                            setCacheEntry(curFlowNode, undefined, true);
                        }

                        labelNode.antecedents.map((antecedent, index) => {
                            const flowTypeResult = getTypeFromFlowNode(
                                antecedent,
                                reference,
                                targetSymbolId,
                                initialType
                            );

                            if (flowTypeResult.isIncomplete) {
                                sawIncomplete = true;
                                if (index === 0) {
                                    firstWasIncomplete = true;
                                }
                            }

                            if (flowTypeResult.type) {
                                typesToCombine.push(flowTypeResult.type);
                                effectiveType = combineTypes(typesToCombine);
                                if (isLoop) {
                                    setCacheEntry(curFlowNode, effectiveType, true);
                                }
                            }
                        });

                        if (isLoop) {
                            // If this is a loop label, the result is incomplete only if the first
                            // antecedent (the edge that feeds the loop) is incomplete.
                            if (firstWasIncomplete) {
                                deleteCacheEntry(curFlowNode);
                                return { type: effectiveType, isIncomplete: true };
                            }
                            return setCacheEntry(curFlowNode, effectiveType, firstWasIncomplete);
                        }

                        // For branch labels, don't write back the result if it's incomplete.
                        return sawIncomplete
                            ? { type: effectiveType, isIncomplete: true }
                            : setCacheEntry(curFlowNode, effectiveType, false);
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

                            // If the type is incomplete, don't write back to the cache.
                            return flowTypeResult.isIncomplete
                                ? { type: flowType, isIncomplete: true }
                                : setCacheEntry(curFlowNode, flowType, false);
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
                        postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                        const flowTypeResult = getTypeFromFlowNode(
                            postFinallyFlowNode.antecedent,
                            reference,
                            targetSymbolId,
                            initialType
                        );
                        postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;

                        // If the type is incomplete, don't write back to the cache.
                        return flowTypeResult.isIncomplete
                            ? flowTypeResult
                            : setCacheEntry(curFlowNode, flowTypeResult.type, false);
                    }

                    if (curFlowNode.flags & FlowFlags.Start) {
                        return setCacheEntry(curFlowNode, initialType, false);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.value;
                            if (wildcardImportFlowNode.names.some(name => name === nameValue)) {
                                const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                                return setCacheEntry(curFlowNode, type, false);
                            }
                        }

                        curFlowNode = wildcardImportFlowNode.antecedent;
                        continue;
                    }

                    // We shouldn't get here.
                    fail('Unexpected flow node flags');
                    return setCacheEntry(curFlowNode, undefined, false);
                }
            }

            if (!flowNode) {
                // This should happen only in cases where we're evaluating
                // parse nodes that are created after the initial parse
                // (namely, string literals that are used for forward
                // referenced types).
                return {
                    type: initialType,
                    isIncomplete: false
                };
            }

            return getTypeFromFlowNode(flowNode, reference, targetSymbolId, initialType);
        }

        return {
            getTypeFromCodeFlow
        };
    }

    function isFlowNodeReachable(flowNode: FlowNode): boolean {
        const visitedFlowNodeMap = new Map<number, true>();

        function isFlowNodeReachableRecursive(flowNode: FlowNode): boolean {
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

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If this function returns a "NoReturn" type, that means
                    // it always raises an exception or otherwise doesn't return,
                    // so we can assume that the code before this is unreachable.
                    if (isCallNoReturn(callFlowNode.node)) {
                        return false;
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
                        if (isFlowNodeReachableRecursive(antecedent)) {
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
                    postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                    const isReachable = isFlowNodeReachableRecursive(postFinallyFlowNode.antecedent);
                    postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                    return isReachable;
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    return true;
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
        const isReachable = isFlowNodeReachableRecursive(flowNode);
        isReachableRecursionMap.delete(flowNode.id);

        return isReachable;
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
                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                        // Narrow the type by filtering on "None".
                        return (type: Type) => {
                            if (type.category === TypeCategory.Union) {
                                const remainingTypes = type.subtypes.filter(t => {
                                    if (isAnyOrUnknown(t)) {
                                        // We need to assume that "Any" is always both None and not None,
                                        // so it matches regardless of whether the test is positive or negative.
                                        return true;
                                    }

                                    // See if it's a match for None.
                                    return isNoneOrNever(t) === adjIsPositiveTest;
                                });

                                return combineTypes(remainingTypes);
                            } else if (isNoneOrNever(type)) {
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
                        callType.category === TypeCategory.Class &&
                        ClassType.isBuiltIn(callType, 'type') &&
                        testExpression.leftExpression.arguments.length === 1 &&
                        testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
                    ) {
                        const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
                        if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                            const classType = getTypeOfExpression(testExpression.rightExpression).type;
                            if (classType.category === TypeCategory.Class) {
                                return (type: Type) => {
                                    // Narrow the type based on whether the type matches the specified type.
                                    return doForSubtypes(type, subtype => {
                                        if (subtype.category === TypeCategory.Object) {
                                            const matches = ClassType.isSameGenericClass(subtype.classType, classType);
                                            if (adjIsPositiveTest) {
                                                return matches ? subtype : undefined;
                                            } else {
                                                return matches ? undefined : subtype;
                                            }
                                        } else if (isNoneOrNever(subtype)) {
                                            return adjIsPositiveTest ? undefined : subtype;
                                        }

                                        return subtype;
                                    });
                                };
                            }
                        }
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
                        const arg1Type = getTypeOfExpression(arg1Expr).type;
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
                return doForSubtypes(type, subtype => {
                    if (isPositiveTest) {
                        if (canBeTruthy(subtype)) {
                            return subtype;
                        }
                    } else {
                        if (canBeFalsy(subtype)) {
                            return subtype;
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
        if (argType.category === TypeCategory.Class) {
            return [argType];
        }

        if (argType.category === TypeCategory.Object) {
            const objClass = argType.classType;
            if (ClassType.isBuiltIn(objClass, 'Tuple') && objClass.typeArguments) {
                let foundNonClassType = false;
                const classTypeList: ClassType[] = [];
                objClass.typeArguments.forEach(typeArg => {
                    if (typeArg.category === TypeCategory.Class) {
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
        const effectiveType = doForSubtypes(type, subtype => {
            return transformTypeObjectToClass(subtype);
        });

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

            return filteredTypes.map(t => ObjectType.create(t));
        };

        if (isInstanceCheck && effectiveType.category === TypeCategory.Object) {
            const filteredType = filterType(effectiveType.classType);
            return combineTypes(filteredType);
        } else if (!isInstanceCheck && effectiveType.category === TypeCategory.Class) {
            const filteredType = filterType(effectiveType);
            return combineTypes(filteredType);
        } else if (effectiveType.category === TypeCategory.Union) {
            let remainingTypes: Type[] = [];

            effectiveType.subtypes.forEach(t => {
                if (isAnyOrUnknown(t)) {
                    // Any types always remain for both positive and negative
                    // checks because we can't say anything about them.
                    remainingTypes.push(t);
                } else if (isInstanceCheck && t.category === TypeCategory.Object) {
                    remainingTypes = remainingTypes.concat(filterType(t.classType));
                } else if (!isInstanceCheck && t.category === TypeCategory.Class) {
                    remainingTypes = remainingTypes.concat(filterType(t));
                } else {
                    // All other types are never instances of a class.
                    if (!isPositiveTest) {
                        remainingTypes.push(t);
                    }
                }
            });

            return combineTypes(remainingTypes);
        }

        // Return the original type.
        return type;
    }

    // Attempts to narrow a type (make it more constrained) based on a
    // call to "callable". For example, if the original type of expression "x" is
    // Union[Callable[..., Any], Type[int], int], it would remove the "int" because
    // it's not callable.
    function narrowTypeForCallable(type: Type, isPositiveTest: boolean, errorNode: ExpressionNode): Type {
        return doForSubtypes(type, subtype => {
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
                    if (classFromTypeObject && classFromTypeObject.category === TypeCategory.Class) {
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
                    return createSpecialType(classType, typeArgs, undefined, true);
                }

                case 'Union': {
                    return createUnionType(typeArgs);
                }

                case 'Generic': {
                    return createGenericType(errorNode, classType, typeArgs);
                }

                case 'Final': {
                    return createFinalType(errorNode, typeArgs);
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
            if (typeParameters.length === 0) {
                addError(`Expected no type arguments`, typeArgs[typeParameters.length].node);
            } else {
                addError(
                    `Expected at most ${typeParameters.length} ` +
                        `type ${typeParameters.length === 1 ? 'argument' : 'arguments'} `,
                    typeArgs[typeParameters.length].node
                );
            }
            typeArgCount = typeParameters.length;
        }

        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                // Verify that we didn't receive any inappropriate ellipses or modules.
                if (isEllipsisType(typeArg.type)) {
                    addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    addError(`Module not allowed in this context`, typeArg.node);
                }
            });
        }

        // Fill in any missing type arguments with Any.
        const typeArgTypes = typeArgs ? typeArgs.map(t => convertClassToObject(t.type)) : [];
        const typeParams = ClassType.getTypeParameters(classType);
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(getConcreteTypeFromTypeVar(typeParams[i]));
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
                    addError(
                        `Type '${printType(typeArgType)}' ` +
                            `cannot be assigned to type variable '${typeParameters[index].name}'` +
                            diag.getString(),
                        typeArgs![index].node
                    );
                }
            }
        });

        const specializedClass = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedClass;
    }

    function getTypeForArgument(arg: FunctionArgument, expectingType = false): Type {
        if (arg.type) {
            return arg.type;
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeOfExpression(
            arg.valueExpression!,
            undefined,
            expectingType ? EvaluatorFlags.EvaluateStringLiteralAsType : EvaluatorFlags.None
        ).type;
    }

    function getBuiltInType(node: ParseNode, name: string): Type {
        const scope = ScopeUtils.getScopeForNode(node);
        const builtInScope = ScopeUtils.getBuiltInScope(scope);
        const nameType = builtInScope.lookUpSymbol(name);
        if (nameType) {
            return getEffectiveTypeOfSymbol(nameType);
        }

        return UnknownType.create();
    }

    function getBuiltInObject(node: ParseNode, name: string, typeArguments?: Type[]) {
        const nameType = getBuiltInType(node, name);
        if (nameType.category === TypeCategory.Class) {
            let classType = nameType;
            if (typeArguments) {
                classType = ClassType.cloneForSpecialization(classType, typeArguments);
            }

            return ObjectType.create(classType);
        }

        return nameType;
    }

    function lookUpSymbolRecursive(node: ParseNode, name: string) {
        const scope = ScopeUtils.getScopeForNode(node);
        return scope.lookUpSymbolRecursive(name);
    }

    // Disables recording of errors and warnings and disables
    // any caching of types, under the assumption that we're
    // performing speculative evaluations.
    function useSpeculativeMode(callback: () => void) {
        const prevSpeculativeModeId = speculativeModeId;
        speculativeModeId = nextSpeculativeModeId++;
        callback();
        speculativeModeId = prevSpeculativeModeId;
    }

    function isSpeculativeMode() {
        return speculativeModeId !== invalidSpeculativeModeId;
    }

    function disableSpeculativeMode(callback: () => void) {
        const prevSpeculativeModeId = speculativeModeId;
        speculativeModeId = invalidSpeculativeModeId;
        callback();
        speculativeModeId = prevSpeculativeModeId;
    }

    function getFileInfo(node: ParseNode): AnalyzerFileInfo {
        while (node.nodeType !== ParseNodeType.Module) {
            node = node.parent!;
        }
        return AnalyzerNodeInfo.getFileInfo(node)!;
    }

    function getDeclarationFromFunctionNamedParameter(type: FunctionType, paramName: string): Declaration | undefined {
        if (type.category === TypeCategory.Function && type.details.declaration) {
            const functionDecl = type.details.declaration;
            if (functionDecl.type === DeclarationType.Function) {
                const functionNode = functionDecl.node;
                const functionScope = AnalyzerNodeInfo.getScope(functionNode)!;
                const paramSymbol = functionScope.lookUpSymbol(paramName)!;
                if (paramSymbol) {
                    return paramSymbol.getDeclarations().find(decl => decl.type === DeclarationType.Parameter);
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
        const nameValue = node.value;

        // If the node is part of a "from X import Y as Z" statement and the node
        // is the "Y" (non-aliased) name, don't return any declarations for it
        // because this name isn't in the symbol table.
        if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFromAs &&
            node.parent.alias &&
            node === node.parent.name
        ) {
            return undefined;
        }

        if (node.parent && node.parent.nodeType === ParseNodeType.MemberAccess && node === node.parent.memberName) {
            const baseType = getType(node.parent.leftExpression);
            if (baseType) {
                const memberName = node.parent.memberName.value;
                doForSubtypes(baseType, subtype => {
                    let symbol: Symbol | undefined;

                    if (subtype.category === TypeCategory.Class) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpClassMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpClassMember(subtype, memberName);
                        }
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (subtype.category === TypeCategory.Object) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpObjectMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpObjectMember(subtype, memberName);
                        }
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (subtype.category === TypeCategory.Module) {
                        symbol = ModuleType.getField(subtype, memberName);
                    }

                    if (symbol) {
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
            const namePartIndex = node.parent.nameParts.findIndex(part => part === node);
            const importInfo = AnalyzerNodeInfo.getImportInfo(node.parent);
            if (namePartIndex >= 0 && importInfo && namePartIndex < importInfo.resolvedPaths.length) {
                if (importInfo.resolvedPaths[namePartIndex]) {
                    // Synthesize an alias declaration for this name part. The only
                    // time this case is used is for the hover provider.
                    const aliasDeclaration: AliasDeclaration = {
                        type: DeclarationType.Alias,
                        node: undefined!,
                        path: importInfo.resolvedPaths[namePartIndex],
                        range: getEmptyRange(),
                        implicitImports: new Map<string, ModuleLoaderActions>()
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
                    } else if (baseType.category === TypeCategory.Class) {
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
                            }
                        }
                    }
                }
            }
        } else {
            const scope = ScopeUtils.getScopeForNode(node);
            if (scope) {
                const symbolInScope = scope.lookUpSymbolRecursive(nameValue);
                if (!symbolInScope) {
                    return;
                }

                declarations.push(...symbolInScope.symbol.getDeclarations());
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
                if (strType.category === TypeCategory.Object) {
                    if (declaration.intrinsicType === 'str') {
                        return strType;
                    }

                    const iterableType = getBuiltInType(declaration.node, 'Iterable');
                    if (iterableType.category === TypeCategory.Class) {
                        return ObjectType.create(ClassType.cloneForSpecialization(iterableType, [strType]));
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
                if (typeAnnotationNode && typeAnnotationNode.nodeType === ParseNodeType.StringList) {
                    typeAnnotationNode = typeAnnotationNode.typeAnnotation;
                }

                if (typeAnnotationNode) {
                    const declaredType = getTypeOfAnnotation(typeAnnotationNode);

                    if (declaredType) {
                        return convertClassToObject(declaredType);
                    }
                }

                return undefined;
            }

            case DeclarationType.Variable: {
                let typeAnnotationNode = declaration.typeAnnotationNode;
                if (typeAnnotationNode && typeAnnotationNode.nodeType === ParseNodeType.StringList) {
                    typeAnnotationNode = typeAnnotationNode.typeAnnotation;
                }

                if (typeAnnotationNode) {
                    let declaredType = getTypeOfAnnotation(typeAnnotationNode);
                    if (declaredType) {
                        // Apply enum transform if appropriate.
                        if (declaration.node.nodeType === ParseNodeType.Name) {
                            declaredType = transformTypeForPossibleEnumClass(declaration.node, declaredType);
                        }
                        return convertClassToObject(declaredType);
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
        const resolvedDecl = resolveAliasDeclaration(decl);

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
                    const importedModuleType = ModuleType.create();
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
            const moduleType = ModuleType.create();
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
                evaluateTypesForStatement(resolvedDecl.inferredTypeSource);
                inferredType = readTypeCache(resolvedDecl.node);
            }

            if (inferredType && resolvedDecl.node.nodeType === ParseNodeType.Name) {
                inferredType = transformTypeForPossibleEnumClass(resolvedDecl.node, inferredType);
            }

            return inferredType;
        }

        return undefined;
    }

    // If the specified declaration is an alias declaration that points
    // to a symbol, it resolves the alias and looks up the symbol, then
    // returns the first declaration associated with that symbol. It does
    // this recursively if necessary. If a symbol lookup fails, undefined
    // is returned.
    function resolveAliasDeclaration(declaration: Declaration): Declaration | undefined {
        let curDeclaration: Declaration | undefined = declaration;
        const alreadyVisited: Declaration[] = [];

        while (true) {
            if (curDeclaration.type !== DeclarationType.Alias) {
                return curDeclaration;
            }

            if (!curDeclaration.symbolName) {
                return curDeclaration;
            }

            let lookupResult: ImportLookupResult | undefined;
            if (curDeclaration.path) {
                lookupResult = importLookup(curDeclaration.path);
                if (!lookupResult) {
                    return undefined;
                }
            }

            const symbol: Symbol | undefined = lookupResult
                ? lookupResult.symbolTable.get(curDeclaration.symbolName)
                : undefined;
            if (!symbol) {
                if (curDeclaration.submoduleFallback) {
                    return resolveAliasDeclaration(curDeclaration.submoduleFallback);
                }
                return undefined;
            }

            // Prefer declarations with specified types. If we don't have any of those,
            // fall back on declarations with inferred types.
            let declarations = symbol.getTypedDeclarations();
            if (declarations.length === 0) {
                declarations = symbol.getDeclarations();

                if (declarations.length === 0) {
                    return undefined;
                }
            }

            // Prefer the last declaration in the list. This ensures that
            // we use all of the overloads if it's an overloaded function.
            curDeclaration = declarations[declarations.length - 1];

            // Make sure we don't follow a circular list indefinitely.
            if (alreadyVisited.find(decl => decl === curDeclaration)) {
                return declaration;
            }
            alreadyVisited.push(curDeclaration);
        }
    }

    function getEffectiveTypeOfSymbol(symbol: Symbol): Type {
        // If there's a declared type, it takes precedence over
        // inferred types.
        if (symbol.hasTypedDeclarations()) {
            return getDeclaredTypeOfSymbol(symbol) || UnknownType.create();
        }

        // Infer the type.
        const typesToCombine: Type[] = [];
        const isPrivate = symbol.isPrivateMember();
        const decls = symbol.getDeclarations();
        const isFinalVar = isFinalVariable(symbol);

        decls.forEach(decl => {
            if (pushSymbolResolution(symbol, decl)) {
                let type = getInferredTypeOfDeclaration(decl);

                popSymbolResolution(symbol);

                if (type) {
                    const isConstant = decl.type === DeclarationType.Variable && !!decl.isConstant;

                    type = stripLiteralTypeArgsValue(type);

                    if (decl.type === DeclarationType.Variable) {
                        // If the symbol is private or constant, we can retain the literal
                        // value. Otherwise, strip them off to make the type less specific,
                        // allowing other values to be assigned to it in subclasses.
                        if (!isPrivate && !isConstant && !isFinalVar) {
                            type = stripLiteralValue(type);
                        }
                    }
                    typesToCombine.push(type);
                }
            }
        });

        return typesToCombine.length > 0 ? combineTypes(typesToCombine) : UnboundType.create();
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

            if (getIndexOfSymbolResolution(symbol, decl) < 0) {
                // If there's a partially-constructed type that is allowed
                // for recursive symbol resolution, return it as the resolved type.
                const partialType = getSymbolResolutionPartialType(symbol, decl);
                if (partialType) {
                    return partialType;
                }

                if (pushSymbolResolution(symbol, decl)) {
                    const type = getTypeForDeclaration(decl);

                    if (!popSymbolResolution(symbol)) {
                        return undefined;
                    }

                    return type;
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
    function getFunctionEffectiveReturnType(type: FunctionType, args?: ValidateArgTypeParams[]) {
        const specializedReturnType = FunctionType.getSpecializedReturnType(type);
        if (specializedReturnType) {
            return specializedReturnType;
        }

        return getFunctionInferredReturnType(type, args);
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
                if (returnType && FunctionType.isWrapReturnTypeInAwait(type) && !isNoReturnType(returnType)) {
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
            containsUnknown(returnType) &&
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
        if (args.some(arg => !arg.paramName)) {
            return undefined;
        }

        // Detect recurrence. If a function invokes itself either directly
        // or indirectly, we won't attempt to infer contextual return
        // types any further.
        if (returnTypeInferenceContextStack.some(context => context.functionNode === functionNode)) {
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

        // Enable speculative mode because we don't want to generate errors
        // or overwrite the type cache in this case.
        useSpeculativeMode(() => {
            // Allocate a new temporary type cache for the context of just
            // this function so we can analyze it separately without polluting
            // the main type cache.
            const prevTypeCache = returnTypeInferenceTypeCache;
            returnTypeInferenceContextStack.push({
                functionNode,
                codeFlowAnalyzer: createCodeFlowAnalyzer()
            });
            returnTypeInferenceTypeCache = new Map<number, CachedType>();

            let allArgTypesAreUnknown = true;
            functionNode.parameters.forEach((param, index) => {
                if (param.name) {
                    let paramType: Type | undefined;
                    const arg = args.find(arg => param.name!.value === arg.paramName);
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

            returnTypeInferenceContextStack.pop();
            returnTypeInferenceTypeCache = prevTypeCache;
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
        if (member.classType.category === TypeCategory.Class) {
            return partiallySpecializeType(getEffectiveTypeOfSymbol(member.symbol), member.classType);
        }
        return UnknownType.create();
    }

    function canAssignClassToProtocol(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        recursionCount: number
    ): boolean {
        const destClassFields = destType.details.fields;

        // Some protocol definitions include recursive references to themselves.
        // We need to protect against infinite recursion, so we'll check for that here.
        if (isTypeSame(srcType, destType)) {
            return true;
        }

        // Strip the type arguments off the dest protocol if they are provided.
        const genericDestType = ClassType.cloneForSpecialization(destType, undefined);
        const genericDestTypeVarMap = new TypeVarMap();

        let typesAreConsistent = true;
        const srcClassTypeVarMap = buildTypeVarMapFromSpecializedClass(srcType);

        destClassFields.forEach((symbol, name) => {
            if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                const memberInfo = lookUpClassMember(srcType, name);
                if (!memberInfo) {
                    diag.addMessage(`'${name}' is not present`);
                    typesAreConsistent = false;
                } else {
                    const declaredType = getDeclaredTypeOfSymbol(symbol);
                    if (declaredType) {
                        const srcMemberType = specializeType(
                            getTypeOfMember(memberInfo),
                            srcClassTypeVarMap,
                            false,
                            recursionCount + 1
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
                            diag.addMessage(`'${name}' is an incompatible type`);
                            typesAreConsistent = false;
                        }
                    }
                }
            }
        });

        // Now handle base classes of the dest protocol.
        destType.details.baseClasses.forEach(baseClass => {
            if (
                baseClass.category === TypeCategory.Class &&
                !ClassType.isBuiltIn(baseClass, 'object') &&
                !ClassType.isBuiltIn(baseClass, 'Protocol')
            ) {
                const specializedBaseClass = specializeForBaseClass(destType, baseClass, recursionCount + 1);
                if (!canAssignClassToProtocol(specializedBaseClass, srcType, diag, typeVarMap, recursionCount + 1)) {
                    typesAreConsistent = false;
                }
            }
        });

        // If the dest protocol has type parameters, make sure the source type arguments match.
        if (typesAreConsistent && destType.details.typeParameters.length > 0) {
            // Create a specialized version of the protocol defined by the dest and
            // make sure the resulting type args can be assigned.
            const specializedSrcProtocol = specializeType(
                genericDestType,
                genericDestTypeVarMap,
                false,
                recursionCount + 1
            ) as ClassType;
            if (!verifyTypeArgumentsAssignable(destType, specializedSrcProtocol, diag, typeVarMap, recursionCount)) {
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
                diag.addMessage(`'${name}' is missing from ${printType(srcType)}`);
                typesAreConsistent = false;
            } else {
                if (destEntry.isRequired && !srcEntry.isRequired) {
                    diag.addMessage(`'${name}' is required in ${printType(destType)}`);
                    typesAreConsistent = false;
                } else if (!destEntry.isRequired && srcEntry.isRequired) {
                    diag.addMessage(`'${name}' is not required in ${printType(destType)}`);
                    typesAreConsistent = false;
                }

                if (!isTypeSame(destEntry.valueType, srcEntry.valueType, recursionCount + 1)) {
                    diag.addMessage(`'${name}' is an incompatible type`);
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
            return canAssignClassToProtocol(destType, srcType, diag, typeVarMap, recursionCount);
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

            const fgetDest = destType.details.fields.get('fget');
            const fgetSrc = srcType.details.fields.get('fget');
            if (fgetDest && fgetSrc) {
                const fgetDestType = getDeclaredTypeOfSymbol(fgetDest);
                const fgetSrcType = getDeclaredTypeOfSymbol(fgetSrc);
                if (
                    fgetDestType &&
                    fgetSrcType &&
                    fgetDestType.category === TypeCategory.Function &&
                    fgetSrcType.category === TypeCategory.Function
                ) {
                    const fgetDestReturnType = getFunctionEffectiveReturnType(fgetDestType);
                    const fgetSrcReturnType = getFunctionEffectiveReturnType(fgetSrcType);
                    if (!canAssignType(fgetDestReturnType, fgetSrcReturnType, diag)) {
                        typesAreConsistent = false;
                    }
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
                    recursionCount + 1
                );
            }
        }

        const destErrorType = reportErrorsUsingObjType ? ObjectType.create(destType) : destType;
        const srcErrorType = reportErrorsUsingObjType ? ObjectType.create(srcType) : srcType;
        diag.addMessage(`'${printType(srcErrorType)}' is incompatible with ` + `'${printType(destErrorType)}'`);
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
        const specializedType = specializeType(baseClass, typeVarMap, false, recursionCount + 1);
        assert(specializedType.category === TypeCategory.Class);
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
        recursionCount: number
    ): boolean {
        let curSrcType = srcType;

        for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
            const ancestorType = inheritanceChain[ancestorIndex];

            // If we've hit an "unknown", all bets are off, and we need to assume
            // that the type is assignable.
            if (ancestorType.category === TypeCategory.Unknown) {
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
                    const destTypeArgs = destType.typeArguments || [];
                    let destArgCount = destTypeArgs.length;
                    const isDestHomogenousTuple = destArgCount === 2 && isEllipsisType(destTypeArgs[1]);
                    if (isDestHomogenousTuple) {
                        destArgCount = 1;
                    }

                    const srcTypeArgs = curSrcType.typeArguments || [];
                    let srcArgCount = srcTypeArgs.length;
                    const isSrcHomogeneousType = srcArgCount === 2 && isEllipsisType(srcTypeArgs[1]);
                    if (isSrcHomogeneousType) {
                        srcArgCount = 1;
                    }

                    if (srcArgCount > 0 && destArgCount > 0) {
                        if (srcTypeArgs.length === destArgCount || isDestHomogenousTuple || isSrcHomogeneousType) {
                            for (let i = 0; i < Math.max(destArgCount, srcArgCount); i++) {
                                const expectedDestType = isDestHomogenousTuple ? destTypeArgs[0] : destTypeArgs[i];
                                const expectedSrcType = isSrcHomogeneousType ? srcTypeArgs[0] : srcTypeArgs[i];

                                if (
                                    !canAssignType(
                                        expectedDestType,
                                        expectedSrcType,
                                        diag.createAddendum(),
                                        typeVarMap,
                                        CanAssignFlags.Default,
                                        recursionCount + 1
                                    )
                                ) {
                                    diag.addMessage(`Tuple entry ${i + 1} is incorrect type`);
                                    return false;
                                }
                            }
                        } else {
                            diag.addMessage(
                                `Tuple size mismatch: expected ${destArgCount}` + ` but got ${srcTypeArgs.length}`
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
            if (!verifyTypeArgumentsAssignable(ancestorType, curSrcType, diag, typeVarMap, recursionCount)) {
                return false;
            }
        }

        // If the dest type is specialized, make sure the specialized source
        // type arguments are assignable to the dest type arguments.
        if (destType.typeArguments) {
            if (!verifyTypeArgumentsAssignable(destType, curSrcType, diag, typeVarMap, recursionCount)) {
                return false;
            }
        }

        return true;
    }

    function verifyTypeArgumentsAssignable(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
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
                    const destTypeArg = destTypeArgs[destArgIndex];
                    const destTypeParam =
                        destArgIndex < destTypeParams.length ? destTypeParams[destArgIndex] : undefined;

                    if (!destTypeParam || destTypeParam.isCovariant) {
                        if (
                            !canAssignType(
                                destTypeArg,
                                srcTypeArg,
                                diag.createAddendum(),
                                typeVarMap,
                                CanAssignFlags.Default,
                                recursionCount + 1
                            )
                        ) {
                            if (destTypeParam) {
                                diag.addMessage(`Type variable '${destTypeParam.name}' is covariant`);
                            }
                            return false;
                        }
                    } else if (destTypeParam.isContravariant) {
                        if (
                            !canAssignType(
                                srcTypeArg,
                                destTypeArg,
                                diag.createAddendum(),
                                typeVarMap,
                                CanAssignFlags.ReverseTypeVarMatching,
                                recursionCount + 1
                            )
                        ) {
                            diag.addMessage(`Type variable '${destTypeParam.name}' is contravariant`);
                            return false;
                        }
                    } else {
                        if (
                            !canAssignType(
                                destTypeArg,
                                srcTypeArg,
                                diag.createAddendum(),
                                typeVarMap,
                                CanAssignFlags.EnforceInvariance,
                                recursionCount + 1
                            )
                        ) {
                            diag.addMessage(`Type variable '${destTypeParam.name}' is invariant`);
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
        const curTypeVarMapping = typeVarMap.get(destType.name);

        // Handle the constrained case.
        if (destType.constraints.length > 0) {
            // Find the first constrained type that is compatible.
            const constrainedType = destType.constraints.find(constraintType => {
                return canAssignType(constraintType, srcType, new DiagnosticAddendum());
            });

            if (!constrainedType) {
                diag.addMessage(
                    `Type '${printType(srcType)}' is not compatible with ` +
                        `constraints imposed by TypeVar '${destType.name}'`
                );
                return false;
            }

            if (curTypeVarMapping) {
                if (!isTypeSame(curTypeVarMapping, constrainedType)) {
                    diag.addMessage(
                        `Type '${printType(srcType)}' is not compatible with ` +
                            `constrained type '${printType(curTypeVarMapping)}'`
                    );
                    return false;
                }
            } else {
                // Assign the type to the type var.
                if (!typeVarMap.isLocked()) {
                    typeVarMap.set(destType.name, constrainedType, false);
                }
            }

            return true;
        }

        // Handle the unconstrained (but possibly bound) case.
        let updatedType = srcType;
        const curTypeIsNarrowable = typeVarMap.isNarrowable(destType.name) && !typeVarMap.isLocked();
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
                    if (!isAnyOrUnknown(curTypeVarMapping) && srcType.category !== TypeCategory.Unknown) {
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
                        `Type '${printType(srcType)}' cannot be assigned to ` + `type '${printType(curTypeVarMapping)}'`
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
                        if (curTypeVarMapping.category !== TypeCategory.Unknown) {
                            updatedType = curTypeVarMapping;
                        }
                    }
                } else {
                    if (typeVarMap.isLocked()) {
                        diag.addMessage(
                            `Type '${printType(curTypeVarMapping)}' cannot be assigned to ` +
                                `type '${printType(srcType)}'`
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
        if (destType.boundType) {
            if (
                !canAssignType(
                    destType.boundType,
                    updatedType,
                    diag.createAddendum(),
                    undefined,
                    flags,
                    recursionCount + 1
                )
            ) {
                diag.addMessage(
                    `Type '${printType(updatedType)}' is not compatible with ` +
                        `bound type '${printType(destType.boundType)}' for TypeVar '${destType.name}'`
                );
                return false;
            }
        }

        if (!typeVarMap.isLocked()) {
            typeVarMap.set(destType.name, updatedType, updatedTypeIsNarrowable);
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
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        if (destType === srcType) {
            return true;
        }

        // If the source or dest is unbound, allow the assignment. The
        // error will be reported elsewhere.
        if (destType.category === TypeCategory.Unbound || srcType.category === TypeCategory.Unbound) {
            return true;
        }

        // Strip the ReverseTypeVarMatching from the incoming flags.
        // We don't want to propagate this flag to any nested calls to
        // canAssignType.
        const reverseTypeVarMatching = (flags & CanAssignFlags.ReverseTypeVarMatching) !== 0;
        flags &= ~CanAssignFlags.ReverseTypeVarMatching;

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (destType.category === TypeCategory.TypeVar) {
            if (typeVarMap) {
                if (!assignTypeToTypeVar(destType, srcType, false, diag, typeVarMap, flags, recursionCount + 1)) {
                    return false;
                }
            }

            return true;
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
            return true;
        }

        if (srcType.category === TypeCategory.TypeVar) {
            // In most cases, the source type will be specialized before
            // canAssignType is called, so we won't get here. However, there
            // are cases where this can occur (e.g. when we swap the src and dest
            // types because they are contravariant).
            if (reverseTypeVarMatching && typeVarMap) {
                if (!assignTypeToTypeVar(srcType, destType, true, diag, typeVarMap, flags, recursionCount + 1)) {
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
                        `Type '${printType(srcType)}' cannot be assigned to ` + `type '${printType(destType)}'`
                    );
                    return false;
                }

                return true;
            }
        }

        if (srcType.category === TypeCategory.Union) {
            let isIncompatible = false;

            // For union sources, all of the types need to be assignable to the dest.
            srcType.subtypes.forEach(t => {
                if (!canAssignType(destType, t, diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
                    diag.addMessage(`Type '${printType(t)}' cannot be assigned to ` + `type '${printType(destType)}'`);
                    isIncompatible = true;
                }
            });

            if (isIncompatible) {
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
            // subtypes.
            destType.subtypes.forEach(subtype => {
                if (canAssignType(subtype, srcType, diagAddendum, typeVarMap, flags, recursionCount + 1)) {
                    foundMatch = true;
                }
            });

            if (!foundMatch) {
                diag.addAddendum(diagAddendum);
                return false;
            }
            return true;
        }

        if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
            return true;
        }

        // Is the src a specialized "Type" object?
        if (srcType.category === TypeCategory.Object && ClassType.isBuiltIn(srcType.classType, 'Type')) {
            const srcTypeArgs = srcType.classType.typeArguments;
            if (srcTypeArgs && srcTypeArgs.length >= 1) {
                if (isAnyOrUnknown(srcTypeArgs[0])) {
                    return true;
                } else if (srcTypeArgs[0].category === TypeCategory.Object) {
                    return canAssignType(
                        destType,
                        srcTypeArgs[0].classType,
                        diag.createAddendum(),
                        typeVarMap,
                        flags,
                        recursionCount + 1
                    );
                }
            }
        }

        if (destType.category === TypeCategory.Class) {
            if (srcType.category === TypeCategory.Class) {
                return canAssignClass(destType, srcType, diag, typeVarMap, flags, recursionCount + 1, false);
            }
        }

        if (destType.category === TypeCategory.Object) {
            const destClassType = destType.classType;

            // Is the dest a generic "type" object?
            if (ClassType.isBuiltIn(destClassType, 'type')) {
                if (
                    srcType.category === TypeCategory.Class ||
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
                    } else if (destTypeArgs[0].category === TypeCategory.Object) {
                        return canAssignType(
                            destTypeArgs[0].classType,
                            srcType,
                            diag.createAddendum(),
                            typeVarMap,
                            flags,
                            recursionCount + 1
                        );
                    } else if (destTypeArgs[0].category === TypeCategory.TypeVar) {
                        if (srcType.category === TypeCategory.Class) {
                            return canAssignType(
                                destTypeArgs[0],
                                ObjectType.create(srcType),
                                diag.createAddendum(),
                                typeVarMap,
                                flags,
                                recursionCount + 1
                            );
                        } else if (
                            srcType.category === TypeCategory.Function ||
                            srcType.category === TypeCategory.OverloadedFunction
                        ) {
                            return canAssignType(
                                destTypeArgs[0],
                                srcType,
                                diag.createAddendum(),
                                typeVarMap,
                                flags,
                                recursionCount + 1
                            );
                        }
                    }
                }
            }

            if (srcType.category === TypeCategory.Object) {
                const destLiteral = destType.literalValue;
                if (destLiteral !== undefined) {
                    const srcLiteral = srcType.literalValue;
                    if (srcLiteral !== destLiteral) {
                        diag.addMessage(
                            `'${srcLiteral ? printLiteralType(srcType) : printType(srcType)}' ` +
                                `cannot be assigned to '${printLiteralType(destType)}'`
                        );

                        return false;
                    }
                }

                if (
                    !canAssignClass(destClassType, srcType.classType, diag, typeVarMap, flags, recursionCount + 1, true)
                ) {
                    return false;
                }

                return true;
            } else if (srcType.category === TypeCategory.Function) {
                // Is the destination a callback protocol (defined in PEP 544)?
                const callbackType = getCallbackProtocolType(destType);
                if (callbackType) {
                    if (
                        !canAssignFunction(
                            callbackType,
                            srcType,
                            diag.createAddendum(),
                            typeVarMap,
                            recursionCount + 1,
                            true
                        )
                    ) {
                        return false;
                    }
                    return true;
                }

                // All functions are assignable to "object".
                if (ClassType.isBuiltIn(destType.classType) && destType.classType.details.name === 'object') {
                    return true;
                }
            } else if (srcType.category === TypeCategory.Module) {
                // Is the destination the built-in "ModuleType"?
                if (ClassType.isBuiltIn(destClassType, 'ModuleType')) {
                    return true;
                }
            } else if (srcType.category === TypeCategory.Class) {
                // All classes are assignable to "object".
                if (ClassType.isBuiltIn(destType.classType, 'object')) {
                    return true;
                }

                // Determine if the metaclass can be assigned to the object.
                const metaclass = getMetaclass(srcType);
                if (metaclass) {
                    if (isAnyOrUnknown(metaclass)) {
                        return true;
                    } else if (metaclass.category === TypeCategory.Class) {
                        // Handle EnumMeta, which requires special-case handling because
                        // of the way it's defined in enum.pyi. The type var _T must be
                        // manually set to the corresponding enum object type.
                        if (typeVarMap && ClassType.isBuiltIn(metaclass, 'EnumMeta')) {
                            if (!typeVarMap.isLocked()) {
                                typeVarMap.set('_T', ObjectType.create(srcType), false);
                            }
                        }

                        return canAssignClass(
                            destClassType,
                            metaclass,
                            diag,
                            typeVarMap,
                            flags,
                            recursionCount + 1,
                            false
                        );
                    }
                }
            }
        }

        if (destType.category === TypeCategory.Function) {
            let srcFunction: FunctionType | undefined;

            if (srcType.category === TypeCategory.OverloadedFunction) {
                // Find first overloaded function that matches the parameters.
                // We don't want to pollute the current typeVarMap, so we'll
                // make a copy of the existing one if it's specified.
                const overloads = srcType.overloads;
                const overloadIndex = overloads.findIndex(overload => {
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
                    diag.addMessage(`No overloaded function matches type '${printType(destType)}'.`);
                    return false;
                }
                srcFunction = overloads[overloadIndex];
            } else if (srcType.category === TypeCategory.Function) {
                srcFunction = srcType;
            } else if (srcType.category === TypeCategory.Object) {
                const callMember = lookUpObjectMember(srcType, '__call__');
                if (callMember) {
                    const memberType = getTypeOfMember(callMember);
                    if (memberType.category === TypeCategory.Function) {
                        srcFunction = stripFirstParameter(memberType);
                    }
                }
            } else if (srcType.category === TypeCategory.Class) {
                // Synthesize a function that represents the constructor for this class.
                const constructorFunction = FunctionType.create(
                    FunctionTypeFlags.StaticMethod |
                        FunctionTypeFlags.ConstructorMethod |
                        FunctionTypeFlags.SynthesizedMethod
                );
                constructorFunction.details.declaredReturnType = ObjectType.create(srcType);

                const newMemberInfo = lookUpClassMember(
                    srcType,
                    '__new__',
                    ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                );
                const memberType = newMemberInfo ? getTypeOfMember(newMemberInfo) : undefined;
                if (memberType && memberType.category === TypeCategory.Function) {
                    memberType.details.parameters.forEach((param, index) => {
                        // Skip the 'cls' parameter.
                        if (index > 0) {
                            FunctionType.addParameter(constructorFunction, param);
                        }
                    });
                } else {
                    addDefaultFunctionParameters(constructorFunction);
                }

                srcFunction = constructorFunction;
            }

            if (srcFunction) {
                return canAssignFunction(
                    destType,
                    srcFunction,
                    diag.createAddendum(),
                    typeVarMap,
                    recursionCount + 1,
                    false
                );
            }
        }

        // NoneType and ModuleType derive from object.
        if (isNoneOrNever(srcType) || srcType.category === TypeCategory.Module) {
            if (destType.category === TypeCategory.Object) {
                const destClassType = destType.classType;
                if (ClassType.isBuiltIn(destClassType, 'object')) {
                    return true;
                }
            }
        }

        if (isNoneOrNever(destType)) {
            diag.addMessage(`Cannot assign to 'None'`);
            return false;
        }

        diag.addMessage(`'${printType(srcType)}' ` + `cannot be assigned to '${printType(destType)}'`);
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
            return bindFunctionToClassOrObject(objType, memberType) as FunctionType;
        }

        return undefined;
    }

    function canAssignFunction(
        destType: FunctionType,
        srcType: FunctionType,
        diag: DiagnosticAddendum,
        typeVarMap: TypeVarMap | undefined,
        recursionCount: number,
        checkNamedParams: boolean
    ): boolean {
        let canAssign = true;

        // Count the number of parameters that have names. We'll exclude
        // pseudo-parameters (* and /) that designate name-only and position-only
        // separators.
        const srcParamCount = srcType.details.parameters.filter(param => param.name).length;
        const destParamCount = destType.details.parameters.filter(param => param.name).length;
        const minParamCount = Math.min(srcParamCount, destParamCount);

        // Match as many input parameters as we can.
        for (let paramIndex = 0; paramIndex < minParamCount; paramIndex++) {
            const srcParam = srcType.details.parameters[paramIndex];
            const destParam = destType.details.parameters[paramIndex];
            const paramDiag = diag.createAddendum();

            // If the dest or source involve var-args, no need to continue matching.
            if (srcParam.category !== ParameterCategory.Simple || destParam.category !== ParameterCategory.Simple) {
                break;
            }

            const srcParamType = FunctionType.getEffectiveParameterType(srcType, paramIndex);
            const destParamType = FunctionType.getEffectiveParameterType(destType, paramIndex);

            // Call canAssignType once to perform any typeVarMap population.
            canAssignType(
                srcParamType,
                destParamType,
                paramDiag.createAddendum(),
                typeVarMap,
                CanAssignFlags.ReverseTypeVarMatching,
                recursionCount + 1
            );

            // Make sure we can assign the specialized dest type to the
            // source type.
            const specializedDestParamType = specializeType(destParamType, typeVarMap, false, recursionCount + 1);

            if (
                !canAssignType(
                    srcParamType,
                    specializedDestParamType,
                    paramDiag.createAddendum(),
                    undefined,
                    CanAssignFlags.Default,
                    recursionCount + 1
                )
            ) {
                paramDiag.addMessage(
                    `Parameter ${paramIndex + 1} of type ` +
                        `'${printType(specializedDestParamType)}' cannot be assigned to type ` +
                        `'${printType(srcParamType)}'`
                );
                canAssign = false;
            }
        }

        const srcParams = srcType.details.parameters;
        const destParams = destType.details.parameters;

        const srcHasVarArgs =
            srcParams.find(param => param.name && param.category !== ParameterCategory.Simple) !== undefined;
        const destHasVarArgs =
            destParams.find(param => param.name && param.category !== ParameterCategory.Simple) !== undefined;

        if (checkNamedParams) {
            // Handle matching of named (keyword) parameters.
            // Build a dictionary of named parameters in the dest.
            const destParamMap = new Map<string, FunctionParameter>();
            let destHasNamedParam = false;
            destParams.forEach(param => {
                if (destHasNamedParam) {
                    if (param.name && param.category === ParameterCategory.Simple) {
                        destParamMap.set(param.name, param);
                    }
                } else if (param.category === ParameterCategory.VarArgList) {
                    destHasNamedParam = true;
                }
            });

            let srcHasNamedParam = false;
            srcParams.forEach(param => {
                if (srcHasNamedParam) {
                    if (param.name && param.category === ParameterCategory.Simple) {
                        const destParam = destParamMap.get(param.name);
                        const paramDiag = diag.createAddendum();
                        if (!destParam) {
                            paramDiag.addMessage(`Named parameter '${param.name}' is missing in destination`);
                            canAssign = false;
                        } else {
                            const specializedDestParamType = specializeType(
                                destParam.type,
                                typeVarMap,
                                false,
                                recursionCount + 1
                            );
                            if (
                                !canAssignType(
                                    param.type,
                                    specializedDestParamType,
                                    paramDiag.createAddendum(),
                                    undefined,
                                    CanAssignFlags.Default,
                                    recursionCount + 1
                                )
                            ) {
                                paramDiag.addMessage(
                                    `Named parameter '${param.name}' of type ` +
                                        `'${printType(specializedDestParamType)}' cannot be assigned to type ` +
                                        `'${printType(param.type)}'`
                                );
                                canAssign = false;
                            }
                            destParamMap.delete(param.name);
                        }
                    }
                } else if (param.category === ParameterCategory.VarArgList) {
                    srcHasNamedParam = true;
                }
            });

            // See if there are any unmatched named parameters.
            destParamMap.forEach((_, paramName) => {
                const paramDiag = diag.createAddendum();
                paramDiag.addMessage(`Named parameter '${paramName}' is missing in source`);
                canAssign = false;
            });
        }

        // If we didn't find a var-arg parameter, the number of dest params
        // must be enough to provide all of the non-default source params
        // with values. Plus, the number of source params must be enough to
        // accept all of the dest arguments.
        if (!srcHasVarArgs && !destHasVarArgs) {
            const nonDefaultSrcParamCount = srcParams.filter(param => !!param.name && !param.hasDefault).length;

            if (destParamCount < nonDefaultSrcParamCount) {
                diag.addMessage(
                    `Function accepts too few parameters. Expected ` +
                        `${nonDefaultSrcParamCount} but got ${destParamCount}.`
                );
                canAssign = false;
            }

            if (destParamCount > srcParamCount) {
                diag.addMessage(
                    `Function accepts too many parameters. Expected ` + `${srcParamCount} but got ${destParamCount}.`
                );
                canAssign = false;
            }
        }

        // Match the return parameter.
        const destReturnType = getFunctionEffectiveReturnType(destType);
        if (!isAnyOrUnknown(destReturnType)) {
            const srcReturnType = getFunctionEffectiveReturnType(srcType);

            if (
                !canAssignType(
                    destReturnType,
                    srcReturnType,
                    diag.createAddendum(),
                    typeVarMap,
                    CanAssignFlags.Default,
                    recursionCount + 1
                )
            ) {
                diag.addMessage(
                    `Function return type '${printType(srcReturnType)}' ` +
                        `is not compatible with type '${printType(destReturnType)}'.`
                );
                canAssign = false;
            }
        }

        return canAssign;
    }

    // When a variable with a declared type is assigned and the declared
    // type is a union, we may be able to further narrow the type.
    function narrowDeclaredTypeBasedOnAssignedType(declaredType: Type, assignedType: Type): Type {
        const diagAddendum = new DiagnosticAddendum();

        if (declaredType.category === TypeCategory.Union) {
            return doForSubtypes(declaredType, subtype => {
                if (assignedType.category === TypeCategory.Union) {
                    if (!assignedType.subtypes.some(t => canAssignType(subtype, t, diagAddendum))) {
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

        return declaredType;
    }

    function canOverrideMethod(baseMethod: Type, overrideMethod: FunctionType, diag: DiagnosticAddendum): boolean {
        // If we're overriding an overloaded method, uses the last overload.
        if (baseMethod.category === TypeCategory.OverloadedFunction) {
            baseMethod = baseMethod.overloads[baseMethod.overloads.length - 1];
        }

        // If we're overriding a non-method with a method, report it as an error.
        // This occurs when a non-property overrides a property.
        if (baseMethod.category !== TypeCategory.Function) {
            diag.addMessage(`Base class defines type as ${printType(baseMethod)}`);
            return false;
        }

        let canOverride = true;
        const baseParams = baseMethod.details.parameters;
        const overrideParams = overrideMethod.details.parameters;

        if (baseParams.length !== overrideParams.length) {
            diag.addMessage(
                `Parameter count mismatch: base method has ` +
                    `${baseParams.length}, but override has ${overrideParams.length}`
            );
            return false;
        }

        const paramCount = Math.min(baseParams.length, overrideParams.length);
        for (let i = 0; i < paramCount; i++) {
            const baseParam = baseParams[i];
            const overrideParam = overrideParams[i];

            if (baseParam.name !== overrideParam.name) {
                diag.addMessage(
                    `Parameter ${i + 1} name mismatch: ` +
                        `base parameter is named '${baseParam.name || '*'}, ` +
                        `override parameter is named '${overrideParam.name || '*'}'`
                );
                canOverride = false;
            } else {
                const baseParamType = FunctionType.getEffectiveParameterType(baseMethod, i);
                const overrideParamType = FunctionType.getEffectiveParameterType(overrideMethod, i);

                if (!canAssignType(baseParamType, overrideParamType, diag.createAddendum())) {
                    diag.addMessage(
                        `Parameter ${i + 1} type mismatch: ` +
                            `base method parameter is type '${printType(baseParamType)}, ` +
                            `override is type '${printType(overrideParamType)}'`
                    );
                    canOverride = false;
                }
            }
        }

        const baseReturnType = getFunctionEffectiveReturnType(baseMethod);
        const overrideReturnType = getFunctionEffectiveReturnType(overrideMethod);
        if (!canAssignType(baseReturnType, overrideReturnType, diag.createAddendum())) {
            diag.addMessage(
                `Return type mismatch: ` +
                    `base method returns type '${printType(baseReturnType)}', ` +
                    `override is type '${printType(overrideReturnType)}'`
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

        let effectiveSrcType = srcType;

        // If the source type is a type var itself, convert it to a concrete
        // type to see if it is compatible with the dest type.
        if (srcType.category === TypeCategory.TypeVar) {
            if (isTypeSame(srcType, destType)) {
                return true;
            }

            effectiveSrcType = getConcreteTypeFromTypeVar(srcType, recursionCount + 1);
        }

        // If there's a bound type, make sure the source is derived from it.
        const boundType = destType.boundType;
        if (boundType) {
            if (
                !canAssignType(boundType, effectiveSrcType, diag.createAddendum(), undefined, flags, recursionCount + 1)
            ) {
                diag.addMessage(
                    `Type '${printType(effectiveSrcType)}' is not compatible with ` +
                        `bound type '${printType(boundType)}' for TypeVar '${destType.name}'`
                );
                return false;
            }
        }

        // If there are no constraints, we're done.
        const constraints = destType.constraints;
        if (constraints.length === 0) {
            return true;
        }

        // Try to find a match among the constraints.
        for (const constraint of constraints) {
            if (isAnyOrUnknown(constraint)) {
                return true;
            } else if (effectiveSrcType.category === TypeCategory.Union) {
                // Does it match at least one of the constraints?
                if (effectiveSrcType.subtypes.find(t => isSameWithoutLiteralValue(constraint, t))) {
                    return true;
                }
            } else if (isSameWithoutLiteralValue(constraint, effectiveSrcType)) {
                return true;
            }
        }

        diag.addMessage(
            `Type '${printType(effectiveSrcType)}' is not compatible with ` +
                `constraints imposed by TypeVar '${destType.name}'`
        );

        return false;
    }

    function doesClassHaveAbstractMethods(classType: ClassType): boolean {
        const symbolMap = new Map<string, AbstractMethod>();
        getAbstractMethodsRecursive(classType, symbolMap);

        let abstractMethodCount = 0;
        symbolMap.forEach(entry => {
            if (entry.isAbstract) {
                abstractMethodCount++;
            }
        });

        return abstractMethodCount > 0;
    }

    function getAbstractMethodsRecursive(
        classType: ClassType,
        symbolTable: Map<string, AbstractMethod>,
        recursiveCount = 0
    ) {
        // Protect against infinite recursion.
        if (recursiveCount > maxTypeRecursionCount) {
            return;
        }

        const baseClasses: ClassType[] = [];
        classType.details.baseClasses.forEach(baseClass => {
            if (baseClass.category === TypeCategory.Class) {
                baseClasses.push(baseClass);
            }
        });

        // See if this class is introducing a new abstract method that has not been
        // introduced previously or if it is overriding an abstract method with
        // a non-abstract one.
        classType.details.fields.forEach((symbol, symbolName) => {
            // We do a quick-and-dirty evaluation of methods based on
            // decorators to determine which ones are abstract. This allows
            // us to avoid evaluating the full function types.
            const decl = getLastTypedDeclaredForSymbol(symbol);
            if (symbol.isClassMember() && decl && decl.type === DeclarationType.Function) {
                const functionFlags = getFunctionFlagsFromDecorators(decl.node, true);

                if (!symbolTable.has(symbolName)) {
                    const isAbstract = !!(functionFlags & FunctionTypeFlags.AbstractMethod);
                    symbolTable.set(symbolName, {
                        symbol,
                        isAbstract,
                        classType
                    });
                }
            }
        });

        // Recursively get abstract methods for subclasses. This is expensive,
        // so we'll check it only if one or more of the base classes is known
        // to have abstract methods.
        if (baseClasses.some(baseClass => ClassType.hasAbstractMethods(baseClass))) {
            for (const baseClass of baseClasses) {
                getAbstractMethodsRecursive(baseClass, symbolTable, recursiveCount + 1);
            }
        }
    }

    // Determines whether the specified keys and values can be assigned to
    // a typed dictionary class. The caller should have already validated
    // that the class is indeed a typed dict.
    function canAssignToTypedDict(classType: ClassType, keyTypes: Type[], valueTypes: Type[]): boolean {
        assert(ClassType.isTypedDictClass(classType));
        assert(keyTypes.length === valueTypes.length);

        let isMatch = true;

        const symbolMap = getTypedDictMembersForClass(classType);
        const diag = new DiagnosticAddendum();

        keyTypes.forEach((keyType, index) => {
            if (
                keyType.category !== TypeCategory.Object ||
                !ClassType.isBuiltIn(keyType.classType, 'str') ||
                !keyType.literalValue
            ) {
                isMatch = false;
            } else {
                const keyValue = keyType.literalValue as string;
                const symbolEntry = symbolMap.get(keyValue);

                if (!symbolEntry) {
                    // The provided key name doesn't exist.
                    isMatch = false;
                } else {
                    // Can we assign the value to the declared type?
                    if (!canAssignType(symbolEntry.valueType, valueTypes[index], diag)) {
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
        symbolMap.forEach(entry => {
            if (entry.isRequired && !entry.isProvided) {
                isMatch = false;
            }
        });

        return isMatch;
    }

    function getTypedDictMembersForClass(classType: ClassType) {
        const entries = new Map<string, TypedDictEntry>();
        getTypedDictMembersForClassRecursive(classType, entries);
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

        classType.details.baseClasses.forEach(baseClassType => {
            if (baseClassType.category === TypeCategory.Class && ClassType.isTypedDictClass(baseClassType)) {
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
                        isProvided: false
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
        treatAsClassMember = false
    ): Type {
        if (memberType.category === TypeCategory.Function) {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return stripFirstParameter(memberType);
            } else if (FunctionType.isInstanceMethod(memberType) && !treatAsClassMember) {
                if (baseType.category === TypeCategory.Object) {
                    return partiallySpecializeFunctionForBoundClassOrObject(baseType, memberType);
                }
            } else if (FunctionType.isClassMethod(memberType) || treatAsClassMember) {
                return partiallySpecializeFunctionForBoundClassOrObject(
                    baseType.category === TypeCategory.Class ? baseType : baseType.classType,
                    memberType
                );
            }
        } else if (memberType.category === TypeCategory.OverloadedFunction) {
            const newOverloadType = OverloadedFunctionType.create();
            memberType.overloads.forEach(overload => {
                OverloadedFunctionType.addOverload(
                    newOverloadType,
                    bindFunctionToClassOrObject(baseType, overload, treatAsClassMember) as FunctionType
                );
            });

            return newOverloadType;
        }

        return memberType;
    }

    function partiallySpecializeFunctionForBoundClassOrObject(
        baseType: ClassType | ObjectType,
        memberType: FunctionType
    ): Type {
        const classType = baseType.category === TypeCategory.Class ? baseType : baseType.classType;

        // If the class has already been specialized (fully or partially), use its
        // existing type arg mappings. If it hasn't, use a fresh type arg map.
        const typeVarMap = classType.typeArguments ? buildTypeVarMapFromSpecializedClass(classType) : new TypeVarMap();

        if (memberType.details.parameters.length > 0) {
            const firstParam = memberType.details.parameters[0];

            // Fill out the typeVarMap.
            canAssignType(firstParam.type, baseType, new DiagnosticAddendum(), typeVarMap);
        }

        const specializedFunction = specializeType(memberType, typeVarMap, false) as FunctionType;
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
                    objName +=
                        '[' +
                        type.typeArguments
                            .map(typeArg => {
                                return printType(typeArg, recursionCount + 1);
                            })
                            .join(', ') +
                        ']';
                } else {
                    if (ClassType.isBuiltIn(type, 'Tuple')) {
                        objName += '[()]';
                    }
                }
            } else {
                const typeParams = ClassType.getTypeParameters(type);

                if (typeParams.length > 0) {
                    objName +=
                        '[' +
                        typeParams
                            .map(typeArg => {
                                return printType(typeArg, recursionCount + 1);
                            })
                            .join(', ') +
                        ']';
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

            if (param.category === ParameterCategory.Simple) {
                if (param.name) {
                    const paramType = FunctionType.getEffectiveParameterType(type, index);
                    const paramTypeString =
                        recursionCount < maxTypeRecursionCount ? printType(paramType, recursionCount + 1) : '';
                    paramString += ': ' + paramTypeString;
                } else {
                    paramString += '/';
                }
            }

            if (type.details.declaration) {
                const adjustedIndex = type.ignoreFirstParamOfDeclaration ? index + 1 : index;
                const paramNode = type.details.declaration.node.parameters[adjustedIndex];
                if (paramNode.defaultValue) {
                    paramString += ' = ' + ParseTreeUtils.printExpression(paramNode.defaultValue);
                }
            }

            return paramString;
        });

        const returnType = getFunctionEffectiveReturnType(type);
        const returnTypeString =
            recursionCount < maxTypeRecursionCount ? printType(returnType, recursionCount + 1) : '';
        return [paramTypeStrings, returnTypeString];
    }

    function printType(type: Type, recursionCount = 0): string {
        if (recursionCount >= maxTypeRecursionCount) {
            return '';
        }

        switch (type.category) {
            case TypeCategory.Unbound: {
                return 'Unbound';
            }

            case TypeCategory.Unknown: {
                return 'Unknown';
            }

            case TypeCategory.Module: {
                return 'Module';
            }

            case TypeCategory.Class: {
                return 'Type[' + printObjectTypeForClass(type, recursionCount + 1) + ']';
            }

            case TypeCategory.Object: {
                const objType = type;
                if (objType.literalValue !== undefined) {
                    return printLiteralType(objType);
                }

                if (isProperty(type)) {
                    const getterInfo = lookUpObjectMember(type, 'fget');
                    if (getterInfo) {
                        const getter = getTypeOfMember(getterInfo);
                        if (getter.category === TypeCategory.Function) {
                            const returnType = getFunctionEffectiveReturnType(getter);
                            return printType(returnType, recursionCount + 1);
                        }
                    }
                }

                return printObjectTypeForClass(objType.classType, recursionCount + 1);
            }

            case TypeCategory.Function: {
                const parts = printFunctionParts(type, recursionCount);
                return `(${parts[0].join(', ')}) -> ${parts[1]}`;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedType = type;
                const overloads = overloadedType.overloads.map(overload => printType(overload, recursionCount + 1));
                return `Overload[${overloads.join(', ')}]`;
            }

            case TypeCategory.Union: {
                const unionType = type;
                let subtypes: Type[] = unionType.subtypes;

                if (subtypes.find(t => t.category === TypeCategory.None) !== undefined) {
                    const optionalType = printType(removeNoneFromUnion(unionType), recursionCount + 1);
                    return 'Optional[' + optionalType + ']';
                }

                // Make a shallow copy of the array so we can manipulate it.
                subtypes = [];
                subtypes = subtypes.concat(...unionType.subtypes);

                const isLiteral = (type: Type) =>
                    type.category === TypeCategory.Object && type.literalValue !== undefined;

                const subtypeStrings: string[] = [];
                while (subtypes.length > 0) {
                    const subtype = subtypes.shift()!;
                    if (isLiteral(subtype)) {
                        // Combine all literal values. Rather than printing Union[Literal[1],
                        // Literal[2]], print Literal[1, 2].
                        const literals = subtypes.filter(t => isLiteral(t));
                        literals.unshift(subtype);
                        const literalValues = literals.map(t => printLiteralValue(t as ObjectType));
                        subtypeStrings.push(`Literal[${literalValues.join(', ')}]`);

                        // Remove the items we've handled.
                        if (literals.length > 1) {
                            subtypes = subtypes.filter(t => !isLiteral(t));
                        }
                    } else {
                        subtypeStrings.push(printType(subtype, recursionCount + 1));
                    }
                }

                if (subtypeStrings.length === 1) {
                    return subtypeStrings[0];
                }

                return `Union[${subtypeStrings.join(', ')}]`;
            }

            case TypeCategory.TypeVar: {
                // If it's synthesized, don't expose the internal
                // name we generated. This will confuse users.
                if (type.isSynthesized) {
                    return 'Unknown';
                }

                const typeName = type.name;

                // Print the name in a simplified form if it's embedded
                // inside another type string.
                if (recursionCount > 0) {
                    return typeName;
                }
                const params: string[] = [`'${typeName}'`];
                for (const constraint of type.constraints) {
                    params.push(printType(constraint, recursionCount + 1));
                }
                return 'TypeVar[' + params.join(', ') + ']';
            }

            case TypeCategory.None: {
                return 'None';
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
            parseOptions,
            true
        );

        if (parseResults.parseTree) {
            parseResults.diagnostics.forEach(diag => {
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
        verifyDeleteExpression,
        isAfterNodeReachable,
        isNodeReachable,
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
        canAssignType,
        canOverrideMethod,
        addError,
        addWarning,
        addDiagnostic,
        addDiagnosticForTextRange,
        printType,
        printFunctionParts,
        hasGrownTooLarge
    };
}
