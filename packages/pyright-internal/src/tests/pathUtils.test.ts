/*
 * pathUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pathUtils module.
 */

import assert from 'assert';
import * as nodefs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

import { expandPathVariables } from '../common/envVarUtils';
import {
    changeAnyExtension,
    combinePathComponents,
    combinePaths,
    containsPath,
    convertUriToPath,
    deduplicateFolders,
    ensureTrailingDirectorySeparator,
    getAnyExtensionFromPath,
    getBaseFileName,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRelativePath,
    getRelativePathFromDirectory,
    getRootLength,
    getWildcardRegexPattern,
    getWildcardRoot,
    hasTrailingDirectorySeparator,
    isDirectoryWildcardPatternPresent,
    isFileSystemCaseSensitiveInternal,
    isRootedDiskPath,
    isUri,
    normalizeSlashes,
    realCasePath,
    reducePathComponents,
    resolvePaths,
    stripFileExtension,
    stripTrailingDirectorySeparator,
} from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
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
    assert.equal(components[0], 'ab:');
    assert.equal(components[1], 'cdef');
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
    assert.equal(p, normalizeSlashes('untitled:foo/ab%3Ac'));
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

test('resolvePath3 ~ escape', () => {
    const homedir = os.homedir();
    assert.equal(
        resolvePaths(expandPathVariables('', '~/path'), 'to', '..', 'from', 'file.ext/'),
        normalizeSlashes(`${homedir}/path/from/file.ext/`)
    );
});

test('resolvePath4 ~ escape in middle', () => {
    const homedir = os.homedir();
    assert.equal(
        resolvePaths('/path', expandPathVariables('', '~/file.ext/')),
        normalizeSlashes(`${homedir}/file.ext/`)
    );
});

test('invalid ~ without root', () => {
    const path = combinePaths('Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables('/src', path)), path);
});

test('invalid ~ with root', () => {
    const path = combinePaths('/', 'Library', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables('/src', path)), path);
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

test('getRootLength8', () => {
    assert.equal(getRootLength('scheme:/no/authority'), 7);
});

test('getRootLength9', () => {
    assert.equal(getRootLength('scheme://with/authority'), 9);
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

test('getDirectoryPath', () => {
    assert.equal(getDirectoryPath(normalizeSlashes('/a/b/c/d/e/f')), normalizeSlashes('/a/b/c/d/e'));
    assert.equal(
        getDirectoryPath(normalizeSlashes('untitled:/a/b/c/d/e/f?query#frag')),
        normalizeSlashes('untitled:/a/b/c/d/e')
    );
});

test('isUri', () => {
    assert.ok(isUri('untitled:/a/b/c/d/e/f?query#frag'));
    assert.ok(isUri('untitled:/a/b/c/d/e/f'));
    assert.ok(isUri('untitled:a/b/c/d/e/f'));
    assert.ok(isUri('untitled:/a/b/c/d/e/f?query'));
    assert.ok(isUri('untitled:/a/b/c/d/e/f#frag'));
    assert.ok(!isUri('c:/foo/bar'));
    assert.ok(!isUri('c:/foo#/bar'));
    assert.ok(!isUri('222/dd:/foo/bar'));
});
test('CaseSensitivity', () => {
    const cwd = normalizeSlashes('/');

    const fsCaseInsensitive = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseInsensitive, fsCaseInsensitive), false);

    const fsCaseSensitive = new vfs.TestFileSystem(/*ignoreCase*/ false, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseSensitive, fsCaseSensitive), true);
});

test('deduplicateFolders', () => {
    const listOfFolders = [
        ['/user', '/user/temp', '/xuser/app', '/lib/python', '/home/p/.venv/lib/site-packages'],
        ['/user', '/user/temp', '/xuser/app', '/lib/python/Python310.zip', '/home/z/.venv/lib/site-packages'],
        ['/main/python/lib/site-packages', '/home/p'],
    ];

    const folders = deduplicateFolders(listOfFolders);

    const expected = [
        '/user',
        '/xuser/app',
        '/lib/python',
        '/home/z/.venv/lib/site-packages',
        '/main/python/lib/site-packages',
        '/home/p',
    ];

    assert.deepStrictEqual(folders.sort(), expected.sort());
});

test('convert UNC path', () => {
    const cwd = normalizeSlashes('/');
    const fs = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });

    const path = convertUriToPath(fs, 'file://server/c$/folder/file.py');

    // When converting UNC path, server part shouldn't be removed.
    assert(path.indexOf('server') > 0);
});

test('Realcase', () => {
    const fs = createFromRealFileSystem();
    const cwd = process.cwd();
    const dir = path.join(cwd, 'src', 'tests', '..', 'tests');
    const entries = nodefs.readdirSync(dir).map((entry) => path.basename(nodefs.realpathSync(path.join(dir, entry))));
    const fsentries = fs.readdirSync(dir);
    assert.deepStrictEqual(entries, fsentries);

    const paths = entries.map((entry) => nodefs.realpathSync(path.join(dir, entry)));
    const fspaths = fsentries.map((entry) => fs.realCasePath(path.join(dir, entry)));
    assert.deepStrictEqual(paths, fspaths);

    // Check that the '..' has been removed.
    assert.ok(!fspaths.some((p) => p.indexOf('..') >= 0));

    // If windows, check that the case is correct.
    if (process.platform === 'win32') {
        for (const p of fspaths) {
            const upper = p.toUpperCase();
            const real = fs.realCasePath(upper);
            assert.strictEqual(p, real);
        }
    }
});

test('Realcase use cwd implicitly', () => {
    const fs = createFromRealFileSystem();
    const empty = realCasePath('', fs);
    assert.deepStrictEqual(empty, '');
    const cwd = process.cwd();
    const dir = path.join(cwd, 'src', 'tests');

    const entries = nodefs.readdirSync(dir).map((entry) => path.basename(nodefs.realpathSync(path.join(dir, entry))));
    const fsentries = fs.readdirSync(path.join('src', 'tests'));
    const paths = entries.map((entry) => nodefs.realpathSync(path.join(dir, entry)));
    const fspaths = fsentries.map((entry) => fs.realCasePath(path.join(dir, entry)));
    assert.deepStrictEqual(paths, fspaths);
});

test('Realcase drive letter', () => {
    const fs = createFromRealFileSystem();

    const cwd = process.cwd();

    assert.strictEqual(
        getDriveLetter(fs.realCasePath(cwd)),
        getDriveLetter(fs.realCasePath(combinePaths(cwd.toLowerCase(), 'notExist.txt')))
    );

    function getDriveLetter(path: string) {
        const driveLetter = getRootLength(path);
        if (driveLetter === 0) {
            return '';
        }

        return path.substring(0, driveLetter);
    }
});
