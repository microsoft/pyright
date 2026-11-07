import type { Dirent, ReadStream, WriteStream } from 'fs';
import { Disposable } from 'vscode-jsonrpc';

import { getOrAdd } from '../common/collectionUtils';
import { FileSystem, MkDirOptions, Stats, VirtualDirent } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventHandler, FileWatcherProvider } from '../common/fileWatcher';
import { getPathComponents, normalizeSlashes } from '../common/pathUtils';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';

declare let XMLHttpRequest: {
    status: number;
    responseType: string;
    responseText: string;
    response: any;
    onload: () => void;
    new (): typeof XMLHttpRequest;
    open(method: string, url: string, async: boolean): void;
    setRequestHeader(header: string, value: string): void;
    send(): void;
};

export function normalizeWebSlashes(relativeWebPath: string) {
    const separatorRegExp = /[\\/]/g;
    return relativeWebPath.replace(separatorRegExp, '/');
}

const dotSlash = normalizeSlashes('./');

class BrowserFileWatcher implements FileWatcher {
    constructor(private _paths: string[], private _listener: FileWatcherEventHandler) {}
    fire() {
        for (const path of this._paths) {
            this._listener('change', path);
        }
    }
    close(): void {
        // Do nothing.
    }
}

class BrowserFileWatcherProvider implements FileWatcherProvider {
    private _watchers: BrowserFileWatcher[] = [];

    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        const watcher = new BrowserFileWatcher(paths, listener);
        this._watchers.push(watcher);
        return watcher;
    }

    fireChanged() {
        // Browser file system is simpler, just fire them all whenever we get a change.
        for (const watcher of this._watchers) {
            watcher.fire();
        }
    }
}

export class BrowserFileSystem implements FileSystem {
    private readonly _root: Uri;
    private _baseUris: Uri[] = [];
    private _map: Map<string, Entry>;
    private _reverseMap: Map<string, Entry>;
    private readonly _cache: Map<string, Dirent[]> = new Map<string, Dirent[]>();
    private readonly _contentsCache = new Map<string, string | Buffer | undefined>();
    private readonly _fileWatcherProvider = new BrowserFileWatcherProvider();
    private _downloadAccumulatedTimeMs = 0;

    constructor(
        root: string,
        baseUris: string[],
        prefetchRegexes: string[],
        private readonly _options: BrowserFileSystemOptions = {}
    ) {
        this._root = UriEx.file(normalizeSlashes(root));
        this._baseUris = baseUris.map((u) => UriEx.parse(u));
        const folderIndexes = this._baseUris.map((u) => {
            return { content: this._getContent(`folderIndex.json`, u, 'utf-8', undefined) as string, baseUri: u };
        });
        this._map = new Map<string, Entry>();
        this._reverseMap = new Map<string, Entry>();
        for (const index of folderIndexes) {
            this._addToFolderMap(index, this._map, this._reverseMap);
        }
        if (prefetchRegexes.length > 0) {
            this._prefetchFiles(prefetchRegexes).catch(() => {}); // Don't wait for the promise to resolve.
        }
    }

    existsSync(uri: Uri): boolean {
        const entry = this._getEntry(uri);
        return !!entry;
    }

    readdirEntriesSync(uri: Uri): Dirent[] {
        const entry = this._getEntry(uri);
        if (!entry || !entry.children) {
            return [];
        }

        const map = entry.children;
        const dirPath = uri.getPath();
        return getOrAdd(this._cache, uri.key, () =>
            [...map.values()].map((e) => new VirtualDirent(e.name, /* file */ !e.children, dirPath))
        );
    }

