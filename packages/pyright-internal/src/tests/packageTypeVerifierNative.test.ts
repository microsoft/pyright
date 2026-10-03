/*
 * packageTypeVerifierNative.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';

import { TypeKnownStatus } from '../analyzer/packageTypeReport';
import { PackageTypeVerifier } from '../analyzer/packageTypeVerifier';
import { CommandLineOptions } from '../common/commandLineOptions';
import { DiagnosticCategory } from '../common/diagnostic';
import { pythonVersion3_13 } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { TestAccessHost } from './harness/testAccessHost';
import { libFolder } from './harness/vfs/factory';
import { MODULE_PATH } from './harness/vfs/filesystem';

function verifyNativePackage(files: Record<string, string | null>, moduleName = 'test_pkg', ignoreExternal = false) {
    const packageFiles: Record<string, string | null> = {
        'test_pkg/py.typed': '',
        'test_pkg/__init__.py': 'answer: None = None',
        ...files,
    };
    const code = Object.entries(packageFiles)
        .filter(([, content]) => content !== null)
        .map(
            ([file, content]) =>
                `// @filename: ${file}\n// @library: true\n${content!
                    .split('\n')
                    .map((line) => `//// ${line}`)
                    .join('\n')}`
        )
        .join('\n\n');
    const state = parseAndGetTestState(code).state;
    const fs = state.serviceProvider.fs();
    const nativeReads: string[] = [];
    const checkRead = (uri: Uri) => {
        if (['.so', '.pyd', '.dylib'].includes(uri.lastExtension.toLowerCase())) {
            nativeReads.push(uri.toString());
            throw new Error('Native contents must not be opened during package verification');
        }
    };
    const readFileSync = fs.readFileSync.bind(fs);
    const readFileRangeSync = fs.readFileRangeSync.bind(fs);
    const readFile = fs.readFile.bind(fs);
    const readFileText = fs.readFileText.bind(fs);
    const createReadStream = fs.createReadStream.bind(fs);
    const readSpies = [
        jest.spyOn(fs, 'readFileSync').mockImplementation((uri, encoding) => {
            checkRead(uri);
            return readFileSync(uri, encoding);
        }),
        jest.spyOn(fs, 'readFileRangeSync').mockImplementation((uri, offset, length) => {
            checkRead(uri);
            return readFileRangeSync(uri, offset, length);
        }),
        jest.spyOn(fs, 'readFile').mockImplementation((uri) => {
            checkRead(uri);
            return readFile(uri);
        }),
        jest.spyOn(fs, 'readFileText').mockImplementation((uri, encoding) => {
            checkRead(uri);
            return readFileText(uri, encoding);
        }),
        jest.spyOn(fs, 'createReadStream').mockImplementation((uri) => {
            checkRead(uri);
            return createReadStream(uri);
        }),
    ];

    try {
        const host = new TestAccessHost(UriEx.file(MODULE_PATH), [libFolder]);
        const options = new CommandLineOptions('/', /* fromLanguageServer */ false);
        options.configSettings.pythonVersion = pythonVersion3_13;
        options.configSettings.pythonPlatform = 'Linux';
        const report = new PackageTypeVerifier(
            state.serviceProvider,
            host,
            options,
            moduleName,
            ignoreExternal
        ).verify();
        assert.deepStrictEqual(nativeReads, [], 'Native files must not be opened, even if a read error is caught');
        return report;
    } finally {
        readSpies.forEach((spy) => spy.mockRestore());
        state.dispose();
    }
}

function missingNativeStub(moduleName: string) {
    return `No type stub found for native module "${moduleName}"`;
}

