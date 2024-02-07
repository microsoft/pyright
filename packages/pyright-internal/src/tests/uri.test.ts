/*
 * uri.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for Uris.
 */

import assert from 'assert';
import * as nodefs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

import { expandPathVariables } from '../common/envVarUtils';
import { isRootedDiskPath, normalizeSlashes } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { Uri } from '../common/uri/uri';
import {
    deduplicateFolders,
    getWildcardRegexPattern,
    getWildcardRoot,
    isFileSystemCaseSensitiveInternal,
} from '../common/uri/uriUtils';
import * as vfs from './harness/vfs/filesystem';

test('parse', () => {
    assert.throws(() => Uri.parse('\\c:\\foo : bar', true));
    assert.throws(() => Uri.parse('foo:////server/b/c', true)); // No authority component
    assert.ok(Uri.parse('foo:///a/b/c', true));
    assert.ok(Uri.parse('foo:a/b/c', true));
    assert.ok(Uri.parse('foo:/a/b/c', true));
    assert.ok(Uri.parse('foo://server/share/dir/file.py', true));
    assert.ok(Uri.parse('foo://server/share/dir/file.py?query#fragment', true));
    assert.ok(Uri.parse('foo:///c:/users/me', true));
    assert.ok(Uri.parse('foo:///c%3A%52users%52me', true));
    assert.ok(Uri.parse('', true));
    assert.ok(Uri.parse(undefined, true));
});

test('file', () => {
    const cwd = process.cwd();
    const uri1 = Uri.file('a/b/c', true, true);
    assert.ok(uri1.getFilePath().length > 6);
    assert.ok(
        uri1.getFilePath().toLowerCase().startsWith(cwd.toLowerCase()),
        `${uri1.getFilePath()} does not start with ${cwd}`
    );
    const uri2 = Uri.file('a/b/c', true, false);
    assert.equal(uri2.getFilePath().length, 6);
});

test('key', () => {
    const key = Uri.parse('foo:///a/b/c', true).key;
    const key2 = Uri.parse('foo:///a/b/c', true).key;
    assert.equal(key, key2);
    const key3 = Uri.parse('foo:///a/b/d', true).key;
    assert.notEqual(key, key3);
    const key4 = Uri.file('/a/b/c').key;
    assert.notEqual(key, key4);
    const key5 = Uri.parse('file:///a/b/c', true).key;
    assert.equal(key4, key5);
    const key6 = Uri.file(normalizeSlashes('c:\\foo\\bar\\d.txt')).key;
    const key7 = Uri.parse('file:///c%3A/foo/bar/d.txt', true).key;
    const key8 = Uri.parse('file:///c:/foo/bar/d.txt', true).key;
    assert.equal(key6, key7);
    assert.equal(key6, key8);
    const key9 = Uri.parse('file:///c%3A/foo/bar/D.txt', true).key;
    const key10 = Uri.parse('file:///c:/foo/bar/d.txt', true).key;
    assert.notEqual(key9, key10);
    const key11 = Uri.parse('file:///c%3A/foo/bar/D.txt', false).key;
    const key12 = Uri.parse('file:///c%3A/foo/bar/d.txt', false).key;
    assert.equal(key11, key12);
});

test('filename', () => {
    const filename = Uri.parse('foo:///a/b/c', true).fileName;
    assert.equal(filename, 'c');
    const filename2 = Uri.parse('foo:///a/b/c/', true).fileName;
    assert.equal(filename2, 'c');
    const filename3 = Uri.parse('foo:///a/b/c.py', true).fileName;
    assert.equal(filename3, 'c.py');
    const filename4 = Uri.parse('foo:///a/b/c.py?query#fragment', true).fileName;
    assert.equal(filename4, 'c.py');
    const filename5 = Uri.file('/a/b/c').fileName;
    assert.equal(filename5, 'c');
    const filename6 = Uri.parse('file:///a/b/c', true).fileName;
    assert.equal(filename6, 'c');
});

test('extname', () => {
    const extname = Uri.parse('foo:///a/b/c', true).lastExtension;
    assert.equal(extname, '');
    const extname2 = Uri.parse('foo:///a/b/c/', true).lastExtension;
    assert.equal(extname2, '');
    const extname3 = Uri.parse('foo:///a/b/c.py', true).lastExtension;
    assert.equal(extname3, '.py');
    const extname4 = Uri.parse('foo:///a/b/c.py?query#fragment', true).lastExtension;
    assert.equal(extname4, '.py');
    const extname5 = Uri.file('/a/b/c.py.foo').lastExtension;
    assert.equal(extname5, '.foo');
    const extname6 = Uri.parse('file:///a/b/c.py.foo', true).lastExtension;
    assert.equal(extname6, '.foo');
});