    readdirSync(uri: Uri): string[] {
        const entry = this._getEntry(uri);
        if (!entry || !entry.children) {
            return [];
        }

        return [...entry.children.keys()];
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer;
    readFileSync(path: Uri, encoding?: any): string | Buffer {
        const entry = this._getEntry(path);
        if (!entry) {
            throw new Error(`${path} doesn't exist`);
        }

        const relativePath = this._getRelativePath(path, entry.prefix);
        if (!relativePath) {
            return '';
        }

        return this._getContent(relativePath, entry.baseUri, encoding, entry.authHeader) || '';
    }

    readFileRangeSync(path: Uri, offset: number, length: number): Buffer {
        const entry = this._getEntry(path);
        if (!entry) {
            throw new Error(`${path} doesn't exist`);
        }

        const relativePath = this._getRelativePath(path, entry.prefix);
        if (!relativePath || length === 0) {
            return Buffer.alloc(0);
        }

        const cached = this._getCachedContent(relativePath, entry.baseUri, 'arraybuffer', entry.authHeader);
        if (Buffer.isBuffer(cached)) {
            return cached.subarray(offset, offset + length);
        }

        const request = new XMLHttpRequest();
        request.responseType = 'arraybuffer';
        request.open('GET', this._createBundledFileUri(relativePath, entry.baseUri), /* async */ false);
        request.setRequestHeader('Range', `bytes=${offset}-${offset + length - 1}`);
        if (entry.authHeader) {
            request.setRequestHeader('Authorization', entry.authHeader);
        }

        const start = performance.now();
        request.send();
        this._updateDurationTelemetry(performance.now() - start);
        const result = Buffer.from(request.response ?? []);
        const responseMatchesRequest = request.status === 206 || (request.status === 200 && offset === 0);
        if (!responseMatchesRequest || result.byteLength > length) {
            return Buffer.alloc(0);
        }
        return result;
    }

    statSync(uri: Uri): Stats {
        const entry = this._getEntry(uri);
        if (!entry) {
            throw new Error(`${uri} doesn't exist`);
        }

        const file = !entry.children;

        return {
            size: 1, // For now, we don't care actual file size. and it can only access ones we bundled.
            mtimeMs: -1, // No modified time for browser.
            ctimeMs: -1, // No creation time for browser.
            isFile: () => file,
            isDirectory: () => !file,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false,
        };
    }

    realpathSync(uri: Uri): Uri {
        return uri;
    }

    getModulePath(): Uri {
        return this._root;
    }

    createFileSystemWatcher(paths: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this._fileWatcherProvider.createFileWatcher(
            paths.map((p) => p.getPath()),
            listener
        );
    }

    realCasePath(uri: Uri): Uri {
        return uri;
    }

    isMappedUri(uri: Uri): boolean {
        // stdLib file is mapped. We need to use http locations for them
        // which is different than file path we use internally.
        return !!this._getEntry(uri);
    }

    getOriginalUri(mappedUri: Uri) {
        const entry = this._getEntry(mappedUri);
        if (entry) {
            const relativePath = this._getRelativePath(mappedUri);
            if (!relativePath) {
                return mappedUri;
            }

            return entry.baseUri.resolvePaths(relativePath);
        }

        return mappedUri;
    }

    getMappedUri(originalUri: Uri) {
        let entry = this._getReverseEntry(originalUri);
        if (entry) {
            // If we have a reverse entry, build up a mapped URI.
            let mappedUri = entry.name;
            while (entry.parent) {
                entry = entry.parent;
                mappedUri = entry.name === '/' ? entry.name + mappedUri : entry.name + '/' + mappedUri;
            }
            if (entry.prefix) {
                mappedUri = entry.prefix + '/' + mappedUri;
            }
            return this._root.resolvePaths(mappedUri);
        }
        return originalUri;
    }

    chdir(uri: Uri): void {
        // don't do anything
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        // don't do anything
    }

    rmdirSync(uri: Uri): void {
        // don't do anything
    }

    unlinkSync(uri: Uri): void {
        // don't do anything
    }

    copyFileSync(src: Uri, dst: Uri): void {
        // don't do anything
    }

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        // don't do anything
    }

    createReadStream(uri: Uri): ReadStream {
        throw new Error('Method not supported');
    }

    createWriteStream(uri: Uri): WriteStream {
        throw new Error('Method not supported');
    }

    readFile(uri: Uri): Promise<Buffer> {
        throw new Error('Method not supported');
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        throw new Error('Method not supported');
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        // Do nothing, not supported in browser.
        return {
            dispose: () => {
                // do nothing
            },
        };
    }

    isInZip(uri: Uri): boolean {
        return false;
    }

    removeDistUrl(distUrl: string) {
        const baseUri = UriEx.parse(distUrl);
        this._baseUris = this._baseUris.filter((u) => !u.equals(baseUri));
        const authHeader = this._findLastAuthHeader(baseUri);
        const content = this._getCachedContent(`folderIndex.json`, baseUri, 'text', authHeader) as string;
        if (content !== undefined) {
            this._clearCachedContent(`folderIndex.json`, baseUri, 'text', authHeader);
            const json = JSON.parse(content);
            const oldFiles = json.files;
            for (const file of oldFiles) {
                // Remove the file from the map.
                const prefix = this.computePrefix(file);
                const prefixParts = prefix ? prefix.split('/') : [];
                const fileParts = getPathComponents(file).slice(1);
                const parts = ['/', ...prefixParts, ...fileParts];
                this._deleteEntry(parts);
            }
        }

        // Fire a change event
        this._fileWatcherProvider.fireChanged();
    }