describe('Package verifier native modules', () => {
    test.each(['native.so', 'native.cpython-313-x86_64-linux-gnu.so', 'native.cp313-win_amd64.pyd', 'native.dylib'])(
        'reports a public extension without opening %s',
        (fileName) => {
            const report = verifyNativePackage({ [`test_pkg/${fileName}`]: 'not Python source' });
            assert.deepStrictEqual(
                report.generalDiagnostics.map((diag) => diag.message),
                [missingNativeStub('test_pkg.native')]
            );
            assert.strictEqual(report.generalDiagnostics[0].category, DiagnosticCategory.Error);
            assert.deepStrictEqual(
                Array.from(report.modules.values()).map((module) => module.name),
                ['test_pkg']
            );
            assert.deepStrictEqual(Array.from(report.symbols.keys()), ['test_pkg.answer']);
            assert.strictEqual(report.symbols.get('test_pkg.answer')?.typeKnownStatus, TypeKnownStatus.Known);
        }
    );

    test('verifies a corresponding stub and deduplicates ABI variants', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native.cpython-313-x86_64-linux-gnu.so': 'not Python source',
            'test_pkg/native.cp313-win_amd64.pyd': 'not Python source',
            'test_pkg/native.pyi': 'exported: None',
        });
        assert.deepStrictEqual(report.generalDiagnostics, []);
        assert.strictEqual(report.symbols.get('test_pkg.native.exported')?.typeKnownStatus, TypeKnownStatus.Known);
        assert.strictEqual(
            Array.from(report.modules.values()).filter((module) => module.name === 'test_pkg.native').length,
            1
        );
    });

    test('reports one error for multiple ABI variants without a stub', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native.cpython-313-x86_64-linux-gnu.so': 'not Python source',
            'test_pkg/native.cp313-win_amd64.pyd': 'not Python source',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
    });

    test('retains source analysis but does not treat .py as a native stub', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native.py': 'exported: None = None',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
        assert.strictEqual(report.symbols.get('test_pkg.native.exported')?.typeKnownStatus, TypeKnownStatus.Known);
    });

    test('a directory named .pyi is not a corresponding stub file', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native.pyi/_private.py': '',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
    });

    test('keeps private native modules and directories outside public discovery', () => {
        const report = verifyNativePackage({
            'test_pkg/_native.so': 'not Python source',
            'test_pkg/_private/native.so': 'not Python source',
            'test_pkg/.native.so': 'not Python source',
            'test_pkg/.libs/libhelper.so': 'not Python source',
            'test_pkg/.dylibs/libhelper.dylib': 'not Python source',
            'test_pkg/helper.libs/libhelper.so': 'not Python source',
        });
        assert.deepStrictEqual(report.generalDiagnostics, []);
        assert.deepStrictEqual(Array.from(report.symbols.keys()), ['test_pkg.answer']);
    });

    test.each([false, true])('reports own native modules with ignoreExternal=%s', (ignoreExternal) => {
        const report = verifyNativePackage({ 'test_pkg/native.so': 'not Python source' }, 'test_pkg', ignoreExternal);
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
    });

    test('does not open native modules imported by Python sources', () => {
        const report = verifyNativePackage({
            'test_pkg/__init__.py': 'import test_pkg.native\nanswer: None = None',
            'test_pkg/native.so': 'not Python source',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
        assert.strictEqual(report.symbols.get('test_pkg.answer')?.typeKnownStatus, TypeKnownStatus.Known);
    });

    test('verifies a direct native submodule', () => {
        const report = verifyNativePackage({ 'test_pkg/native.so': 'not Python source' }, 'test_pkg.native');
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
        assert.strictEqual(report.symbols.size, 0);
    });

    test.each(['test_pkg', 'test_pkg.namespace'])(
        'discovers native modules below namespace target %s',
        (moduleName) => {
            const report = verifyNativePackage({ 'test_pkg/namespace/native.so': 'not Python source' }, moduleName);
            assert.deepStrictEqual(
                report.generalDiagnostics.map((diag) => diag.message),
                [missingNativeStub('test_pkg.namespace.native')]
            );
        }
    );

    test.each(['test_pkg', 'test_pkg.nativepkg'])(
        'reports a native package initializer from target %s',
        (moduleName) => {
            const report = verifyNativePackage(
                { 'test_pkg/nativepkg/__init__.cpython-313-x86_64-linux-gnu.so': 'not Python source' },
                moduleName
            );
            assert.deepStrictEqual(
                report.generalDiagnostics.map((diag) => diag.message),
                [missingNativeStub('test_pkg.nativepkg')]
            );
        }
    );

    test('reports a native root initializer with py.typed', () => {
        const report = verifyNativePackage({
            'test_pkg/__init__.py': null,
            'test_pkg/__init__.cpython-313-x86_64-linux-gnu.so': 'not Python source',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg')]
        );
        assert.strictEqual(report.symbols.size, 0);
    });

    test('uses a native initializer sidecar', () => {
        const report = verifyNativePackage({
            'test_pkg/__init__.py': null,
            'test_pkg/__init__.cpython-313-x86_64-linux-gnu.so': 'not Python source',
            'test_pkg/__init__.pyi': 'answer: None',
        });
        assert.deepStrictEqual(report.generalDiagnostics, []);
        assert.strictEqual(report.symbols.get('test_pkg.answer')?.typeKnownStatus, TypeKnownStatus.Known);
    });

    test('retains existing namespace source symbols', () => {
        const report = verifyNativePackage({
            'test_pkg/__init__.py': null,
            'test_pkg/public.py': 'answer: None = None',
        });
        assert.deepStrictEqual(report.generalDiagnostics, []);
        assert.strictEqual(report.symbols.get('test_pkg.public.answer')?.typeKnownStatus, TypeKnownStatus.Known);
    });

    test('recognizes a sidecar even if a Python package shadows its native module', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native.pyi': 'unused: None',
            'test_pkg/native/__init__.py': 'exported: None = None',
        });
        assert.deepStrictEqual(report.generalDiagnostics, []);
        assert.strictEqual(report.symbols.get('test_pkg.native.exported')?.typeKnownStatus, TypeKnownStatus.Known);
    });

    test('requires the native sidecar while retaining a shadowing package interface', () => {
        const report = verifyNativePackage({
            'test_pkg/native.so': 'not Python source',
            'test_pkg/native/__init__.pyi': 'exported: None',
        });
        assert.deepStrictEqual(
            report.generalDiagnostics.map((diag) => diag.message),
            [missingNativeStub('test_pkg.native')]
        );
        assert.strictEqual(report.symbols.get('test_pkg.native.exported')?.typeKnownStatus, TypeKnownStatus.Known);
    });
});
