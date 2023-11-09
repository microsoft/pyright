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
import { normalizeSlashes } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { Uri } from '../common/uri';
import {
    deduplicateFolders,
    getWildcardRegexPattern,
    getWildcardRoot,
    isFileSystemCaseSensitiveInternal,
} from '../common/uriUtils';
import * as vfs from './harness/vfs/filesystem';

test('parse', () => {
    assert.throws(() => Uri.parse('\\c:\\foo : bar'));
    assert.throws(() => Uri.parse('foo:////server/b/c')); // No authority component
    assert.ok(Uri.parse('foo:///a/b/c'));
    assert.ok(Uri.parse('foo:a/b/c'));
    assert.ok(Uri.parse('foo:/a/b/c'));
    assert.ok(Uri.parse('foo://server/share/dir/file.py'));
    assert.ok(Uri.parse('foo://server/share/dir/file.py?query#fragment'));
    assert.ok(Uri.parse('foo:///c:/users/me'));
    assert.ok(Uri.parse('foo:///c%3A%52users%52me'));
    assert.ok(Uri.parse(''));
    assert.ok(Uri.parse(undefined));
});

test('key', () => {
    const key = Uri.parse('foo:///a/b/c').key;
    const key2 = Uri.parse('foo:///a/b/c').key;
    assert.equal(key, key2);
    const key3 = Uri.parse('foo:///a/b/d').key;
    assert.notEqual(key, key3);
    const key4 = Uri.file('/a/b/c').key;
    assert.notEqual(key, key4);
    const key5 = Uri.parse('file:///a/b/c').key;
    assert.equal(key4, key5);
    const key6 = Uri.file(normalizeSlashes('c:\\foo\\bar\\d.txt')).key;
    const key7 = Uri.parse('file:///c%3A/foo/bar/d.txt').key;
    const key8 = Uri.parse('file:///c:/foo/bar/d.txt').key;
    assert.equal(key6, key7);
    assert.equal(key6, key8);
});

test('basename', () => {
    const basename = Uri.parse('foo:///a/b/c').basename;
    assert.equal(basename, 'c');
    const basename2 = Uri.parse('foo:///a/b/c/').basename;
    assert.equal(basename2, 'c');
    const basename3 = Uri.parse('foo:///a/b/c.py').basename;
    assert.equal(basename3, 'c.py');
    const basename4 = Uri.parse('foo:///a/b/c.py?query#fragment').basename;
    assert.equal(basename4, 'c.py');
    const basename5 = Uri.file('/a/b/c').basename;
    assert.equal(basename5, 'c');
    const basename6 = Uri.parse('file:///a/b/c').basename;
    assert.equal(basename6, 'c');
});

test('extname', () => {
    const extname = Uri.parse('foo:///a/b/c').extname;
    assert.equal(extname, '');
    const extname2 = Uri.parse('foo:///a/b/c/').extname;
    assert.equal(extname2, '');
    const extname3 = Uri.parse('foo:///a/b/c.py').extname;
    assert.equal(extname3, '.py');
    const extname4 = Uri.parse('foo:///a/b/c.py?query#fragment').extname;
    assert.equal(extname4, '.py');
    const extname5 = Uri.file('/a/b/c.py.foo').extname;
    assert.equal(extname5, '.foo');
    const extname6 = Uri.parse('file:///a/b/c.py.foo').extname;
    assert.equal(extname6, '.foo');
});

