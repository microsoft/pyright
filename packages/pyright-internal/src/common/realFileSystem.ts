/*
 * realFileSystem.ts
 *
 * Collection of helper functions that require real fs access.
 */

import { FakeFS, NativePath, PortablePath, PosixFS, ppath, VirtualFS, ZipFS, ZipOpenFS } from '@yarnpkg/fslib';
import { getLibzipSync } from '@yarnpkg/libzip';
import * as fs from 'fs';
import * as tmp from 'tmp';
import { URI } from 'vscode-uri';

import { WorkspaceMap } from '../workspaceMap';
import { ConsoleInterface, NullConsole } from './console';
import { isDefined } from './core';
import {
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    FileWatcherEventType,
    FileWatcherProvider,
    MkDirOptions,
    nullFileWatcherProvider,
    TmpfileOptions,
} from './fileSystem';
import { containsPath } from './pathUtils';
import { getRootLength } from './pathUtils';

// Automatically remove files created by tmp at process exit.
tmp.setGracefulCleanup();

// Callers can specify a different file watcher provider if desired.
// By default, we'll use the file watcher based on chokidar.
export function createFromRealFileSystem(
    console?: ConsoleInterface,
    fileWatcherProvider?: FileWatcherProvider
): FileSystem {
    console = console ?? new NullConsole();
    return new RealFileSystem(fileWatcherProvider ?? nullFileWatcherProvider, console);
}

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
    private override readonly baseFs!: FakeFS<PortablePath>;
    private override readonly filter!: RegExp | null;
    private override isZip!: Set<PortablePath>;
    private override notZip!: Set<PortablePath>;

    // Hack to provide typed access to this private method.
    private override getZipSync<T>(p: PortablePath, accept: (zipFs: ZipFS) => T): T {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-expect-error
        return super.getZipSync(p, accept);
    }

    override findZip(p: PortablePath) {
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

                    try {
                        // We're pretty sure that it's a zip at this point (it has the magic), but
                        // try accessing the zipfile anyway; if it's corrupt in some way, this will throw.
                        // We don't need to do anything with the ZipFS instance given to the callback
                        // below; ZipOpenFS already manages their lifetimes and we're very likely to
                        // immediately call back into the FS to obtain info from the zip anyway.
                        // eslint-disable-next-line @typescript-eslint/no-empty-function
                        this.getZipSync(filePath, () => {});
                    } catch {
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
        yarnFS.writeFileSync(path, data, encoding || undefined);
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
        } catch (e: any) {
            // Return as it is, if anything failed.
            this._console.error(`Failed to get real file system casing for ${path}: ${e}`);

            return path;
        }
    }

    isMappedFilePath(filepath: string): boolean {
        return false;
    }

    getOriginalFilePath(mappedFilePath: string) {
        return mappedFilePath;
    }

    getMappedFilePath(originalFilepath: string) {
        return originalFilepath;
    }

    getUri(path: string): string {
        return URI.file(path).toString();
    }

    isInZipOrEgg(path: string): boolean {
        return /[^\\/]\.(?:egg|zip)[\\/]/.test(path) && yarnFS.isZip(path);
    }
}

interface WorkspaceFileWatcher extends FileWatcher {
    // Paths that are being watched within the workspace
    workspacePaths: string[];

    // Event handler to call
    eventHandler: FileWatcherEventHandler;
}

export class WorkspaceFileWatcherProvider implements FileWatcherProvider {
    private _fileWatchers: WorkspaceFileWatcher[] = [];

    constructor(private _workspaceMap: WorkspaceMap, private _console: ConsoleInterface) {}

    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        // Determine which paths are located within one or more workspaces.
        // Those are already covered by existing file watchers handled by
        // the client.
        const workspacePaths: string[] = [];
        const nonWorkspacePaths: string[] = [];

        const workspaces = this._workspaceMap.getNonDefaultWorkspaces();
        paths.forEach((path) => {
            if (workspaces.some((workspace) => containsPath(workspace.rootPath, path))) {
                workspacePaths.push(path);
            } else {
                nonWorkspacePaths.push(path);
            }
        });

        // For any non-workspace paths, use the node file watcher.
        const nodeWatchers = nonWorkspacePaths
            .map((path) => {
                // Skip paths that don't exist; fs.watch will throw when it tries to watch them,
                // and won't give us a watcher that would work if it were created later.
                if (!fs.existsSync(path)) {
                    return undefined;
                }

                try {
                    return fs.watch(path, { recursive: true }, (event, filename) =>
                        listener(event as FileWatcherEventType, filename)
                    );
                } catch (e: any) {
                    this._console.warn(`Exception received when installing file system watcher: ${e}`);
                    return undefined;
                }
            })
            .filter(isDefined);

        const self = this;
        const fileWatcher: WorkspaceFileWatcher = {
            close() {
                // Stop listening for workspace paths.
                self._fileWatchers = self._fileWatchers.filter((watcher) => watcher !== fileWatcher);

                // Close the node watchers.
                nodeWatchers.forEach((watcher) => {
                    watcher.close();
                });
            },
            workspacePaths,
            eventHandler: listener,
        };

        // Record the file watcher.
        self._fileWatchers.push(fileWatcher);

        return fileWatcher;
    }

    onFileChange(eventType: FileWatcherEventType, filePath: string): void {
        this._fileWatchers.forEach((watcher) => {
            if (watcher.workspacePaths.some((dirPath) => containsPath(dirPath, filePath))) {
                watcher.eventHandler(eventType, filePath);
            }
        });
    }
}