    addOrUpdateDistUrl(distUrl: string, authHeader?: string) {
        const baseUri = UriEx.parse(distUrl);

        // First remove any existing entries for this distUrl.
        this.removeDistUrl(distUrl);

        // Then reread the distUrl root
        const content = this._getContent(`folderIndex.json`, baseUri, 'utf-8', authHeader) as string;
        if (!content) {
            console.error(`Failed to read folderIndex.json from ${distUrl}. Check auth Token.`);
            return;
        }
        this._baseUris.push(baseUri);

        // Then add all of these folders into the map
        this._addToFolderMap({ content, baseUri, authHeader: authHeader }, this._map, this._reverseMap);

        // Fire a change event
        this._fileWatcherProvider.fireChanged();
    }

    protected getRelativeBasePath(file: string) {
        return file;
    }

    protected computePrefix(_file: string) {
        return '';
    }

    private _getContentsCacheKey(
        url: string,
        outputType: 'text' | 'arraybuffer' | 'blob',
        authHeader: string | undefined
    ): string {
        return `${url}::${outputType}::${authHeader ?? ''}`;
    }

    private _getTextAsync(relativeWebPath: string, baseUri: Uri, authHeader: string | undefined) {
        const url = this._createBundledFileUri(relativeWebPath, baseUri);
        const cached = this._getCachedContent(relativeWebPath, baseUri, 'text', authHeader);
        if (cached !== undefined) {
            return Promise.resolve(cached);
        }

        return new Promise<string | undefined>((resolve) => {
            const request = new XMLHttpRequest();
            request.open('GET', url, true);
            if (authHeader) {
                request.setRequestHeader('Authorization', authHeader);
            }
            request.onload = () => {
                // Don't count async time towards duration telemetry. We don't block on this time.
                if (request.status === 200) {
                    resolve(request.responseText);
                } else {
                    resolve(undefined);
                }
            };
            request.send();
        }).then((result) => {
            if (
                result !== undefined &&
                this._getCachedContent(relativeWebPath, baseUri, 'text', authHeader) === undefined
            ) {
                this._setCachedContent(relativeWebPath, baseUri, 'text', authHeader, result);
            }
            return result;
        });
    }

    private _getCachedContent(
        relativeWebPath: string,
        baseUri: Uri,
        outputType: 'text' | 'arraybuffer' | 'blob',
        authHeader: string | undefined
    ) {
        const url = this._createBundledFileUri(relativeWebPath, baseUri);
        const cacheKey = this._getContentsCacheKey(url, outputType, authHeader);
        return this._contentsCache.get(cacheKey);
    }

    private _setCachedContent(
        relativeWebPath: string,
        baseUri: Uri,
        outputType: 'text' | 'arraybuffer' | 'blob',
        authHeader: string | undefined,
        content: string | Buffer | undefined
    ) {
        const url = this._createBundledFileUri(relativeWebPath, baseUri);
        const cacheKey = this._getContentsCacheKey(url, outputType, authHeader);
        this._contentsCache.set(cacheKey, content);
    }

    private _clearCachedContent(
        relativeWebPath: string,
        baseUri: Uri,
        outputType: 'text' | 'arraybuffer' | 'blob',
        authHeader: string | undefined
    ) {
        const url = this._createBundledFileUri(relativeWebPath, baseUri);
        const cacheKey = this._getContentsCacheKey(url, outputType, authHeader);
        this._contentsCache.delete(cacheKey);
    }

    private _findLastAuthHeader(baseUri: Uri) {
        // Look in the contents cache to see if there's a key starting with the baseUri.
        let lastKey: string | undefined;
        for (const key of this._contentsCache.keys()) {
            if (key.startsWith(baseUri.toString())) {
                lastKey = key;
            }
        }

        // Authheader should be the last bit of the key.
        if (lastKey) {
            const keyParts = lastKey.split('::');
            return keyParts[keyParts.length - 1];
        }
        return undefined;
    }

