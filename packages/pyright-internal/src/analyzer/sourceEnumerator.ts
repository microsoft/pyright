/*
 * sourceEnumerator.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic for enumerating all of the Python source files in
 * a project.
 */

import { ConsoleInterface } from '../common/console';
import { FileSystem } from '../common/fileSystem';
import { Uri } from '../common/uri/uri';
import { FileSpec, getFileSystemEntries, tryRealpath, tryStat } from '../common/uri/uriUtils';

export interface SourceEnumerateResult {
    matches: Map<string, Uri>;
    autoExcludedDirs: Uri[];
    isComplete: boolean;
}

const envMarkers = [['bin', 'activate'], ['Scripts', 'activate'], ['pyvenv.cfg'], ['conda-meta']];

interface DirToExplore {
    uri: Uri;
    includeRegExp: RegExp;
    hasDirectoryWildcard: boolean;
}

export class SourceEnumerator {
    private _elapsedTimeInMs = 0;
    private _includesToExplore: FileSpec[];
    private _dirsToExplore: DirToExplore[] = [];
    private _matches = new Map<string, Uri>();
    private _autoExcludeDirs: Uri[] = [];
    private _isComplete = false;
    private _numFilesVisited = 0;
    private _loggedLongOperationError = false;
    private _seenDirs = new Set<string>();

    constructor(
        include: FileSpec[],
        private _excludes: FileSpec[],
        private _autoExcludeVenv: boolean,
        private _fs: FileSystem,
        private _console: ConsoleInterface
    ) {
        this._includesToExplore = include.slice(0).reverse();

        this._console.log(`Searching for source files`);
    }

    // Enumerates as many files as possible within the specified
    // time limit and returns all matching files.
    enumerate(timeLimitInMs: number): SourceEnumerateResult {
        const startTime = Date.now();

        while (!this._isComplete) {
            if (this._doNext()) {
                if (!this._isComplete) {
                    this._finish();
                }
            }

            const elapsedTime = Date.now() - startTime;
            if (timeLimitInMs > 0 && elapsedTime > timeLimitInMs) {
                break;
            }
        }

        this._elapsedTimeInMs += Date.now() - startTime;

        if (!this._loggedLongOperationError) {
            const longOperationLimitInMs = 10000;
            const nFilesToSuggestSubfolder = 50;

            // If this is taking a long time, log an error to help the user
            // diagnose and mitigate the problem.
            if (this._elapsedTimeInMs >= longOperationLimitInMs && this._numFilesVisited >= nFilesToSuggestSubfolder) {
                this._console.error(
                    `Enumeration of workspace source files is taking longer than ${
                        longOperationLimitInMs * 0.001
                    } seconds.\n` +
                        'This may be because:\n' +
                        '* You have opened your home directory or entire hard drive as a workspace\n' +
                        '* Your workspace contains a very large number of directories and files\n' +
                        '* Your workspace contains a symlink to a directory with many files\n' +
                        '* Your workspace is remote, and file enumeration is slow\n' +
                        'To reduce this time, open a workspace directory with fewer files ' +
                        'or add a pyrightconfig.json configuration file with an "exclude" section to exclude ' +
                        'subdirectories from your workspace. For more details, refer to ' +
                        'https://github.com/microsoft/pyright/blob/main/docs/configuration.md.'
                );

                this._loggedLongOperationError = true;
            }
        }

        return {
            matches: this._matches,
            autoExcludedDirs: this._autoExcludeDirs,
            isComplete: this._isComplete,
        };
    }

    // Performs the next enumeration action. Returns true if complete.
    private _doNext(): boolean {
        const dirToExplore = this._dirsToExplore.pop();
        if (dirToExplore) {
            this._exploreDir(dirToExplore);
            return false;
        }

        const includeToExplore = this._includesToExplore.pop();
        if (includeToExplore) {
            this._exploreInclude(includeToExplore);
            return false;
        }

        return true;
    }

    private _exploreDir(dir: DirToExplore) {
        const realDirPath = tryRealpath(this._fs, dir.uri);
        if (!realDirPath) {
            this._console.warn(`Skipping broken link "${dir.uri}"`);
            return;
        }

        if (this._seenDirs.has(realDirPath.key)) {
            this._console.info(`Skipping recursive symlink "${dir.uri}" -> "${realDirPath}"`);
            return;
        }
        this._seenDirs.add(realDirPath.key);

        if (this._autoExcludeVenv) {
            if (envMarkers.some((f) => this._fs.existsSync(dir.uri.resolvePaths(...f)))) {
                this._autoExcludeDirs.push(dir.uri);
                this._console.info(`Auto-excluding ${dir.uri.toUserVisibleString()}`);
                return;
            }
        }

        const { files, directories } = getFileSystemEntries(this._fs, dir.uri);

        for (const file of files) {
            if (FileSpec.matchIncludeFileSpec(dir.includeRegExp, this._excludes, file)) {
                this._numFilesVisited++;
                this._matches.set(file.key, file);
            }
        }

        for (const subDir of directories.slice().reverse()) {
            if (subDir.matchesRegex(dir.includeRegExp) || dir.hasDirectoryWildcard) {
                if (!FileSpec.isInPath(subDir, this._excludes)) {
                    this._dirsToExplore.push({
                        uri: subDir,
                        includeRegExp: dir.includeRegExp,
                        hasDirectoryWildcard: dir.hasDirectoryWildcard,
                    });
                }
            }
        }
    }

    private _exploreInclude(includeSpec: FileSpec) {
        if (FileSpec.isInPath(includeSpec.wildcardRoot, this._excludes)) {
            return;
        }

        this._seenDirs.clear();

        const stat = tryStat(this._fs, includeSpec.wildcardRoot);
        if (stat?.isFile()) {
            this._matches.set(includeSpec.wildcardRoot.key, includeSpec.wildcardRoot);
        } else if (stat?.isDirectory()) {
            this._dirsToExplore.push({
                uri: includeSpec.wildcardRoot,
                includeRegExp: includeSpec.regExp,
                hasDirectoryWildcard: includeSpec.hasDirectoryWildcard,
            });
        } else {
            this._console.error(
                `File or directory "${includeSpec.wildcardRoot.toUserVisibleString()}" does not exist.`
            );
        }
    }

    private _finish() {
        this._isComplete = true;

        const fileCount = this._matches.size;
        if (fileCount === 0) {
            this._console.info(`No source files found.`);
        } else {
            this._console.info(`Found ${fileCount} ` + `source ${fileCount === 1 ? 'file' : 'files'}`);
        }
    }
}
