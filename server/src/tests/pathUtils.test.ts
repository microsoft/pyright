/*
* pathUtils.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for pathUtils module.
*/

import * as assert from 'assert';
import * as path from 'path';

import { combinePaths, ensureTrailingDirectorySeparator, getFileExtension,
    getFileName, getPathComponents,
    getWildcardRegexPattern, getWildcardRoot, hasTrailingDirectorySeparator, stripFileExtension,
    stripTrailingDirectorySeparator } from '../common/pathUtils';

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

    assert.equal(p, path.join(path.sep, 'user', '1', '2', '3'));
});

test('ensureTrailingDirectorySeparator1', () => {
    const p = ensureTrailingDirectorySeparator('hello');

    assert.equal(p, `hello${path.sep}`);
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
    const ext = getFileExtension('blah/hello.JsOn');

    assert.equal(ext, '.JsOn');
});

test('getFileName1', () => {
    const fileName = getFileName('blah/HeLLo.JsOn');

    assert.equal(fileName, 'HeLLo.JsOn');
});

test('stripFileExtension', () => {
    const path = stripFileExtension('blah/HeLLo.JsOn');

    assert.equal(path, 'blah/HeLLo');
});

test('getWildcardRegexPattern1', () => {
    const pattern = getWildcardRegexPattern('/users/me', './blah/');

    assert.equal(pattern, '/users/me/blah');
});

test('getWildcardRegexPattern2', () => {
    const pattern = getWildcardRegexPattern('/users/me', './**/*.py?/');

    assert.equal(pattern, '/users/me(/[^/.][^/]*)*?/[^/]*\\.py[^/]');
});

test('getWildcardRoot1', () => {
    const p = getWildcardRoot('/users/me', './blah/');

    assert.equal(p, path.join(path.sep, 'users', 'me', 'blah'));
});

test('getWildcardRoot2', () => {
    const p = getWildcardRoot('/users/me', './**/*.py?/');

    assert.equal(p, path.join(path.sep, 'users', 'me'));
});
