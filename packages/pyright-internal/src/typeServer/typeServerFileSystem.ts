/*
 * typeServerFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * The file system used by the Pyright type server. It wraps the real file system in a
 * VirtualFileOverlayFileSystem so that individual files can be transparently redirected to
 * alternate on-disk locations (e.g. merged Django stubs produced by an external client), and
 * exposes that overlay via the `virtualOverlay` getter so the server's virtual-file-redirect
 * handlers (TspSupplemental) can register and remove redirects.
 *
 * This is the Pyright-native counterpart to Pylance's `PylanceFileSystem`. Notebook cell URI
 * mapping is optional here (supplied in the notebook phase); when no mapper is provided the
 * notebook branches simply delegate to the underlying file system.
 */

import type { Dirent, ReadStream, WriteStream } from 'fs';
import { Disposable } from 'vscode-jsonrpc';

import { FileSystem, MkDirOptions, Stats } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from '../common/fileWatcher';
import { Uri } from '../common/uri/uri';
import { IPyrightFileSystem, PyrightFileSystem } from '../pyrightFileSystem';

import { INotebookUriMapper, NotebookUriMapper } from './notebookUriMapper';
import { VirtualFileOverlayFileSystem } from './virtualFileOverlayFileSystem';

export class TypeServerFileSystem implements IPyrightFileSystem {
    private readonly _fs: IPyrightFileSystem;
    private readonly _virtualOverlay: VirtualFileOverlayFileSystem;

    constructor(realFileSystem: FileSystem, private readonly _uriMapper?: INotebookUriMapper) {
        // Wrap the real FS in a virtual file overlay so that individual files can be
        // transparently redirected to alternate on-disk locations. The overlay is a no-op
        // pass-through when no redirects are registered. Then wrap that in a PyrightFileSystem
        // so partial-stub augmentation continues to work.
        this._virtualOverlay = new VirtualFileOverlayFileSystem(realFileSystem);
        this._fs = new PyrightFileSystem(this._virtualOverlay);
    }

    /**
     * Returns the virtual file overlay layer. The server's virtual-file-redirect handlers use
     * this to add/remove per-file redirects that transparently redirect read operations to
     * alternate on-disk locations.
     */
    get virtualOverlay(): VirtualFileOverlayFileSystem {
        return this._virtualOverlay;
    }

    static is(obj: any): obj is TypeServerFileSystem {
        return obj instanceof TypeServerFileSystem;
    }

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        return this._fs.mkdirSync(uri, options);
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        return this._fs.writeFileSync(uri, data, encoding);
    }

    unlinkSync(uri: Uri): void {
        return this._fs.unlinkSync(uri);
    }

    rmdirSync(uri: Uri): void {
        return this._fs.rmdirSync(uri);
    }

    createFileSystemWatcher(uris: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this._fs.createFileSystemWatcher(uris, listener);
    }

    createReadStream(uri: Uri): ReadStream {
        return this._fs.createReadStream(uri);
    }

    createWriteStream(uri: Uri): WriteStream {
        return this._fs.createWriteStream(uri);
    }

    copyFileSync(src: Uri, dst: Uri): void {
        return this._fs.copyFileSync(src, dst);
    }

    existsSync(uri: Uri): boolean {
        return this._fs.existsSync(uri);
    }

    chdir(uri: Uri): void {
        return this._fs.chdir(uri);
    }

    readdirEntriesSync(uri: Uri): Dirent[] {
        return this._fs.readdirEntriesSync(uri);
    }

    readdirSync(uri: Uri): string[] {
        return this._fs.readdirSync(uri);
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this._fs.readFileSync(uri, encoding as BufferEncoding);
    }

    statSync(uri: Uri): Stats {
        return this._fs.statSync(uri);
    }

    realpathSync(uri: Uri): Uri {
        return this._fs.realpathSync(uri);
    }

    getModulePath(): Uri {
        return this._fs.getModulePath();
    }

    readFile(uri: Uri): Promise<Buffer> {
        return this._fs.readFile(uri);
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this._fs.readFileText(uri, encoding);
    }

    realCasePath(uri: Uri): Uri {
        return this._fs.realCasePath(uri);
    }

    isMappedUri(fileUri: Uri): boolean {
        if (this._uriMapper && NotebookUriMapper.isNotebookCell(fileUri)) {
            return true;
        }
        return this._fs.isMappedUri(fileUri);
    }

    getOriginalUri(mappedFileUri: Uri): Uri {
        if (this._uriMapper && NotebookUriMapper.isNotebookCell(mappedFileUri)) {
            return this._uriMapper.getOriginalCellUri(mappedFileUri);
        }
        return this._fs.getOriginalUri(mappedFileUri);
    }

    getMappedUri(originalFileUri: Uri): Uri {
        if (this._uriMapper && NotebookUriMapper.isNotebookCell(originalFileUri)) {
            return this._uriMapper.getMappedCellUri(originalFileUri);
        }
        return this._fs.getMappedUri(originalFileUri);
    }

    isInZip(uri: Uri): boolean {
        return this._fs.isInZip(uri);
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        if (this._uriMapper && NotebookUriMapper.isNotebookCell(mappedUri)) {
            return { dispose: () => {} };
        }
        return this._fs.mapDirectory(mappedUri, originalUri, filter);
    }
}
