/*
 * mypyPrimerMcp.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Check the installed Copilot CLI's native MCP discovery without requesting inference.
 */

import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an object in the MCP preflight response or configuration');
    }
    return value as Record<string, unknown>;
}

export async function verifyMcpTools(
    configPath: string,
    gatewayPort: number,
    command: { file: string; args: string[] } = { file: 'copilot', args: [] },
    temporaryRoot = tmpdir()
) {
    if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
        throw new Error('Invalid MCP gateway port');
    }
    const requiredTools = {
        github: ['get_file_contents', 'pull_request_read'],
        safeoutputs: ['publish_primer_analysis'],
    };
    const configured = record(record(JSON.parse(readFileSync(configPath, 'utf8'))).mcpServers);
    const mcpServers = Object.fromEntries(
        Object.keys(requiredTools).map((name) => {
            const server = record(configured[name]);
            const url = new URL(String(server.url));
            if (
                server.type !== 'http' ||
                url.protocol !== 'http:' ||
                !['awmg-mcpg', 'localhost', '127.0.0.1'].includes(url.hostname) ||
                Number(url.port || 80) !== gatewayPort ||
                url.pathname !== `/mcp/${name}` ||
                url.username ||
                url.password ||
                url.search ||
                url.hash
            ) {
                throw new Error(`Unexpected gateway endpoint for ${name}`);
            }
            return [name, { type: 'http', url: url.href, headers: record(server.headers), tools: ['*'] }];
        })
    );

    const home = mkdtempSync(join(temporaryRoot, 'primer-mcp-preflight-'));
    const cli = spawn(
        command.file,
        [
            ...command.args,
            '--headless',
            '--stdio',
            '--no-auto-update',
            '--disable-builtin-mcps',
            '--deny-tool',
            'shell',
            '--deny-tool',
            'write',
        ],
        {
            cwd: home,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                HOME: home,
                XDG_CONFIG_HOME: home,
                COPILOT_API_KEY: 'unused-preflight-key',
                COPILOT_API_URL: 'http://127.0.0.1:1',
            },
        }
    );
    const closed = new Promise<void>((resolve) => cli.once('close', () => resolve()));
    let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
    let failure: Error | undefined;
    let buffer = Buffer.alloc(0);
    let nextId = 0;
    const fail = (error: Error) => {
        failure = error;
        pending?.reject(error);
        pending = undefined;
        cli.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(new Error('Copilot MCP discovery timed out after 60 seconds')), 60_000);
    cli.on('error', fail);
    cli.on('close', (code) => fail(new Error(`Copilot MCP preflight exited with code ${code}`)));
    cli.stdin.on('error', fail);
    cli.stdout.on('error', fail);
    cli.stderr.resume();
    cli.stdout.on('data', (chunk: Buffer) => {
        try {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 8 * 1024 * 1024) {
                throw new Error('Oversized Copilot MCP preflight response');
            }
            // The CLI's headless SDK transport uses Content-Length framed JSON-RPC.
            while (true) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd < 0) {
                    break;
                }
                const lengthMatch = /^Content-Length: (\d+)$/im.exec(buffer.subarray(0, headerEnd).toString());
                const length = Number(lengthMatch?.[1]);
                if (!Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024) {
                    throw new Error('Invalid Copilot MCP preflight message length');
                }
                const end = headerEnd + 4 + length;
                if (buffer.length < end) {
                    break;
                }
                const message = record(JSON.parse(buffer.subarray(headerEnd + 4, end).toString()));
                buffer = buffer.subarray(end);
                if (message.id === undefined) {
                    continue;
                }
                if (!pending || message.id !== pending.id || message.method !== undefined) {
                    throw new Error('Unexpected Copilot MCP preflight response');
                }
                if (message.error !== undefined) {
                    throw new Error(`Copilot MCP discovery failed: ${String(record(message.error).message)}`);
                }
                pending.resolve(message.result);
                pending = undefined;
            }
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    });
    const request = (method: string, params: Record<string, unknown>) =>
        new Promise<unknown>((resolve, reject) => {
            if (failure) {
                reject(failure);
                return;
            }
            const id = ++nextId;
            pending = { id, resolve, reject };
            const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            cli.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        });

    try {
        const session = record(
            await request('session.create', {
                clientName: 'pyright-primer-mcp-preflight',
                workingDirectory: home,
                model: 'gpt-4.1',
                provider: { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'unused-preflight-key' },
                mcpServers,
            })
        );
        if (typeof session.sessionId !== 'string' || !session.sessionId) {
            throw new Error('Copilot MCP preflight did not create a session');
        }
        const { sessionId } = session;
        await request('session.tools.initializeAndValidate', { sessionId });
        const counts: Record<string, number> = {};
        for (const [serverName, required] of Object.entries(requiredTools)) {
            const result = record(await request('session.mcp.listTools', { sessionId, serverName }));
            if (!Array.isArray(result.tools)) {
                throw new Error(`Missing MCP tool list for ${serverName}`);
            }
            const names = result.tools.map((tool: unknown) => record(tool).name);
            for (const tool of required) {
                if (!names.includes(tool)) {
                    throw new Error(`Required MCP tool is unavailable: ${serverName}/${tool}`);
                }
            }
            counts[serverName] = names.length;
        }
        return counts;
    } finally {
        clearTimeout(timer);
        cli.kill('SIGKILL');
        await closed;
        rmSync(home, { recursive: true, force: true });
    }
}
