/*
 * virtualFileOverlayFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system overlay that redirects read operations for specific files
 * to alternate locations on disk. Used for the virtual file system where an
 * external client (e.g. Pylance's Django stub sidecar) writes merged .py files
 * to a virtual directory and asks the type server to read those instead.
 *
 * Unlike ReadOnlyAugmentedFileSystem.mapDirectory() which maps entire
 * directories and hides the originals, this overlay operates at the file
 * level: only explicitly registered files are redirected, and all other
 * files pass through to the underlying FS unchanged.
 */

import type { Dirent, ReadStream, WriteStream } from 'fs';
import { Disposable } from 'vscode-jsonrpc';

import { FileSystem, MkDirOptions, Stats } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from '../common/fileWatcher';
import { Uri } from '../common/uri/uri';
import { UriMap } from '../common/uri/uriMap';

/**
 * A file system wrapper that redirects read operations for individual files
 * to alternate locations on disk (virtual files).
 *
 * Redirected operations (go to virtual path when redirect exists):
 * - readFileSync, readFile, readFileText — content reads
 * - statSync — for correct mtime/cache invalidation
 * - createReadStream — streaming reads
 *
 * Non-redirected operations (always use real path):
 * - existsSync — the real file must exist for the redirect to be meaningful
 * - readdirEntriesSync, readdirSync — directory listings are unchanged
 * - realpathSync, realCasePath — canonical paths use the workspace path
 * - isMappedUri, getOriginalUri, getMappedUri — LSP intercept handles mapping
 * - All write operations — writes go to the real FS
 * - createFileSystemWatcher — watches real paths
 * - mapDirectory — delegates to the real FS
 */
export class VirtualFileOverlayFileSystem implements FileSystem {
    // Maps real file URIs to their virtual counterparts on disk.
    private readonly _fileRedirects = new UriMap<Uri>();

    constructor(private readonly _realFS: FileSystem) {}

    /**
     * Register a file redirect. When read operations are called for
     * `realUri`, the content will be read from `virtualUri` instead.
     * The virtual file MUST already exist on disk when this is called.
     *
     * Returns a Disposable that removes the redirect when disposed.
     */
    addFileRedirect(realUri: Uri, virtualUri: Uri): Disposable {
        this._fileRedirects.set(realUri, virtualUri);
        return {
            dispose: () => {
                this._fileRedirects.delete(realUri);
            },
        };
    }

    /**
     * Remove a file redirect.
     */
    removeFileRedirect(realUri: Uri): void {
        this._fileRedirects.delete(realUri);
    }

    /**
     * Check if a file has a virtual redirect.
     */
    hasRedirect(uri: Uri): boolean {
        return this._fileRedirects.has(uri);
    }

    /**
     * Remove all redirects.
     */
    clearRedirects(): void {
        this._fileRedirects.clear();
    }

    /**
     * Get all currently redirected real URIs.
     */
    getRedirectedUris(): Uri[] {
        return [...this._fileRedirects.keys()];
    }

    /**
     * Remove all redirects whose real URI is a child of `rootUri`.
     * Returns the removed real URIs so callers can forward removal notifications.
     */
    removeRedirectsUnder(rootUri: Uri): Uri[] {
        const removed: Uri[] = [];
        for (const realUri of this._fileRedirects.keys()) {
            if (realUri.isChild(rootUri)) {
                removed.push(realUri);
            }
        }
        for (const uri of removed) {
            this._fileRedirects.delete(uri);
        }
        return removed;
    }

    // --- ReadOnlyFileSystem: non-redirected operations ---

    existsSync(uri: Uri): boolean {
        return this._realFS.existsSync(uri);
    }

    chdir(uri: Uri): void {
        return this._realFS.chdir(uri);
    }

    readdirEntriesSync(uri: Uri): Dirent[] {
        return this._realFS.readdirEntriesSync(uri);
    }

    readdirSync(uri: Uri): string[] {
        return this._realFS.readdirSync(uri);
    }

    realpathSync(uri: Uri): Uri {
        return this._realFS.realpathSync(uri);
    }

    getModulePath(): Uri {
        return this._realFS.getModulePath();
    }

    realCasePath(uri: Uri): Uri {
        return this._realFS.realCasePath(uri);
    }

    isMappedUri(uri: Uri): boolean {
        return this._realFS.isMappedUri(uri);
    }

    getOriginalUri(mappedUri: Uri): Uri {
        return this._realFS.getOriginalUri(mappedUri);
    }

    getMappedUri(originalUri: Uri): Uri {
        return this._realFS.getMappedUri(originalUri);
    }

    isInZip(uri: Uri): boolean {
        return this._realFS.isInZip(uri);
    }

    // --- ReadOnlyFileSystem: redirected operations ---

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this._realFS.readFileSync(this._getRedirectedUri(uri), encoding as BufferEncoding);
    }

    statSync(uri: Uri): Stats {
        return this._realFS.statSync(this._getRedirectedUri(uri));
    }

    readFile(uri: Uri): Promise<Buffer> {
        return this._realFS.readFile(this._getRedirectedUri(uri));
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this._realFS.readFileText(this._getRedirectedUri(uri), encoding);
    }

    // --- FileSystem: write operations (never redirected) ---

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        return this._realFS.mkdirSync(uri, options);
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        return this._realFS.writeFileSync(uri, data, encoding);
    }

    unlinkSync(uri: Uri): void {
        return this._realFS.unlinkSync(uri);
    }

    rmdirSync(uri: Uri): void {
        return this._realFS.rmdirSync(uri);
    }

    createFileSystemWatcher(uris: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this._realFS.createFileSystemWatcher(uris, listener);
    }

    createReadStream(uri: Uri): ReadStream {
        return this._realFS.createReadStream(this._getRedirectedUri(uri));
    }

    createWriteStream(uri: Uri): WriteStream {
        return this._realFS.createWriteStream(uri);
    }

    copyFileSync(src: Uri, dst: Uri): void {
        return this._realFS.copyFileSync(src, dst);
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        return this._realFS.mapDirectory(mappedUri, originalUri, filter);
    }

    /**
     * Get the redirect target URI, or the original URI if no redirect exists.
     */
    private _getRedirectedUri(uri: Uri): Uri {
        return this._fileRedirects.get(uri) ?? uri;
    }
}
