/*
 * reader.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { Json, TraceRecord } from './recorder';

const recordKinds = new Set([
    'header',
    'footer',
    'entity',
    'state',
    'observation',
    'edge',
    'program',
    'enter',
    'exit',
    'return',
    'throw',
    'branch',
    'collection-attempt',
    'collection',
    'generation',
    'field-write',
    'checkpoint',
    'owner-state',
    'summary',
]);

export function readTrace(text: string, maxBytes = 128 * 1024 * 1024): TraceRecord[] {
    if (Buffer.byteLength(text) > maxBytes) {
        throw new Error('Artifact exceeds reader byte limit');
    }
    const records: TraceRecord[] = [];
    for (const line of text.trimEnd().split('\n')) {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Invalid trace record');
        }
        const record = value as Partial<TraceRecord>;
        if (
            record.seq !== records.length + 1 ||
            typeof record.kind !== 'string' ||
            !recordKinds.has(record.kind) ||
            !record.data ||
            typeof record.data !== 'object' ||
            Array.isArray(record.data)
        ) {
            throw new Error(`Invalid trace record at sequence ${records.length + 1}`);
        }
        const requiredStrings: Record<string, string[]> = {
            entity: ['id', 'category'],
            state: ['entity', 'cause', 'writer'],
            observation: ['entity', 'cause'],
            edge: ['relation', 'from', 'to'],
            enter: ['span', 'label', 'site', 'role'],
            exit: ['span', 'label'],
            return: ['span', 'label'],
            throw: ['span'],
            checkpoint: ['span', 'phase'],
            'owner-state': ['span', 'phase'],
        };
        if (requiredStrings[record.kind]?.some((key) => typeof record.data![key] !== 'string')) {
            throw new Error(`Invalid ${record.kind} payload at sequence ${record.seq}`);
        }
        if (
            record.kind === 'state' &&
            (!Number.isSafeInteger(record.data.version) ||
                Number(record.data.version) < 1 ||
                !Array.isArray(record.data.fields) ||
                !record.data.fields.every(
                    (field) => Array.isArray(field) && field.length === 2 && typeof field[0] === 'string'
                ))
        ) {
            throw new Error(`Invalid state payload at sequence ${record.seq}`);
        }
        records.push(record as TraceRecord);
    }
    const header = records[0];
    if (header?.kind !== 'header' || header.data.schema !== 'pyright-evaluation-trace' || header.data.version !== 1) {
        throw new Error('Unsupported trace schema/version');
    }
    if (records[records.length - 1]?.kind !== 'footer') {
        throw new Error('Incomplete artifact: footer missing (do not interpret as complete capture)');
    }
    if (records.slice(1, -1).some((r) => r.kind === 'header' || r.kind === 'footer')) {
        throw new Error('Multiple runs or misplaced header/footer in artifact');
    }
    return records;
}

export class TraceReader {
    private _histories = new Map<string, TraceRecord[]>();
    private _entries = new Map<string, TraceRecord>();

    constructor(readonly records: readonly TraceRecord[]) {
        for (const record of records) {
            if (record.kind === 'enter') {
                this._entries.set(String(record.data.span), record);
            }
            if (record.kind === 'state') {
                const id = String(record.data.entity);
                const history = this._histories.get(id) ?? [];
                history.push(record);
                this._histories.set(id, history);
            }
        }
    }

    timeline(kind?: string, span?: string) {
        const spans = span ? this._descendants(span) : undefined;
        return this.records.filter((r) => (!kind || r.kind === kind) && (!spans || spans.has(String(r.data.span))));
    }

    history(entity: string, at = Infinity) {
        return (this._histories.get(entity) ?? []).filter((r) => r.seq <= at);
    }

    latest(entity: string, at = Infinity) {
        const history = this.history(entity, at);
        return history[history.length - 1] ?? null;
    }

    neighborhood(entity: string, relation?: string) {
        return this.records.filter(
            (r) =>
                r.kind === 'edge' &&
                (r.data.from === entity || r.data.to === entity) &&
                (!relation || r.data.relation === relation)
        );
    }

    pairs() {
        const baselines = new Map<string, string>();
        const pairs: { operation: Json; baseline: string; replay: string }[] = [];
        for (const r of this.records) {
            if (r.kind !== 'enter' || r.data.label !== '_trial' || !r.data.operation) {
                continue;
            }
            const key = JSON.stringify(r.data.operation);
            if (r.data.role === 'baseline') {
                baselines.set(key, String(r.data.span));
            } else if (r.data.role === 'candidate' && baselines.has(key)) {
                pairs.push({ operation: r.data.operation, baseline: baselines.get(key)!, replay: String(r.data.span) });
            }
        }
        return pairs;
    }

    diff(baseline: string, replay: string) {
        for (const span of [baseline, replay]) {
            if (!this.records.some((r) => r.kind === 'enter' && r.data.span === span)) {
                throw new Error(`Unknown evaluation span ${span}`);
            }
        }
        const summarize = (span: string) => {
            const events = this.timeline(undefined, span);
            const counts: Record<string, number> = {};
            for (const r of events) {
                const key = `${r.kind}:${r.data.label ?? ''}:${r.data.method ?? ''}`;
                counts[key] = (counts[key] ?? 0) + 1;
            }
            const first = events[0]?.seq;
            const last = events[events.length - 1]?.seq;
            const changes =
                first === undefined || last === undefined
                    ? []
                    : this.records.filter(
                          (r) => r.kind === 'state' && r.seq >= first && r.seq <= last && r.data.previous !== null
                      );
            return {
                counts,
                boundaries: events.filter(
                    (r) =>
                        ['checkpoint', 'owner-state', 'throw'].includes(r.kind) ||
                        (r.data.span === span && ['enter', 'return', 'exit'].includes(r.kind))
                ),
                firstResult: this.firstResult(span),
                changes,
            };
        };
        const left = summarize(baseline);
        const right = summarize(replay);
        const all = this.timeline(undefined, baseline);
        const after = all[all.length - 1]?.seq ?? 0;
        const beforeReplay = this.timeline(undefined, replay)[0]?.seq ?? 0;
        const changedEntities = [...new Set(left.changes.map((r) => String(r.data.entity)))];
        return {
            baseline: left,
            replay: right,
            boundaryComparisons: this.boundaryComparisons(baseline, replay),
            survivingObservations: changedEntities.map((entity) => ({
                entity,
                afterBaseline: this.latest(entity, after),
                beforeReplay: this.latest(entity, beforeReplay),
                meaning: 'latest observations only; unobserved intervals do not establish persistence',
            })),
            coverage: this.records[this.records.length - 1],
            conclusion: 'Observed differences, not a reuse certificate or universal equivalence',
        };
    }

    boundaryComparisons(baseline: string, replay: string) {
        const boundaries = [
            this.checkpoint(baseline, 'entry'),
            this.checkpoint(baseline, 'complete-live'),
            this.checkpoint(baseline, 'unwind'),
            this.checkpoint(replay, 'entry'),
            this.checkpoint(replay, 'complete-live'),
            this.checkpoint(replay, 'unwind'),
        ];
        const observed = boundaries.map((boundary) => {
            const entities = new Map<string, { state: TraceRecord; observation: TraceRecord }>();
            if (boundary) {
                const cause = `${boundary.data.span}:${boundary.data.phase}`;
                for (const record of this.records) {
                    if (record.kind === 'observation' && record.data.cause === cause) {
                        const entity = String(record.data.entity);
                        const state = this._histories.get(entity)?.find((s) => s.data.version === record.data.version);
                        if (state) {
                            entities.set(entity, { state, observation: record });
                        }
                    }
                }
            }
            return entities;
        });
        const same = (a: TraceRecord | undefined, b: TraceRecord | undefined) =>
            !a || !b
                ? 'unobserved'
                : JSON.stringify(a.data.fields) === JSON.stringify(b.data.fields)
                ? 'same-fields'
                : 'changed-fields';
        const entities = [...new Set(observed.flatMap((map) => [...map.keys()]))];
        return {
            order: [
                'baseline-entry',
                'baseline-live',
                'baseline-unwind',
                'replay-entry',
                'replay-live',
                'replay-unwind',
            ],
            entities: entities.map((entity) => {
                const states = observed.map((map) => map.get(entity)?.state);
                return {
                    entity,
                    versions: states.map((s) => s?.data.version ?? null),
                    // Owner-state snapshots can follow the checkpoint marker. A
                    // cell links its actual observation, not the marker or the
                    // earlier sequence that first introduced an unchanged version.
                    observationSequences: observed.map((map) => map.get(entity)?.observation.seq ?? null),
                    stateSequences: states.map((s) => s?.seq ?? null),
                    complete: states.map((s) => s?.data.complete ?? false),
                    baselineChange: same(states[0], states[1]),
                    unwindChange: same(states[1], states[2]),
                    betweenTrials: same(states[2], states[3]),
                    replayChange: same(states[3], states[4]),
                    observedMutationSurvived:
                        same(states[0], states[1]) === 'changed-fields' && same(states[1], states[2]) === 'same-fields',
                };
            }),
            meaning: 'Own fields observed at both boundaries only. Missing/depth-limited children remain unknown.',
        };
    }

    checkpoint(span: string, phase: string): TraceRecord | null {
        const matches = this.timeline('checkpoint', span).filter(
            (r) => r.data.phase === phase && this._belongsToScope(String(r.data.span), span)
        );
        // Missing or ambiguous boundaries are unknown, not a descendant's state.
        return matches.length === 1 ? matches[0] : null;
    }

    firstResult(span: string) {
        const entry = this._entries.get(span);
        const args = entry?.data.args;
        const expression = JSON.stringify(
            entry?.data.label === 'getTypeOfExpression' && args && typeof args === 'object' && !Array.isArray(args)
                ? args.node
                : entry?.data.expression
        );
        const events = this.timeline(undefined, span);
        const call = events.find(
            (r) =>
                r.kind === 'enter' &&
                r.data.label === 'getTypeOfExpression' &&
                this._belongsToScope(String(r.data.span), span) &&
                r.data.args &&
                !Array.isArray(r.data.args) &&
                typeof r.data.args === 'object' &&
                JSON.stringify(r.data.args.node) === expression
        );
        return events.find((r) => r.kind === 'return' && r.data.span === call?.data.span) ?? null;
    }

    private _belongsToScope(candidate: string, scope: string) {
        const seen = new Set<string>();
        let current: string | undefined = candidate;
        while (current !== undefined && !seen.has(current)) {
            seen.add(current);
            const entry = this._entries.get(current);
            if (!entry) {
                return false;
            }
            if (current === scope) {
                return true;
            }
            // The nearest trial owns its descendants, even for the same expression
            // or logical role. Ordinary scopes still work without a trial ancestor.
            if (entry.data.label === '_trial') {
                return false;
            }
            current = typeof entry.data.parent === 'string' ? entry.data.parent : undefined;
        }
        return false;
    }

    private _descendants(span: string) {
        const spans = new Set([span]);
        for (const r of this.records) {
            if (r.kind === 'enter' && spans.has(String(r.data.parent))) {
                spans.add(String(r.data.span));
            }
        }
        return spans;
    }
}