test('fragment', () => {
    const fragment = Uri.parse('foo:///a/b/c#bar', true).fragment;
    assert.equal(fragment, 'bar');
    const fragment2 = Uri.parse('foo:///a/b/c#bar#baz', true).fragment;
    assert.equal(fragment2, 'bar#baz');
    const fragment3 = Uri.parse('foo:///a/b/c?query#bar#baz', true).fragment;
    assert.equal(fragment3, 'bar#baz');
    const fragment4 = Uri.parse('foo:///a/b/c?query', true).fragment;
    assert.equal(fragment4, '');
    const fragment5 = Uri.parse('foo:///a/b/c', true).withFragment('bar').fragment;
    assert.equal(fragment5, 'bar');
    const fragment6 = Uri.parse('foo:///a/b/c#bar', true).withFragment('').fragment;
    assert.equal(fragment6, '');
});

test('containsExtension', () => {
    const uri1 = Uri.parse('foo:///a/b/c.py', true);
    assert.ok(uri1.containsExtension('.py'));
    assert.ok(!uri1.containsExtension('.PY'));
    assert.ok(!uri1.containsExtension('.pyi'));
    const uri2 = Uri.parse('foo:///a/b/c.pyi', true);
    assert.ok(uri2.containsExtension('.pyi'));
    assert.ok(!uri2.containsExtension('.PYI'));
    assert.ok(!uri2.containsExtension('.py'));
    const uri3 = Uri.parse('foo:///a/b/c.pyi.ipynb', false);
    assert.ok(uri3.containsExtension('.pyi'));
    assert.ok(uri3.containsExtension('.ipynb'));
    assert.ok(!uri3.containsExtension('.PYI'));
});

test('root', () => {
    const root1 = Uri.parse('foo://authority/a/b/c', true).root;
    assert.equal(root1.toString(), 'foo://authority/');
    const root = Uri.parse('file://server/b/c', true).root;
    assert.equal(root.toString(), 'file://server/');
    assert.equal(root.getRootPathLength(), 9);
    const root2 = Uri.parse('foo:/', true).root;
    assert.equal(root2.toString(), 'foo:/');
    const root3 = Uri.parse('foo://a/b/c/', true).root;
    assert.equal(root3.toString(), 'foo://a/');
    assert.ok(root3.isRoot());
    const root4 = Uri.parse('foo://a/b/c.py', true).root;
    assert.equal(root4.toString(), 'foo://a/');
    const root5 = Uri.parse('foo://a/b/c.py?query#fragment', true).root;
    assert.equal(root5.toString(), 'foo://a/');
    const root6 = Uri.file('/a/b/c.py.foo').root;
    assert.equal(root6.toString(), 'file:///');
    const root7 = Uri.parse('file:///a/b/c.py.foo', true).root;
    assert.equal(root7.toString(), 'file:///');
    assert.equal(root7.getRootPathLength(), 1);
    const root8 = Uri.parse('untitled:Untitled-1', true).root;
    assert.equal(root8.toString(), 'untitled:');
    assert.equal(root8.getRootPathLength(), 0);
    assert.equal(root8.isRoot(), false);
    const root9 = Uri.parse('file://a/b/c/d.py', true).root;
    assert.equal(root9.toString(), 'file://a/');
    assert.equal(root9.getRootPathLength(), 4);
    assert.ok(root9.isRoot());
    const root10 = Uri.parse('file://c%3A/b/c/d.py', true).root;
    assert.equal(root10.toString(), 'file://c:/');
    assert.equal(root10.getRootPathLength(), 5);
    assert.ok(root10.isRoot());
});

test('untitled', () => {
    const untitled = Uri.parse('untitled:Untitled-1', true);
    assert.equal(untitled.scheme, 'untitled');
    assert.equal(untitled.fileName, 'Untitled-1');
    assert.equal(untitled.toString(), 'untitled:Untitled-1');
    const untitled2 = Uri.parse('untitled:Untitled-1', true);
    assert.ok(untitled.equals(untitled2));
    const untitled3 = Uri.parse('untitled:Untitled-2', true);
    assert.ok(!untitled.equals(untitled3));
    const untitled4 = Uri.parse('untitled:Untitled-1.foo.bar', false);
    assert.equal(untitled4.scheme, 'untitled');
    assert.equal(untitled4.fileName, 'Untitled-1.foo.bar');
    assert(untitled4.containsExtension('.foo'));
    assert(untitled4.containsExtension('.bar'));
});

