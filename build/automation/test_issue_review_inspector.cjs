// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { capture } = require('./issue_review_inspector.cjs');

async function observe(condition, expression = 'value') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-inspector-test-'));
    let disconnect;
    try {
        const dependencyRoot = path.resolve(__dirname, '..', '..', 'packages', 'pyright-internal');
        const support = require.resolve('source-map-support', { paths: [dependencyRoot] });
        const { SourceMapGenerator } = require(require.resolve('source-map', { paths: [path.dirname(support)] }));
        const sourceRoot = path.join(directory, 'src');
        fs.mkdirSync(sourceRoot);
        const bundle = path.join(directory, 'bundle.js');
        const content = 'module.exports = function visit(value) {\n    return value + 1;\n};\n';
        fs.writeFileSync(path.join(sourceRoot, 'example.ts'), content);
        fs.writeFileSync(bundle, content);
        const map = new SourceMapGenerator({ file: bundle });
        const source = 'test:///src/example.ts';
        map.setSourceContent(source, content);
        for (const line of [1, 2, 3]) {
            map.addMapping({ source, original: { line, column: 0 }, generated: { line, column: 0 } });
        }
        fs.writeFileSync(bundle + '.map', map.toString());
        const report = { mapped_breakpoints: [], hits: [], errors: [] };
        disconnect = await capture(
            {
                bundle,
                source_root: sourceRoot,
                dependency_root: dependencyRoot,
                breakpoints: (Array.isArray(condition) ? condition : [{ condition }]).map((target) => ({
                    file: 'example.ts',
                    line: 2,
                    expressions: [expression],
                    ...target,
                })),
            },
            report
        );
        const visit = require(bundle);
        assert.equal(visit(1), 2);
        assert.equal(visit(2), 3);
        return report;
    } finally {
        disconnect?.();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('a read-only condition skips unrelated calls and captures the matching source state', async () => {
    const report = await observe('value === 2');
    assert.deepEqual(report.errors, []);
    assert.equal(report.hits.length, 1);
    assert.equal(report.hits[0].actual_source.line, 2);
    assert.equal(report.hits[0].evaluations[0].result.result.value, 2);
});

test('an unconditional breakpoint still captures only its first hit', async () => {
    const report = await observe(null);
    assert.deepEqual(report.errors, []);
    assert.equal(report.hits.length, 1);
    assert.equal(report.hits[0].evaluations[0].result.result.value, 1);
});

test('small scalar projections are observed without a printer or recursive object serialization', async () => {
    const report = await observe('value === 2', '({ value, next: value + 1, category: typeof value })');
    assert.deepEqual(report.errors, []);
    const evaluation = report.hits[0].evaluations[0];
    assert.equal(evaluation.error, null);
    assert.equal(evaluation.result.exceptionDetails, undefined);
    assert.deepEqual(evaluation.result.result.value, { value: 2, next: 3, category: 'number' });
});

test('distinct conditions at the same location capture their own first matching calls', async () => {
    const report = await observe([{ condition: 'value === 1' }, { condition: 'value === 2' }]);
    assert.deepEqual(report.errors, []);
    assert.equal(report.mapped_breakpoints.length, 2);
    assert.equal(report.mapped_breakpoints[0].breakpoint_id, report.mapped_breakpoints[1].breakpoint_id);
    assert.deepEqual(
        report.hits.map((hit) => hit.evaluations[0].result.result.value),
        [1, 2]
    );
});

test('matching conditions at the same location can both capture the same call', async () => {
    const report = await observe([{ condition: 'value === 2' }, { condition: 'value === 2' }]);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(
        report.hits.map((hit) => hit.evaluations[0].result.result.value),
        [2, 2]
    );
});

test('a rejected condition does not discard another target at the same location', async () => {
    const report = await observe([{ condition: 'value' }, { condition: 'value === 2' }]);
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0], /expected a boolean/);
    assert.equal(report.hits.length, 1);
    assert.equal(report.hits[0].evaluations[0].result.result.value, 2);
});

test('conditions cannot mutate the debuggee or be treated as truthy non-booleans', async () => {
    const mutation = await observe('(globalThis.__pyrightConditionMutation = true)');
    assert.equal(globalThis.__pyrightConditionMutation, undefined);
    assert.equal(mutation.hits.length, 0);
    assert.match(mutation.errors.join('\n'), /condition failed/);
    const nonBoolean = await observe('value');
    assert.equal(nonBoolean.hits.length, 0);
    assert.match(nonBoolean.errors.join('\n'), /expected a boolean/);
});

test('read-only state expressions still reject side effects', async () => {
    const report = await observe('value === 2', 'globalThis.__pyrightExpressionMutation = true');
    assert.equal(globalThis.__pyrightExpressionMutation, undefined);
    assert.equal(report.hits.length, 1);
    assert.ok(report.hits[0].evaluations[0].result.exceptionDetails);
});
