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
import { createFromRealFileSystem } from '../common/realFileSystem';
import { Uri } from '../common/uri';
import { getWildcardRegexPattern, getWildcardRoot } from '../common/uriUtils';
import * as vfs from './harness/vfs/filesystem';

test('getPathComponents1', () => {
    const components = Uri.parse('').getPathComponents();
    assert.equal(components.length, 1);
    assert.equal(components[0], '');
});

test('getPathComponents2', () => {
    const components = Uri.parse('/users/').getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
});

test('getPathComponents3', () => {
    const components = Uri.parse('/users/hello.py').getPathComponents();
    assert.equal(components.length, 3);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
    assert.equal(components[2], 'hello.py');
});

test('getPathComponents4', () => {
    const components = Uri.parse('/users/hello/../').getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], path.sep);
    assert.equal(components[1], 'users');
});

test('getPathComponents5', () => {
    const components = Uri.parse('./hello.py').getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '');
    assert.equal(components[1], 'hello.py');
});

test('getPathComponents6', () => {
    const components = Uri.parse('foo:///server/share/dir/file.py').getPathComponents();
    assert.equal(components.length, 4);
    assert.equal(components[0], '//server/');
    assert.equal(components[1], 'share');
    assert.equal(components[2], 'dir');
    assert.equal(components[3], 'file.py');
});

test('combinePaths1', () => {
    const p = Uri.parse('foo:///user').combinePaths('1', '2', '3');
    assert.equal(p.toString(), 'foo:///user/1/2/3');
});

test('getFileExtension1', () => {
    const ext = Uri.parse('foo://blah.blah/hello.JsOn').extname;
    assert.equal(ext, '.JsOn');
});

test('getFileExtension2', () => {
    const ext1 = Uri.parse('foo://blah.blah/hello.cpython-32m.so').getAllExtensions();
    assert.equal(ext1, '.cpython-32m.so');
    const ext2 = Uri.parse('foo://blah.blah/hello.cpython-32m.so').extname;
    assert.equal(ext2, '.so');
    const ext3 = Uri.parse('foo://blah.blah/hello.cpython-32m.so?query#fragment').getAllExtensions();
    assert.equal(ext3, '.cpython-32m.so');
});

test('getFileName1', () => {
    const fileName = Uri.parse('foo://blah.blah/HeLLo.JsOn').basename;
    assert.equal(fileName, 'HeLLo.JsOn');
});

test('getFileName2', () => {
    const fileName1 = Uri.parse('foo://blah.blah/hello.cpython-32m.so').basename;
    assert.equal(fileName1, 'hello.cpython-32m.so');
});

test('stripFileExtension1', () => {
    const path = Uri.parse('foo://blah.blah/HeLLo.JsOn').stripExtension().getPath();
    assert.equal(path, 'blah.blah/HeLLo');
});

test('stripFileExtension2', () => {
    const path1 = Uri.parse('blah.blah/hello.cpython-32m.so').stripAllExtensions().getPath();
    assert.equal(path1, 'blah.blah/hello');
    const path2 = Uri.parse('blah.blah/hello.cpython-32m.so').stripExtension().getPath();
    assert.equal(path2, 'blah.blah/hello.cpython-32m');
});

test('getWildcardRegexPattern1', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me'), './blah/');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/blah/d'));
    assert.ok(!regex.test('/users/me/blad/d'));
});

test('getWildcardRegexPattern2', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me'), './**/*.py?');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/.blah/foo.pyd'));
    assert.ok(!regex.test('/users/me/.blah/foo.py')); // No char after
});

test('getWildcardRegexPattern3', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me'), './**/.*.py');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/.blah/.foo.py'));
    assert.ok(!regex.test('/users/me/.blah/foo.py'));
});

test('getWildcardRegexPattern4', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('//server/share/dir'), '.');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('//server/share/dir/foo.py'));
    assert.ok(!regex.test('//server/share/dix/foo.py'));
});

test('getWildcardRoot1', () => {
    const p = getWildcardRoot(Uri.parse('foo:///users/me'), './blah/');
    assert.equal(p.toString(), '/users/me/blah');
});

test('getWildcardRoot2', () => {
    const p = getWildcardRoot(Uri.parse('foo:///users/me'), './**/*.py?/');
    assert.equal(p.toString(), '/users/me');
});

test('getWildcardRoot with root', () => {
    const p = getWildcardRoot(Uri.parse('foo:///'), '.');
    assert.equal(p.toString(), '/');
});

test('getWildcardRoot with drive letter', () => {
    const p = getWildcardRoot(Uri.parse('file:///c:/'), '.');
    assert.equal(p.toString(), 'c:');
});

test('reducePathComponentsEmpty', () => {
    assert.equal(reducePathComponents([]).length, 0);
});

test('reducePathComponents', () => {
    assert.deepEqual(reducePathComponents(Uri.parse('/a/b/../c/.')), [path.sep, 'a', 'c']).getPathComponents();
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
    assert.equal(getRootLength('/')), 1;
});

test('getRootLength3', () => {
    assert.equal(getRootLength('c:'), 2);
});

test('getRootLength4', () => {
    assert.equal(getRootLength('c:d'), 0);
});

test('getRootLength5', () => {
    assert.equal(getRootLength('c:/')), 3;
});

test('getRootLength6', () => {
    assert.equal(getRootLength('//server')), 8;
});

test('getRootLength7', () => {
    assert.equal(getRootLength('//server/share')), 9;
});

test('getRootLength8', () => {
    assert.equal(getRootLength('scheme:/no/authority'), 8);
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
