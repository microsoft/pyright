/*
 * refinementTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Type definitions and methods for type refinements.
 */

import { assert, assertNever, fail } from '../common/debug';
import { convertRangeToTextRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { LocMessage } from '../localization/localize';
import {
    ArgCategory,
    BinaryOperationNode,
    CallNode,
    ExpressionNode,
    NameNode,
    NumberNode,
    ParseNode,
    ParseNodeType,
    RefinementNode,
    StringListNode,
    TupleNode,
    UnaryOperationNode,
} from '../parser/parseNodes';
import { ParseOptions, Parser, ParseTextMode } from '../parser/parser';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { getFileInfo } from './analyzerNodeInfo';
import { getScopeIdForNode } from './parseTreeUtils';
import {
    evaluateRefinementExpression,
    isRefinementBoolean,
    isRefinementBytes,
    isRefinementNumber,
    isRefinementString,
    isRefinementTuple,
    isRefinementVar,
    isRefinementWildcard,
} from './refinementTypeUtils';

export type KnownRefinementDomain =
    | 'IntRefinement'
    | 'StrRefinement'
    | 'BytesRefinement'
    | 'BoolRefinement'
    | 'IntTupleRefinement';
export type RefinementDomain = KnownRefinementDomain | 'Refinement';

export interface TypeRefinement {
    // Information about the refinement class.
    classDetails: RefinementClassDetails;

    // Expression that defines the value of the refinement.
    value: RefinementExpr;

    // Is the refinement enforced when another type has no refinement
    // with this class?
    isEnforced: boolean;

    // Expression that defines the condition (predicate) under which this refinement is valid.
    condition?: RefinementExpr;

    // Variables used in the refinement.
    vars?: Map<string, RefinementVarInfo>;

    // Optional parse node associated with the refinement.
    node?: RefinementNode;
}

export interface RefinementClassDetails {
    // The refinement domain the class derives from.
    domain: KnownRefinementDomain;

    // A short name for the class (used for error messages).
    className: string;

    // A unique ID for the refinement class (used for comparison).
    classId: string;

    // The associated base type permits printing this refinement as a literal.
    baseSupportsLiteral?: boolean;

    // The associated base type permits printing this refinement as a string.
    baseSupportsStringShortcut?: boolean;
}

export interface RefinementVarSharedDetails {
    name: string;
    type: RefinementVarType;

    // A user-visible scope name.
    scopeName: string;

    // Conditions (predicates) associated with this variable set.
    conditions: RefinementExpr[];
}

// Similar to a TypeVar, a refinement variable is a placeholder for a
// value that is not known at the time the refinement is defined.
export interface RefinementVar {
    shared: RefinementVarSharedDetails;

    // An identifier that uniquely specifies a scope for the variable.
    scopeId: RefinementVarScopeId;

    // A combination of the name and scope that uniquely identifies the variable.
    id: RefinementVarId;

    // Indicates whether the variable is "bound" or "free". A bound variable
    // cannot be replaced by another value.
    isBound: boolean;
}

export namespace RefinementVar {
    export function create(
        name: string,
        type: RefinementVarType,
        scopeName: string,
        scopeId: RefinementVarScopeId,
        isBound: boolean = false
    ): RefinementVar {
        return {
            shared: { name, type, scopeName, conditions: [] },
            scopeId,
            id: makeId(name, scopeId, isBound),
            isBound,
        };
    }

    export function cloneWithNewScopeId(varInfo: RefinementVar, scopeId: RefinementVarScopeId): RefinementVar {
        return { ...varInfo, scopeId };
    }

    export function cloneAsBound(varInfo: RefinementVar): RefinementVar {
        if (varInfo.isBound) {
            return varInfo;
        }
        return { ...varInfo, isBound: true, id: makeId(varInfo.shared.name, varInfo.scopeId, /* isBound */ true) };
    }

    export function cloneAsFree(varInfo: RefinementVar): RefinementVar {
        if (!varInfo.isBound) {
            return varInfo;
        }
        return { ...varInfo, isBound: false, id: makeId(varInfo.shared.name, varInfo.scopeId, /* isBound */ false) };
    }

    export function makeId(name: string, scopeId: RefinementVarScopeId, isBound: boolean): RefinementVarId {
        return `${name}@${scopeId}${isBound ? '*' : ''}`;
    }

    export function isSame(var1: RefinementVar, var2: RefinementVar): boolean {
        return var1.id === var2.id;
    }

    // This is similar to isSame except that it considers only the
    // name and scope, not whether the variable is bound.
    export function isSameIgnoreBound(var1: RefinementVar, var2: RefinementVar): boolean {
        return var1.shared.name === var2.shared.name && var1.scopeId === var2.scopeId;
    }
}

export type RefinementVarScopeId = string;
export type RefinementVarId = string;

export interface RefinementVarInfo {
    var: RefinementVar;

    // Places where the variable is used within the refinement definition.
    usage: NameNode[];

    // Is the variable used in a value expression?
    isValue: boolean;
}

export type RefinementVarMap = Map<string, RefinementVarInfo>;

export enum RefinementExprType {
    Int,
    Str,
    Bytes,
    Bool,
    IntTuple,
}

export type RefinementVarType = RefinementExprType;

export enum RefinementNodeType {
    Number,
    String,
    Bytes,
    Boolean,
    Var,
    Wildcard,
    BinaryOp,
    UnaryOp,
    Tuple,
    Call,
}

export interface RefinementNodeBase {
    nodeType: RefinementNodeType;
}

export interface RefinementNumberNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Number;
    value: number | bigint;
}

export interface RefinementStringNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.String;
    value: string;
}

export interface RefinementBytesNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Bytes;
    value: string;
}

export interface RefinementBooleanNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Boolean;
    value: boolean;
}

export interface RefinementVarNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Var;
    var: RefinementVar;
}

export interface RefinementWildcardNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Wildcard;
}

export interface RefinementTupleEntry {
    value: RefinementExpr;
    isUnpacked: boolean;
}

