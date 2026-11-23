/*
 * viewerServer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { randomBytes } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { createServer, ServerResponse } from 'http';
import { basename } from 'path';

import { readTrace, TraceReader } from './reader';
import { viewerCss, viewerHtml } from './viewerAssets';
import { viewerMain } from './viewerClient';
import { ViewerInputError, ViewerModel } from './viewerModel';

export interface ViewerServer {
    url: string;
    close: () => Promise<void>;
}

export function loadViewerModel(path: string) {
    if (statSync(path).size > 128 * 1024 * 1024) {
        throw new ViewerInputError('Artifact exceeds 128 MiB viewer reader limit');
    }
    return new ViewerModel(new TraceReader(readTrace(readFileSync(path, 'utf8'))), basename(path));
}

export async function startViewer(model: ViewerModel, port = 0): Promise<ViewerServer> {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
        throw new ViewerInputError('Viewer port must be 0..65535 (0 selects a free port)');
    }
    const token = randomBytes(24).toString('hex');
    const prefix = `/${token}/`;
    let origin = '';
    const assets = new Map([
        ['', { type: 'text/html; charset=utf-8', content: viewerHtml }],
        ['style.css', { type: 'text/css; charset=utf-8', content: viewerCss }],
        ['client.js', { type: 'text/javascript; charset=utf-8', content: `(${viewerMain.toString()})();` }],
    ]);
    const respond = (
        response: ServerResponse,
        status: number,
        body: string,
        type = 'application/json; charset=utf-8'
    ) => {
        response.writeHead(status, {
            'Content-Type': type,
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            'Cross-Origin-Resource-Policy': 'same-origin',
        });
        response.end(body);
    };
    const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
        try {
            if (
                request.headers.host !== origin.slice('http://'.length) ||
                (request.headers.origin && request.headers.origin !== origin) ||
                (request.headers['sec-fetch-site'] &&
                    !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))
            ) {
                throw new ViewerInputError('Only same-origin loopback requests are allowed', 403);
            }
            if (request.method !== 'GET') {
                throw new ViewerInputError('Read-only viewer: GET required', 405);
            }
            if (!request.url || request.url.length > 4096) {
                throw new ViewerInputError('Invalid or oversized request URL');
            }
            const url = new URL(request.url, origin);
            if (url.origin !== origin || !url.pathname.startsWith(prefix)) {
                throw new ViewerInputError('Unknown viewer route', 404);
            }
            const route = url.pathname.slice(prefix.length);
            const asset = assets.get(route);
            if (asset) {
                if (url.search) {
                    throw new ViewerInputError('Asset query parameters are not supported');
                }
                respond(response, 200, asset.content, asset.type);
                return;
            }
            if (request.headers['x-pyright-trace-viewer'] !== '1') {
                throw new ViewerInputError('Viewer API request header required', 403);
            }
            const allowed: Record<string, string[]> = {
                'api/summary': [],
                'api/timeline': ['offset', 'limit', 'kind', 'query', 'span', 'role'],
                'api/event': ['seq'],
                'api/entity': ['id', 'at', 'historyOffset', 'fieldOffset'],
                'api/graph': ['id', 'at', 'relation', 'hops'],
                'api/pairs': ['offset'],
                'api/comparison': ['index', 'offset'],
            };
            if (!Object.prototype.hasOwnProperty.call(allowed, route)) {
                throw new ViewerInputError('Unknown viewer API route', 404);
            }
            for (const key of url.searchParams.keys()) {
                if (!allowed[route].includes(key) || url.searchParams.getAll(key).length !== 1) {
                    throw new ViewerInputError(`Unknown or repeated parameter: ${key.slice(0, 80)}`);
                }
            }
            const text = (name: string) => url.searchParams.get(name) ?? undefined;
            const required = (name: string) => {
                const value = text(name);
                if (!value || value.length > 256) {
                    throw new ViewerInputError(`A ${name} of 1..256 characters is required`);
                }
                return value;
            };
            const number = (name: string, fallback?: number) => {
                const value = text(name);
                if (value === undefined && fallback !== undefined) {
                    return fallback;
                }
                if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                    throw new ViewerInputError(`Invalid integer parameter: ${name}`);
                }
                return Number(value);
            };
            let result: unknown;
            switch (route) {
                case 'api/summary':
                    result = model.summary();
                    break;
                case 'api/timeline':
                    result = model.timeline({
                        offset: number('offset', 0),
                        limit: number('limit', 40),
                        kind: text('kind'),
                        query: text('query'),
                        span: text('span'),
                        role: text('role'),
                    });
                    break;
                case 'api/event':
                    result = model.event(number('seq'));
                    break;
                case 'api/entity':
                    result = model.entity(
                        required('id'),
                        number('at'),
                        number('historyOffset', 0),
                        number('fieldOffset', 0)
                    );
                    break;
                case 'api/graph':
                    result = model.graph(required('id'), number('at'), text('relation'), number('hops', 1));
                    break;
                case 'api/pairs':
                    result = model.pairs(number('offset', 0));
                    break;
                case 'api/comparison':
                    result = model.comparison(number('index'), number('offset', 0));
                    break;
                default:
                    throw new ViewerInputError('Unknown route', 404);
            }
            const body = JSON.stringify(result);
            if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
                throw new ViewerInputError('Viewer response exceeds 2 MiB; narrow the selection or use the CLI', 413);
            }
            respond(response, 200, body);
        } catch (error) {
            if (error instanceof ViewerInputError) {
                respond(response, error.status, JSON.stringify({ error: error.message }));
            } else {
                console.error('Trace viewer request failed:', error);
                respond(
                    response,
                    500,
                    JSON.stringify({ error: 'Artifact could not be presented; see the local server error' })
                );
            }
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Viewer did not acquire a loopback TCP address');
    }
    origin = `http://127.0.0.1:${address.port}`;
    return {
        url: origin + prefix,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}
