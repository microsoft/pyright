/*
 * pathUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pathUtils module.
 */

import assert from 'assert';
import * as path from 'path';

import { Comparison } from '../common/core';
import {
    changeAnyExtension,
    combinePathComponents,
    combinePaths,
    comparePaths,
    comparePathsCaseInsensitive,
    comparePathsCaseSensitive,
    containsPath,
    ensureTrailingDirectorySeparator,
    getAnyExtensionFromPath,
    getBaseFileName,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRegexEscapedSeparator,
    getRelativePath,
    getRelativePathFromDirectory,
    getWildcardRegexPattern,
    getWildcardRoot,
    hasTrailingDirectorySeparator,
    isFileSystemCaseSensitiveInternal,
    isRootedDiskPath,
    normalizeSlashes,
    reducePathComponents,
    resolvePaths,
    stripFileExtension,
    stripTrailingDirectorySeparator,
} from '../common/pathUtils';
import * as vfs from './harness/vfs/filesystem';

test('getPathComponents1', () => {
    const components = getPathComponents('');
    assert.equal(components.length, 1);
    assert.equal(components[0], '');
});

test('getPathComponents2', () => {
    const components = getPathComponents('/users/');
    assert.equal(components.length, 2);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
});

test('getPathComponents3', () => {
    const components = getPathComponents('/users/hello.py');
    assert.equal(components.length, 3);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
    assert.equal(components[2], 'hello.py');
});

test('getPathComponents4', () => {
    const components = getPathComponents('/users/hello/../');
    assert.equal(components.length, 2);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
});

test('getPathComponents5', () => {
    const components = getPathComponents('./hello.py');
    assert.equal(components.length, 2);
    assert.equal(components[0], '');
    assert.equal(components[1], 'hello.py');
});

test('combinePaths1', () => {
    const p = combinePaths('/user', '1', '2', '3');
    assert.equal(p, normalizeSlashes('/user/1/2/3'));
});

test('ensureTrailingDirectorySeparator1', () => {
    const p = ensureTrailingDirectorySeparator('hello');
    assert.equal(p, normalizeSlashes('hello/'));
});

test('hasTrailingDirectorySeparator1', () => {
    assert(!hasTrailingDirectorySeparator('hello'));
    assert(hasTrailingDirectorySeparator('hello/'));
    assert(hasTrailingDirectorySeparator('hello\\'));
});

test('stripTrailingDirectorySeparator1', () => {
    const path = stripTrailingDirectorySeparator('hello/');
    assert.equal(path, 'hello');
});

test('getFileExtension1', () => {
    const ext = getFileExtension('blah.blah/hello.JsOn');
    assert.equal(ext, '.JsOn');
});

test('getFileExtension2', () => {
    const ext1 = getFileExtension('blah.blah/hello.cpython-32m.so', true);
    assert.equal(ext1, '.cpython-32m.so');
    const ext2 = getFileExtension('blah.blah/hello.cpython-32m.so', false);
    assert.equal(ext2, '.so');
});

test('getFileName1', () => {
    const fileName = getFileName('blah.blah/HeLLo.JsOn');
    assert.equal(fileName, 'HeLLo.JsOn');
});

test('getFileName2', () => {
    const fileName1 = getFileName('blah.blah/hello.cpython-32m.so');
    assert.equal(fileName1, 'hello.cpython-32m.so');
});

test('stripFileExtension1', () => {
    const path = stripFileExtension('blah.blah/HeLLo.JsOn');
    assert.equal(path, 'blah.blah/HeLLo');
});

test('stripFileExtension2', () => {
    const path1 = stripFileExtension('blah.blah/hello.cpython-32m.so', true);
    assert.equal(path1, 'blah.blah/hello');
    const path2 = stripFileExtension('blah.blah/hello.cpython-32m.so', false);
    assert.equal(path2, 'blah.blah/hello.cpython-32m');
});

test('getWildcardRegexPattern1', () => {
    const pattern = getWildcardRegexPattern('/users/me', './blah/');
    const sep = getRegexEscapedSeparator();
    assert.equal(pattern, `${sep}users${sep}me${sep}blah`);
});

test('getWildcardRegexPattern2', () => {
    const pattern = getWildcardRegexPattern('/users/me', './**/*.py?/');
    const sep = getRegexEscapedSeparator();
    assert.equal(pattern, `${sep}users${sep}me(${sep}[^${sep}.][^${sep}]*)*?${sep}[^${sep}]*\\.py[^${sep}]`);
});

test('getWildcardRoot1', () => {
    const p = getWildcardRoot('/users/me', './blah/');
    assert.equal(p, normalizeSlashes('/users/me/blah'));
});

test('getWildcardRoot2', () => {
    const p = getWildcardRoot('/users/me', './**/*.py?/');
    assert.equal(p, normalizeSlashes('/users/me'));
});

test('getWildcardRoot with root', () => {
    const p = getWildcardRoot('/', '.');
    assert.equal(p, normalizeSlashes('/'));
});

test('getWildcardRoot with drive letter', () => {
    const p = getWildcardRoot('c:/', '.');
    assert.equal(p, normalizeSlashes('c:'));
});

test('reducePathComponentsEmpty', () => {
    assert.equal(reducePathComponents([]).length, 0);
});

