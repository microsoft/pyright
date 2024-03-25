/*
 * io.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as os from 'os';
import * as pathModule from 'path';

import { NullConsole } from '../../common/console';
import { combinePaths, FileSystemEntries, resolvePaths } from '../../common/pathUtils';
import { createFromRealFileSystem } from '../../common/realFileSystem';
import { compareStringsCaseInsensitive, compareStringsCaseSensitive } from '../../common/stringUtils';
import { directoryExists, fileExists, getFileSize, UriEx } from '../../common/uri/uriUtils';
import { FileUriSchema } from '../../common/uri/fileUri';
import { Uri } from '../../common/uri/uri';
import { CaseSensitivityDetector } from '../../common/caseSensitivityDetector';

export class TestCaseSensitivityDetector implements CaseSensitivityDetector {
    constructor(private _isCaseSensitive = true) {
        // Empty
    }

    setCaseSensitivity(value: boolean) {
        this._isCaseSensitive = value;
    }

    isCaseSensitive(uri: string): boolean {
        if (uri.startsWith(FileUriSchema)) {
            return this._isCaseSensitive;
        }

        return false;
    }
}

export const HOST: TestHost = createHost();

export interface TestHost {
    useCaseSensitiveFileNames(): boolean;
    getAccessibleFileSystemEntries(dirname: string): FileSystemEntries;
    directoryExists(path: string): boolean;
    fileExists(fileName: string): boolean;
    getFileSize(path: string): number;
    readFile(path: string): string | undefined;
    getWorkspaceRoot(): string;

    writeFile(path: string, contents: string): void;
    listFiles(
        path: string,
        filter?: RegExp,
        options?: {
            recursive?: boolean;
        }
    ): string[];
    log(text: string): void;
}

function createHost(): TestHost {
    // NodeJS detects "\uFEFF" at the start of the string and *replaces* it with the actual
    // byte order mark from the specified encoding. Using any other byte order mark does
    // not actually work.
    const byteOrderMarkIndicator = '\uFEFF';

    const caseDetector = new TestCaseSensitivityDetector();
    const vfs = createFromRealFileSystem(caseDetector, new NullConsole());

    const useCaseSensitiveFileNames = isFileSystemCaseSensitive();
    caseDetector.setCaseSensitivity(useCaseSensitiveFileNames);

    function isFileSystemCaseSensitive(): boolean {
        // win32\win64 are case insensitive platforms
        const platform = os.platform();
        if (platform === 'win32') {
            return false;
        }
        // If this file exists under a different case, we must be case-insensitve.
        return !vfs.existsSync(UriEx.file(swapCase(__filename)));

        /** Convert all lowercase chars to uppercase, and vice-versa */
        function swapCase(s: string): string {
            return s.replace(/\w/g, (ch) => {
                const up = ch.toUpperCase();
                return ch === up ? ch.toLowerCase() : up;
            });
        }
    }

    function listFiles(path: string, spec: RegExp, options: { recursive?: boolean } = {}) {
        function filesInFolder(folder: string): string[] {
            let paths: string[] = [];

            for (const file of vfs.readdirSync(Uri.file(folder, caseDetector))) {
                const pathToFile = pathModule.join(folder, file);
                const stat = vfs.statSync(Uri.file(pathToFile, caseDetector));
                if (options.recursive && stat.isDirectory()) {
                    paths = paths.concat(filesInFolder(pathToFile));
                } else if (stat.isFile() && (!spec || file.match(spec))) {
                    paths.push(pathToFile);
                }
            }

            return paths;
        }

        return filesInFolder(path);
    }

    function getAccessibleFileSystemEntries(dirname: string): FileSystemEntries {
        try {
            const entries: string[] = vfs
                .readdirSync(Uri.file(dirname || '.', caseDetector))
                .sort(useCaseSensitiveFileNames ? compareStringsCaseSensitive : compareStringsCaseInsensitive);
            const files: string[] = [];
            const directories: string[] = [];
            for (const entry of entries) {
                if (entry === '.' || entry === '..') {
                    continue;
                }
                const name = combinePaths(dirname, entry);
                try {
                    const stat = vfs.statSync(Uri.file(name, caseDetector));
                    if (!stat) {
                        continue;
                    }
                    if (stat.isFile()) {
                        files.push(entry);
                    } else if (stat.isDirectory()) {
                        directories.push(entry);
                    }
                } catch {
                    /* ignore */
                }
            }
            return { files, directories };
        } catch (e: any) {
            return { files: [], directories: [] };
        }
    }

    function readFile(fileName: string, _encoding?: string): string | undefined {
        if (!fileExists(vfs, Uri.file(fileName, caseDetector))) {
            return undefined;
        }
        const buffer = vfs.readFileSync(Uri.file(fileName, caseDetector));
        let len = buffer.length;
        if (len >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
            // Big endian UTF-16 byte order mark detected. Since big endian is not supported by node.js,
            // flip all byte pairs and treat as little endian.
            len &= ~1; // Round down to a multiple of 2
            for (let i = 0; i < len; i += 2) {
                const temp = buffer[i];
                buffer[i] = buffer[i + 1];
                buffer[i + 1] = temp;
            }
            return buffer.toString('utf16le', 2);
        }
        if (len >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
            // Little endian UTF-16 byte order mark detected
            return buffer.toString('utf16le', 2);
        }
        if (len >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
            // UTF-8 byte order mark detected
            return buffer.toString('utf8', 3);
        }
        // Default is UTF-8 with no byte order mark
        return buffer.toString('utf8');
    }

    function writeFile(fileName: string, data: string, writeByteOrderMark?: boolean): void {
        // If a BOM is required, emit one
        if (writeByteOrderMark) {
            data = byteOrderMarkIndicator + data;
        }

        vfs.writeFileSync(Uri.file(fileName, caseDetector), data, 'utf8');
    }

    return {
        useCaseSensitiveFileNames: () => useCaseSensitiveFileNames,
        getFileSize: (path: string) => getFileSize(vfs, Uri.file(path, caseDetector)),
        readFile: (path) => readFile(path),
        writeFile: (path, content) => {
            writeFile(path, content);
        },
        fileExists: (path) => fileExists(vfs, Uri.file(path, caseDetector)),
        directoryExists: (path) => directoryExists(vfs, Uri.file(path, caseDetector)),
        listFiles,
        log: (s) => {
            console.log(s);
        },
        getWorkspaceRoot: () => resolvePaths(__dirname, '../../..'),
        getAccessibleFileSystemEntries,
    };
}
