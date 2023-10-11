/*
 * importResolver.test.ts
 *
 * importResolver tests.
 */

import assert from 'assert';

import { Dirent, ReadStream, WriteStream } from 'fs';
import { ImportResolver } from '../analyzer/importResolver';
import { ConfigOptions } from '../common/configOptions';
import { FileSystem, MkDirOptions, Stats } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from '../common/fileWatcher';
import { FullAccessHost } from '../common/fullAccessHost';
import { Host } from '../common/host';
import { lib, sitePackages, typeshedFallback } from '../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { ServiceProvider } from '../common/serviceProvider';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);

function usingTrueVenv() {
    return process.env.CI_IMPORT_TEST_VENVPATH !== undefined || process.env.CI_IMPORT_TEST_PYTHONPATH !== undefined;
}

if (!usingTrueVenv()) {
    describe('Import tests that cannot run in a true venv', () => {
        test('partial stub file exists', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
                    content: 'def test(): pass',
                },
            ];

            const importResult = getImportResult(files, ['myLib', 'partialStub']);
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
            assert.strictEqual(
                1,
                importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', 'partialStub.pyi'))
                    .length
            );
        });

        test('partial stub __init__ exists', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                    content: 'def test(): pass',
                },
            ];

            const importResult = getImportResult(files, ['myLib']);
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
            assert.strictEqual(
                1,
                importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi'))
                    .length
            );
        });

        test('stub package', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'stub.pyi'),
                    content: '# empty',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                    content: '# empty',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
                    content: 'def test(): pass',
                },
            ];

            // If fully typed stub package exists, that wins over the real package.
            const importResult = getImportResult(files, ['myLib', 'partialStub']);
            assert(!importResult.isImportFound);
        });

        test('partial stub package in typing folder', () => {
            const typingFolder = combinePaths(normalizeSlashes('/'), 'typing');
            const files = [
                {
                    path: combinePaths(typingFolder, 'myLib-stubs', '__init__.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(typingFolder, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                    content: 'def test(): pass',
                },
            ];

            const importResult = getImportResult(files, ['myLib'], (c) => (c.stubPath = typingFolder));
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
            assert.strictEqual(
                1,
                importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi'))
                    .length
            );
        });

        test('typeshed folder', () => {
            const typeshedFolder = combinePaths(normalizeSlashes('/'), 'ts');
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths(typeshedFolder, 'stubs', 'myLibPackage', 'myLib.pyi'),
                    content: '# empty',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                    content: 'def test(): pass',
                },
            ];

            // Stub packages win over typeshed.
            const importResult = getImportResult(files, ['myLib'], (c) => (c.typeshedPath = typeshedFolder));
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
            assert.strictEqual(
                1,
                importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi'))
                    .length
            );
        });

        test('typeshed fallback folder', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths('/', typeshedFallback, 'stubs', 'myLibPackage', 'myLib.pyi'),
                    content: '# empty',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                    content: 'def test(): pass',
                },
            ];

            // Stub packages win over typeshed.
            const importResult = getImportResult(files, ['myLib']);
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
            assert.strictEqual(
                1,
                importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi'))
                    .length
            );
        });

        test('py.typed file', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                    content: 'partial\n',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                    content: 'def test(): pass',
                },
                {
                    path: combinePaths(libraryRoot, 'myLib', 'py.typed'),
                    content: '# typed',
                },
            ];

            // Partial stub package always overrides original package.
            const importResult = getImportResult(files, ['myLib']);
            assert(importResult.isImportFound);
            assert(importResult.isStubFile);
        });

        test('py.typed library', () => {
            const files = [
                {
                    path: combinePaths(libraryRoot, 'os', '__init__.py'),
                    content: 'def test(): ...',
                },
                {
                    path: combinePaths(libraryRoot, 'os', 'py.typed'),
                    content: '',
                },
                {
                    path: combinePaths('/', typeshedFallback, 'stubs', 'os', 'os', '__init__.pyi'),
                    content: '# empty',
                },
            ];

            const importResult = getImportResult(files, ['os']);
            assert(importResult.isImportFound);
            assert.strictEqual(files[0].path, importResult.resolvedPaths[importResult.resolvedPaths.length - 1]);
        });

        test('import side by side file sub under lib folder', () => {
            const files = [
                {
                    path: combinePaths('/lib/site-packages/myLib', 'file1.py'),
                    content: 'def test1(): ...',
                },
                {
                    path: combinePaths('/lib/site-packages/myLib', 'file2.py'),
                    content: 'def test2(): ...',
                },
            ];

            const importResult = getImportResult(files, ['file1']);
            assert(!importResult.isImportFound);
        });
    });
}
describe('Import tests that can run with or without a true venv', () => {
    test('side by side files', () => {
        const myFile = combinePaths('src', 'file.py');
        const files = [
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
                content: 'def test(): ...',
            },
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                content: 'partial\n',
            },
            {
                path: combinePaths(libraryRoot, 'myLib', 'partialStub.pyi'),
                content: '# empty',
            },
            {
                path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
                content: 'def test(): pass',
            },
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub2.pyi'),
                content: 'def test(): ...',
            },
            {
                path: combinePaths(libraryRoot, 'myLib', 'partialStub2.py'),
                content: 'def test(): pass',
            },
            {
                path: myFile,
                content: '# not used',
            },
        ];

        const sp = createServiceProviderFromFiles(files);
        const configOptions = new ConfigOptions(normalizeSlashes('/'));
        const importResolver = new ImportResolver(
            sp,
            configOptions,
            new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
        );

        // Stub package wins over original package (per PEP 561 rules).
        const sideBySideResult = importResolver.resolveImport(myFile, configOptions.findExecEnvironment(myFile), {
            leadingDots: 0,
            nameParts: ['myLib', 'partialStub'],
            importedSymbols: new Set<string>(),
        });

        assert(sideBySideResult.isImportFound);
        assert(sideBySideResult.isStubFile);

        const sideBySideStubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
        assert.strictEqual(1, sideBySideResult.resolvedPaths.filter((f) => f === sideBySideStubFile).length);
        assert.strictEqual('def test(): ...', sp.fs().readFileSync(sideBySideStubFile, 'utf8'));

        // Side by side stub doesn't completely disable partial stub.
        const partialStubResult = importResolver.resolveImport(myFile, configOptions.findExecEnvironment(myFile), {
            leadingDots: 0,
            nameParts: ['myLib', 'partialStub2'],
            importedSymbols: new Set<string>(),
        });

        assert(partialStubResult.isImportFound);
        assert(partialStubResult.isStubFile);

        const partialStubFile = combinePaths(libraryRoot, 'myLib', 'partialStub2.pyi');
        assert.strictEqual(1, partialStubResult.resolvedPaths.filter((f) => f === partialStubFile).length);
    });

    test('stub namespace package', () => {
        const files = [
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', 'stub.pyi'),
                content: '# empty',
            },
            {
                path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
                content: 'def test(): pass',
            },
        ];

        // If fully typed stub package exists, that wins over the real package.
        const importResult = getImportResult(files, ['myLib', 'partialStub']);
        assert(importResult.isImportFound);
        assert(!importResult.isStubFile);
        assert.strictEqual(
            1,
            importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', 'partialStub.py')).length
        );
    });

    test('stub in typing folder over partial stub package', () => {
        const typingFolder = combinePaths(normalizeSlashes('/'), 'typing');
        const files = [
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
                content: 'def test(): ...',
            },
            {
                path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
                content: 'partial\n',
            },
            {
                path: combinePaths(typingFolder, 'myLib.pyi'),
                content: '# empty',
            },
            {
                path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
                content: 'def test(): pass',
            },
        ];

        // If the package exists in typing folder, that gets picked up first.
        const importResult = getImportResult(files, ['myLib'], (c) => (c.stubPath = typingFolder));
        assert(importResult.isImportFound);
        assert(importResult.isStubFile);
        assert.strictEqual(
            0,
            importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
        );
    });

    test('non py.typed library', () => {
        const files = [
            {
                path: combinePaths(libraryRoot, 'os', '__init__.py'),
                content: 'def test(): ...',
            },
            {
                path: combinePaths('/', typeshedFallback, 'stubs', 'os', 'os', '__init__.pyi'),
                content: '# empty',
            },
        ];

        const importResult = getImportResult(files, ['os']);
        assert(importResult.isImportFound);
        assert.strictEqual(files[1].path, importResult.resolvedPaths[importResult.resolvedPaths.length - 1]);
    });

    test('no empty import roots', () => {
        const sp = createServiceProviderFromFiles([]);
        const configOptions = new ConfigOptions(''); // Empty, like open-file mode.
        const importResolver = new ImportResolver(
            sp,
            configOptions,
            new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
        );
        importResolver.getImportRoots(configOptions.getDefaultExecEnvironment()).forEach((path) => assert(path));
    });

    test('multiple typeshedFallback', () => {
        const files = [
            {
                path: combinePaths('/', typeshedFallback, 'stubs', 'aLib', 'aLib', '__init__.pyi'),
                content: '# empty',
            },
            {
                path: combinePaths('/', typeshedFallback, 'stubs', 'bLib', 'bLib', '__init__.pyi'),
                content: '# empty',
            },
        ];

        const sp = createServiceProviderFromFiles(files);
        const configOptions = new ConfigOptions(''); // Empty, like open-file mode.
        const importResolver = new ImportResolver(
            sp,
            configOptions,
            new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
        );
        const importRoots = importResolver.getImportRoots(configOptions.getDefaultExecEnvironment());

        assert.strictEqual(
            1,
            importRoots.filter((f) => f === combinePaths('/', typeshedFallback, 'stubs', 'aLib')).length
        );
        assert.strictEqual(
            1,
            importRoots.filter((f) => f === combinePaths('/', typeshedFallback, 'stubs', 'bLib')).length
        );
    });

    test('import side by side file root', () => {
        const files = [
            {
                path: combinePaths('/', 'file1.py'),
                content: 'def test1(): ...',
            },
            {
                path: combinePaths('/', 'file2.py'),
                content: 'def test2(): ...',
            },
        ];

        const importResult = getImportResult(files, ['file1']);
        assert(importResult.isImportFound);
        assert.strictEqual(1, importResult.resolvedPaths.filter((f) => f === combinePaths('/', 'file1.py')).length);
    });

    test('import side by side file sub folder', () => {
        const files = [
            {
                path: combinePaths('/test', 'file1.py'),
                content: 'def test1(): ...',
            },
            {
                path: combinePaths('/test', 'file2.py'),
                content: 'def test2(): ...',
            },
        ];

        const importResult = getImportResult(files, ['file1']);
        assert(importResult.isImportFound);
        assert.strictEqual(1, importResult.resolvedPaths.filter((f) => f === combinePaths('/test', 'file1.py')).length);
    });

    test('import side by side file sub under src folder', () => {
        const files = [
            {
                path: combinePaths('/src/nested', 'file1.py'),
                content: 'def test1(): ...',
            },
            {
                path: combinePaths('/src/nested', 'file2.py'),
                content: 'def test2(): ...',
            },
        ];

        const importResult = getImportResult(files, ['file1']);
        assert(importResult.isImportFound);
        assert.strictEqual(
            1,
            importResult.resolvedPaths.filter((f) => f === combinePaths('/src/nested', 'file1.py')).length
        );
    });

    test('import file sub under containing folder', () => {
        const files = [
            {
                path: combinePaths('/src/nested', 'file1.py'),
                content: 'def test1(): ...',
            },
            {
                path: combinePaths('/src/nested/nested2', 'file2.py'),
                content: 'def test2(): ...',
            },
        ];

        const importResult = getImportResult(files, ['file1']);
        assert(importResult.isImportFound);
        assert.strictEqual(
            1,
            importResult.resolvedPaths.filter((f) => f === combinePaths('/src/nested', 'file1.py')).length
        );
    });

    test("don't walk up the root", () => {
        const files = [
            {
                path: combinePaths('/', 'file1.py'),
                content: 'def test1(): ...',
            },
        ];

        const importResult = getImportResult(files, ['notExist'], (c) => (c.projectRoot = ''));
        assert(!importResult.isImportFound);
    });

    test('nested namespace package 1', () => {
        const files = [
            {
                path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
                content: 'def f(): pass',
            },
            {
                path: combinePaths('/', 'packages1', 'a', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths('/', 'packages2', 'a', '__init__.py'),
                content: '',
            },
        ];

        const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
            config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
        });
        assert(importResult.isImportFound);
    });

    test('nested namespace package 2', () => {
        const files = [
            {
                path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
                content: 'def f(): pass',
            },
            {
                path: combinePaths('/', 'packages1', 'a', 'b', 'c', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths('/', 'packages2', 'a', 'b', 'c', '__init__.py'),
                content: '',
            },
        ];

        const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
            config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
        });
        assert(importResult.isImportFound);
    });

    test('nested namespace package 3', () => {
        const files = [
            {
                path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
                content: 'def f(): pass',
            },
            {
                path: combinePaths('/', 'packages2', 'a', '__init__.py'),
                content: '',
            },
        ];

        const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
            config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
        });
        assert(!importResult.isImportFound);
    });

    test('nested namespace package 4', () => {
        const files = [
            {
                path: combinePaths('/', 'packages1', 'a', 'b', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths('/', 'packages1', 'a', 'b', 'c.py'),
                content: 'def f(): pass',
            },
            {
                path: combinePaths('/', 'packages2', 'a', '__init__.py'),
                content: '',
            },
            {
                path: combinePaths('/', 'packages2', 'a', 'b', '__init__.py'),
                content: '',
            },
        ];

        const importResult = getImportResult(files, ['a', 'b', 'c'], (config) => {
            config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
        });
        assert(!importResult.isImportFound);
    });
});

