/*
 * analyzerNodeInfo.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Defines information associated with parse nodes. It contains data
 * collected during the binder phase that can be used for later analysis
 * steps or for language services (e.g. hover information).
 */

import {
    ClassNode,
    ComprehensionNode,
    ExecutionScopeNode,
    FunctionNode,
    IfNode,
    getParserStringAnnotation,
    getParseTreeRoot,
    LambdaNode,
    ModuleNode,
    ParseNode,
    ExpressionNode,
    StringListNode,
    StringNode,
} from '../parser/parseNodes';
import { StringAnnotationInfo } from '../parser/stringAnnotationInfo';
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

export interface AnalyzerNodeInfo {
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

    // Set of expressions used within an execution scope (module,
    // function or lambda) that requires code flow analysis.
    codeFlowExpressions?: Set<string>;

    // Number that represents the complexity of a function's code
    // flow graph.
    codeFlowComplexity?: number;

    // Statically evaluated value of an if statement's condition.
    staticConditionValue?: boolean;

    // List of __all__ symbols in the module.
    dunderAllInfo?: DunderAllInfo | undefined;

    // String annotations discovered after parsing, keyed by analyzer owner.
    stringAnnotations?: WeakMap<AnalyzerFileInfo, WeakMap<StringListNode, ExpressionNode>>;
}

export interface AnalyzerNodeInfoReader {
    get(node: ParseNode): AnalyzerNodeInfo | undefined;
    getFileInfo(node: ParseNode): AnalyzerFileInfo | undefined;
}

interface AnalyzerNodeInfoReaderPropertyProvider {
    readonly analyzerNodeInfoReader: AnalyzerNodeInfoReader;
}

interface AnalyzerNodeInfoReaderMethodProvider {
    getAnalyzerNodeInfoReader(): AnalyzerNodeInfoReader;
}

export function getInfoReader(provider: AnalyzerNodeInfoReaderPropertyProvider): AnalyzerNodeInfoReader;
export function getInfoReader(provider: AnalyzerNodeInfoReaderMethodProvider): AnalyzerNodeInfoReader;
export function getInfoReader(
    provider: AnalyzerNodeInfoReaderPropertyProvider | AnalyzerNodeInfoReaderMethodProvider
): AnalyzerNodeInfoReader {
    if ('analyzerNodeInfoReader' in provider) {
        return provider.analyzerNodeInfoReader;
    }

    return provider.getAnalyzerNodeInfoReader();
}

export interface AnalyzerNodeInfoWriter extends AnalyzerNodeInfoReader {
    getOrCreate(node: ParseNode): AnalyzerNodeInfo;
    setFileInfo(root: ModuleNode, fileInfo: AnalyzerFileInfo): void;
}

export class AnalyzerNodeInfoStore implements AnalyzerNodeInfoWriter {
    private readonly _infoByTree = new WeakMap<object, WeakMap<ParseNode, AnalyzerNodeInfo>>();
    private readonly _fileInfoByTree = new WeakMap<object, AnalyzerFileInfo>();

    get(node: ParseNode): AnalyzerNodeInfo | undefined {
        return this._infoByTree.get(node.a)?.get(node);
    }

    getFileInfo(node: ParseNode): AnalyzerFileInfo | undefined {
        return this._fileInfoByTree.get(node.a);
    }

    getOrCreate(node: ParseNode): AnalyzerNodeInfo {
        let treeInfo = this._infoByTree.get(node.a);
        if (!treeInfo) {
            treeInfo = new WeakMap<ParseNode, AnalyzerNodeInfo>();
            this._infoByTree.set(node.a, treeInfo);
        }

        let info = treeInfo.get(node);
        if (!info) {
            info = {};
            treeInfo.set(node, info);
        }
        return info;
    }

    setFileInfo(root: ModuleNode, fileInfo: AnalyzerFileInfo): void {
        this._fileInfoByTree.set(root.a, fileInfo);
    }
}

export interface AnalyzerNodeInfoBindingSession extends AnalyzerNodeInfoWriter {
    readonly root: ModuleNode;
}

