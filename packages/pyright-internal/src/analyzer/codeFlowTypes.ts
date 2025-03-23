/*
 * codeFlowTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Data structures that track the code flow (or more accurately,
 * the inverse of code flow) starting with return statements and
 * working back to the entry. This allows us to work out the
 * types at each point of the code flow.
 *
 * This is largely based on the code flow engine in the
 * TypeScript compiler.
 */

import { assert, fail } from '../common/debug';
import {
    ArgCategory,
    AssignmentExpressionNode,
    CallNode,
    CaseNode,
    ExpressionNode,
    ImportFromNode,
    IndexNode,
    MatchNode,
    MemberAccessNode,
    NameNode,
    NumberNode,
    ParseNodeType,
    StringNode,
    SuiteNode,
} from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';

export enum FlowFlags {
    Unreachable = 1 << 0, // Unreachable code
    Start = 1 << 1, // Entry point
    BranchLabel = 1 << 2, // Junction for forward control flow
    LoopLabel = 1 << 3, // Junction for backward control flow
    Assignment = 1 << 4, // Assignment statement
    Unbind = 1 << 5, // Used with assignment to indicate target should be unbound
    WildcardImport = 1 << 6, // For "from X import *" statements
    TrueCondition = 1 << 7, // Condition known to be true
    FalseCondition = 1 << 9, // Condition known to be false
    Call = 1 << 10, // Call node
    PreFinallyGate = 1 << 11, // Injected edge that links pre-finally label and pre-try flow
    PostFinally = 1 << 12, // Injected edge that links post-finally flow with the rest of the graph
    VariableAnnotation = 1 << 14, // Separates a variable annotation from its name node
    PostContextManager = 1 << 15, // Label that's used for context managers that suppress exceptions
    TrueNeverCondition = 1 << 16, // Condition whose type evaluates to never when narrowed in positive test
    FalseNeverCondition = 1 << 17, // Condition whose type evaluates to never when narrowed in negative test
    NarrowForPattern = 1 << 18, // Narrow the type of the subject expression within a case statement
    ExhaustedMatch = 1 << 19, // Control flow gate that is closed when match is provably exhaustive
}

let _nextFlowNodeId = 1;

export type CodeFlowReferenceExpressionNode = NameNode | MemberAccessNode | IndexNode | AssignmentExpressionNode;

export function getUniqueFlowNodeId() {
    return _nextFlowNodeId++;
}

export interface FlowNode {
    flags: FlowFlags;
    id: number;
}

// FlowLabel represents a junction with multiple possible
// preceding control flows.
export interface FlowLabel extends FlowNode {
    antecedents: FlowNode[];

    // Set of all expressions that require code flow analysis
    // through the loop or in branch paths to determine their types.
    // If an expression is not within this map, branch or loop analysis
    // can be skipped and determined from the first antecedent only.
    affectedExpressions: Set<string> | undefined;
}

export interface FlowBranchLabel extends FlowLabel {
    // If specified, this label represents a flow node that precedes
    // (i.e. is higher up in the control flow graph) than all of
    // the antecedents of this branch label. If an expression is
    // not affected by the branch label, the entire flow node can be
    // skipped, and processing can proceed at this label.
    preBranchAntecedent: FlowNode | undefined;
}

// FlowAssignment represents a node that assigns a value.
export interface FlowAssignment extends FlowNode {
    node: CodeFlowReferenceExpressionNode;
    antecedent: FlowNode;
    targetSymbolId: number;
}

// FlowVariableAnnotation separates a variable annotation
// node from its type annotation. For example, the declaration
// "foo: bar", the "bar" needs to be associated with a flow
// node that precedes the "foo". This is important if the
// same name is used for both (e.g. "foo: foo") and we need
// to determine that the annotation refers to a symbol within
// an outer scope.
export interface FlowVariableAnnotation extends FlowNode {
    antecedent: FlowNode;
}

// Similar to FlowAssignment but used specifically for
// wildcard "from X import *" statements.
export interface FlowWildcardImport extends FlowNode {
    node: ImportFromNode;
    names: string[];
    antecedent: FlowNode;
}

// FlowCondition represents a condition that is known to
// be true or false at the node's location in the control flow.
export interface FlowCondition extends FlowNode {
    expression: ExpressionNode;
    reference?: NameNode | undefined;
    antecedent: FlowNode;
}

export interface FlowNarrowForPattern extends FlowNode {
    subjectExpression: ExpressionNode;
    statement: CaseNode | MatchNode;
    antecedent: FlowNode;
}

// FlowExhaustedMatch represents a control flow gate that is "closed"
// if a match statement can be statically proven to exhaust all cases
// (i.e. the narrowed type of the subject expression is Never at the bottom).
export interface FlowExhaustedMatch extends FlowNode {
    node: MatchNode;
    subjectExpression: ExpressionNode;
    antecedent: FlowNode;
}

// Records a call, which may raise exceptions, thus affecting
// the code flow and making subsequent code unreachable.
export interface FlowCall extends FlowNode {
    node: CallNode;
    antecedent: FlowNode;
}

// See comment in the visitTry method in binder.ts for a full
// explanation of the FlowPreFinally and FlowPostFinally nodes.
export interface FlowPreFinallyGate extends FlowNode {
    antecedent: FlowNode;
}

