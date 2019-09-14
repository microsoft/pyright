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

import { ParseNode, StringListNode } from '../parser/parseNodes';
import { ImportResult } from './importResult';
import { TypeSourceId } from './inferredType';
import { Scope, ScopeType } from './scope';
import { Type } from './types';

// An always-incrementing ID for assigning to nodes.
let _nextTypeSourceId: TypeSourceId = 1;

interface AnalyzerNodeInfo {
    //---------------------------------------------------------------
    // Set as part of import resolution

    // Information about an import; used for import nodes only.
    _importInfo?: ImportResult;

    //---------------------------------------------------------------
    // Set by Binder

    // Scope for nodes that introduce scopes: modules, functions,
    // classes, and lambdas. A scope is used to store symbol names
    // and their associated types and declarations.
    _scope?: Scope;

    //---------------------------------------------------------------
    // Set by TypeAnalyzer

    // Cached type information for expression nodes; allows analyzer to
    // avoid recomputing types repeatedly.
    _expressionType?: Type;

    // Version of cached expressionType.
    _expressionTypeWriteVersion?: number;

    // Version that last accessed the cache.
    _expressionTypeReadVersion?: number;

    // "Type source ID", a number that is unique per node within a
    // parse tree. for NameNode's.
    _typeSourceId?: TypeSourceId;

    // Ignore the type annotation string for this node. Used to handle
    // type arguments for "Literal".
    _ignoreTypeAnnotation?: boolean;
}

// Cleans out all fields that are added by the analyzer phases
// (after the post-parse walker).
export function cleanNodeAnalysisInfo(node: ParseNode) {
    const analyzerNode = node as AnalyzerNodeInfo;

    delete analyzerNode._scope;
    delete analyzerNode._expressionType;
    delete analyzerNode._expressionTypeWriteVersion;
    delete analyzerNode._expressionTypeReadVersion;
    delete analyzerNode._typeSourceId;
    delete analyzerNode._ignoreTypeAnnotation;
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

export function getTypeSourceId(node: ParseNode): TypeSourceId {
    const analyzerNode = node as AnalyzerNodeInfo;
    if (analyzerNode._typeSourceId === undefined) {
        analyzerNode._typeSourceId = _nextTypeSourceId++;
    }

    return analyzerNode._typeSourceId;
}

export function setIgnoreTypeAnnotation(node: StringListNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    analyzerNode._ignoreTypeAnnotation = true;
}

export function getIgnoreTypeAnnotation(node: StringListNode) {
    const analyzerNode = node as AnalyzerNodeInfo;
    return !!analyzerNode._ignoreTypeAnnotation;
}
