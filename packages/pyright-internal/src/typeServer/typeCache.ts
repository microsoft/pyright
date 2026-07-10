import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { isClass, isFunction, isTypeVar, Type } from '../analyzer/types';
import { assert } from '../common/debug';
import { FileSystem } from '../common/fileSystem';
import { ServiceKeys } from '../common/serviceKeys';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { ParseNode } from '../parser/parseNodes';
import { ParserOutput } from '../parser/parser';

import { Event, EventEmitter } from './eventEmitter';
import { INotebookUriMapper } from './notebookUriMapper';
import { TypeServerServiceKeys } from './typeServerServiceKeys';

export interface ITypeCache {
    snapshot: number;
    getUri(node: ParseNode): Uri;
    isCaseSensitive(uri: string): boolean;
    snapshotChanged: Event<number>;
    incrementSnapshot(): number;
}

export class TypeCache implements ITypeCache {
    private _snapshot: number = 0; // Make sure to start out as a valid snapshot.
    private _snapshotEmitter = EventEmitter.create<number>();

    constructor(
        private readonly _serviceProvider: ServiceProvider,
        private readonly _getParserOutput: (uri: Uri) => ParserOutput | undefined
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
    getUri(node: ParseNode): Uri {
        assert(getFileInfo(node), 'Node must have file info');
        return getFileInfo(node)?.fileUri ?? Uri.file('', this._serviceProvider);
    }

    getParserOutput(uri: Uri): ParserOutput | undefined {
        return this._getParserOutput(uri);
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
}