test('reducePathComponents', () => {
    assert.deepEqual(reducePathComponents(getPathComponents('/a/b/../c/.')), [path.sep, 'a', 'c']);
});

test('combinePathComponentsEmpty', () => {
    assert.equal(combinePathComponents([]), '');
});

test('combinePathComponentsAbsolute', () => {
    assert.equal(combinePathComponents(['/', 'a', 'b']), normalizeSlashes('/a/b'));
});

test('combinePathComponents', () => {
    assert.equal(combinePathComponents(['a', 'b']), normalizeSlashes('a/b'));
});

test('resolvePath1', () => {
    assert.equal(resolvePaths('/path', 'to', 'file.ext'), normalizeSlashes('/path/to/file.ext'));
});

test('resolvePath2', () => {
    assert.equal(resolvePaths('/path', 'to', '..', 'from', 'file.ext/'), normalizeSlashes('/path/from/file.ext/'));
});

test('comparePaths1', () => {
    assert.equal(comparePaths('/A/B/C', '\\a\\b\\c'), Comparison.LessThan);
});

test('comparePaths2', () => {
    assert.equal(comparePaths('/A/B/C', '\\a\\b\\c', true), Comparison.EqualTo);
});

test('comparePaths3', () => {
    assert.equal(comparePaths('/A/B/C', '/a/c/../b/./c', true), Comparison.EqualTo);
});

test('comparePaths4', () => {
    assert.equal(comparePaths('/a/b/c', '/a/c/../b/./c', 'current\\path\\', false), Comparison.EqualTo);
});

test('comparePaths5', () => {
    assert.equal(comparePaths('/a/b/c/', '/a/b/c'), Comparison.EqualTo);
});

test('containsPath1', () => {
    assert.equal(containsPath('/a/b/c/', '/a/d/../b/c/./d'), true);
});

test('containsPath2', () => {
    assert.equal(containsPath('/', '\\a'), true);
});

test('containsPath3', () => {
    assert.equal(containsPath('/a', '/A/B', true), true);
});

test('changeAnyExtension1', () => {
    assert.equal(changeAnyExtension('/path/to/file.ext', '.js', ['.ext', '.ts'], true), '/path/to/file.js');
});

test('changeAnyExtension2', () => {
    assert.equal(changeAnyExtension('/path/to/file.ext', '.js'), '/path/to/file.js');
});

test('changeAnyExtension3', () => {
    assert.equal(changeAnyExtension('/path/to/file.ext', '.js', '.ts', false), '/path/to/file.ext');
});

test('changeAnyExtension1', () => {
    assert.equal(getAnyExtensionFromPath('/path/to/file.ext'), '.ext');
});

test('changeAnyExtension2', () => {
    assert.equal(getAnyExtensionFromPath('/path/to/file.ext', '.ts', true), '');
});

test('changeAnyExtension3', () => {
    assert.equal(getAnyExtensionFromPath('/path/to/file.ext', ['.ext', '.ts'], true), '.ext');
});

test('getBaseFileName1', () => {
    assert.equal(getBaseFileName('/path/to/file.ext'), 'file.ext');
});

test('getBaseFileName2', () => {
    assert.equal(getBaseFileName('/path/to/'), 'to');
});

test('getBaseFileName3', () => {
    assert.equal(getBaseFileName('c:/'), '');
});

test('getBaseFileName4', () => {
    assert.equal(getBaseFileName('/path/to/file.ext', ['.ext'], true), 'file');
});

test('getRelativePathFromDirectory1', () => {
    assert.equal(getRelativePathFromDirectory('/a', '/a/b/c/d', true), normalizeSlashes('b/c/d'));
});

test('getRelativePathFromDirectory2', () => {
    assert.equal(getRelativePathFromDirectory('/a', '/b/c/d', true), normalizeSlashes('../b/c/d'));
});

test('comparePathsCaseSensitive', () => {
    assert.equal(comparePathsCaseSensitive('/a/b/C', '/a/b/c'), Comparison.LessThan);
});

test('comparePathsCaseInsensitive', () => {
    assert.equal(comparePathsCaseInsensitive('/a/b/C', '/a/b/c'), Comparison.EqualTo);
});

test('isRootedDiskPath1', () => {
    assert(isRootedDiskPath(normalizeSlashes('C:/a/b')));
});

test('isRootedDiskPath2', () => {
    assert(isRootedDiskPath(normalizeSlashes('/')));
});

test('isRootedDiskPath3', () => {
    assert(!isRootedDiskPath(normalizeSlashes('a/b')));
});

test('isDiskPathRoot1', () => {
    assert(isRootedDiskPath(normalizeSlashes('/')));
});

test('isDiskPathRoot2', () => {
    assert(isRootedDiskPath(normalizeSlashes('c:/')));
});

test('isDiskPathRoot3', () => {
    assert(!isRootedDiskPath(normalizeSlashes('c:')));
});

test('getRelativePath', () => {
    assert.equal(
        getRelativePath(normalizeSlashes('/a/b/c/d/e/f'), normalizeSlashes('/a/b/c')),
        normalizeSlashes('./d/e/f')
    );
});

test('CaseSensitivity', () => {
    const cwd = normalizeSlashes('/');

    const fsCaseInsensitive = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseInsensitive), false);

    const fsCaseSensitive = new vfs.TestFileSystem(/*ignoreCase*/ false, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseSensitive), true);
});