test('root', () => {
    const root1 = Uri.parse('foo://authority/a/b/c').root;
    assert.equal(root1.toString(), 'foo://authority/');
    const root = Uri.parse('file://server/b/c').root;
    assert.equal(root.toString(), 'file://server/');
    assert.equal(root.getRootPathLength(), 9);
    const root2 = Uri.parse('foo:///').root;
    assert.equal(root2.toString(), 'foo:///');
    const root3 = Uri.parse('foo:///a/b/c/').root;
    assert.equal(root3.toString(), 'foo:/');
    assert.ok(root3.isDiskPathRoot());
    const root4 = Uri.parse('foo:///a/b/c.py').root;
    assert.equal(root4.toString(), 'foo:/');
    const root5 = Uri.parse('foo:///a/b/c.py?query#fragment').root;
    assert.equal(root5.toString(), 'foo:/');
    const root6 = Uri.file('/a/b/c.py.foo').root;
    assert.equal(root6.toString(), 'file:///');
    const root7 = Uri.parse('file:///a/b/c.py.foo').root;
    assert.equal(root7.toString(), 'file:///');
    assert.equal(root7.getRootPathLength(), 1);
    const root8 = Uri.parse('untitled:Untitled-1').root;
    assert.equal(root8.toString(), 'untitled:');
    assert.equal(root8.getRootPathLength(), 0);
    assert.equal(root8.isDiskPathRoot(), false);
    const root9 = Uri.parse('file://a/b/c/d.py').root;
    assert.equal(root9.toString(), 'file://a/');
    assert.equal(root9.getRootPathLength(), 4);
    assert.ok(root9.isRootDiskPath());
    assert.ok(root9.isDiskPathRoot());
    const root10 = Uri.parse('file://c%3A/b/c/d.py').root;
    assert.equal(root10.toString(), 'file://c:/');
    assert.equal(root10.getRootPathLength(), 5);
    assert.ok(root10.isRootDiskPath());
    assert.ok(root10.isDiskPathRoot());
});

test('empty', () => {
    const empty = Uri.parse('');
    assert.equal(empty.isEmpty(), true);
    const empty2 = Uri.parse('foo:///').isEmpty();
    assert.equal(empty2, false);
    const empty3 = Uri.empty();
    assert.equal(empty3.isEmpty(), true);
    const empty4 = Uri.parse(undefined);
    assert.equal(empty4.isEmpty(), true);
    assert.ok(empty4.equals(empty3));
    assert.ok(empty3.equals(empty));
});

test('file', () => {
    const file1 = Uri.file(normalizeSlashes('/a/b/c')).getFilePath();
    assert.equal(file1, normalizeSlashes('/a/b/c'));
    const file2 = Uri.file('file:///a/b/c').getFilePath();
    assert.equal(file2, normalizeSlashes('/a/b/c'));
});

test('isUri', () => {
    const isUri = Uri.isUri('foo:///a/b/c');
    assert.equal(isUri, false);
    const isUri2 = Uri.isUri('/a/b/c');
    assert.equal(isUri2, false);
    const isUri3 = Uri.isUri(undefined);
    assert.equal(isUri3, false);
    const isUri4 = Uri.isUri(Uri.parse('foo:///a/b/c'));
    assert.equal(isUri4, true);
    const isUri5 = Uri.isUri(Uri.empty());
    assert.equal(isUri5, true);
});

test('matchesRegex', () => {
    const includeFiles = /\.pyi?$/;
    const uri = Uri.parse('file:///a/b/c.pyi');
    assert.ok(uri.matchesRegex(includeFiles));
    const uri2 = Uri.parse('file:///a/b/c.px');
    assert.equal(uri2.matchesRegex(includeFiles), false);
    const uri3 = Uri.parse('vscode-vfs:///a/b/c.pyi');
    assert.ok(uri3.matchesRegex(includeFiles));
});

test('replaceExtension', () => {
    const uri = Uri.parse('file:///a/b/c.pyi');
    const uri2 = uri.replaceExtension('.py');
    assert.equal(uri2.toString(), 'file:///a/b/c.py');
    const uri3 = Uri.parse('file:///a/b/c');
    const uri4 = uri3.replaceExtension('.py');
    assert.equal(uri4.toString(), 'file:///a/b/c.py');
    const uri5 = Uri.parse('file:///a/b/c.foo.py');
    const uri6 = uri5.replaceExtension('.pyi');
    assert.equal(uri6.toString(), 'file:///a/b/c.foo.pyi');
});