export interface RefinementTupleNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Tuple;
    entries: RefinementTupleEntry[];
}

export interface RefinementUnaryOpNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.UnaryOp;
    operator: OperatorType;
    expr: RefinementExpr;
}

export interface RefinementBinaryOpNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.BinaryOp;
    operator: OperatorType;
    leftExpr: RefinementExpr;
    rightExpr: RefinementExpr;
}

export interface RefinementCallNode extends RefinementNodeBase {
    nodeType: RefinementNodeType.Call;
    name: string;
    args: RefinementExpr[];
}

export type RefinementExpr =
    | RefinementNumberNode
    | RefinementStringNode
    | RefinementBytesNode
    | RefinementBooleanNode
    | RefinementVarNode
    | RefinementWildcardNode
    | RefinementTupleNode
    | RefinementUnaryOpNode
    | RefinementBinaryOpNode
    | RefinementCallNode;

export interface ProcessedRefinementExpr<T extends RefinementNodeBase> {
    expr: T;
    type: RefinementExprType | undefined;
}

export type LogDiagnosticCallback = (
    message: string,
    node: ParseNode,
    range?: TextRange,
    isSyntaxError?: boolean
) => void;

interface RefinementCallInfo {
    paramTypes: RefinementExprType[];
    returnType: RefinementExprType;
    signature: string;
    docstring: string;
}

interface ProcessRefinementExprOptions {
    domain: KnownRefinementDomain;
    varMap: RefinementVarMap;
    logDiag: LogDiagnosticCallback;
    scopeName: string;
    scopeId: RefinementVarScopeId;
    outerVars: Map<string, RefinementVar>;
}

const refinementCalls: { [name: string]: RefinementCallInfo } = {
    broadcast: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.IntTuple],
        returnType: RefinementExprType.IntTuple,
        signature: '(t1: tuple, t2: tuple) -> tuple',
        docstring: 'Computes the broadcasted shape based on the two input shapes.',
    },
    concat: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.IntTuple, RefinementExprType.Int],
        returnType: RefinementExprType.IntTuple,
        signature: '(t1: tuple, t2: tuple, dim: int) -> tuple',
        docstring: 'Concatenates two shapes along a specified dimension.\n\nNegative dimension values are supported.',
    },
    index: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.Int],
        returnType: RefinementExprType.Int,
        signature: '(t: tuple, index: int) -> tuple',
        docstring: 'Returns the value at the specified index in the tuple.\n\nNegative indices are supported.',
    },
    splice: {
        paramTypes: [
            RefinementExprType.IntTuple,
            RefinementExprType.Int,
            RefinementExprType.Int,
            RefinementExprType.IntTuple,
        ],
        returnType: RefinementExprType.IntTuple,
        signature: '(t: tuple, index: int, del: int, insert: tuple) -> tuple',
        docstring:
            'Deletes a specified number of elements from the tuple at index and inserts a new tuple.\n\nNegative indices are supported.',
    },
    len: {
        paramTypes: [RefinementExprType.IntTuple],
        returnType: RefinementExprType.Int,
        signature: '(t: tuple) -> int',
        docstring: 'Returns the number of elements in the tuple.',
    },
    permute: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.IntTuple],
        returnType: RefinementExprType.IntTuple,
        signature: '(t: tuple, indices: tuple) -> tuple',
        docstring: 'Permutes the elements of the tuple based on the indices.\n\nNegative indices are supported.',
    },
    reshape: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.IntTuple],
        returnType: RefinementExprType.IntTuple,
        signature: '(old: tuple, new: tuple) -> tuple',
        docstring: 'Reshapes the tuple to a new shape, ensuring that the number of elements remains the same.',
    },
    swap: {
        paramTypes: [RefinementExprType.IntTuple, RefinementExprType.Int, RefinementExprType.Int],
        returnType: RefinementExprType.IntTuple,
        signature: '(t: tuple, i1: int, i2: int) -> tuple',
        docstring: 'Swaps two elements within the tuple.\n\nNegative indices are supported.',
    },
};

export namespace TypeRefinement {
    // Attempts to create a refinement from a type metadata expression.
    export function fromRefinement(
        classDetails: RefinementClassDetails,
        expression: ExpressionNode,
        isEnforced: boolean | undefined,
        scopeNode: ParseNode,
        outerVars: Map<string, RefinementVar>,
        logDiag: LogDiagnosticCallback
    ): TypeRefinement | undefined {
        if (
            expression.nodeType !== ParseNodeType.StringList ||
            expression.d.strings.length !== 1 ||
            (expression.d.strings[0].d.token.flags & StringTokenFlags.Bytes) !== 0
        ) {
            logDiag(LocMessage.expectedRefinement(), expression);
            return undefined;
        }

        const textValue = expression.d.strings[0].d.value;

        let valueOffset = expression.d.strings[0].start;
        if (expression.d.strings[0].nodeType === ParseNodeType.String) {
            valueOffset +=
                expression.d.strings[0].d.token.prefixLength + expression.d.strings[0].d.token.quoteMarkLength;
        }

        const parseOptions = new ParseOptions();
        const fileInfo = getFileInfo(expression);
        parseOptions.isStubFile = fileInfo.isStubFile;
        parseOptions.pythonVersion = fileInfo.executionEnvironment.pythonVersion;
        parseOptions.reportErrorsForParsedStringContents = true;

        // Construct a temporary dummy string with the text value at the appropriate
        // offset so as to mimic the original file. This will keep all of the token
        // and diagnostic offsets correct.
        const dummyFileContents = ' '.repeat(valueOffset) + textValue;

        const parser = new Parser();
        const parseResults = parser.parseTextExpression(
            dummyFileContents,
            valueOffset,
            textValue.length,
            parseOptions,
            ParseTextMode.Refinement,
            /* initialParenDepth */ 1,
            fileInfo.typingSymbolAliases
        );

        if (!parseResults.parseTree) {
            // This should never happen. We should always get a parse tree
            // even if it contains an ErrorNode.
            return undefined;
        }

        parseResults.parseTree.parent = expression;

        // Add the new subtree to the parse tree so it can participate in
        // language server operations like find and replace.
        expression.d.refinement = parseResults.parseTree;

        // Report any parse-related diagnostics.
        parseResults.diagnostics.forEach((diag) => {
            const textRange = convertRangeToTextRange(diag.range, fileInfo.lines);
            if (textRange) {
                logDiag(diag.message, expression, textRange, /* isSyntaxError */ true);
            }
        });

        if (!parseResults.parseTree) {
            return undefined;
        }

        return processRefinement(
            parseResults.parseTree,
            classDetails,
            isEnforced ?? false,
            scopeNode,
            outerVars,
            logDiag
        );
    }

