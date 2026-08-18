/*
 * extraPathGlob.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Expands glob patterns in `extraPaths` entries into concrete directory URIs.
 *
 * The behavior is specified in `docs/import-resolution.md` (see "Extra Path Glob
 * Expansion"). In short:
 *   - Each raw entry may contain the wildcards `*`, `**`, or `?`, using the same
 *     syntax as `include`/`exclude`/`ignore`. Only directories are matched.
 *   - A glob entry is expanded, in place, to the directories it matches, sorted
 *     in ascending order using a case-sensitive, platform-independent comparison.
 *   - De-duplication precedence is: an explicit (non-wildcard) entry always wins
 *     and keeps its own position, even relative to an earlier glob; among globs,
 *     the earlier glob wins. Two literal entries that resolve to the same path
 *     keep the first occurrence.
 *   - Symbolic links are not resolved (the matched path is used as-is so it maps
 *     to the intended module name), but symbolic-link cycles are guarded against.
 *   - A glob that matches no directory contributes nothing; this is not an error.
 */

import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface } from './console';
import { FileSystem } from './fileSystem';
import { normalizeSlashes } from './pathUtils';
import { Uri } from './uri/uri';
import {
    containsWildcardCharacter,
    getFileSpec,
    getFileSystemEntriesWithSymlinkedDirectories,
    getWildcardRoot,
    getWildcardSegmentRegexFragment,
    isDirectory,
    tryRealpath,
} from './uri/uriUtils';

// Returns true if the entry contains a glob wildcard character.
export function containsWildcard(entry: string): boolean {
    return containsWildcardCharacter(entry);
}

// A file-watch target derived from a wildcard `extraPaths` entry: the non-wildcard
// root directory to watch, plus the directory glob relative to that root. This lets
// a file watcher register the original glob (e.g. root `libs`, pattern `*/src`)
// instead of the already-expanded leaf directories, so directories that appear or
// disappear at runtime are still observed. `root` is kept as a `Uri` so callers can
// reuse `getFileSpec` for coverage checks and convert to an LSP relative pattern at
// registration time.
export interface ExtraPathWatchTarget {
    root: Uri;
    dirPattern: string;
}

// Reconstructs a `Uri` from an `extraPaths` file-spec string. Settings-origin entries
// are kept as plain strings so wildcard characters (`*`, `**`, `?`) survive verbatim; a
// `Uri` built from such a string keeps the wildcards as literal path components (parsing
// a full URI string, or treating a path string as a file path, as appropriate).
function fileSpecToUri(fileSpec: string, caseDetector: CaseSensitivityDetector): Uri {
    return Uri.maybeUri(fileSpec) ? Uri.parse(fileSpec, caseDetector) : Uri.file(fileSpec, caseDetector);
}

// Derives file-watch targets from `extraPaths` file specs whose paths may still contain
// wildcard characters. Entries are kept as strings so `*`, `**`, and `?` survive; a spec
// with no wildcard produces no target (its fixed directory is already covered by the
// expanded search paths).
export function getExtraPathWatchTargets(
    fileSpecs: readonly string[],
    caseDetector: CaseSensitivityDetector
): ExtraPathWatchTarget[] {
    const targets: ExtraPathWatchTarget[] = [];

    for (const fileSpec of fileSpecs) {
        const uri = fileSpecToUri(fileSpec, caseDetector);

        // Derive the non-wildcard root with the exact same `getWildcardRoot` helper that
        // `_expandGlobEntry` uses to expand the glob. The watch root and the expansion root
        // MUST stay byte-identical or the watcher would be rooted differently than the
        // directories the glob actually covers; sharing one implementation prevents that drift.
        const root = getWildcardRoot(uri, '');
        const components = Array.from(uri.getPathComponents());
        const rootLength = Array.from(root.getPathComponents()).length;

        // No wildcard component: the spec's fixed directory is already covered by the
        // expanded search paths, so it contributes no glob watch target.
        if (rootLength >= components.length) {
            continue;
        }

        targets.push({ root, dirPattern: components.slice(rootLength).join('/') });
    }

    return targets;
}