test('empty', () => {
    const empty = Uri.parse('', true);
    assert.equal(empty.isEmpty(), true);
    const empty2 = Uri.parse('foo:///', true).isEmpty();
    assert.equal(empty2, false);
    const empty3 = Uri.empty();
    assert.equal(empty3.isEmpty(), true);
    const empty4 = Uri.parse(undefined, true);
    assert.equal(empty4.isEmpty(), true);
    assert.ok(empty4.equals(empty3));
    assert.ok(empty3.equals(empty));
    const combined = empty.combinePaths(normalizeSlashes('/d/e/f'));
    assert.equal(combined.getFilePath(), normalizeSlashes('/d/e/f'));
});

test('file', () => {
    const file1 = Uri.file(normalizeSlashes('/a/b/c')).getFilePath();
    assert.equal(file1, normalizeSlashes('/a/b/c'));
    const file2 = Uri.file('file:///a/b/c').getFilePath();
    assert.equal(file2, normalizeSlashes('/a/b/c'));
    const resolved = Uri.file(normalizeSlashes('/a/b/c')).combinePaths(normalizeSlashes('/d/e/f'));
    assert.equal(resolved.getFilePath(), normalizeSlashes('/d/e/f'));
});

test('isUri', () => {
    const isUri = Uri.isUri('foo:///a/b/c');
    assert.equal(isUri, false);
    const isUri2 = Uri.isUri('/a/b/c');
    assert.equal(isUri2, false);
    const isUri3 = Uri.isUri(undefined);
    assert.equal(isUri3, false);
    const isUri4 = Uri.isUri(Uri.parse('foo:///a/b/c', true));
    assert.equal(isUri4, true);
    const isUri5 = Uri.isUri(Uri.empty());
    assert.equal(isUri5, true);
});

test('matchesRegex', () => {
    const includeFiles = /\.pyi?$/;
    const uri = Uri.parse('file:///a/b/c.pyi', true);
    assert.ok(uri.matchesRegex(includeFiles));
    const uri2 = Uri.parse('file:///a/b/c.px', true);
    assert.equal(uri2.matchesRegex(includeFiles), false);
    const uri3 = Uri.parse('vscode-vfs:///a/b/c.pyi', true);
    assert.ok(uri3.matchesRegex(includeFiles));
    const fileRegex = /^(c:\/foo\/bar)($|\/)/i;
    const uri4 = Uri.parse('file:///C%3A/foo/bar', true);
    assert.ok(uri4.matchesRegex(fileRegex));
    const uri5 = Uri.parse('file:///c%3A/foo/bar', true);
    assert.ok(uri5.matchesRegex(fileRegex));
    const uri6 = Uri.parse('file:///c:/foo/bar', true);
    assert.ok(uri6.matchesRegex(fileRegex));
    const uri7 = Uri.parse('file:///c:/foo/bar/', true);
    assert.ok(uri7.matchesRegex(fileRegex));
    const uri8 = Uri.parse('file:///c:/foo/baz/', true);
    assert.equal(uri8.matchesRegex(fileRegex), false);
});

test('replaceExtension', () => {
    const uri = Uri.parse('file:///a/b/c.pyi', true);
    const uri2 = uri.replaceExtension('.py');
    assert.equal(uri2.toString(), 'file:///a/b/c.py');
    const uri3 = Uri.parse('file:///a/b/c', true);
    const uri4 = uri3.replaceExtension('.py');
    assert.equal(uri4.toString(), 'file:///a/b/c.py');
    const uri5 = Uri.parse('file:///a/b/c.foo.py', true);
    const uri6 = uri5.replaceExtension('.pyi');
    assert.equal(uri6.toString(), 'file:///a/b/c.foo.pyi');
});

test('addExtension', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri.addExtension('.py');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi.py');
    const uri3 = Uri.parse('file:///a/b/c', true);
    const uri4 = uri3.addExtension('.py');
    assert.equal(uri4.toString(), 'file:///a/b/c.py');
});

test('addPath', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri.addPath('d');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyid');
});

test('directory', () => {
    const uri = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri.getDirectory();
    assert.equal(uri2.toString(), 'file:///a/b');
    const uri3 = uri2.getDirectory();
    assert.equal(uri3.toString(), 'file:///a');
    const uri4 = Uri.parse('file:///a/b/', true);
    const uri5 = uri4.getDirectory();
    assert.equal(uri5.toString(), 'file:///a');
    const uri6 = uri4.getDirectory();
    assert.ok(uri6.equals(uri5));
});

