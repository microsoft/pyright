/*
 * logger.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for logger.
 */

import * as assert from 'assert';

import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, ConsoleWithLogLevel, LogLevel } from '../common/console';
import { timingStats } from '../common/timing';
import * as TestUtils from './testUtils';

class TestConsole implements ConsoleInterface {
    errors: string[] = [];
    warnings: string[] = [];
    infos: string[] = [];
    logs: string[] = [];

    error(message: string): void {
        this.errors.push(message);
    }
    warn(message: string): void {
        this.warnings.push(message);
    }
    info(message: string): void {
        this.infos.push(message);
    }
    log(message: string): void {
        this.logs.push(message);
    }

    clear() {
        this.logs = [];
        this.errors = [];
        this.warnings = [];
        this.infos = [];
    }
}

describe('TypeEvaluatorWithTracker tests', () => {
    const consoleInterface = new TestConsole();
    const console = new ConsoleWithLogLevel(consoleInterface);
    const config = new ConfigOptions('.');

    beforeEach(() => {
        consoleInterface.clear();
    });
    afterEach(() => {
        consoleInterface.clear();
        timingStats.typeEvaluationTime.callCount = 0;
    });
    test('Log generated', () => {
        config.logTypeEvaluationTime = true;
        console.level = LogLevel.Log;

        TestUtils.typeAnalyzeSampleFiles(['badToken1.py'], config, console);
        assert.ok(consoleInterface.logs.length > 10, `No calls logged`);
        assert.ok(
            consoleInterface.logs.some((s) => s.includes('evaluateTypesForStatement')),
            `Inner evaluateTypesForStatement not found`
        );
    });

    test('Log not generated when level is error', () => {
        config.logTypeEvaluationTime = true;
        console.level = LogLevel.Error;

        TestUtils.typeAnalyzeSampleFiles(['badToken1.py'], config, console);
        assert.equal(consoleInterface.logs.length, 0, `Should not have any logs when logging level is error`);
    });

    test('Inner log not generated when eval is turned off', () => {
        config.logTypeEvaluationTime = false;
        console.level = LogLevel.Log;
        TestUtils.typeAnalyzeSampleFiles(['badToken1.py'], config, console);
        assert.equal(
            consoleInterface.logs.some((s) => s.includes('evaluateTypesForStatement')),
            false,
            `Inner evaluateTypesForStatement is being logged when it shouldnt`
        );
    });

    test('Timing is not captured in debug mode', () => {
        process.execArgv.push('inspect');
        config.logTypeEvaluationTime = false;
        console.level = LogLevel.Log;
        TestUtils.typeAnalyzeSampleFiles(['badToken1.py'], config, console);
        assert.equal(timingStats.typeEvaluationTime.callCount, 0, `Should not be tracking call counts when debugging`);
    });
});