// Returns true when `folder` is one of the directories the watch target's glob
// matches (or a directory beneath one), i.e. the folder is already covered by the
// glob watcher and does not need its own folder watcher.
export function extraPathWatchTargetCovers(target: ExtraPathWatchTarget, folder: Uri): boolean {
    return folder.matchesRegex(getFileSpec(target.root, target.dirPattern).regExp);
}

// Expands an ordered list of raw `extraPaths` entries into resolved directory
// URIs, applying glob expansion and the de-duplication precedence described at
// the top of this file. `baseUri` is the directory that relative entries resolve
// against (the config file's directory for config entries, or the project root
// for the setting).
export function expandExtraPaths(
    fs: FileSystem,
    baseUri: Uri,
    entries: readonly string[],
    console?: ConsoleInterface
): Uri[] {
    // Ignore empty or whitespace-only entries. Such entries would otherwise
    // resolve to the base directory (for '') or a nonexistent path, silently
    // polluting the search-path list; they are always user mistakes.
    const cleaned = entries.filter((entry) => entry.trim().length > 0);

    // Extra-path URIs share the workspace's case sensitivity (consistent with the glob matcher
    // below, which also derives case sensitivity from `baseUri`).
    const caseDetector: CaseSensitivityDetector = { isCaseSensitive: () => baseUri.isCaseSensitive };

    // Phase 1: resolve every literal entry and claim its normalized key so that an
    // explicit entry always wins over any glob-produced duplicate, regardless of
    // where the literal appears in the list.
    const claimedByExplicit = new Set<string>();
    const literalByIndex: (Uri | undefined)[] = cleaned.map((entry) => {
        if (containsWildcard(entry)) {
            return undefined;
        }
        // A URI-form entry is an absolute location; parse it directly. Resolving it against the
        // base directory would corrupt the scheme (`resolvePaths` would treat it as a path).
        const uri = Uri.maybeUri(entry) ? Uri.parse(entry, caseDetector) : baseUri.resolvePaths(entry);
        claimedByExplicit.add(_normalizedKey(uri));
        return uri;
    });

    // Phase 2: emit entries in order. Literals keep their position; globs expand
    // in place, dropping any directory already owned by an explicit entry or
    // already emitted by an earlier entry (an earlier glob or a literal).
    const result: Uri[] = [];
    const emitted = new Set<string>();

    cleaned.forEach((entry, index) => {
        const literal = literalByIndex[index];
        if (literal) {
            const key = _normalizedKey(literal);
            if (!emitted.has(key)) {
                emitted.add(key);
                result.push(literal);
            }
            return;
        }

        // Globs are only supported for plain paths. A wildcard inside a URI-form entry can't be
        // filesystem-walked, so skip it (only pure paths reach the glob matcher).
        if (Uri.maybeUri(entry)) {
            console?.info(`Skipping glob expansion for non-path extra path "${entry}".`);
            return;
        }

        for (const match of _expandGlobEntry(fs, baseUri, entry, console)) {
            const key = _normalizedKey(match);
            if (claimedByExplicit.has(key) || emitted.has(key)) {
                continue;
            }
            emitted.add(key);
            result.push(match);
        }
    });

    return result;
}

// Threshold above which a `**` extra-path glob is treated as pathologically broad. Crossing it
// emits a one-time warning to the output window; expansion still proceeds.
const _largeGlobScanThreshold = 10000;

// Hard ceiling on the number of directories a single glob entry may scan. Unlike
// `_largeGlobScanThreshold` (which only warns), crossing this aborts further traversal of the
// entry so a pathological layout (e.g. a deep symlink DAG whose aliases each re-expand a shared
// subtree) cannot turn config load into an unbounded synchronous walk. Whatever matched before the
// ceiling is still returned.
const _largeGlobScanHardLimit = 100000;