test('init and pytyped', () => {
    const uri = Uri.parse('file:///a/b/c?query#fragment', true);
    const uri2 = uri.pytypedUri;
    assert.equal(uri2.toString(), 'file:///a/b/c/py.typed');
    const uri3 = uri.initPyUri;
    assert.equal(uri3.toString(), 'file:///a/b/c/__init__.py');
    const uri4 = uri.initPyiUri;
    assert.equal(uri4.toString(), 'file:///a/b/c/__init__.pyi');
    const uri5 = uri.packageUri;
    assert.equal(uri5.toString(), 'file:///a/b/c.py');
    const uri6 = uri.packageStubUri;
    assert.equal(uri6.toString(), 'file:///a/b/c.pyi');
    const uri7 = Uri.parse('foo://microsoft.com/a/b/c.py', true);
    const uri8 = uri7.pytypedUri;
    assert.equal(uri8.toString(), 'foo://microsoft.com/a/b/c.py/py.typed');
    const uri9 = uri7.initPyUri;
    assert.equal(uri9.toString(), 'foo://microsoft.com/a/b/c.py/__init__.py');
    const uri10 = uri7.initPyiUri;
    assert.equal(uri10.toString(), 'foo://microsoft.com/a/b/c.py/__init__.pyi');
    const uri11 = uri7.packageUri;
    assert.equal(uri11.toString(), 'foo://microsoft.com/a/b/c.py.py');
    const uri12 = uri7.packageStubUri;
    assert.equal(uri12.toString(), 'foo://microsoft.com/a/b/c.py.pyi');
});

test('isChild', () => {
    const parent = Uri.parse('file:///a/b/?query#fragment', true);
    const child = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    assert.ok(child.isChild(parent));
    const parent2 = Uri.parse('file:///a/b', true);
    const child2 = Uri.parse('file:///a/b/c.pyi', true);
    const child2DifferentCase = Uri.parse('file:///a/B/C.pyi', false);
    assert.ok(child2.isChild(parent2));
    assert.ok(child2DifferentCase.isChild(parent2));
    const parent3 = Uri.parse('file:///a/b/', true);
    const child3 = Uri.parse('file:///a/b/c.pyi', true);
    assert.ok(child3.isChild(parent3));
    const parent4 = Uri.parse('file:///a/b/', true);
    const notChild4 = Uri.parse('file:///a/bb/c.pyi', true);
    assert.ok(!notChild4.isChild(parent4));
    assert.ok(!notChild4.isChild(parent2));
    const notChild5 = Uri.parse('file:///a/b/', true);
    assert.ok(!notChild5.isChild(parent4));
});

test('equals', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = Uri.file('/a/b/c.pyi');
    assert.ok(!uri1.equals(uri2));
    const uri3 = uri1.stripExtension().addExtension('.pyi');
    assert.ok(uri2.equals(uri3));
    const uri4 = Uri.parse('foo:///a/b/c', true);
    const uri5 = Uri.parse('foo:///a/b/c', true);
    const uri6 = Uri.parse('foo:///a/b/c/', true);
    assert.ok(uri4.equals(uri5));
    assert.ok(uri4.equals(uri6));
    const uri7 = Uri.parse('file://c%3A/b/c/d.py', true).root;
    const uri8 = Uri.parse('file://c:/', true);
    assert.ok(uri7.equals(uri8));
    const uri9 = Uri.parse('foo:///a/b/c?query', true);
    assert.ok(!uri9.equals(uri4));
    // Web uris are always case sensitive
    const uri10 = Uri.parse('foo:///a/b/c', false);
    const uri11 = Uri.parse('foo:///a/B/c', false);
    assert.ok(!uri10.equals(uri11));
    // Filre uris pay attention to the parameter.
    const uri12 = Uri.parse('file:///a/b/c', false);
    const uri13 = Uri.parse('file:///a/B/c', false);
    assert.ok(uri12.equals(uri13));
    const uri14 = Uri.parse('file:///a/b/c', true);
    const uri15 = Uri.parse('file:///a/B/c', true);
    assert.ok(!uri14.equals(uri15));
});

test('startsWith', () => {
    const parent = Uri.parse('file:///a/b/?query#fragment', true);
    const child = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    assert.ok(child.startsWith(parent));
    const parent2 = Uri.parse('file:///a/b', true);
    const child2 = Uri.parse('file:///a/b/c.pyi', true);
    assert.ok(child2.startsWith(parent2));
    const parent3 = Uri.parse('file:///a/b/', true);
    const child3 = Uri.parse('file:///a/b/c.pyi', true);
    assert.ok(child3.startsWith(parent3));
    const parent4 = Uri.parse('file:///a/b/', true);
    const notChild4 = Uri.parse('file:///a/bb/c.pyi', true);
    assert.ok(!notChild4.startsWith(parent4));
    assert.ok(!notChild4.startsWith(parent2));
});

