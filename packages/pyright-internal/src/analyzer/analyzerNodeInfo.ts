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
    ComprehensionNode,
    ExecutionScopeNode,
    FunctionNode,
    LambdaNode,
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

export type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode | ComprehensionNode;

// Cleans out all fields that are added by the analyzer phases
// (after the post-parse walker).
export function cleanNodeAnalysisInfo(node: ParseNode) {
    const info = getAnalyzerInfo(node);
    if (info?.scope) {
        info.scope = undefined;
    }

    if (info?.declaration) {
        info.declaration = undefined;
    }

    if (info?.flowNode) {
        info.flowNode = undefined;
    }

    if (info?.afterFlowNode) {
        info.afterFlowNode = undefined;
    }

    if (info?.fileInfo) {
        info.fileInfo = undefined;
    }

    if (info?.codeFlowExpressions) {
        info.codeFlowExpressions = undefined;
    }

    if (info?.codeFlowComplexity) {
        info.codeFlowComplexity = undefined;
    }

    if (info?.dunderAllInfo) {
        info.dunderAllInfo = undefined;
    }
}

export function getImportInfo(node: ParseNode): ImportResult | undefined {
    const info = getAnalyzerInfo(node);
    return info?.importInfo;
}

export function setImportInfo(node: ParseNode, importInfo: ImportResult) {
    const info = getAnalyzerInfoForWrite(node);
    info.importInfo = importInfo;
}

export function getScope(node: ParseNode): Scope | undefined {
    const info = getAnalyzerInfo(node);
    return info?.scope;
}

export function setScope(node: ParseNode, scope: Scope) {
    const info = getAnalyzerInfoForWrite(node);
    info.scope = scope;
}

export function getDeclaration(node: ParseNode): Declaration | undefined {
    const info = getAnalyzerInfo(node);
    return info?.declaration;
}

export function setDeclaration(node: ParseNode, decl: Declaration) {
    const info = getAnalyzerInfoForWrite(node);
    info.declaration = decl;
}

export function getFlowNode(node: ParseNode): FlowNode | undefined {
    const info = getAnalyzerInfo(node);
    return info?.flowNode;
}

export function setFlowNode(node: ParseNode, flowNode: FlowNode) {
    const info = getAnalyzerInfoForWrite(node);
    info.flowNode = flowNode;
}

export function getAfterFlowNode(node: ParseNode): FlowNode | undefined {
    const info = getAnalyzerInfo(node);
    return info?.afterFlowNode;
}

export function setAfterFlowNode(node: ParseNode, flowNode: FlowNode) {
    const info = getAnalyzerInfoForWrite(node);
    info.afterFlowNode = flowNode;
}

export function getFileInfo(node: ParseNode): AnalyzerFileInfo {
    while (node.nodeType !== ParseNodeType.Module) {
        node = node.parent!;
    }
    const info = getAnalyzerInfo(node);
    return info!.fileInfo!;
}

export function setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
    const info = getAnalyzerInfoForWrite(node);
    info.fileInfo = fileInfo;
}

export function getCodeFlowExpressions(node: ExecutionScopeNode): Set<string> | undefined {
    const info = getAnalyzerInfo(node);
    return info?.codeFlowExpressions;
}

export function setCodeFlowExpressions(node: ExecutionScopeNode, expressions: Set<string>) {
    const info = getAnalyzerInfoForWrite(node);
    info.codeFlowExpressions = expressions;
}

export function getCodeFlowComplexity(node: ExecutionScopeNode) {
    const info = getAnalyzerInfo(node);
    return info?.codeFlowComplexity ?? 0;
}

export function setCodeFlowComplexity(node: ExecutionScopeNode, complexity: number) {
    const info = getAnalyzerInfoForWrite(node);
    info.codeFlowComplexity = complexity;
}

export function getDunderAllInfo(node: ModuleNode): DunderAllInfo | undefined {
    const info = getAnalyzerInfo(node);
    return info?.dunderAllInfo;
}

export function setDunderAllInfo(node: ModuleNode, names: DunderAllInfo | undefined) {
    const info = getAnalyzerInfoForWrite(node);
    info.dunderAllInfo = names;
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

function getAnalyzerInfo(node: ParseNode): AnalyzerNodeInfo | undefined {
    return node.a as AnalyzerNodeInfo | undefined;
}

function getAnalyzerInfoForWrite(node: ParseNode): AnalyzerNodeInfo {
    let info = node.a as AnalyzerNodeInfo | undefined;
    if (!info) {
        node.a = info = {};
    }
    return info;
}
