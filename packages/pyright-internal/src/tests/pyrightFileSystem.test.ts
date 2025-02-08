/*
 * pyrightFileSystem.test.ts
 *
 * pyrightFileSystem tests.
 */

import assert from 'assert';

import { lib, sitePackages } from '../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { TestFileSystem } from './harness/vfs/filesystem';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { PartialStubService } from '../partialStubService';

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);
const libraryRootUri = UriEx.file(libraryRoot);

test('virtual file exists', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'subdir', '__init__.pyi'),
            content: 'def subdir(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri], [libraryRootUri]);

    const stubFile = libraryRootUri.combinePaths('myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));
    assert(fs.isMappedUri(stubFile));

    const myLib = libraryRootUri.combinePaths('myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(3, entries.length);

    const subDirFile = libraryRootUri.combinePaths('myLib', 'subdir', '__init__.pyi');
    assert(fs.existsSync(subDirFile));
    assert(fs.isMappedUri(subDirFile));

    const fakeFile = entries.filter((e) => e.name.endsWith('.pyi'))[0];
    assert(fakeFile.isFile());

    assert(!fs.existsSync(libraryRootUri.combinePaths('myLib-stubs')));
});

test('virtual file coexists with real', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'subdir', '__init__.pyi'),
            content: 'def subdir(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'subdir', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri], [libraryRootUri]);

    const stubFile = libraryRootUri.combinePaths('myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));
    assert(fs.isMappedUri(stubFile));

    const myLib = libraryRootUri.combinePaths('myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(3, entries.length);

    const subDirFile = libraryRootUri.combinePaths('myLib', 'subdir', '__init__.pyi');
    assert(fs.existsSync(subDirFile));
    assert(fs.isMappedUri(subDirFile));

    const subDirPyiFile = libraryRootUri.combinePaths('myLib', 'subdir', '__init__.pyi');
    assert(fs.existsSync(subDirPyiFile));

    const fakeFile = entries.filter((e) => e.name.endsWith('.pyi'))[0];
    assert(fakeFile.isFile());

    assert(!fs.existsSync(libraryRootUri.combinePaths('myLib-stubs')));
});

test('virtual file not exist', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'otherType.py'),
            content: 'def test(): pass',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri], [libraryRootUri]);

    assert(!fs.existsSync(libraryRootUri.combinePaths('myLib', 'partialStub.pyi')));

    const myLib = libraryRootUri.combinePaths('myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(1, entries.length);

    assert.strictEqual(0, entries.filter((e) => e.name.endsWith('.pyi')).length);

    assert(fs.existsSync(libraryRootUri.combinePaths('myLib-stubs')));
});

test('existing stub file', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.pyi'),
            content: 'def test(): pass',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri], [libraryRootUri]);

    const stubFile = libraryRootUri.combinePaths('myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));

    const myLib = libraryRootUri.combinePaths('myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(2, entries.length);

    assert.strictEqual('def test(): ...', fs.readFileSync(stubFile, 'utf8'));

    assert(!fs.existsSync(libraryRootUri.combinePaths('myLib-stubs')));
});

test('multiple package installed', () => {
    const extraRoot = combinePaths(normalizeSlashes('/'), lib, 'extra');
    const extraRootUri = UriEx.file(extraRoot);
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(extraRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri, extraRootUri], [libraryRootUri, extraRootUri]);

    assert(ps.isPathScanned(libraryRootUri));
    assert(ps.isPathScanned(extraRootUri));

    assert(fs.existsSync(libraryRootUri.combinePaths('myLib', 'partialStub.pyi')));
    assert(fs.existsSync(extraRootUri.combinePaths('myLib', 'partialStub.pyi')));

    assert.strictEqual(2, fs.readdirEntriesSync(libraryRootUri.combinePaths('myLib')).length);
    assert.strictEqual(2, fs.readdirEntriesSync(extraRootUri.combinePaths('myLib')).length);
});

test('bundled partial stubs', () => {
    const bundledPath = combinePaths(normalizeSlashes('/'), 'bundled');
    const bundledPathUri = UriEx.file(bundledPath);

    const files = [
        {
            path: combinePaths(bundledPath, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(bundledPath, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'py.typed'),
            content: '',
        },
    ];

    const fs = createFileSystem(files);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([bundledPathUri], [libraryRootUri], bundledPathUri);

    const stubFile = libraryRootUri.combinePaths('myLib', 'partialStub.pyi');
    assert(!fs.existsSync(stubFile));

    const myLib = libraryRootUri.combinePaths('myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(2, entries.length);
});

function createFileSystem(files: { path: string; content: string }[]): PyrightFileSystem {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of files) {
        const path = normalizeSlashes(file.path);
        const dir = getDirectoryPath(path);
        fs.mkdirpSync(dir);

        fs.writeFileSync(Uri.file(path, fs), file.content);
    }

    return new PyrightFileSystem(fs);
}