export interface AnalyzerNodeInfoContext extends AnalyzerNodeInfoReader {
    getCurrentLayerReader(): AnalyzerNodeInfoReader;
    beginWrite(root: ModuleNode): AnalyzerNodeInfoBindingSession;
    publish(session: AnalyzerNodeInfoBindingSession): AnalyzerNodeInfoStore;
    registerStore(root: ModuleNode, store: AnalyzerNodeInfoStore): void;
    remove(root: ModuleNode): void;
    enterOverlay(): void;
    // Preserves an overlay-produced store for a tree that survives the overlay.
    promoteToPreviousLayer(root: ModuleNode): void;
    discardOverlay(): void;
    dispose(): void;
}

interface AnalyzerNodeInfoContextLayer {
    readonly stores: WeakMap<object, AnalyzerNodeInfoStore>;
    readonly removedKeys: WeakSet<object>;
}

class AnalyzerNodeInfoBindingSessionImpl implements AnalyzerNodeInfoBindingSession {
    private readonly _store = new AnalyzerNodeInfoStore();
    private _published = false;

    constructor(readonly root: ModuleNode, private readonly _context: AnalyzerNodeInfoContextImpl) {}

    get(node: ParseNode): AnalyzerNodeInfo | undefined {
        if (node.a === this.root.a) {
            return this._store.get(node);
        }

        return this._context.get(node);
    }

    getFileInfo(node: ParseNode): AnalyzerFileInfo | undefined {
        if (node.a === this.root.a) {
            return this._store.getFileInfo(node);
        }

        return this._context.getFileInfo(node);
    }

    getOrCreate(node: ParseNode): AnalyzerNodeInfo {
        this._verifyWritable(node);
        return this._store.getOrCreate(node);
    }

    setFileInfo(root: ModuleNode, fileInfo: AnalyzerFileInfo): void {
        this._verifyWritable(root);
        this._store.setFileInfo(root, fileInfo);
    }

    publish(context: AnalyzerNodeInfoContextImpl): AnalyzerNodeInfoStore {
        if (context !== this._context) {
            throw new Error('Cannot publish analyzer information to a different context');
        }

        if (this._published) {
            throw new Error('Analyzer information binding session was already published');
        }

        this._published = true;
        return this._store;
    }

    private _verifyWritable(node: ParseNode) {
        if (this._published) {
            throw new Error('Cannot write analyzer information after publication');
        }

        if (node.a !== this.root.a) {
            throw new Error('Cannot write analyzer information for a foreign parse tree');
        }
    }
}

export class AnalyzerNodeInfoContextImpl implements AnalyzerNodeInfoContext {
    private _layers: AnalyzerNodeInfoContextLayer[] = [this._createLayer()];
    private _disposed = false;
    private readonly _currentLayerReader: AnalyzerNodeInfoReader = {
        get: (node) => this._getFromCurrentLayer(node),
        getFileInfo: (node) => this._getFileInfoFromCurrentLayer(node),
    };

    get(node: ParseNode): AnalyzerNodeInfo | undefined {
        if (this._disposed) {
            return undefined;
        }

        // Fast path: no edit-mode overlay is active (the steady-state batch/check
        // case always has just the base layer). Skip the layer-walk loop and the
        // removedKeys tombstone check: a tree removed from the base layer also has
        // its store deleted, so stores.get returns undefined for it anyway.
        const layers = this._layers;
        if (layers.length === 1) {
            return layers[0].stores.get(node.a)?.get(node);
        }

        for (let index = layers.length - 1; index >= 0; index--) {
            const layer = layers[index];
            if (layer.removedKeys.has(node.a)) {
                return undefined;
            }

            const store = layer.stores.get(node.a);
            if (store) {
                return store.get(node);
            }
        }

        return undefined;
    }

    getFileInfo(node: ParseNode): AnalyzerFileInfo | undefined {
        if (this._disposed) {
            return undefined;
        }

        const layers = this._layers;
        if (layers.length === 1) {
            return layers[0].stores.get(node.a)?.getFileInfo(node);
        }

        for (let index = layers.length - 1; index >= 0; index--) {
            const layer = layers[index];
            if (layer.removedKeys.has(node.a)) {
                return undefined;
            }

            const store = layer.stores.get(node.a);
            if (store) {
                return store.getFileInfo(node);
            }
        }

        return undefined;
    }

    getCurrentLayerReader(): AnalyzerNodeInfoReader {
        return this._currentLayerReader;
    }

    beginWrite(root: ModuleNode): AnalyzerNodeInfoBindingSession {
        this._throwIfDisposed();
        return new AnalyzerNodeInfoBindingSessionImpl(root, this);
    }