if (usingTrueVenv()) {
    describe('Import tests that have to run with a venv', () => {
        test('venv can find imports', () => {
            const files = [
                {
                    path: combinePaths('/', 'file1.py'),
                    content: 'import pytest',
                },
            ];

            const importResult = getImportResult(files, ['pytest']);
            assert(importResult.isImportFound, `Import not found: ${importResult.importFailureInfo?.join('\n')}`);
        });
    });
}

function getImportResult(
    files: { path: string; content: string }[],
    nameParts: string[],
    setup?: (c: ConfigOptions) => void
) {
    const defaultHostFactory = (sp: ServiceProvider) => new TestAccessHost(sp.fs().getModulePath(), [libraryRoot]);
    const defaultSetup =
        setup ??
        ((c) => {
            /* empty */
        });
    const defaultSpFactory = (files: { path: string; content: string }[]) => createServiceProviderFromFiles(files);

    // Use environment variables to determine how to create a host and how to modify the config options.
    // These are set in the CI to test imports with different options.
    let hostFactory: (sp: ServiceProvider) => Host = defaultHostFactory;
    let configModifier = defaultSetup;
    let spFactory = defaultSpFactory;

    if (process.env.CI_IMPORT_TEST_VENVPATH) {
        configModifier = (c: ConfigOptions) => {
            defaultSetup(c);
            c.venvPath = process.env.CI_IMPORT_TEST_VENVPATH;
            c.venv = process.env.CI_IMPORT_TEST_VENV;
        };
        spFactory = (files: { path: string; content: string }[]) => createServiceProviderWithCombinedFs(files);
    } else if (process.env.CI_IMPORT_TEST_PYTHONPATH) {
        configModifier = (c: ConfigOptions) => {
            defaultSetup(c);
            c.pythonPath = process.env.CI_IMPORT_TEST_PYTHONPATH;
        };
        hostFactory = (sp: ServiceProvider) => new TruePythonTestAccessHost();
        spFactory = (files: { path: string; content: string }[]) => createServiceProviderWithCombinedFs(files);
    }

    return getImportResultImpl(files, nameParts, spFactory, configModifier, hostFactory);
}

