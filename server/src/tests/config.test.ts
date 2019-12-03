/*
* config.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for parsing of pyrightconfig.json files.
*/

import * as assert from 'assert';

import { AnalyzerService } from '../analyzer/service';
import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { combinePaths, normalizeSlashes } from '../common/pathUtils';

test('FindFilesWithConfigFile', () => {
    const service = new AnalyzerService('<default>', new NullConsole());
    const commandLineOptions = new CommandLineOptions(process.cwd(), true);
    commandLineOptions.configFilePath = 'src/tests/samples/project1';

    const configOptions = service.test_getConfigOptions(commandLineOptions);
    service.setOptions(commandLineOptions);

    // The config file specifies a single file spec (a directory).
    assert.equal(configOptions.include.length, 1);
    assert.equal(normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(process.cwd(), commandLineOptions.configFilePath)));

    const fileList = service.test_getFileNamesFromFileSpecs();

    // The config file specifies a subdirectory, so we should find
    // only two of the three "*.py" files present in the project
    // directory.
    assert.equal(fileList.length, 2);
});

test('FileSpecNotAnArray', () => {
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', nullConsole);
    const commandLineOptions = new CommandLineOptions(process.cwd(), false);
    commandLineOptions.configFilePath = 'src/tests/samples/project2';
    service.setOptions(commandLineOptions);

    service.test_getConfigOptions(commandLineOptions);

    // The method should return a default config and log an error.
    assert(nullConsole.logCount > 0);
});

test('FileSpecNotAString', () => {
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', nullConsole);
    const commandLineOptions = new CommandLineOptions(process.cwd(), false);
    commandLineOptions.configFilePath = 'src/tests/samples/project3';
    service.setOptions(commandLineOptions);

    service.test_getConfigOptions(commandLineOptions);

    // The method should return a default config and log an error.
    assert(nullConsole.logCount > 0);
});

test('SomeFileSpecsAreInvalid', () => {
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', nullConsole);
    const commandLineOptions = new CommandLineOptions(process.cwd(), false);
    commandLineOptions.configFilePath = 'src/tests/samples/project4';
    service.setOptions(commandLineOptions);

    const configOptions = service.test_getConfigOptions(commandLineOptions);

    // The config file specifies four file specs in the include array
    // and one in the exclude array.
    assert.equal(configOptions.include.length, 4);
    assert.equal(configOptions.exclude.length, 1);
    assert.equal(normalizeSlashes(configOptions.projectRoot),
        normalizeSlashes(combinePaths(process.cwd(), commandLineOptions.configFilePath)));

    const fileList = service.test_getFileNamesFromFileSpecs();

    // We should receive two final files that match the include/exclude rules.
    assert.equal(fileList.length, 2);
});

test('ConfigBadJson', () => {
    const nullConsole = new NullConsole();
    const service = new AnalyzerService('<default>', nullConsole);
    const commandLineOptions = new CommandLineOptions(process.cwd(), false);
    commandLineOptions.configFilePath = 'src/tests/samples/project5';
    service.setOptions(commandLineOptions);

    service.test_getConfigOptions(commandLineOptions);

    // The method should return a default config and log an error.
    assert(nullConsole.logCount > 0);
});

test('FindExecEnv1', () => {
    const configOptions = new ConfigOptions(process.cwd());

    // Build a config option with three execution environments.
    const execEnv1 = new ExecutionEnvironment('src/foo');
    configOptions.executionEnvironments.push(execEnv1);
    const execEnv2 = new ExecutionEnvironment('src');
    configOptions.executionEnvironments.push(execEnv2);

    const file1 = normalizeSlashes(combinePaths(process.cwd(), 'src/foo/bar.py'));
    assert.equal(configOptions.findExecEnvironment(file1), execEnv1);
    const file2 = normalizeSlashes(combinePaths(process.cwd(), 'src/foo2/bar.py'));
    assert.equal(configOptions.findExecEnvironment(file2), execEnv2);

    // If none of the execution environments matched, we should get
    // a default environment with the root equal to that of the config.
    const file4 = '/nothing/bar.py';
    const defaultExecEnv = configOptions.findExecEnvironment(file4);
    assert.equal(normalizeSlashes(defaultExecEnv.root),
        normalizeSlashes(configOptions.projectRoot));
});

test('PythonPlatform', () => {
    const nullConsole = new NullConsole();
    const configOptions = new ConfigOptions(process.cwd());

    const json = JSON.parse(`{
        "executionEnvironments" : [
        {
            "root": ".",
            "pythonVersion" : "3.7",
            "pythonPlatform" : "platform",
            "extraPaths" : []
    }]}`);

    configOptions.initializeFromJson(json, nullConsole);

    const env = configOptions.executionEnvironments[0];
    assert.equal(env.pythonPlatform, 'platform');
});
