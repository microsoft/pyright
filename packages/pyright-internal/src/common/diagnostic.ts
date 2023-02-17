/*
 * diagnostics.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents errors and warnings.
 */

import { Commands } from '../commands/commands';
import { appendArray } from './collectionUtils';
import { DiagnosticLevel } from './configOptions';
import { Range, TextRange } from './textRange';

const defaultMaxDepth = 5;
const defaultMaxLineCount = 8;
const maxRecursionCount = 64;

// Corresponds to the CommentTaskPriority enum at https://devdiv.visualstudio.com/DefaultCollection/DevDiv/_git/VS?path=src/env/shell/PackageFramework/Framework/CommentTaskPriority.cs
export enum TaskListPriority {
    High = 'High',
    Normal = 'Normal',
    Low = 'Low',
}

export interface TaskListToken {
    text: string;
    priority: TaskListPriority;
}

export const enum ActionKind {
    RenameShadowedFileAction = 'renameShadowedFile',
}

export const enum DiagnosticCategory {
    Error,
    Warning,
    Information,
    UnusedCode,
    UnreachableCode,
    Deprecated,
    TaskItem,
}

export function convertLevelToCategory(level: DiagnosticLevel) {
    switch (level) {
        case 'error':
            return DiagnosticCategory.Error;

        case 'warning':
            return DiagnosticCategory.Warning;

        case 'information':
            return DiagnosticCategory.Information;

        default:
            throw new Error(`${level} is not expected`);
    }
}

export interface DiagnosticAction {
    action: string;
}

export interface DiagnosticWithinFile {
    filePath: string;
    diagnostic: Diagnostic;
}

export interface CreateTypeStubFileAction extends DiagnosticAction {
    action: Commands.createTypeStub;
    moduleName: string;
}

export interface AddMissingOptionalToParamAction extends DiagnosticAction {
    action: Commands.addMissingOptionalToParam;
    offsetOfTypeNode: number;
}

export interface RenameShadowedFileAction extends DiagnosticAction {
    action: ActionKind.RenameShadowedFileAction;
    oldFile: string;
    newFile: string;
}

export interface DiagnosticRelatedInfo {
    message: string;
    filePath: string;
    range: Range;
    priority: TaskListPriority;
}

// Unique identifiers for every type of diagnostic produced.
//
// This is used to generate links for describing these errors and allows for a non localized
// method for lookup by users.
//
// Note this is why it's a const enum. The links use the number, not the text.

