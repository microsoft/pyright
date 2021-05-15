/*
 * codeFlow.ts
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

import { assert } from '../common/debug';
import {
    ArgumentCategory,
    CallNode,
    CaseNode,
    ExpressionNode,
    ImportFromNode,
    IndexNode,
    MemberAccessNode,
    NameNode,
    NumberNode,
    ParseNodeType,
    SuiteNode,
} from '../parser/parseNodes';

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
    AssignmentAlias = 1 << 13, // Assigned symbol is aliased to another symbol with the same name
    VariableAnnotation = 1 << 14, // Separates a variable annotation from its name node
    PostContextManager = 1 << 15, // Label that's used for context managers that suppress exceptions
    TrueNeverCondition = 1 << 16, // Condition whose type evaluates to never when narrowed in positive test
    FalseNeverCondition = 1 << 17, // Condition whose type evaluates to never when narrowed in negative test
    NarrowForPattern = 1 << 18, // Narrow the type of the subject expression within a case statement
}

let _nextFlowNodeId = 1;

export type CodeFlowReferenceExpressionNode = NameNode | MemberAccessNode | IndexNode;

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
}

// FlowAssignment represents a node that assigns a value.
export interface FlowAssignment extends FlowNode {
    node: CodeFlowReferenceExpressionNode;
    antecedent: FlowNode;
    targetSymbolId: number;
}

// FlowAssignmentAlias handles a case where a symbol
// takes on the value of a symbol with the same name
// but within an outer scope, such as when a variable
// is references within a list comprehension iteration
// expression before the result is assigned to a
// local variable of the same name.
export interface FlowAssignmentAlias extends FlowNode {
    antecedent: FlowNode;
    targetSymbolId: number;
    aliasSymbolId: number;
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
    reference?: NameNode;
    antecedent: FlowNode;
}

export interface FlowNarrowForPattern extends FlowNode {
    subjectExpression: ExpressionNode;
    caseStatement: CaseNode;
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
    isGateClosed: boolean;
}

export interface FlowPostFinally extends FlowNode {
    antecedent: FlowNode;
    finallyNode: SuiteNode;
    preFinallyGate: FlowPreFinallyGate;
}

export interface FlowPostContextManagerLabel extends FlowLabel {
    expressions: ExpressionNode[];
    isAsync: boolean;
}

export function isCodeFlowSupportedForReference(reference: ExpressionNode): boolean {
    if (reference.nodeType === ParseNodeType.Name) {
        return true;
    }

    if (reference.nodeType === ParseNodeType.MemberAccess) {
        return isCodeFlowSupportedForReference(reference.leftExpression);
    }

    if (reference.nodeType === ParseNodeType.Index) {
        // Allow index expressions that have a single subscript that is a
        // literal integer value.
        if (
            reference.items.length !== 1 ||
            reference.trailingComma ||
            reference.items[0].name !== undefined ||
            reference.items[0].argumentCategory !== ArgumentCategory.Simple
        ) {
            return false;
        }

        const subscriptNode = reference.items[0].valueExpression;
        if (subscriptNode.nodeType !== ParseNodeType.Number || subscriptNode.isImaginary || !subscriptNode.isInteger) {
            return false;
        }

        return isCodeFlowSupportedForReference(reference.baseExpression);
    }

    return false;
}

export function createKeyForReference(reference: CodeFlowReferenceExpressionNode): string {
    let key;
    if (reference.nodeType === ParseNodeType.Name) {
        key = reference.value;
    } else if (reference.nodeType === ParseNodeType.MemberAccess) {
        const leftKey = createKeyForReference(reference.leftExpression as CodeFlowReferenceExpressionNode);
        key = `${leftKey}.${reference.memberName.value}`;
    } else {
        const leftKey = createKeyForReference(reference.baseExpression as CodeFlowReferenceExpressionNode);
        assert(reference.items.length === 1 && reference.items[0].valueExpression.nodeType === ParseNodeType.Number);
        key = `${leftKey}[${(reference.items[0].valueExpression as NumberNode).value.toString()}]`;
    }

    return key;
}
