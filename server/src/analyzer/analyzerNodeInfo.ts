/*
* analyzerNodeInfo.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Defines objects that the analyzer(s) hang off the parse nodes in
* the parse tree. It contains information collected during the
* analysis phases that can be used for later analysis steps or for
* language services (e.g. hover information).
*/

import * as assert from 'assert';

import { FunctionNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { FlowNode } from './codeFlow';
import { FunctionDeclaration } from './declaration';
import { ImportResult } from './importResult';
import { Scope } from './scope';
import { Type } from './types';

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

    // Declaration (for functions only).
    declaration?: FunctionDeclaration;

    // Control flow information for this node.
    flowNode?: FlowNode;

    // Control flow information at the end of this node.
    afterFlowNode?: FlowNode;

    // Info about the source file, used only on module nodes.
    fileInfo?: AnalyzerFileInfo;

    //---------------------------------------------------------------
    // Set by TypeAnalyzer

    // Cached type information for this node.
    typeCache?: ExpressionTypeCache;
}

interface ExpressionTypeCache {
    // Cached type information for expression nodes; allows analyzer to
    // avoid recomputing types repeatedly.
    type?: Type;

    // Analysis pass that last wrote to the cache.
    writeVersion?: number;

    // Indicates that the cached value was read since
    // it was last written, so any write must invalidate
    // the analysis and perform another pass.
    updateRequiresInvalidation?: boolean;

    // The type won't be changed after the initial write.
    isFinal?: boolean;
}

// Cleans out all fields that are added by the analyzer phases
// (after the post-parse walker).
export function cleanNodeAnalysisInfo(node: ParseNode) {
    const analyzerNode = node as AnalyzerNodeInfo;

    delete analyzerNode.scope;
    delete analyzerNode.declaration;
    delete analyzerNode.flowNode;
    delete analyzerNode.afterFlowNode;
    delete analyzerNode.fileInfo;
    delete analyzerNode.typeCache;
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

export function getFunctionDeclaration(node: FunctionNode): FunctionDeclaration | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.declaration;
}

export function setFunctionDeclaration(node: ParseNode, decl: FunctionDeclaration) {
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

export function getFileInfo(node: ModuleNode): AnalyzerFileInfo | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode.fileInfo;
}

export function setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode.fileInfo = fileInfo;
}

export function getExpressionType(node: ParseNode): Type | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (!analyzerNode.typeCache) {
        analyzerNode.typeCache = {};
    }

    if (!analyzerNode.typeCache.isFinal) {
        analyzerNode.typeCache.updateRequiresInvalidation = true;
    }
    return analyzerNode.typeCache.type;
}

export function peekExpressionType(node: ParseNode, readVersion?: number): Type | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (analyzerNode.typeCache) {
        if (readVersion === undefined || analyzerNode.typeCache.writeVersion === readVersion) {
            return analyzerNode.typeCache.type;
        }
    }

    return undefined;
}

export function setExpressionType(node: ParseNode, type: Type, isFinal = false) {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (!analyzerNode.typeCache) {
        analyzerNode.typeCache = {};
    }

    assert(!analyzerNode.typeCache.isFinal);

    analyzerNode.typeCache.type = type;
    if (isFinal) {
        analyzerNode.typeCache.isFinal = true;
    }
}

export function getExpressionTypeWriteVersion(node: ParseNode): number | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (analyzerNode.typeCache) {
        return analyzerNode.typeCache.writeVersion;
    }
    return undefined;
}

export function setExpressionTypeWriteVersion(node: ParseNode, version: number) {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (!analyzerNode.typeCache) {
        analyzerNode.typeCache = {};
    }

    const requiresInvalidation = !!analyzerNode.typeCache.updateRequiresInvalidation;
    analyzerNode.typeCache.writeVersion = version;
    analyzerNode.typeCache.updateRequiresInvalidation = false;

    return requiresInvalidation;
}
