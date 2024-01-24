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
import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface, NullConsole } from '../common/console';
import { NoAccessHost } from '../common/host';
import { combinePaths, normalizePath, normalizeSlashes } from '../common/pathUtils';
import { PythonVersion } from '../common/pythonVersion';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';
import { cloneDeep } from 'lodash';
import { deserialize, serialize } from '../backgroundThreadBase';

function createAnalyzer(console?: ConsoleInterface) {
    const cons = console ?? new NullConsole();
    const fs = createFromRealFileSystem(cons);
    const serviceProvider = createServiceProvider(fs, cons);
    return new AnalyzerService('<default>', serviceProvider, { console: cons });
}

test('FindFilesWithConfigFile', () => {
    const cwd = normalizePath(process.cwd());
    const service = createAnalyzer();
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project1';

    const configOptions = service.test_getConfigOptions(commandLineOptions);
    service.setOptions(commandLineOptions);

    // The config file specifies a single file spec (a directory).
    assert.strictEqual(configOptions.include.length, 1, `failed creating options from ${cwd}`);
    assert.strictEqual(
        configOptions.projectRoot.key,
        service.fs.realCasePath(Uri.file(combinePaths(cwd, commandLineOptions.configFilePath))).key
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
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_exclude';

    service.setOptions(commandLineOptions);

    // The config file is empty, so no 'exclude' are specified
    // The myvenv directory is detected as a venv and will be automatically excluded
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 python file in myvenv, which should be excluded
    const fileNames = fileList.map((p) => p.fileName).sort();
    assert.deepStrictEqual(fileNames, ['sample1.py', 'sample2.py', 'sample3.py']);
});

test('FindFilesVirtualEnvAutoDetectInclude', () => {
    const cwd = normalizePath(process.cwd());
    const service = createAnalyzer();
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_include';

    service.setOptions(commandLineOptions);

    // Config file defines 'exclude' folder so virtual env will be included
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 more python file in excluded folder
    // There is 1 python file in myvenv, which should be included
    const fileNames = fileList.map((p) => p.fileName).sort();
    assert.deepStrictEqual(fileNames, ['library1.py', 'sample1.py', 'sample2.py', 'sample3.py']);
});

test('FileSpecNotAnArray', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
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
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
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
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.configFilePath = 'src/tests/samples/project4';
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The config file specifies four file specs in the include array
    // and one in the exclude array.
    assert.strictEqual(configOptions.include.length, 4, `failed creating options from ${cwd}`);
    assert.strictEqual(configOptions.exclude.length, 1);
    assert.strictEqual(
        configOptions.projectRoot.getFilePath(),
        service.fs.realCasePath(Uri.file(combinePaths(cwd, commandLineOptions.configFilePath))).getFilePath()
    );

    const fileList = service.test_getFileNamesFromFileSpecs();

    // We should receive two final files that match the include/exclude rules.
    assert.strictEqual(fileList.length, 2);
});

test('ConfigBadJson', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.configFilePath = 'src/tests/samples/project5';
    service.setOptions(commandLineOptions);

    service.test_getConfigOptions(commandLineOptions);

    // The method should return a default config and log an error.
    assert(nullConsole.infoCount > 0);
});

test('FindExecEnv1', () => {
    const cwd = Uri.file(normalizePath(process.cwd()));
    const configOptions = new ConfigOptions(cwd);

    // Build a config option with three execution environments.
    const execEnv1 = new ExecutionEnvironment(
        'python',
        cwd.resolvePaths('src/foo'),
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    );
    configOptions.executionEnvironments.push(execEnv1);
    const execEnv2 = new ExecutionEnvironment(
        'python',
        cwd.resolvePaths('src'),
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
    const file4 = Uri.file('/nothing/bar.py');
    const defaultExecEnv = configOptions.findExecEnvironment(file4);
    assert(defaultExecEnv.root);
    const rootFilePath = Uri.isUri(defaultExecEnv.root) ? defaultExecEnv.root.getFilePath() : defaultExecEnv.root;
    assert.strictEqual(normalizeSlashes(rootFilePath), normalizeSlashes(configOptions.projectRoot.getFilePath()));
});

test('PythonPlatform', () => {
    const cwd = Uri.file(normalizePath(process.cwd()));

    const configOptions = new ConfigOptions(cwd);

    const json = JSON.parse(`{
        "executionEnvironments" : [
        {
            "root": ".",
            "pythonVersion" : "3.7",
            "pythonPlatform" : "platform",
            "extraPaths" : []
    }]}`);

    const fs = new TestFileSystem(/* ignoreCase */ false);
    const nullConsole = new NullConsole();

    const sp = createServiceProvider(fs, nullConsole);
    configOptions.initializeFromJson(json, undefined, sp, new NoAccessHost());

    const env = configOptions.executionEnvironments[0];
    assert.strictEqual(env.pythonPlatform, 'platform');
});

test('AutoSearchPathsOn', () => {
    const cwd = Uri.file(normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src')));
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd.getFilePath(), /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = true;
    //hacky way to prevent it from detecting the pyproject.toml at the root of this project
    commandLineOptions.fromVsCodeExtension = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    const expectedExtraPaths = [service.fs.realCasePath(cwd.combinePaths('src'))];
    assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
});

test('AutoSearchPathsOff', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = false;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    assert.deepStrictEqual(configOptions.executionEnvironments, []);
});

test('AutoSearchPathsOnSrcIsPkg', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_is_pkg'));
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The src folder is a package (has __init__.py) and so should not be automatically added as extra path
    assert.deepStrictEqual(configOptions.executionEnvironments, []);
});

