/*
* factory.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*
* Provides a way to create virtual file system out of real file system
*/

import * as path from "./pathUtils"
import { computeLineStarts } from "../utils";
import { FileSystemOptions, FileSystemResolverHost, FileSystem, FileSystemResolver, Mount, S_IFDIR, S_IFREG } from "./filesystem";
import { bufferFrom } from "../io";
import { normalizeSlashes } from "../../../common/pathUtils";

export class TextDocument {
    public readonly meta: Map<string, string>;
    public readonly file: string;
    public readonly text: string;

    private _lineStarts: readonly number[] | undefined;
    private _testFile: TestFile | undefined;

    constructor(file: string, text: string, meta?: Map<string, string>) {
        this.file = file;
        this.text = text;
        this.meta = meta || new Map<string, string>();
    }

    public get lineStarts(): readonly number[] {
        return this._lineStarts || (this._lineStarts = computeLineStarts(this.text));
    }

    public static fromTestFile(file: TestFile) {
        return new TextDocument(
            file.unitName,
            file.content,
            file.fileOptions && Object.keys(file.fileOptions)
                .reduce((meta, key) => meta.set(key, file.fileOptions[key]), new Map<string, string>()));
    }

    public asTestFile() {
        return this._testFile || (this._testFile = {
            unitName: this.file,
            content: this.text,
            fileOptions: Array.from(this.meta)
                .reduce((obj, [key, value]) => (obj[key] = value, obj), {} as Record<string, string>)
        });
    }
}

export interface TestFile {
    unitName: string;
    content: string;
    fileOptions?: any;
}

export interface FileSystemCreateOptions extends FileSystemOptions {
    // Sets the documents to add to the file system.
    documents?: readonly TextDocument[];
}

export const typeshedFolder = normalizeSlashes("/typeshed-fallback");
export const libFolder = normalizeSlashes("/.lib");
export const srcFolder = normalizeSlashes("/.src");

/**
 * Create a virtual file system from a physical file system using the following path mappings:
 *
 *  - `/.lib` is a directory mapped to `${workspaceRoot}/tests/lib`
 *  - `/.src` is a virtual directory to be used for tests.
 *
 * Unless overridden, `/.src` will be the current working directory for the virtual file system.
 */
export function createFromFileSystem(host: FileSystemResolverHost, ignoreCase: boolean, { documents, files, cwd, time, meta }: FileSystemCreateOptions = {}) {
    const fs = getBuiltLocal(host, meta ? meta[typeshedFolder] : undefined, ignoreCase).shadow();
    if (meta) {
        for (const key of Object.keys(meta)) {
            fs.meta.set(key, meta[key]);
        }
    }
    if (time) {
        fs.time(time);
    }
    if (cwd) {
        fs.mkdirpSync(cwd);
        fs.chdir(cwd);
    }
    if (documents) {
        for (const document of documents) {
            fs.mkdirpSync(path.dirname(document.file));
            fs.writeFileSync(document.file, document.text, "utf8");
            fs.filemeta(document.file).set("document", document);
            // Add symlinks
            const symlink = document.meta.get("symlink");
            if (symlink) {
                for (const link of symlink.split(",").map(link => link.trim())) {
                    fs.mkdirpSync(path.dirname(link));
                    fs.symlinkSync(path.resolve(fs.cwd(), document.file), link);
                }
            }
        }
    }
    if (files) {
        fs.apply(files);
    }
    return fs;
}

let cacheKey: { host: FileSystemResolverHost; typeshedFolderPath: string | undefined } | undefined;
let localCIFSCache: FileSystem | undefined;
let localCSFSCache: FileSystem | undefined;

function getBuiltLocal(host: FileSystemResolverHost, typeshedFolderPath: string | undefined, ignoreCase: boolean): FileSystem {
    if (cacheKey?.host !== host || cacheKey.typeshedFolderPath != typeshedFolderPath) {
        localCIFSCache = undefined;
        localCSFSCache = undefined;
        cacheKey = { host, typeshedFolderPath };
    }
    if (!localCIFSCache) {
        const resolver = createResolver(host);
        typeshedFolderPath = typeshedFolderPath ?? path.resolve(host.getWorkspaceRoot(), "../dist/typeshed-fallback");
        localCIFSCache = new FileSystem(/*ignoreCase*/ true, {
            files: {
                [typeshedFolder]: new Mount(typeshedFolderPath, resolver),
                [srcFolder]: {}
            },
            cwd: srcFolder,
            meta: {}
        });
        localCIFSCache.makeReadonly();
    }

    if (ignoreCase) return localCIFSCache;

    if (!localCSFSCache) {
        localCSFSCache = localCIFSCache.shadow(/*ignoreCase*/ false);
        localCSFSCache.makeReadonly();
    }

    return localCSFSCache;
}

function createResolver(host: FileSystemResolverHost): FileSystemResolver {
    return {
        readdirSync(path: string): string[] {
            const { files, directories } = host.getAccessibleFileSystemEntries(path);
            return directories.concat(files);
        },
        statSync(path: string): { mode: number; size: number } {
            if (host.directoryExists(path)) {
                return { mode: S_IFDIR | 0o777, size: 0 };
            }
            else if (host.fileExists(path)) {
                return { mode: S_IFREG | 0o666, size: host.getFileSize(path) };
            }
            else {
                throw new Error("ENOENT: path does not exist");
            }
        },
        readFileSync(path: string): Buffer {
            return bufferFrom!(host.readFile(path)!, "utf8") as Buffer;
        }
    };
}
