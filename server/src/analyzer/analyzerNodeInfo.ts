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

import { NameBindings } from '../parser/nameBindings';
import { ParseNode, StringListNode } from '../parser/parseNodes';
import { Declaration } from './declaration';
import { ImportResult } from './importResult';
import { TypeSourceId } from './inferredType';
import { Scope, ScopeType } from './scope';
import { Type } from './types';

// An always-incrementing ID for assigning to nodes.
let NextTypeSourceId: TypeSourceId = 1;

export class AnalyzerNodeInfo {
    //---------------------------------------------------------------
    // Set by PostParseWalker

    // Name bindings for nodes that introduce namespaces (modules,
    // functions, classes and lambdas). It records the static binding
    // type (local, non-local, global) for names used within that scope.
    _nameBindings?: NameBindings;

    // Information about an import; used for import nodes only.
    _importInfo?: ImportResult;

    //---------------------------------------------------------------
    // Set by SemanticAnalyzer

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

    // Information to resolve definition and hover requests from
    // language service interface; used for NamedNode's.
    _declarations?: Declaration[];

    // "Type source ID", a number that is unique per node within a
    // parse tree. for NameNode's.
    _typeSourceId?: TypeSourceId;

    // Ignore the type annotation string for this node. Used to handle
    // type arguments for "Literal".
    _ignoreTypeAnnotation?: boolean;

    //---------------------------------------------------------------

    // Cleans out all fields that are added by the analyzer phases
    // (after the post-parse walker).
    static cleanNodeAnalysisInfo(node: ParseNode) {
        const analyzerNode = node as AnalyzerNodeInfo;

        delete analyzerNode._scope;
        delete analyzerNode._expressionType;
        delete analyzerNode._expressionTypeWriteVersion;
        delete analyzerNode._expressionTypeReadVersion;
        delete analyzerNode._declarations;
        delete analyzerNode._typeSourceId;
        delete analyzerNode._ignoreTypeAnnotation;
    }

    static getNameBindings(node: ParseNode): NameBindings | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._nameBindings;
    }

    static setNameBindings(node: ParseNode, nameBindings: NameBindings) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._nameBindings = nameBindings;
    }

    static getScope(node: ParseNode): Scope | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._scope;
    }

    static setScope(node: ParseNode, scope: Scope) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._scope = scope;
    }

    static getScopeRecursive(node: ParseNode, skipTemporary = true): Scope | undefined {
        let curNode: ParseNode | undefined = node;

        while (curNode) {
            let scope = AnalyzerNodeInfo.getScope(curNode);
            if (scope) {
                if (!skipTemporary || scope.getType() !== ScopeType.Temporary) {
                    return scope;
                }
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static getImportInfo(node: ParseNode): ImportResult | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._importInfo;
    }

    static setImportInfo(node: ParseNode, importInfo: ImportResult) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._importInfo = importInfo;
    }

    static getDeclarations(node: ParseNode): Declaration[] | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._declarations;
    }

    static setDeclarations(node: ParseNode, declarations: Declaration[]) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._declarations = declarations;
    }

    static getExpressionType(node: ParseNode): Type | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._expressionType;
    }

    static setExpressionType(node: ParseNode, typeAnnotation: Type) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._expressionType = typeAnnotation;
    }

    static getExpressionTypeWriteVersion(node: ParseNode): number | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._expressionTypeWriteVersion;
    }

    static setExpressionTypeWriteVersion(node: ParseNode, version: number) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._expressionTypeWriteVersion = version;
    }

    static getExpressionTypeReadVersion(node: ParseNode): number | undefined {
        const analyzerNode = node as AnalyzerNodeInfo;
        return analyzerNode._expressionTypeReadVersion;
    }

    static setExpressionTypeReadVersion(node: ParseNode, version: number) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._expressionTypeReadVersion = version;
    }

    static getTypeSourceId(node: ParseNode): TypeSourceId {
        const analyzerNode = node as AnalyzerNodeInfo;
        if (analyzerNode._typeSourceId === undefined) {
            analyzerNode._typeSourceId = NextTypeSourceId++;
        }

        return analyzerNode._typeSourceId;
    }

    static setIgnoreTypeAnnotation(node: StringListNode) {
        const analyzerNode = node as AnalyzerNodeInfo;
        analyzerNode._ignoreTypeAnnotation = true;
    }

    static getIgnoreTypeAnnotation(node: StringListNode) {
        const analyzerNode = node as AnalyzerNodeInfo;
        return !!analyzerNode._ignoreTypeAnnotation;
    }
}
