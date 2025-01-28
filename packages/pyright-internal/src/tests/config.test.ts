/*
 * config.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for parsing of pyrightconfig.json files.
 */

import assert from 'assert';

import { AnalyzerService } from '../analyzer/service';
import { deserialize, serialize } from '../backgroundThreadBase';
import { CommandLineOptions, DiagnosticSeverityOverrides } from '../common/commandLineOptions';
import { ConfigOptions, ExecutionEnvironment, getStandardDiagnosticRuleSet } from '../common/configOptions';
import { ConsoleInterface, NullConsole } from '../common/console';
import { TaskListPriority } from '../common/diagnostic';
import { combinePaths, normalizePath, normalizeSlashes } from '../common/pathUtils';
import { pythonVersion3_13, pythonVersion3_9 } from '../common/pythonVersion';
import { RealTempFile, createFromRealFileSystem } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';

describe(`config test'}`, () => {
    const tempFile = new RealTempFile();

    afterAll(() => tempFile.dispose());

    test('FindFilesWithConfigFile', () => {
        const cwd = normalizePath(process.cwd());
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configFilePath = 'src/tests/samples/project1';

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        service.setOptions(commandLineOptions);

        // The config file specifies a single file spec (a directory).
        assert.strictEqual(configOptions.include.length, 1, `failed creating options from ${cwd}`);
        assert.strictEqual(
            configOptions.projectRoot.key,
            service.fs.realCasePath(
                Uri.file(combinePaths(cwd, commandLineOptions.configFilePath), service.serviceProvider)
            ).key
        );

        const fileList = service.test_getFileNamesFromFileSpecs();

        // The config file specifies a subdirectory, so we should find
        // only two of the three "*.py" files present in the project
        // directory.
        assert.strictEqual(fileList.length, 2);
    });

    test('FindFilesVirtualEnvAutoDetectExclude', () => {
        const cwd = normalizePath(process.cwd());
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_exclude';

        service.setOptions(commandLineOptions);

        // The config file is empty, so no 'exclude' are specified
        // The myVenv directory is detected as a venv and will be automatically excluded
        const fileList = service.test_getFileNamesFromFileSpecs();

        // There are 3 python files in the workspace, outside of myVenv
        // There is 1 python file in myVenv, which should be excluded
        const fileNames = fileList.map((p) => p.fileName).sort();
        assert.deepStrictEqual(fileNames, ['sample1.py', 'sample2.py', 'sample3.py']);
    });

    test('FindFilesVirtualEnvAutoDetectInclude', () => {
        const cwd = normalizePath(process.cwd());
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_include';

        service.setOptions(commandLineOptions);

        // Config file defines 'exclude' folder so virtual env will be included
        const fileList = service.test_getFileNamesFromFileSpecs();

        // There are 3 python files in the workspace, outside of myVenv
        // There is 1 more python file in excluded folder
        // There is 1 python file in myVenv, which should be included
        const fileNames = fileList.map((p) => p.fileName).sort();
        assert.deepStrictEqual(fileNames, ['library1.py', 'sample1.py', 'sample2.py', 'sample3.py']);
    });

    test('FileSpecNotAnArray', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/project2';
        service.setOptions(commandLineOptions);

        service.test_getConfigOptions(commandLineOptions);

        // The method should return a default config and log an error.
        assert(nullConsole.infoCount > 0);
    });

    test('FileSpecNotAString', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/project3';
        service.setOptions(commandLineOptions);

        service.test_getConfigOptions(commandLineOptions);

        // The method should return a default config and log an error.
        assert(nullConsole.infoCount > 0);
    });

    test('SomeFileSpecsAreInvalid', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/project4';
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        // The config file specifies four file specs in the include array
        // and one in the exclude array.
        assert.strictEqual(configOptions.include.length, 4, `failed creating options from ${cwd}`);
        assert.strictEqual(configOptions.exclude.length, 1);
        assert.strictEqual(
            configOptions.projectRoot.getFilePath(),
            service.fs
                .realCasePath(Uri.file(combinePaths(cwd, commandLineOptions.configFilePath), service.serviceProvider))
                .getFilePath()
        );

        const fileList = service.test_getFileNamesFromFileSpecs();

        // We should receive two final files that match the include/exclude rules.
        assert.strictEqual(fileList.length, 2);
    });

    test('ConfigBadJson', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/project5';
        service.setOptions(commandLineOptions);

        service.test_getConfigOptions(commandLineOptions);

        // The method should return a default config and log an error.
        assert(nullConsole.infoCount > 0);
    });

    test('FindExecEnv1', () => {
        const cwd = UriEx.file(normalizePath(process.cwd()));
        const configOptions = new ConfigOptions(cwd);

        // Build a config option with three execution environments.
        const execEnv1 = new ExecutionEnvironment(
            'python',
            cwd.resolvePaths('src/foo'),
            getStandardDiagnosticRuleSet(),
            /* defaultPythonVersion */ undefined,
            /* defaultPythonPlatform */ undefined,
            /* defaultExtraPaths */ undefined
        );
        configOptions.executionEnvironments.push(execEnv1);
        const execEnv2 = new ExecutionEnvironment(
            'python',
            cwd.resolvePaths('src'),
            getStandardDiagnosticRuleSet(),
            /* defaultPythonVersion */ undefined,
            /* defaultPythonPlatform */ undefined,
            /* defaultExtraPaths */ undefined
        );
        configOptions.executionEnvironments.push(execEnv2);

        const file1 = cwd.resolvePaths('src/foo/bar.py');
        assert.strictEqual(configOptions.findExecEnvironment(file1), execEnv1);
        const file2 = cwd.resolvePaths('src/foo2/bar.py');
        assert.strictEqual(configOptions.findExecEnvironment(file2), execEnv2);

        // If none of the execution environments matched, we should get
        // a default environment with the root equal to that of the config.
        const file4 = UriEx.file('/nothing/bar.py');
        const defaultExecEnv = configOptions.findExecEnvironment(file4);
        assert(defaultExecEnv.root);
        const rootFilePath = Uri.is(defaultExecEnv.root) ? defaultExecEnv.root.getFilePath() : defaultExecEnv.root;
        assert.strictEqual(normalizeSlashes(rootFilePath), normalizeSlashes(configOptions.projectRoot.getFilePath()));
    });

    test('PythonPlatform', () => {
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const cwd = Uri.file(
            normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_pyproject_toml_platform')),
            service.serviceProvider
        );
        const commandLineOptions = new CommandLineOptions(cwd.getFilePath(), /* fromLanguageServer */ false);
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.ok(configOptions.executionEnvironments[0]);
        assert.equal(configOptions.executionEnvironments[0].pythonPlatform, 'platform');
    });

    test('AutoSearchPathsOn', () => {
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const cwd = Uri.file(
            normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src')),
            service.serviceProvider
        );
        const commandLineOptions = new CommandLineOptions(cwd.getFilePath(), /* fromLanguageServer */ false);
        commandLineOptions.configSettings.autoSearchPaths = true;
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        const expectedExtraPaths = [service.fs.realCasePath(cwd.combinePaths('src'))];
        assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
    });

    test('AutoSearchPathsOff', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configSettings.autoSearchPaths = false;
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        assert.deepStrictEqual(configOptions.executionEnvironments, []);
    });

    test('AutoSearchPathsOnSrcIsPkg', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_is_pkg'));
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configSettings.autoSearchPaths = true;
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        // The src folder is a package (has __init__.py) and so should not be automatically added as extra path
        assert.deepStrictEqual(configOptions.executionEnvironments, []);
    });

    test('AutoSearchPathsOnWithConfigExecEnv', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_extra_paths'));
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = combinePaths(cwd, 'pyrightconfig.json');
        commandLineOptions.configSettings.autoSearchPaths = true;
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        // The extraPaths in the config file should override the setting.
        const expectedExtraPaths: string[] = [];

        assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
    });

    test('AutoSearchPathsOnAndExtraPaths', () => {
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const cwd = Uri.file(
            normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_no_extra_paths')),
            service.serviceProvider
        );
        const commandLineOptions = new CommandLineOptions(cwd.getFilePath(), /* fromLanguageServer */ false);
        commandLineOptions.configSettings.autoSearchPaths = true;
        commandLineOptions.configSettings.extraPaths = ['src/_vendored'];
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);

        const expectedExtraPaths: Uri[] = [
            service.fs.realCasePath(cwd.combinePaths('src')),
            service.fs.realCasePath(cwd.combinePaths('src', '_vendored')),
        ];

        assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
    });

    test('BasicPyprojectTomlParsing', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_pyproject_toml'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);

        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.strictEqual(configOptions.defaultPythonVersion!.toString(), pythonVersion3_9.toString());
        assert.strictEqual(configOptions.diagnosticRuleSet.reportMissingImports, 'error');
        assert.strictEqual(configOptions.diagnosticRuleSet.reportUnusedClass, 'warning');
    });

    test('FindFilesInMemoryOnly', () => {
        const cwd = normalizePath(process.cwd());
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(undefined, /* fromLanguageServer */ true);
        // Force a lookup of the typeshed path. This causes us to try and generate a module path for the untitled file.
        commandLineOptions.configSettings.typeshedPath = combinePaths(cwd, 'src', 'tests', 'samples');
        service.setOptions(commandLineOptions);

        // Open a file that is not backed by the file system.
        const untitled = Uri.parse('untitled:Untitled-1.py', service.serviceProvider);
        service.setFileOpened(untitled, 1, '# empty');

        const fileList = service.test_getFileNamesFromFileSpecs();
        assert(fileList.filter((f) => f.equals(untitled)));
    });

    test('verify config fileSpecs after cloning', () => {
        const fs = new TestFileSystem(/* ignoreCase */ true);
        const configFile = {
            ignore: ['**/node_modules/**'],
        };

        const rootUri = Uri.file(process.cwd(), fs);
        const config = new ConfigOptions(rootUri);
        const sp = createServiceProvider(fs, new NullConsole());
        config.initializeFromJson(configFile, rootUri, sp, new TestAccessHost());
        const cloned = deserialize(serialize(config));

        assert.deepEqual(config.ignore, cloned.ignore);
    });

    test('verify can serialize config options', () => {
        const config = new ConfigOptions(UriEx.file(process.cwd()));
        const serialized = serialize(config);
        const deserialized = deserialize<ConfigOptions>(serialized);
        assert.deepEqual(config, deserialized);
        assert.ok(deserialized.findExecEnvironment(UriEx.file('foo/bar.py')));
    });

    test('extra paths on undefined execution root/default workspace', () => {
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(undefined, /* fromLanguageServer */ false);
        commandLineOptions.configSettings.extraPaths = ['/extraPaths'];

        service.setOptions(commandLineOptions);
        const configOptions = service.test_getConfigOptions(commandLineOptions);

        const expectedExtraPaths = [Uri.file('/extraPaths', service.serviceProvider)];
        assert.deepStrictEqual(
            configOptions.defaultExtraPaths?.map((u) => u.getFilePath()),
            expectedExtraPaths.map((u) => u.getFilePath())
        );
    });

    test('Extended config files', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_extended_config'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);

        service.setOptions(commandLineOptions);

        const fileList = service.test_getFileNamesFromFileSpecs();
        const fileNames = fileList.map((p) => p.fileName).sort();
        assert.deepStrictEqual(fileNames, ['sample.pyi', 'test.py']);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.diagnosticRuleSet.strictListInference, true);
    });

    test('Typechecking mode is standard when just config file is present', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_pyproject_toml'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configSettings.typeCheckingMode = 'off';

        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.diagnosticRuleSet.reportPossiblyUnboundVariable, 'error');
    });

    test('Typechecking mode depends upon if vscode extension or not', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/package1'));
        let service = createAnalyzer();
        let commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);

        service.setOptions(commandLineOptions);

        let configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.diagnosticRuleSet.reportPossiblyUnboundVariable, 'none');

        service = createAnalyzer();
        commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);

        service.setOptions(commandLineOptions);

        configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.diagnosticRuleSet.reportPossiblyUnboundVariable, 'error');

        commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configSettings.typeCheckingMode = 'strict';
        service = createAnalyzer();
        service.setOptions(commandLineOptions);

        configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.diagnosticRuleSet.reportPossiblyUnboundVariable, 'error');
    });

    test('Include file paths are only set in the config file when using extension', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project1'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configSettings.includeFileSpecs = ['test'];
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.include.length, 1);
        assert.ok(configOptions.include[0].regExp.source.includes('/subfolder1)'));
    });

    test('Include file paths can be added to on the command line with a config', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project1'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configSettings.includeFileSpecs = ['test'];
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.include.length, 2);
        assert.ok(configOptions.include[1].regExp.source.includes('/test)'));
    });

    test('Include file paths can be added to by an extension without a config', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/package1'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.configSettings.includeFileSpecs = ['test'];
        service.setOptions(commandLineOptions);

        const configOptions = service.test_getConfigOptions(commandLineOptions);
        assert.equal(configOptions.include.length, 1);
        assert.ok(configOptions.include[0].regExp.source.includes('/test)'));
    });

    test('Command line options can override config but only when not using extension', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_all_config'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        service.setOptions(commandLineOptions);

        // First get the default.
        const defaultOptions = service.test_getConfigOptions(commandLineOptions);

        // Now set all of the different options and make sure the command line options override.
        commandLineOptions.configSettings.typeCheckingMode = 'strict';
        commandLineOptions.configSettings.venvPath = 'test2';
        commandLineOptions.configSettings.typeshedPath = 'test2';
        commandLineOptions.configSettings.stubPath = 'test2';
        commandLineOptions.configSettings.useLibraryCodeForTypes = true;
        commandLineOptions.configSettings.includeFileSpecs = ['test2'];
        commandLineOptions.configSettings.excludeFileSpecs = ['test2'];
        commandLineOptions.configSettings.diagnosticSeverityOverrides = {
            reportMissingImports: DiagnosticSeverityOverrides.Error,
        };
        commandLineOptions.configSettings.ignoreFileSpecs = ['test2'];

        service.setOptions(commandLineOptions);
        const overriddenOptions = service.test_getConfigOptions(commandLineOptions);
        assert.notDeepStrictEqual(defaultOptions.include, overriddenOptions.include);
        assert.notDeepStrictEqual(defaultOptions.exclude, overriddenOptions.exclude);
        assert.notDeepStrictEqual(defaultOptions.ignore, overriddenOptions.ignore);
        assert.notDeepStrictEqual(defaultOptions.diagnosticRuleSet, overriddenOptions.diagnosticRuleSet);
        assert.notDeepStrictEqual(defaultOptions.venvPath, overriddenOptions.venvPath);
        // Typeshed and stub path are an exception, it should just be reported as a dupe.
        assert.deepStrictEqual(defaultOptions.typeshedPath, overriddenOptions.typeshedPath);
        assert.deepStrictEqual(defaultOptions.stubPath, overriddenOptions.stubPath);

        // Do the same with an extension based config, but make sure we get the default back.
        const commandLineOptions2 = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        service.setOptions(commandLineOptions2);
        const overriddenOptions2 = service.test_getConfigOptions(commandLineOptions2);
        assert.deepStrictEqual(defaultOptions, overriddenOptions2);
    });

    test('Config venvPath take precedences over language server settings', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_all_config'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.languageServerSettings.venvPath = 'test_from_language_server';
        service.setOptions(commandLineOptions);

        // Verify language server options don't override
        const options = service.test_getConfigOptions(commandLineOptions);
        assert.equal(options.venvPath?.pathIncludes('from_language_server'), false);
    });

    test('Command line venvPath take precedences over everything else', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_all_config'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configSettings.venvPath = 'test_from_command_line';
        commandLineOptions.languageServerSettings.venvPath = 'test_from_language_server';
        service.setOptions(commandLineOptions);

        // Verify command line overrides everything
        const options = service.test_getConfigOptions(commandLineOptions);
        assert.ok(options.venvPath?.pathIncludes('test_from_command_line'));
    });

    test('Config empty venvPath does not take precedences over language server settings', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_extra_paths'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ true);
        commandLineOptions.languageServerSettings.venvPath = 'test_from_language_server';
        service.setOptions(commandLineOptions);

        // Verify language server options don't override
        const options = service.test_getConfigOptions(commandLineOptions);
        assert.ok(options.venvPath?.pathIncludes('from_language_server'));
    });

    test('Language server specific settings are set whether or not there is a pyproject.toml', () => {
        const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_all_config'));
        const service = createAnalyzer();
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.languageServerSettings.autoImportCompletions = true;
        commandLineOptions.languageServerSettings.indexing = true;
        commandLineOptions.languageServerSettings.taskListTokens = [{ priority: TaskListPriority.High, text: 'test' }];
        commandLineOptions.languageServerSettings.logTypeEvaluationTime = true;
        commandLineOptions.languageServerSettings.typeEvaluationTimeThreshold = 1;
        commandLineOptions.languageServerSettings.enableAmbientAnalysis = false;
        commandLineOptions.languageServerSettings.disableTaggedHints = true;
        commandLineOptions.languageServerSettings.watchForSourceChanges = true;
        commandLineOptions.languageServerSettings.watchForLibraryChanges = true;
        commandLineOptions.languageServerSettings.watchForConfigChanges = true;
        commandLineOptions.languageServerSettings.typeStubTargetImportName = 'test';
        commandLineOptions.languageServerSettings.checkOnlyOpenFiles = true;
        commandLineOptions.languageServerSettings.disableTaggedHints = true;
        commandLineOptions.languageServerSettings.pythonPath = 'test_python_path';

        service.setOptions(commandLineOptions);
        let options = service.test_getConfigOptions(commandLineOptions);
        assert.strictEqual(options.autoImportCompletions, true);
        assert.strictEqual(options.indexing, true);
        assert.strictEqual(options.taskListTokens?.length, 1);
        assert.strictEqual(options.logTypeEvaluationTime, true);
        assert.strictEqual(options.typeEvaluationTimeThreshold, 1);
        assert.strictEqual(options.disableTaggedHints, true);
        assert.ok(options.pythonPath?.pathIncludes('test_python_path'));

        // Test with language server set to true to make sure they are still set.
        commandLineOptions.fromLanguageServer = true;
        commandLineOptions.languageServerSettings.venvPath = 'test_venv_path';
        service.setOptions(commandLineOptions);
        options = service.test_getConfigOptions(commandLineOptions);
        assert.strictEqual(options.autoImportCompletions, true);
        assert.strictEqual(options.indexing, true);
        assert.strictEqual(options.taskListTokens?.length, 1);
        assert.strictEqual(options.logTypeEvaluationTime, true);
        assert.strictEqual(options.typeEvaluationTimeThreshold, 1);
        assert.strictEqual(options.disableTaggedHints, true);
        assert.ok(options.pythonPath?.pathIncludes('test_python_path'));

        // Verify language server options don't override the config setting. Only command line should
        assert.equal(options.venvPath?.pathIncludes('test_venv_path'), false);
    });

    test('DefaultPythonVersion no config', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/package1';
        service.setOptions(commandLineOptions);

        const config = service.test_getConfigOptions(commandLineOptions);
        assert.deepStrictEqual(config.defaultPythonVersion, pythonVersion3_13);
    });

    test('DefaultPythonVersion with config', () => {
        const cwd = normalizePath(process.cwd());
        const nullConsole = new NullConsole();
        const service = createAnalyzer(nullConsole);
        const commandLineOptions = new CommandLineOptions(cwd, /* fromLanguageServer */ false);
        commandLineOptions.configFilePath = 'src/tests/samples/project1';
        service.setOptions(commandLineOptions);

        const config = service.test_getConfigOptions(commandLineOptions);
        assert.deepStrictEqual(config.defaultPythonVersion, pythonVersion3_13);
    });

    function createAnalyzer(console?: ConsoleInterface) {
        const cons = console ?? new NullConsole();
        const fs = createFromRealFileSystem(tempFile, cons);
        const serviceProvider = createServiceProvider(fs, cons, tempFile);
        const host = new TestAccessHost();
        host.getPythonVersion = () => pythonVersion3_13;
        return new AnalyzerService('<default>', serviceProvider, { console: cons, hostFactory: () => host });
    }
});