    // Creates a refinement from a simple literal value.
    export function fromValue(
        classDetails: RefinementClassDetails,
        expression: ExpressionNode,
        isEnforced: boolean | undefined,
        logDiag: LogDiagnosticCallback
    ): TypeRefinement | undefined {
        let value: number | bigint | string | boolean | undefined;
        let actualType = 'unknown';

        if (expression.nodeType === ParseNodeType.StringList) {
            const isBytes = (expression.d.strings[0].d.token.flags & StringTokenFlags.Bytes) !== 0;
            const strValue = expression.d.strings.map((s) => s.d.value).join('');
            value = strValue;

            actualType = isBytes ? 'bytes' : 'str';
        } else if (expression.nodeType === ParseNodeType.Number) {
            if (!expression.d.isImaginary && expression.d.isInteger) {
                value = expression.d.value;
                actualType = 'int';
            }
        } else if (expression.nodeType === ParseNodeType.Constant) {
            if (expression.d.constType === KeywordType.True || expression.d.constType === KeywordType.False) {
                value = expression.d.constType === KeywordType.True;
                actualType = 'bool';
            }
        } else if (expression.nodeType === ParseNodeType.UnaryOperation) {
            if (expression.d.operator === OperatorType.Subtract || expression.d.operator === OperatorType.Add) {
                if (expression.d.expr.nodeType === ParseNodeType.Number) {
                    if (!expression.d.expr.d.isImaginary && expression.d.expr.d.isInteger) {
                        value =
                            expression.d.operator === OperatorType.Subtract
                                ? -expression.d.expr.d.value
                                : expression.d.expr.d.value;
                        actualType = 'int';
                    }
                }
            }
        }

        if (classDetails.domain === 'IntRefinement') {
            if (typeof value === 'number' || typeof value === 'bigint') {
                return fromLiteral(classDetails, value, isEnforced ?? true);
            }

            logDiag(
                LocMessage.refinementUnexpectedValueType().format({ expected: 'int', received: actualType }),
                expression
            );
            return undefined;
        }

        if (classDetails.domain === 'StrRefinement') {
            if (typeof value === 'string' && actualType === 'str') {
                return fromLiteral(classDetails, value, isEnforced ?? true);
            }

            logDiag(
                LocMessage.refinementUnexpectedValueType().format({ expected: 'str', received: actualType }),
                expression
            );
            return undefined;
        }

        if (classDetails.domain === 'BytesRefinement') {
            if (typeof value === 'string' && actualType === 'bytes') {
                return fromLiteral(classDetails, value, isEnforced ?? true);
            }

            logDiag(
                LocMessage.refinementUnexpectedValueType().format({ expected: 'bytes', received: actualType }),
                expression
            );
            return undefined;
        }

        if (classDetails.domain === 'BoolRefinement') {
            if (typeof value === 'boolean') {
                return fromLiteral(classDetails, value, isEnforced ?? true);
            }

            logDiag(
                LocMessage.refinementUnexpectedValueType().format({ expected: 'bool', received: actualType }),
                expression
            );
            return undefined;
        }

        if (classDetails.domain === 'IntTupleRefinement') {
            logDiag(LocMessage.refinementIntTupleNotAllowed(), expression);
            return undefined;
        }

        // Other domains are not supported.
        return undefined;
    }

    // Creates a refinement from a Literal[] type.
    export function fromLiteral(
        classDetails: RefinementClassDetails,
        value: string | number | bigint | boolean,
        isEnforced: boolean
    ): TypeRefinement {
        const domain = classDetails.domain;

        if (domain === 'IntRefinement') {
            assert(typeof value === 'number' || typeof value === 'bigint');

            return {
                classDetails,
                value: { nodeType: RefinementNodeType.Number, value },
                isEnforced,
                condition: undefined,
                vars: new Map<string, RefinementVarInfo>(),
            };
        }

        if (domain === 'StrRefinement' || domain === 'BytesRefinement') {
            assert(typeof value === 'string');
            return {
                classDetails,
                value: {
                    nodeType: domain === 'StrRefinement' ? RefinementNodeType.String : RefinementNodeType.Bytes,
                    value,
                },
                isEnforced,
                condition: undefined,
                vars: new Map<string, RefinementVarInfo>(),
            };
        }

        if (domain === 'BoolRefinement') {
            assert(typeof value === 'boolean');

            return {
                classDetails,
                value: { nodeType: RefinementNodeType.Boolean, value },
                isEnforced,
                condition: undefined,
                vars: new Map<string, RefinementVarInfo>(),
            };
        }

        if (domain === 'IntTupleRefinement') {
            fail('Unexpected refinement domain');
        }

        assertNever(domain);
    }

    // Creates a refinement from a binary operator applied to two operands
    // that have refinements with the same refinement class.
    export function fromBinaryOp(
        operator: OperatorType,
        leftRefinement: TypeRefinement,
        rightRefinement: TypeRefinement
    ): TypeRefinement {
        assert(leftRefinement.classDetails.domain === rightRefinement.classDetails.domain);
        assert(leftRefinement.classDetails.classId === rightRefinement.classDetails.classId);

        let expr: RefinementExpr = {
            nodeType: RefinementNodeType.BinaryOp,
            operator,
            leftExpr: leftRefinement.value,
            rightExpr: rightRefinement.value,
        };

        expr = evaluateRefinementExpression(expr);

        return {
            classDetails: leftRefinement.classDetails,
            isEnforced: leftRefinement.isEnforced,
            value: expr,
            condition: undefined,
        };
    }

