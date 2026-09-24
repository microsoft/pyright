/*
 * extraPathGlob.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for glob expansion of `extraPaths` entries.
 */

import assert from 'assert';

import { ConfigOptions } from '../common/configOptions';
import { NullConsole } from '../common/console';
import {
    containsWildcard,
    expandExtraPaths,
    extraPathWatchTargetCovers,
    getExtraPathWatchTargets,
} from '../common/extraPathGlob';
import { normalizeSlashes } from '../common/pathUtils';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';

describe('extraPath glob expansion', () => {
    test('containsWildcard detects glob characters', () => {
        assert.strictEqual(containsWildcard('libs/shared/src'), false);
        assert.strictEqual(containsWildcard('libs/*/src'), true);
        assert.strictEqual(containsWildcard('external/**/site-packages'), true);
        assert.strictEqual(containsWildcard('pkg?/x'), true);
    });

    test('single glob expands to matching directories, sorted ascending', () => {
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src', '/proj/libs/shared/src']);
        assert.deepStrictEqual(expand(fs, ['libs/*/src']), [
            '/proj/libs/auth/src',
            '/proj/libs/core/src',
            '/proj/libs/shared/src',
        ]);
    });

    test('glob results use a culture- and OS-invariant ordinal sort', () => {
        // These names sort differently under an ordinal comparison of the decoded
        // path than under (a) a locale-aware comparison or (b) an ordinal
        // comparison of the percent-encoded URI string:
        //   - Ordinal-by-path orders all uppercase ASCII before lowercase, places
        //     `_` (U+005F) between `Z` (U+005A) and `a` (U+0061), and places the
        //     non-ASCII `é` (U+00E9) after every ASCII character.
        //   - Locale-aware collation is roughly case-insensitive and reorders
        //     punctuation/accents.
        //   - Sorting the encoded URI string would place `é` FIRST, because it
        //     encodes to `%C3%A9` and `%` (U+0025) precedes every ASCII letter.
        // Expected ordinal-by-path order of the leaf names is B < Z < _ < a < é.
        // Pinning this guards against a switch to a culture-sensitive comparison
        // or back to the encoded-string key, either of which would make the
        // expanded extra-path list depend on the user's locale/OS.
        const fs = makeFs([
            '/proj/pkgs/Zebra/src',
            '/proj/pkgs/_internal/src',
            '/proj/pkgs/apple/src',
            '/proj/pkgs/Beta/src',
            '/proj/pkgs/\u00e9moji/src',
        ]);
        assert.deepStrictEqual(expand(fs, ['pkgs/*/src']), [
            '/proj/pkgs/Beta/src',
            '/proj/pkgs/Zebra/src',
            '/proj/pkgs/_internal/src',
            '/proj/pkgs/apple/src',
            '/proj/pkgs/\u00e9moji/src',
        ]);
    });

    test('sort is invariant to Unicode normalization form (NFD vs NFC)', () => {
        // macOS stores file names as NFD (decomposed) while Linux/Windows commonly
        // use NFC (composed). The same logical name `café` is `caf\u00e9` in NFC but
        // `cafe\u0301` (e + combining acute) in NFD. Without NFC normalization the
        // decomposed form would sort BEFORE `cafz` (its 4th code unit `e` U+0065 <
        // `z` U+007A); with NFC normalization it sorts AFTER `cafz` (composed `é`
        // U+00E9 > `z`). Pinning the composed ordering proves the sort key is
        // normalized so directory order does not depend on the on-disk form.
        const fs = makeFs(['/proj/pkgs/cafz/src', '/proj/pkgs/cafe\u0301/src']);
        assert.deepStrictEqual(expand(fs, ['pkgs/*/src']), ['/proj/pkgs/cafz/src', '/proj/pkgs/cafe\u0301/src']);
    });

    test('NFC-equal but byte-distinct sibling directories get a deterministic total order', () => {
        // Both an NFD (`cafe` + U+0301) and an NFC (`caf` + U+00E9) spelling of `café`
        // exist as separate directories. They are byte-distinct (so both are kept),
        // but their NFC-normalized sort keys are equal, so ordering falls back to the
        // raw decoded path (NFD `e` U+0065 < NFC `é` U+00E9). Pinning this proves the
        // order is a deterministic total order rather than dependent on directory
        // enumeration order.
        const fs = makeFs(['/proj/pkgs/caf\u00e9/src', '/proj/pkgs/cafe\u0301/src']);
        assert.deepStrictEqual(expand(fs, ['pkgs/*/src']), ['/proj/pkgs/cafe\u0301/src', '/proj/pkgs/caf\u00e9/src']);
    });

    test('literal entry wins over a glob that covers it and keeps its front position', () => {
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src', '/proj/libs/shared/src']);
        assert.deepStrictEqual(expand(fs, ['libs/shared/src', 'libs/*/src']), [
            '/proj/libs/shared/src',
            '/proj/libs/auth/src',
            '/proj/libs/core/src',
        ]);
    });

    test('literal after a glob keeps its own (later) slot', () => {
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src', '/proj/libs/shared/src']);
        assert.deepStrictEqual(expand(fs, ['libs/*/src', 'libs/shared/src']), [
            '/proj/libs/auth/src',
            '/proj/libs/core/src',
            '/proj/libs/shared/src',
        ]);
    });

    test('two overlapping globs: the earlier glob wins the overlap', () => {
        const fs = makeFs([
            '/proj/external/pip310_numpy/site-packages',
            '/proj/external/pip310_pandas/site-packages',
            '/proj/external/pip311_numpy/site-packages',
        ]);
        assert.deepStrictEqual(expand(fs, ['external/pip310_*/site-packages', 'external/pip3??_numpy/site-packages']), [
            '/proj/external/pip310_numpy/site-packages',
            '/proj/external/pip310_pandas/site-packages',
            '/proj/external/pip311_numpy/site-packages',
        ]);
    });

    test('multiple literals mixed with multiple globs (documented example)', () => {
        const fs = makeFs([
            '/proj/stubs',
            '/proj/packages/api/src',
            '/proj/packages/auth/src',
            '/proj/packages/core/src',
            '/proj/packages/shared/src',
            '/proj/vendor/grpc/python',
            '/proj/vendor/legacy/python',
            '/proj/vendor/proto/python',
        ]);
        assert.deepStrictEqual(
            expand(fs, ['stubs', 'packages/core/src', 'packages/*/src', 'vendor/proto/python', 'vendor/*/python']),
            [
                '/proj/stubs',
                '/proj/packages/core/src',
                '/proj/packages/api/src',
                '/proj/packages/auth/src',
                '/proj/packages/shared/src',
                '/proj/vendor/proto/python',
                '/proj/vendor/grpc/python',
                '/proj/vendor/legacy/python',
            ]
        );
    });

    test('** matches any number of segments', () => {
        const fs = makeFs(['/proj/external/a/site-packages', '/proj/external/b/c/site-packages']);
        assert.deepStrictEqual(expand(fs, ['external/**/site-packages']), [
            '/proj/external/a/site-packages',
            '/proj/external/b/c/site-packages',
        ]);
    });

    test('? matches exactly one character', () => {
        const fs = makeFs(['/proj/pkg1/x', '/proj/pkg2/x', '/proj/pkg10/x']);
        assert.deepStrictEqual(expand(fs, ['pkg?/x']), ['/proj/pkg1/x', '/proj/pkg2/x']);
    });

    test('a glob that matches nothing contributes nothing', () => {
        const fs = makeFs(['/proj/libs/auth/src']);
        assert.deepStrictEqual(expand(fs, ['nope/*/src']), []);
    });

    test('a literal entry is emitted even if it does not exist', () => {
        const fs = makeFs(['/proj/libs/auth/src']);
        assert.deepStrictEqual(expand(fs, ['does/not/exist']), ['/proj/does/not/exist']);
    });

    test('de-duplication is case-sensitive: case-variant paths both survive', () => {
        // Real directory uses a capital "S"; the literal entry uses lowercase.
        const fs = makeFs(['/proj/libs/Shared/src'], /* ignoreCase */ false);
        const result = expand(fs, ['libs/shared/src', 'libs/*/src']);
        assert.deepStrictEqual(result, ['/proj/libs/shared/src', '/proj/libs/Shared/src']);
    });

    test('identical literal entries keep the first occurrence only', () => {
        const fs = makeFs(['/proj/a/src']);
        assert.deepStrictEqual(expand(fs, ['a/src', 'a/src']), ['/proj/a/src']);
    });

    test('symbolic-link cycles are guarded and do not cause infinite recursion', () => {
        const fs = makeFs(['/proj/root/a']);
        // Create a cycle: /proj/root/a/loop -> /proj/root
        fs.symlinkSync('/proj/root', '/proj/root/a/loop');

        const result = expand(fs, ['root/**']);
        // The walk terminates and emits exactly the real directories: the cycle
        // guard drops the "loop" symlink before it re-enters /proj/root. Pinning
        // the full array catches a regression in the guard (extra entries or a
        // broken ordering) that a partial `includes` check would miss.
        assert.deepStrictEqual(result, ['/proj/root', '/proj/root/a']);
    });

    test('ensureDefaultExtraPaths expands globs for the settings origin', () => {
        const fs = makeFs(['/proj/pkgs/a/src', '/proj/pkgs/b/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));

        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['pkgs/*/src']);

        const result = (configOptions.defaultExtraPaths ?? []).map((uri) => normalizeSlashes(uri.getFilePath(), '/'));
        assert.deepStrictEqual(result, ['/proj/pkgs/a/src', '/proj/pkgs/b/src']);
    });

    test('initializeFromJson retains config-file extraPaths glob specs for watching', () => {
        const fs = makeFs(['/proj/pkgs/a/src', '/proj/pkgs/b/src']);
        const rootUri = Uri.file('/proj', fs);
        const configOptions = new ConfigOptions(rootUri);

        configOptions.initializeFromJson(
            { extraPaths: ['pkgs/*/src', 'libs/shared'] },
            rootUri,
            createServiceProvider(fs, new NullConsole()),
            new TestAccessHost()
        );

        // Only the wildcard entry is retained (as an absolute, glob-preserving spec) so a file
        // watcher can be registered for it; the literal entry needs no glob watcher.
        assert.deepStrictEqual(
            configOptions.extraPathGlobFileSpecs.map((s) => normalizeSlashes(s, '/')),
            ['/proj/pkgs/*/src']
        );
    });

    test('ensureDefaultExtraPaths de-duplicates realCasePath-collapsed entries on a case-insensitive FS', () => {
        // On a case-insensitive file system, expandExtraPaths keeps case-variant
        // entries distinct (case-sensitive de-dup), but realCasePath then collapses
        // them to the same on-disk directory. The settings origin must not emit the
        // resulting duplicate.
        const fs = makeFs(['/proj/libs/foo'], /* ignoreCase */ true);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));

        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['libs/foo', 'Libs/*']);

        const result = (configOptions.defaultExtraPaths ?? []).map((uri) => normalizeSlashes(uri.getFilePath(), '/'));
        assert.deepStrictEqual(result, ['/proj/libs/foo']);
    });

    test('initializeFromJson expands globs in the config-file extraPaths', () => {
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src', '/proj/libs/shared/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));
        const serviceProvider = createServiceProvider(fs);

        configOptions.initializeFromJson(
            { extraPaths: ['libs/shared/src', 'libs/*/src'] },
            Uri.file('/proj', fs),
            serviceProvider,
            new TestAccessHost()
        );

        const result = (configOptions.defaultExtraPaths ?? []).map((uri) => normalizeSlashes(uri.getFilePath(), '/'));
        assert.deepStrictEqual(result, ['/proj/libs/shared/src', '/proj/libs/auth/src', '/proj/libs/core/src']);
    });

    test('setupExecutionEnvironments expands globs in an execution environment', () => {
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));

        configOptions.setupExecutionEnvironments(
            { executionEnvironments: [{ root: 'app', extraPaths: ['libs/*/src'] }] },
            Uri.file('/proj', fs),
            new NullConsole(),
            fs
        );

        assert.strictEqual(configOptions.executionEnvironments.length, 1);
        const result = configOptions.executionEnvironments[0].extraPaths.map((uri) =>
            normalizeSlashes(uri.getFilePath(), '/')
        );
        assert.deepStrictEqual(result, ['/proj/libs/auth/src', '/proj/libs/core/src']);
    });

    test('an execution environment extraPaths overrides (does not merge with) a non-empty default', () => {
        // Establish a non-empty default first, then give the exec env its own
        // extraPaths. The result must contain ONLY the exec env's expanded globs;
        // `/proj/other` (the default) must be excluded. Without a non-empty default
        // the override-vs-merge distinction is untestable (vacuous pass).
        const fs = makeFs(['/proj/other', '/proj/libs/auth/src', '/proj/libs/core/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));
        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['other']);

        configOptions.setupExecutionEnvironments(
            { executionEnvironments: [{ root: 'app', extraPaths: ['libs/*/src'] }] },
            Uri.file('/proj', fs),
            new NullConsole(),
            fs
        );

        const result = configOptions.executionEnvironments[0].extraPaths.map((uri) =>
            normalizeSlashes(uri.getFilePath(), '/')
        );
        assert.deepStrictEqual(result, ['/proj/libs/auth/src', '/proj/libs/core/src']);
    });

    test('an execution environment without extraPaths inherits the expanded default', () => {
        // The exec env omits `extraPaths`, so it inherits the default. The default
        // is stored already-expanded, so the inherited list is the concrete
        // directories, not the raw `libs/*/src` glob.
        const fs = makeFs(['/proj/libs/auth/src', '/proj/libs/core/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));
        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['libs/*/src']);

        configOptions.setupExecutionEnvironments(
            { executionEnvironments: [{ root: 'app' }] },
            Uri.file('/proj', fs),
            new NullConsole(),
            fs
        );

        const result = configOptions.executionEnvironments[0].extraPaths.map((uri) =>
            normalizeSlashes(uri.getFilePath(), '/')
        );
        assert.deepStrictEqual(result, ['/proj/libs/auth/src', '/proj/libs/core/src']);
    });

    test('a literal that resolves via ".." to a glob match still wins and de-duplicates', () => {
        // `libs/../libs/shared/src` normalizes to `/proj/libs/shared/src`, the same
        // directory the glob matches. The literal keeps its front position and the
        // glob-produced duplicate is dropped.
        const fs = makeFs(['/proj/libs/shared/src', '/proj/libs/auth/src']);
        assert.deepStrictEqual(expand(fs, ['libs/../libs/shared/src', 'libs/*/src']), [
            '/proj/libs/shared/src',
            '/proj/libs/auth/src',
        ]);
    });

    test('a zero-match settings glob records its watch spec exactly once across repeated calls', () => {
        // A glob that currently matches nothing is still recorded so a watcher can
        // observe directories that appear later. Because a zero-match glob leaves
        // `defaultExtraPaths` unset, the caller's `!defaultExtraPaths` guard can invoke
        // `ensureDefaultExtraPaths` again; the spec must be recorded only once.
        const fs = makeFs(['/proj/other']); // nothing matches `pkgs/*/src`
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));

        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['pkgs/*/src']);
        configOptions.ensureDefaultExtraPaths(fs, /* autoSearchPaths */ false, ['pkgs/*/src']);

        assert.strictEqual(configOptions.defaultExtraPaths, undefined);
        assert.deepStrictEqual(
            configOptions.extraPathGlobFileSpecs.map((s) => normalizeSlashes(s, '/')),
            ['/proj/pkgs/*/src']
        );
    });

    // ---- Adversarial / corner-case coverage ----

    test('** matches zero segments (direct child of the base)', () => {
        // The direct `/proj/external/site-packages` proves the zero-segment branch.
        const fs = makeFs(['/proj/external/site-packages', '/proj/external/a/b/site-packages']);
        assert.deepStrictEqual(expand(fs, ['external/**/site-packages']), [
            '/proj/external/a/b/site-packages',
            '/proj/external/site-packages',
        ]);
    });

    test('leading ** matches at the base and at any depth', () => {
        const fs = makeFs(['/proj/site-packages', '/proj/a/site-packages']);
        assert.deepStrictEqual(expand(fs, ['**/site-packages']), ['/proj/a/site-packages', '/proj/site-packages']);
    });

    test('trailing ** includes the base directory and every descendant', () => {
        const fs = makeFs(['/proj/libs', '/proj/libs/a', '/proj/libs/a/b']);
        assert.deepStrictEqual(expand(fs, ['libs/**']), ['/proj/libs', '/proj/libs/a', '/proj/libs/a/b']);
    });

    test('bare * matches only immediate child directories', () => {
        const fs = makeFs(['/proj/libs', '/proj/libs/a', '/proj/other']);
        assert.deepStrictEqual(expand(fs, ['*']), ['/proj/libs', '/proj/other']);
    });

    test('bare ** matches the base and all descendants', () => {
        const fs = makeFs(['/proj/a', '/proj/a/b']);
        assert.deepStrictEqual(expand(fs, ['**']), ['/proj', '/proj/a', '/proj/a/b']);
    });

    test('consecutive ** terminates and does not duplicate matches', () => {
        const fs = makeFs(['/proj/a/x/b']);
        assert.deepStrictEqual(expand(fs, ['a/**/**/b']), ['/proj/a/x/b']);
    });

    test('? matches exactly one character and not zero', () => {
        const fs = makeFs(['/proj/pkg', '/proj/pkg1']);
        assert.deepStrictEqual(expand(fs, ['pkg?']), ['/proj/pkg1']);
    });

    test('regex metacharacters and Bazel-style names are matched literally', () => {
        const fs = makeFs([
            '/proj/ext/rules_python~~pip~pip_310_numpy/site-packages',
            '/proj/ext/rules_python~~pip~pip_311_pandas/site-packages',
            '/proj/ext/a+b(c)',
        ]);
        assert.deepStrictEqual(expand(fs, ['ext/rules_python~~pip~pip_*_numpy/site-packages']), [
            '/proj/ext/rules_python~~pip~pip_310_numpy/site-packages',
        ]);
        // `+` and `(` in the pattern must be treated literally, not as regex operators.
        assert.deepStrictEqual(expand(fs, ['ext/a+b*']), ['/proj/ext/a+b(c)']);
    });

    test('symbolic links are followed but the matched path is not resolved', () => {
        const fs = makeFs(['/proj/real/pkg']);
        fs.symlinkSync('/proj/real', '/proj/link');
        // The result keeps the symlink path "/proj/link/pkg" rather than "/proj/real/pkg".
        assert.deepStrictEqual(expand(fs, ['link/*']), ['/proj/link/pkg']);
    });

    test('a symlink diamond emits each logical path (symlinks are not resolved)', () => {
        const fs = makeFs(['/proj/real/pkg']);
        fs.symlinkSync('/proj/real', '/proj/link1');
        fs.symlinkSync('/proj/real', '/proj/link2');
        assert.deepStrictEqual(expand(fs, ['link1/*', 'link2/*']), ['/proj/link1/pkg', '/proj/link2/pkg']);
    });

    test('a single glob over two symlinks to the same target emits both aliases', () => {
        // Regression guard: the (logical directory, tailIndex) traversal memo must be
        // keyed on the logical path, not the real path. Two symlink aliases that
        // resolve to the same real directory at the same tail depth must both survive
        // a single glob entry (the second must not be dropped as an already-visited
        // real path). This is the Bazel `external/*/site-packages` symlink-forest case.
        const fs = makeFs(['/proj/real']);
        fs.symlinkSync('/proj/real', '/proj/link1');
        fs.symlinkSync('/proj/real', '/proj/link2');
        assert.deepStrictEqual(expand(fs, ['*']), ['/proj/link1', '/proj/link2', '/proj/real']);
    });

    test('a broken symlink is skipped during expansion', () => {
        const fs = makeFs(['/proj/realdir']);
        fs.symlinkSync('/proj/nonexistent', '/proj/broken');
        assert.deepStrictEqual(expand(fs, ['*']), ['/proj/realdir']);
    });

    test('a directory claimed by an explicit entry is dropped from every glob', () => {
        const fs = makeFs(['/proj/pkgs/a']);
        assert.deepStrictEqual(expand(fs, ['pkgs/a', 'pkgs/*', 'pkgs/a*']), ['/proj/pkgs/a']);
    });

    test('normalized-equal literal entries de-duplicate to a single path', () => {
        const fs = makeFs(['/proj/libs/shared/src']);
        assert.deepStrictEqual(expand(fs, ['libs/shared/src/', './libs/shared/src', 'libs/../libs/shared/src']), [
            '/proj/libs/shared/src',
        ]);
    });

    test('empty and whitespace-only entries are ignored; "." resolves to the base', () => {
        const fs = makeFs(['/proj/x']);
        assert.deepStrictEqual(expand(fs, ['']), []);
        assert.deepStrictEqual(expand(fs, ['   ']), []);
        assert.deepStrictEqual(expand(fs, ['.']), ['/proj']);
        assert.deepStrictEqual(expand(fs, ['', 'x', '   ']), ['/proj/x']);
    });

    test('an empty entries list produces an empty result', () => {
        const fs = makeFs(['/proj/x']);
        assert.deepStrictEqual(expand(fs, []), []);
    });

    test('KNOWN LIMITATION: on a case-insensitive file system a mis-cased glob root produces a duplicate', () => {
        // De-duplication is intentionally case-sensitive (see the component docs).
        // On a case-insensitive file system, a glob whose non-wildcard root is typed
        // in a different case than on disk emits that typed case, which does not
        // de-duplicate against a correctly-cased literal. This is an accepted
        // limitation for now (import-root case-insensitivity is out of scope).
        const fs = makeFs(['/proj/libs/foo'], /* ignoreCase */ true);
        assert.deepStrictEqual(expand(fs, ['libs/foo', 'Libs/*']), ['/proj/libs/foo', '/proj/Libs/foo']);
    });

    test('initializeFromJson without a file system falls back to literal resolution', () => {
        const fs = makeFs(['/proj/libs/auth/src']);
        const configOptions = new ConfigOptions(Uri.file('/proj', fs));

        // A service provider without a registered file system cannot expand globs;
        // entries are resolved literally (the glob character is left in the path).
        configOptions.initializeFromJson(
            { extraPaths: ['libs/*/src'] },
            Uri.file('/proj', fs),
            createServiceProvider(),
            new TestAccessHost()
        );

        const result = (configOptions.defaultExtraPaths ?? []).map((uri) => normalizeSlashes(uri.getFilePath(), '/'));
        assert.deepStrictEqual(result, ['/proj/libs/*/src']);
    });
});

