/*
 * cli.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { readFileSync, statSync } from 'fs';

import { capture, CaptureOptions, compareCaptures } from './capture';
import { readTrace, TraceReader } from './reader';
import { loadViewerModel, startViewer } from './viewerServer';

const help = `Pyright evaluation traces (developer-only, local unbundled builds)
  capture --target <repo> --input <python> --output <new.ndjson>
          [--runtime <unbundled src>] [--experimental]
          [--mode trace|audit|clean] [--file <python> --start <offset> --end <offset>]
          [--operation <native operation id>] [--events <n>] [--bytes <n>] [--depth <n>]
  compare <same capture options>  (writes clean/audit JSON alongside the trace)
  query <artifact.ndjson> timeline [--kind <kind>] [--span <id>]
  query <artifact.ndjson> history|latest --entity <id> [--at <sequence>]
  query <artifact.ndjson> neighbors --entity <id> [--relation <relation>]
  query <artifact.ndjson> pairs
  query <artifact.ndjson> diff --baseline <span> --replay <span>
  query <artifact.ndjson> summary|coverage
  view <artifact.ndjson> [--port <0..65535>]  (loopback-only; Ctrl+C stops)
All offsets are zero-based UTF-16 offsets. Output paths must not already exist.
An absent event is not proof of no effect; inspect coverage and the footer.`;

export async function main(argv = process.argv.slice(2)) {
    if (!argv.length || argv.includes('--help')) {
        console.log(help);
        return;
    }
    const positionals: string[] = [];
    const flags = new Map<string, string>();
    const allowed = new Set([
        'target',
        'input',
        'output',
        'runtime',
        'experimental',
        'mode',
        'file',
        'start',
        'end',
        'operation',
        'events',
        'bytes',
        'depth',
        'kind',
        'span',
        'entity',
        'at',
        'relation',
        'baseline',
        'replay',
        'port',
    ]);
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }
        const name = token.slice(2);
        if (!allowed.has(name) || flags.has(name)) {
            throw new Error(`Unknown or repeated option ${token}`);
        }
        if (name === 'experimental') {
            flags.set(name, 'true');
        } else {
            const value = argv[++i];
            if (!value || value.startsWith('--')) {
                throw new Error(`Missing value for ${token}`);
            }
            flags.set(name, value);
        }
    }
    const required = (name: string) => {
        const value = flags.get(name);
        if (!value) {
            throw new Error(`--${name} is required`);
        }
        return value;
    };
    const number = (name: string): number | undefined => {
        const value = flags.get(name);
        if (value === undefined) {
            return undefined;
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
            throw new Error(`Invalid --${name}: ${value}`);
        }
        return parsed;
    };
    const [command, path, query] = positionals;
    if (command === 'view') {
        if (!path || positionals.length !== 2 || [...flags.keys()].some((flag) => flag !== 'port')) {
            throw new Error('Usage: view <artifact.ndjson> [--port <0..65535>]');
        }
        const viewer = await startViewer(loadViewerModel(path), number('port'));
        console.log(
            `Pyright trace viewer: ${viewer.url}\nPID ${process.pid}. Local read-only artifact; Ctrl+C to stop.`
        );
        let closing = false;
        const stop = () => {
            if (!closing) {
                closing = true;
                viewer
                    .close()
                    .catch((error) => {
                        console.error('Viewer shutdown failed:', error);
                        process.exitCode = 1;
                    })
                    .finally(() => {
                        process.removeListener('SIGINT', stop);
                        process.removeListener('SIGTERM', stop);
                    });
            }
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        return;
    }
    if (command === 'capture' || command === 'compare') {
        const mode = flags.get('mode') ?? 'trace';
        if (!['trace', 'audit', 'clean'].includes(mode)) {
            throw new Error(`Invalid mode ${mode}`);
        }
        const options: CaptureOptions = {
            target: required('target'),
            input: required('input'),
            output: required('output'),
            runtime: flags.get('runtime'),
            mode: mode as CaptureOptions['mode'],
            experimental: flags.has('experimental'),
            selection: {
                file: flags.get('file') ?? required('input'),
                start: number('start'),
                end: number('end'),
                operation: number('operation'),
            },
            limits: Object.fromEntries(
                ['events', 'bytes', 'depth'].filter((name) => flags.has(name)).map((name) => [name, number(name)])
            ),
        };
        if (command === 'compare') {
            console.log(JSON.stringify(compareCaptures(options), null, 2));
            return;
        }
        const result = capture(options);
        console.log(
            JSON.stringify({ mode, output: options.output, audit: result.audit, diagnostics: result.diagnostics })
        );
        return;
    }
    if (command !== 'query' || !path) {
        throw new Error(help);
    }
    if (statSync(path).size > 128 * 1024 * 1024) {
        throw new Error('Artifact exceeds reader byte limit');
    }
    const reader = new TraceReader(readTrace(readFileSync(path, 'utf8')));
    let result: unknown;
    switch (query) {
        case 'timeline':
            result = reader.timeline(flags.get('kind'), flags.get('span'));
            break;
        case 'history':
            result = reader.history(required('entity'), number('at'));
            break;
        case 'latest':
            result = reader.latest(required('entity'), number('at'));
            break;
        case 'neighbors':
            result = reader.neighborhood(required('entity'), flags.get('relation'));
            break;
        case 'pairs':
            result = reader.pairs();
            break;
        case 'diff':
            result = reader.diff(required('baseline'), required('replay'));
            break;
        case 'coverage':
            result = [reader.records[0], reader.records[reader.records.length - 1]];
            break;
        case 'summary':
            result = reader.records.filter((r) => r.kind === 'summary');
            break;
        default:
            throw new Error(`Unknown query ${query}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
