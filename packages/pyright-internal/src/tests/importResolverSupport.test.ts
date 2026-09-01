/*
 * importResolverInfrastructure.test.ts
 *
 * Unit tests for the extracted ImportResolver infrastructure helpers.
 */

import assert from 'assert';

import { createImportResolverFileSystem } from '../analyzer/importResolverFileSystem';
import { ImportLogger } from '../analyzer/importLogger';
import { createDefaultTypeshedInfoProvider } from '../analyzer/typeshedInfoProvider';
import { typeshedFallback } from '../common/pathConsts';
import { normalizeSlashes } from '../common/pathUtils';
import { PythonVersion } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import { TestFileSystem } from './harness/vfs/filesystem';

function normalizedPath(uri: Uri): string {
    return normalizeSlashes(uri.getFilePath(), '/');
}

describe('ImportResolverFileSystem', () => {
    test('readdirEntriesSync caches per-directory and is cleared by invalidateCache', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/dir');
        fs.writeFileSync(Uri.file('/dir/a.py', fs), '');

        const spy = jest.spyOn(fs, 'readdirEntriesSync');

        const cache = createImportResolverFileSystem(fs);
        cache.readdirEntriesSync(Uri.file('/dir', fs));
        cache.readdirEntriesSync(Uri.file('/dir', fs));
        assert.strictEqual(spy.mock.calls.length, 1);

        cache.invalidateCache();
        cache.readdirEntriesSync(Uri.file('/dir', fs));
        assert.strictEqual(spy.mock.calls.length, 2);

        spy.mockRestore();
    });

    test('fileExists/dirExists follow symlinks via realpath (parity with pre-refactor behavior)', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/realDir');
        fs.writeFileSync(Uri.file('/realFile.txt', fs), 'x');
        fs.mkdirpSync('/links');
        fs.symlinkSync('/realFile.txt', '/links/fileLink.txt');
        fs.symlinkSync('/realDir', '/links/dirLink');

        const cache = createImportResolverFileSystem(fs);

        assert.strictEqual(cache.fileExists(Uri.file('/links/fileLink.txt', fs)), true);
        assert.strictEqual(cache.fileExists(Uri.file('/links/dirLink', fs)), false);

        assert.strictEqual(cache.dirExists(Uri.file('/links/dirLink', fs)), true);
        assert.strictEqual(cache.dirExists(Uri.file('/links/fileLink.txt', fs)), false);
    });

    test('fileExists/dirExists return false for missing paths and broken symlinks', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/links');
        fs.symlinkSync('/doesNotExist', '/links/brokenLink');

        const cache = createImportResolverFileSystem(fs);

        assert.strictEqual(cache.fileExists(Uri.file('/missingFile', fs)), false);
        assert.strictEqual(cache.dirExists(Uri.file('/missingDir', fs)), false);

        assert.strictEqual(cache.fileExists(Uri.file('/links/brokenLink', fs)), false);
        assert.strictEqual(cache.dirExists(Uri.file('/links/brokenLink', fs)), false);
    });

    test('dirExists caches existence checks for root', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        const statSpy = jest.spyOn(fs, 'statSync');

        const cache = createImportResolverFileSystem(fs);
        const root = Uri.file('/', fs);

        assert.strictEqual(cache.dirExists(root), true);
        assert.strictEqual(cache.dirExists(root), true);

        // For the root path we should consult the filesystem once and then cache the result.
        assert.strictEqual(statSpy.mock.calls.length, 1);
        statSpy.mockRestore();
    });

    test('getFilesInDirectory returns files and symlinks-to-files and caches results', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/dir');
        fs.writeFileSync(Uri.file('/dir/a.py', fs), '');
        fs.writeFileSync(Uri.file('/realFile.txt', fs), 'x');
        fs.symlinkSync('/realFile.txt', '/dir/fileLink.txt');

        const readdirSpy = jest.spyOn(fs, 'readdirEntriesSync');

        const cache = createImportResolverFileSystem(fs);
        const dir = Uri.file('/dir', fs);

        const files1 = cache.getFilesInDirectory(dir);
        assert(files1.some((u) => normalizedPath(u) === '/dir/a.py'));
        assert(files1.some((u) => normalizedPath(u) === '/dir/fileLink.txt'));

        const callsAfterFirst = readdirSpy.mock.calls.length;

        const files2 = cache.getFilesInDirectory(dir);
        assert.deepStrictEqual(
            files2.map((u) => normalizedPath(u)).sort(),
            files1.map((u) => normalizedPath(u)).sort()
        );

        // Second call should be served from cache.
        assert.strictEqual(readdirSpy.mock.calls.length, callsAfterFirst);

        readdirSpy.mockRestore();
    });

    test('getFilesInDirectory is stale until invalidateCache', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/dir');
        fs.writeFileSync(Uri.file('/dir/a.py', fs), '');

        const cache = createImportResolverFileSystem(fs);
        const dir = Uri.file('/dir', fs);

        const files1 = cache
            .getFilesInDirectory(dir)
            .map((u) => normalizedPath(u))
            .sort();
        assert.deepStrictEqual(files1, ['/dir/a.py']);

        fs.writeFileSync(Uri.file('/dir/b.py', fs), '');

        // Served from cache, so it won't include newly-added files.
        const files2 = cache
            .getFilesInDirectory(dir)
            .map((u) => normalizedPath(u))
            .sort();
        assert.deepStrictEqual(files2, ['/dir/a.py']);

        cache.invalidateCache();
        const files3 = cache
            .getFilesInDirectory(dir)
            .map((u) => normalizedPath(u))
            .sort();
        assert.deepStrictEqual(files3, ['/dir/a.py', '/dir/b.py']);
    });

    test('getResolvableNamesInDirectory includes extensionless file names and -stubs suffix stripping', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/dir');
        fs.mkdirpSync('/dir/pkg-stubs');
        fs.writeFileSync(Uri.file('/dir/foo.cpython-311-x86_64-linux-gnu.so', fs), '');

        const cache = createImportResolverFileSystem(fs);
        const names = cache.getResolvableNamesInDirectory(Uri.file('/dir', fs));

        assert(names.has('pkg-stubs'));
        assert(names.has('pkg'));
        assert(names.has('foo'));
    });

    test('getResolvableNamesInDirectory strips extensions (including multi-dot) and follows symlinks for file-ness', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/dir');

        fs.writeFileSync(Uri.file('/dir/a.py', fs), '');
        fs.writeFileSync(Uri.file('/dir/b.pyi', fs), '');
        fs.writeFileSync(Uri.file('/dir/c.pyc', fs), '');
        fs.writeFileSync(Uri.file('/dir/foo.cpython-311-x86_64-linux-gnu.so', fs), '');

        fs.writeFileSync(Uri.file('/real.pyi', fs), 'x');
        fs.symlinkSync('/real.pyi', '/dir/link.pyi');

        const cache = createImportResolverFileSystem(fs);
        const names = cache.getResolvableNamesInDirectory(Uri.file('/dir', fs));

        assert(names.has('a'));
        assert(names.has('b'));
        assert(names.has('c'));
        assert(names.has('foo'));
        assert(names.has('link'));
    });

    test('readdirEntriesSync failures are swallowed and cached until invalidateCache', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
        fs.mkdirpSync('/boom');

        const original = fs.readdirEntriesSync.bind(fs);
        const readdirSpy = jest.spyOn(fs, 'readdirEntriesSync').mockImplementation((uri) => {
            if (normalizedPath(uri) === '/boom') {
                throw new Error('boom');
            }
            return original(uri);
        });

        const cache = createImportResolverFileSystem(fs);

        assert.deepStrictEqual(cache.readdirEntriesSync(Uri.file('/boom', fs)), []);
        assert.deepStrictEqual(cache.readdirEntriesSync(Uri.file('/boom', fs)), []);

        // Only one underlying call, and then we serve the cached empty value.
        assert.strictEqual(readdirSpy.mock.calls.length, 1);

        cache.invalidateCache();
        assert.deepStrictEqual(cache.readdirEntriesSync(Uri.file('/boom', fs)), []);
        assert.strictEqual(readdirSpy.mock.calls.length, 2);

        readdirSpy.mockRestore();
    });
});