// Expands a single glob entry into the directories it matches, sorted ascending.
function _expandGlobEntry(fs: FileSystem, baseUri: Uri, entry: string, console?: ConsoleInterface): Uri[] {
    const absolute = baseUri.resolvePaths(entry);

    // Enumeration requires synchronous file-system access, which is only available
    // for file URIs. Non-file schemes contribute nothing.
    if (absolute.scheme !== '' && absolute.scheme !== 'file') {
        console?.info(`Skipping glob expansion for non-file extra path "${entry}".`);
        return [];
    }

    const wildcardRoot = getWildcardRoot(baseUri, entry);
    const absoluteComponents = Array.from(absolute.getPathComponents());
    const rootComponents = Array.from(wildcardRoot.getPathComponents());
    const rawTail = absoluteComponents.slice(rootComponents.length);
    if (rawTail.length === 0) {
        return [];
    }

    // Collapse runs of consecutive `**` into a single `**`. Multiple adjacent
    // `**` segments (e.g. `packages/**/**/src`) are semantically identical to a
    // single `**` but would otherwise multiply the traversal fan-out.
    const tail: string[] = [];
    for (const component of rawTail) {
        if (component === '**' && tail[tail.length - 1] === '**') {
            continue;
        }
        tail.push(component);
    }

    const caseSensitive = baseUri.isCaseSensitive;
    const matches = new Map<string, Uri>();
    // Guards against symbolic-link cycles: tracks the real path of each directory
    // on the current traversal path so we never descend into a directory that is
    // already an ancestor of itself.
    const activePath = new Set<string>();
    // Memoizes (logical directory, tailIndex) pairs already processed so a diamond
    // directory layout or broad `**` glob over a large tree cannot trigger
    // combinatorial re-traversal of the same subtree. The key is the *logical*
    // path (not the real path) so distinct symlink aliases pointing at the same
    // target are each still emitted; cycle-breaking uses the real path via
    // `activePath` below.
    const visited = new Set<string>();

    // Emit a one-time warning when a `**` glob traverses a pathologically large tree; expansion
    // still proceeds (mirrors how the include/exclude source scan reports issues). A separate hard
    // limit (`_largeGlobScanHardLimit`) actually bounds the walk by aborting past a ceiling.
    let directoriesScanned = 0;
    let warnedLargeScan = false;
    let abortedLargeScan = false;

    // Processes the remaining tail at `dirUri` without moving to a new directory.
    const visit = (dirUri: Uri, tailIndex: number) => {
        if (abortedLargeScan) {
            return;
        }
        if (tailIndex === tail.length) {
            matches.set(_normalizedKey(dirUri), dirUri);
            return;
        }

        const component = tail[tailIndex];
        if (component === '**') {
            // `**` matches zero or more path segments: try the rest of the tail at
            // the current directory (consuming zero segments), and also descend into
            // each subdirectory while keeping `**` at the same position.
            visit(dirUri, tailIndex + 1);
            for (const subDir of getFileSystemEntriesWithSymlinkedDirectories(fs, dirUri).directories) {
                descend(subDir, tailIndex);
            }
        } else if (containsWildcard(component)) {
            const segmentRegex = _segmentToRegex(component, caseSensitive);
            for (const subDir of getFileSystemEntriesWithSymlinkedDirectories(fs, dirUri).directories) {
                if (segmentRegex.test(subDir.fileName)) {
                    descend(subDir, tailIndex + 1);
                }
            }
        } else {
            const next = dirUri.combinePaths(component);
            if (isDirectory(fs, next)) {
                descend(next, tailIndex + 1);
            }
        }
    };

    // Enters a (potentially new) directory, guarding against symbolic-link cycles,
    // then processes the tail at that directory.
    const descend = (dirUri: Uri, tailIndex: number) => {
        if (abortedLargeScan) {
            return;
        }
        const realPath = tryRealpath(fs, dirUri);
        if (!realPath) {
            return;
        }
        if (activePath.has(realPath.key)) {
            console?.info(`Skipping recursive symlink "${dirUri.toUserVisibleString()}".`);
            return;
        }
        const memoKey = `${_normalizedKey(dirUri)}:${tailIndex}`;
        if (visited.has(memoKey)) {
            return;
        }
        visited.add(memoKey);
        directoriesScanned++;
        if (!warnedLargeScan && directoriesScanned > _largeGlobScanThreshold) {
            warnedLargeScan = true;
            console?.warn(
                `Expanding the "extraPaths" glob "${entry}" has scanned more than ${_largeGlobScanThreshold} ` +
                    `directories, which can slow analysis. Consider narrowing the pattern (for example, avoid a bare "**").`
            );
        }
        if (directoriesScanned > _largeGlobScanHardLimit) {
            abortedLargeScan = true;
            console?.warn(
                `Expanding the "extraPaths" glob "${entry}" exceeded the hard limit of ${_largeGlobScanHardLimit} ` +
                    `directories and was aborted to protect analysis performance. Narrow the pattern (for example, ` +
                    `avoid a bare "**" over a large or symlinked tree).`
            );
            return;
        }
        activePath.add(realPath.key);
        try {
            visit(dirUri, tailIndex);
        } finally {
            activePath.delete(realPath.key);
        }
    };

    descend(wildcardRoot, 0);

    // Sort using an ordinal comparison (code-unit order via the `<`/`>` operators,
    // not `localeCompare`) of a stable path key so the expanded directory order is
    // deterministic and identical across locales, encodings, and operating systems.
    // Locale-aware collation would reorder these entries by the user's culture
    // (e.g. case-insensitively), which must not influence import resolution.
    return Array.from(matches.values()).sort((a, b) => {
        const keyA = _sortKey(a);
        const keyB = _sortKey(b);
        if (keyA < keyB) {
            return -1;
        }
        if (keyA > keyB) {
            return 1;
        }
        // The NFC-normalized keys tie. This happens only for byte-distinct sibling
        // directories whose names are NFC-equal (e.g. an NFD and an NFC spelling of
        // the same name that both exist on disk). Break the tie by the raw decoded
        // path so the result is a deterministic total order rather than falling back
        // to (OS-dependent) directory-enumeration order.
        const rawA = normalizeSlashes(a.getFilePath(), '/');
        const rawB = normalizeSlashes(b.getFilePath(), '/');
        return rawA < rawB ? -1 : rawA > rawB ? 1 : 0;
    });
}

