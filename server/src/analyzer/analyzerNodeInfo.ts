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

import { ParseNode } from '../parser/parseNodes';
import { ImportResult } from './importResult';
import { Scope, ScopeType } from './scope';
import { Type } from './types';

interface AnalyzerNodeInfo {
    //---------------------------------------------------------------
    // Set as part of import resolution

    // Information about an import; used for import nodes only.
    _importInfo?: ImportResult;

    //---------------------------------------------------------------
    // Set by Binder

    // Scope for nodes that introduce scopes: modules, functions,
    // classes, lambdas, and list comprehensions. A scope is used
    // to store symbol names and their associated types and declarations.
    _scope?: Scope;

    //---------------------------------------------------------------
    // Set by TypeAnalyzer

    // Cached type information for expression nodes; allows analyzer to
    // avoid recomputing types repeatedly.
    _expressionType?: Type;

    // Analysis pass that last wrote to the cache.
    _expressionTypeWriteVersion?: number;

    // Analysis pass that last accessed the cache.
    _expressionTypeReadVersion?: number;
}

// Cleans out all fields that are added by the analyzer phases
// (after the post-parse walker).
export function cleanNodeAnalysisInfo(node: ParseNode) {
    const analyzerNode = node as AnalyzerNodeInfo;

    delete analyzerNode._scope;
    delete analyzerNode._expressionType;
    delete analyzerNode._expressionTypeWriteVersion;
    delete analyzerNode._expressionTypeReadVersion;
}

export function getScope(node: ParseNode): Scope | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode._scope;
}

export function setScope(node: ParseNode, scope: Scope) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._scope = scope;
}

export function getScopeRecursive(node: ParseNode, skipTemporary = true): Scope | undefined {
    let curNode: ParseNode | undefined = node;

    while (curNode) {
        const scope = getScope(curNode);
        if (scope) {
            if (!skipTemporary || scope.getType() !== ScopeType.Temporary) {
                return scope;
            }
        }

        curNode = curNode.parent;
    }

    return undefined;
}

export function getImportInfo(node: ParseNode): ImportResult | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode._importInfo;
}

export function setImportInfo(node: ParseNode, importInfo: ImportResult) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._importInfo = importInfo;
}

export function getExpressionType(node: ParseNode): Type | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode._expressionType;
}

export function setExpressionType(node: ParseNode, typeAnnotation: Type) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._expressionType = typeAnnotation;
}

export function getExpressionTypeWriteVersion(node: ParseNode): number | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode._expressionTypeWriteVersion;
}

export function setExpressionTypeWriteVersion(node: ParseNode, version: number) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._expressionTypeWriteVersion = version;
}

export function getExpressionTypeReadVersion(node: ParseNode): number | undefined {
    const analyzerNode = node as AnalyzerNodeInfo;
    return analyzerNode._expressionTypeReadVersion;
}

export function setExpressionTypeReadVersion(node: ParseNode, version: number) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._expressionTypeReadVersion = version;
}
