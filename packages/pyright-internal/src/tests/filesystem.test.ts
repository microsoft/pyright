/*
 * filesystem.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test and show how to use virtual file system
 */

import assert from 'assert';

import { combinePaths, normalizeSlashes } from '../common/pathUtils';
import * as host from './harness/testHost';
import * as factory from './harness/vfs/factory';
import * as vfs from './harness/vfs/filesystem';
import { UriEx } from '../common/uri/uriUtils';

test('CreateVFS', () => {
    const cwd = normalizeSlashes('/');
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });
    assert.equal(fs.cwd(), cwd);
});

test('Folders', () => {
    const cwd = UriEx.file(normalizeSlashes('/'));
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd: cwd.getFilePath() });

    // no such dir exist
    assert.throws(() => {
        fs.chdir(cwd.combinePaths('a'));
    });

    fs.mkdirSync(cwd.combinePaths('a'));
    fs.chdir(cwd.combinePaths('a'));
    assert.equal(fs.cwd(), normalizeSlashes('/a'));

    fs.chdir(cwd.resolvePaths('..'));
    fs.rmdirSync(cwd.combinePaths('a'));

    // no such dir exist
    assert.throws(() => {
        fs.chdir(cwd.combinePaths('a'));
    });
});

test('Folders Recursive', () => {
    const cwd = UriEx.file(normalizeSlashes('/'));
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd: cwd.getFilePath() });

    // no such dir exist
    assert.throws(() => {
        fs.chdir(cwd.combinePaths('a'));
    });

    const path = cwd.combinePaths('a', 'b', 'c');
    fs.mkdirSync(path, { recursive: true });

    assert(fs.existsSync(path));
});

test('Files', () => {
    const cwd = UriEx.file(normalizeSlashes('/'));
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd: cwd.getFilePath() });

    const uri = cwd.combinePaths('1.txt');
    fs.writeFileSync(uri, 'hello', 'utf8');
    const buffer1 = fs.readFileSync(uri);
    assert.equal(buffer1.toString(), 'hello');

    const p = cwd.resolvePaths('a/b/c');
    fs.mkdirpSync(p.getFilePath());

    const f = p.combinePaths('2.txt');
    fs.writeFileSync(f, 'hi');

    const str = fs.readFileSync(f, 'utf8');
    assert.equal(str, 'hi');
});

test('CreateRich', () => {
    const cwd = normalizeSlashes('/');
    const files: vfs.FileSet = {
        [normalizeSlashes('/a/b/c/1.txt')]: new vfs.File('hello1'),
        [normalizeSlashes('/a/b/2.txt')]: new vfs.File('hello2'),
        [normalizeSlashes('/a/3.txt')]: new vfs.File('hello3'),
        [normalizeSlashes('/4.txt')]: new vfs.File('hello4', { encoding: 'utf16le' }),
        [normalizeSlashes('/a/b/../c/./5.txt')]: new vfs.File('hello5', { encoding: 'ucs2' }),
    };

    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd, files });
    const entries = fs.scanSync(cwd, 'descendants-or-self', {});

    // files + directory + root
    assert.equal(entries.length, 10);

    assert.equal(fs.readFileSync(UriEx.file(normalizeSlashes('/a/b/c/1.txt')), 'ascii'), 'hello1');
    assert.equal(fs.readFileSync(UriEx.file(normalizeSlashes('/a/b/2.txt')), 'utf8'), 'hello2');
    assert.equal(fs.readFileSync(UriEx.file(normalizeSlashes('/a/3.txt')), 'utf-8'), 'hello3');
    assert.equal(fs.readFileSync(UriEx.file(normalizeSlashes('/4.txt')), 'utf16le'), 'hello4');
    assert.equal(fs.readFileSync(UriEx.file(normalizeSlashes('/a/c/5.txt')), 'ucs2'), 'hello5');
});