// Converts a single glob path segment (which may contain `*` or `?`, but not
// `**`) into an anchored regular expression that matches a directory name. The
// per-segment translation is shared with `include`/`exclude` matching (see
// `getWildcardSegmentRegexFragment`) so the two glob engines stay consistent.
function _segmentToRegex(segment: string, caseSensitive: boolean): RegExp {
    const pattern = getWildcardSegmentRegexFragment(segment);
    return new RegExp(`^${pattern}$`, caseSensitive ? undefined : 'i');
}

// Produces a case-sensitive key for a URI used for de-duplication. It is
// intentionally case-sensitive (even on case-insensitive file systems) because
// directory case affects the resolved module name. (Ordering uses `_sortKey`.)
function _normalizedKey(uri: Uri): string {
    const text = uri.toString();
    if (text.length > 1 && text.endsWith('/')) {
        return text.slice(0, -1);
    }
    return text;
}

// Produces the ordinal sort key for an expanded glob match. Uses the *decoded*
// file path (not the percent-encoded `uri.toString()`) so the order reflects the
// actual path characters and matches the spec's "sort by normalized path"
// contract: e.g. `Z` (U+005A) sorts before `é` (U+00E9), whereas the encoded form
// `%C3%A9` (leading `%`, U+0025) would sort ahead of every ASCII letter. Slashes
// are normalized to `/` and the string is Unicode-normalized to NFC so that a
// name stored as NFD (e.g. on macOS) and the same name as NFC (e.g. on Linux)
// yield an identical key, keeping the order stable across operating systems and
// normalization forms. Case is preserved (the sort, like de-duplication, is
// case-sensitive). Only file-scheme directories reach this function.
function _sortKey(uri: Uri): string {
    return normalizeSlashes(uri.getFilePath(), '/').normalize('NFC');
}