    private _getContent(
        relativeWebPath: string,
        baseUri: Uri,
        encoding: string | undefined,
        authHeader: string | undefined
    ): string | Buffer | undefined {
        const url = this._createBundledFileUri(relativeWebPath, baseUri);
        let outputType: 'text' | 'arraybuffer' | 'blob' = encoding ? 'text' : 'arraybuffer';
        const cached = this._getCachedContent(relativeWebPath, baseUri, outputType, authHeader);
        if (cached !== undefined) {
            return cached;
        }

        const start = performance.now();
        // guard against insecure URL. https://liquid.microsoft.com/Web/Object/Read/scanningtoolwarnings/Requirements/CodeQL.SM02171#Zguide
        if (url.startsWith('http://')) {
            url.replace('http://', 'https://');
        }
        const request = new XMLHttpRequest();
        // Switch to a binary request if no encoding specified
        if (!encoding) {
            request.responseType = 'arraybuffer';
        }
        request.open('GET', url, /* async */ false);
        if (authHeader) {
            request.setRequestHeader('Authorization', authHeader);
        }
        try {
            request.send();
            this._updateDurationTelemetry(performance.now() - start);
            if (request.status === 200) {
                switch (request.responseType) {
                    case '':
                    case 'text':
                        this._setCachedContent(relativeWebPath, baseUri, 'text', authHeader, request.responseText);
                        outputType = 'text';
                        break;
                    case 'arraybuffer':
                        this._setCachedContent(
                            relativeWebPath,
                            baseUri,
                            'arraybuffer',
                            authHeader,
                            Buffer.from(request.response)
                        );
                        outputType = 'arraybuffer';
                        break;
                    case 'blob':
                        this._setCachedContent(relativeWebPath, baseUri, 'blob', authHeader, request.response);
                        outputType = 'blob';
                        break;
                    default:
                        throw new Error(`Unexpected response type: ${request.responseType}`);
                }
            } else if (this._options.throwOnReadError) {
                throw new Error(`Unable to read ${url}: HTTP ${request.status}`);
            }
        } catch (error) {
            if (this._options.throwOnReadError) {
                this._options.onReadError?.(error instanceof Error ? error : new Error(String(error)));
            }
            throw error;
        }
        return this._getCachedContent(relativeWebPath, baseUri, outputType, authHeader);
    }

    private _createBundledFileUri(relativeWebPath: string, baseUri: Uri) {
        const normalized = normalizeWebSlashes(relativeWebPath);
        const url = baseUri.resolvePaths(normalized).toString();
        return url;
    }

    private _getRelativePath(uri: Uri, prefix: string = '') {
        // we only supports utf8
        let relativePath = this._root.getRelativePath(uri);
        if (!relativePath) {
            return undefined;
        }

        if (relativePath.startsWith(dotSlash)) {
            relativePath = relativePath.substr(2);
        }

        return relativePath.slice(prefix ? prefix.length + 1 : 0);
    }

    private _addToFolderMap(
        folderIndex: { content: string | undefined; baseUri: Uri; authHeader?: string },
        map: Map<string, Entry>,
        reverseMap: Map<string, Entry>
    ) {
        if (folderIndex.content) {
            const json = JSON.parse(folderIndex.content);
            for (const file of json.files) {
                this._createEntry(file, folderIndex.baseUri, folderIndex.authHeader, map, reverseMap);
            }

            // Clear the cache as we've added new entries.
            this._cache.clear();
        } else {
            console.error(`Failed to read folderIndex.json from ${folderIndex.baseUri.toUserVisibleString()}.`);
        }
    }

    private _getPathComponents(uri: Uri, prefix: string) {
        const parts = uri.getPathComponents();
        if (prefix && prefix.includes('/')) {
            return [parts[0], ...prefix.split('/'), ...parts.slice(1)];
        }
        return parts;
    }

    private _createEntry(
        file: string,
        baseUri: Uri,
        authHeader: string | undefined,
        map: Map<string, Entry>,
        reverseMap: Map<string, Entry>
    ) {
        const normalized = normalizeSlashes(file);
        const prefix = this.computePrefix(file);

        // See if the file is a relative path. If so we need
        // to remove the relative parts and update the actual baseUri.
        const baseFilePath = this.getRelativeBasePath(file);
        const relative =
            normalized === baseFilePath ? '' : normalized.slice(0, normalized.length - baseFilePath.length);
        const trueBaseUri = relative ? baseUri.resolvePaths(relative) : baseUri;
        const fullPath = this._root.resolvePaths(baseFilePath);
        const directory = fullPath.getDirectory();
        let reverseUri = trueBaseUri;

        const parts = this._getPathComponents(directory, prefix);
        let current = map;
        let parentEntry: Entry | undefined = undefined;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const entry = getOrAdd(current, parts[i], () => ({
                baseUri: trueBaseUri,
                authHeader,
                name: parts[i],
                parent: parentEntry,
                prefix,
                children: new Map<string, Entry>(),
            }));

            current = entry.children!;
            parentEntry = entry;

            // Skip the first part as it is the root.
            if (i > 0) {
                reverseUri = reverseUri.resolvePaths(part);
            }
        }