test('addExtension', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = uri.addExtension('.py');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi.py');
    const uri3 = Uri.parse('file:///a/b/c');
    const uri4 = uri3.addExtension('.py');
    assert.equal(uri4.toString(), 'file:///a/b/c.py');
});

test('addPath', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = uri.addPath('d');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyid');
});

test('remove', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = uri.remove('c.pyi');
    assert.equal(uri2.toString(), 'file:///a/b/');
});

test('directory', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = uri.getDirectory();
    assert.equal(uri2.toString(), 'file:///a/b');
    const uri3 = uri2.getDirectory();
    assert.equal(uri3.toString(), 'file:///a');
    const uri4 = Uri.parse('file:///a/b/');
    const uri5 = uri4.getDirectory();
    assert.equal(uri5.toString(), 'file:///a');
});

test('slicePath', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const path = uri.slicePath(3);
    assert.equal(path, 'b/c.pyi');
    const path2 = uri.slicePath(0, 3);
    assert.equal(path2, '/a/');
    const pathLength = uri.getPathLength();
    const emptyPath = uri.slicePath(pathLength);
    assert.equal(emptyPath, '');
    const uri2 = Uri.parse('foo:test/me');
    assert.equal(uri2.getPathLength(), 7);
});

test('isChild', () => {
    const parent = Uri.parse('file:///a/b/?query#fragment');
    const child = Uri.parse('file:///a/b/c.pyi?query#fragment');
    assert.ok(child.isChild(parent));
    const parent2 = Uri.parse('file:///a/b');
    const child2 = Uri.parse('file:///a/b/c.pyi');
    assert.ok(child2.isChild(parent2));
    const parent3 = Uri.parse('file:///a/b/');
    const child3 = Uri.parse('file:///a/b/c.pyi');
    assert.ok(child3.isChild(parent3));
    const parent4 = Uri.parse('file:///a/b/');
    const notChild4 = Uri.parse('file:///a/bb/c.pyi');
    assert.ok(!notChild4.isChild(parent4));
    assert.ok(!notChild4.isChild(parent2));
    const notChild5 = Uri.parse('file:///a/b/');
    assert.ok(!notChild5.isChild(parent4));
});

test('equals', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = Uri.file('/a/b/c.pyi');
    assert.ok(!uri1.equals(uri2));
    const uri3 = uri1.stripExtension().addExtension('.pyi');
    assert.ok(uri2.equals(uri3));
    const uri4 = Uri.parse('foo:///a/b/c');
    const uri5 = Uri.parse('foo:///a/b/c');
    const uri6 = Uri.parse('foo:///a/b/c/');
    assert.ok(uri4.equals(uri5));
    assert.ok(uri4.equals(uri6));
    const uri7 = Uri.parse('file://c%3A/b/c/d.py').root;
    const uri8 = Uri.parse('file://c:/');
    assert.ok(uri7.equals(uri8));
});

test('startsWith', () => {
    const parent = Uri.parse('file:///a/b/?query#fragment');
    const child = Uri.parse('file:///a/b/c.pyi?query#fragment');
    assert.ok(child.startsWith(parent));
    const parent2 = Uri.parse('file:///a/b');
    const child2 = Uri.parse('file:///a/b/c.pyi');
    assert.ok(child2.startsWith(parent2));
    const parent3 = Uri.parse('file:///a/b/');
    const child3 = Uri.parse('file:///a/b/c.pyi');
    assert.ok(child3.startsWith(parent3));
    const parent4 = Uri.parse('file:///a/b/');
    const notChild4 = Uri.parse('file:///a/bb/c.pyi');
    assert.ok(!notChild4.startsWith(parent4));
    assert.ok(!notChild4.startsWith(parent2));
});