    // Creates an IntTupleRefinement for a specified class and tuple values.
    // This is used for assigning to an *args parameter.
    export function fromLiteralTuple(
        classDetails: RefinementClassDetails,
        entries: RefinementTupleEntry[]
    ): TypeRefinement {
        const refinement: TypeRefinement = {
            classDetails,
            value: {
                nodeType: RefinementNodeType.Tuple,
                entries,
            },
            isEnforced: false,
        };

        return refinement;
    }

    export function getRefinementCallInfo(callName: string): { callSignature?: string; callDocstring?: string } {
        const entry = refinementCalls[callName];

        return {
            callSignature: entry?.signature,
            callDocstring: entry?.docstring,
        };
    }

    // Determines whether the refinement type value is valid for a precondition.
    export function getInvalidPreconditionVal(r: TypeRefinement, node: ExpressionNode): ExpressionNode | undefined {
        const isPreconditionAtom = (expr: RefinementExpr): boolean => {
            return (
                isRefinementWildcard(expr) ||
                isRefinementBytes(expr) ||
                isRefinementString(expr) ||
                isRefinementNumber(expr) ||
                isRefinementBoolean(expr) ||
                isRefinementVar(expr)
            );
        };

        // Allow, literals, wildcards and variables.
        if (isPreconditionAtom(r.value)) {
            return undefined;
        }

        if (isRefinementTuple(r.value)) {
            assert(node.nodeType === ParseNodeType.Tuple);
            for (let i = 0; i < node.d.items.length; i++) {
                const entry = r.value.entries[i];

                if (!isPreconditionAtom(entry.value)) {
                    return node.d.items[i];
                }
            }

            return undefined;
        }

        return node;
    }

    export function isSame(r1: TypeRefinement, r2: TypeRefinement): boolean {
        if (r1.classDetails.classId !== r2.classDetails.classId || r1.isEnforced !== r2.isEnforced) {
            return false;
        }

        if (!isRefinementExprSame(r1.value, r2.value)) {
            return false;
        }

        if (r1.condition) {
            if (!r2.condition) {
                return false;
            }

            if (!isRefinementExprSame(r1.condition, r2.condition)) {
                return false;
            }
        } else if (r2.condition) {
            return false;
        }

        return true;
    }

    export function isRefinementExprSame(r1: RefinementExpr, r2: RefinementExpr): boolean {
        if (r1.nodeType !== r2.nodeType) {
            return false;
        }

        switch (r1.nodeType) {
            case RefinementNodeType.Number: {
                return r1.value === (r2 as RefinementNumberNode).value;
            }

            case RefinementNodeType.String: {
                return r1.value === (r2 as RefinementStringNode).value;
            }

            case RefinementNodeType.Bytes: {
                return r1.value === (r2 as RefinementBytesNode).value;
            }

            case RefinementNodeType.Boolean: {
                return r1.value === (r2 as RefinementBooleanNode).value;
            }

            case RefinementNodeType.Wildcard: {
                return true;
            }

            case RefinementNodeType.Var: {
                return RefinementVar.isSame(r1.var, (r2 as RefinementVarNode).var);
            }

            case RefinementNodeType.BinaryOp: {
                const r2Bin = r2 as RefinementBinaryOpNode;
                return (
                    r1.operator === r2Bin.operator &&
                    isRefinementExprSame(r1.leftExpr, r2Bin.leftExpr) &&
                    isRefinementExprSame(r1.rightExpr, r2Bin.rightExpr)
                );
            }

            case RefinementNodeType.UnaryOp: {
                const r2Unary = r2 as RefinementUnaryOpNode;
                return r1.operator === r2Unary.operator && isRefinementExprSame(r1.expr, r2Unary.expr);
            }

            case RefinementNodeType.Tuple: {
                const r2Tuple = r2 as RefinementTupleNode;
                if (r1.entries.length !== r2Tuple.entries.length) {
                    return false;
                }

                for (let i = 0; i < r1.entries.length; i++) {
                    const elem1 = r1.entries[i];
                    const elem2 = r2Tuple.entries[i];
                    if (elem1.isUnpacked !== elem2.isUnpacked) {
                        return false;
                    }

                    if (!isRefinementExprSame(elem1.value, elem2.value)) {
                        return false;
                    }
                }

                return true;
            }

            case RefinementNodeType.Call: {
                const r2Call = r2 as RefinementCallNode;
                if (r1.name !== r2Call.name) {
                    return false;
                }

                if (r1.args.length !== r2Call.args.length) {
                    return false;
                }

                for (let i = 0; i < r1.args.length; i++) {
                    if (!isRefinementExprSame(r1.args[i], r2Call.args[i])) {
                        return false;
                    }
                }

                return true;
            }

            default: {
                assertNever(r1);
            }
        }
    }
}

