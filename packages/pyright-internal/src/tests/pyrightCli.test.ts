/*
 * pyrightCli.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for Pyright command-line behavior.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BackgroundAnalysisProgram } from '../analyzer/backgroundAnalysisProgram';
import { AnalyzerService } from '../analyzer/service';
import * as typeStubOutput from '../analyzer/typeStubOutput';
import { main } from '../pyright';

jest.setTimeout(30_000);

test('create-stub writes generated files through the CLI output adapter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-create-stub-'));
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
        fs.writeFileSync(path.join(root, 'sample.py'), 'def answer():\n    return 42\n', 'utf8');
        fs.writeFileSync(
            path.join(root, 'pyrightconfig.json'),
            JSON.stringify({ include: ['sample.py'], stubPath: 'typings' }),
            'utf8'
        );
        process.chdir(root);
        process.argv = ['node', 'pyright', '--project', root, '--createstub', 'sample'];

        await main();

        assert.strictEqual(process.exitCode, 0);
        assert.match(
            fs.readFileSync(path.join(root, 'typings', 'sample', '__init__.pyi'), 'utf8'),
            /def answer\(\):\s*\n\s+\.\.\./
        );
        expect(infoSpy).toHaveBeenCalledWith("Type stub was created for 'sample'");
        expect(errorSpy).not.toHaveBeenCalled();
    } finally {
        process.argv = originalArgv;
        process.chdir(originalCwd);
        process.exitCode = originalExitCode;
        infoSpy.mockRestore();
        errorSpy.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('create-stub reports an unresolved target without rejecting', async () => {
    await verifyCreateStubFailure(
        'missing',
        (root) => {
            fs.writeFileSync(path.join(root, 'pyrightconfig.json'), JSON.stringify({ stubPath: 'typings' }), 'utf8');
        },
        undefined,
        "Error occurred when creating type stub: Import 'missing' could not be resolved"
    );
});

test('create-stub reports allowed-import setup failures', async () => {
    await verifyCreateStubFailure(
        'sample',
        createSingleFileProject,
        () =>
            jest.spyOn(BackgroundAnalysisProgram.prototype, 'setAllowedThirdPartyImports').mockImplementation(() => {
                throw new Error('allowed imports failed');
            }),
        'Error occurred when creating type stub: allowed imports failed'
    );
});

test('create-stub reports tracked-file setup failures', async () => {
    await verifyCreateStubFailure(
        'sample',
        createSingleFileProject,
        () =>
            jest.spyOn(BackgroundAnalysisProgram.prototype, 'setTrackedFiles').mockImplementation(() => {
                throw new Error('tracked files failed');
            }),
        'Error occurred when creating type stub: tracked files failed'
    );
});

test('create-stub reports output failures after analysis', async () => {
    await verifyCreateStubFailure(
        'sample',
        createSingleFileProject,
        () =>
            jest.spyOn(typeStubOutput, 'writeGeneratedTypeStubFiles').mockImplementation(() => {
                throw new Error('output failed');
            }),
        'Error occurred when creating type stub: output failed'
    );
});

test('create-stub generates only the requested multi-file package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-create-stub-'));
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
        fs.mkdirSync(path.join(root, 'libs', 'sample'), { recursive: true });
        fs.writeFileSync(path.join(root, 'unrelated.py'), 'unrelated = 1\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', '__init__.py'), 'from . import a, b\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'a.py'), 'value_a = 1\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'b.py'), 'value_b = 2\n', 'utf8');
        fs.writeFileSync(
            path.join(root, 'pyrightconfig.json'),
            JSON.stringify({ include: ['unrelated.py'], extraPaths: ['libs'], stubPath: 'typings' }),
            'utf8'
        );
        process.chdir(root);
        process.argv = ['node', 'pyright', '--project', root, '--createstub', 'sample'];

        await main();

        assert.strictEqual(process.exitCode, 0);
        assert.deepStrictEqual(
            [...fs.readdirSync(path.join(root, 'typings', 'sample')).sort()],
            ['__init__.pyi', 'a.pyi', 'b.pyi']
        );
        assert.strictEqual(fs.existsSync(path.join(root, 'typings', 'unrelated.pyi')), false);
        expect(infoSpy).toHaveBeenCalledWith("Type stub was created for 'sample'");
        expect(errorSpy).not.toHaveBeenCalled();
    } finally {
        process.argv = originalArgv;
        process.chdir(originalCwd);
        process.exitCode = originalExitCode;
        infoSpy.mockRestore();
        errorSpy.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('create-stub recursively generates a dotted target package only', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-create-stub-'));
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
        fs.mkdirSync(path.join(root, 'libs', 'sample', 'sub'), { recursive: true });
        fs.writeFileSync(path.join(root, 'unrelated.py'), 'unrelated = 1\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', '__init__.py'), '', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'root_sibling.py'), 'root_value = 1\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'sub', '__init__.py'), '', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'sub', 'core.py'), 'def answer(): return 42\n', 'utf8');
        fs.writeFileSync(path.join(root, 'libs', 'sample', 'sub', 'unimported.py'), 'sub_value = 2\n', 'utf8');
        fs.writeFileSync(
            path.join(root, 'pyrightconfig.json'),
            JSON.stringify({ include: ['unrelated.py'], extraPaths: ['libs'], stubPath: 'typings' }),
            'utf8'
        );
        process.chdir(root);
        process.argv = ['node', 'pyright', '--project', root, '--createstub', 'sample.sub.core'];

        await main();

        assert.strictEqual(process.exitCode, 0);
        assert.deepStrictEqual(
            [...fs.readdirSync(path.join(root, 'typings', 'sample')).sort()],
            ['__init__.pyi', 'root_sibling.pyi', 'sub']
        );
        assert.deepStrictEqual(
            [...fs.readdirSync(path.join(root, 'typings', 'sample', 'sub')).sort()],
            ['__init__.pyi', 'core.pyi', 'unimported.pyi']
        );
        assert.strictEqual(fs.existsSync(path.join(root, 'typings', 'unrelated.pyi')), false);
        expect(infoSpy).toHaveBeenCalledWith("Type stub was created for 'sample.sub.core'");
        expect(errorSpy).not.toHaveBeenCalled();
    } finally {
        process.argv = originalArgv;
        process.chdir(originalCwd);
        process.exitCode = originalExitCode;
        infoSpy.mockRestore();
        errorSpy.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createSingleFileProject(root: string) {
    fs.writeFileSync(path.join(root, 'sample.py'), 'def answer():\n    return 42\n', 'utf8');
    fs.writeFileSync(
        path.join(root, 'pyrightconfig.json'),
        JSON.stringify({ include: ['sample.py'], stubPath: 'typings' }),
        'utf8'
    );
}

async function verifyCreateStubFailure(
    importName: string,
    createProject: (root: string) => void,
    installFailure: (() => { mockRestore(): void }) | undefined,
    expectedMessage: string
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-create-stub-'));
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const disposeSpy = jest.spyOn(AnalyzerService.prototype, 'dispose');
    let failureSpy: { mockRestore(): void } | undefined;

    try {
        createProject(root);
        process.chdir(root);
        process.argv = ['node', 'pyright', '--project', root, '--createstub', importName];
        failureSpy = installFailure?.();

        await expect(main()).resolves.toBeUndefined();

        assert.strictEqual(process.exitCode, 2);
        expect(errorSpy).toHaveBeenCalledWith(expectedMessage);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy).not.toHaveBeenCalled();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
        failureSpy?.mockRestore();
        disposeSpy.mockRestore();
        process.argv = originalArgv;
        process.chdir(originalCwd);
        process.exitCode = originalExitCode;
        infoSpy.mockRestore();
        errorSpy.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
    }
}
