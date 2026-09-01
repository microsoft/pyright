/*
 * pyrightFileSystem.test.ts
 *
 * pyrightFileSystem tests.
 */

import assert from 'assert';

import { FileSystem } from '../common/fileSystem';
import { lib, sitePackages } from '../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { ReadOnlyAugmentedFileSystem } from '../readonlyAugmentedFileSystem';
import { TestFileSystem } from './harness/vfs/filesystem';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { PartialStubService } from '../partialStubService';

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);
const libraryRootUri = UriEx.file(libraryRoot);

test('read-only augmented file system preserves prohibited operations', () => {
    const realFs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    const fs = new ReadOnlyAugmentedFileSystem(realFs);
    const source = UriEx.file(normalizeSlashes('/source'));
    const destination = UriEx.file(normalizeSlashes('/destination'));
    const operations = [
        () => fs.mkdirSync(source),
        () => fs.chdir(source),
        () => fs.writeFileSync(source, 'content', 'utf8'),
        () => fs.rmdirSync(source),
        () => fs.unlinkSync(source),
        () => fs.createWriteStream(source),
        () => fs.copyFileSync(source, destination),
    ];

    for (const operation of operations) {
        assert.throws(operation, /^Error: Operation is not allowed\.$/);
    }
});

test('read-only augmented file system mapping filter receives its exact backing file system', () => {
    const originalRoot = UriEx.file(normalizeSlashes('/original'));
    const mappedRoot = UriEx.file(normalizeSlashes('/mapped'));
    const originalFile = originalRoot.combinePaths('file.py');
    const mappedFile = mappedRoot.combinePaths('file.py');
    const realFs = new TestFileSystem(/* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
        files: { [originalFile.getFilePath()]: 'content' },
    });
    const fs = new ReadOnlyAugmentedFileSystem(realFs);
    let observedFileSystem: FileSystem | undefined;
    fs.mapDirectory(mappedRoot, originalRoot, (_uri, fileSystem) => {
        observedFileSystem = fileSystem;
        return true;
    });

    assert.strictEqual(fs.readFileSync(mappedFile, 'utf8'), 'content');
    assert.strictEqual(observedFileSystem, realFs);
});

test('read-only augmented file system exposes no reset surface', () => {
    const fs = new ReadOnlyAugmentedFileSystem(
        new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') })
    );

    assert.strictEqual('clear' in fs, false);
});

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

test('mapped symlinks reflect their targets', () => {
    const testFs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });
    const stubPackage = combinePaths(libraryRoot, 'myLib-stubs');
    const stubSource = combinePaths(normalizeSlashes('/'), 'wheel', 'partialStub.pyi');
    const markerSource = combinePaths(normalizeSlashes('/'), 'wheel', 'py.typed');
    const missingStub = combinePaths(stubPackage, 'missing.pyi');

    testFs.mkdirpSync(combinePaths(libraryRoot, 'myLib'));
    testFs.writeFileSync(Uri.file(combinePaths(libraryRoot, 'myLib', 'partialStub.py'), testFs), 'def test(): pass');
    testFs.mkdirpSync(stubPackage);
    testFs.mkdirpSync(getDirectoryPath(stubSource));
    testFs.writeFileSync(Uri.file(stubSource, testFs), 'def test(): ...');
    testFs.writeFileSync(Uri.file(markerSource, testFs), 'partial\n');
    testFs.symlinkSync(stubSource, combinePaths(stubPackage, 'partialStub.pyi'));
    testFs.symlinkSync(markerSource, combinePaths(stubPackage, 'py.typed'));
    testFs.symlinkSync(combinePaths(normalizeSlashes('/'), 'wheel', 'missing.pyi'), missingStub);

    const fs = new PyrightFileSystem(testFs);
    const ps = new PartialStubService(fs);
    ps.processPartialStubPackages([libraryRootUri], [libraryRootUri]);

    const entries = fs.readdirEntriesSync(libraryRootUri.combinePaths('myLib'));
    assert.strictEqual(2, entries.length);
    const stubFile = entries.find((entry) => entry.name === 'partialStub.pyi');
    assert.ok(stubFile, 'Expected partialStub.pyi');
    assert(stubFile.isFile());
    assert(!entries.some((entry) => entry.name === 'missing.pyi'));
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
