/*
 * envVarUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for functions in envVarUtils.
 */

import * as os from 'os';

import assert from 'assert';

import { expandPathVariables } from '../common/envVarUtils';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

jest.mock('os', () => ({ __esModule: true, ...jest.requireActual('os') }));

test('expands ${workspaceFolder}', () => {
    const workspaceFolderUri = Uri.parse('/src', true);
    const test_path = '${workspaceFolder}/foo';
    const path = `${workspaceFolderUri.getPath()}/foo`;
    assert.equal(expandPathVariables(test_path, workspaceFolderUri, []), path);
});

test('expands ${workspaceFolder:sibling}', () => {
    const workspaceFolderUri = Uri.parse('/src', true);
    const workspace = { workspaceName: 'sibling', rootUri: workspaceFolderUri } as Workspace;
    const test_path = `\${workspaceFolder:${workspace.workspaceName}}/foo`;
    const path = `${workspaceFolderUri.getPath()}/foo`;
    assert.equal(expandPathVariables(test_path, workspaceFolderUri, [workspace]), path);
});

describe('expandPathVariables', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    test('expands ${env:HOME}', () => {
        process.env.HOME = 'file:///home/foo';
        const test_path = '${env:HOME}/bar';
        const path = `${process.env.HOME}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands ${env:USERNAME}', () => {
        process.env.USERNAME = 'foo';
        const test_path = 'file:///home/${env:USERNAME}/bar';
        const path = `file:///home/${process.env.USERNAME}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands ${env:VIRTUAL_ENV}', () => {
        process.env.VIRTUAL_ENV = 'file:///home/foo/.venv/path';
        const test_path = '${env:VIRTUAL_ENV}/bar';
        const path = `${process.env.VIRTUAL_ENV}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands ~ with os.homedir()', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('file:///home/foo');
        process.env.HOME = '';
        process.env.USERPROFILE = '';
        const test_path = '~/bar';
        const path = `${os.homedir()}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands ~ with env:HOME', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('');
        process.env.HOME = 'file:///home/foo';
        process.env.USERPROFILE = '';
        const test_path = '~/bar';
        const path = `${process.env.HOME}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands ~ with env:USERPROFILE', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('');
        process.env.HOME = '';
        process.env.USERPROFILE = 'file:///home/foo';
        const test_path = '~/bar';
        const path = `${process.env.USERPROFILE}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands /~ with os.homedir()', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('file:///home/foo');
        process.env.HOME = '';
        process.env.USERPROFILE = '';
        const test_path = '/~/bar';
        const path = `${os.homedir()}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands /~ with env:HOME', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('');
        process.env.HOME = 'file:///home/foo';
        process.env.USERPROFILE = '';
        const test_path = '/~/bar';
        const path = `${process.env.HOME}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });

    test('expands /~ with env:USERPROFILE', () => {
        jest.spyOn(os, 'homedir').mockReturnValue('');
        process.env.HOME = '';
        process.env.USERPROFILE = 'file:///home/foo';
        const test_path = '/~/bar';
        const path = `${process.env.USERPROFILE}/bar`;
        assert.equal(expandPathVariables(test_path, Uri.empty(), []), path);
    });
});