function getImportResultImpl(
    files: { path: string; content: string }[],
    nameParts: string[],
    spFactory: (files: { path: string; content: string }[]) => ServiceProvider,
    configModifier: (c: ConfigOptions) => void,
    hostFactory: (sp: ServiceProvider) => Host
) {
    const sp = spFactory(files);
    const configOptions = new ConfigOptions(normalizeSlashes('/'));
    configModifier(configOptions);

    const file = files.length > 0 ? files[files.length - 1].path : combinePaths('src', 'file.py');
    if (files.length === 0) {
        files.push({
            path: file,
            content: '# not used',
        });
    }

    const importResolver = new ImportResolver(sp, configOptions, hostFactory(sp));
    const importResult = importResolver.resolveImport(file, configOptions.findExecEnvironment(file), {
        leadingDots: 0,
        nameParts: nameParts,
        importedSymbols: new Set<string>(),
    });

    return importResult;
}
function createTestFileSystem(files: { path: string; content: string }[]): TestFileSystem {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of files) {
        const path = normalizeSlashes(file.path);
        const dir = getDirectoryPath(path);
        fs.mkdirpSync(dir);

        fs.writeFileSync(path, file.content);
    }

    return fs;
}
function createServiceProviderFromFiles(files: { path: string; content: string }[]): ServiceProvider {
    const fs = new PyrightFileSystem(createTestFileSystem(files));
    return createServiceProvider(fs);
}

