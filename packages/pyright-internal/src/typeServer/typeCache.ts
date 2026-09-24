import { AnalyzerNodeInfoReader, getFileInfo } from '../analyzer/analyzerNodeInfo';
import { isClass, isFunction, isTypeVar, Type } from '../analyzer/types';
import { assert } from '../common/debug';
import { FileSystem } from '../common/fileSystem';
import { ServiceKeys } from '../common/serviceKeys';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { ParseNode, ParseTreeKey } from '../parser/parseNodes';
import { ParserOutput } from '../parser/parser';

import { Event, EventEmitter } from './eventEmitter';
import { INotebookUriMapper } from './notebookUriMapper';
import { TypeServerServiceKeys } from './typeServerServiceKeys';

export interface ITypeCache {
    snapshot: number;
    getUri(
        node: ParseNode,
        nodeInfo: AnalyzerNodeInfoReader,
        getActiveUri?: (key: ParseTreeKey) => Uri | undefined
    ): Uri;
    isCaseSensitive(uri: string): boolean;
    snapshotChanged: Event<number>;
    incrementSnapshot(): number;
}

export class TypeCache implements ITypeCache {
    private _snapshot: number = 0; // Make sure to start out as a valid snapshot.
    private _snapshotEmitter = EventEmitter.create<number>();
    private _parseTreeUris = new WeakMap<ParseTreeKey, Uri>();

    constructor(
        private readonly _serviceProvider: ServiceProvider,
        private readonly _getParserOutput: (uri: Uri) => ParserOutput | undefined,
        private readonly _getSourceUris?: () => Iterable<Uri>
    ) {}

    get snapshot(): number {
        return this._snapshot;
    }
    get snapshotChanged(): Event<number> {
        return this._snapshotEmitter.event;
    }
    get fs(): FileSystem {
        return this._serviceProvider.fs();
    }
    get uriMapper(): INotebookUriMapper | undefined {
        return this._serviceProvider.tryGet(TypeServerServiceKeys.uriMapper);
    }
    getTypeName(type: Type): string {
        if (isClass(type) || isFunction(type) || isTypeVar(type)) {
            return type.shared.name;
        }
        return 'unknown';
    }
    getUri(
        node: ParseNode,
        nodeInfo: AnalyzerNodeInfoReader,
        getActiveUri?: (key: ParseTreeKey) => Uri | undefined
    ): Uri {
        const fileInfo = getFileInfo(node, nodeInfo);
        if (fileInfo) {
            return fileInfo.fileUri;
        }

        // A caller can need the URI to bind the file that will provide file info.
        let uri = getActiveUri?.(node.a);
        if (uri) {
            this._parseTreeUris.set(node.a, uri);
            return uri;
        }

        uri = this._parseTreeUris.get(node.a);
        if (!uri) {
            this._populateParseTreeUris();
            uri = this._parseTreeUris.get(node.a);
        }
        assert(uri, 'Node must have file info');
        return uri ?? Uri.file('', this._serviceProvider);
    }

    getParserOutput(uri: Uri): ParserOutput | undefined {
        const parserOutput = this._getParserOutput(uri);
        if (parserOutput) {
            this._parseTreeUris.set(parserOutput.parseTree.a, uri);
        }
        return parserOutput;
    }
    isCaseSensitive(uri: string): boolean {
        return this._serviceProvider.get(ServiceKeys.caseSensitivityDetector).isCaseSensitive(uri);
    }

    incrementSnapshot(): number {
        // Increment the snapshot and clear the caches. Type and decl caches are not valid across snapshots.
        this._snapshot++;
        this._snapshotEmitter.fire(this._snapshot);
        return this._snapshot;
    }

    private _populateParseTreeUris(): void {
        if (this._getSourceUris) {
            for (const uri of this._getSourceUris()) {
                this.getParserOutput(uri);
            }
        }
    }
}