// Given a list of pre-condition and post-condition refinement definitions,
// this function looks at all variables with the given scopeID and returns
// a list of deduplicated variables. It also verifies that the type of the
// variable is consistent across all refinements and that conditions use
// only variables that are defined in values.
export function verifyRefinementVarConsistency(
    preRefinements: TypeRefinement[],
    postRefinements: TypeRefinement[],
    scopeId: RefinementVarScopeId,
    logDiag: LogDiagnosticCallback
): RefinementVar[] {
    const varMap = new Map<string, RefinementVarInfo>();
    const nonValueVars = new Map<string, RefinementVarInfo>();
    const preconditions: RefinementExpr[] = [];

    // Gather all variables from preconditions.
    for (const refinement of preRefinements) {
        // Enforce precondition value rules.
        if (refinement.node) {
            const invalidValNode = TypeRefinement.getInvalidPreconditionVal(refinement, refinement.node.d.valueExpr);

            if (invalidValNode) {
                logDiag(LocMessage.refinementPrecondition(), invalidValNode);
            }
        }

        // Gather conditions.
        if (refinement.condition) {
            preconditions.push(refinement.condition);
        }

        // Gather variables and enforce variable types.
        if (refinement.vars) {
            for (const [name, varInfo] of refinement.vars) {
                if (varInfo.var.scopeId !== scopeId) {
                    continue;
                }

                const prevInfo = varMap.get(name);

                if (varInfo.isValue) {
                    nonValueVars.delete(name);
                }

                if (!prevInfo) {
                    varMap.set(name, varInfo);

                    if (!varInfo.isValue) {
                        nonValueVars.set(name, varInfo);
                    }
                    continue;
                }

                if (prevInfo.var.shared.type !== varInfo.var.shared.type) {
                    logUnexpectedType(varInfo.usage[0], varInfo.var.shared.type, prevInfo.var.shared.type, logDiag);
                }
            }
        }
    }

    // Report variables that don't appear in any value expressions.
    for (const [name, varInfo] of nonValueVars) {
        for (const usage of varInfo.usage) {
            logDiag(LocMessage.refinementVarNotInValue().format({ name }), usage);
        }
    }

    // Validate post-conditions.
    for (const refinement of postRefinements) {
        // Enforce post-condition value rules.
        if (refinement.node?.d.conditionExpr) {
            logDiag(LocMessage.refinementPostCondition(), refinement.node?.d.conditionExpr);
        }

        if (refinement.vars) {
            for (const [name, varInfo] of refinement.vars) {
                if (varInfo.var.scopeId !== scopeId) {
                    continue;
                }

                // Variables referenced in post-condition must be defined in post-condition value.
                if (!varInfo.isValue || !refinement.vars.has(name)) {
                    for (const usage of varInfo.usage) {
                        logDiag(LocMessage.refinementVarNotInValue().format({ name }), usage);
                    }
                }

                const prevInfo = varMap.get(name);
                if (!prevInfo) {
                    varMap.set(name, varInfo);
                    continue;
                }

                if (prevInfo.var.shared.type !== varInfo.var.shared.type) {
                    logUnexpectedType(varInfo.usage[0], prevInfo.var.shared.type, varInfo.var.shared.type, logDiag);
                }
            }
        }
    }

    // Add the accumulated preconditions to all of the variables.
    addConditionsToVars(preRefinements, scopeId, preconditions);
    addConditionsToVars(postRefinements, scopeId, preconditions);

    return Array.from(varMap.values()).map((varInfo) => varInfo.var);
}

function addConditionsToVars(
    refinements: TypeRefinement[],
    scopeId: RefinementVarScopeId,
    conditions: RefinementExpr[]
) {
    refinements.forEach((refinement) => {
        addConditionsToVarsRecursive(refinement.value, scopeId, conditions);

        if (refinement.condition) {
            addConditionsToVarsRecursive(refinement.condition, scopeId, conditions);
        }
    });
}

// Associates a set of conditions with every refinement variable
// in the expression if the variable's scope matches.
function addConditionsToVarsRecursive(
    expr: RefinementExpr,
    scopeId: RefinementVarScopeId,
    conditions: RefinementExpr[]
) {
    switch (expr.nodeType) {
        case RefinementNodeType.Var: {
            if (expr.var.scopeId === scopeId) {
                expr.var.shared.conditions = conditions;
            }
            break;
        }

        case RefinementNodeType.BinaryOp: {
            addConditionsToVarsRecursive(expr.leftExpr, scopeId, conditions);
            addConditionsToVarsRecursive(expr.rightExpr, scopeId, conditions);
            break;
        }

        case RefinementNodeType.UnaryOp: {
            addConditionsToVarsRecursive(expr.expr, scopeId, conditions);
            break;
        }

        case RefinementNodeType.Tuple: {
            for (const entry of expr.entries) {
                addConditionsToVarsRecursive(entry.value, scopeId, conditions);
            }
            break;
        }

        case RefinementNodeType.Call: {
            for (const arg of expr.args) {
                addConditionsToVarsRecursive(arg, scopeId, conditions);
            }
            break;
        }

        case RefinementNodeType.Number:
        case RefinementNodeType.String:
        case RefinementNodeType.Bytes:
        case RefinementNodeType.Boolean:
        case RefinementNodeType.Wildcard:
            break;

        default:
            assertNever(expr);
    }
}

// Transforms a parse tree representing a refinement definition into a
// TypeRefinement object.
function processRefinement(
    node: RefinementNode,
    classDetails: RefinementClassDetails,
    isEnforced: boolean,
    scopeNode: ParseNode,
    outerVars: Map<string, RefinementVar>,
    logDiag: LogDiagnosticCallback
): TypeRefinement | undefined {
    let expectedType: RefinementExprType;

    if (classDetails.domain === 'IntRefinement') {
        expectedType = RefinementExprType.Int;
    } else if (classDetails.domain === 'StrRefinement') {
        expectedType = RefinementExprType.Str;
    } else if (classDetails.domain === 'BytesRefinement') {
        expectedType = RefinementExprType.Bytes;
    } else if (classDetails.domain === 'BoolRefinement') {
        expectedType = RefinementExprType.Bool;
    } else {
        assert(classDetails.domain === 'IntTupleRefinement');
        expectedType = RefinementExprType.IntTuple;
    }

    const varMap = new Map<string, RefinementVarInfo>();
    const scopeId = getScopeIdForNode(scopeNode);
    const scopeName = scopeNode.nodeType === ParseNodeType.Function ? scopeNode.d.name.d.value : '<local>';
    const options: ProcessRefinementExprOptions = {
        domain: classDetails.domain,
        varMap,
        logDiag,
        scopeName,
        scopeId,
        outerVars,
    };

    const value = processRefinementExpr(node.d.valueExpr, expectedType, options)?.expr;

    let condition: RefinementExpr | undefined;
    if (node.d.conditionExpr) {
        condition = processRefinementExpr(node.d.conditionExpr, RefinementExprType.Bool, options)?.expr;
    }

    if (!value) {
        return undefined;
    }

    const result: TypeRefinement = {
        classDetails,
        value,
        isEnforced,
        condition,
        vars: varMap,
        node,
    };

    return result;
}

