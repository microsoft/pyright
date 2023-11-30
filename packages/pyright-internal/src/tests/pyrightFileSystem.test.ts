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

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);

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
    fs.processPartialStubPackages([libraryRoot], [libraryRoot]);

    const stubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));
    assert(fs.isMappedFilePath(stubFile));

    const myLib = combinePaths(libraryRoot, 'myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(3, entries.length);

    const subDirFile = combinePaths(libraryRoot, 'myLib', 'subdir', '__init__.pyi');
    assert(fs.existsSync(subDirFile));
    assert(fs.isMappedFilePath(subDirFile));

    const fakeFile = entries.filter((e) => e.name.endsWith('.pyi'))[0];
    assert(fakeFile.isFile());

    assert(!fs.existsSync(combinePaths(libraryRoot, 'myLib-stubs')));
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
    fs.processPartialStubPackages([libraryRoot], [libraryRoot]);

    const stubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));
    assert(fs.isMappedFilePath(stubFile));

    const myLib = combinePaths(libraryRoot, 'myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(3, entries.length);

    const subDirFile = combinePaths(libraryRoot, 'myLib', 'subdir', '__init__.py');
    assert(fs.existsSync(subDirFile));
    assert(!fs.isMappedFilePath(subDirFile));
    const subDirPyiFile = combinePaths(libraryRoot, 'myLib', 'subdir', '__init__.pyi');
    assert(fs.existsSync(subDirPyiFile));

    const fakeFile = entries.filter((e) => e.name.endsWith('.pyi'))[0];
    assert(fakeFile.isFile());

    assert(!fs.existsSync(combinePaths(libraryRoot, 'myLib-stubs')));
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
    fs.processPartialStubPackages([libraryRoot], [libraryRoot]);

    assert(!fs.existsSync(combinePaths(libraryRoot, 'myLib', 'partialStub.pyi')));

    const myLib = combinePaths(libraryRoot, 'myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(1, entries.length);

    assert.strictEqual(0, entries.filter((e) => e.name.endsWith('.pyi')).length);

    assert(fs.existsSync(combinePaths(libraryRoot, 'myLib-stubs')));
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
    fs.processPartialStubPackages([libraryRoot], [libraryRoot]);

    const stubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
    assert(fs.existsSync(stubFile));

    const myLib = combinePaths(libraryRoot, 'myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(2, entries.length);

    assert.strictEqual('def test(): ...', fs.readFileSync(stubFile, 'utf8'));

    assert(!fs.existsSync(combinePaths(libraryRoot, 'myLib-stubs')));
});

test('multiple package installed', () => {
    const extraRoot = combinePaths(normalizeSlashes('/'), lib, 'extra');
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
    fs.processPartialStubPackages([libraryRoot, extraRoot], [libraryRoot, extraRoot]);

    assert(fs.isPathScanned(libraryRoot));
    assert(fs.isPathScanned(extraRoot));

    assert(fs.existsSync(combinePaths(libraryRoot, 'myLib', 'partialStub.pyi')));
    assert(fs.existsSync(combinePaths(extraRoot, 'myLib', 'partialStub.pyi')));

    assert.strictEqual(2, fs.readdirEntriesSync(combinePaths(libraryRoot, 'myLib')).length);
    assert.strictEqual(2, fs.readdirEntriesSync(combinePaths(extraRoot, 'myLib')).length);
});

test('bundled partial stubs', () => {
    const bundledPath = combinePaths(normalizeSlashes('/'), 'bundled');

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
    fs.processPartialStubPackages([bundledPath], [libraryRoot], bundledPath);

    const stubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
    assert(!fs.existsSync(stubFile));

    const myLib = combinePaths(libraryRoot, 'myLib');
    const entries = fs.readdirEntriesSync(myLib);
    assert.strictEqual(2, entries.length);
});

function createFileSystem(files: { path: string; content: string }[]): PyrightFileSystem {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of files) {
        const path = normalizeSlashes(file.path);
        const dir = getDirectoryPath(path);
        fs.mkdirpSync(dir);

        fs.writeFileSync(path, file.content);
    }

    return new PyrightFileSystem(fs);
}
