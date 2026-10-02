/*
 * evaluationTrace.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

import { instrument } from '../trace/nativeAdapter';
import { NativeBridge } from '../trace/nativeBridge';
import { readTrace, TraceReader } from '../trace/reader';
import { Atom, Recorder, TraceRecord } from '../trace/recorder';

function entity(atom: Atom): string {
    assert.ok(atom && typeof atom === 'object' && 'ref' in atom);
    return atom.ref;
}

function recording(limits = {}) {
    const records: TraceRecord[] = [];
    const recorder = new Recorder((record) => records.push(record), { test: true }, limits, 'unit');
    return { records, recorder };
}

test('Evaluation trace: identities differ from occurrences and observed versions', () => {
    const { recorder, records } = recording();
    const type = { category: 1, flags: 0 };
    const result = { type };
    const id = entity(recorder.observe(result, 'first'));
    assert.equal(entity(recorder.observe(result, 'second')), id);
    assert.notEqual(entity(recorder.atom({ type })), id);
    assert.notEqual(recorder.occurrence(), recorder.occurrence());
    assert.equal(new TraceReader(records).history(id).length, 1);
    assert.equal(records.filter((r) => r.kind === 'observation' && r.data.entity === id).length, 2);
    type.flags = 1;
    recorder.observe(result, 'third');
    const reader = new TraceReader(records);
    assert.equal(reader.history(id).length, 1);
    const typeHistory = reader.history(entity(recorder.atom(type)));
    assert.equal(typeHistory.length, 2);
    assert.equal(typeHistory[1].data.writer, 'unknown-between-observations');
    assert.ok(reader.neighborhood(id, 'reference').length);
    assert.equal(reader.neighborhood(id, 'observed-read').length, 0);
});

test('Evaluation trace: restoring a map reference does not restore entry contents', () => {
    const { recorder, records } = recording();
    const expected = { type: { name: 'int' }, candidates: [] as object[] };
    let map = new Map([[1, expected]]);
    const saved = map;
    const mapId = entity(recorder.observe(map, 'entry'));
    const entryId = entity(recorder.atom(expected));
    map = new Map();
    recorder.observe(map, 'isolation');
    expected.type = { name: 'str' };
    expected.candidates.push(expected.type);
    map = saved;
    recorder.observe(map, 'unwind');
    const reader = new TraceReader(records);
    assert.equal(entity(recorder.atom(map)), mapId);
    assert.equal(reader.history(mapId).length, 1);
    assert.equal(reader.history(entryId).length, 2);
    assert.equal(reader.latest(entryId)?.data.version, 2);
});

test('Evaluation trace: cycles, maps, sets, undefined, accessors and printers are passive', () => {
    const { recorder, records } = recording();
    let calls = 0;
    const object: Record<string, unknown> = { missing: undefined, set: new Set([undefined, NaN, BigInt(3)]) };
    object.self = object;
    object.printType = () => calls++;
    object.toJSON = () => calls++;
    Object.defineProperty(object, 'inferredType', { get: () => ++calls, enumerable: true });
    const proxy = new Proxy(
        {},
        {
            ownKeys: () => {
                calls++;
                throw new Error('proxy trap');
            },
        }
    );
    recorder.observe(new Map([[object, proxy]]), 'native', 5);
    recorder.finish('completed');
    assert.equal(calls, 0);
    const encoded = JSON.stringify(records);
    assert.ok(encoded.includes('accessor-not-invoked'));
    assert.ok(encoded.includes('opaque-proxy'));
    assert.ok(encoded.includes('bigint:3'));
    assert.ok(encoded.includes('"special":"undefined"'));
});

test('Evaluation trace: event/entity/depth/byte limits remain explicit', () => {
    const { recorder, records } = recording({ events: 10, entities: 2, bytes: 4096, depth: 1 });
    let nativeWork = 0;
    for (let i = 0; i < 100; i++) {
        nativeWork++;
        recorder.observe({ child: { i } }, 'loop');
        recorder.emit('branch', { taken: true });
    }
    recorder.finish('completed');
    assert.equal(nativeWork, 100);
    assert.equal(records[records.length - 1].kind, 'footer');
    assert.equal(records[records.length - 1].data.exhausted, true);
    assert.ok(Buffer.byteLength(records.map((r) => JSON.stringify(r)).join('\n')) <= 4096);
    assert.throws(() => recorder.finish('completed'), /already finished/);
});

test('Evaluation trace: independent recorder lifetimes do not share identities', () => {
    const object = {};
    const first = new Recorder(() => {}, {});
    const second = new Recorder(() => {}, {});
    assert.notEqual(entity(first.atom(object)), entity(second.atom(object)));
    first.finish('completed');
    assert.ok(second.active);
    second.finish('completed');
});

test('Evaluation trace: schema validation rejects malformed, unsupported and unfinished runs', () => {
    const { recorder, records } = recording();
    recorder.observe({}, 'test');
    recorder.finish('completed');
    const text = records.map((r) => JSON.stringify(r)).join('\n');
    assert.equal(readTrace(text).length, records.length);
    assert.throws(() => readTrace(text.replace('"version":1', '"version":99')), /schema/);
    assert.throws(
        () =>
            readTrace(
                records
                    .slice(0, -1)
                    .map((r) => JSON.stringify(r))
                    .join('\n')
            ),
        /footer/
    );
    assert.throws(() => readTrace(text.replace('"seq":2', '"seq":17')), /sequence/);
    assert.throws(() => readTrace(text.replace('"fields":[]', '"fields":{}')), /state payload/);
    assert.throws(() => readTrace(text, 1), /byte limit/);
});

// A small native-shaped module exercises the same AST method transformation as
// real diagnostics. These are test fixtures, not events claimed to be Pyright work.
const diagnosticModule = `
class DiagnosticSink {
    constructor() { this._diagnosticList = []; this._diagnosticMap = new Map(); }
    fetchAndClear() { const result = this._diagnosticList; this._diagnosticList = []; return result; }
    addDiagnostic(diag) {
        if (diag.cancel) { throw diag.cancel; }
        this._diagnosticList.push(diag);
        this._diagnosticMap.set(diag, diag);
        return diag;
    }
    addDiagnostics(diags) { for (const diag of diags) { this.addDiagnostic(diag); } }
}
module.exports = DiagnosticSink;
`;

function loadDiagnostic(bridge: NativeBridge, code: string) {
    const module: { exports: unknown } = { exports: undefined };
    runInThisContext(`(function(module, __pyrightTrace) {${code}})`)(module, bridge);
    return module.exports as new () => {
        addDiagnostic(value: object): object;
        addDiagnostics(values: object[]): void;
        fetchAndClear(): object[];
    };
}

test('Evaluation trace: AST hooks preserve receiver, arguments, return, cancellation and cleanup', () => {
    const transformed = instrument('common/diagnosticSink.js', diagnosticModule);
    const { recorder, records } = recording();
    const bridge = new NativeBridge(transformed.sites, recorder);
    const Sink = loadDiagnostic(bridge, transformed.code);
    const sink = new Sink();
    const value = { message: 'diagnostic' };
    assert.equal(sink.addDiagnostic(value), value);
    assert.deepEqual(sink.fetchAndClear(), [value]);
    const cancellation = new Error('native cancellation');
    assert.throws(
        () => sink.addDiagnostic({ cancel: cancellation }),
        (error) => error === cancellation
    );
    assert.equal(bridge.activeFrames, 0);
    assert.deepEqual(sink.fetchAndClear(), []);
    assert.ok(records.some((r) => r.kind === 'throw'));
    assert.ok(records.some((r) => r.kind === 'collection' && r.data.method === 'set'));
    assert.ok(transformed.sites.some((s) => s.text === 'diag.cancel'));
});

test('Evaluation trace: observer failure cannot replace a native return or throw', () => {
    const transformed = instrument('common/diagnosticSink.js', diagnosticModule);
    let writes = 0;
    const recorder = new Recorder(() => {
        if (++writes > 1) {
            throw new Error('disk full');
        }
    }, {});
    const bridge = new NativeBridge(transformed.sites, recorder);
    const Sink = loadDiagnostic(bridge, transformed.code);
    const sink = new Sink();
    const diagnostic = {};
    assert.equal(sink.addDiagnostic(diagnostic), diagnostic);
    assert.equal(bridge.failure, 'disk full');
    const error = new Error('native error');
    assert.throws(
        () => sink.addDiagnostic({ cancel: error }),
        (thrown) => thrown === error
    );
    assert.equal(bridge.activeFrames, 0);
});

test('Evaluation trace: AST drift rejects missing or ambiguous hooks', () => {
    assert.throws(() => instrument('common/diagnosticSink.js', ''), /found 0/);
    assert.throws(
        () => instrument('common/diagnosticSink.js', diagnosticModule + '\nfunction addDiagnostic() {}'),
        /found 2/
    );
    assert.throws(
        () => instrument('common/diagnosticSink.js', diagnosticModule + '\nconst __pyrightTrace = 1;'),
        /collision/
    );
});

test('Evaluation trace: returned branch values and method access order are unchanged', () => {
    const bridge = new NativeBridge([]);
    const order: string[] = [];
    const receiver = {
        get run() {
            order.push('member');
            return function (this: unknown, arg: string) {
                assert.equal(this, receiver);
                order.push(arg);
                return receiver;
            };
        },
    };
    assert.equal(bridge.method('unused', receiver, 'run')((order.push('argument'), 'call')), receiver);
    assert.deepEqual(order, ['member', 'argument', 'call']);
    assert.equal(bridge.branch('unused', receiver), receiver);
});

// These traces model ancestry and observed state only. They are not native work.
function boundaryFixture(
    options: {
        nestedBaseline?: boolean;
        nestedReplay?: boolean;
        interruptedBaseline?: boolean;
        interruptedReplay?: boolean;
        truncatedBaseline?: boolean;
        ordinary?: boolean;
    } = {}
) {
    const { recorder, records } = recording(options.truncatedBaseline ? { events: 300 } : {});
    const state = { value: 0 };
    const stateId = entity(recorder.atom(state));
    const expression = recorder.atom({});
    const operation = recorder.atom({});
    const nestedOperation = recorder.atom({});
    const outerResults = new Map<string, string>();
    const nestedSpans: string[] = [];
    const begin = (label: string, parent: string | null, role: string, nested = false) => {
        const span = recorder.occurrence();
        recorder.emit('enter', {
            span,
            parent,
            role,
            label,
            site: 'synthetic',
            operation: nested ? nestedOperation : operation,
            expression,
            args: { node: expression },
        });
        return span;
    };
    const checkpoint = (span: string, phase: string) => {
        recorder.observe(state, `${span}:${phase}`);
        recorder.emit('checkpoint', { span, phase });
    };
    const end = (span: string, label: string) => recorder.emit('exit', { span, label });
    const evaluate = (parent: string, role: string) => {
        const span = begin('getTypeOfExpression', parent, role);
        const value = recorder.atom({ type: {} });
        recorder.emit('return', { span, label: 'getTypeOfExpression', value });
        end(span, 'getTypeOfExpression');
        return span;
    };
    const nested = (parent: string, role: string) => {
        const span = begin('_trial', parent, role, true);
        nestedSpans.push(span);
        checkpoint(span, 'entry');
        const evaluation = begin('evaluateAndContinue', span, role, true);
        evaluate(evaluation, role);
        state.value++;
        checkpoint(evaluation, 'complete-live');
        end(evaluation, 'evaluateAndContinue');
        checkpoint(span, 'unwind');
        end(span, '_trial');
    };
    const side = (role: string, hasNested: boolean, interrupted: boolean, truncated: boolean) => {
        const label = options.ordinary ? 'ordinary-scope' : '_trial';
        const span = begin(label, null, role);
        checkpoint(span, 'entry');
        const evaluation = begin('evaluateAndContinue', span, role);
        if (hasNested) {
            nested(evaluation, role);
        }
        if (truncated) {
            while (recorder.active) {
                recorder.emit('branch', { span, taken: true });
            }
        }
        if (!interrupted) {
            outerResults.set(span, evaluate(evaluation, role));
            state.value++;
            checkpoint(evaluation, 'complete-live');
        } else {
            recorder.emit('throw', { span: evaluation });
        }
        end(evaluation, 'evaluateAndContinue');
        checkpoint(span, 'unwind');
        end(span, label);
        return span;
    };
    const baseline = side(
        'baseline',
        !!options.nestedBaseline,
        !!options.interruptedBaseline,
        !!options.truncatedBaseline
    );
    const replay = side('candidate', !!options.nestedReplay, !!options.interruptedReplay, false);
    recorder.finish('completed');
    const text = records.map((r) => JSON.stringify(r)).join('\n');
    return { reader: new TraceReader(readTrace(text)), baseline, replay, stateId, nestedSpans, outerResults };
}

test.each([
    { name: 'non-nested', nestedBaseline: false, nestedReplay: false, versions: [1, 2, 2, 2, 3, 3] },
    { name: 'nested baseline', nestedBaseline: true, nestedReplay: false, versions: [1, 3, 3, 3, 4, 4] },
    { name: 'nested replay', nestedBaseline: false, nestedReplay: true, versions: [1, 2, 2, 2, 4, 4] },
    { name: 'nested baseline and replay', nestedBaseline: true, nestedReplay: true, versions: [1, 3, 3, 3, 5, 5] },
])('Evaluation trace: $name boundaries belong to the nearest trial', (options) => {
    const fixture = boundaryFixture(options);
    const { reader, baseline, replay, stateId, nestedSpans, outerResults } = fixture;
    const diff = reader.diff(baseline, replay);
    const comparison = diff.boundaryComparisons.entities.find((e) => e.entity === stateId)!;
    assert.deepEqual(comparison.versions, options.versions);
    assert.equal(comparison.betweenTrials, 'same-fields');
    assert.equal(reader.checkpoint(baseline, 'unwind')?.data.span, baseline);
    assert.equal(reader.checkpoint(replay, 'unwind')?.data.span, replay);
    assert.equal(reader.firstResult(baseline)?.data.span, outerResults.get(baseline));
    assert.equal(reader.firstResult(replay)?.data.span, outerResults.get(replay));
    assert.ok(reader.pairs().some((p) => p.baseline === baseline && p.replay === replay));
    assert.equal(diff.baseline.counts['enter:getTypeOfExpression:'], options.nestedBaseline ? 2 : 1);
    assert.equal(diff.replay.counts['enter:getTypeOfExpression:'], options.nestedReplay ? 2 : 1);
    for (const span of nestedSpans) {
        assert.equal(reader.checkpoint(span, 'unwind')?.data.span, span);
        assert.ok(reader.checkpoint(span, 'complete-live'));
    }
});

test.each([
    { name: 'baseline', nestedBaseline: true, interruptedBaseline: true, versions: [1, null, 2, 2, 3, 3] },
    { name: 'replay', nestedReplay: true, interruptedReplay: true, versions: [1, 2, 2, 2, null, 3] },
])('Evaluation trace: interrupted $name does not borrow nested completion or first result', (options) => {
    const { reader, baseline, replay, stateId } = boundaryFixture(options);
    const span = options.interruptedBaseline ? baseline : replay;
    assert.equal(reader.checkpoint(span, 'complete-live'), null);
    assert.equal(reader.firstResult(span), null);
    assert.ok(reader.timeline('checkpoint', span).some((r) => r.data.phase === 'complete-live'));
    const comparison = reader.boundaryComparisons(baseline, replay).entities.find((e) => e.entity === stateId)!;
    assert.deepEqual(comparison.versions, options.versions);
    assert.equal(options.interruptedBaseline ? comparison.baselineChange : comparison.replayChange, 'unobserved');
});

test('Evaluation trace: truncated outer completion and unwind remain unknown after a complete nested trial', () => {
    const { reader, baseline, replay, stateId } = boundaryFixture({ nestedBaseline: true, truncatedBaseline: true });
    assert.equal(reader.checkpoint(baseline, 'complete-live'), null);
    assert.equal(reader.checkpoint(baseline, 'unwind'), null);
    assert.equal(reader.records[reader.records.length - 1].data.exhausted, true);
    const comparison = reader.boundaryComparisons(baseline, replay).entities.find((e) => e.entity === stateId)!;
    assert.deepEqual(comparison.versions, [1, null, null, null, null, null]);
    assert.equal(comparison.betweenTrials, 'unobserved');
});

test('Evaluation trace: ordinary scopes and expression calls need no trial owner', () => {
    const { reader, baseline, replay, stateId, outerResults } = boundaryFixture({
        ordinary: true,
        nestedBaseline: true,
    });
    const comparison = reader.boundaryComparisons(baseline, replay).entities.find((e) => e.entity === stateId)!;
    assert.deepEqual(comparison.versions, [1, 3, 3, 3, 4, 4]);
    const call = outerResults.get(baseline)!;
    assert.equal(reader.firstResult(baseline)?.data.span, call);
    assert.equal(reader.firstResult(call)?.data.span, call);
});

test('Evaluation trace: unknown ancestry and ambiguous same-owner boundaries do not select a boundary', () => {
    const { reader, baseline } = boundaryFixture();
    const live = reader.checkpoint(baseline, 'complete-live')!;
    const missingParent = reader.records.filter((r) => !(r.kind === 'enter' && r.data.span === live.data.span));
    assert.equal(new TraceReader(missingParent).checkpoint(baseline, 'complete-live'), null);
    const duplicated = [...reader.records, { ...live, seq: reader.records.length + 1 }];
    assert.equal(new TraceReader(duplicated).checkpoint(baseline, 'complete-live'), null);
    assert.equal(reader.checkpoint('missing', 'entry'), null);
});

const nativeReentry = process.env.PYRIGHT_TRACE_REENTRY_ARTIFACT ? test : test.skip;
nativeReentry('Evaluation trace: preserved native reentry artifact resolves actual outer boundaries', () => {
    const text = readFileSync(process.env.PYRIGHT_TRACE_REENTRY_ARTIFACT!, 'utf8');
    const reader = new TraceReader(readTrace(text));
    const entries = new Map(reader.timeline('enter').map((r) => [String(r.data.span), r]));
    const nearestTrial = (span: string) => {
        let current: TraceRecord | undefined = entries.get(span);
        while (current && current.data.label !== '_trial') {
            current = entries.get(String(current.data.parent));
        }
        return current?.data.span;
    };
    let nestedCompletions = 0;
    for (const pair of reader.pairs()) {
        for (const span of [pair.baseline, pair.replay]) {
            const inclusive = reader.timeline('checkpoint', span);
            nestedCompletions += inclusive.filter(
                (r) => r.data.phase === 'complete-live' && nearestTrial(String(r.data.span)) !== span
            ).length;
            for (const phase of ['entry', 'complete-live', 'unwind']) {
                const owned = inclusive.filter(
                    (r) => r.data.phase === phase && nearestTrial(String(r.data.span)) === span
                );
                assert.equal(owned.length, 1, `Expected one native ${phase} for ${span}`);
                assert.equal(reader.checkpoint(span, phase), owned[0]);
            }
            const first = reader.firstResult(span);
            if (first) {
                assert.equal(nearestTrial(String(first.data.span)), span);
            }
        }
        const diff = reader.diff(pair.baseline, pair.replay);
        const inclusiveCalls = reader.timeline('enter', pair.baseline).filter((r) => r.data.label === '_trial').length;
        assert.equal(diff.baseline.counts['enter:_trial:'], inclusiveCalls);
        for (const comparison of diff.boundaryComparisons.entities) {
            const boundaries = [pair.baseline, pair.replay].flatMap((span) =>
                ['entry', 'complete-live', 'unwind'].map((phase) => reader.checkpoint(span, phase)!)
            );
            const expected = boundaries.map(
                (boundary) =>
                    reader.records.find(
                        (r) =>
                            r.kind === 'observation' &&
                            r.data.entity === comparison.entity &&
                            r.data.cause === `${boundary.data.span}:${boundary.data.phase}`
                    )?.data.version ?? null
            );
            assert.deepEqual(comparison.versions, expected);
        }
    }
    assert.ok(nestedCompletions > 0, 'The preserved artifact must contain a real nested completion');
});