test('path comparisons', () => {
    const uri = Uri.parse('foo:///a/b/c.pyi?query#fragment', true);
    assert.ok(uri.pathEndsWith('c.pyi'));
    assert.ok(uri.pathEndsWith('b/c.pyi'));
    assert.ok(uri.pathEndsWith('a/b/c.pyi'));
    assert.ok(!uri.pathEndsWith('a/b/c.py'));
    assert.ok(!uri.pathEndsWith('b/c.py'));
    assert.ok(uri.pathIncludes('c.pyi'));
    assert.ok(uri.pathIncludes('b/c'));
    assert.ok(uri.pathIncludes('a/b/c'));
    const uri2 = Uri.parse('file:///C%3A/a/b/c.pyi?query#fragment', true);
    assert.ok(uri2.pathEndsWith('c.pyi'));
    assert.ok(uri2.pathEndsWith('b/c.pyi'));
    assert.ok(!uri2.pathStartsWith('C:/a'));
    assert.ok(!uri2.pathStartsWith('C:/a/b'));
    assert.ok(uri2.pathStartsWith('c:/a'));
    assert.ok(uri2.pathStartsWith('c:/a/b'));
});

test('combinePaths', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri1.combinePaths('d', 'e');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi/d/e');
    const uri4 = uri1.combinePaths('d', 'e', 'f');
    assert.equal(uri4.toString(), 'file:///a/b/c.pyi/d/e/f');
    const uri5 = uri1.combinePaths('d', '..', 'e');
    assert.equal(uri5.toString(), 'file:///a/b/c.pyi/e');
    const rootedPath = process.platform === 'win32' ? 'D:' : '/D';
    const rootedResult = process.platform === 'win32' ? 'file:///d%3A/e/f' : 'file:///D/e/f';
    const uri6 = uri1.combinePaths(rootedPath, 'e', 'f');
    assert.equal(uri6.toString(), rootedResult);
    const uri7 = Uri.parse('foo:', true);
    const uri8 = uri7.combinePaths('d', 'e');
    assert.equal(uri8.toString(), 'foo:d/e');
    const uri9 = Uri.parse('foo:/', true);
    const uri10 = uri9.combinePaths('d', 'e');
    assert.equal(uri10.toString(), 'foo:/d/e');
    const uri11 = Uri.empty().combinePaths('d', 'e');
    assert.equal(uri11.toString(), Uri.file(normalizeSlashes('/d/e')).toString());
    const uri12 = uri1.combinePaths('d', 'e', 'f/');
    assert.equal(uri12.toString(), 'file:///a/b/c.pyi/d/e/f');
});

test('combinePathsUnsafe', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri1.combinePathsUnsafe('d', 'e');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi/d/e');
    const uri4 = uri1.combinePathsUnsafe('d', 'e', 'f');
    assert.equal(uri4.toString(), 'file:///a/b/c.pyi/d/e/f');
    const uri5 = uri1.combinePathsUnsafe('d', '..', 'e');
    assert.equal(uri5.toString(), 'file:///a/b/c.pyi/d/../e');
    const rootedPath = process.platform === 'win32' ? 'D:' : '/D';
    const rootedResult = process.platform === 'win32' ? 'file:///d%3A/e/f' : 'file:///D/e/f';
    const uri6 = uri1.combinePathsUnsafe(rootedPath, 'e', 'f');
    assert.equal(uri6.toString(), rootedResult);
    const uri7 = Uri.parse('foo:', true);
    const uri8 = uri7.combinePathsUnsafe('d', 'e');
    assert.equal(uri8.toString(), 'foo:d/e');
    const uri9 = Uri.parse('foo:/', true);
    const uri10 = uri9.combinePathsUnsafe('d', 'e');
    assert.equal(uri10.toString(), 'foo:/d/e');
    const uri11 = Uri.empty().combinePathsUnsafe('d', 'e');
    assert.equal(uri11.toString(), Uri.file(normalizeSlashes('/d/e')).toString());
    const uri12 = uri1.combinePathsUnsafe('d', 'e', 'f/');
    assert.equal(uri12.toString(), 'file:///a/b/c.pyi/d/e/f/');
});

