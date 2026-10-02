/*
 * capture.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'fs';
import { dirname, resolve } from 'path';
import { isDeepStrictEqual } from 'util';
import type { CancellationToken } from 'vscode-languageserver';

import type { Program } from '../analyzer/program';
import { NativeBridge, Selection } from './nativeBridge';
import { isObject, Json, Limits, own, Recorder } from './recorder';
import { RuntimeLoader, sha256 } from './runtimeLoader';

export interface CaptureOptions {
    target: string;
    runtime?: string;
    input: string;
    output?: string;
    mode?: 'trace' | 'audit' | 'clean';
    experimental?: boolean;
    selection?: Selection;
    limits?: Partial<Limits>;
    cancellationToken?: CancellationToken;
}

// Only use this for known native result records, after analysis. The recorder
// never invokes toJSON, getters, printType or an inferred-return evaluator.
function plain(value: unknown, seen = new Set<object>()): Json {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : String(value);
    }
    if (!isObject(value)) {
        return { special: typeof value };
    }
    if (seen.has(value)) {
        return { special: 'cycle' };
    }
    seen.add(value);
    let result: Json;
    if (Array.isArray(value)) {
        result = value.map((child) => plain(child, seen));
    } else {
        result = Object.fromEntries(
            Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => [
                key,
                'value' in descriptor ? plain(descriptor.value, seen) : { special: 'accessor-not-invoked' },
            ])
        );
    }
    seen.delete(value);
    return result;
}

export function capture(options: CaptureOptions): Record<string, Json> {
    const target = resolve(options.target);
    const runtime = options.runtime
        ? resolve(options.runtime)
        : resolve(target, 'packages', 'pyright-internal', 'out', 'packages', 'pyright-internal', 'src');
    const input = resolve(options.input);
    const content = readFileSync(input, 'utf8');
    const selection = { file: input, ...options.selection };
    if (selection.start !== undefined && selection.end !== undefined && selection.start >= selection.end) {
        throw new Error('Selection start must be before end');
    }
    const mode = options.mode ?? 'trace';
    if (mode === 'trace' && !options.output) {
        throw new Error('Trace mode requires output');
    }
    const loader = new RuntimeLoader(runtime, !!options.experimental);
    const sourceProvenance = [
        ...loader.sites.map((site) =>
            resolve(target, 'packages', 'pyright-internal', 'src', ...site.file.replace(/\.js$/, '.ts').split('/'))
        ),
        resolve(target, 'pnpm-lock.yaml'),
        ...['recorder', 'reader', 'nativeAdapter', 'nativeBridge', 'runtimeLoader', 'capture', 'cli'].map((name) =>
            resolve(__dirname, `${name}.js`)
        ),
    ]
        .filter((path, index, all) => all.indexOf(path) === index)
        .map((path) => ({
            path,
            sha256: existsSync(path) ? sha256(readFileSync(path)) : null,
        }));
    let output: number | undefined;
    let recorder: Recorder | undefined;
    const finish = (status: 'completed' | 'threw' | 'recorder-failed', error: string | null = null) => {
        const current = recorder;
        recorder = undefined;
        current?.finish(status, error);
    };
    if (options.output) {
        mkdirSync(dirname(resolve(options.output)), { recursive: true });
        output = openSync(resolve(options.output), 'wx');
    }
    try {
        if (mode === 'trace') {
            recorder = new Recorder(
                (record) => writeSync(output!, `${JSON.stringify(record)}\n`),
                {
                    ...loader.provenance(),
                    node: process.version,
                    target,
                    input: { path: input, sha256: sha256(content) },
                    configuration: {
                        pythonVersion: '3.12',
                        experimentalOverloadResults: !!options.experimental,
                        experimentalOptions: options.experimental ? { automatic: true, checkerHandoff: false } : null,
                    },
                    selection: { ...selection },
                    sourceProvenance,
                    sourceMeaning: 'source and runtime hashed separately; source maps do not establish build freshness',
                    tool: 'pyright-evaluation-trace',
                },
                options.limits
            );
        }
        const bridge = mode === 'clean' ? undefined : new NativeBridge(loader.sites, recorder, selection);
        loader.configure(bridge);
        const result = analyze(loader, options, content, recorder);
        loader.verifyUnchanged();
        for (const source of sourceProvenance) {
            if (source.sha256 !== null && sha256(readFileSync(source.path)) !== source.sha256) {
                throw new Error(`Source changed during capture: ${source.path}`);
            }
        }
        if (sha256(readFileSync(input)) !== sha256(content)) {
            throw new Error('Input changed during capture');
        }
        const summary: Record<string, Json> = {
            ...result,
            mode,
            audit: bridge?.auditResult() ?? null,
            activeFrames: bridge?.activeFrames ?? 0,
            provenance: loader.provenance(),
            sourceProvenance,
        };
        if (bridge?.failure) {
            finish('recorder-failed', bridge.failure);
            throw new Error(`Recorder failed; native analysis completed: ${bridge.failure}`);
        }
        recorder?.emit('summary', summary);
        finish('completed');
        if (mode !== 'trace' && output !== undefined) {
            writeSync(output, `${JSON.stringify(summary)}\n`);
        }
        return summary;
    } catch (error) {
        try {
            const message = own(error, 'message');
            finish('threw', typeof message === 'string' ? message : 'Native operation threw');
        } catch (footerError) {
            // Preserve the original native exception, but do not silently hide an
            // I/O failure that makes the artifact unusable.
            console.error('Trace footer could not be written:', footerError);
        }
        throw error;
    } finally {
        loader.dispose();
        if (output !== undefined) {
            closeSync(output);
        }
    }
}

export function compareCaptures(options: CaptureOptions) {
    if (!options.output) {
        throw new Error('Comparison requires a new output path');
    }
    const paths = [options.output, `${options.output}.clean.json`, `${options.output}.audit.json`];
    for (const path of paths) {
        if (existsSync(path)) {
            throw new Error(`Comparison output already exists: ${path}`);
        }
    }
    const clean = capture({ ...options, mode: 'clean', output: paths[1] });
    const audit = capture({ ...options, mode: 'audit', output: paths[2] });
    const traced = capture({ ...options, mode: 'trace', output: paths[0] });
    for (const key of ['diagnostics', 'liveDiagnostics', 'work', 'automatic', 'analysisFiles']) {
        if (!isDeepStrictEqual(clean[key], audit[key]) || !isDeepStrictEqual(clean[key], traced[key])) {
            throw new Error(
                `Native ${key} differed between clean, audit and traced analysis; inspect ${paths.join(', ')}`
            );
        }
    }
    if (!isDeepStrictEqual(audit.audit, traced.audit)) {
        throw new Error('Native event/type/branch/callback witness differed between audit-only and full tracing');
    }
    const witness = traced.audit as { events: number; sha256: string };
    if (witness.events === 0) {
        throw new Error(
            'Selection matched no instrumented native work; analysis completed but comparison is inconclusive'
        );
    }
    return {
        paths,
        diagnosticsMatch: true,
        liveSinksMatch: true,
        workAndCallbacksMatchInObservedScope: true,
        witness,
        durationsMs: { clean: clean.durationMs, audit: audit.durationMs, trace: traced.durationMs },
        meaning: 'Scoped fidelity evidence, not a proof of zero overhead or universal equivalence',
    };
}

function analyze(
    loader: RuntimeLoader,
    options: CaptureOptions,
    content: string,
    recorder: Recorder | undefined
): Record<string, Json> {
    const { Program } = loader.load<typeof import('../analyzer/program')>('analyzer/program.js');
    const { ImportResolver } = loader.load<typeof import('../analyzer/importResolver')>('analyzer/importResolver.js');
    const { RealTempFile, createFromRealFileSystem } =
        loader.load<typeof import('../common/realFileSystem')>('common/realFileSystem.js');
    const { createServiceProvider } = loader.load<typeof import('../common/serviceProviderExtensions')>(
        'common/serviceProviderExtensions.js'
    );
    const { NullConsole } = loader.load<typeof import('../common/console')>('common/console.js');
    const { FullAccessHost } = loader.load<typeof import('../common/fullAccessHost')>('common/fullAccessHost.js');
    const { ConfigOptions } = loader.load<typeof import('../common/configOptions')>('common/configOptions.js');
    const { UriEx } = loader.load<typeof import('../common/uri/uriUtils')>('common/uri/uriUtils.js');
    const { pythonVersion3_12 } = loader.load<typeof import('../common/pythonVersion')>('common/pythonVersion.js');
    const { createAnalyzerNodeInfoAccessor } =
        loader.load<typeof import('../analyzer/analyzerNodeInfo')>('analyzer/analyzerNodeInfo.js');
    const temp = new RealTempFile();
    const sp = createServiceProvider(createFromRealFileSystem(temp), new NullConsole(), temp);
    let program: Program | undefined;
    try {
        const uri = UriEx.file(resolve(options.input));
        const config = new ConfigOptions(uri.getDirectory());
        config.defaultPythonVersion = pythonVersion3_12;
        config.typeshedPath = UriEx.file(resolve(options.target, 'packages', 'pyright-internal', 'typeshed-fallback'));
        if (options.experimental) {
            Reflect.set(config, 'experimentalOverloadResults', true);
        }
        // The optional eighth parameter exists only in the experimental adapter's
        // target. Keep the ordinary runner independent of that analyzer extension.
        program = Reflect.construct(Program, [
            new ImportResolver(sp, config, new FullAccessHost(sp)),
            config,
            sp,
            undefined,
            undefined,
            undefined,
            undefined,
            options.experimental ? { automatic: true, checkerHandoff: false } : undefined,
        ]) as Program;
        recorder?.emit('program', { identity: recorder.atom(program), input: uri.toString(), phase: 'analysis' });
        program.setTrackedFiles([uri]);
        program.setFileOpened(uri, 1, content);
        const started = performance.now();
        while (program.analyze(undefined, options.cancellationToken)) {
            // No tracing budget or iteration cutoff controls native analysis.
        }
        const durationMs = performance.now() - started;
        const root = program.getParseResults(uri)?.parserOutput.parseTree;
        if (!root) {
            throw new Error('Analysis did not produce a parse tree');
        }
        const diagnostics = program.getSourceFile(uri)?.getDiagnostics(config);
        const nodeInfo = createAnalyzerNodeInfoAccessor(program.analyzerNodeInfoReader);
        const sink = nodeInfo.getFileInfo(root).diagnosticSink;
        const controller: unknown = Reflect.get(program, 'experimentalOverloadResultController');
        const invoke = (method: string, args: unknown[]) => {
            if (!isObject(controller)) {
                throw new Error('Experimental adapter requires a native overload controller');
            }
            const fn: unknown = Reflect.get(controller, method);
            if (typeof fn !== 'function') {
                throw new Error(`Experimental adapter drift: missing controller.${method}`);
            }
            return Reflect.apply(fn, controller, args);
        };
        return {
            diagnostics: plain(diagnostics),
            liveDiagnostics: plain(own(sink, '_diagnosticList')),
            work: options.experimental ? plain(invoke('getStats', [root])) : null,
            automatic: options.experimental ? plain(invoke('getAutomaticStats', [])) : null,
            analysisFiles: program.getSourceFileInfoList().map((info) => {
                const file = info.sourceFile;
                const data = file.getParseResults() ? file.getFileContent() : undefined;
                return {
                    uri: file.getUri().toString(),
                    sha256: data === undefined ? null : sha256(data),
                    status: data === undefined ? 'not-parsed-content-unobserved' : 'parsed-content',
                };
            }),
            durationMs,
            timingMeaning: options.mode === 'clean' ? 'clean analysis' : 'observer-instrumented; not clean performance',
        };
    } finally {
        try {
            program?.dispose();
        } finally {
            sp.dispose();
        }
    }
}