export interface FlowPostFinally extends FlowNode {
    antecedent: FlowNode;
    finallyNode: SuiteNode;
    preFinallyGate: FlowPreFinallyGate;
}

export interface FlowPostContextManagerLabel extends FlowLabel {
    expressions: ExpressionNode[];
    isAsync: boolean;

    // If the context manager swallows exceptions and this value
    // is true, block any code flow analysis along this path. Conversely,
    // if the context manager does not swallow exceptions and this
    // value is false, block any code flow analysis along this path.
    blockIfSwallowsExceptions: boolean;
}

export function isCodeFlowSupportedForReference(
    reference: ExpressionNode
): reference is CodeFlowReferenceExpressionNode {
    if (reference.nodeType === ParseNodeType.Name) {
        return true;
    }

    if (reference.nodeType === ParseNodeType.MemberAccess) {
        return isCodeFlowSupportedForReference(reference.d.leftExpr);
    }

    if (reference.nodeType === ParseNodeType.AssignmentExpression) {
        return true;
    }

    if (reference.nodeType === ParseNodeType.Index) {
        // Allow index expressions that have a single subscript that is a
        // literal integer or string value.
        if (
            reference.d.items.length !== 1 ||
            reference.d.trailingComma ||
            reference.d.items[0].d.name !== undefined ||
            reference.d.items[0].d.argCategory !== ArgCategory.Simple
        ) {
            return false;
        }

        const subscriptNode = reference.d.items[0].d.valueExpr;
        const isIntegerIndex =
            subscriptNode.nodeType === ParseNodeType.Number &&
            !subscriptNode.d.isImaginary &&
            subscriptNode.d.isInteger;
        const isNegativeIntegerIndex =
            subscriptNode.nodeType === ParseNodeType.UnaryOperation &&
            subscriptNode.d.operator === OperatorType.Subtract &&
            subscriptNode.d.expr.nodeType === ParseNodeType.Number &&
            !subscriptNode.d.expr.d.isImaginary &&
            subscriptNode.d.expr.d.isInteger;
        const isStringIndex =
            subscriptNode.nodeType === ParseNodeType.StringList &&
            subscriptNode.d.strings.length === 1 &&
            subscriptNode.d.strings[0].nodeType === ParseNodeType.String;

        if (!isIntegerIndex && !isNegativeIntegerIndex && !isStringIndex) {
            return false;
        }

        return isCodeFlowSupportedForReference(reference.d.leftExpr);
    }

    return false;
}

export function createKeyForReference(reference: CodeFlowReferenceExpressionNode): string {
    let key;
    if (reference.nodeType === ParseNodeType.Name) {
        key = reference.d.value;
    } else if (reference.nodeType === ParseNodeType.AssignmentExpression) {
        key = reference.d.name.d.value;
    } else if (reference.nodeType === ParseNodeType.MemberAccess) {
        const leftKey = createKeyForReference(reference.d.leftExpr as CodeFlowReferenceExpressionNode);
        key = `${leftKey}.${reference.d.member.d.value}`;
    } else if (reference.nodeType === ParseNodeType.Index) {
        const leftKey = createKeyForReference(reference.d.leftExpr as CodeFlowReferenceExpressionNode);
        assert(reference.d.items.length === 1);
        const expr = reference.d.items[0].d.valueExpr;
        if (expr.nodeType === ParseNodeType.Number) {
            key = `${leftKey}[${(expr as NumberNode).d.value.toString()}]`;
        } else if (expr.nodeType === ParseNodeType.StringList) {
            const valExpr = expr;
            assert(valExpr.d.strings.length === 1 && valExpr.d.strings[0].nodeType === ParseNodeType.String);
            key = `${leftKey}["${(valExpr.d.strings[0] as StringNode).d.value}"]`;
        } else if (
            expr.nodeType === ParseNodeType.UnaryOperation &&
            expr.d.operator === OperatorType.Subtract &&
            expr.d.expr.nodeType === ParseNodeType.Number
        ) {
            key = `${leftKey}[-${(expr.d.expr as NumberNode).d.value.toString()}]`;
        } else {
            fail('createKeyForReference received unexpected index type');
        }
    } else {
        fail('createKeyForReference received unexpected expression type');
    }

    return key;
}

export function createKeysForReferenceSubexpressions(reference: CodeFlowReferenceExpressionNode): string[] {
    if (reference.nodeType === ParseNodeType.Name) {
        return [createKeyForReference(reference)];
    }

    if (reference.nodeType === ParseNodeType.AssignmentExpression) {
        return [createKeyForReference(reference.d.name)];
    }

    if (reference.nodeType === ParseNodeType.MemberAccess) {
        return [
            ...createKeysForReferenceSubexpressions(reference.d.leftExpr as CodeFlowReferenceExpressionNode),
            createKeyForReference(reference),
        ];
    }

    if (reference.nodeType === ParseNodeType.Index) {
        return [
            ...createKeysForReferenceSubexpressions(reference.d.leftExpr as CodeFlowReferenceExpressionNode),
            createKeyForReference(reference),
        ];
    }

    fail('createKeyForReference received unexpected expression type');
}

// A reference key that corresponds to a wildcard import.
export const wildcardImportReferenceKey = '*';