export const enum DiagnosticIdentifier {
    CodeTooComplex = 1000,
    NamedParamAfterParamSpecArgs,
    ParamTypeUnknown,
    ParamTypePartiallyUnknown,
    ParamAnnotationMissing,
    ParamTypeCovariant,
    TypeCommentDeprecated,
    StubUsesGetAttr,
    LambdaReturnTypeUnknown,
    LambdaReturnTypePartiallyUnknown,
    UnusedCallResult,
    UnusedCoroutine,
    AnnotationNotSupported_ForLoop,
    AnnotationNotSupported_WithStatement,
    NoReturnContainsReturn,
    ReturnTypeContainsMismatch,
    ReturnTypeUnknown,
    ReturnTypePartiallyUnknown,
    AssertAlwaysTrue,
    TupleIndexOutOfRange,
    UnescapeErrorType_InvalidEscapeSequence,
    UnescapeErrorType_EscapeWithinFormatExpression,
    UnescapeErrorType_SingleCloseBraceWithFormatLiteral,
    UnescapeErrorType_UnterminatedFormatExpression,
    ImplicitStringConcat,
    WildcardLibraryImport,
    ImportSourceResolveFailure,
    FunctionInConditionalExpression,
    UnusedExpression,
    MatchIsNotExhaustive,
    DefaultValueContainsCall,
    CollectionAliasInstantiation,
    ContainmentAlwaysFalse,
    ContainmentAlwaysTrue,
    ComparisonAlwaysFalse,
    ComparisonAlwaysTrue,
    TypeVarUsedOnlyOnce,
    TypeVarPossiblyUnsolvable,
    OverlappingOverload,
    OverloadReturnTypeMismatch,
    InvalidStubStatement,
    DunderAllSymbolNotPresent,
    SingleOverload,
    OverloadWithImplementation,
    OverloadWithoutImplementation,
    OverloadImplementationMismatch,
    ObscuredClassDeclaration,
    ObscuredMethodDeclaration,
    ObscuredFunctionDeclaration,
    ObscuredParameterDeclaration,
    ObscuredTypeAliasDeclaration,
    UnaccessedImport,
    UnaccessedVariable,
    UnaccessedFunction,
    UnaccessedClass,
    UnaccessedSymbol,
    StdlibModuleOverridden,
    ProtectedUsedOutsideOfClass,
    PrivateUsedOutsideOfClass,
    EnumClassOverride,
    TypeGuardParamCount,
    StrictTypeGuardReturnType,
    InitMustReturnNone_DeclaredType,
    InitMustReturnNone_ImplicitReturn,
    DeclaredReturnTypeUnknown,
    DeclaredReturnTypePartiallyUnknown,
    ReturnTypeContravariant,
    NoReturnReturnsNone,
    ReturnMissing,
    MissingProtocolMembers,
    DataClassPostInitParamCount,
    DataClassPostInitType,
    FinalClassIsAbstract,
    UninitializedInstanceVariable,
    ProtocolVarianceContravariant,
    ProtocolVarianceCovariant,
    ProtocolVarianceInvariant,
    SlotsClassVarConflict,
    ConstructorParametersMismatch,
    BaseClassMethodTypeIncompatible,
    BaseClassVariableTypeIncompatible,
    OverrideNotFound,
    IncompatibleMethodOverride,
    MethodOverridden,
    PropertyOverridden,
    SymbolOverridden,
    VariableFinalOverride,
    ClassVarOverridesInstanceVar,
    InstanceVarOverridesClassVar,
    NewClsParam,
    InitSubclassClsParam,
    ClassGetItemClsParam,
    StaticClsSelfParam,
    ClassMethodClsParam,
    InstanceMethodSelfParam,
    MissingSuperCall,
    ClsSelfParamTypeMismatch,
    GeneratorAsyncReturnType,
    GeneratorSyncReturnType,
    NoReturnContainsYield,
    YieldTypeMismatch,
    UnreachableExcept,
    DuplicateImport,
    UnmatchedEndregionComment,
    UnmatchedRegionComment,
    ArgAssignmentParamFunction,
    ArgPositionalExpectedOne,
    ArgPositionalExpectedCount,
    ParamNameMissing,
    ParamAlreadyAssigned,
    DataClassFieldWithDefault,
    DataClassFieldWithoutAnnotation,
    DataClassBaseClassNotFrozen,
    DataClassBaseClassFrozen,
    DataClassSlotsOverwrite,
    TotalOrderingMissingMethod,
    TypeNotClass,
    ClassPatternTypeAlias,
    ClassPatternBuiltInArgCount,
    ClassPatternBuiltInArgPositional,
    PropertyStaticMethod,
    SetterGetterTypeMismatch,
    TypedDictFieldRedefinition,
    TypedDictSet,
    TypedDictDelete,
    TypedDictAccess,
    TypeParameterExistingTypeParameter,
    AssignmentExprContext,
    AssignmentExprComprehension,
    AsyncNotInAsyncFunction,
    YieldWithinListCompr,
    AwaitNotInAsync,
    NonLocalRedefinition,
    GlobalReassignment,
    NonLocalInModule,
    GlobalRedefinition,
    NonLocalReassignment,
    NonLocalNoBinding,
    WildcardInFunction,
    TypeAliasNotInModuleOrClass,
    YieldOutsideFunction,
    YieldFromOutsideAsync,
    ImportResolveFailure,
    StubFileMissing,
    UnsupportedDunderAllOperation,
    AnnotationNotSupported_ChainedTypeComment,
    AnnotationNotSupported_Variable,
    UnnecessaryContains,
    UnnecessaryComparison,
    InvalidTypeVarUse,
    ObscuredVariableDeclaration,
    InstanceInvalidType,
    SubclassInvalidType,
    UnnecessaryIsInstanceAlways,
    UnnecessaryIsSubclassAlways,
    DeprecatedClass,
    DeprecatedFunction,
    DeprecatedType,
    SymbolIsUnbound,
    SymbolIsPossiblyUnbound,
    ExpectedTypeNotString,
    ModuleAsType,
    ClassDefinitionCycle,
    ProtocolMemberNotClassVar,
    TypeNotAwaitable,
}
// Represents a single error or warning.
export class Diagnostic {
    private _actions: DiagnosticAction[] | undefined;
    private _rule: string | undefined;
    private _relatedInfo: DiagnosticRelatedInfo[] = [];