        const fileName = fullPath.fileName;
        const finalEntry = {
            name: fileName,
            baseUri: trueBaseUri,
            prefix,
            authHeader,
            children: undefined,
            parent: parentEntry,
        };
        reverseUri = reverseUri.resolvePaths(fileName);
        current.set(fileName, finalEntry);
        reverseMap.set(reverseUri.toString(), finalEntry);
    }

    private _getReverseEntry(originalUri: Uri): Entry | undefined {
        // Find the entry in the reverse map.
        return this._reverseMap.get(originalUri.toString());
    }

    private _getEntry(uri: Uri): Entry | undefined {
        const parts = uri.getPathComponents();
        let current = this._map;
        let entry: Entry | undefined = {
            baseUri: UriEx.file('/'),
            name: '',
            prefix: '',
            children: current,
        };

        for (let i = 0; i < parts.length; i++) {
            entry = current.get(parts[i]);
            if (!entry) {
                return undefined;
            }

            if (i === parts.length - 1 && !entry.children) {
                // Last element is a file.
                return entry;
            }

            current = entry.children!;
        }

        return entry;
    }

    private _deleteEntry(parts: string[]) {
        let current: Map<string, Entry> | undefined = this._map;
        let entry: Entry | undefined = {
            baseUri: UriEx.file('/'),
            name: '',
            prefix: '',
            children: current,
        };
        const parents: Entry[] = [entry];
        for (let i = 0; i < parts.length; i++) {
            entry = current.get(parts[i]);
            if (!entry) {
                return;
            }

            if (i === parts.length - 1 && !entry.children) {
                // Last element is a file.
                current.delete(parts[i]);

                // Go up to the parent of the entry and delete
                // the parent if no other siblings.
                let j = i - 1;
                let parent = parents.pop();

                while (current && current.size === 0 && j >= 0 && parent) {
                    parent = parents.pop();
                    current = parent?.children;
                    const parentPart = parts[j];
                    current?.delete(parentPart);
                    j--;
                }
            }

            current = entry.children!;
            parents.push(entry);
        }

        // Have to clear the dir cache too.
        this._cache.clear();
    }

    private async _prefetchFiles(prefetchRegexes: string[]) {
        // Read all of the files listed in the folderindex.json and see
        // if they match the regex.
        const filesToDownload: { relativePath: string; baseUri: Uri }[] = [];
        for (const entry of this._map.values()) {
            for (const regex of prefetchRegexes) {
                this._findMatchingFiles(entry, regex, entry.name, filesToDownload);

                // Do these in order.
                await this._prefetchBatch(filesToDownload);

                // Clear the list.
                filesToDownload.length = 0;
            }
        }
    }

    private async _prefetchBatch(filesToDownload: { relativePath: string; baseUri: Uri; authHeader?: string }[]) {
        const fetches: Promise<string | Buffer | undefined>[] = [];
        for (const file of filesToDownload) {
            fetches.push(this._getTextAsync(file.relativePath, file.baseUri, file.authHeader));

            // Max out at 5 as browser can't handle that many requests at once.
            if (fetches.length === 5) {
                await Promise.all(fetches);
                fetches.length = 0;
            }
        }

        await Promise.all(fetches);
    }

    private _findMatchingFiles(
        entry: Entry,
        regex: string,
        parent: string,
        matches: { relativePath: string; baseUri: Uri }[]
    ) {
        const relativePath = parent.length > 1 ? `${parent}/${entry.name}` : entry.name;
        if (entry.children) {
            for (const child of entry.children.values()) {
                this._findMatchingFiles(child, regex, relativePath, matches);
            }
        } else {
            if (relativePath.match(regex)) {
                matches.push({ relativePath, baseUri: entry.baseUri });
            }
        }
    }

    private _updateDurationTelemetry(ms: number) {
        this._options.onDownload?.(ms);
        this._downloadAccumulatedTimeMs += ms;
    }
}

export interface BrowserFileSystemOptions {
    onDownload?: (durationMs: number) => void;
    onReadError?: (error: Error) => void;
    throwOnReadError?: boolean;
}

type Entry = {
    name: string;
    baseUri: Uri;
    authHeader?: string;
    prefix: string;
    children: Map<string, Entry> | undefined;
    parent?: Entry;
};