test('resolvePaths', () => {
    const uri1 = Uri.parse('file:///a/b/c.pyi?query#fragment', true);
    const uri2 = uri1.resolvePaths('d', 'e');
    assert.equal(uri2.toString(), 'file:///a/b/c.pyi/d/e');
    const uri3 = uri1.resolvePaths('d', 'e/');
    assert.equal(uri3.toString(), 'file:///a/b/c.pyi/d/e');
    const uri4 = uri1.resolvePaths('d', 'e', 'f/');
    assert.equal(uri4.toString(), 'file:///a/b/c.pyi/d/e/f');
    const uri5 = uri1.resolvePaths('d', '..', 'e');
    assert.equal(uri5.toString(), 'file:///a/b/c.pyi/e');
    const rootedPath = process.platform === 'win32' ? 'D:' : '/D';
    const rootedResult = process.platform === 'win32' ? 'file:///d%3A/e/f' : 'file:///D/e/f';
    const uri6 = uri1.resolvePaths(rootedPath, 'e', 'f');
    assert.equal(uri6.toString(), rootedResult);
    const uri7 = Uri.parse('foo:', true);
    const uri8 = uri7.resolvePaths('d', 'e');
    assert.equal(uri8.toString(), 'foo:d/e');
    const uri9 = Uri.parse('foo:/', true);
    const uri10 = uri9.resolvePaths('d', 'e');
    assert.equal(uri10.toString(), 'foo:/d/e');
    const uri11 = Uri.empty().resolvePaths('d', 'e');
    assert.equal(uri11.toString(), Uri.file(normalizeSlashes('/d/e')).toString());
});

test('combinePaths non file', () => {
    const uri1 = Uri.parse('baz://authority/a/b/c.pyi?query#fragment', true);
    const uri2 = uri1.combinePaths('d', 'e');
    assert.equal(uri2.toString(), 'baz://authority/a/b/c.pyi/d/e');
    const uri4 = uri1.combinePaths('d', 'e', 'f');
    assert.equal(uri4.toString(), 'baz://authority/a/b/c.pyi/d/e/f');
});

test('resolvePaths non file', () => {
    const uri1 = Uri.parse('baz://authority/a/b/c.pyi?query#fragment', true);
    const uri2 = uri1.resolvePaths('d', 'e');
    assert.equal(uri2.toString(), 'baz://authority/a/b/c.pyi/d/e');
    const uri3 = uri1.resolvePaths('d', 'e/');
    assert.equal(uri3.toString(), 'baz://authority/a/b/c.pyi/d/e');
    const uri4 = uri1.resolvePaths('d', 'e', 'f');
    assert.equal(uri4.toString(), 'baz://authority/a/b/c.pyi/d/e/f');
    const uri5 = uri1.resolvePaths('d', '..', 'e');
    assert.equal(uri5.toString(), 'baz://authority/a/b/c.pyi/e');
});

test('getPathComponents1', () => {
    const components = Uri.parse('', true).getPathComponents();
    assert.equal(components.length, 0);
});

test('getPathComponents2', () => {
    const components = Uri.parse('/users/', true).getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '/');
    assert.equal(components[1], 'users');
});

test('getPathComponents3', () => {
    const components = Uri.parse('/users/hello.py', true).getPathComponents();
    assert.equal(components.length, 3);
    assert.equal(components[0], '/');
    assert.equal(components[1], 'users');
    assert.equal(components[2], 'hello.py');
});

test('getPathComponents4', () => {
    const components = Uri.parse('/users/hello/../', true).getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '/');
    assert.equal(components[1], 'users');
});

test('getPathComponents5', () => {
    const components = Uri.parse('./hello.py', true).getPathComponents();
    assert.equal(components.length, 2);
    assert.equal(components[0], '/');
    assert.equal(components[1], 'hello.py');
});

test('getPathComponents6', () => {
    const components = Uri.parse('file://server/share/dir/file.py', true).getPathComponents();
    assert.equal(components.length, 4);
    assert.ok(components[0].slice(2).includes('server'));
    assert.equal(components[1], 'share');
    assert.equal(components[2], 'dir');
    assert.equal(components[3], 'file.py');
});

test('getRelativePathComponents1', () => {
    const components = Uri.parse('foo:///users/', true).getRelativePathComponents(Uri.parse('foo:///users/', true));
    assert.equal(components.length, 0);
});

test('getRelativePathComponents2', () => {
    const components = Uri.parse('foo:///users/', true).getRelativePathComponents(Uri.parse('foo:///users/bar', true));
    assert.equal(components.length, 1);
    assert.equal(components[0], 'bar');
});

test('getRelativePathComponents3', () => {
    const components = Uri.parse('bar:///users/', true).getRelativePathComponents(Uri.parse('foo:///users/bar', true));
    assert.equal(components.length, 1);
    assert.equal(components[0], 'bar');
});

test('getRelativePathComponents4', () => {
    const components = Uri.parse('foo:///users', true).getRelativePathComponents(Uri.parse('foo:///users/', true));
    assert.equal(components.length, 0);
});

