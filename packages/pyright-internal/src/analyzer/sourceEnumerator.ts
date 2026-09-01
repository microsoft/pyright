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
import { FileSpec, getFileSystemEntriesWithSymlinkedDirectories, tryRealpath, tryStat } from '../common/uri/uriUtils';

export interface SourceEnumerateResult {
    matches: Map<string, Uri>;
    autoExcludedDirs: Uri[];
    isComplete: boolean;
}

const envMarkers = [['bin', 'activate'], ['Scripts', 'activate'], ['pyvenv.cfg'], ['conda-meta']];

// Thresholds that define a "slow" enumeration. Kept at module scope so both the
// long-operation console warning and the `wasSlowEnumeration` getter derive
// "slow" from the same condition rather than from whether the warning was logged.
const longOperationLimitInMs = 10000;
const nFilesToSuggestSubfolder = 50;

// Configuration file names that mark a directory as a candidate "nearest
// configuration" root. These are collected during the normal source-file walk
// (see `getDiscoveredConfigFiles`) so Pylance can create virtual workspaces
// without performing a second traversal. Whether a `pyproject.toml` actually
// qualifies (i.e. has a `[tool.pyright]` section) is decided by the caller.
const pyrightConfigFileName = 'pyrightconfig.json';
const pyprojectTomlFileName = 'pyproject.toml';

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
    // Real (symlink-resolved) paths of the include roots. A symlink that resolves
    // outside every include root (e.g. a link to filesystem root "/" or "C:\") is
    // not a cycle, so `_seenDirs` won't catch it; without this bound the whole
    // filesystem would be enumerated and Pylance would hang. See issue #6006.
    private readonly _includeRoots: Uri[];
    // This tracks symlinked directory roots across the entire enumeration cycle,
    // potentially spanning multiple include roots, so Pylance can later filter
    // workspace indexing against the full discovered set.
    private readonly _symlinkedDirectoryRoots = new Map<string, Uri>();
    // Candidate "nearest configuration" files (pyrightconfig.json / pyproject.toml)
    // encountered during the walk, keyed by file uri. Surfaced to Pylance so it can
    // create virtual workspaces without re-walking the tree. Directories that are
    // auto-excluded (venvs) or excluded by config are never read, so configs under
    // them are naturally skipped.
    private readonly _discoveredConfigFiles = new Map<string, Uri>();

    constructor(
        include: FileSpec[],
        private _excludes: FileSpec[],
        private _autoExcludeVenv: boolean,
        private _fs: FileSystem,
        private _console: ConsoleInterface
    ) {
        this._includesToExplore = include.slice(0).reverse();

        // Resolve include roots to their real paths up front (an include root may
        // itself be a symlink) so we can bound enumeration to directories that
        // physically live under one of the workspace's include roots.
        this._includeRoots = include.map((spec) => tryRealpath(_fs, spec.wildcardRoot) ?? spec.wildcardRoot);

        this._console.log(`Searching for source files`);
    }

    get wasSlowEnumeration(): boolean {
        // Derived from the elapsed-time / file-count threshold rather than from
        // `_loggedLongOperationError` so "slow" stays independent of whether the
        // console warning was logged. Sibling changes that alter the logging
        // behavior (e.g. suppressing repeats) then can't silently disable this.
        return this._isSlowEnumeration();
    }

    getSymlinkedDirectoryRoots(): Uri[] {
        return Array.from(this._symlinkedDirectoryRoots.values());
    }

    // Returns the configuration files (pyrightconfig.json / pyproject.toml)
    // discovered during enumeration. The caller decides which ones actually
    // qualify as a configuration root (e.g. a pyproject.toml must contain a
    // [tool.pyright] section).
    getDiscoveredConfigFiles(): Uri[] {
        return Array.from(this._discoveredConfigFiles.values());
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
            // If this is taking a long time, log an error to help the user
            // diagnose and mitigate the problem.
            if (this._isSlowEnumeration()) {
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

    private _isSlowEnumeration(): boolean {
        return this._elapsedTimeInMs >= longOperationLimitInMs && this._numFilesVisited >= nFilesToSuggestSubfolder;
    }

    private _recordSymlinkedDirectoryRoot(root: Uri): void {
        for (const existingRoot of this._symlinkedDirectoryRoots.values()) {
            if (root.isChild(existingRoot)) {
                return;
            }
        }

        for (const [key, existingRoot] of this._symlinkedDirectoryRoots.entries()) {
            if (existingRoot.isChild(root)) {
                this._symlinkedDirectoryRoots.delete(key);
            }
        }

        this._symlinkedDirectoryRoots.set(root.key, root);
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

        if (realDirPath.key !== dir.uri.key) {
            this._recordSymlinkedDirectoryRoot(dir.uri);
        }

        if (this._seenDirs.has(realDirPath.key)) {
            this._console.info(`Skipping recursive symlink "${dir.uri}" -> "${realDirPath}"`);
            return;
        }
        this._seenDirs.add(realDirPath.key);

        // A symlink that resolves outside every include root is not a recursive
        // cycle (so `_seenDirs` won't catch it), but following it would pull in
        // directories that don't belong to the workspace -- in the worst case a
        // link to filesystem root "/" would enumerate the entire disk (issue #6006).
        // Skip silently: external symlinks are legitimate and shouldn't be noisy.
        if (this._includeRoots.length > 0 && !this._includeRoots.some((root) => realDirPath.startsWith(root))) {
            return;
        }

        if (this._autoExcludeVenv) {
            if (envMarkers.some((f) => this._fs.existsSync(dir.uri.resolvePaths(...f)))) {
                this._autoExcludeDirs.push(dir.uri);
                this._console.info(`Auto-excluding ${dir.uri.toUserVisibleString()}`);
                return;
            }
        }

        const { files, directories, symlinkedDirectories } = getFileSystemEntriesWithSymlinkedDirectories(
            this._fs,
            dir.uri
        );

        for (const symlinkedDir of symlinkedDirectories) {
            this._recordSymlinkedDirectoryRoot(symlinkedDir);
        }

        for (const file of files) {
            if (FileSpec.matchIncludeFileSpec(dir.includeRegExp, this._excludes, file)) {
                this._numFilesVisited++;
                this._matches.set(file.key, file);
            }

            // Collect candidate configuration files. They are not `.py`/`.pyi`, so they
            // never match include specs, but we still honor `exclude` specs: skip any
            // config file explicitly excluded by the user (directory-level excludes and
            // venv auto-exclusion already prevent us from reading excluded directories).
            const fileName = file.fileName;
            if (
                (fileName === pyrightConfigFileName || fileName === pyprojectTomlFileName) &&
                !FileSpec.isInPath(file, this._excludes)
            ) {
                this._discoveredConfigFiles.set(file.key, file);
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

        // Skip enumeration for non-file URI schemes (e.g., memfs:, zowe-uss:).
        // These require async file system access that isn't available here.
        if (includeSpec.wildcardRoot.scheme !== 'file' && includeSpec.wildcardRoot.scheme !== '') {
            this._console.info(
                `Skipping file enumeration for non-file URI scheme "${includeSpec.wildcardRoot.scheme}".`
            );
            return;
        }

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
