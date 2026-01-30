/*
 * privateImportUsage.test.ts
 *
 * Tests for reportPrivateImportUsage when source packages are added to check paths.
 *
 * Bug: When a py.typed package is added to check paths (e.g., via command line),
 * the reportPrivateImportUsage errors incorrectly disappear because the file is
 * created with isInPyTypedPackage=false instead of detecting it properly.
 */

import assert from 'assert';

import { ImportResolver } from '../analyzer/importResolver';
import { Program } from '../analyzer/program';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticCategory } from '../common/diagnostic';
import { lib, sitePackages } from '../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { UriEx } from '../common/uri/uriUtils';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';
import { PyrightFileSystem } from '../pyrightFileSystem';

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);

function createTestFileSystem(files: { path: string; content: string }[]): TestFileSystem {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of files) {
        const path = normalizeSlashes(file.path);
        const dir = getDirectoryPath(path);
        fs.mkdirpSync(dir);

        fs.writeFileSync(UriEx.file(path), file.content);
    }

    return fs;
}

function createServiceProviderFromFiles(files: { path: string; content: string }[]) {
    const testFS = createTestFileSystem(files);
    const fs = new PyrightFileSystem(testFS);
    return createServiceProvider(testFS, fs);
}

describe('reportPrivateImportUsage with tracked library files', () => {
    test('error should persist when library with py.typed is also a tracked file', () => {
        // Setup: Create three packages
        // pkg_a: defines helper_func
        // pkg_b: imports helper_func from pkg_a but doesn't re-export it (has py.typed)
        // pkg_c: imports helper_func from pkg_b (should get error)

        const files = [
            // pkg_a in library (defines the original function)
            {
                path: combinePaths(libraryRoot, 'pkg_a', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths(libraryRoot, 'pkg_a', 'py.typed'),
                content: '',
            },
            {
                path: combinePaths(libraryRoot, 'pkg_a', 'utils.py'),
                content: 'def helper_func(): pass',
            },
            // pkg_b in library (re-imports without re-exporting)
            {
                path: combinePaths(libraryRoot, 'pkg_b', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths(libraryRoot, 'pkg_b', 'py.typed'),
                content: '',
            },
            {
                path: combinePaths(libraryRoot, 'pkg_b', 'reexport.py'),
                content: 'from pkg_a.utils import helper_func', // No __all__, not re-exported
            },
            // pkg_c - local source file that imports from pkg_b
            {
                path: normalizeSlashes('/src/pkg_c/__init__.py'),
                content: '',
            },
            {
                path: normalizeSlashes('/src/pkg_c/bad_import.py'),
                content: 'from pkg_b.reexport import helper_func', // Should error
            },
        ];

        const sp = createServiceProviderFromFiles(files);
        const configOptions = new ConfigOptions(UriEx.file('/'));

        // Set up execution environment with reportPrivateImportUsage enabled
        configOptions.diagnosticRuleSet.reportPrivateImportUsage = 'error';

        const importResolver = new ImportResolver(
            sp,
            configOptions,
            new TestAccessHost(sp.fs().getModulePath(), [UriEx.file(libraryRoot)])
        );

        const program = new Program(importResolver, configOptions, sp);

        // Track only the consumer file (pkg_c)
        const consumerUri = UriEx.file('/src/pkg_c/bad_import.py');
        program.setTrackedFiles([consumerUri]);

        // Analyze
        while (program.analyze()) {
            // Continue until complete
        }

        // Get diagnostics for the consumer file
        const sourceFile = program.getSourceFile(consumerUri);
        assert(sourceFile, 'Source file should exist');
        const diagnostics = sourceFile.getDiagnostics(configOptions) || [];
        const errors = diagnostics.filter((d) => d.category === DiagnosticCategory.Error);

        // Should have 1 error about private import
        assert.strictEqual(
            errors.length,
            1,
            `Expected 1 error when only consumer is tracked, got ${errors.length}: ${errors
                .map((e) => e.message)
                .join(', ')}`
        );
        assert(
            errors[0].message.includes('not exported') || errors[0].message.includes('helper_func'),
            `Error message should mention private import: ${errors[0].message}`
        );

        program.dispose();

        // Now create a new program and track BOTH the library file and the consumer
        const program2 = new Program(importResolver, configOptions, sp);

        const libraryFileUri = UriEx.file(combinePaths(libraryRoot, 'pkg_b', 'reexport.py'));

        // Track both files - this is the bug scenario
        // When the library file is tracked, it should still detect py.typed
        program2.setTrackedFiles([consumerUri, libraryFileUri]);

        // Analyze
        while (program2.analyze()) {
            // Continue until complete
        }

        // Get diagnostics for the consumer file again
        const sourceFile2 = program2.getSourceFile(consumerUri);
        assert(sourceFile2, 'Source file should exist in second program');
        const diagnostics2 = sourceFile2.getDiagnostics(configOptions) || [];
        const errors2 = diagnostics2.filter((d) => d.category === DiagnosticCategory.Error);

        // BUG: Without the fix, this would be 0 errors instead of 1
        // The error disappears because pkg_b/reexport.py is created with isInPyTypedPackage=false
        assert.strictEqual(
            errors2.length,
            1,
            `Expected 1 error when library is also tracked, got ${errors2.length}. ` +
                `Errors: ${errors2.map((e) => e.message).join(', ')}. ` +
                `This is the bug - error should persist even when library file is tracked.`
        );

        program2.dispose();
        sp.dispose();
    });
});
