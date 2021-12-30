/*
 * analyzerNodeInfo.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Defines objects that hang off the parse nodes in the parse tree.
 * It contains information collected during the binder phase that
 * can be used for later analysis steps or for language services
 * (e.g. hover information).
 */

import {
    ClassNode,
    ExecutionScopeNode,
    FunctionNode,
    LambdaNode,
    ListComprehensionNode,
    ModuleNode,
    ParseNode,
    ParseNodeType,
    StringNode,
} from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { FlowFlags, FlowNode } from './codeFlowTypes';
import { Declaration } from './declaration';
import { ImportResult } from './importResult';
import { Scope } from './scope';

export interface DunderAllInfo {
    names: string[];
    stringNodes: StringNode[];
    usesUnsupportedDunderAllForm: boolean;
}

interface AnalyzerNodeInfo {
    //---------------------------------------------------------------
    // Set as part of import resolution

    // Information about an import; used for import nodes only.
    importInfo?: ImportResult;

    //---------------------------------------------------------------
    // Set by Binder

    // Scope for nodes that introduce scopes: modules, functions,
    // classes, lambdas, and list comprehensions. A scope is used
    // to store symbol names and their associated types and declarations.
    scope?: Scope;

    // Declaration (for functions and classes only).
    declaration?: Declaration;

    // Control flow information for this node.
    flowNode?: FlowNode;

    // Control flow information at the end of this node.
    afterFlowNode?: FlowNode;

    // Info about the source file, used only on module nodes.
    fileInfo?: AnalyzerFileInfo;

    // Set of expressions used within an execution scope (module,
    // function or lambda) that requires code flow analysis.
    codeFlowExpressions?: Set<string>;

    // Number that represents the complexity of a function's code
    // flow graph.
    codeFlowComplexity?: number;

    // List of __all__ symbols in the module.
    dunderAllInfo?: DunderAllInfo | undefined;
}

export type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode | ListComprehensionNode;

// Cleans out all fields that are added by the analyzer phases
// (after the post-parse walker).
export function cleanNodeAnalysisInfo(node: ParseNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    delete analyzerNode.scope;
    delete analyzerNode.declaration;
    delete analyzerNode.flowNode;
    delete analyzerNode.afterFlowNode;
    delete analyzerNode.fileInfo;
    delete analyzerNode.codeFlowExpressions;
    delete analyzerNode.codeFlowComplexity;
    delete analyzerNode.dunderAllInfo;
}

export function getImportInfo(node: ParseNode): ImportResult | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.importInfo;
}

export function setImportInfo(node: ParseNode, importInfo: ImportResult) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.importInfo = importInfo;
}

export function getScope(node: ParseNode): Scope | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.scope;
}

export function setScope(node: ParseNode, scope: Scope) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.scope = scope;
}

export function getDeclaration(node: ParseNode): Declaration | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.declaration;
}

export function setDeclaration(node: ParseNode, decl: Declaration) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.declaration = decl;
}

export function getFlowNode(node: ParseNode): FlowNode | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.flowNode;
}

export function setFlowNode(node: ParseNode, flowNode: FlowNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.flowNode = flowNode;
}

export function getAfterFlowNode(node: ParseNode): FlowNode | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.afterFlowNode;
}

export function setAfterFlowNode(node: ParseNode, flowNode: FlowNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.afterFlowNode = flowNode;
}

export function getFileInfo(node: ParseNode): AnalyzerFileInfo {
    while (node.nodeType !== ParseNodeType.Module) {
        node = node.parent!;
    }
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.fileInfo!;
}

export function setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.fileInfo = fileInfo;
}

export function getCodeFlowExpressions(node: ExecutionScopeNode): Set<string> | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.codeFlowExpressions;
}

export function setCodeFlowExpressions(node: ExecutionScopeNode, expressions: Set<string>) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.codeFlowExpressions = expressions;
}

export function getCodeFlowComplexity(node: FunctionNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.codeFlowComplexity ?? 0;
}

export function setCodeFlowComplexity(node: FunctionNode, complexity: number) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.codeFlowComplexity = complexity;
}

export function getDunderAllInfo(node: ModuleNode): DunderAllInfo | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.dunderAllInfo;
}

export function setDunderAllInfo(node: ModuleNode, names: DunderAllInfo | undefined) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.dunderAllInfo = names;
}

export function isCodeUnreachable(node: ParseNode): boolean {
    let curNode: ParseNode | undefined = node;

    // Walk up the parse tree until we find a node with
    // an associated flow node.
    while (curNode) {
        const flowNode = getFlowNode(curNode);
        if (flowNode) {
            return !!(flowNode.flags & FlowFlags.Unreachable);
        }
        curNode = curNode.parent;
    }

    return false;
}
