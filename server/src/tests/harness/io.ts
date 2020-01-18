/*
* io.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import { FileSystemEntries } from "../../common/pathUtils";

export interface IO {
    newLine(): string;
    getCurrentDirectory(): string;
    useCaseSensitiveFileNames(): boolean;
    resolvePath(path: string): string | undefined;
    getFileSize(path: string): number;
    readFile(path: string): string | undefined;
    writeFile(path: string, contents: string): void;
    directoryName(path: string): string | undefined;
    getDirectories(path: string): string[];
    createDirectory(path: string): void;
    fileExists(fileName: string): boolean;
    directoryExists(path: string): boolean;
    deleteFile(fileName: string): void;
    // enumerateTestFiles(runner: RunnerBase): (string | IFileBasedTest)[];
    listFiles(path: string, filter?: RegExp, options?: {
        recursive?: boolean;
    }): string[];
    log(text: string): void;
    args(): string[];
    getExecutingFilePath(): string;
    getWorkspaceRoot(): string;
    exit(exitCode?: number): void;
    readDirectory(path: string, extension?: readonly string[],
        exclude?: readonly string[], include?: readonly string[], depth?: number): readonly string[];
    getAccessibleFileSystemEntries(dirname: string): FileSystemEntries;
    tryEnableSourceMapsForHost?(): void;
    getEnvironmentVariable?(name: string): string;
    getMemoryUsage?(): number | undefined;
}

export function bufferFrom(input: string, encoding?: BufferEncoding): Buffer {
    // See https://github.com/Microsoft/TypeScript/issues/25652
    return Buffer.from && (Buffer.from as Function) !== Int8Array.from
        ? Buffer.from(input, encoding) : new Buffer(input, encoding);
}

export const IOErrorMessages = Object.freeze({
    EACCES: "access denied",
    EIO: "an I/O error occurred",
    ENOENT: "no such file or directory",
    EEXIST: "file already exists",
    ELOOP: "too many symbolic links encountered",
    ENOTDIR: "no such directory",
    EISDIR: "path is a directory",
    EBADF: "invalid file descriptor",
    EINVAL: "invalid value",
    ENOTEMPTY: "directory not empty",
    EPERM: "operation not permitted",
    EROFS: "file system is read-only"
});

export function createIOError(code: keyof typeof IOErrorMessages, details = "") {
    const err: NodeJS.ErrnoException = new Error(`${code}: ${IOErrorMessages[code]} ${details}`);
    err.code = code;
    if (Error.captureStackTrace) Error.captureStackTrace(err, createIOError);
    return err;
}