describe('TypeshedInfoProvider (default)', () => {
    function createFsWithTypeshedLayout() {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });

        const typeshedRoot = `/${typeshedFallback}`;
        fs.mkdirpSync(typeshedRoot);
        fs.mkdirpSync(`${typeshedRoot}/stdlib`);
        fs.mkdirpSync(`${typeshedRoot}/stubs`);

        const cache = createImportResolverFileSystem(fs);
        const provider = createDefaultTypeshedInfoProvider(cache);

        return { fs, cache, provider, typeshedRoot };
    }

    test('getTypeshedRoot prefers custom path when present, otherwise falls back', () => {
        const { fs, provider, typeshedRoot } = createFsWithTypeshedLayout();

        fs.mkdirpSync('/customTypeshed');

        const custom = Uri.file('/customTypeshed', fs);
        const resolvedCustom = provider.getTypeshedRoot(custom);
        assert(resolvedCustom);
        assert.strictEqual(normalizedPath(resolvedCustom), '/customTypeshed');

        const resolvedFallback = provider.getTypeshedRoot(undefined);
        assert(resolvedFallback);
        assert.strictEqual(normalizedPath(resolvedFallback), typeshedRoot);
    });

    test('getTypeshedRoot ignores a custom typeshed path that is not a directory', () => {
        const { fs, provider, typeshedRoot } = createFsWithTypeshedLayout();

        const customPath = Uri.file('/customTypeshed', fs);
        fs.writeFileSync(customPath, 'not a directory');

        const resolved = provider.getTypeshedRoot(customPath);
        assert(resolved);
        assert.strictEqual(normalizedPath(resolved), typeshedRoot);
    });

    test('getTypeshedSubdirectory returns undefined when the expected subdirectory does not exist', () => {
        const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });

        const typeshedRoot = `/${typeshedFallback}`;
        fs.mkdirpSync(typeshedRoot);
        fs.mkdirpSync(`${typeshedRoot}/stdlib`);
        // Intentionally omit `${typeshedRoot}/stubs`.

        const cache = createImportResolverFileSystem(fs);
        const provider = createDefaultTypeshedInfoProvider(cache);

        assert.strictEqual(
            provider.getTypeshedSubdirectory(/* isStdLib */ false, /* customTypeshedPath */ undefined),
            undefined
        );
    });

    test('getThirdPartyPackageMap builds expected map and is memoized (independent of filesystem cache)', () => {
        const { fs, cache, provider, typeshedRoot } = createFsWithTypeshedLayout();

        // Build a minimal stubs layout:
        //   stubs/a/foo/
        //   stubs/a/bar.pyi
        //   stubs/a/@python2/   (ignored)
        //   stubs/b/foo/
        fs.mkdirpSync(`${typeshedRoot}/stubs/a/foo`);
        fs.mkdirpSync(`${typeshedRoot}/stubs/a/@python2`);
        fs.writeFileSync(Uri.file(`${typeshedRoot}/stubs/a/bar.pyi`, fs), '');
        fs.writeFileSync(Uri.file(`${typeshedRoot}/stubs/a/readme.txt`, fs), '');
        fs.mkdirpSync(`${typeshedRoot}/stubs/b/foo`);
        fs.writeFileSync(Uri.file(`${typeshedRoot}/stubs/outerFile.txt`, fs), '');

        const readdirSpy = jest.spyOn(fs, 'readdirEntriesSync');

        const [packageMap, roots] = provider.getThirdPartyPackageMap(undefined);
        assert.deepStrictEqual(
            roots.map((u) => normalizedPath(u)).sort(),
            [`${typeshedRoot}/stubs/a`, `${typeshedRoot}/stubs/b`].sort()
        );

        const fooPaths = packageMap.get('foo');
        assert(fooPaths);
        assert.deepStrictEqual(
            fooPaths.map((u) => normalizedPath(u)).sort(),
            [`${typeshedRoot}/stubs/a`, `${typeshedRoot}/stubs/b`].sort()
        );

        const barPaths = packageMap.get('bar');
        assert(barPaths);
        assert.deepStrictEqual(
            barPaths.map((u) => normalizedPath(u)),
            [`${typeshedRoot}/stubs/a`]
        );

        assert(!packageMap.has('@python2'));
        assert(!packageMap.has('readme'));

        const callsAfterFirst = readdirSpy.mock.calls.length;

        // Clear the ImportResolverFileSystem cache to ensure TypeshedInfoProvider memoization is effective.
        cache.invalidateCache();

        const [packageMap2, roots2] = provider.getThirdPartyPackageMap(undefined);
        assert.strictEqual(packageMap2, packageMap);
        assert.strictEqual(roots2, roots);

        // Should not have re-enumerated directories.
        assert.strictEqual(readdirSpy.mock.calls.length, callsAfterFirst);
        readdirSpy.mockRestore();
    });

    test('getStdLibModuleVersionInfo parses VERSIONS and is memoized (independent of filesystem cache)', () => {
        const { fs, cache, provider, typeshedRoot } = createFsWithTypeshedLayout();

        const versionsUri = Uri.file(`${typeshedRoot}/stdlib/VERSIONS`, fs);
        fs.writeFileSync(
            versionsUri,
            [
                'asyncio: 3.4-',
                'distutils: 3.0-3.10 ; platforms=win32, !linux',
                'bar: -3.8',
                'email: 3.6+  # plus suffix is allowed',
                'this is not valid',
                ': 3.7-  # missing module name',
            ].join('\n'),
            'utf8'
        );

        const statSpy = jest.spyOn(fs, 'statSync');
        const readSpy = jest.spyOn(fs, 'readFileSync');

        const versionInfo = provider.getStdLibModuleVersionInfo(undefined);

        const asyncio = versionInfo.get('asyncio');
        assert(asyncio);
        assert(PythonVersion.isEqualTo(asyncio.min, PythonVersion.fromString('3.4')!));
        assert.strictEqual(asyncio.max, undefined);

        const distutils = versionInfo.get('distutils');
        assert(distutils);
        assert(PythonVersion.isEqualTo(distutils.min, PythonVersion.fromString('3.0')!));
        assert(PythonVersion.isEqualTo(distutils.max!, PythonVersion.fromString('3.10')!));
        assert.deepStrictEqual(distutils.supportedPlatforms, ['win32']);
        assert.deepStrictEqual(distutils.unsupportedPlatforms, ['linux']);

        const bar = versionInfo.get('bar');
        assert(bar);
        // Empty min version defaults to 3.0.
        assert(PythonVersion.isEqualTo(bar.min, PythonVersion.fromString('3.0')!));
        assert(PythonVersion.isEqualTo(bar.max!, PythonVersion.fromString('3.8')!));

        const email = versionInfo.get('email');
        assert(email);
        assert(PythonVersion.isEqualTo(email.min, PythonVersion.fromString('3.6')!));

        const statCallsAfterFirst = statSpy.mock.calls.length;
        const readCallsAfterFirst = readSpy.mock.calls.length;

        // Clear the ImportResolverFileSystem cache to ensure TypeshedInfoProvider memoization is effective.
        cache.invalidateCache();

        const versionInfo2 = provider.getStdLibModuleVersionInfo(undefined);
        assert.strictEqual(versionInfo2, versionInfo);

        assert.strictEqual(statSpy.mock.calls.length, statCallsAfterFirst);
        assert.strictEqual(readSpy.mock.calls.length, readCallsAfterFirst);

        statSpy.mockRestore();
        readSpy.mockRestore();
    });

    test('getStdLibModuleVersionInfo memoizes an empty result when VERSIONS is missing', () => {
        const { fs, provider, typeshedRoot } = createFsWithTypeshedLayout();

        // No VERSIONS file.
        const versionInfo1 = provider.getStdLibModuleVersionInfo(undefined);
        assert.strictEqual(versionInfo1.size, 0);

        // Create it later; memoization should keep returning the originally computed value.
        fs.writeFileSync(Uri.file(`${typeshedRoot}/stdlib/VERSIONS`, fs), 'asyncio: 3.4-', 'utf8');
        const versionInfo2 = provider.getStdLibModuleVersionInfo(undefined);
        assert.strictEqual(versionInfo2, versionInfo1);
        assert.strictEqual(versionInfo2.size, 0);
    });

    test('getStdLibModuleVersionInfo logs and skips reading when VERSIONS is too large', () => {
        const { fs, provider, typeshedRoot } = createFsWithTypeshedLayout();

        const versionsUri = Uri.file(`${typeshedRoot}/stdlib/VERSIONS`, fs);
        fs.writeFileSync(versionsUri, 'a'.repeat(256 * 1024), 'utf8');

        const importLogger = new ImportLogger();
        const readSpy = jest.spyOn(fs, 'readFileSync');

        const versionInfo = provider.getStdLibModuleVersionInfo(undefined, importLogger);
        assert.strictEqual(versionInfo.size, 0);
        assert.strictEqual(readSpy.mock.calls.length, 0);

        assert(importLogger.getLogs().some((l) => l.includes('unexpectedly large')));

        readSpy.mockRestore();
    });

    test('getStdLibModuleVersionInfo logs and returns empty when reading VERSIONS throws', () => {
        const { fs, provider, typeshedRoot } = createFsWithTypeshedLayout();

        const versionsUri = Uri.file(`${typeshedRoot}/stdlib/VERSIONS`, fs);
        fs.writeFileSync(versionsUri, 'asyncio: 3.4-', 'utf8');

        const importLogger = new ImportLogger();
        const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('read failed');
        });

        const versionInfo = provider.getStdLibModuleVersionInfo(undefined, importLogger);
        assert.strictEqual(versionInfo.size, 0);
        assert(importLogger.getLogs().some((l) => l.includes('Could not read typeshed stdlib VERSIONS file')));

        readSpy.mockRestore();
    });
});