test('getRelativePathComponents5', () => {
    const components = Uri.parse('foo:///users/', true).getRelativePathComponents(
        Uri.parse('foo:///users/bar/baz/../foo', true)
    );
    assert.equal(components.length, 2);
    assert.equal(components[0], 'bar');
    assert.equal(components[1], 'foo');
});

test('getRelativePathComponents6', () => {
    const components = Uri.parse('foo:///users/bar', true).getRelativePathComponents(
        Uri.parse('foo:///users/foo', true)
    );
    assert.equal(components.length, 2);
    assert.equal(components[0], '..');
    assert.equal(components[1], 'foo');
});

test('getFileExtension1', () => {
    const ext = Uri.parse('foo:///blah.blah/hello.JsOn', true).lastExtension;
    assert.equal(ext, '.JsOn');
});

test('getFileName1', () => {
    const fileName = Uri.parse('foo:///blah.blah/HeLLo.JsOn', true).fileName;
    assert.equal(fileName, 'HeLLo.JsOn');
});

test('getFileName2', () => {
    const fileName1 = Uri.parse('foo:///blah.blah/hello.cpython-32m.so', true).fileName;
    assert.equal(fileName1, 'hello.cpython-32m.so');
});

test('stripFileExtension1', () => {
    const path = Uri.parse('foo:///blah.blah/HeLLo.JsOn', true).stripExtension().getPath();
    assert.equal(path, '/blah.blah/HeLLo');
});

test('stripFileExtension2', () => {
    const path1 = Uri.parse('foo:/blah.blah/hello.cpython-32m.so', true).stripAllExtensions().getPath();
    assert.equal(path1, '/blah.blah/hello');
    const path2 = Uri.parse('foo:/blah.blah/hello.cpython-32m.so', true).stripExtension().getPath();
    assert.equal(path2, '/blah.blah/hello.cpython-32m');
});

test('getWildcardRegexPattern1', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me', true), './blah/');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/blah/d'));
    assert.ok(!regex.test('/users/me/blad/d'));
});

test('getWildcardRegexPattern2', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me', true), './**/*.py?');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/.blah/foo.pyd'));
    assert.ok(!regex.test('/users/me/.blah/foo.py')); // No char after
});

test('getWildcardRegexPattern3', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('foo:///users/me', true), './**/.*.py');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('/users/me/.blah/.foo.py'));
    assert.ok(!regex.test('/users/me/.blah/foo.py'));
});

test('getWildcardRegexPattern4', () => {
    const pattern = getWildcardRegexPattern(Uri.parse('//server/share/dir', true), '.');
    const regex = new RegExp(pattern);
    assert.ok(regex.test('//server/share/dir/foo.py'));
    assert.ok(!regex.test('//server/share/dix/foo.py'));
});

test('getWildcardRoot1', () => {
    const p = getWildcardRoot(Uri.parse('foo:/users/me', true), './blah/');
    assert.equal(p.toString(), 'foo:/users/me/blah');
});

test('getWildcardRoot2', () => {
    const p = getWildcardRoot(Uri.parse('foo:/users/me', true), './**/*.py?/');
    assert.equal(p.toString(), 'foo:/users/me');
});

test('getWildcardRoot with root', () => {
    const p = getWildcardRoot(Uri.parse('foo:/', true), '.');
    assert.equal(p.toString(), 'foo:/');
});

test('getWildcardRoot with drive letter', () => {
    const p = getWildcardRoot(Uri.parse('file:///c:/', true), '.');
    assert.equal(p.toString(), 'file:///c%3A');
});

function resolvePaths(uri: string, ...paths: string[]) {
    return Uri.file(uri)
        .resolvePaths(...paths)
        .toString();
}

test('resolvePath1', () => {
    assert.equal(resolvePaths('/path', 'to', 'file.ext'), 'file:///path/to/file.ext');
});

test('resolvePath2', () => {
    assert.equal(resolvePaths('/path', 'to', '..', 'from', 'file.ext/'), 'file:///path/from/file.ext');
});

function getHomeDirUri() {
    return Uri.file(os.homedir());
}

test('resolvePath3 ~ escape', () => {
    assert.equal(
        resolvePaths(expandPathVariables('~/path', Uri.empty(), []), 'to', '..', 'from', 'file.ext/'),
        `${getHomeDirUri().toString()}/path/from/file.ext`
    );
});

test('resolvePath4 ~ escape in middle', () => {
    assert.equal(
        resolvePaths('/path', expandPathVariables('~/file.ext/', Uri.empty(), [])),
        `${getHomeDirUri().toString()}/file.ext`
    );
});

function combinePaths(uri: string, ...paths: string[]) {
    return resolvePaths(uri, ...paths);
}

