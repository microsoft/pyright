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
import { NullConsole } from '../common/console';
import { NoAccessHost } from '../common/host';
import { combinePaths, getBaseFileName, normalizePath, normalizeSlashes } from '../common/pathUtils';
import { PythonVersion } from '../common/pythonVersion';
import { createFromRealFileSystem } from '../common/realFileSystem';

test('FindFilesWithConfigFile', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project1';

    const configOptions = service.test_getConfigOptions(commandLineOptions);
    service.setOptions(commandLineOptions);

    // The config file specifies a single file spec (a directory).
    assert.strictEqual(configOptions.include.length, 1, `failed creating options from ${cwd}`);
    assert.strictEqual(
        normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(cwd, commandLineOptions.configFilePath))
    );

    const fileList = service.test_getFileNamesFromFileSpecs();

    // The config file specifies a subdirectory, so we should find
    // only two of the three "*.py" files present in the project
    // directory.
    assert.strictEqual(fileList.length, 2);
});

test('FindFilesVirtualEnvAutoDetectExclude', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_exclude';

    service.setOptions(commandLineOptions);

    // The config file is empty, so no 'exclude' are specified
    // The myvenv directory is detected as a venv and will be automatically excluded
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 python file in myvenv, which should be excluded
    const fileNames = fileList.map((p) => getBaseFileName(p)).sort();
    assert.deepStrictEqual(fileNames, ['sample1.py', 'sample2.py', 'sample3.py']);
});

test('FindFilesVirtualEnvAutoDetectInclude', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_include';

    service.setOptions(commandLineOptions);

    // Config file defines 'exclude' folder so virtual env will be included
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 more python file in excluded folder
    // There is 1 python file in myvenv, which should be included
    const fileNames = fileList.map((p) => getBaseFileName(p)).sort();
    assert.deepStrictEqual(fileNames, ['library1.py', 'sample1.py', 'sample2.py', 'sample3.py']);
});

test('FileSpecNotAnArray', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
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
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
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
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.configFilePath = 'src/tests/samples/project4';
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The config file specifies four file specs in the include array
    // and one in the exclude array.
    assert.strictEqual(configOptions.include.length, 4, `failed creating options from ${cwd}`);
    assert.strictEqual(configOptions.exclude.length, 1);
    assert.strictEqual(
        normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(cwd, commandLineOptions.configFilePath))
    );

    const fileList = service.test_getFileNamesFromFileSpecs();

    // We should receive two final files that match the include/exclude rules.
    assert.strictEqual(fileList.length, 2);
});

test('ConfigBadJson', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.configFilePath = 'src/tests/samples/project5';
    service.setOptions(commandLineOptions);

    service.test_getConfigOptions(commandLineOptions);

    // The method should return a default config and log an error.
    assert(nullConsole.infoCount > 0);
});

test('FindExecEnv1', () => {
    const cwd = normalizePath(process.cwd());
    const configOptions = new ConfigOptions(cwd);

    // Build a config option with three execution environments.
    const execEnv1 = new ExecutionEnvironment(
        'src/foo',
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    );
    configOptions.executionEnvironments.push(execEnv1);
    const execEnv2 = new ExecutionEnvironment(
        'src',
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    );
    configOptions.executionEnvironments.push(execEnv2);

    const file1 = normalizeSlashes(combinePaths(cwd, 'src/foo/bar.py'));
    assert.strictEqual(configOptions.findExecEnvironment(file1), execEnv1);
    const file2 = normalizeSlashes(combinePaths(cwd, 'src/foo2/bar.py'));
    assert.strictEqual(configOptions.findExecEnvironment(file2), execEnv2);

    // If none of the execution environments matched, we should get
    // a default environment with the root equal to that of the config.
    const file4 = '/nothing/bar.py';
    const defaultExecEnv = configOptions.findExecEnvironment(file4);
    assert(defaultExecEnv.root);
    assert.strictEqual(normalizeSlashes(defaultExecEnv.root), normalizeSlashes(configOptions.projectRoot));
});

test('PythonPlatform', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const configOptions = new ConfigOptions(cwd);

    const json = JSON.parse(`{
        "executionEnvironments" : [
        {
            "root": ".",
            "pythonVersion" : "3.7",
            "pythonPlatform" : "platform",
            "extraPaths" : []
    }]}`);

    configOptions.initializeFromJson(json, undefined, nullConsole, new NoAccessHost());

    const env = configOptions.executionEnvironments[0];
    assert.strictEqual(env.pythonPlatform, 'platform');
});

test('AutoSearchPathsOn', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    const expectedExtraPaths = [normalizePath(combinePaths(cwd, 'src'))];
    assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
});

test('AutoSearchPathsOff', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = false;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    assert.deepStrictEqual(configOptions.executionEnvironments, []);
});

test('AutoSearchPathsOnSrcIsPkg', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_is_pkg'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
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
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
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
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_no_extra_paths'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ false);
    commandLineOptions.autoSearchPaths = true;
    commandLineOptions.extraPaths = ['src/_vendored'];
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    const expectedExtraPaths: string[] = [
        normalizePath(combinePaths(cwd, 'src')),
        normalizePath(combinePaths(cwd, 'src', '_vendored')),
    ];

    assert.deepStrictEqual(configOptions.defaultExtraPaths, expectedExtraPaths);
});

test('BasicPyprojectTomlParsing', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_with_pyproject_toml'));
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, /* fromVsCodeExtension */ true);

    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);
    assert.strictEqual(configOptions.defaultPythonVersion!, PythonVersion.V3_9);
    assert.strictEqual(configOptions.diagnosticRuleSet.reportMissingImports, 'error');
    assert.strictEqual(configOptions.diagnosticRuleSet.reportUnusedClass, 'warning');
});
