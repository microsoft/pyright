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

import { ExpressionNode, FunctionNode, ImportFromNode, LambdaNode,
    MemberAccessExpressionNode, NameNode } from '../parser/parseNodes';

export enum FlowFlags {
    Unreachable    = 1 << 0,  // Unreachable code
    Start          = 1 << 1,  // Entry point
    Label          = 1 << 2,  // Junction
    Assignment     = 1 << 3,  // Assignment statement
    WildcardImport = 1 << 4,  // For "from X import *" statements
    TrueCondition  = 1 << 5,  // Condition known to be true
    FalseCondition = 1 << 6   // Condition known to be false
}

export interface FlowNodeBase {
    flags: FlowFlags;
}

// FlowStart represents the start of a control flow. It
// represents the entry point for a function or lambda,
// including the assignment of parameters. We also use
// this for modules and classes, although those nodes
// have no parameters.
export interface FlowStart extends FlowNodeBase {
    function?: FunctionNode | LambdaNode;
}

// FlowLabel represents a junction with multiple possible
// preceding control flows.
export interface FlowLabel extends FlowNodeBase {
    antecedents: FlowNode[];
}

// FlowAssignment represents a node that assigns a value.
export interface FlowAssignment extends FlowNodeBase {
    node: NameNode | MemberAccessExpressionNode;
    antecedent: FlowNode;
}

// Similar to FlowAssignment but used specifically for
// wildcard "from X import *" statements.
export interface FlowWildcardImport extends FlowNodeBase {
    node: ImportFromNode;
    names: string[];
    antecedent: FlowNode;
}

// FlowCondition represents a condition that is known to
// be true or false at the node's location in the control flow.
export interface FlowCondition extends FlowNodeBase {
    expression: ExpressionNode;
    antecedent: FlowNode;
}

export type FlowNode = FlowStart | FlowLabel | FlowAssignment |
    FlowCondition | FlowWildcardImport;