function createServiceProviderWithCombinedFs(files: { path: string; content: string }[]): ServiceProvider {
    const fs = new PyrightFileSystem(new CombinedFileSystem(createTestFileSystem(files)));
    return createServiceProvider(fs);
}

class TruePythonTestAccessHost extends FullAccessHost {
    constructor() {
        super(createFromRealFileSystem());
    }
}

class CombinedFileSystem implements FileSystem {
    private _realFS = createFromRealFileSystem();

    constructor(private _testFS: FileSystem) {}

    mkdirSync(path: string, options?: MkDirOptions | undefined): void {
        this._testFS.mkdirSync(path, options);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        this._testFS.writeFileSync(path, data, encoding);
    }

    unlinkSync(path: string): void {
        this._testFS.unlinkSync(path);
    }

    rmdirSync(path: string): void {
        this._testFS.rmdirSync(path);
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._testFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(path: string): ReadStream {
        return this._testFS.createReadStream(path);
    }

    createWriteStream(path: string): WriteStream {
        return this._testFS.createWriteStream(path);
    }

    copyFileSync(src: string, dst: string): void {
        this._testFS.copyFileSync(src, dst);
    }

    existsSync(path: string): boolean {
        return this._testFS.existsSync(path) || this._realFS.existsSync(path);
    }

    chdir(path: string): void {
        this._testFS.chdir(path);
    }

    readdirEntriesSync(path: string): Dirent[] {
        if (this._testFS.existsSync(path)) {
            return this._testFS.readdirEntriesSync(path);
        }
        return this._realFS.readdirEntriesSync(path);
    }

    readdirSync(path: string): string[] {
        if (this._testFS.existsSync(path)) {
            return this._testFS.readdirSync(path);
        }
        return this._realFS.readdirSync(path);
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer;
    readFileSync(path: string, encoding: BufferEncoding | null = null) {
        if (this._testFS.existsSync(path)) {
            return this._testFS.readFileSync(path, encoding);
        }
        return this._realFS.readFileSync(path, encoding);
    }

    statSync(path: string): Stats {
        if (this._testFS.existsSync(path)) {
            return this._testFS.statSync(path);
        }
        return this._realFS.statSync(path);
    }

    realpathSync(path: string): string {
        if (this._testFS.existsSync(path)) {
            return this._testFS.realpathSync(path);
        }
        return this._realFS.realpathSync(path);
    }

    getModulePath(): string {
        return this._testFS.getModulePath();
    }

    readFile(path: string): Promise<Buffer> {
        if (this._testFS.existsSync(path)) {
            return this._testFS.readFile(path);
        }
        return this._realFS.readFile(path);
    }

    readFileText(path: string, encoding?: BufferEncoding | undefined): Promise<string> {
        if (this._testFS.existsSync(path)) {
            return this._testFS.readFileText(path, encoding);
        }
        return this._realFS.readFileText(path, encoding);
    }

    realCasePath(path: string): string {
        return this._testFS.realCasePath(path);
    }

    isMappedFilePath(filepath: string): boolean {
        return this._testFS.isMappedFilePath(filepath);
    }

    getOriginalFilePath(mappedFilePath: string): string {
        return this._testFS.getOriginalFilePath(mappedFilePath);
    }

    getMappedFilePath(originalFilepath: string): string {
        return this._testFS.getMappedFilePath(originalFilepath);
    }

    getUri(path: string): string {
        return this._testFS.getUri(path);
    }

    isInZip(path: string): boolean {
        return this._testFS.isInZip(path);
    }
}