test('path comparisons', () => {
    const uri = Uri.parse('foo:///a/b/c.pyi?query#fragment');
    assert.ok(uri.pathEndsWith('c.pyi'));
    assert.ok(uri.pathEndsWith('b/c.pyi'));
    assert.ok(uri.pathEndsWith('a/b/c.pyi'));
    assert.ok(!uri.pathEndsWith('a/b/c.py'));
    assert.ok(!uri.pathEndsWith('b/c.py'));
    assert.ok(uri.pathIncludes('c.pyi'));
    assert.ok(uri.pathIncludes('b/c'));
    assert.ok(uri.pathIncludes('a/b/c'));
    const uri2 = Uri.parse('file:///C%3A/a/b/c.pyi?query#fragment');
    assert.ok(uri2.pathEndsWith('c.pyi'));
    assert.ok(uri2.pathEndsWith('b/c.pyi'));
    assert.ok(!uri2.pathStartsWith('C:/a'));
    assert.ok(!uri2.pathStartsWith('C:/a/b'));
    assert.ok(uri2.pathStartsWith('c:/a'));
    assert.ok(uri2.pathStartsWith('c:/a/b'));
});

test('combinePaths', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment');
    const uri2 = uri1.combinePaths('d', 'e');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi/d/e');
    const uri3 = uri1.combinePaths('d', 'e/');
    assert.equal(uri3.toString(), 'file:///a/b/c.pyi/d/e/');
    const uri4 = uri1.combinePaths('d', 'e', 'f/');
    assert.equal(uri4.toString(), 'file:///a/b/c.pyi/d/e/f/');
    const uri5 = uri1.combinePaths('d', '..', 'e');
    assert.equal(uri5.toString(), 'file:///a/b/c.pyi/e');
    const rootedPath = process.platform === 'win32' ? 'D:' : '/D';
    const rootedResult = process.platform === 'win32' ? 'file:///d%3A/e/f' : 'file:///D/e/f';
    const uri6 = uri1.combinePaths(rootedPath, 'e', 'f');
    assert.equal(uri6.toString(), rootedResult);
    const uri7 = Uri.parse('foo:');
    const uri8 = uri7.combinePaths('d', 'e');
    assert.equal(uri8.toString(), 'foo:d/e');
    const uri9 = Uri.parse('foo:/');
    const uri10 = uri9.combinePaths('d', 'e');
    assert.equal(uri10.toString(), 'foo:/d/e');
});

test('getPathComponents1', () => {
    const components = Uri.parse('').getPathComponents();
    assert.equal(components.length, 1);
    assert.equal(components[0], '');
});

test('getPathComponents2', () => {
    const components = Uri.parse('/users/').getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '');
    assert.equal(components[1], 'users');
});

test('getPathComponents3', () => {
    const components = Uri.parse('/users/hello.py').getPathComponents();
    assert.equal(components.length, 3);
    assert.equal(components[0], '');
    assert.equal(components[1], 'users');
    assert.equal(components[2], 'hello.py');
});

test('getPathComponents4', () => {
    const components = Uri.parse('/users/hello/../').getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '');
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
    assert.equal(components.length, 5);
    assert.equal(components[1], 'server');
    assert.equal(components[2], 'share');
    assert.equal(components[3], 'dir');
    assert.equal(components[4], 'file.py');
});

test('getRelativePathComponents1', () => {
    const components = Uri.parse('foo:///users/').getRelativePathComponents(Uri.parse('foo:///users/'));
    assert.equal(components.length, 0);
});

test('getRelativePathComponents2', () => {
    const components = Uri.parse('foo:///users/').getRelativePathComponents(Uri.parse('foo:///users/bar'));
    assert.equal(components.length, 1);
    assert.equal(components[0], 'bar');
});

test('getRelativePathComponents3', () => {
    const components = Uri.parse('bar:///users/').getRelativePathComponents(Uri.parse('foo:///users/bar'));
    assert.equal(components.length, 0);
});

test('getRelativePathComponents4', () => {
    const components = Uri.parse('foo:///users').getRelativePathComponents(Uri.parse('foo:///users/'));
    assert.equal(components.length, 0);
});

test('getRelativePathComponents5', () => {
    const components = Uri.parse('foo:///users/').getRelativePathComponents(Uri.parse('foo:///users/bar/baz/../foo'));
    assert.equal(components.length, 2);
    assert.equal(components[0], 'bar');
    assert.equal(components[1], 'foo');
});