    publish(session: AnalyzerNodeInfoBindingSession): AnalyzerNodeInfoStore {
        this._throwIfDisposed();
        if (!(session instanceof AnalyzerNodeInfoBindingSessionImpl)) {
            throw new Error('Cannot publish an analyzer information binding session from a different implementation');
        }

        const store = session.publish(this);
        this.registerStore(session.root, store);
        return store;
    }

    registerStore(root: ModuleNode, store: AnalyzerNodeInfoStore): void {
        this._throwIfDisposed();
        const layer = this._layers[this._layers.length - 1];
        layer.removedKeys.delete(root.a);
        layer.stores.set(root.a, store);
    }

    remove(root: ModuleNode): void {
        this._throwIfDisposed();
        const layer = this._layers[this._layers.length - 1];
        layer.stores.delete(root.a);
        layer.removedKeys.add(root.a);
    }

    enterOverlay(): void {
        this._throwIfDisposed();
        this._layers.push(this._createLayer());
    }

    promoteToPreviousLayer(root: ModuleNode): void {
        this._throwIfDisposed();
        if (this._layers.length < 2) {
            return;
        }

        const top = this._layers[this._layers.length - 1];
        const store = top.stores.get(root.a);
        if (!store) {
            return;
        }

        const previous = this._layers[this._layers.length - 2];
        previous.removedKeys.delete(root.a);
        previous.stores.set(root.a, store);
        top.stores.delete(root.a);
    }

    discardOverlay(): void {
        this._throwIfDisposed();
        if (this._layers.length === 1) {
            throw new Error('Cannot discard the base analyzer information context layer');
        }

        this._layers.pop();
    }

    dispose(): void {
        this._layers = [];
        this._disposed = true;
    }

    private _createLayer(): AnalyzerNodeInfoContextLayer {
        return {
            stores: new WeakMap<object, AnalyzerNodeInfoStore>(),
            removedKeys: new WeakSet<object>(),
        };
    }

    private _getFromCurrentLayer(node: ParseNode): AnalyzerNodeInfo | undefined {
        if (this._disposed) {
            return undefined;
        }

        const layer = this._layers[this._layers.length - 1];
        if (layer.removedKeys.has(node.a)) {
            return undefined;
        }

        return layer.stores.get(node.a)?.get(node);
    }

    private _getFileInfoFromCurrentLayer(node: ParseNode): AnalyzerFileInfo | undefined {
        if (this._disposed) {
            return undefined;
        }

        const layer = this._layers[this._layers.length - 1];
        if (layer.removedKeys.has(node.a)) {
            return undefined;
        }

        return layer.stores.get(node.a)?.getFileInfo(node);
    }

    private _throwIfDisposed() {
        if (this._disposed) {
            throw new Error('Analyzer node information context is disposed');
        }
    }
}

export type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode | ComprehensionNode;

export class AnalyzerNodeInfoAccessor implements AnalyzerNodeInfoReader {
    constructor(private readonly _reader: AnalyzerNodeInfoReader, private readonly _writer?: AnalyzerNodeInfoWriter) {}

    get(node: ParseNode) {
        return this._reader.get(node);
    }

    getImportInfo(node: ParseNode) {
        return getImportInfo(node, this._reader);
    }

    setImportInfo(node: ParseNode, importInfo: ImportResult) {
        this._write((writer) => setImportInfo(node, importInfo, writer));
    }

    getScope(node: ParseNode) {
        return getScope(node, this._reader);
    }

    setScope(node: ParseNode, scope: Scope) {
        this._write((writer) => setScope(node, scope, writer));
    }

    getDeclaration(node: ParseNode) {
        return getDeclaration(node, this._reader);
    }

    setDeclaration(node: ParseNode, declaration: Declaration) {
        this._write((writer) => setDeclaration(node, declaration, writer));
    }

    getStaticConditionValue(node: IfNode) {
        return getStaticConditionValue(node, this._reader);
    }

    setStaticConditionValue(node: IfNode, value: boolean | undefined) {
        this._write((writer) => setStaticConditionValue(node, value, writer));
    }

    getFlowNode(node: ParseNode) {
        return getFlowNode(node, this._reader);
    }

    setFlowNode(node: ParseNode, flowNode: FlowNode) {
        this._write((writer) => setFlowNode(node, flowNode, writer));
    }