    constructor(
        readonly category: DiagnosticCategory,
        readonly message: string,
        readonly range: Range,
        readonly identifier: DiagnosticIdentifier,
        readonly priority: TaskListPriority = TaskListPriority.Normal
    ) {}

    addAction(action: DiagnosticAction) {
        if (this._actions === undefined) {
            this._actions = [action];
        } else {
            this._actions.push(action);
        }
    }

    getActions() {
        return this._actions;
    }

    setRule(rule: string) {
        this._rule = rule;
    }

    getRule() {
        return this._rule;
    }

    addRelatedInfo(
        message: string,
        filePath: string,
        range: Range,
        priority: TaskListPriority = TaskListPriority.Normal
    ) {
        this._relatedInfo.push({ filePath, message, range, priority });
    }

    getRelatedInfo() {
        return this._relatedInfo;
    }
}

// Helps to build additional information that can be appended to a diagnostic
// message. It supports hierarchical information and flexible formatting.
export class DiagnosticAddendum {
    private _messages: string[] = [];
    private _childAddenda: DiagnosticAddendum[] = [];

    // Addenda normally don't have their own ranges, but there are cases
    // where we want to track ranges that can influence the range of the
    // diagnostic.
    private _range: TextRange | undefined;

    addMessage(message: string) {
        this._messages.push(message);
    }

    addTextRange(range: TextRange) {
        this._range = range;
    }

    // Create a new (nested) addendum to which messages can be added.
    createAddendum() {
        const newAddendum = new DiagnosticAddendum();
        this.addAddendum(newAddendum);
        return newAddendum;
    }

    getString(maxDepth = defaultMaxDepth, maxLineCount = defaultMaxLineCount): string {
        let lines = this._getLinesRecursive(maxDepth, maxLineCount);

        if (lines.length > maxLineCount) {
            lines = lines.slice(0, maxLineCount);
            lines.push('  ...');
        }

        const text = lines.join('\n');
        if (text.length > 0) {
            return '\n' + text;
        }

        return '';
    }

    isEmpty() {
        return this._getMessageCount() === 0;
    }

    addAddendum(addendum: DiagnosticAddendum) {
        this._childAddenda.push(addendum);
    }

    getChildren() {
        return this._childAddenda;
    }

    getMessages() {
        return this._messages;
    }

    // Returns undefined if no range is associated with this addendum
    // or its children. Returns a non-empty range if there is a single range
    // associated.
    getEffectiveTextRange(): TextRange | undefined {
        const range = this._getTextRangeRecursive();

        // If we received an empty range, it means that there were multiple
        // non-overlapping ranges associated with this addendum.
        if (range?.length === 0) {
            return undefined;
        }

        return range;
    }

    private _getTextRangeRecursive(recursionCount = 0): TextRange | undefined {
        if (recursionCount > maxRecursionCount) {
            return undefined;
        }
        recursionCount++;

        const childRanges = this._childAddenda
            .map((child) => child._getTextRangeRecursive(recursionCount))
            .filter((r) => !!r);

        if (childRanges.length > 1) {
            return { start: 0, length: 0 };
        }

        if (childRanges.length === 1) {
            return childRanges[0];
        }

        if (this._range) {
            return this._range;
        }

        return undefined;
    }

    private _getMessageCount(recursionCount = 0) {
        if (recursionCount > maxRecursionCount) {
            return 0;
        }

        // Get the nested message count.
        let messageCount = this._messages.length;

        for (const diag of this._childAddenda) {
            messageCount += diag._getMessageCount(recursionCount + 1);
        }

        return messageCount;
    }

    private _getLinesRecursive(maxDepth: number, maxLineCount: number, recursionCount = 0): string[] {
        if (maxDepth <= 0 || recursionCount > maxRecursionCount) {
            return [];
        }

        let childLines: string[] = [];
        for (const addendum of this._childAddenda) {
            const maxDepthRemaining = this._messages.length > 0 ? maxDepth - 1 : maxDepth;
            appendArray(childLines, addendum._getLinesRecursive(maxDepthRemaining, maxLineCount, recursionCount + 1));

            // If the number of lines exceeds our max line count, don't bother adding more.
            if (childLines.length >= maxLineCount) {
                childLines = childLines.slice(0, maxLineCount);
                break;
            }
        }

        // Prepend indentation for readability. Skip if there are no
        // messages at this level.
        const extraSpace = this._messages.length > 0 ? '  ' : '';
        return this._messages.concat(childLines).map((line) => extraSpace + line);
    }
}
