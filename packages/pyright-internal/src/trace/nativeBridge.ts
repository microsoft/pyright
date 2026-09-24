/*
 * nativeBridge.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

/// <reference lib="es2021.weakref" />

import { createHash } from 'crypto';
import { relative } from 'path';
import { pathToFileURL } from 'url';
import { types } from 'util';

import { HookSite } from './nativeAdapter';
import { isObject, Json, own, Recorder } from './recorder';

export interface Selection {
    file?: string;
    start?: number;
    end?: number;
    operation?: number;
}

interface Frame {
    span: string;
    site: HookSite;
    owner?: object;
    args: Record<string, unknown>;
    receiver: unknown;
    role: string;
    operation?: unknown;
}

// These references live only for the duration of native calls or in weak-keyed
// owner registries. The recorder's buffers never hold native objects/closures.
export class NativeBridge {
    private _owners = new WeakMap<object, { label: string; state: () => Record<string, unknown> }>();
    private _aliases = new WeakMap<object, object>();
    private _children = new WeakMap<object, WeakRef<object>[]>();
    private _files = new WeakMap<object, string>();
    private _sites: Map<string, HookSite>;
    private _stack: Frame[] = [];
    private _audit = createHash('sha256');
    private _auditIds = new WeakMap<object, number>();
    private _nextAuditId = 0;
    private _auditCount = 0;
    private _spanCount = 0;
    private _failure: string | undefined;

    constructor(sites: HookSite[], readonly recorder?: Recorder, private readonly _selection: Selection = {}) {
        this._sites = new Map(sites.map((s) => [s.id, s]));
    }

    get failure() {
        return this._failure;
    }

    get activeFrames() {
        return this._stack.length;
    }

    owner(owner: object, label: string, state: () => Record<string, unknown>, parent?: object) {
        this._owners.set(owner, { label, state });
        if (parent) {
            const key = this._aliases.get(parent) ?? parent;
            const children = this._children.get(key) ?? [];
            if (children.length >= (this.recorder?.limits.entities ?? 50000)) {
                this.recorder?.gap('owner-identity-budget');
                return;
            }
            children.push(new WeakRef(owner));
            this._children.set(key, children);
        }
    }

    bind<T>(owner: object, result: T): T {
        if (isObject(result)) {
            this._aliases.set(result, owner);
            const children = this._children.get(result);
            if (children) {
                this._children.set(owner, children);
                this._children.delete(result);
            }
        }
        return result;
    }

    linkCurrent(evaluator: object) {
        const frame = this._stack[this._stack.length - 1];
        if (frame) {
            frame.owner = this._aliases.get(evaluator);
            this._record(() => this._checkpoint(frame, 'entry'));
        }
    }

    enter(id: string, owner: object | undefined, args: Record<string, unknown>, receiver: unknown): string | undefined {
        const site = this._sites.get(id)!;
        if (site.label === 'AnalyzerNodeInfoStore.setFileInfo') {
            const path = own(own(args.fileInfo, 'fileUri'), '_filePath');
            if (isObject(args.root) && typeof path === 'string') {
                this._files.set(args.root, path);
            }
        }
        const operation = args.record;
        const node = args.node ?? args.reference ?? own(operation, 'expression');
        const source = this._source(node);
        const parent = this._stack[this._stack.length - 1];
        const selected =
            !parent &&
            (this._selection.operation === undefined ||
                own(own(operation, 'root'), 'id') === this._selection.operation) &&
            (!this._selection.file ||
                (typeof source?.path === 'string' && relative(source.path, this._selection.file) === '')) &&
            (this._selection.start === undefined ||
                (typeof source?.start === 'number' && source.start >= this._selection.start)) &&
            (this._selection.end === undefined ||
                (typeof source?.start === 'number' && source.start < this._selection.end));
        if (!parent && !selected) {
            return undefined;
        }
        const span = this.recorder?.occurrence() ?? `audit:s${++this._spanCount}`;
        const frame: Frame = {
            span,
            site,
            owner: owner ?? parent?.owner,
            args,
            receiver,
            role: typeof args.mode === 'string' ? args.mode : parent?.role ?? 'ordinary',
            operation: operation ?? parent?.operation,
        };
        this._stack.push(frame);
        this._witness('enter', site, { ...args, receiver });
        this._record(() => {
            const recorder = this.recorder!;
            recorder.emit('enter', {
                span,
                parent: parent?.span ?? null,
                site: id,
                label: site.label,
                role: frame.role,
                operation: recorder.atom(frame.operation),
                operationNativeId: recorder.atom(own(own(frame.operation, 'root'), 'id')),
                source: this._source(node, true) ?? null,
                expression: recorder.atom(own(frame.operation, 'expression')),
                root: recorder.atom(own(frame.operation, 'root')),
                owner: recorder.atom(frame.owner),
                args: recorder.values(args, span, 2),
                receiver: recorder.atom(receiver),
            });
            if (site.label === '_trial') {
                this._checkpoint(frame, 'trial-entry');
            }
        });
        return span;
    }

    returned<T>(span: string | undefined, value: T, args?: Record<string, unknown>, site?: string): T {
        if (span) {
            const frame = this._frame(span);
            this._witness('return', frame.site, { value, args });
            this._record(() => {
                const recorder = this.recorder!;
                recorder.emit('return', {
                    span,
                    label: frame.site.label,
                    role: frame.role,
                    returnSite: site ?? null,
                    value: recorder.observe(value, span),
                    args: recorder.values(args ?? frame.args, span, 1),
                });
                if (frame.site.label === 'evaluate' || frame.site.label === 'evaluateAndContinue') {
                    this._checkpoint(frame, frame.site.label === 'evaluate' ? 'first-result-live' : 'complete-live');
                }
                // This edge states that a child returned a value to the caller,
                // not that all of its contents were consumed by that caller.
                const atom = recorder.atom(value);
                if (atom && typeof atom === 'object' && 'ref' in atom) {
                    recorder.emit('edge', { relation: 'observed-return', from: span, to: atom.ref });
                }
            });
        }
        return value;
    }

    thrown(span: string | undefined, error: unknown) {
        if (span) {
            const frame = this._frame(span);
            this._witness('throw', frame.site, { error });
            this._record(() => this.recorder!.emit('throw', { span, error: this.recorder!.observe(error, span) }));
        }
    }

    exit(span: string | undefined) {
        if (!span) {
            return;
        }
        const frame = this._frame(span);
        this._witness('exit', frame.site, {});
        this._record(() => {
            if (frame.site.label === '_trial') {
                this._checkpoint(frame, 'unwind');
            }
            this.recorder!.emit('exit', { span, label: frame.site.label, role: frame.role });
        });
        this._stack.pop();
    }

    branch<T>(id: string, value: T): T {
        const frame = this._stack[this._stack.length - 1];
        if (frame) {
            this._witness('branch', this._sites.get(id)!, { taken: !!value });
            this._record(() => this.recorder!.emit('branch', { span: frame.span, site: id, taken: !!value }));
        }
        return value;
    }

    // Evaluate the native receiver/member before its arguments, exactly as the
    // original method call does. Calls, returns and throws are not substituted.
    method(id: string, receiver: object, name: string) {
        const method: unknown = Reflect.get(receiver, name);
        return (...args: unknown[]) => {
            const frame = this._stack[this._stack.length - 1];
            const site = this._sites.get(id)!;
            if (frame) {
                this._witness('attempt', site, { receiver, name, args });
                this._record(() =>
                    this.recorder!.emit('collection-attempt', {
                        span: frame.span,
                        site: id,
                        method: name,
                        receiver: this.recorder!.atom(receiver),
                    })
                );
            }
            const value: unknown = Reflect.apply(method as (...args: unknown[]) => unknown, receiver, args);
            if (frame) {
                this._witness('accepted', site, { receiver, name, args, value });
                this._record(() => {
                    const recorder = this.recorder!;
                    const result = recorder.observe(value, frame.span);
                    recorder.emit('collection', {
                        span: frame.span,
                        site: id,
                        label: site.label,
                        method: name,
                        receiver: recorder.atom(receiver),
                        args: args.map((arg) => recorder.observe(arg, frame.span, 1)),
                        result,
                        outcome: 'native-call-returned',
                        // An undefined Map.get alone cannot distinguish an absent
                        // entry from a stored undefined. The real has() is separate.
                        lookup: name === 'get' ? (value === undefined ? 'undefined' : 'entry') : null,
                    });
                    if (name === 'get' && result && typeof result === 'object' && 'ref' in result) {
                        recorder.emit('edge', {
                            relation: 'observed-read',
                            from: frame.span,
                            to: result.ref,
                            site: id,
                            cache: recorder.atom(receiver),
                            key: recorder.atom(args[0]),
                        });
                    }
                    if (!['get', 'has'].includes(name)) {
                        recorder.observe(receiver, `after:${id}`, 1);
                    }
                });
            }
            return value;
        };
    }

    effect<T>(id: string, value: T, state: Record<string, unknown>): T {
        const frame = this._stack[this._stack.length - 1];
        if (frame) {
            const site = this._sites.get(id)!;
            this._witness('effect', site, { value, ...state });
            this._record(() =>
                this.recorder!.emit(state.domain ? 'generation' : 'field-write', {
                    span: frame.span,
                    site: id,
                    label: site.label,
                    ...this.recorder!.values(state, `after:${id}`, 2),
                })
            );
        }
        return value;
    }

    auditResult() {
        return { events: this._auditCount, sha256: this._audit.copy().digest('hex') };
    }

    private _frame(span: string): Frame {
        const frame = this._stack[this._stack.length - 1];
        if (!frame || frame.span !== span) {
            throw new Error(`Trace span stack mismatch: ${span}`);
        }
        return frame;
    }

    private _source(node: unknown, identities = false): Record<string, Json> | undefined {
        if (!isObject(node) || typeof own(node, 'nodeType') !== 'number') {
            return undefined;
        }
        let root = node;
        const seen = new Set<object>();
        while (isObject(own(root, 'parent')) && !seen.has(root)) {
            seen.add(root);
            root = own(root, 'parent') as object;
        }
        const path = this._files.get(root);
        return {
            path: path ?? null,
            uri: path ? pathToFileURL(path).href : null,
            parse: identities ? this.recorder?.atom(root) ?? null : null,
            node: identities ? this.recorder?.atom(node) ?? null : null,
            nativeId: typeof own(node, 'id') === 'number' ? (own(node, 'id') as number) : null,
            start: own(node, 'start') as number,
            length: own(node, 'length') as number,
            nodeType: own(node, 'nodeType') as number,
        };
    }

    private _checkpoint(frame: Frame, phase: string) {
        const recorder = this.recorder!;
        const owner = frame.owner && this._owners.get(frame.owner);
        const trial = [...this._stack].reverse().find((f) => f.site.label === '_trial');
        const file = own(trial?.args.generation, 'file');
        const state = owner?.state();
        // Include selected entries independently, even when the full map's bounded
        // prefix does not reach this node. Map intrinsics do not execute evaluation.
        const entries: Record<string, unknown> = {};
        const expressionId = own(own(frame.operation, 'expression'), 'id');
        if (typeof expressionId === 'number' && state) {
            for (const name of ['typeCache', 'expectedTypeCache', 'typeFormTypeCache']) {
                const map = state[name];
                if (types.isMap(map)) {
                    entries[name] = Map.prototype.get.call(map, expressionId);
                }
            }
        }
        recorder.emit('checkpoint', {
            span: frame.span,
            phase,
            role: frame.role,
            owner: recorder.atom(frame.owner),
            state: state ? recorder.values(state, `${frame.span}:${phase}`, 2) : null,
            expressionEntries: recorder.values(entries, `${frame.span}:${phase}`, 3),
            inputs: recorder.observe(trial?.args.inputs, `${frame.span}:${phase}`, 4),
            sink: recorder.observe(own(file, 'diagnosticSink'), `${frame.span}:${phase}`, 3),
        });
        const visitChildren = (parent: object, depth: number) => {
            if (depth > 2) {
                recorder.gap('owner-depth');
                return;
            }
            const children = this._children.get(parent) ?? [];
            if (children.length > recorder.limits.properties) {
                recorder.gap('owner-count');
            }
            for (const child of children.slice(0, recorder.limits.properties)) {
                const object = child.deref();
                if (!object) {
                    continue;
                }
                const entry = this._owners.get(object)!;
                recorder.emit('owner-state', {
                    span: frame.span,
                    phase,
                    owner: recorder.atom(object),
                    parent: recorder.atom(parent),
                    label: entry.label,
                    state: recorder.values(entry.state(), `${frame.span}:${phase}`, 3),
                });
                visitChildren(object, depth + 1);
            }
        };
        if (frame.owner) {
            visitChildren(frame.owner, 0);
        }
    }

    // The audit witness is intentionally independent of recorder entity allocation
    // and graph traversal. Compare an audit-only run against a full-recording run;
    // neither is a clean performance measurement.
    private _witness(kind: string, site: HookSite, values: Record<string, unknown>) {
        const valueOf = (value: unknown, depth: number): Json => {
            if (!isObject(value)) {
                return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
                    ? value
                    : typeof value;
            }
            if (types.isProxy(value)) {
                return 'opaque-proxy';
            }
            let id = this._auditIds.get(value);
            if (id === undefined) {
                id = ++this._nextAuditId;
                this._auditIds.set(value, id);
            }
            const fields: Record<string, Json> = { id };
            if (depth > 0) {
                for (const key of [
                    'type',
                    'isIncomplete',
                    'typeErrors',
                    'expectedType',
                    'flags',
                    'category',
                    'shared',
                    'fullName',
                    'name',
                    'priv',
                    'literalValue',
                    'inferredReturnType',
                    'generationCount',
                    'incompleteGenCount',
                    'isPending',
                    'evaluationCount',
                    'message',
                    'range',
                ]) {
                    const child = own(value, key);
                    if (child !== undefined) {
                        fields[key] = valueOf(child, depth - 1);
                    }
                }
                if (Array.isArray(value)) {
                    fields.items = Array.from({ length: value.length }, (_, index) =>
                        valueOf(own(value, String(index)), depth - 1)
                    );
                }
            }
            return fields;
        };
        this._audit.update(
            JSON.stringify([
                kind,
                site.id,
                Object.fromEntries(Object.entries(values).map(([k, v]) => [k, valueOf(v, 3)])),
            ])
        );
        this._auditCount++;
    }

    private _record(callback: () => void) {
        if (!this.recorder?.active || this._failure) {
            return;
        }
        try {
            callback();
        } catch (error) {
            // An observer failure must not replace an analyzer result/exception.
            // The runner fails the capture explicitly after native cleanup.
            const message = own(error, 'message');
            this._failure = typeof message === 'string' ? message : 'Unknown recorder failure';
        }
    }
}
