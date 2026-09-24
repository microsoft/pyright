/*
 * sourceEnumeratorSymlink.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Regression tests for SourceEnumerator symlink handling.
 *
 * A symlink that resolves outside every include root (e.g. a link to filesystem
 * root "/" or "C:\") is not a recursive cycle, so the `_seenDirs` guard does not
 * catch it. Before the fix, following such a link would enumerate directories
 * that don't belong to the workspace -- in the worst case the entire disk --
 * which made Pylance hang.
 *
 * Issue: https://github.com/microsoft/pylance-release/issues/6006
 *
 * Note: source enumeration is a sync-only code path, so there is no async
 * counterpart to mirror here.
 */

import type { Dirent } from 'fs';

import { SourceEnumerator } from '../analyzer/sourceEnumerator';
import { NullConsole } from '../common/console';
import { FileSystem, Stats } from '../common/fileSystem';
import { Uri } from '../common/uri/uri';
import { FileSpec, getFileSpec } from '../common/uri/uriUtils';
import { TestCaseSensitivityDetector } from './harness/testHost';

const caseSensitivityDetector = new TestCaseSensitivityDetector();

function makeUri(path: string): Uri {
    return Uri.file(path, caseSensitivityDetector);
}

type FsNode = { type: 'dir'; children: string[] } | { type: 'file' };

// Minimal in-memory filesystem that models directories, files, and symlinks
// well enough to drive SourceEnumerator. Paths use POSIX-style separators; all
// comparisons go through Uri so the model works on both Windows and POSIX hosts.
class MockFs {
    // Real (symlink-resolved) nodes keyed by uri.key.
    private readonly _nodes = new Map<string, FsNode>();
    // Symlink source uri.key -> target uri.
    private readonly _symlinks = new Map<string, Uri>();
    // Guards against runaway enumeration so a regression can't hang the suite.
    private _readCount = 0;

    addDir(path: string, children: string[]): void {
        this._nodes.set(makeUri(path).key, { type: 'dir', children });
    }

    addFile(path: string): void {
        this._nodes.set(makeUri(path).key, { type: 'file' });
    }

    addSymlink(path: string, target: string): void {
        this._symlinks.set(makeUri(path).key, makeUri(target));
    }

    realpath(uri: Uri): Uri {
        const target = this._symlinks.get(uri.key);
        if (target) {
            return this.realpath(target);
        }

        const parent = uri.getDirectory();
        if (parent.key === uri.key) {
            return uri;
        }

        const realParent = this.realpath(parent);
        if (realParent.key === parent.key) {
            return uri;
        }
        return this.realpath(realParent.combinePaths(uri.fileName));
    }

    asFileSystem(): FileSystem {
        const self = this;
        const fs: Partial<FileSystem> = {
            realpathSync(uri: Uri): Uri {
                const real = self.realpath(uri);
                if (!self._nodes.has(real.key)) {
                    throw new Error(`ENOENT: ${uri.toString()}`);
                }
                return real;
            },
            existsSync(uri: Uri): boolean {
                return self._nodes.has(self.realpath(uri).key);
            },
            statSync(uri: Uri): Stats {
                const node = self._nodes.get(self.realpath(uri).key);
                if (!node) {
                    throw new Error(`ENOENT: ${uri.toString()}`);
                }
                return self._makeStats(node.type);
            },
            readdirEntriesSync(uri: Uri): Dirent[] {
                if (++self._readCount > 10000) {
                    throw new Error('Runaway enumeration: too many readdir calls');
                }
                const node = self._nodes.get(self.realpath(uri).key);
                if (!node || node.type !== 'dir') {
                    throw new Error(`ENOTDIR: ${uri.toString()}`);
                }
                return node.children.map((name) => self._makeDirent(uri, name));
            },
        };
        return fs as FileSystem;
    }

    private _makeDirent(dirUri: Uri, name: string): Dirent {
        const requestedChild = dirUri.combinePaths(name);
        const isLink = this._symlinks.has(requestedChild.key);
        const realNode = this._nodes.get(this.realpath(requestedChild).key);
        const isDir = !isLink && realNode?.type === 'dir';
        const isFile = !isLink && realNode?.type === 'file';
        return {
            name,
            isFile: () => isFile,
            isDirectory: () => isDir,
            isSymbolicLink: () => isLink,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isFIFO: () => false,
            isSocket: () => false,
        } as unknown as Dirent;
    }

