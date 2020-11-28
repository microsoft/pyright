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
    CallNode,
    ExpressionNode,
    ImportFromNode,
    MemberAccessNode,
    NameNode,
    ParseNodeType,
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
}

let _nextFlowNodeId = 1;

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
    node: NameNode | MemberAccessNode;
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
    preFinallyGate: FlowPreFinallyGate;
}

export function isCodeFlowSupportedForReference(reference: ExpressionNode): boolean {
    if (reference.nodeType === ParseNodeType.Name) {
        return true;
    }

    if (reference.nodeType === ParseNodeType.MemberAccess) {
        return isCodeFlowSupportedForReference(reference.leftExpression);
    }

    return false;
}

export function createKeyForReference(reference: NameNode | MemberAccessNode): string {
    let key;
    if (reference.nodeType === ParseNodeType.Name) {
        key = reference.value;
    } else {
        key = reference.memberName.value;
        let leftNode = reference.leftExpression;
        while (leftNode.nodeType === ParseNodeType.MemberAccess) {
            key = leftNode.memberName.value + `.${key}`;
            leftNode = leftNode.leftExpression;
        }
        assert(leftNode.nodeType === ParseNodeType.Name);
        key = (leftNode as NameNode).value + `.${key}`;
    }

    return key;
}