    getAfterFlowNode(node: ParseNode) {
        return getAfterFlowNode(node, this._reader);
    }

    setAfterFlowNode(node: ParseNode, flowNode: FlowNode) {
        this._write((writer) => setAfterFlowNode(node, flowNode, writer));
    }

    getFileInfoIfAvailable(node: ParseNode) {
        return getFileInfoIfAvailable(node, this._reader);
    }

    getFileInfo(node: ParseNode) {
        return getFileInfo(node, this._reader);
    }

    setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
        this._write((writer) => setFileInfo(node, fileInfo, writer));
    }

    getCodeFlowExpressions(node: ExecutionScopeNode) {
        return getCodeFlowExpressions(node, this._reader);
    }

    setCodeFlowExpressions(node: ExecutionScopeNode, expressions: Set<string>) {
        this._write((writer) => setCodeFlowExpressions(node, expressions, writer));
    }

    getCodeFlowComplexity(node: ExecutionScopeNode) {
        return getCodeFlowComplexity(node, this._reader);
    }

    setCodeFlowComplexity(node: ExecutionScopeNode, complexity: number) {
        this._write((writer) => setCodeFlowComplexity(node, complexity, writer));
    }

    getDunderAllInfo(node: ModuleNode) {
        return getDunderAllInfo(node, this._reader);
    }

    setDunderAllInfo(node: ModuleNode, names: DunderAllInfo | undefined) {
        this._write((writer) => setDunderAllInfo(node, names, writer));
    }

    getStringAnnotation(node: StringListNode) {
        return getStringAnnotation(node, this._reader);
    }

    setStringAnnotation(node: StringListNode, annotation: ExpressionNode, nestedAnnotations: StringAnnotationInfo) {
        setStringAnnotation(node, annotation, nestedAnnotations, this._reader);
    }

    isCodeUnreachable(node: ParseNode) {
        return isCodeUnreachable(node, this._reader);
    }

    private _getWriter() {
        if (!this._writer) {
            throw new Error('Analyzer node information accessor is read-only');
        }

        return this._writer;
    }

    private _write(callback: (writer: AnalyzerNodeInfoWriter) => void) {
        callback(this._getWriter());
    }
}

export function createAnalyzerNodeInfoAccessor(reader: AnalyzerNodeInfoReader, writer?: AnalyzerNodeInfoWriter) {
    return new AnalyzerNodeInfoAccessor(reader, writer);
}

export function getImportInfo(node: ParseNode, reader: AnalyzerNodeInfoReader): ImportResult | undefined {
    const info = reader.get(node);
    return info?.importInfo;
}

export function setImportInfo(node: ParseNode, importInfo: ImportResult, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.importInfo = importInfo;
}

export function getScope(node: ParseNode, reader: AnalyzerNodeInfoReader): Scope | undefined {
    const info = reader.get(node);
    return info?.scope;
}

export function setScope(node: ParseNode, scope: Scope, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.scope = scope;
}

export function getDeclaration(node: ParseNode, reader: AnalyzerNodeInfoReader): Declaration | undefined {
    const info = reader.get(node);
    return info?.declaration;
}

export function setDeclaration(node: ParseNode, decl: Declaration, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.declaration = decl;
}

export function getStaticConditionValue(node: IfNode, reader: AnalyzerNodeInfoReader): boolean | undefined {
    const info = reader.get(node);
    return info?.staticConditionValue;
}

export function setStaticConditionValue(node: IfNode, value: boolean | undefined, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.staticConditionValue = value;
}

export function getFlowNode(node: ParseNode, reader: AnalyzerNodeInfoReader): FlowNode | undefined {
    const info = reader.get(node);
    return info?.flowNode;
}

export function setFlowNode(node: ParseNode, flowNode: FlowNode, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.flowNode = flowNode;
}

export function getAfterFlowNode(node: ParseNode, reader: AnalyzerNodeInfoReader): FlowNode | undefined {
    const info = reader.get(node);
    return info?.afterFlowNode;
}

export function setAfterFlowNode(node: ParseNode, flowNode: FlowNode, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.afterFlowNode = flowNode;
}

