/*
 * evaluationTrace.viewer.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';
import { request } from 'http';
import { join } from 'path';

import { readTrace, TraceReader } from '../trace/reader';
import { Recorder, TraceRecord } from '../trace/recorder';
import { viewerMain } from '../trace/viewerClient';
import { reference, ViewerModel } from '../trace/viewerModel';
import { loadViewerModel, startViewer } from '../trace/viewerServer';

// Deliberately synthetic fixture: never asserted to be native Pyright execution.
function synthetic() {
    const records: TraceRecord[] = [];
    const recorder = new Recorder((r) => records.push(r), { synthetic: true }, {}, 'synthetic-viewer');
    const model = () =>
        new ViewerModel(new TraceReader(readTrace(records.map((r) => JSON.stringify(r)).join('\n'))), 'synthetic');
    return { recorder, records, model };
}

test('Evaluation viewer: temporal references replace both outgoing and incoming historical edges', () => {
    const { recorder, records, model } = synthetic();
    const old = { label: 'old' };
    const next = { label: 'new' };
    const source = { child: old };
    const id = reference(recorder.observe(source, 'before'))!;
    const oldId = reference(recorder.atom(old))!;
    const first = records.length;
    source.child = next;
    recorder.observe(source, 'replace');
    const nextId = reference(recorder.atom(next))!;
    const second = records.length;
    source.child = old;
    recorder.observe(source, 'restore reference');
    const third = records.length;
    recorder.finish('completed');
    const view = model();
    assert.equal(
        view.graph(oldId, first).edges.some((e) => e.from === id && e.to === oldId),
        true
    );
    assert.equal(
        view.graph(oldId, second).edges.some((e) => e.from === id),
        false
    );
    assert.equal(
        view.graph(id, second).edges.some((e) => e.to === oldId),
        false
    );
    assert.equal(
        view.graph(nextId, second).edges.some((e) => e.from === id),
        true
    );
    assert.equal(view.graph(oldId, third).edges.find((e) => e.from === id)?.version, 3);
    assert.equal(
        view.graph(nextId, third).edges.some((e) => e.from === id),
        false
    );
    assert.equal(view.entity(id, second).state?.version, 2);
    assert.equal(view.entity(id, first).fields.items[0].ref, oldId);
});

test('Evaluation viewer: past state stays unknown; repeated observations retain identity and sequence', () => {
    const { recorder, records, model } = synthetic();
    const object = {};
    const id = reference(recorder.atom(object))!;
    const before = records.length;
    recorder.observe(object, 'first');
    const first = records.length;
    recorder.observe(object, 'later, unchanged');
    const later = records.length;
    recorder.finish('completed');
    const view = model();
    assert.equal(view.entity(id, before).state, null);
    assert.equal(view.entity(id, 0).knownAtCursor, false);
    assert.equal(view.graph(id, before).nodes[0].version, null);
    assert.equal(
        view.entity(id, before).history.items.every((o) => o.afterCursor),
        true
    );
    assert.equal(view.entity(id, first).state?.observedSeq, first);
    assert.equal(view.entity(id, later).state?.observedSeq, later);
    assert.equal(view.entity(id, later).state?.version, 1);
});

test('Evaluation viewer: executed read/return edges use the cursor, not object-version dependency inference', () => {
    const { recorder, records, model } = synthetic();
    const span = recorder.occurrence();
    recorder.emit('enter', { span, label: 'synthetic evaluation', site: 'synthetic', role: 'ordinary' });
    const id = reference(recorder.observe({ type: {} }, 'read'))!;
    const before = records.length;
    recorder.emit('edge', { relation: 'observed-read', from: span, to: id });
    recorder.emit('edge', { relation: 'observed-return', from: span, to: id });
    const after = records.length;
    recorder.finish('completed');
    const view = model();
    assert.equal(view.graph(id, before, 'observed').edges.length, 0);
    assert.deepEqual(
        view.graph(id, after, 'observed').edges.map((e) => e.relation),
        ['observed-read', 'observed-return']
    );
    assert.equal(
        view.graph(id, after, 'reference').edges.some((e) => e.from === span),
        false
    );
    assert.equal(view.timeline({ kind: 'enter' }).items[0].span, span);
    assert.equal(view.pairs().total, 0);
});

test('Evaluation viewer: bounded graph/page expansion and opaque state are explicit', () => {
    const { recorder, records, model } = synthetic();
    const object = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [String(i), {}]));
    Object.defineProperty(object, 'hostileGetter', {
        get: () => {
            throw new Error('must not be called');
        },
    });
    const id = reference(recorder.observe(object, 'wide'))!;
    recorder.finish('completed');
    const view = model();
    const graph = view.graph(id, records.length);
    assert.equal(graph.capped, true);
    assert.ok(graph.nodes.length <= 40 && graph.edges.length <= 100);
    assert.equal(view.entity(id, records.length).state?.complete, false);
    assert.equal(view.entity(id, records.length).fields.items.length, 40);
    assert.equal(view.entity(id, records.length, 0, 40).fields.items.length, 31);
    assert.throws(() => view.entity('missing', 1), /Unknown entity/);
    assert.throws(() => view.entity(id, records.length + 1), /Sequence/);
    assert.throws(() => view.timeline({ limit: 101 }), /Invalid page/);
    assert.throws(() => view.timeline({ span: 'missing' }), /Unknown occurrence/);
    assert.throws(() => view.graph(id, 1, 'dependency'), /relation/);
    assert.throws(() => view.graph(id, 1, 'all', 3), /hops/);
});

function nestedPair(interrupted = false, afterMarker = false) {
    const fixture = synthetic();
    const { recorder, records } = fixture;
    const state = { value: 0 };
    const id = reference(recorder.atom(state))!;
    const expression = recorder.atom({});
    const operation = recorder.atom({});
    const sharedType = {};
    const enter = (label: string, role: string, parent: string | null, nested = false) => {
        const span = recorder.occurrence();
        recorder.emit('enter', {
            span,
            parent,
            label,
            role,
            site: 'synthetic',
            expression,
            args: { node: expression },
            operation: nested ? recorder.atom({}) : operation,
        });
        return span;
    };
    const checkpoint = (span: string, phase: string) => {
        if (afterMarker) {
            recorder.emit('checkpoint', { span, phase });
        }
        recorder.observe(state, `${span}:${phase}`);
        recorder.emit(afterMarker ? 'owner-state' : 'checkpoint', { span, phase, state: { cache: { ref: id } } });
    };
    const evaluate = (role: string, parent: string) => {
        const span = enter('getTypeOfExpression', role, parent);
        const value = recorder.observe({ type: sharedType, isIncomplete: false }, span);
        recorder.emit('return', { span, label: 'getTypeOfExpression', value });
        return reference(value);
    };
    const results: (string | undefined)[] = [];
    for (const role of ['baseline', 'candidate']) {
        const outer = enter('_trial', role, null);
        checkpoint(outer, 'entry');
        const live = enter('evaluateAndContinue', role, outer);
        const inner = enter('_trial', role, live, true);
        checkpoint(inner, 'entry');
        const innerLive = enter('evaluateAndContinue', role, inner, true);
        evaluate(role, innerLive);
        state.value++;
        checkpoint(innerLive, 'complete-live');
        checkpoint(inner, 'unwind');
        if (!interrupted || role === 'candidate') {
            results.push(evaluate(role, live));
            state.value++;
            checkpoint(live, 'complete-live');
        } else {
            recorder.emit('throw', { span: live });
        }
        checkpoint(outer, 'unwind');
        const value = recorder.observe(
            { failed: true, diagnostics: [{ message: 'synthetic private failure' }] },
            outer
        );
        recorder.emit('return', { span: outer, label: '_trial', value });
    }
    recorder.finish(interrupted ? 'threw' : 'completed');
    return { ...fixture, id, results, at: records.length };
}

test.each([false, true])('Evaluation viewer: nested boundary observation links (after marker: %s)', (afterMarker) => {
    const fixture = nestedPair(false, afterMarker);
    const model = fixture.model();
    const comparison = model.comparison(0);
    assert.deepEqual(comparison.changes.items.find((r) => r.entity === fixture.id)?.versions, [1, 3, 3, 3, 5, 5]);
    assert.deepEqual(
        comparison.sides.map((s) => s.firstResult?.id),
        fixture.results
    );
    assert.notEqual(fixture.results[0], fixture.results[1]);
    for (const side of comparison.sides) {
        assert.equal(side.counts.find((c) => c.name === 'enter:_trial:')?.count, 2);
        assert.equal(side.outcome?.failed, true);
        assert.equal(side.diagnostics[0].fields[0].value, 'synthetic private failure');
        for (const boundary of side.boundaries) {
            assert.equal(boundary.seq, model.reader.checkpoint(side.span, boundary.phase)?.seq);
        }
    }
    const versionRow = comparison.changes.items.find((r) => r.entity === fixture.id)!;
    comparison.sides
        .flatMap((s) => s.boundaries)
        .forEach((b, index) => {
            const seq = versionRow.observationSequences[index]!;
            const observation = model.reader.records[seq - 1];
            assert.equal(observation.kind, 'observation');
            assert.equal(observation.data.cause, `${b.span}:${b.phase}`);
            assert.equal(observation.data.entity, fixture.id);
            assert.equal(observation.data.version, versionRow.versions[index]);
            assert.equal(model.entity(fixture.id, seq).state?.version, versionRow.versions[index]);
            assert.equal(seq > b.seq!, afterMarker);
        });
    assert.equal(versionRow.stateSequences[1], versionRow.stateSequences[2]);
    assert.notEqual(versionRow.observationSequences[1], versionRow.observationSequences[2]);
    if (afterMarker) {
        assert.equal(model.entity(fixture.id, comparison.sides[0].boundaries[0].seq!).state, null);
    }
});

test('Evaluation viewer: aborted outer completion is unknown, never borrowed from the inner trial', () => {
    const comparison = nestedPair(true).model().comparison(0);
    assert.equal(comparison.sides[0].boundaries[1].seq, null);
    assert.equal(comparison.sides[0].firstResult, null);
    for (const row of comparison.changes.items) {
        assert.equal(row.observationSequences[1], null);
        assert.equal(row.stateSequences[1], null);
    }
});

test('Evaluation viewer: partial and missing boundary observations do not borrow a marker or earlier state', () => {
    const fixture = synthetic();
    const { recorder, records } = fixture;
    const operation = recorder.atom({});
    const state = Object.defineProperty({}, 'opaque', {
        get: () => {
            throw new Error('never invoke');
        },
    });
    const id = reference(recorder.atom(state))!;
    const spans = [recorder.occurrence(), recorder.occurrence()];
    for (const [index, span] of spans.entries()) {
        recorder.emit('enter', {
            span,
            label: '_trial',
            role: index ? 'candidate' : 'baseline',
            site: 'synthetic',
            operation,
        });
        recorder.emit('checkpoint', { span, phase: 'entry' });
        recorder.observe(state, `${span}:entry`);
        recorder.emit('owner-state', { span, phase: 'entry', state: { cache: { ref: id } } });
        // Marker exists, but no matching observation was captured for this phase.
        recorder.emit('checkpoint', { span, phase: 'complete-live' });
    }
    recorder.finish('recorder-failed', 'synthetic interruption before snapshots');
    const model = fixture.model();
    const row = model.comparison(0).changes.items.find((r) => r.entity === id)!;
    assert.deepEqual(row.versions, [1, null, null, 1, null, null]);
    assert.deepEqual(row.complete, [false, false, false, false, false, false]);
    assert.deepEqual(row.stateSequences, [row.stateSequences[0], null, null, row.stateSequences[0], null, null]);
    assert.ok(row.observationSequences[3]! > row.observationSequences[0]!);
    for (const index of [0, 3]) {
        const seq = row.observationSequences[index]!;
        assert.equal(records[seq - 1].data.version, 1);
        assert.equal(model.entity(id, seq).state?.complete, false);
    }
});

test('Evaluation viewer: navigation references cover actual metadata without inventing graph edges', () => {
    const { recorder, records, model } = synthetic();
    const cache = recorder.observe(new Map([[1, {}]]), 'synthetic');
    const entry = recorder.observe({ typeResult: {} }, 'synthetic');
    const owner = recorder.atom({});
    const error = recorder.observe(new Error('synthetic error'), 'synthetic');
    const span = recorder.occurrence();
    recorder.emit('enter', { span, label: 'scope', site: 'synthetic', role: 'ordinary' });
    const checkpoint = records.length + 1;
    recorder.emit('checkpoint', {
        span,
        phase: 'entry',
        owner,
        state: { typeCache: cache },
        expressionEntries: { typeCache: entry },
        inputs: entry,
        sink: cache,
    });
    const ownerState = records.length + 1;
    recorder.emit('owner-state', { span, phase: 'entry', owner, state: { reachabilityCache: cache } });
    const thrown = records.length + 1;
    recorder.emit('throw', { span, error });
    const read = records.length + 1;
    recorder.emit('edge', {
        relation: 'observed-read',
        from: span,
        to: reference(entry)!,
        cache,
        metadata: { context: entry },
    });
    recorder.finish('completed');
    const view = model();
    const event = view.event(checkpoint);
    assert.equal(event.references[0], reference(cache));
    assert.deepEqual(
        event.referenceLinks.map((r) => r.path),
        ['state.typeCache', 'expressionEntries.typeCache', 'inputs', 'sink', 'owner', 'span']
    );
    assert.equal(event.referenceClipping.length, 0);
    assert.ok(view.event(ownerState).referenceLinks.some((r) => r.path === 'state.reachabilityCache'));
    assert.ok(view.event(thrown).referenceLinks.some((r) => r.path === 'error' && r.id === reference(error)));
    assert.ok(view.event(read).referenceLinks.some((r) => r.path === 'cache' && r.id === reference(cache)));
    assert.ok(view.event(read).referenceLinks.some((r) => r.path === 'metadata.context' && r.id === reference(entry)));
    const created = records.find((r) => r.kind === 'entity')!;
    assert.deepEqual(view.event(created.seq).referenceLinks, [{ path: 'id', id: created.data.id }]);
    assert.equal(view.graph(reference(owner)!, checkpoint).edges.length, 0);
});

test('Evaluation viewer: reference traversal reports count, depth, item, work and path clipping', () => {
    const { recorder, records, model } = synthetic();
    const value = recorder.atom({});
    const span = recorder.occurrence();
    recorder.emit('enter', { span, site: 'synthetic', role: 'ordinary', label: 'scope' });
    const emit = (data: Record<string, import('../trace/recorder').Json>) => {
        const seq = records.length + 1;
        recorder.emit('checkpoint', { span, phase: 'test', ...data });
        return seq;
    };
    const count = emit({ state: Array.from({ length: 35 }, () => value) });
    const depth = emit({ state: { a: { b: { c: { d: value } } } } });
    const items = emit({ state: Array.from({ length: 90 }, () => 0) });
    const work = emit({ state: Array.from({ length: 20 }, () => Array.from({ length: 80 }, () => 0)) });
    const path = emit({ state: { ['x'.repeat(600)]: value } });
    recorder.finish('completed');
    const view = model();
    assert.equal(view.event(count).referenceLinks.length, 30);
    assert.ok(view.event(count).referenceClipping.includes('reference count'));
    assert.ok(view.event(depth).referenceClipping.includes('reference depth'));
    assert.ok(view.event(items).referenceClipping.includes('reference object/array items'));
    assert.ok(view.event(work).referenceClipping.includes('reference traversal nodes'));
    assert.ok(view.event(path).referenceClipping.includes('reference path text'));
    assert.ok(view.event(path).referenceLinks.every((r) => r.path.length <= 512));
});

test.each(['threw', 'recorder-failed'] as const)(
    'Evaluation viewer: %s capture and exhaustion remain visible',
    (status) => {
        const records: TraceRecord[] = [];
        const recorder = new Recorder((r) => records.push(r), { synthetic: true }, { events: 8 }, 'failed-viewer');
        recorder.observe({ values: Array.from({ length: 20 }, () => ({})) }, 'limited');
        recorder.finish(status, 'synthetic failure');
        const model = new ViewerModel(
            new TraceReader(readTrace(records.map((r) => JSON.stringify(r)).join('\n'))),
            'partial'
        );
        assert.deepEqual(model.summary().status, records[records.length - 1].data);
        assert.equal(records[records.length - 1].data.exhausted, true);
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
    }
);

function get(url: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ status: number; headers: import('http').IncomingHttpHeaders; body: string }>(
        (resolve, reject) => {
            const req = request(url, { method, headers, agent: false }, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () =>
                    resolve({
                        status: response.statusCode!,
                        headers: response.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    })
                );
            });
            req.on('error', reject);
            req.end();
        }
    );
}

test('Evaluation viewer server: fixed token routes, Host/origin protections, request validation and cleanup', async () => {
    const fixture = synthetic();
    fixture.recorder.observe({}, 'test');
    fixture.recorder.finish('completed');
    const server = await startViewer(fixture.model());
    const api = { 'X-Pyright-Trace-Viewer': '1' };
    try {
        const root = await get(server.url);
        assert.equal(root.status, 200);
        assert.match(String(root.headers['content-security-policy']), /frame-ancestors 'none'/);
        assert.equal(root.headers['access-control-allow-origin'], undefined);
        assert.equal((await get(server.url + 'api/summary', api)).status, 200);
        assert.equal((await get(server.url + 'api/summary')).status, 403);
        assert.equal((await get(server.url + 'api/summary', { ...api, Host: 'attacker.test' })).status, 403);
        assert.equal((await get(server.url + 'api/summary', { ...api, Origin: 'https://attacker.test' })).status, 403);
        assert.equal((await get(server.url, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
        assert.equal((await get(server.url + 'api/summary', api, 'POST')).status, 405);
        assert.equal((await get(server.url + 'api/summary?path=C:\\secret', api)).status, 400);
        assert.equal((await get(server.url + 'api/event?seq=-1', api)).status, 400);
        assert.equal((await get(server.url + 'api/event?seq=1&seq=2', api)).status, 400);
        assert.equal((await get(server.url + 'api/entity?id=missing&at=1', api)).status, 404);
        assert.equal((await get(server.url + 'api/timeline?limit=99999', api)).status, 400);
        assert.equal((await get(server.url + 'api/comparison?index=0', api)).status, 404);
        assert.equal((await get(new URL('/wrong-token/api/summary', server.url).href, api)).status, 404);
        assert.equal((await get(server.url + '../../package.json', api)).status, 404);
        const before = await get(server.url + 'api/timeline', api);
        assert.equal((await get(server.url + 'api/timeline', api)).body, before.body);
    } finally {
        await server.close();
    }
    await assert.rejects(() => get(server.url), /ECONNREFUSED/);
});

test('Evaluation viewer server: hostile labels stay JSON data and never enter executable assets', async () => {
    const fixture = synthetic();
    const hostile = '<img src="https://attacker.invalid/" onerror="globalThis.pwned=1"></script>';
    fixture.recorder.emit('enter', {
        span: fixture.recorder.occurrence(),
        role: 'ordinary',
        site: hostile,
        label: hostile,
    });
    fixture.recorder.finish('completed');
    const model = fixture.model();
    assert.equal(model.timeline({ query: 'attacker' }).items[0].label, hostile);
    const server = await startViewer(model);
    try {
        for (const asset of ['', 'client.js', 'style.css']) {
            const response = await get(server.url + asset);
            assert.equal(response.status, 200);
            assert.equal(response.body.includes(hostile), false);
        }
        const response = await get(server.url + 'api/timeline', { 'X-Pyright-Trace-Viewer': '1' });
        assert.equal(
            JSON.parse(response.body).items.find((r: { label: string }) => r.label === hostile).label,
            hostile
        );
        assert.equal(viewerMain.toString().includes('innerHTML'), false);
        assert.equal(viewerMain.toString().includes('textContent'), true);
    } finally {
        await server.close();
    }
});

test('Evaluation viewer: record and response limits fail explicitly rather than silently dropping data', async () => {
    const fixture = synthetic();
    fixture.recorder.finish('completed');
    assert.throws(
        () => new ViewerModel(new TraceReader(Array(400001).fill(fixture.records[0])), 'too many records'),
        /at most 400000/
    );
    const model = new ViewerModel(fixture.model().reader, 'x'.repeat(2 * 1024 * 1024));
    const server = await startViewer(model);
    try {
        const response = await get(server.url + 'api/summary', { 'X-Pyright-Trace-Viewer': '1' });
        assert.equal(response.status, 413);
        assert.match(JSON.parse(response.body).error, /2 MiB/);
    } finally {
        await server.close();
    }
});

const preserved = process.env.PYRIGHT_TRACE_VIEWER_ARTIFACT_DIR ? test : test.skip;
preserved.each(['ordinary.ndjson', 'experimental.ndjson', 'parent-reentry-review.ndjson'])(
    'Evaluation viewer: preserved genuine %s supports bounded linked temporal queries',
    (name) => {
        const model = loadViewerModel(join(process.env.PYRIGHT_TRACE_VIEWER_ARTIFACT_DIR!, name));
        const events = model.timeline({ kind: 'enter' });
        assert.ok(events.total > 0);
        assert.ok(events.items.length <= 40);
        const first = model.event(events.items[0].seq);
        for (const id of first.references.slice(0, 3)) {
            const graph = model.graph(id, model.end);
            for (const edge of graph.edges) {
                if (edge.relation === 'reference') {
                    assert.equal(edge.version, model.reader.latest(edge.from, model.end)?.data.version);
                }
            }
        }
        if (name === 'ordinary.ndjson') {
            assert.equal(model.pairs().total, 0);
        } else {
            assert.equal(model.pairs().total, 4);
            const comparison = model.comparison(0);
            assert.equal(comparison.sides[0].outcome?.failed, true);
            assert.notEqual(comparison.sides[0].firstResult?.id, comparison.sides[1].firstResult?.id);
            for (const side of comparison.sides) {
                for (const boundary of side.boundaries) {
                    assert.equal(boundary.seq, model.reader.checkpoint(side.span, boundary.phase)?.seq);
                }
            }
            let links = 0;
            for (let offset = 0; offset < comparison.changes.total; offset += comparison.changes.limit) {
                for (const row of model.comparison(0, offset).changes.items) {
                    row.versions.forEach((version, index) => {
                        const seq = row.observationSequences[index];
                        if (version === null) {
                            assert.equal(seq, null);
                            return;
                        }
                        assert.notEqual(seq, null);
                        const observation = model.reader.records[seq! - 1];
                        const boundary = comparison.sides.flatMap((s) => s.boundaries)[index];
                        assert.equal(observation.kind, 'observation');
                        assert.equal(observation.data.cause, `${boundary.span}:${boundary.phase}`);
                        assert.equal(observation.data.entity, row.entity);
                        assert.equal(observation.data.version, version);
                        assert.equal(model.entity(row.entity, seq!).state?.version, version);
                        links++;
                    });
                }
            }
            assert.equal(links, name === 'experimental.ndjson' ? 3062 : 2850);
            if (name === 'parent-reentry-review.ndjson') {
                for (const seq of [3095, 19251]) {
                    const event = model.event(seq);
                    const cache = event.referenceLinks.find((r) => r.path === 'state.typeCache')!;
                    assert.ok(cache.id.endsWith(':e601'));
                    assert.equal(event.references[0], cache.id);
                    assert.ok(model.entity(cache.id, seq).state);
                    assert.ok(model.graph(cache.id, seq).edges.length > 0);
                    assert.ok(event.referenceLinks.some((r) => r.path === 'owner' && r.id.endsWith(':e600')));
                    assert.equal(event.referenceClipping.length, 0);
                }
                const liveEntry = model
                    .event(19251)
                    .referenceLinks.find((r) => r.path === 'expressionEntries.typeCache')!;
                assert.ok(liveEntry.id.endsWith(':e1995'));
                assert.ok(model.entity(liveEntry.id, 19251).fields.items.some((f) => f.key === 'typeResult'));
                assert.equal(model.event(2).references[0], model.reader.records[1].data.id);
            }
        }
    }
);
