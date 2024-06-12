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

import {
    combinePathComponents,
    combinePaths,
    containsPath,
    ensureTrailingDirectorySeparator,
    getAnyExtensionFromPath,
    getBaseFileName,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRelativePath,
    getRootLength,
    getWildcardRegexPattern,
    getWildcardRoot,
    hasTrailingDirectorySeparator,
    isDirectoryWildcardPatternPresent,
    isRootedDiskPath,
    normalizeSlashes,
    reducePathComponents,
    resolvePaths,
    stripFileExtension,
    stripTrailingDirectorySeparator,
} from '../common/pathUtils';

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

test('getPathComponents6', () => {
    const components = getPathComponents(fixSeparators('//server/share/dir/file.py'));
    assert.equal(components.length, 4);
    assert.equal(components[0], fixSeparators('//server/'));
    assert.equal(components[1], 'share');
    assert.equal(components[2], 'dir');
    assert.equal(components[3], 'file.py');
});

test('getPathComponents7', () => {
    const components = getPathComponents('ab:cdef/test');
    assert.equal(components.length, 3);
    assert.equal(components[0], '');
    assert.equal(components[1], 'ab:cdef');
    assert.equal(components[2], 'test');
});

test('combinePaths1', () => {
    const p = combinePaths('/user', '1', '2', '3');
    assert.equal(p, normalizeSlashes('/user/1/2/3'));
});

test('combinePaths2', () => {
    const p = combinePaths('/foo', 'ab:c');
    assert.equal(p, normalizeSlashes('/foo/ab:c'));
});

test('combinePaths3', () => {
    const p = combinePaths('untitled:foo', 'ab:c');
    assert.equal(p, normalizeSlashes('untitled:foo/ab:c'));
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

function fixSeparators(linuxPath: string) {
    if (path.sep === '\\') {
        return linuxPath.replace(/\//g, path.sep);
    }
    return linuxPath;
}

test('getWildcardRegexPattern1', () => {
    const pattern = getWildcardRegexPattern('/users/me', './blah/');
    const regex = new RegExp(pattern);
    assert.ok(regex.test(fixSeparators('/users/me/blah/d')));
    assert.ok(!regex.test(fixSeparators('/users/me/blad/d')));
});

test('getWildcardRegexPattern2', () => {
    const pattern = getWildcardRegexPattern('/users/me', './**/*.py?');
    const regex = new RegExp(pattern);
    assert.ok(regex.test(fixSeparators('/users/me/.blah/foo.pyd')));
    assert.ok(!regex.test(fixSeparators('/users/me/.blah/foo.py'))); // No char after
});

test('getWildcardRegexPattern3', () => {
    const pattern = getWildcardRegexPattern('/users/me', './**/.*.py');
    const regex = new RegExp(pattern);
    assert.ok(regex.test(fixSeparators('/users/me/.blah/.foo.py')));
    assert.ok(!regex.test(fixSeparators('/users/me/.blah/foo.py')));
});

test('getWildcardRegexPattern4', () => {
    const pattern = getWildcardRegexPattern('//server/share/dir', '.');
    const regex = new RegExp(pattern);
    assert.ok(regex.test(fixSeparators('//server/share/dir/foo.py')));
    assert.ok(!regex.test(fixSeparators('//server/share/dix/foo.py')));
});

test('getWildcardRegexPattern5', () => {
    const pattern = getWildcardRegexPattern('//server/share/dir++', '.');
    const regex = new RegExp(pattern);
    assert.ok(regex.test(fixSeparators('//server/share/dir++/foo.py')));
    assert.ok(!regex.test(fixSeparators('//server/share/dix++/foo.py')));
});

test('isDirectoryWildcardPatternPresent1', () => {
    const isPresent = isDirectoryWildcardPatternPresent('./**/*.py');
    assert.equal(isPresent, true);
});

test('isDirectoryWildcardPatternPresent2', () => {
    const isPresent = isDirectoryWildcardPatternPresent('./**/a/*.py');
    assert.equal(isPresent, true);
});

test('isDirectoryWildcardPatternPresent3', () => {
    const isPresent = isDirectoryWildcardPatternPresent('./**/@tests');
    assert.equal(isPresent, true);
});

test('isDirectoryWildcardPatternPresent4', () => {
    const isPresent = isDirectoryWildcardPatternPresent('./**/test/test*');
    assert.equal(isPresent, true);
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

test('containsPath1', () => {
    assert.equal(containsPath('/a/b/c/', '/a/d/../b/c/./d'), true);
});

test('containsPath2', () => {
    assert.equal(containsPath('/', '\\a'), true);
});

test('containsPath3', () => {
    assert.equal(containsPath('/a', '/A/B', true), true);
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

test('getRootLength1', () => {
    assert.equal(getRootLength('a'), 0);
});

test('getRootLength2', () => {
    assert.equal(getRootLength(fixSeparators('/')), 1);
});

test('getRootLength3', () => {
    assert.equal(getRootLength('c:'), 2);
});

test('getRootLength4', () => {
    assert.equal(getRootLength('c:d'), 0);
});

test('getRootLength5', () => {
    assert.equal(getRootLength(fixSeparators('c:/')), 3);
});

test('getRootLength6', () => {
    assert.equal(getRootLength(fixSeparators('//server')), 8);
});

test('getRootLength7', () => {
    assert.equal(getRootLength(fixSeparators('//server/share')), 9);
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
    assert(isRootedDiskPath(normalizeSlashes('c:')));
});

test('isDiskPathRoot4', () => {
    assert(!isRootedDiskPath(normalizeSlashes('c:d')));
});

test('getRelativePath', () => {
    assert.equal(
        getRelativePath(normalizeSlashes('/a/b/c/d/e/f'), normalizeSlashes('/a/b/c')),
        normalizeSlashes('./d/e/f')
    );
});