test('getFileExtension1', () => {
    const ext = Uri.parse('foo://blah.blah/hello.JsOn').extname;
    assert.equal(ext, '.JsOn');
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

function resolvePaths(uri: string, ...paths: string[]) {
    return Uri.parse(uri)
        .combinePaths(...paths)
        .toString();
}

test('resolvePath1', () => {
    assert.equal(resolvePaths('/path', 'to', 'file.ext'), '/path/to/file.ext');
});

test('resolvePath2', () => {
    assert.equal(resolvePaths('/path', 'to', '..', 'from', 'file.ext/'), '/path/from/file.ext/');
});

test('resolvePath3 ~ escape', () => {
    const homedir = os.homedir();
    assert.equal(
        resolvePaths(expandPathVariables(Uri.empty(), '~/path'), 'to', '..', 'from', 'file.ext/'),
        `${homedir}/path/from/file.ext/`
    );
});

test('resolvePath4 ~ escape in middle', () => {
    const homedir = os.homedir();
    assert.equal(resolvePaths('/path', expandPathVariables(Uri.empty(), '~/file.ext/')), `${homedir}/file.ext/`);
});

function combinePaths(uri: string, ...paths: string[]) {
    return resolvePaths(uri, ...paths);
}

test('invalid ~ without root', () => {
    const path = combinePaths('Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables(Uri.parse('foo:///src'), path)), path);
});

test('invalid ~ with root', () => {
    const path = combinePaths('/', 'Library', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables(Uri.parse('foo:///src'), path)), path);
});

function containsPath(uri: string, child: string) {
    return Uri.parse(child).isChild(Uri.parse(uri));
}

test('containsPath1', () => {
    assert.equal(containsPath('/a/b/c/', '/a/d/../b/c/./d'), true);
});

test('containsPath2', () => {
    assert.equal(containsPath('/', '\\a'), true);
});

test('containsPath3', () => {
    assert.equal(containsPath('/a', '/A/B'), true);
});

function getAnyExtensionFromPath(uri: string): string {
    return Uri.parse(uri).extname;
}
test('getAnyExtension1', () => {
    assert.equal(getAnyExtensionFromPath('/path/to/file.ext'), '.ext');
});

function getBaseFileName(uri: string): string {
    return Uri.parse(uri).basename;
}

test('getBaseFileName1', () => {
    assert.equal(getBaseFileName('/path/to/file.ext'), 'file.ext');
});

test('getBaseFileName2', () => {
    assert.equal(getBaseFileName('/path/to/'), 'to');
});

test('getBaseFileName3', () => {
    assert.equal(getBaseFileName('c:/'), '');
});

function getUriRootLength(uri: string): number {
    return Uri.parse(uri).getRootPathLength();
}

test('getRootLength1', () => {
    assert.equal(getUriRootLength('a'), 0);
});

test('getRootLength2', () => {
    assert.equal(getUriRootLength('/'), 1);
});

test('getRootLength3', () => {
    assert.equal(getUriRootLength('c:'), 2);
});

test('getRootLength4', () => {
    assert.equal(getUriRootLength('c:d'), 0);
});

test('getRootLength5', () => {
    assert.equal(getUriRootLength('c:/'), 3);
});

test('getRootLength6', () => {
    assert.equal(getUriRootLength('//server'), 8);
});

test('getRootLength7', () => {
    assert.equal(getUriRootLength('//server/share'), 9);
});

test('getRootLength8', () => {
    assert.equal(getUriRootLength('scheme:/no/authority'), 8);
});

test('getRootLength9', () => {
    assert.equal(getUriRootLength('scheme://with/authority'), 9);
});

function isRootedDiskPath(uri: string) {
    return Uri.parse(uri).isRootDiskPath();
}

test('isRootedDiskPath1', () => {
    assert(isRootedDiskPath('C:/a/b'));
});

test('isRootedDiskPath2', () => {
    assert(isRootedDiskPath('/'));
});

test('isRootedDiskPath3', () => {
    assert(!isRootedDiskPath('a/b'));
});

test('isDiskPathRoot1', () => {
    assert(isRootedDiskPath('/'));
});

test('isDiskPathRoot2', () => {
    assert(isRootedDiskPath('c:/'));
});

test('isDiskPathRoot3', () => {
    assert(isRootedDiskPath('c:'));
});

test('isDiskPathRoot4', () => {
    assert(!isRootedDiskPath('c:d'));
});

function getRelativePath(uri: string, relativeTo: string) {
    return Uri.parse(uri).getRelativePath(Uri.parse(relativeTo));
}

test('getRelativePath', () => {
    assert.equal(getRelativePath('/a/b/c/d/e/f', '/a/b/c'), './d/e/f');
});

test('CaseSensitivity', () => {
    const cwd = '/';

    const fsCaseInsensitive = new vfs.TestFileSystem(/*ignoreCase*/ true, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseInsensitive, fsCaseInsensitive), false);

    const fsCaseSensitive = new vfs.TestFileSystem(/*ignoreCase*/ false, { cwd });
    assert.equal(isFileSystemCaseSensitiveInternal(fsCaseSensitive, fsCaseSensitive), true);
});

test('deduplicateFolders', () => {
    const listOfFolders = [
        ['/user', '/user/temp', '/xuser/app', '/lib/python', '/home/p/.venv/lib/site-packages'].map((p) => Uri.file(p)),
        ['/user', '/user/temp', '/xuser/app', '/lib/python/Python310.zip', '/home/z/.venv/lib/site-packages'].map((p) =>
            Uri.file(p)
        ),
        ['/main/python/lib/site-packages', '/home/p'].map((p) => Uri.file(p)),
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
    const path = Uri.file('file:///server/c$/folder/file.py');

    // When converting UNC path, server part shouldn't be removed.
    assert(path.getPath().indexOf('server') > 0);
});

function lowerCaseDrive(entries: string[]) {
    return entries.map((p) => (process.platform === 'win32' ? p[0].toLowerCase() + p.slice(1) : p));
}

test('Realcase', () => {
    const fs = createFromRealFileSystem();
    const cwd = process.cwd();
    const dir = Uri.file(path.join(cwd, 'src', 'tests', '..', 'tests'));
    const entries = nodefs
        .readdirSync(dir.getFilePath())
        .map((entry) => path.basename(nodefs.realpathSync(path.join(dir.getFilePath(), entry))));
    const normalizedEntries = lowerCaseDrive(entries);
    const fsentries = fs.readdirSync(dir);
    assert.deepStrictEqual(normalizedEntries, fsentries);

    const paths = entries.map((entry) => nodefs.realpathSync(path.join(dir.getFilePath(), entry)));
    const fspaths = fsentries.map((entry) => fs.realCasePath(dir.combinePaths(entry)));
    assert.deepStrictEqual(lowerCaseDrive(paths), fspaths);

    // Check that the '..' has been removed.
    assert.ok(!fspaths.some((p) => p.toString().indexOf('..') >= 0));

    // If windows, check that the case is correct.
    if (process.platform === 'win32') {
        for (const p of fspaths) {
            const upper = Uri.file(p.toString().toUpperCase());
            const real = fs.realCasePath(upper);
            assert.strictEqual(p, real);
        }
    }
});

test('Realcase use cwd implicitly', () => {
    const fs = createFromRealFileSystem();
    const cwd = process.cwd();
    const dir = path.join(cwd, 'src', 'tests');
    const uri = Uri.file(dir);

    const entries = nodefs.readdirSync(dir).map((entry) => path.basename(nodefs.realpathSync(path.join(dir, entry))));
    const fsentries = fs.readdirSync(uri);
    const paths = entries.map((entry) => nodefs.realpathSync(path.join(dir, entry)));

    const fspaths = fsentries.map((entry) => fs.realCasePath(uri.combinePaths(entry)).getFilePath());
    assert.deepStrictEqual(lowerCaseDrive(paths), fspaths);
});
