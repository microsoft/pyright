/*
 * fileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A "file system provider" abstraction that allows us to swap out a
 * real file system implementation for a virtual (mocked) implementation
 * for testing.
 */

// * NOTE * except tests, this should be only file that import "fs"
import { FakeFS, NativePath, PortablePath, PosixFS, ppath, VirtualFS, ZipOpenFS } from '@yarnpkg/fslib';
import { getLibzipSync } from '@yarnpkg/libzip';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as tmp from 'tmp';

import { ConsoleInterface, NullConsole } from './console';
import { getRootLength } from './pathUtils';

// Automatically remove files created by tmp at process exit.
tmp.setGracefulCleanup();

export type FileWatcherEventType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type FileWatcherEventHandler = (eventName: FileWatcherEventType, path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface Stats {
    size: number;

    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

export interface MkDirOptions {
    recursive: boolean;
    // Not supported on Windows so commented out.
    // mode: string | number;
}

export interface TmpfileOptions {
    postfix?: string;
    prefix?: string;
}

export interface FileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options?: MkDirOptions): void;
    chdir(path: string): void;
    readdirEntriesSync(path: string): fs.Dirent[];
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer;
    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void;
    statSync(path: string): Stats;
    unlinkSync(path: string): void;
    realpathSync(path: string): string;
    getModulePath(): string;
    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
    createReadStream(path: string): fs.ReadStream;
    createWriteStream(path: string): fs.WriteStream;
    copyFileSync(src: string, dst: string): void;
    // Async I/O
    readFile(path: string): Promise<Buffer>;
    readFileText(path: string, encoding?: BufferEncoding): Promise<string>;
    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string;
    tmpfile(options?: TmpfileOptions): string;

    // Return path in casing on OS.
    realCasePath(path: string): string;
}

export interface FileWatcherProvider {
    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
}

// Callers can specify a different file watcher provider if desired.
// By default, we'll use the file watcher based on chokidar.
export function createFromRealFileSystem(
    console?: ConsoleInterface,
    fileWatcherProvider?: FileWatcherProvider
): FileSystem {
    console = console ?? new NullConsole();
    return new RealFileSystem(fileWatcherProvider ?? new ChokidarFileWatcherProvider(console), console);
}

// File watchers can give "changed" event even for a file open. but for those cases,
// it will give relative path rather than absolute path. To get rid of such cases,
// we will drop any event with relative paths. this trick is copied from VS Code
// (https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/node/watcher/unix/chokidarWatcherService.ts)
export function ignoredWatchEventFunction(paths: string[]) {
    const normalizedPaths = paths.map((p) => p.toLowerCase());
    return (path: string): boolean => {
        if (!path || path.indexOf('__pycache__') >= 0) {
            return true;
        }
        const normalizedPath = path.toLowerCase();
        return normalizedPaths.every((p) => normalizedPath.indexOf(p) < 0);
    };
}

const _isMacintosh = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

const DOT_ZIP = `.zip`;
const DOT_EGG = `.egg`;

// Exactly the same as ZipOpenFS's getArchivePart, but supporting .egg files.
// https://github.com/yarnpkg/berry/blob/64a16b3603ef2ccb741d3c44f109c9cfc14ba8dd/packages/yarnpkg-fslib/sources/ZipOpenFS.ts#L23
function getArchivePart(path: string) {
    let idx = path.indexOf(DOT_ZIP);
    if (idx <= 0) {
        idx = path.indexOf(DOT_EGG);
        if (idx <= 0) {
            return null;
        }
    }

    // Disallow files named ".zip"
    if (path[idx - 1] === ppath.sep) return null;

    const nextCharIdx = idx + DOT_ZIP.length; // DOT_ZIP and DOT_EGG are the same length.

    // The path either has to end in ".zip" or contain an archive subpath (".zip/...")
    if (path.length > nextCharIdx && path[nextCharIdx] !== ppath.sep) return null;

    return path.slice(0, nextCharIdx) as PortablePath;
}

// Returns true if the specified path may be inside of a zip or egg file.
// These files don't really exist, and will fail if navigated to in the editor.
export function isInZipOrEgg(path: string): boolean {
    return /[^\\/]\.(?:egg|zip)[\\/]/.test(path);
}

function hasZipOrEggExtension(p: string): boolean {
    return p.endsWith(DOT_ZIP) || p.endsWith(DOT_EGG);
}

// "Magic" values for the zip file type. https://en.wikipedia.org/wiki/List_of_file_signatures
const zipMagic = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