    private _makeStats(type: 'dir' | 'file'): Stats {
        return {
            size: 0,
            mtimeMs: 0,
            ctimeMs: 0,
            isFile: () => type === 'file',
            isDirectory: () => type === 'dir',
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false,
        };
    }
}

function enumerate(includeRoots: string[], mock: MockFs): Set<string> {
    const includes: FileSpec[] = includeRoots.map((root) => getFileSpec(makeUri(root), '**'));
    const enumerator = new SourceEnumerator(
        includes,
        /* excludes */ [],
        /* autoExcludeVenv */ false,
        mock.asFileSystem(),
        new NullConsole()
    );
    const result = enumerator.enumerate(/* timeLimitInMs */ 0);
    expect(result.isComplete).toBe(true);
    return new Set(Array.from(result.matches.values()).map((u) => u.key));
}

test('symlink to filesystem root is not followed', () => {
    const mock = new MockFs();
    mock.addDir('/workspace', ['app.py', 'link']);
    mock.addFile('/workspace/app.py');
    mock.addSymlink('/workspace/link', '/');

    // The filesystem root contains python files that must NOT be enumerated.
    mock.addDir('/', ['secret.py', 'etc']);
    mock.addFile('/secret.py');
    mock.addDir('/etc', ['deep.py']);
    mock.addFile('/etc/deep.py');

    const matches = enumerate(['/workspace'], mock);

    expect(matches.has(makeUri('/workspace/app.py').key)).toBe(true);
    // Files under the symlink are recorded with the symlink path prefix. Without
    // the containment guard the whole filesystem-root subtree would be pulled in.
    expect(matches.has(makeUri('/workspace/link/secret.py').key)).toBe(false);
    expect(matches.has(makeUri('/workspace/link/etc/deep.py').key)).toBe(false);
});

test('symlink to a sibling directory outside the workspace is skipped', () => {
    const mock = new MockFs();
    mock.addDir('/workspace', ['app.py', 'esc']);
    mock.addFile('/workspace/app.py');
    mock.addSymlink('/workspace/esc', '/other');

    mock.addDir('/other', ['x.py']);
    mock.addFile('/other/x.py');

    const matches = enumerate(['/workspace'], mock);

    expect(matches.has(makeUri('/workspace/app.py').key)).toBe(true);
    // Recorded under the symlink path prefix; must not be pulled in.
    expect(matches.has(makeUri('/workspace/esc/x.py').key)).toBe(false);
});

test('symlink within the workspace is followed', () => {
    const mock = new MockFs();
    mock.addDir('/workspace', ['sub', 'real']);
    mock.addSymlink('/workspace/sub', '/workspace/real');
    mock.addDir('/workspace/real', ['real.py']);
    mock.addFile('/workspace/real/real.py');

    const matches = enumerate(['/workspace'], mock);

    // The real file must be discovered (via the real dir and/or the symlink; the
    // recursive-cycle guard means only one of the two paths is recorded).
    const viaReal = matches.has(makeUri('/workspace/real/real.py').key);
    const viaLink = matches.has(makeUri('/workspace/sub/real.py').key);
    expect(viaReal || viaLink).toBe(true);
});

test('symlink to a sibling include root is followed (multi-root)', () => {
    const mock = new MockFs();
    mock.addDir('/root1', ['link']);
    mock.addSymlink('/root1/link', '/root2/pkg');
    mock.addDir('/root2', ['pkg']);
    mock.addDir('/root2/pkg', ['c.py']);
    mock.addFile('/root2/pkg/c.py');

    const matches = enumerate(['/root1', '/root2'], mock);

    // The symlink resolves under the second include root, so it must be followed
    // (recorded under the /root1/link symlink prefix).
    expect(matches.has(makeUri('/root1/link/c.py').key)).toBe(true);
});

test('symlink back to the include root itself does not crash and stays bounded', () => {
    const mock = new MockFs();
    mock.addDir('/workspace', ['app.py', 'self']);
    mock.addFile('/workspace/app.py');
    // A link to the include root resolves to the root (startsWith equality) and is
    // then caught by the recursive-cycle guard rather than the containment guard.
    mock.addSymlink('/workspace/self', '/workspace');

    const matches = enumerate(['/workspace'], mock);

    expect(matches.has(makeUri('/workspace/app.py').key)).toBe(true);
});
