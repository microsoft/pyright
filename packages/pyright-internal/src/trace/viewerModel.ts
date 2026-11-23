/*
 * viewerModel.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Read-only, bounded presentation of recorded observations, not live native state.
 */

import { TraceReader } from './reader';
import { Json, TraceRecord } from './recorder';

export const viewerLimits = {
    records: 400000,
    page: 100,
    nodes: 40,
    edges: 100,
    fields: 80,
    text: 4000,
    references: 30,
    referenceDepth: 4,
    referenceNodes: 500,
    referencePath: 512,
};

export class ViewerInputError extends Error {
    constructor(message: string, readonly status = 400) {
        super(message);
    }
}

function object(value: Json | undefined): Record<string, Json> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function reference(value: Json | undefined): string | undefined {
    const ref = object(value).ref;
    return typeof ref === 'string' ? ref : undefined;
}

// Display clipping is separate from recorder coverage and is surfaced in the UI.
export function display(value: Json, depth = 5): Json {
    if (typeof value === 'string') {
        return value.length > viewerLimits.text ? value.slice(0, viewerLimits.text) + ' [viewer text cap]' : value;
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (depth === 0) {
        return { special: 'viewer depth cap; not expanded' };
    }
    if (Array.isArray(value)) {
        const items = value.slice(0, viewerLimits.fields).map((v) => display(v, depth - 1));
        if (items.length < value.length) {
            items.push({ special: `viewer item cap: ${value.length - items.length} more` });
        }
        return items;
    }
    const entries = Object.entries(value);
    const result = Object.fromEntries(
        entries.slice(0, viewerLimits.fields).map(([k, v]) => [k, display(v, depth - 1)])
    );
    if (entries.length > viewerLimits.fields) {
        result['[viewer cap]'] = `${entries.length - viewerLimits.fields} more properties`;
    }
    return result;
}

export function page<T>(items: readonly T[], offset = 0, limit = 40) {
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > viewerLimits.page
    ) {
        throw new ViewerInputError(`Invalid page; offset >= 0 and limit 1..${viewerLimits.page} required`);
    }
    return { total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
}

export class ViewerModel {
    private _entities = new Map<string, TraceRecord>();
    private _entries = new Map<string, TraceRecord>();
    private _states = new Map<string, TraceRecord[]>();
    private _observations = new Map<string, TraceRecord[]>();
    private _edges: TraceRecord[] = [];
    private _sites = new Map<string, Json>();
    private _pairs: ReturnType<TraceReader['pairs']>;
    private _comparisons = new Map<number, ReturnType<TraceReader['boundaryComparisons']>>();

    constructor(readonly reader: TraceReader, readonly label: string) {
        if (reader.records.length > viewerLimits.records) {
            throw new ViewerInputError(`Viewer supports at most ${viewerLimits.records} records per artifact`);
        }
        for (const record of reader.records) {
            if (record.kind === 'entity') {
                this._entities.set(String(record.data.id), record);
            } else if (record.kind === 'enter') {
                this._entries.set(String(record.data.span), record);
            } else if (record.kind === 'state' || record.kind === 'observation') {
                const map = record.kind === 'state' ? this._states : this._observations;
                const id = String(record.data.entity);
                const entries = map.get(id) ?? [];
                entries.push(record);
                map.set(id, entries);
            } else if (record.kind === 'edge') {
                this._edges.push(record);
            }
        }
        const sites = object(reader.records[0].data.provenance).sites;
        if (Array.isArray(sites)) {
            for (const site of sites) {
                const id = object(site).id;
                if (typeof id === 'string') {
                    this._sites.set(id, site);
                }
            }
        }
        this._pairs = reader.pairs();
    }

    get end() {
        return this.reader.records.length;
    }

    summary() {
        const header = this.reader.records[0];
        const footer = this.reader.records[this.end - 1];
        return {
            label: this.label,
            end: this.end,
            pairs: this._pairs.length,
            status: display(footer.data),
            coverage: display(object(header.data.provenance).coverage ?? null),
            provenance: display(header.data.provenance ?? null, 2),
            limits: viewerLimits,
            kinds: [...new Set(this.reader.records.map((r) => r.kind))],
            warning:
                'Latest OBSERVED state only. No complete dependency or safe-reuse claim. Native isIncomplete is not snapshot completeness.',
        };
    }

    timeline(options: {
        offset?: number;
        limit?: number;
        kind?: string;
        query?: string;
        span?: string;
        role?: string;
    }) {
        if ((options.query?.length ?? 0) > 200) {
            throw new ViewerInputError('Search is limited to 200 characters');
        }
        if (options.span && !this._entries.has(options.span)) {
            throw new ViewerInputError('Unknown occurrence', 404);
        }
        const query = options.query?.toLowerCase();
        const records = this.reader.timeline(options.kind, options.span).filter((r) => {
            const entry = this._entries.get(String(r.data.span));
            return (
                (!options.role || (r.data.role ?? entry?.data.role) === options.role) &&
                (!query || JSON.stringify([r.data, entry?.data.source]).toLowerCase().includes(query))
            );
        });
        const result = page(records, options.offset, options.limit);
        return { ...result, items: result.items.map((r) => this._row(r)), meaning: 'Inclusive of nested native work' };
    }

    event(seq: number) {
        this._sequence(seq, false);
        const record = this.reader.records[seq - 1];
        const entry = this._entries.get(String(record.data.span));
        const refs = this._references(record.data);
        const site = this._sites.get(String(record.data.site ?? record.data.returnSite));
        return {
            ...this._row(record),
            data: display(record.data),
            occurrence: entry && entry.seq <= seq ? this._row(entry) : null,
            site: site ? display(site) : null,
            references: [...new Set(refs.links.map((link) => link.id))],
            referenceLinks: refs.links,
            referenceClipping: refs.clipping,
        };
    }

    entity(id: string, at: number, historyOffset = 0, fieldOffset = 0) {
        this._sequence(at);
        const identity = this._identity(id, at);
        const state = this._latest(id, at);
        const lastObservation = this._at(this._observations.get(id) ?? [], at);
        const history = page(
            [...(this._observations.get(id) ?? this._states.get(id) ?? [])].reverse(),
            historyOffset,
            25
        );
        const fields = page(this._fields(state), fieldOffset, 40);
        return {
            ...identity,
            at,
            state: state
                ? {
                      seq: state.seq,
                      version: state.data.version,
                      complete: state.data.complete,
                      writer: state.data.writer,
                      cause: state.data.cause,
                      observedSeq:
                          lastObservation?.data.version === state.data.version ? lastObservation.seq : state.seq,
                  }
                : null,
            fields: {
                ...fields,
                items: fields.items.map(([key, value]) => ({
                    key,
                    value: display(value),
                    ref: reference(value) ?? null,
                })),
            },
            history: {
                ...history,
                items: history.items.map((r) => ({
                    seq: r.seq,
                    version: r.data.version,
                    cause: r.data.cause,
                    complete: r.data.complete,
                    afterCursor: r.seq > at,
                })),
            },
            meaning: state
                ? 'Version introduced at state sequence; repeated observations may be later. Not continuously current native state.'
                : 'No state observed at or before this cursor. Future observations are not used.',
        };
    }

    graph(id: string, at: number, relation = 'all', hops = 1) {
        this._sequence(at);
        this._identity(id, at);
        if (!['all', 'reference', 'observed'].includes(relation) || ![1, 2].includes(hops)) {
            throw new ViewerInputError('Graph relation must be all/reference/observed; hops must be 1 or 2');
        }
        const states = new Map<string, TraceRecord | undefined>();
        const latest = (source: string) => {
            if (!states.has(source)) {
                states.set(source, this._latest(source, at));
            }
            return states.get(source);
        };
        // Incoming references must be filtered by the SOURCE's observed version,
        // just like outgoing references. No union of historical reference edges.
        const eligible = this._edges.filter((r) => {
            if (r.seq > at) {
                return false;
            }
            if (r.data.relation === 'reference') {
                return relation !== 'observed' && latest(String(r.data.from))?.data.version === r.data.version;
            }
            return relation !== 'reference' && ['observed-read', 'observed-return'].includes(String(r.data.relation));
        });
        const nodes = new Set([id]);
        const edges = new Map<number, TraceRecord>();
        let frontier = new Set([id]);
        let capped = false;
        for (let hop = 0; hop < hops; hop++) {
            const next = new Set<string>();
            for (const edge of eligible) {
                const from = String(edge.data.from);
                const to = String(edge.data.to);
                if (!frontier.has(from) && !frontier.has(to)) {
                    continue;
                }
                if (edges.has(edge.seq)) {
                    continue;
                }
                const newNodes = [...new Set([from, to])].filter((n) => !nodes.has(n));
                if (nodes.size + newNodes.length > viewerLimits.nodes || edges.size >= viewerLimits.edges) {
                    capped = true;
                    continue;
                }
                edges.set(edge.seq, edge);
                for (const node of newNodes) {
                    nodes.add(node);
                    next.add(node);
                }
            }
            frontier = next;
        }
        return {
            at,
            root: id,
            capped,
            hops,
            nodes: [...nodes].map((node) => this._identity(node, at, true)),
            edges: [...edges.values()].map((r) => ({
                seq: r.seq,
                from: String(r.data.from),
                to: String(r.data.to),
                relation: String(r.data.relation),
                field: display(r.data.field ?? ''),
                version: r.data.version ?? null,
            })),
            meaning:
                'References: source-version-filtered observations. Dashed edges: executed reads/returns through cursor, not ongoing dependency proof.',
        };
    }

    pairs(offset = 0) {
        const result = page(this._pairs, offset, 25);
        return {
            ...result,
            items: result.items.map((pair, index) => ({
                index: offset + index,
                ...pair,
                source: display(this._entries.get(pair.baseline)?.data.source ?? null),
            })),
        };
    }

    comparison(index: number, offset = 0) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this._pairs.length) {
            throw new ViewerInputError('Unknown baseline/candidate pair', 404);
        }
        const pair = this._pairs[index];
        let comparison = this._comparisons.get(index);
        if (!comparison) {
            comparison = this.reader.boundaryComparisons(pair.baseline, pair.replay);
            if (this._comparisons.size >= 4) {
                this._comparisons.delete(this._comparisons.keys().next().value!);
            }
            this._comparisons.set(index, comparison);
        }
        const sides = [pair.baseline, pair.replay].map((span) => {
            const events = this.reader.timeline(undefined, span);
            const first = this.reader.firstResult(span);
            const outcome = events.find((r) => r.kind === 'return' && r.data.span === span);
            const outcomeFields = this._fields(
                outcome ? this._latest(reference(outcome.data.value) ?? '', outcome.seq) : undefined
            );
            const fields = new Map(outcomeFields);
            const diagnostics = reference(fields.get('diagnostics'));
            const diagnosticFields = diagnostics && outcome ? this._fields(this._latest(diagnostics, outcome.seq)) : [];
            const counts = new Map<string, number>();
            for (const event of events) {
                const key = `${event.kind}:${event.data.label ?? ''}:${event.data.method ?? ''}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const boundaries = ['entry', 'complete-live', 'unwind'].map((phase) => {
                const boundary = this.reader.checkpoint(span, phase);
                return {
                    phase,
                    seq: boundary?.seq ?? null,
                    span: boundary?.data.span ?? null,
                    data: boundary ? display(boundary.data) : null,
                };
            });
            return {
                span,
                entry: this._row(this._entries.get(span)!),
                firstResult: first
                    ? {
                          seq: first.seq,
                          id: reference(first.data.value) ?? null,
                          snapshotComplete:
                              this._latest(reference(first.data.value) ?? '', first.seq)?.data.complete ?? null,
                          fields: this._fields(this._latest(reference(first.data.value) ?? '', first.seq))
                              .slice(0, viewerLimits.fields)
                              .map(([key, value]) => ({ key, value: display(value), ref: reference(value) ?? null })),
                      }
                    : null,
                outcome: outcome
                    ? {
                          seq: outcome.seq,
                          id: reference(outcome.data.value) ?? null,
                          failed: fields.get('failed') ?? null,
                          diagnostics: diagnostics ?? null,
                          diagnosticsSnapshotComplete: diagnostics
                              ? this._latest(diagnostics, outcome.seq)?.data.complete ?? null
                              : null,
                      }
                    : null,
                diagnostics: diagnosticFields
                    .filter(([key]) => /^\d+$/.test(key))
                    .slice(0, 20)
                    .map(([, value]) => {
                        const id = reference(value);
                        return {
                            id: id ?? null,
                            seq: outcome!.seq,
                            fields: this._fields(this._latest(id ?? '', outcome!.seq))
                                .slice(0, viewerLimits.fields)
                                .map(([key, field]) => ({ key, value: display(field) })),
                        };
                    }),
                diagnosticsCapped: diagnosticFields.filter(([key]) => /^\d+$/.test(key)).length > 20,
                counts: [...counts].slice(0, 100).map(([name, count]) => ({ name, count })),
                countsCapped: counts.size > 100,
                boundaries,
                meaning: 'Counts include nested work; boundaries and first result belong to this trial',
            };
        });
        return {
            index,
            sides,
            order: comparison.order,
            changes: page(comparison.entities, offset, 25),
            meaning: comparison.meaning,
        };
    }

    private _sequence(at: number, allowZero = true) {
        if (!Number.isSafeInteger(at) || at < (allowZero ? 0 : 1) || at > this.end) {
            throw new ViewerInputError(`Sequence must be ${allowZero ? 0 : 1}..${this.end}`);
        }
    }

    private _latest(id: string, at: number): TraceRecord | undefined {
        return this._at(this._states.get(id) ?? [], at);
    }

    private _at(states: TraceRecord[], at: number): TraceRecord | undefined {
        let low = 0;
        let high = states.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (states[middle].seq <= at) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return states[low - 1];
    }

    private _fields(state: TraceRecord | undefined): [string, Json][] {
        return state ? (state.data.fields as [string, Json][]) : [];
    }

    private _identity(id: string, at: number, allowMissing = false) {
        const record = this._entities.get(id) ?? this._entries.get(id);
        if (!record && !allowMissing) {
            throw new ViewerInputError('Unknown entity or occurrence', 404);
        }
        const known = !!record && record.seq <= at;
        const state = this._latest(id, at);
        const observation = this._at(this._observations.get(id) ?? [], at);
        return {
            id,
            knownAtCursor: known,
            category: known ? String(record!.data.category ?? 'occurrence') : 'unobserved-at-cursor',
            label: known ? String(record!.data.label ?? record!.data.category ?? 'object') : 'unobserved',
            seq: known ? record!.seq : null,
            version: state?.data.version ?? null,
            stateSeq: state?.seq ?? null,
            observedSeq: state
                ? observation?.data.version === state.data.version
                    ? observation.seq
                    : state.seq
                : null,
            complete: state?.data.complete ?? null,
        };
    }

    private _row(record: TraceRecord) {
        const span = String(record.data.span ?? '');
        const entry = this._entries.get(span);
        let parent = entry;
        let depth = 0;
        const seen = new Set<string>();
        while (parent && typeof parent.data.parent === 'string' && !seen.has(parent.data.parent)) {
            seen.add(parent.data.parent);
            parent = this._entries.get(parent.data.parent);
            if (++depth >= 100) {
                break;
            }
        }
        return {
            seq: record.seq,
            kind: record.kind,
            span,
            depth,
            parent: entry?.data.parent ?? null,
            label: display(record.data.label ?? record.data.phase ?? entry?.data.label ?? record.kind),
            role: display(record.data.role ?? entry?.data.role ?? 'ordinary'),
            source: display(record.data.source ?? entry?.data.source ?? null),
            refs: [...new Set(this._references(record.data).links.map((link) => link.id))],
        };
    }

    private _references(data: Record<string, Json>) {
        const links: { id: string; path: string }[] = [];
        const clipping = new Set<string>();
        let visited = 0;
        const visit = (value: Json, path: string, depth: number) => {
            if (links.length >= viewerLimits.references) {
                clipping.add('reference count');
                return;
            }
            if (++visited > viewerLimits.referenceNodes) {
                clipping.add('reference traversal nodes');
                return;
            }
            if (depth > viewerLimits.referenceDepth) {
                clipping.add('reference depth');
                return;
            }
            const id = reference(value);
            const identity =
                id ??
                (typeof value === 'string' && (this._entities.has(value) || this._entries.has(value))
                    ? value
                    : undefined);
            if (identity) {
                if (path.length > viewerLimits.referencePath) {
                    clipping.add('reference path text');
                }
                links.push({ id: identity, path: path.slice(0, viewerLimits.referencePath) });
                return;
            }
            if (!value || typeof value !== 'object') {
                return;
            }
            let entries = Object.entries(value);
            if (depth === 0) {
                // Priority, not an allowlist: visit all other recorded metadata
                // too. Checkpoints open useful state before an empty owner token.
                const priority = [
                    'value',
                    'entity',
                    'id',
                    'state',
                    'expressionEntries',
                    'inputs',
                    'sink',
                    'error',
                    'cache',
                    'receiver',
                    'expression',
                    'root',
                    'to',
                    'from',
                    'owner',
                    'args',
                ];
                const rank = (key: string) => {
                    const index = priority.indexOf(key);
                    return index < 0 ? priority.length : index;
                };
                entries = entries.sort(([a], [b]) => rank(a) - rank(b));
            }
            if (entries.length > viewerLimits.fields) {
                clipping.add('reference object/array items');
            }
            for (const [key, child] of entries.slice(0, viewerLimits.fields)) {
                visit(child, path ? `${path}.${key}` : key, depth + 1);
            }
        };
        visit(data, '', 0);
        return { links, clipping: [...clipping] };
    }
}