function logUnexpectedType(
    expr: ExpressionNode,
    expectedType: RefinementExprType,
    actualType: RefinementExprType,
    logDiag: LogDiagnosticCallback
) {
    const convertTypeToStr = (type: RefinementExprType) => {
        switch (type) {
            case RefinementExprType.Int:
                return 'int';

            case RefinementExprType.Str:
                return 'str';

            case RefinementExprType.Bytes:
                return 'bytes';

            case RefinementExprType.Bool:
                return 'bool';

            case RefinementExprType.IntTuple:
                return 'tuple';

            default:
                return '<unknown>';
        }
    };

    logDiag(
        LocMessage.refinementUnexpectedValueType().format({
            expected: convertTypeToStr(expectedType),
            received: convertTypeToStr(actualType),
        }),
        expr
    );
}

// Converts an expression parse tree into a refinement expression node, reporting
// any diagnostics along the way. If an error is detected, it returns undefined.
function processRefinementExpr(
    expr: ExpressionNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementExpr> | undefined {
    switch (expr.nodeType) {
        case ParseNodeType.Number: {
            return processNumberExpr(expr, expectedType, options);
        }

        case ParseNodeType.Constant: {
            if (expr.d.constType === KeywordType.True || expr.d.constType === KeywordType.False) {
                if (expectedType !== undefined && expectedType !== RefinementExprType.Bool) {
                    logUnexpectedType(expr, expectedType, RefinementExprType.Bool, options.logDiag);
                    return undefined;
                }

                const result: RefinementBooleanNode = {
                    nodeType: RefinementNodeType.Boolean,
                    value: expr.d.constType === KeywordType.True,
                };

                return { expr: result, type: RefinementExprType.Bool };
            }
            break;
        }

        case ParseNodeType.StringList: {
            return processStringExpr(expr, expectedType, options);
        }

        case ParseNodeType.UnaryOperation: {
            return processUnaryExpr(expr, expectedType, options);
        }

        case ParseNodeType.BinaryOperation: {
            return processBinaryExpr(expr, expectedType, options);
        }

        case ParseNodeType.Tuple: {
            return processTupleExpr(expr, expectedType, options);
        }

        case ParseNodeType.Name: {
            return processNameExpr(expr, expectedType, options);
        }

        case ParseNodeType.Call: {
            return processCallExpr(expr, expectedType, options);
        }
    }

    options.logDiag(LocMessage.refinementUnsupportedOperation(), expr);

    return undefined;
}

function processNumberExpr(
    expr: NumberNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementNumberNode> | undefined {
    if (!expr.d.isInteger || expr.d.isImaginary) {
        options.logDiag(LocMessage.refinementFloatImaginary(), expr);
        return undefined;
    }

    if (expectedType !== undefined && expectedType !== RefinementExprType.Int) {
        logUnexpectedType(expr, expectedType, RefinementExprType.Int, options.logDiag);
        return undefined;
    }

    const result: RefinementNumberNode = {
        nodeType: RefinementNodeType.Number,
        value: expr.d.value,
    };

    return { expr: result, type: RefinementExprType.Int };
}

function processStringExpr(
    expr: StringListNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementStringNode | RefinementBytesNode> | undefined {
    const actualType =
        (expr.d.strings[0].d.token.flags & StringTokenFlags.Bytes) !== 0
            ? RefinementExprType.Bytes
            : RefinementExprType.Str;

    if (expectedType !== undefined && expectedType !== actualType) {
        logUnexpectedType(expr, expectedType, actualType, options.logDiag);
        return undefined;
    }

    const value = expr.d.strings.map((s) => s.d.value).join('');

    const result: RefinementStringNode | RefinementBytesNode = {
        nodeType: actualType === RefinementExprType.Bytes ? RefinementNodeType.Bytes : RefinementNodeType.String,
        value,
    };

    return { expr: result, type: actualType };
}

function processUnaryExpr(
    expr: UnaryOperationNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementExpr> | undefined {
    const operator = expr.d.operator;

    // Handle arithmetic unary operators.
    if (operator === OperatorType.Subtract || operator === OperatorType.Add) {
        const subExpr = processRefinementExpr(expr.d.expr, RefinementExprType.Int, options)?.expr;
        if (!subExpr) {
            return undefined;
        }

        if (expectedType !== undefined && expectedType !== RefinementExprType.Int) {
            logUnexpectedType(expr, expectedType, RefinementExprType.Int, options.logDiag);
            return undefined;
        }

        // If the operand is a literal number, compute the result immediately.
        if (subExpr.nodeType === RefinementNodeType.Number) {
            const result: RefinementNumberNode = {
                nodeType: RefinementNodeType.Number,
                value: operator === OperatorType.Subtract ? -subExpr.value : subExpr.value,
            };

            return { expr: result, type: RefinementExprType.Int };
        }

        const result: RefinementUnaryOpNode = {
            nodeType: RefinementNodeType.UnaryOp,
            operator,
            expr: subExpr,
        };

        return { expr: result, type: RefinementExprType.Int };
    }

    if (operator === OperatorType.Not) {
        const subExpr = processRefinementExpr(expr.d.expr, RefinementExprType.Bool, options)?.expr;
        if (!subExpr) {
            return undefined;
        }

        if (expectedType !== undefined && expectedType !== RefinementExprType.Bool) {
            logUnexpectedType(expr, expectedType, RefinementExprType.Bool, options.logDiag);
            return undefined;
        }

        const result: RefinementUnaryOpNode = {
            nodeType: RefinementNodeType.UnaryOp,
            operator,
            expr: subExpr,
        };

        return { expr: result, type: RefinementExprType.Bool };
    }

    options.logDiag(LocMessage.refinementUnsupportedOperation(), expr);

    return undefined;
}

function processBinaryExpr(
    expr: BinaryOperationNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementExpr> | undefined {
    const logicalOps = [OperatorType.And, OperatorType.Or];
    const comparisonOps = [
        OperatorType.Equals,
        OperatorType.NotEquals,
        OperatorType.LessThan,
        OperatorType.LessThanOrEqual,
        OperatorType.GreaterThan,
        OperatorType.GreaterThanOrEqual,
    ];
    const arithOps = [
        OperatorType.Add,
        OperatorType.Subtract,
        OperatorType.Multiply,
        OperatorType.FloorDivide,
        OperatorType.Mod,
    ];

    const operator = expr.d.operator;

    if (logicalOps.includes(operator)) {
        const leftExpr = processRefinementExpr(expr.d.leftExpr, RefinementExprType.Bool, options)?.expr;
        const rightExpr = processRefinementExpr(expr.d.rightExpr, RefinementExprType.Bool, options)?.expr;
        if (!leftExpr || !rightExpr) {
            return undefined;
        }

        if (expectedType !== undefined && expectedType !== RefinementExprType.Bool) {
            logUnexpectedType(expr, expectedType, RefinementExprType.Bool, options.logDiag);
            return undefined;
        }

        const result: RefinementBinaryOpNode = {
            nodeType: RefinementNodeType.BinaryOp,
            operator,
            leftExpr,
            rightExpr,
        };

        return { expr: result, type: RefinementExprType.Bool };
    }

    if (comparisonOps.includes(operator)) {
        // The == and != operators can operate on int, str, bytes or int-tuple.
        const expectedOpType =
            operator === OperatorType.Equals || operator === OperatorType.NotEquals
                ? undefined
                : RefinementExprType.Int;

        const leftExprResult = processRefinementExpr(expr.d.leftExpr, expectedOpType, options);
        const leftExpr = leftExprResult?.expr;
        const rightExprResult = processRefinementExpr(expr.d.rightExpr, leftExprResult?.type, options);
        const rightExpr = rightExprResult?.expr;

        if (!leftExpr || !rightExpr) {
            return undefined;
        }

        if (expectedType !== undefined && expectedType !== RefinementExprType.Bool) {
            logUnexpectedType(expr, expectedType, RefinementExprType.Bool, options.logDiag);
            return undefined;
        }

        const result: RefinementBinaryOpNode = {
            nodeType: RefinementNodeType.BinaryOp,
            operator,
            leftExpr,
            rightExpr,
        };

        return { expr: result, type: RefinementExprType.Bool };
    }

    if (arithOps.includes(operator)) {
        let expectedOpType = RefinementExprType.Int;

        // The + operator can operate on int or str or bytes.
        if (operator === OperatorType.Add) {
            if (expectedType === RefinementExprType.Str || expectedType === RefinementExprType.Bytes) {
                expectedOpType = expectedType;
            }
        }

        const leftExpr = processRefinementExpr(expr.d.leftExpr, expectedOpType, options)?.expr;
        const rightExpr = processRefinementExpr(expr.d.rightExpr, expectedOpType, options)?.expr;

        if (!leftExpr || !rightExpr) {
            return undefined;
        }

        if (expectedType !== undefined && expectedType !== expectedOpType) {
            logUnexpectedType(expr, expectedType, expectedOpType, options.logDiag);
            return undefined;
        }

        const result: RefinementBinaryOpNode = {
            nodeType: RefinementNodeType.BinaryOp,
            operator,
            leftExpr,
            rightExpr,
        };

        return { expr: result, type: expectedOpType };
    }

    options.logDiag(LocMessage.refinementUnsupportedExpression(), expr);

    return undefined;
}

function processTupleExpr(
    expr: TupleNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementTupleNode> | undefined {
    if (expectedType !== undefined && expectedType !== RefinementExprType.IntTuple) {
        logUnexpectedType(expr, expectedType, RefinementExprType.IntTuple, options.logDiag);
        return undefined;
    }

    const entries: RefinementTupleEntry[] = [];

    for (const item of expr.d.items) {
        let entryNode = item;
        let isUnpacked = false;
        if (item.nodeType === ParseNodeType.Unpack) {
            entryNode = item.d.expr;
            isUnpacked = true;
        }

        const entryValue = processRefinementExpr(
            entryNode,
            isUnpacked ? RefinementExprType.IntTuple : RefinementExprType.Int,
            options
        )?.expr;

        if (!entryValue) {
            return undefined;
        }

        entries.push({ value: entryValue, isUnpacked });
    }

    const result: RefinementTupleNode = {
        nodeType: RefinementNodeType.Tuple,
        entries: entries,
    };

    return { expr: result, type: RefinementExprType.IntTuple };
}

function processNameExpr(
    expr: NameNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementExpr> | undefined {
    const name = expr.d.value;
    if (name === '_') {
        const result: RefinementWildcardNode = {
            nodeType: RefinementNodeType.Wildcard,
        };
        return { expr: result, type: expectedType };
    }

    let scopeId = options.scopeId;
    let scopeName = options.scopeName;
    let isBound = false;

    // See if this name refers to some outer-scoped variable.
    const outerScopeVar = options.outerVars.get(name);
    if (outerScopeVar) {
        if (expectedType !== undefined && outerScopeVar.shared.type !== expectedType) {
            logUnexpectedType(expr, expectedType, outerScopeVar.shared.type, options.logDiag);
            return undefined;
        }

        if (outerScopeVar.scopeId) {
            scopeId = outerScopeVar.scopeId;
            scopeName = outerScopeVar.shared.scopeName;
            isBound = true;
        }
    } else {
        // This is a local refinement var (not part of an outer scope).
        // See if we've encountered this name before.
        let varInfo = options.varMap.get(name);
        if (!varInfo) {
            if (expectedType === undefined) {
                expectedType = RefinementExprType.Int;
            }

            varInfo = {
                var: RefinementVar.create(name, expectedType, '<local>', options.scopeId),
                usage: [expr],
                isValue: isNodeInRefinementValue(expr),
            };

            options.varMap.set(name, varInfo);
        } else {
            if (!varInfo.isValue && isNodeInRefinementValue(expr)) {
                varInfo.isValue = true;
            }

            if (expectedType !== undefined && expectedType !== varInfo.var.shared.type) {
                logUnexpectedType(expr, expectedType, varInfo.var.shared.type, options.logDiag);
                return undefined;
            }

            expectedType = varInfo.var.shared.type;
            varInfo.usage.push(expr);
        }
    }

    const result: RefinementVarNode = {
        nodeType: RefinementNodeType.Var,
        var: RefinementVar.create(name, expectedType ?? RefinementExprType.Int, scopeName, scopeId, isBound),
    };

    return { expr: result, type: result.var.shared.type };
}

function isNodeInRefinementValue(node: ParseNode): boolean {
    let curNode: ParseNode | undefined = node;
    let prevNode: ParseNode = node;
    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Refinement) {
            return curNode.d.valueExpr === prevNode;
        }

        prevNode = curNode;
        curNode = curNode.parent;
    }

    return false;
}

function processCallExpr(
    expr: CallNode,
    expectedType: RefinementExprType | undefined,
    options: ProcessRefinementExprOptions
): ProcessedRefinementExpr<RefinementExpr> | undefined {
    if (expr.d.leftExpr.nodeType !== ParseNodeType.Name) {
        options.logDiag(LocMessage.refinementUnsupportedExpression(), expr.d.leftExpr);
        return undefined;
    }

    const callName = expr.d.leftExpr.d.value;
    const callInfo = refinementCalls[callName];
    if (!callInfo) {
        options.logDiag(LocMessage.refinementUnsupportedCall().format({ name: callName }), expr.d.leftExpr);
        return undefined;
    }

    if (expectedType !== undefined && expectedType !== callInfo.returnType) {
        logUnexpectedType(expr, expectedType, callInfo.returnType, options.logDiag);
        return undefined;
    }

    const params = callInfo.paramTypes;
    const args = expr.d.args;

    if (args.length !== params.length) {
        options.logDiag(
            LocMessage.refinementCallArgCount().format({
                name: callName,
                expected: params.length,
                received: expr.d.args.length,
            }),
            expr
        );
        return undefined;
    }

    const processedArgs: RefinementExpr[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].d.argCategory !== ArgCategory.Simple) {
            options.logDiag(LocMessage.refinementCallArgUnpacked(), args[i]);
            return undefined;
        }

        if (args[i].d.name) {
            options.logDiag(LocMessage.refinementCallArgKeyword(), args[i]);
            return undefined;
        }

        const processedArg = processRefinementExpr(args[i].d.valueExpr, params[i], options)?.expr;
        if (!processedArg) {
            return undefined;
        }

        processedArgs.push(processedArg);
    }

    const result: RefinementCallNode = {
        nodeType: RefinementNodeType.Call,
        name: expr.d.leftExpr.d.value,
        args: processedArgs,
    };

    return { expr: result, type: callInfo.returnType };
}

// Class that transforms a refinement expression by replacing
// refinement variables with other expressions.
export class RefinementExprTransformer {
    apply(expr: RefinementExpr): RefinementExpr {
        switch (expr.nodeType) {
            case RefinementNodeType.Number: {
                return this.transformNumber(expr);
            }

            case RefinementNodeType.String: {
                return this.transformString(expr);
            }

            case RefinementNodeType.Bytes: {
                return this.transformBytes(expr);
            }

            case RefinementNodeType.Boolean: {
                return this.transformBoolean(expr);
            }

            case RefinementNodeType.Wildcard: {
                return this.transformWildcard(expr);
            }

            case RefinementNodeType.BinaryOp: {
                return this.transformBinaryOp(expr);
            }

            case RefinementNodeType.UnaryOp: {
                return this.transformUnaryOp(expr);
            }

            case RefinementNodeType.Tuple: {
                return this.transformTuple(expr);
            }

            case RefinementNodeType.Var: {
                return this.transformVar(expr);
            }

            case RefinementNodeType.Call: {
                return this.transformCall(expr);
            }

            default: {
                assertNever(expr);
            }
        }
    }

    protected transformNumber(expr: RefinementNumberNode): RefinementExpr {
        return expr;
    }

    protected transformString(expr: RefinementStringNode): RefinementExpr {
        return expr;
    }

    protected transformBytes(expr: RefinementBytesNode): RefinementExpr {
        return expr;
    }

    protected transformBoolean(expr: RefinementBooleanNode): RefinementExpr {
        return expr;
    }

    protected transformWildcard(expr: RefinementWildcardNode): RefinementExpr {
        return expr;
    }

    protected transformBinaryOp(expr: RefinementBinaryOpNode): RefinementExpr {
        const leftExpr = this.apply(expr.leftExpr);
        const rightExpr = this.apply(expr.rightExpr);

        if (leftExpr === expr.leftExpr && rightExpr === expr.rightExpr) {
            return expr;
        }

        return { ...expr, leftExpr: leftExpr, rightExpr: rightExpr };
    }

    protected transformUnaryOp(expr: RefinementUnaryOpNode): RefinementExpr {
        const newExpr = this.apply(expr.expr);

        if (newExpr === expr.expr) {
            return expr;
        }

        return { ...expr, expr: newExpr };
    }

    protected transformTuple(expr: RefinementTupleNode): RefinementExpr {
        let didChange = false;

        const newElements = expr.entries.map((element) => {
            const newType = this.apply(element.value);
            if (newType !== element.value) {
                didChange = true;
                return { ...element, value: newType };
            }

            return element;
        });

        if (!didChange) {
            return expr;
        }

        return { ...expr, entries: newElements };
    }

    protected transformVar(expr: RefinementVarNode): RefinementExpr {
        return expr;
    }

    protected transformCall(expr: RefinementCallNode): RefinementExpr {
        let didChange = false;

        const newArgs = expr.args.map((arg) => {
            const newArg = this.apply(arg);
            if (newArg !== arg) {
                didChange = true;
            }
            return newArg;
        });

        if (!didChange) {
            return expr;
        }

        return { ...expr, args: newArgs };
    }
}