test('AutoSearchPathsOnWithConfigExecEnv', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_extra_paths'));
    const nullConsole = new NullConsole();
    const service = createAnalyzer(nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.configFilePath = combinePaths(cwd, 'pyrightconfig.json');
    commandLineOptions.autoSearchPaths = true;
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
        service.fs.isCaseSensitive
    );
    const commandLineOptions = new CommandLineOptions(cwd.getFilePath(), /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = true;
    commandLineOptions.extraPaths = ['src/_vendored'];
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    const expectedExtraPaths: Uri[] = [
        service.fs.realCasePath(cwd.combinePaths('src')),
        service.fs.realCasePath(cwd.combinePaths('src', '_vendored')),
    ];

    assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
});

const setupPyprojectToml = (projectPath: string) => {
    const cwd = normalizePath(combinePaths(process.cwd(), projectPath));
    const service = createAnalyzer();
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);

    service.setOptions(commandLineOptions);

    return service.test_getConfigOptions(commandLineOptions);
};

test('BasicPyprojectTomlParsing', () => {
    const configOptions = setupPyprojectToml('src/tests/samples/project_with_pyproject_toml');
    assert.strictEqual(configOptions.defaultPythonVersion!, PythonVersion.V3_9);
    assert.strictEqual(configOptions.diagnosticRuleSet.reportMissingImports, 'error');
    assert.strictEqual(configOptions.diagnosticRuleSet.reportUnusedClass, 'warning');
});

test('basedPyprojectTomlParsing', () => {
    const configOptions = setupPyprojectToml('src/tests/samples/based_project_with_pyproject_toml');
    assert.strictEqual(configOptions.defaultPythonVersion!, PythonVersion.V3_9);
    assert.strictEqual(configOptions.diagnosticRuleSet.reportMissingImports, 'error');
    assert.strictEqual(configOptions.diagnosticRuleSet.reportUnusedClass, 'warning');
});

test('both pyright and basedpyright in pyproject.toml', () => {
    const configOptions = setupPyprojectToml('src/tests/samples/project_with_both_config_sections_in_pyproject_toml');
    assert.strictEqual(configOptions.defaultPythonVersion!, undefined);
});

test('FindFilesInMemoryOnly', () => {
    const cwd = normalizePath(process.cwd());
    const service = createAnalyzer();
    const commandLineOptions = new CommandLineOptions('', /* fromVsCodeExtension */ true);
    // Force a lookup of the typeshed path. This causes us to try and generate a module path for the untitled file.
    commandLineOptions.typeshedPath = combinePaths(cwd, 'src', 'tests', 'samples');
    service.setOptions(commandLineOptions);

    // Open a file that is not backed by the file system.
    const untitled = Uri.parse('untitled:Untitled-1.py', true);
    service.setFileOpened(untitled, 1, '# empty');

    const fileList = service.test_getFileNamesFromFileSpecs();
    assert(fileList.filter((f) => f.equals(untitled)));
});

test('verify config fileSpecs after cloning', () => {
    const fs = new TestFileSystem(/* ignoreCase */ true);
    const configFile = {
        ignore: ['**/node_modules/**'],
    };

    const config = new ConfigOptions(Uri.file(process.cwd()));
    const sp = createServiceProvider(fs, new NullConsole());
    config.initializeFromJson(configFile, undefined, sp, new TestAccessHost());
    const cloned = cloneDeep(config);

    assert.deepEqual(config.ignore, cloned.ignore);
});

test('verify can serialize config options', () => {
    const config = new ConfigOptions(Uri.file(process.cwd()));
    const serialized = serialize(config);
    const deserialized = deserialize<ConfigOptions>(serialized);
    assert.deepEqual(config, deserialized);
    assert.ok(deserialized.findExecEnvironment(Uri.file('foo/bar.py')));
});
