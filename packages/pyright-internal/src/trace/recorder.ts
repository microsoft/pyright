/*
 * recorder.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Developer-only, bounded observations. Nothing in the analyzer imports this module.
 */

import { randomUUID } from 'crypto';
import { types } from 'util';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Atom = null | boolean | number | string | { ref: string } | { special: string };
export interface TraceRecord {
    seq: number;
    kind: string;
    data: { [key: string]: Json };
}
export interface Limits {
    events: number;
    entities: number;
    bytes: number;
    depth: number;
    properties: number;
    snapshotEntities: number;
    stringLength: number;
}

export const defaultLimits: Limits = {
    events: 200000,
    entities: 50000,
    bytes: 64 * 1024 * 1024,
    depth: 3,
    properties: 80,
    snapshotEntities: 200,
    stringLength: 4096,
};

export function own(value: unknown, key: string): unknown {
    if (!isObject(value) || types.isProxy(value)) {
        return undefined;
    }
    return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function isObject(value: unknown): value is object {
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export class Recorder {
    readonly run: string;
    readonly limits: Limits;
    private _ids = new WeakMap<object, string>();
    private _states = new Map<string, { fingerprint: string; version: number }>();
    private _nextEntity = 0;
    private _nextOccurrence = 0;
    private _sequence = 0;
    private _bytes = 0;
    private _ended = false;
    private _exhausted = false;
    private _gaps = new Set<string>();
    private _dropped = 0;

    constructor(
        private readonly _sink: (record: TraceRecord) => void,
        provenance: { [key: string]: Json },
        limits: Partial<Limits> = {},
        run: string = randomUUID()
    ) {
        this.run = run;
        if (!run || run.length > 128) {
            throw new Error('Run identity must contain 1-128 characters');
        }
        this.limits = { ...defaultLimits, ...limits };
        for (const [name, value] of Object.entries(this.limits)) {
            if (!Number.isSafeInteger(value) || value < 1) {
                throw new Error(`Invalid trace limit ${name}: ${value}`);
            }
        }
        if (this.limits.bytes < 4096) {
            throw new Error('Trace byte limit must leave at least 4096 bytes for metadata and footer');
        }
        if (Buffer.byteLength(JSON.stringify(provenance)) > this.limits.bytes - 3072) {
            this.gap('provenance-byte-budget');
            provenance = { omitted: 'provenance exceeds byte budget' };
        }
        this._write('header', {
            schema: 'pyright-evaluation-trace',
            version: 1,
            run,
            provenance,
            limits: { ...this.limits },
        });
    }

    get active() {
        return !this._ended && !this._exhausted;
    }

    occurrence() {
        return `${this.run}:s${++this._nextOccurrence}`;
    }

    gap(reason: string) {
        this._gaps.add(this._gaps.size < 16 ? reason.slice(0, 64) : 'additional-coverage-gaps');
    }

    atom(value: unknown): Atom {
        if (value === null || typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            if (value.length > this.limits.stringLength) {
                this.gap('stringLength');
                return { special: `truncated-string:${value.slice(0, this.limits.stringLength)}` };
            }
            return value;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) && !Object.is(value, -0)
                ? value
                : { special: Object.is(value, -0) ? '-0' : String(value) };
        }
        if (!isObject(value)) {
            return { special: typeof value === 'bigint' ? `bigint:${value}` : typeof value };
        }
        let id = this._ids.get(value);
        if (!id) {
            if (this._nextEntity >= this.limits.entities || !this.active) {
                this.gap('entities');
                return { special: 'unobserved-entity' };
            }
            id = `${this.run}:e${++this._nextEntity}`;
            this._ids.set(value, id);
            this.emit('entity', { id, category: this._category(value) });
        }
        return { ref: id };
    }

    // Snapshot versions describe observations, not universal mutation counters. A
    // changed child does not imply that a referencing map or Type was replaced.
    observe(value: unknown, cause: string, depth = this.limits.depth): Atom {
        const root = this.atom(value);
        if (!this.active || !isObject(value)) {
            return root;
        }
        const seen = new Set<object>();
        const visit = (object: object, remaining: number) => {
            if (seen.has(object) || !this.active) {
                return;
            }
            if (seen.size >= this.limits.snapshotEntities) {
                this.gap('snapshotEntities');
                return;
            }
            seen.add(object);
            const atom = this.atom(object);
            if (typeof atom !== 'object' || atom === null || !('ref' in atom)) {
                return;
            }
            const fields: [string, Atom][] = [];
            const children: object[] = [];
            let complete = true;
            const add = (name: string, child: unknown) => {
                const atom = this.atom(child);
                fields.push([name, atom]);
                if (
                    atom &&
                    typeof atom === 'object' &&
                    'special' in atom &&
                    (atom.special === 'unobserved-entity' || atom.special.startsWith('truncated-string:'))
                ) {
                    complete = false;
                }
                if (isObject(child)) {
                    children.push(child);
                }
            };
            if (types.isProxy(object) || typeof object === 'function') {
                fields.push(['opaque', { special: types.isProxy(object) ? 'proxy' : 'function' }]);
                complete = false;
                this.gap(types.isProxy(object) ? 'opaque-proxy' : 'opaque-function');
            } else if (types.isMap(object) || types.isSet(object)) {
                const entries: IterableIterator<unknown> = types.isMap(object)
                    ? Map.prototype.entries.call(object)
                    : Set.prototype.values.call(object);
                let index = 0;
                for (const entry of entries) {
                    if (index >= this.limits.properties) {
                        complete = false;
                        this.gap('properties');
                        break;
                    }
                    if (types.isMap(object)) {
                        const [key, child] = entry as [unknown, unknown];
                        add(`key:${index}`, key);
                        add(`value:${index}`, child);
                    } else {
                        add(`${index}`, entry);
                    }
                    index++;
                }
            } else if (types.isWeakMap(object) || types.isWeakSet(object)) {
                fields.push(['opaque', { special: 'weak-collection' }]);
                complete = false;
                this.gap('opaque-weak-collection');
            } else {
                const names = Object.getOwnPropertyNames(object);
                complete = names.length <= this.limits.properties;
                if (!complete) {
                    this.gap('properties');
                }
                for (const name of names.slice(0, this.limits.properties)) {
                    const descriptor = Object.getOwnPropertyDescriptor(object, name)!;
                    if ('value' in descriptor) {
                        add(name, descriptor.value);
                    } else {
                        fields.push([name, { special: 'accessor-not-invoked' }]);
                        complete = false;
                        this.gap('opaque-accessor');
                    }
                }
                if (Object.getOwnPropertySymbols(object).length) {
                    complete = false;
                    this.gap('symbol-properties');
                }
            }
            const fingerprint = JSON.stringify({ fields, complete });
            const previous = this._states.get(atom.ref);
            if (!previous || previous.fingerprint !== fingerprint) {
                const version = (previous?.version ?? 0) + 1;
                this._states.set(atom.ref, { fingerprint, version });
                this.emit('state', {
                    entity: atom.ref,
                    version,
                    previous: previous?.version ?? null,
                    cause,
                    writer: 'unknown-between-observations',
                    complete,
                    fields,
                });
                for (const [field, child] of fields) {
                    if (typeof child === 'object' && child !== null && 'ref' in child) {
                        this.emit('edge', { relation: 'reference', from: atom.ref, to: child.ref, field, version });
                    }
                }
            }
            this.emit('observation', {
                entity: atom.ref,
                version: this._states.get(atom.ref)!.version,
                cause,
                complete,
            });
            if (remaining > 0) {
                for (const child of children) {
                    // Parse-tree links would otherwise swamp type/state observations.
                    if (typeof own(child, 'nodeType') !== 'number') {
                        visit(child, remaining - 1);
                    }
                }
            } else if (children.length) {
                this.gap('depth');
            }
        };
        visit(value, depth);
        return root;
    }

    values(values: Record<string, unknown>, cause: string, depth?: number): { [key: string]: Json } {
        return Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, this.observe(value, cause, depth)])
        );
    }

    emit(kind: string, data: { [key: string]: Json }) {
        if (!this.active) {
            this._dropped++;
            return;
        }
        const size = Buffer.byteLength(JSON.stringify({ seq: this._sequence + 1, kind, data })) + 1;
        if (this._sequence >= this.limits.events || this._bytes + size > this.limits.bytes - 2048) {
            this._exhausted = true;
            this._dropped++;
            this.gap('event-or-byte-budget');
            return;
        }
        this._write(kind, data);
    }

    finish(status: 'completed' | 'threw' | 'recorder-failed', error: string | null = null) {
        if (this._ended) {
            throw new Error('Recorder already finished');
        }
        this._ended = true;
        this._write('footer', {
            status,
            error: error?.slice(0, 512) ?? null,
            exhausted: this._exhausted,
            gaps: [...this._gaps],
            dropped: this._dropped,
            entities: this._nextEntity,
            occurrences: this._nextOccurrence,
            coverage: 'observed-domains-only; not proof of no other dependencies or effects',
        });
        this._states.clear();
        this._ids = new WeakMap();
    }

    private _category(value: object): string {
        if (types.isProxy(value)) {
            return 'opaque-proxy';
        }
        if (typeof value === 'function') {
            return 'function';
        }
        if (typeof own(value, 'nodeType') === 'number') {
            return 'parse-node';
        }
        if (typeof own(value, 'category') === 'number' && own(value, 'flags') !== undefined) {
            return 'type';
        }
        if (own(value, 'type') !== undefined) {
            return 'type-bearing-object';
        }
        return types.isMap(value) ? 'map' : types.isSet(value) ? 'set' : Array.isArray(value) ? 'array' : 'object';
    }

    private _write(kind: string, data: { [key: string]: Json }) {
        const record = { seq: ++this._sequence, kind, data };
        this._bytes += Buffer.byteLength(JSON.stringify(record)) + 1;
        this._sink(record);
    }
}
