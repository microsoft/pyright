/*
 * pythonVersion.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for pythonVersion module.
 */

import assert from 'assert';

import { PythonVersion, pythonVersion3_8 } from '../common/pythonVersion';

test('isEqualTo', () => {
    const version = PythonVersion.create(3, 8);
    assert.ok(PythonVersion.isEqualTo(version, version));
    assert.ok(PythonVersion.isEqualTo(version, { ...version }));
    assert.ok(PythonVersion.isEqualTo(undefined, undefined));
    assert.ok(!PythonVersion.isEqualTo(version, undefined));
    assert.ok(!PythonVersion.isEqualTo(undefined, version));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8)));
    assert.ok(PythonVersion.isEqualTo(version, pythonVersion3_8));
    assert.ok(!PythonVersion.isEqualTo(version, PythonVersion.create(3, 9)));
    assert.ok(!PythonVersion.isEqualTo(version, PythonVersion.create(4, 8)));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8, 1)));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8, 0, 'alpha')));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8, 0, 'alpha', 1)));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8, 0, 'final', 1)));
    assert.ok(PythonVersion.isEqualTo(version, PythonVersion.create(3, 8, 0, 'final', 0)));
});

test('isGreaterOrEqualTo', () => {
    const version = PythonVersion.create(3, 8);
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, version));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, { ...version }));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, undefined));
    assert.ok(!PythonVersion.isGreaterOrEqualTo(undefined, version));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7, 0, 'alpha')));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7, 0, 'alpha', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7, 0, 'beta', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7, 0, 'candidate', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 7, 0, 'final', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, pythonVersion3_8));
    assert.ok(!PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 9)));
    assert.ok(!PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(4, 8)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 8, 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 8, 0, 'alpha')));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 8, 0, 'alpha', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 8, 0, 'final', 1)));
    assert.ok(PythonVersion.isGreaterOrEqualTo(version, PythonVersion.create(3, 8, 0, 'final', 0)));
    assert.ok(
        PythonVersion.isGreaterOrEqualTo(PythonVersion.create(3, 8, 0, 'final'), PythonVersion.create(3, 8, 0, 'alpha'))
    );
});
