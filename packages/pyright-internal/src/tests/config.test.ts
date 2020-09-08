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
import { createFromRealFileSystem } from '../common/fileSystem';
import { combinePaths, getBaseFileName, normalizePath, normalizeSlashes } from '../common/pathUtils';
import { latestStablePythonVersion } from '../common/pythonVersion';

test('FindFilesWithConfigFile', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, true);
    commandLineOptions.configFilePath = 'src/tests/samples/project1';

    const configOptions = service.test_getConfigOptions(commandLineOptions);
    service.setOptions(commandLineOptions);

    // The config file specifies a single file spec (a directory).
    assert.equal(configOptions.include.length, 1, `failed creating options from ${cwd}`);
    assert.equal(
        normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(cwd, commandLineOptions.configFilePath))
    );

    const fileList = service.test_getFileNamesFromFileSpecs();

    // The config file specifies a subdirectory, so we should find
    // only two of the three "*.py" files present in the project
    // directory.
    assert.equal(fileList.length, 2);
});

test('FindFilesVirtualEnvAutoDetectExclude', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_exclude';

    service.setOptions(commandLineOptions);

    // The config file is empty, so no 'exclude' are specified
    // The myvenv directory is detected as a venv and will be automatically excluded
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 python file in myvenv, which should be excluded
    const fileNames = fileList.map((p) => getBaseFileName(p)).sort();
    assert.deepEqual(fileNames, ['sample1.py', 'sample2.py', 'sample3.py']);
});

test('FindFilesVirtualEnvAutoDetectInclude', () => {
    const cwd = normalizePath(process.cwd());
    const service = new AnalyzerService('<default>', createFromRealFileSystem(), new NullConsole());
    const commandLineOptions = new CommandLineOptions(cwd, true);
    commandLineOptions.configFilePath = 'src/tests/samples/project_with_venv_auto_detect_include';

    service.setOptions(commandLineOptions);

    // Config file defines 'exclude' folder so virtual env will be included
    const fileList = service.test_getFileNamesFromFileSpecs();

    // There are 3 python files in the workspace, outside of myvenv
    // There is 1 more python file in excluded folder
    // There is 1 python file in myvenv, which should be included
    const fileNames = fileList.map((p) => getBaseFileName(p)).sort();
    assert.deepEqual(fileNames, ['library1.py', 'sample1.py', 'sample2.py', 'sample3.py']);
});

test('FileSpecNotAnArray', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
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
    const commandLineOptions = new CommandLineOptions(cwd, false);
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
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.configFilePath = 'src/tests/samples/project4';
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The config file specifies four file specs in the include array
    // and one in the exclude array.
    assert.equal(configOptions.include.length, 4, `failed creating options from ${cwd}`);
    assert.equal(configOptions.exclude.length, 1);
    assert.equal(
        normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(cwd, commandLineOptions.configFilePath))
    );

    const fileList = service.test_getFileNamesFromFileSpecs();

    // We should receive two final files that match the include/exclude rules.
    assert.equal(fileList.length, 2);
});

test('ConfigBadJson', () => {
    const cwd = normalizePath(process.cwd());
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
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
    const execEnv1 = new ExecutionEnvironment('src/foo');
    configOptions.executionEnvironments.push(execEnv1);
    const execEnv2 = new ExecutionEnvironment('src');
    configOptions.executionEnvironments.push(execEnv2);

    const file1 = normalizeSlashes(combinePaths(cwd, 'src/foo/bar.py'));
    assert.equal(configOptions.findExecEnvironment(file1), execEnv1);
    const file2 = normalizeSlashes(combinePaths(cwd, 'src/foo2/bar.py'));
    assert.equal(configOptions.findExecEnvironment(file2), execEnv2);

    // If none of the execution environments matched, we should get
    // a default environment with the root equal to that of the config.
    const file4 = '/nothing/bar.py';
    const defaultExecEnv = configOptions.findExecEnvironment(file4);
    assert.equal(normalizeSlashes(defaultExecEnv.root), normalizeSlashes(configOptions.projectRoot));
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

    configOptions.initializeFromJson(json, undefined, nullConsole);

    const env = configOptions.executionEnvironments[0];
    assert.equal(env.pythonPlatform, 'platform');
});

test('AutoSearchPathsOn', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.autoSearchPaths = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // An execution environment is automatically created with src folder as extra path
    const expectedExecEnvs = [
        {
            pythonPlatform: undefined,
            pythonVersion: latestStablePythonVersion,
            root: cwd,
            extraPaths: [normalizePath(combinePaths(cwd, 'src'))],
        },
    ];

    assert.deepEqual(configOptions.executionEnvironments, expectedExecEnvs);
});

test('AutoSearchPathsOff', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.autoSearchPaths = false;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    assert.deepEqual(configOptions.executionEnvironments, []);
});

test('AutoSearchPathsOnSrcIsPkg', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_is_pkg'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.autoSearchPaths = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The src folder is a package (has __init__.py) and so should not be automatically added as extra path
    assert.deepEqual(configOptions.executionEnvironments, []);
});

test('AutoSearchPathsOnWithConfigExecEnv', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_config_exec_env'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.configFilePath = combinePaths(cwd, 'mspythonconfig.json');
    commandLineOptions.autoSearchPaths = true;
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // Execution environments are found in the config file, we do not modify them
    // (so auto search path option is ignored)
    const expectedExecEnvs = [
        {
            pythonPlatform: 'Windows',
            pythonVersion: 0x0305,
            root: cwd,
            extraPaths: [],
        },
    ];

    assert.deepEqual(configOptions.executionEnvironments, expectedExecEnvs);
});

test('AutoSearchPathsOnAndExtraPaths', () => {
    const cwd = normalizePath(combinePaths(process.cwd(), 'src/tests/samples/project_src_with_extra_paths'));
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', createFromRealFileSystem(nullConsole), nullConsole);
    const commandLineOptions = new CommandLineOptions(cwd, false);
    commandLineOptions.autoSearchPaths = true;
    commandLineOptions.extraPaths = ['src/_vendored'];
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // An execution environment is automatically created with src and src/_vendored as extra paths
    const expectedExecEnvs = [
        {
            pythonPlatform: undefined,
            pythonVersion: latestStablePythonVersion,
            root: cwd,
            extraPaths: [normalizePath(combinePaths(cwd, 'src')), normalizePath(combinePaths(cwd, 'src', '_vendored'))],
        },
    ];

    assert.deepEqual(configOptions.executionEnvironments, expectedExecEnvs);
});