test('invalid ~ without root', () => {
    const path = combinePaths('Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables(path, Uri.parse('foo:///src', true), [])), path);
});

test('invalid ~ with root', () => {
    const path = combinePaths('/', 'Library', 'com~apple~CloudDocs', 'Development', 'mysuperproject');
    assert.equal(resolvePaths(expandPathVariables(path, Uri.parse('foo:///src', true), [])), path);
});

function containsPath(uri: string, child: string) {
    return Uri.parse(child, true).isChild(Uri.parse(uri, true));
}

test('containsPath1', () => {
    assert.equal(containsPath('/a/b/c/', '/a/d/../b/c/./d'), true);
});

test('containsPath2', () => {
    assert.equal(containsPath('/', '\\a'), true);
});

test('containsPath3', () => {
    assert.equal(containsPath('/a', '/a/B'), true);
});

function getAnyExtensionFromPath(uri: string): string {
    return Uri.parse(uri, true).lastExtension;
}
test('getAnyExtension1', () => {
    assert.equal(getAnyExtensionFromPath('/path/to/file.ext'), '.ext');
});

function getBaseFileName(uri: string): string {
    return Uri.parse(uri, true).fileName;
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
    return Uri.file(uri).getRootPathLength();
}

test('getRootLength1', () => {
    assert.equal(getUriRootLength('a'), 1);
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
    assert.equal(getUriRootLength('c:/'), 2);
});

test('getRootLength6', () => {
    assert.equal(getUriRootLength('//server'), 9);
});

test('getRootLength7', () => {
    assert.equal(getUriRootLength('//server/share'), 9);
});

test('getRootLength8', () => {
    assert.equal(getUriRootLength('scheme:/no/authority'), 1);
});

test('getRootLength9', () => {
    assert.equal(getUriRootLength('scheme://with/authority'), 1);
});

function isRootedDiskUri(uri: string) {
    return isRootedDiskPath(Uri.file(uri).getFilePath());
}

test('isRootedDiskPath1', () => {
    assert(isRootedDiskUri('C:/a/b'));
});

test('isRootedDiskPath2', () => {
    assert(isRootedDiskUri('/'));
});

test('isRootedDiskPath3', () => {
    assert(isRootedDiskUri('a/b'));
});

test('isDiskPathRoot1', () => {
    assert(isRootedDiskUri('/'));
});

test('isDiskPathRoot2', () => {
    assert(isRootedDiskUri('c:/'));
});

test('isDiskPathRoot3', () => {
    assert(isRootedDiskUri('c:'));
});

test('isDiskPathRoot4', () => {
    assert(!isRootedDiskUri('c:d'));
});

function getRelativePath(parent: string, child: string) {
    return Uri.parse(parent, true).getRelativePath(Uri.parse(child, true));
}

test('getRelativePath', () => {
    assert.equal(getRelativePath('/a/b/c', '/a/b/c/d/e/f'), './d/e/f');
    assert.equal(getRelativePath('/a/b/c/d/e/f', '/a/b/c/'), undefined);
    assert.equal(getRelativePath('/a/b/c', '/d/e/f'), undefined);
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

    const folders = deduplicateFolders(listOfFolders).map((f) => f.getPath());

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
    const dirFilePath = dir.getFilePath()!;
    const entries = nodefs
        .readdirSync(dirFilePath)
        .map((entry) => path.basename(nodefs.realpathSync(path.join(dirFilePath, entry))));
    const normalizedEntries = lowerCaseDrive(entries);
    const fsentries = fs.readdirSync(dir);
    assert.deepStrictEqual(normalizedEntries, fsentries);

    const paths = entries.map((entry) => nodefs.realpathSync(path.join(dirFilePath, entry)));
    const fspaths = fsentries.map((entry) => fs.realCasePath(dir.combinePaths(entry)).getFilePath()!);
    assert.deepStrictEqual(lowerCaseDrive(paths), fspaths);

    // Check that the '..' has been removed.
    assert.ok(!fspaths.some((p) => p.toString().indexOf('..') >= 0));

    // If windows, check that the case is correct.
    if (process.platform === 'win32') {
        for (const p of fspaths) {
            const upper = Uri.file(p.toString().toUpperCase());
            const real = fs.realCasePath(upper);
            assert.strictEqual(p, real.getFilePath());
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

test('Web URIs dont exist', () => {
    const fs = createFromRealFileSystem();
    const uri = Uri.parse('http://www.bing.com', /*ignoreCase*/ true);
    assert(!fs.existsSync(uri));
    const stat = fs.statSync(uri);
    assert(!stat.isFile());
});