export function getStringAnnotation(node: StringListNode, reader: AnalyzerNodeInfoReader): ExpressionNode | undefined {
    // Precedence and tier asymmetry (do not reorder):
    //   Tier 1 - parser-derived quoted annotations (e.g. `x: "Data"`) are established by the
    //            grammar during parsing. They are owner-independent and live on the shared parse
    //            tree's owner key, so they are visible to every Program that reuses the tree.
    //   Tier 2 - semantically-discovered annotations (e.g. `cast("Data", v)`, alias-dependent
    //            forward refs) are owner-specific and stored per-`fileInfo` under the root node.
    // Parser annotations always win: an ordinary string is only consulted against the tier-2
    // store when no tier-1 annotation exists. Merging or reordering these lookups would break
    // cross-owner isolation (two Programs sharing a root could see each other's semantic results).
    const parserAnnotation = getParserStringAnnotation(node);
    if (parserAnnotation) {
        return parserAnnotation;
    }

    const root = getParseTreeRoot(node);
    if (!root) {
        return undefined;
    }

    const fileInfo = reader.getFileInfo(node);
    return fileInfo ? reader.get(root)?.stringAnnotations?.get(fileInfo)?.get(node) : undefined;
}

export function setStringAnnotation(
    node: StringListNode,
    annotation: ExpressionNode,
    nestedAnnotations: StringAnnotationInfo,
    reader: AnalyzerNodeInfoReader
) {
    const root = getParseTreeRoot(node);
    const fileInfo = reader.getFileInfo(node);
    const rootInfo = root ? reader.get(root) : undefined;
    if (!root || !fileInfo || !rootInfo) {
        throw new Error('String annotations require a bound parse tree');
    }

    rootInfo.stringAnnotations ??= new WeakMap();
    let ownerAnnotations = rootInfo.stringAnnotations.get(fileInfo);
    if (!ownerAnnotations) {
        ownerAnnotations = new WeakMap();
        rootInfo.stringAnnotations.set(fileInfo, ownerAnnotations);
    }

    ownerAnnotations.set(node, annotation);
    nestedAnnotations.forEach((nestedAnnotation, nestedNode) => {
        ownerAnnotations.set(nestedNode, nestedAnnotation);
    });
}

export function getFileInfoIfAvailable(node: ParseNode, reader: AnalyzerNodeInfoReader): AnalyzerFileInfo | undefined {
    return reader.getFileInfo(node);
}

export function getFileInfo(node: ParseNode, reader: AnalyzerNodeInfoReader): AnalyzerFileInfo {
    return getFileInfoIfAvailable(node, reader)!;
}

export function setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo, writer: AnalyzerNodeInfoWriter) {
    writer.setFileInfo(node, fileInfo);
}

export function getCodeFlowExpressions(
    node: ExecutionScopeNode,
    reader: AnalyzerNodeInfoReader
): Set<string> | undefined {
    const info = reader.get(node);
    return info?.codeFlowExpressions;
}

export function setCodeFlowExpressions(
    node: ExecutionScopeNode,
    expressions: Set<string>,
    writer: AnalyzerNodeInfoWriter
) {
    const info = writer.getOrCreate(node);
    info.codeFlowExpressions = expressions;
}

export function getCodeFlowComplexity(node: ExecutionScopeNode, reader: AnalyzerNodeInfoReader) {
    const info = reader.get(node);
    return info?.codeFlowComplexity ?? 0;
}

export function setCodeFlowComplexity(node: ExecutionScopeNode, complexity: number, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.codeFlowComplexity = complexity;
}

export function getDunderAllInfo(node: ModuleNode, reader: AnalyzerNodeInfoReader): DunderAllInfo | undefined {
    const info = reader.get(node);
    return info?.dunderAllInfo;
}

export function setDunderAllInfo(node: ModuleNode, names: DunderAllInfo | undefined, writer: AnalyzerNodeInfoWriter) {
    const info = writer.getOrCreate(node);
    info.dunderAllInfo = names;
}

export function isCodeUnreachable(node: ParseNode, reader: AnalyzerNodeInfoReader): boolean {
    let curNode: ParseNode | undefined = node;

    // Walk up the parse tree until we find a node with
    // an associated flow node.
    while (curNode) {
        const flowNode = getFlowNode(curNode, reader);
        if (flowNode) {
            return (flowNode.flags & (FlowFlags.UnreachableStaticCondition | FlowFlags.UnreachableStructural)) !== 0;
        }
        curNode = curNode.parent;
    }

    return false;
}
