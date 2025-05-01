/*
 * parserNodeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 *
 * ParseNodeType is a const enum which strips out the string keys
 * This file is used to map the string keys to the const enum values.
 */
import { ParseNodeType } from './parseNodes';
import { OperatorType } from './tokenizerTypes';

type ParseNodeEnumStringKeys = Exclude<keyof typeof ParseNodeType, `${number}`>;
type ParseNodeTypeMapType = Record<ParseNodeEnumStringKeys, ParseNodeType>;

export const ParseNodeTypeMap: ParseNodeTypeMapType = {
    Error: ParseNodeType.Error,
    Argument: ParseNodeType.Argument,
    Assert: ParseNodeType.Assert,
    Assignment: ParseNodeType.Assignment,
    AssignmentExpression: ParseNodeType.AssignmentExpression,
    AugmentedAssignment: ParseNodeType.AugmentedAssignment,
    Await: ParseNodeType.Await,
    BinaryOperation: ParseNodeType.BinaryOperation,
    Break: ParseNodeType.Break,
    Call: ParseNodeType.Call,
    Class: ParseNodeType.Class,
    Comprehension: ParseNodeType.Comprehension,
    ComprehensionFor: ParseNodeType.ComprehensionFor,
    ComprehensionIf: ParseNodeType.ComprehensionIf,
    Constant: ParseNodeType.Constant,
    Continue: ParseNodeType.Continue,
    Decorator: ParseNodeType.Decorator,
    Del: ParseNodeType.Del,
    Dictionary: ParseNodeType.Dictionary,
    DictionaryExpandEntry: ParseNodeType.DictionaryExpandEntry,
    DictionaryKeyEntry: ParseNodeType.DictionaryKeyEntry,
    Ellipsis: ParseNodeType.Ellipsis,
    If: ParseNodeType.If,
    Import: ParseNodeType.Import,
    ImportAs: ParseNodeType.ImportAs,
    ImportFrom: ParseNodeType.ImportFrom,
    ImportFromAs: ParseNodeType.ImportFromAs,
    Index: ParseNodeType.Index,
    Except: ParseNodeType.Except,
    For: ParseNodeType.For,
    FormatString: ParseNodeType.FormatString,
    Function: ParseNodeType.Function,
    Global: ParseNodeType.Global,
    Lambda: ParseNodeType.Lambda,
    List: ParseNodeType.List,
    MemberAccess: ParseNodeType.MemberAccess,
    Module: ParseNodeType.Module,
    ModuleName: ParseNodeType.ModuleName,
    Name: ParseNodeType.Name,
    Nonlocal: ParseNodeType.Nonlocal,
    Number: ParseNodeType.Number,
    Parameter: ParseNodeType.Parameter,
    Pass: ParseNodeType.Pass,
    Raise: ParseNodeType.Raise,
    Return: ParseNodeType.Return,
    Set: ParseNodeType.Set,
    Slice: ParseNodeType.Slice,
    StatementList: ParseNodeType.StatementList,
    StringList: ParseNodeType.StringList,
    String: ParseNodeType.String,
    Suite: ParseNodeType.Suite,
    Ternary: ParseNodeType.Ternary,
    Tuple: ParseNodeType.Tuple,
    Try: ParseNodeType.Try,
    TypeAnnotation: ParseNodeType.TypeAnnotation,
    UnaryOperation: ParseNodeType.UnaryOperation,
    Unpack: ParseNodeType.Unpack,
    While: ParseNodeType.While,
    With: ParseNodeType.With,
    WithItem: ParseNodeType.WithItem,
    Yield: ParseNodeType.Yield,
    YieldFrom: ParseNodeType.YieldFrom,
    FunctionAnnotation: ParseNodeType.FunctionAnnotation,
    Match: ParseNodeType.Match,
    Case: ParseNodeType.Case,
    PatternSequence: ParseNodeType.PatternSequence,
    PatternAs: ParseNodeType.PatternAs,
    PatternLiteral: ParseNodeType.PatternLiteral,
    PatternClass: ParseNodeType.PatternClass,
    PatternCapture: ParseNodeType.PatternCapture,
    PatternMapping: ParseNodeType.PatternMapping,
    PatternMappingKeyEntry: ParseNodeType.PatternMappingKeyEntry,
    PatternMappingExpandEntry: ParseNodeType.PatternMappingExpandEntry,
    PatternValue: ParseNodeType.PatternValue,
    PatternClassArgument: ParseNodeType.PatternClassArgument,
    TypeParameter: ParseNodeType.TypeParameter,
    TypeParameterList: ParseNodeType.TypeParameterList,
    TypeAlias: ParseNodeType.TypeAlias,
};

export type ParseNodeTypeMapKey = keyof typeof ParseNodeTypeMap;

export const ParseNodeTypeNameMap: Record<ParseNodeType, ParseNodeEnumStringKeys> = Object.entries(
    ParseNodeTypeMap
).reduce((acc, [name, value]) => {
    acc[value] = name as ParseNodeEnumStringKeys;
    return acc;
}, {} as Record<ParseNodeType, ParseNodeEnumStringKeys>);

type OperatorTypeMapType = Record<string, OperatorType>;

export const OperatorTypeMap: OperatorTypeMapType = {
    '+': OperatorType.Add,
    '+=': OperatorType.AddEqual,
    '=': OperatorType.Assign,
    '&': OperatorType.BitwiseAnd,
    '&=': OperatorType.BitwiseAndEqual,
    '~': OperatorType.BitwiseInvert,
    '|': OperatorType.BitwiseOr,
    '|=': OperatorType.BitwiseOrEqual,
    '^': OperatorType.BitwiseXor,
    '^=': OperatorType.BitwiseXorEqual,
    '/': OperatorType.Divide,
    '/=': OperatorType.DivideEqual,
    '==': OperatorType.Equals,
    '//': OperatorType.FloorDivide,
    '//=': OperatorType.FloorDivideEqual,
    '>': OperatorType.GreaterThan,
    '>=': OperatorType.GreaterThanOrEqual,
    '<<': OperatorType.LeftShift,
    '<<=': OperatorType.LeftShiftEqual,
    '<>': OperatorType.LessOrGreaterThan,
    '<': OperatorType.LessThan,
    '<=': OperatorType.LessThanOrEqual,
    '@': OperatorType.MatrixMultiply,
    '@=': OperatorType.MatrixMultiplyEqual,
    '%': OperatorType.Mod,
    '%=': OperatorType.ModEqual,
    '*': OperatorType.Multiply,
    '*=': OperatorType.MultiplyEqual,
    '!=': OperatorType.NotEquals,
    '**': OperatorType.Power,
    '**=': OperatorType.PowerEqual,
    '>>': OperatorType.RightShift,
    '>>=': OperatorType.RightShiftEqual,
    '-': OperatorType.Subtract,
    '-=': OperatorType.SubtractEqual,
    and: OperatorType.And,
    or: OperatorType.Or,
    'not ': OperatorType.Not,
    is: OperatorType.Is,
    'is not': OperatorType.IsNot,
    in: OperatorType.In,
    'not in': OperatorType.NotIn,
};

export const OperatorTypeNameMap: Record<OperatorType, ParseNodeEnumStringKeys> = Object.entries(
    OperatorTypeMap
).reduce((acc, [name, value]) => {
    acc[value] = name as ParseNodeEnumStringKeys;
    return acc;
}, {} as Record<OperatorType, ParseNodeEnumStringKeys>);

export type OperatorTypeMapKey = keyof typeof OperatorTypeMap;
