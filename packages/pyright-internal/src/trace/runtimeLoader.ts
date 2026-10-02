/*
 * runtimeLoader.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { createHash } from 'crypto';
import { readFileSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import { dirname, isAbsolute, relative, resolve } from 'path';
import * as ts from 'typescript';
import { runInThisContext } from 'vm';

import { adapterFiles, adapterVersion, HookSite, instrument } from './nativeAdapter';
import { NativeBridge } from './nativeBridge';
import { Json } from './recorder';

export function sha256(content: string | Buffer) {
    return createHash('sha256').update(content).digest('hex');
}

export class RuntimeLoader {
    readonly root: string;
    readonly sites: HookSite[] = [];
    readonly coverage: Record<string, Json> = {};
    private _transformed = new Map<string, string>();
    private _cache = new Map<string, { exports: unknown }>();
    private _hashes = new Map<string, string>();
    private _bridge: NativeBridge | undefined;
    private _instrumented = false;

    constructor(root: string, experimental: boolean) {
        this.root = realpathSync(root);
        // Validate ALL required hooks before executing any target code. A partially
        // applicable adapter is not a successful capture.
        for (const file of adapterFiles(experimental)) {
            const path = resolve(this.root, ...file.split('/'));
            const text = this._read(path);
            const transformed = instrument(file, text, experimental);
            this._transformed.set(path, transformed.code);
            this.sites.push(...transformed.sites);
            this.coverage[file] = { status: 'instrumented-sites-only', counts: transformed.counts };
        }
        this.coverage.otherHeapWrites = 'unobserved; snapshot deltas have unknown writer/timing';
        this.coverage.dependencies = 'native reads/returns only; references are not transitive dependencies';
        this.coverage.flow = 'native cache/branch/pending/generation sites; not a flow completion certificate';
        this.coverage.definitions = 'inferredReturnType assignments only; other definition state is snapshot-only';
        this.coverage.overload = experimental ? 'real trials and callbacks' : 'not enabled';
        this.coverage.contextualSearch = 'helper when present; older inline Array.find is not separately instrumented';
    }

    configure(bridge: NativeBridge | undefined) {
        if (this._cache.size) {
            throw new Error('Configure the loader before loading target code');
        }
        this._bridge = bridge;
        this._instrumented = !!bridge;
    }

    load<T>(relativePath: string): T {
        return this._load(resolve(this.root, ...relativePath.split('/'))) as T;
    }

    provenance(): Record<string, Json> {
        return {
            adapter: adapterVersion,
            runtime: this.root,
            files: [...this._hashes].map(([path, hash]) => ({ path, sha256: hash })),
            coverage: this.coverage,
            sites: this.sites.map((site) => ({ ...site })),
        };
    }

    verifyUnchanged() {
        for (const [path, hash] of this._hashes) {
            if (sha256(readFileSync(path)) !== hash) {
                throw new Error(`Capture target changed during analysis: ${path}`);
            }
        }
    }

    dispose() {
        this._cache.clear();
        this._transformed.clear();
        this._bridge = undefined;
    }

    private _read(path: string) {
        const content = readFileSync(path);
        const hash = sha256(content);
        const previous = this._hashes.get(path);
        if (previous && previous !== hash) {
            throw new Error(`Runtime changed after preflight: ${path}`);
        }
        this._hashes.set(path, hash);
        return content.toString('utf8');
    }

    private _load(requested: string): unknown {
        const nativeRequire = createRequire(resolve(this.root, '__trace_loader__.js'));
        const path = nativeRequire.resolve(requested);
        const inside = relative(this.root, path);
        if (inside.startsWith('..') || isAbsolute(inside)) {
            return nativeRequire(path);
        }
        const previous = this._cache.get(path);
        if (previous) {
            return previous.exports;
        }
        const module = { exports: {} as unknown };
        this._cache.set(path, module);
        try {
            if (path.endsWith('.json')) {
                module.exports = JSON.parse(this._read(path));
            } else if (path.endsWith('.js')) {
                const original = this._read(path);
                this._assertSupportedModule(path, original);
                const code = (this._instrumented && this._transformed.get(path)) || original;
                const fromHere = createRequire(path);
                const localRequire = (name: string): unknown => this._load(fromHere.resolve(name));
                localRequire.resolve = fromHere.resolve;
                const execute = runInThisContext(
                    `(function(exports, require, module, __filename, __dirname, __pyrightTrace) {\n${code}\n})`,
                    { filename: path }
                ) as (
                    exports: unknown,
                    require: typeof localRequire,
                    module: { exports: unknown },
                    filename: string,
                    directory: string,
                    bridge: NativeBridge | undefined
                ) => void;
                execute.call(module.exports, module.exports, localRequire, module, path, dirname(path), this._bridge);
            } else {
                throw new Error(`Unsupported unbundled module: ${path}`);
            }
        } catch (error) {
            this._cache.delete(path);
            throw error;
        }
        return module.exports;
    }

    private _assertSupportedModule(path: string, code: string) {
        const source = ts.createSourceFile(path, code, ts.ScriptTarget.ES2020, false, ts.ScriptKind.JS);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
                throw new Error(
                    `Unsupported dynamic import in private CommonJS runtime: ${path}:${line + 1}:${character + 1}. ` +
                        'Local modules containing import() cannot be loaded, even inside functions; ' +
                        'use an unbundled CommonJS runtime without dynamic imports in its local dependency graph.'
                );
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
}