test('Shadow', () => {
    const cwd = normalizeSlashes('/');
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });

    // only readonly fs can be shadowed
    assert.throws(() => fs.shadow());

    // one way to create shadow is making itself snapshot
    fs.snapshot();
    assert(!fs.isReadonly);
    assert(fs.shadowRoot!.isReadonly);

    // another way is creating one off existing readonly snapshot
    const shadow1 = fs.shadowRoot!.shadow();
    assert(!shadow1.isReadonly);
    assert(shadow1.shadowRoot === fs.shadowRoot);

    // make itself readonly and then shawdow
    shadow1.makeReadonly();
    assert(shadow1.isReadonly);

    const shadow2 = shadow1.shadow();
    assert(!shadow2.isReadonly);
    assert(shadow2.shadowRoot === shadow1);
});

test('Diffing', () => {
    const cwd = UriEx.file(normalizeSlashes('/'));
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd: cwd.getFilePath() });

    // first snapshot
    fs.snapshot();
    fs.writeFileSync(cwd.combinePaths('test1.txt'), 'hello1');

    // compared with original
    assert.equal(countFile(fs.diff()!), 1);

    // second snapshot
    fs.snapshot();
    fs.writeFileSync(cwd.combinePaths('test2.txt'), 'hello2');

    // compared with first snapshot
    assert.equal(countFile(fs.diff()!), 1);

    // compare with original snapshot
    assert.equal(countFile(fs.diff(fs.shadowRoot!.shadowRoot)!), 2);

    // branch out from first snapshot
    const s = fs.shadowRoot!.shadow();

    // "test2.txt" only exist in first snapshot
    assert(!s.existsSync(cwd.combinePaths('test2.txt')));

    // create parallel universe where it has another version of test2.txt with different content
    // compared to second snapshot which forked from same first snapshot
    s.writeFileSync(cwd.combinePaths('test2.txt'), 'hello3');

    // diff between non direct snapshots
    // diff gives test2.txt even though it exist in both snapshot
    assert.equal(countFile(s.diff(fs)!), 1);
});

test('createFromFileSystem1', () => {
    const filepath = normalizeSlashes(combinePaths(factory.srcFolder, 'test.py'));
    const content = '# test';

    // file system will map physical file system to virtual one
    const fs = factory.createFromFileSystem(host.HOST, false, {
        documents: [new factory.TextDocument(filepath, content)],
        cwd: factory.srcFolder,
    });

    // check existing typeshed folder on virtual path inherited from base snapshot from physical file system
    const entries = fs.readdirSync(factory.typeshedFolder);
    assert(entries.length > 0);

    // confirm file
    assert.equal(fs.readFileSync(UriEx.file(filepath), 'utf8'), content);
});

test('createFromFileSystem2', () => {
    const fs = factory.createFromFileSystem(host.HOST, /* ignoreCase */ true, { cwd: factory.srcFolder });
    const entries = fs.readdirSync(UriEx.file(factory.typeshedFolder.getFilePath().toUpperCase()));
    assert(entries.length > 0);
});

test('createFromFileSystemWithCustomTypeshedPath', () => {
    const invalidpath = normalizeSlashes(combinePaths(host.HOST.getWorkspaceRoot(), '../docs'));
    const fs = factory.createFromFileSystem(host.HOST, /* ignoreCase */ false, {
        cwd: factory.srcFolder,
        meta: { [factory.typeshedFolder.getFilePath()]: invalidpath },
    });

    const entries = fs.readdirSync(factory.typeshedFolder);
    assert(entries.filter((e) => e.endsWith('.md')).length > 0);
});

test('createFromFileSystemWithMetadata', () => {
    const fs = factory.createFromFileSystem(host.HOST, /* ignoreCase */ false, {
        cwd: factory.srcFolder,
        meta: { unused: 'unused' },
    });

    assert(fs.existsSync(UriEx.file(factory.srcFolder)));
});

function countFile(files: vfs.FileSet): number {
    let count = 0;
    for (const value of Object.values(flatten(files))) {
        if (value instanceof vfs.File) {
            count++;
        }
    }

    return count;
}

function flatten(files: vfs.FileSet): vfs.FileSet {
    const result: vfs.FileSet = {};
    _flatten(files, result);
    return result;
}

function _flatten(files: vfs.FileSet, result: vfs.FileSet): void {
    for (const [key, value] of Object.entries(files)) {
        result[key] = value;
        if (value instanceof vfs.Directory) {
            _flatten(value.files, result);
        }
    }
}