describe('extraPath glob watch targets', () => {
    test('a non-wildcard URI produces no watch target', () => {
        assert.deepStrictEqual(targetsOf(['/proj/libs/shared/src']), []);
    });

    test('a single-segment glob yields the non-wildcard root and the tail pattern', () => {
        assert.deepStrictEqual(targetsOf(['/proj/libs/*/src']), [{ root: '/proj/libs', dirPattern: '*/src' }]);
    });

    test('a trailing wildcard yields the parent root and a "*" pattern', () => {
        assert.deepStrictEqual(targetsOf(['/proj/libs/*']), [{ root: '/proj/libs', dirPattern: '*' }]);
    });

    test('a "**" glob preserves the recursive tail relative to the root', () => {
        assert.deepStrictEqual(targetsOf(['/proj/packages/**/lib']), [
            { root: '/proj/packages', dirPattern: '**/lib' },
        ]);
    });

    test('a "?" glob is kept in the tail pattern', () => {
        assert.deepStrictEqual(targetsOf(['/proj/env/pip3??/site-packages']), [
            { root: '/proj/env', dirPattern: 'pip3??/site-packages' },
        ]);
    });

    test('only wildcard URIs contribute targets; literals are skipped', () => {
        assert.deepStrictEqual(targetsOf(['/proj/stubs', '/proj/libs/*/src', '/proj/vendor/**']), [
            { root: '/proj/libs', dirPattern: '*/src' },
            { root: '/proj/vendor', dirPattern: '**' },
        ]);
    });

    test('extraPathWatchTargetCovers matches directories the glob resolves to', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        const [target] = getExtraPathWatchTargets(['/proj/libs/*/src'], fs);

        // Directories the glob matches (and those beneath them) are covered.
        assert.strictEqual(extraPathWatchTargetCovers(target, Uri.file('/proj/libs/auth/src', fs)), true);
        assert.strictEqual(extraPathWatchTargetCovers(target, Uri.file('/proj/libs/auth/src/nested', fs)), true);

        // Sibling directories that the glob does not match are not covered.
        assert.strictEqual(extraPathWatchTargetCovers(target, Uri.file('/proj/libs/auth/docs', fs)), false);
        assert.strictEqual(extraPathWatchTargetCovers(target, Uri.file('/proj/other', fs)), false);
    });

    function targetsOf(paths: string[]): { root: string; dirPattern: string }[] {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        return getExtraPathWatchTargets(paths, fs).map((t) => ({
            root: normalizeSlashes(t.root.getFilePath(), '/'),
            dirPattern: t.dirPattern,
        }));
    }
});

function makeFs(dirs: string[], ignoreCase = false): TestFileSystem {
    const fs = new TestFileSystem(ignoreCase, { cwd: '/' });
    for (const dir of dirs) {
        fs.mkdirpSync(dir);
    }
    return fs;
}

function expand(fs: TestFileSystem, entries: string[], base = '/proj'): string[] {
    const baseUri = Uri.file(base, fs);
    return expandExtraPaths(fs, baseUri, entries).map((uri) => normalizeSlashes(uri.getFilePath(), '/'));
}
