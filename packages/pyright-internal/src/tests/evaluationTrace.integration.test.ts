/*
 * evaluationTrace.integration.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * pnpm run test:trace builds the unbundled runtime before running this suite.
 */

import * as assert from 'assert';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { CancellationToken } from 'vscode-languageserver';

import { capture, CaptureOptions } from '../trace/capture';
import { adapterFiles } from '../trace/nativeAdapter';
import { readTrace, TraceReader } from '../trace/reader';
import { Json, TraceRecord } from '../trace/recorder';
import { RuntimeLoader } from '../trace/runtimeLoader';

const integration = process.env.PYRIGHT_RUN_TRACE_TESTS === '1' ? describe : describe.skip;
const target = resolve(__dirname, '..', '..', '..', '..');

function fields(reader: TraceReader, reference: Json, sequence: number): Record<string, Json> {
    assert.ok(
        reference && !Array.isArray(reference) && typeof reference === 'object' && typeof reference.ref === 'string'
    );
    const state = reader.latest(reference.ref, sequence);
    assert.ok(state);
    return Object.fromEntries(state.data.fields as [string, Json][]);
}

integration('Evaluation trace real Program captures', () => {
    let directory: string;
    let outputs: string[];
    let directories: string[];
    beforeEach(() => {
        directory = mkdtempSync(resolve(tmpdir(), 'pyright-trace-'));
        outputs = [];
        directories = [];
    });
    afterEach(() => {
        for (const file of outputs) {
            unlinkSync(file);
        }
        for (const path of directories.reverse()) {
            rmdirSync(path);
        }
        rmdirSync(directory);
    });

    function syntheticRuntime() {
        const runtime = resolve(directory, 'runtime');
        for (const path of [runtime, resolve(runtime, 'analyzer'), resolve(runtime, 'common')]) {
            mkdirSync(path);
            directories.push(path);
        }
        const built = resolve(target, 'packages', 'pyright-internal', 'out', 'packages', 'pyright-internal', 'src');
        for (const file of adapterFiles(false)) {
            const output = resolve(runtime, ...file.split('/'));
            copyFileSync(resolve(built, ...file.split('/')), output);
            outputs.push(output);
        }
        const writeModule = (name: string, code: string) => {
            const path = resolve(runtime, name);
            writeFileSync(path, code);
            outputs.push(path);
            return path;
        };
        return { runtime, writeModule };
    }

    test.each([
        { name: 'top-level', expression: "module.exports = import('missing-module');" },
        { name: 'inside a function', expression: "module.exports = () => import('missing-module');" },
    ])('private CommonJS loader rejects dynamic import $name before body execution', ({ expression }) => {
        const { runtime, writeModule } = syntheticRuntime();
        const marker = resolve(directory, 'executed.txt');
        const path = writeModule(
            'unsupported.js',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n${expression}`
        );
        writeModule('parent.js', "module.exports = require('./unsupported');");
        writeModule('supported.js', 'module.exports = { supported: true };');
        const loader = new RuntimeLoader(runtime, false);
        try {
            for (const request of ['unsupported.js', 'unsupported.js', 'parent.js', 'parent.js']) {
                assert.throws(
                    () => loader.load(request),
                    (error) =>
                        error instanceof Error &&
                        error.message.includes('Unsupported dynamic import in private CommonJS runtime') &&
                        error.message.includes(`${path}:2:`)
                );
                assert.equal(existsSync(marker), false, 'Reject before the statement preceding import() executes');
            }
            // All failed local modules were evicted, so configuration/retry cannot
            // encounter partial exports from a previous failed load.
            loader.configure(undefined);
            assert.equal(loader.load<{ supported: boolean }>('supported.js').supported, true);
            loader.verifyUnchanged();
            loader.dispose();
            loader.configure(undefined);
            assert.throws(() => loader.load('unsupported.js'), /Unsupported dynamic import/);
        } finally {
            loader.dispose();
            if (existsSync(marker)) {
                unlinkSync(marker);
            }
        }
    });

    test('private CommonJS loader accepts import text in comments/strings and ordinary import-named methods', () => {
        const { runtime, writeModule } = syntheticRuntime();
        writeModule(
            'supported.js',
            `// import('not-an-import');
             /* import("also-not-an-import"); */
             const text = "import('just-text')";
             const receiver = { import() { return text; } };
             module.exports = receiver.import();`
        );
        const loader = new RuntimeLoader(runtime, false);
        try {
            assert.equal(loader.load('supported.js'), "import('just-text')");
            assert.equal(loader.load('supported.js'), "import('just-text')");
        } finally {
            loader.dispose();
        }
    });

    function compare(options: CaptureOptions) {
        const output = resolve(directory, 'trace.ndjson');
        const clean = capture({ ...options, mode: 'clean' });
        const audit = capture({ ...options, mode: 'audit' });
        outputs.push(output);
        const traced = capture({ ...options, mode: 'trace', output });
        for (const key of ['diagnostics', 'liveDiagnostics', 'work', 'automatic', 'analysisFiles']) {
            assert.deepEqual(traced[key], clean[key], `${key}: recording must not change native analysis`);
            assert.deepEqual(audit[key], clean[key], `${key}: hooks must not change native analysis`);
        }
        assert.deepEqual(traced.audit, audit.audit, 'native event/type/branch/callback witness must match');
        assert.equal(traced.activeFrames, 0);
        const reader = new TraceReader(readTrace(readFileSync(output, 'utf8')));
        assert.equal(reader.records[reader.records.length - 1].data.exhausted, false);
        assert.ok(reader.records.some((r) => r.kind === 'collection'));
        return reader;
    }

    test('ordinary generic and loop narrowing retain diagnostics, types and native work', () => {
        const input = resolve(target, 'packages', 'pyright-internal', 'src', 'tests', 'samples', 'evaluationTrace1.py');
        const text = readFileSync(input, 'utf8');
        const start = text.indexOf('result.append');
        const reader = compare({
            target,
            input,
            selection: { start, end: start + 'result.append(identity(value))'.length },
        });
        assert.ok(reader.records.some((r) => r.kind === 'generation' && r.data.label === 'flowIncompleteGeneration'));
        assert.ok(reader.records.some((r) => r.kind === 'generation' && r.data.label === 'incompleteGenCount'));
        assert.ok(reader.records.some((r) => r.kind === 'edge' && r.data.relation === 'observed-read'));
        const sites = reader.records[0].data.provenance as Record<string, Json>;
        assert.ok(JSON.stringify(sites).includes('pendingNodes'));
        const summary = reader.records.find((r) => r.kind === 'summary')!;
        assert.ok(JSON.stringify(summary.data.diagnostics).includes('list[int]'));
        assert.ok(!(summary.data.diagnostics as Json[]).some((d) => (d as Record<string, Json>).category === 0));
    }, 120000);

    test('exhausting the trace budget still completes the real native analysis', () => {
        const input = resolve(target, 'packages', 'pyright-internal', 'src', 'tests', 'samples', 'evaluationTrace1.py');
        const output = resolve(directory, 'partial.ndjson');
        const clean = capture({ target, input, mode: 'clean' });
        outputs.push(output);
        const traced = capture({ target, input, output, limits: { events: 30 } });
        assert.deepEqual(traced.diagnostics, clean.diagnostics);
        assert.equal(traced.activeFrames, 0);
        const reader = new TraceReader(readTrace(readFileSync(output, 'utf8')));
        assert.equal(reader.records[reader.records.length - 1].data.exhausted, true);
    }, 120000);

    test('real cancellation leaves an explicit aborted artifact and disposes native resources', () => {
        const input = resolve(target, 'packages', 'pyright-internal', 'src', 'tests', 'samples', 'evaluationTrace1.py');
        const output = resolve(directory, 'cancel.ndjson');
        outputs.push(output);
        assert.throws(() => capture({ target, input, output, cancellationToken: CancellationToken.Cancelled }));
        const records = readTrace(readFileSync(output, 'utf8'));
        assert.equal(records[records.length - 1].data.status, 'threw');
        const next = capture({ target, input, mode: 'clean' });
        assert.ok(Array.isArray(next.diagnostics));
    }, 120000);

    const experimental = process.env.PYRIGHT_TRACE_EXPERIMENTAL_TARGET ? test : test.skip;
    experimental(
        'existing experimental TOML/service paths fail synchronously at the unsupported local module',
        async () => {
            const runtime = resolve(
                process.env.PYRIGHT_TRACE_EXPERIMENTAL_TARGET!,
                'packages',
                'pyright-internal',
                'out',
                'packages',
                'pyright-internal',
                'src'
            );
            const loader = new RuntimeLoader(runtime, true);
            try {
                for (const request of [
                    'common/tomlUtils.js',
                    'analyzer/service.js',
                    'common/tomlUtils.js',
                    'analyzer/service.js',
                ]) {
                    assert.throws(
                        () => loader.load(request),
                        (error) =>
                            error instanceof Error &&
                            error.message.includes('Unsupported dynamic import in private CommonJS runtime') &&
                            error.message.includes('tomlUtils.js:')
                    );
                }
                loader.verifyUnchanged();
                // Let any incorrectly started import promise reject during the test.
                // There is deliberately no rejection handler to hide such a failure.
                await new Promise<void>((done) => setImmediate(done));
            } finally {
                loader.dispose();
            }
        }
    );
    experimental(
        'real failed baseline/candidate pair preserves first results and isolation boundaries',
        () => {
            const externalTarget = process.env.PYRIGHT_TRACE_EXPERIMENTAL_TARGET!;
            const input = process.env.PYRIGHT_TRACE_EXPERIMENTAL_INPUT!;
            assert.ok(input, 'Set PYRIGHT_TRACE_EXPERIMENTAL_INPUT to an existing Python input in the target');
            const start = Number(process.env.PYRIGHT_TRACE_EXPERIMENTAL_START);
            const end = Number(process.env.PYRIGHT_TRACE_EXPERIMENTAL_END);
            assert.ok(Number.isSafeInteger(start) && end > start, 'Provide an explicit source selection');
            const reader = compare({ target: externalTarget, input, experimental: true, selection: { start, end } });
            const pair = reader.pairs().find((p) => {
                const outcome = (span: string) => reader.timeline('return', span).find((r) => r.data.span === span);
                const baseline = outcome(p.baseline);
                const candidate = outcome(p.replay);
                return (
                    baseline &&
                    candidate &&
                    fields(reader, baseline.data.value, baseline.seq).failed === true &&
                    fields(reader, candidate.data.value, candidate.seq).failed === true
                );
            });
            assert.ok(pair, 'Selection must contain a real failed baseline/candidate pair');
            const checkpoint = (phase: string): TraceRecord => {
                const record = reader.checkpoint(pair.baseline, phase);
                assert.ok(record, `Missing ${phase}`);
                return record;
            };
            const live = checkpoint('complete-live');
            const liveEntry = fields(reader, (live.data.expressionEntries as Record<string, Json>).typeCache, live.seq);
            const first = reader.firstResult(pair.baseline)!;
            assert.ok(first);
            assert.deepEqual(liveEntry.typeResult, first.data.value, 'Live cache must hold the actual first result');
            assert.notEqual(fields(reader, first.data.value, first.seq).isIncomplete, true);
            const entry = checkpoint('entry');
            const unwind = checkpoint('unwind');
            assert.deepEqual(
                (entry.data.state as Record<string, Json>).typeCache,
                (unwind.data.state as Record<string, Json>).typeCache,
                'The original map reference survives native isolation'
            );
            assert.ok(reader.timeline('collection', pair.replay).some((r) => r.data.method === 'set'));
            assert.ok(reader.timeline('owner-state', pair.baseline).some((r) => r.data.label === 'getCodeFlowEngine'));
            const diff = reader.diff(pair.baseline, pair.replay);
            assert.ok(diff.baseline.changes.length > 0);
            assert.ok(diff.replay.firstResult);
        },
        120000
    );
});