function hasZipMagic(fs: FakeFS<PortablePath>, p: PortablePath): boolean {
    let fd: number | undefined;
    try {
        fd = fs.openSync(p, 'r');
        const buffer = Buffer.alloc(4);
        const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);
        if (bytesRead < 4) {
            return false;
        }

        for (const magic of zipMagic) {
            if (buffer.compare(magic) === 0) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

// Patch fslib's ZipOpenFS to also consider .egg files to be .zip files.
//
// For now, override findZip (even though it's private), with the intent
// to upstream a change to allow overriding getArchivePart or add some
// other mechanism to support more extensions as zips (or, to remove this
// hack in favor of a full ZipOpenFS fork).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-expect-error
class EggZipOpenFS extends ZipOpenFS {
    // Copied from the ZipOpenFS implementation.
    private readonly baseFs!: FakeFS<PortablePath>;
    private readonly filter!: RegExp | null;
    private isZip!: Set<PortablePath>;
    private notZip!: Set<PortablePath>;

    findZip(p: PortablePath) {
        if (this.filter && !this.filter.test(p)) return null;

        let filePath = `` as PortablePath;

        while (true) {
            const archivePart = getArchivePart(p.substr(filePath.length));
            if (!archivePart) return null;

            filePath = this.pathUtils.join(filePath, archivePart);

            if (this.isZip.has(filePath) === false) {
                if (this.notZip.has(filePath)) continue;

                try {
                    if (!this.baseFs.lstatSync(filePath).isFile()) {
                        this.notZip.add(filePath);
                        continue;
                    }

                    if (!hasZipMagic(this.baseFs, filePath)) {
                        this.notZip.add(filePath);
                        continue;
                    }
                } catch {
                    return null;
                }

                this.isZip.add(filePath);
            }

            return {
                archivePath: filePath,
                subPath: this.pathUtils.join(PortablePath.root, p.substr(filePath.length) as PortablePath),
            };
        }
    }
}

class YarnFS extends PosixFS {
    private readonly _eggZipOpenFS: EggZipOpenFS;

    constructor() {
        const eggZipOpenFS = new EggZipOpenFS({
            libzip: () => getLibzipSync(),
            useCache: true,
            maxOpenFiles: 80,
            readOnlyArchives: true,
        });

        super(
            new VirtualFS({
                baseFs: eggZipOpenFS,
            })
        );

        this._eggZipOpenFS = eggZipOpenFS;
    }

    isZip(p: NativePath): boolean {
        return !!this._eggZipOpenFS.findZip(this.mapToBase(p));
    }
}

const yarnFS = new YarnFS();

class RealFileSystem implements FileSystem {
    private _tmpdir?: string;

    constructor(private _fileWatcherProvider: FileWatcherProvider, private _console: ConsoleInterface) {}

    existsSync(path: string) {
        try {
            // Catch zip open errors. existsSync is assumed to never throw by callers.
            return yarnFS.existsSync(path);
        } catch {
            return false;
        }
    }

    mkdirSync(path: string, options?: MkDirOptions) {
        yarnFS.mkdirSync(path, options);
    }

    chdir(path: string) {
        process.chdir(path);
    }

    readdirSync(path: string): string[] {
        return yarnFS.readdirSync(path);
    }

    readdirEntriesSync(path: string): fs.Dirent[] {
        return yarnFS.readdirSync(path, { withFileTypes: true }).map((entry): fs.Dirent => {
            // Treat zip/egg files as directories.
            // See: https://github.com/yarnpkg/berry/blob/master/packages/vscode-zipfs/sources/ZipFSProvider.ts
            if (hasZipOrEggExtension(entry.name)) {
                if (entry.isFile() && yarnFS.isZip(path)) {
                    return {
                        name: entry.name,
                        isFile: () => false,
                        isDirectory: () => true,
                        isBlockDevice: () => false,
                        isCharacterDevice: () => false,
                        isSymbolicLink: () => false,
                        isFIFO: () => false,
                        isSocket: () => false,
                    };
                }
            }
            return entry;
        });
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): Buffer | string;
    readFileSync(path: string, encoding: BufferEncoding | null = null) {
        if (encoding === 'utf8' || encoding === 'utf-8') {
            return yarnFS.readFileSync(path, 'utf8');
        }
        return yarnFS.readFileSync(path);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null) {
        yarnFS.writeFileSync(path, data, { encoding: encoding ?? undefined });
    }

    statSync(path: string) {
        const stat = yarnFS.statSync(path);
        // Treat zip/egg files as directories.
        // See: https://github.com/yarnpkg/berry/blob/master/packages/vscode-zipfs/sources/ZipFSProvider.ts
        if (hasZipOrEggExtension(path)) {
            if (stat.isFile() && yarnFS.isZip(path)) {
                return {
                    ...stat,
                    isFile: () => false,
                    isDirectory: () => true,
                };
            }
        }
        return stat;
    }

    unlinkSync(path: string) {
        yarnFS.unlinkSync(path);
    }

    realpathSync(path: string) {
        return yarnFS.realpathSync(path);
    }

    getModulePath(): string {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        return (global as any).__rootDirectory;
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._fileWatcherProvider.createFileWatcher(paths, listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return yarnFS.createReadStream(path);
    }

    createWriteStream(path: string): fs.WriteStream {
        return yarnFS.createWriteStream(path);
    }

    copyFileSync(src: string, dst: string): void {
        yarnFS.copyFileSync(src, dst);
    }

    readFile(path: string): Promise<Buffer> {
        return yarnFS.readFilePromise(path);
    }

    async readFileText(path: string, encoding: BufferEncoding): Promise<string> {
        if (encoding === 'utf8' || encoding === 'utf-8') {
            return yarnFS.readFilePromise(path, 'utf8');
        }
        const buffer = await yarnFS.readFilePromise(path);
        return buffer.toString(encoding);
    }

    tmpdir() {
        if (!this._tmpdir) {
            const dir = tmp.dirSync({ prefix: 'pyright' });
            this._tmpdir = dir.name;
        }
        return this._tmpdir;
    }

    tmpfile(options?: TmpfileOptions): string {
        const f = tmp.fileSync({ dir: this.tmpdir(), discardDescriptor: true, ...options });
        return f.name;
    }

    realCasePath(path: string): string {
        try {
            // If it doesn't exist in the real FS, return path as it is.
            if (!fs.existsSync(path)) {
                return path;
            }

            // realpathSync.native will return casing as in OS rather than
            // trying to preserve casing given.
            const realPath = fs.realpathSync.native(path);

            // path is not rooted, return as it is
            const rootLength = getRootLength(realPath);
            if (rootLength <= 0) {
                return realPath;
            }

            // path is rooted, make sure we lower case the root part
            // to follow vscode's behavior.
            return realPath.substr(0, rootLength).toLowerCase() + realPath.substr(rootLength);
        } catch (e) {
            // Return as it is, if anything failed.
            this._console.error(`Failed to get real file system casing for ${path}: ${e}`);

            return path;
        }
    }
}

class ChokidarFileWatcherProvider implements FileWatcherProvider {
    constructor(private _console: ConsoleInterface) {}

    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._createFileSystemWatcher(paths).on('all', listener);
    }

    private _createFileSystemWatcher(paths: string[]): chokidar.FSWatcher {
        // The following options are copied from VS Code source base. It also
        // uses chokidar for its file watching.
        const watcherOptions: chokidar.WatchOptions = {
            ignoreInitial: true,
            ignorePermissionErrors: true,
            followSymlinks: true, // this is the default of chokidar and supports file events through symlinks
            interval: 1000, // while not used in normal cases, if any error causes chokidar to fallback to polling, increase its intervals
            binaryInterval: 1000,
            disableGlobbing: true, // fix https://github.com/Microsoft/vscode/issues/4586
            awaitWriteFinish: {
                // this will make sure we re-scan files once file changes are written to disk
                stabilityThreshold: 1000,
                pollInterval: 1000,
            },
        };

        if (_isMacintosh) {
            // Explicitly disable on MacOS because it uses up large amounts of memory
            // and CPU for large file hierarchies, resulting in instability and crashes.
            watcherOptions.usePolling = false;
        }

        const excludes: string[] = ['**/__pycache__/**'];
        if (_isMacintosh || _isLinux) {
            if (paths.some((path) => path === '' || path === '/')) {
                excludes.push('/dev/**');
                if (_isLinux) {
                    excludes.push('/proc/**', '/sys/**');
                }
            }
        }
        watcherOptions.ignored = excludes;

        const watcher = chokidar.watch(paths, watcherOptions);
        watcher.on('error', (_) => {
            this._console.error('Error returned from file system watcher.');
        });

        // Detect if for some reason the native watcher library fails to load
        if (_isMacintosh && !watcher.options.useFsEvents) {
            this._console.info('Watcher could not use native fsevents library. File system watcher disabled.');
        }

        return watcher;
    }
}
