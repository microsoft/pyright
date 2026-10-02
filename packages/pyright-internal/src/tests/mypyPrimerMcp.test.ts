/*
 * mypyPrimerMcp.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { verifyMcpTools } from '../../../../build/ci/mypyPrimerMcp';

jest.setTimeout(90_000);

// A headless CLI transport fixture, not an MCP server: only discovery RPCs are accepted.
const mockCli = String.raw`
const fs = require('fs');
const scenario = process.argv[2];
const trace = process.argv[3];
let buffer = Buffer.alloc(0);
let initialized = false;
const emit = (message) => {
    const body = JSON.stringify(message);
    const frame = Buffer.from('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    process.stdout.write(frame.subarray(0, 10));
    setImmediate(() => process.stdout.write(frame.subarray(10)));
};
process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const request = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    fs.appendFileSync(trace, JSON.stringify(request) + '\n');
    let result;
    if (scenario === 'exit') process.exit(7);
    if (scenario === 'malformed') {
        process.stdout.write('Content-Length: invalid\r\n\r\n{}');
        return;
    }
    if (request.method === 'session.create') {
        if (process.env.GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN) process.exit(8);
        if (request.params.provider.baseUrl !== 'http://127.0.0.1:1') process.exit(9);
        if (!process.argv.includes('--disable-builtin-mcps')) process.exit(10);
        if (!process.argv.includes('shell') || !process.argv.includes('write')) process.exit(11);
        result = scenario === 'no-session' ? {} : { sessionId: 'preflight' };
    } else if (request.method === 'session.tools.initializeAndValidate') {
        initialized = true;
        result = {};
    } else if (request.method === 'session.mcp.listTools' && initialized) {
        if (scenario === 'protocol-error') {
            emit({ jsonrpc: '2.0', id: request.id, error: {
                code: -32022, message: 'protocol version "2025-11-25" is not supported by this server'
            } });
            return;
        }
        result = { tools: request.params.serverName === 'github'
            ? [{ name: 'get_file_contents', description: '\u00e9vidence' }, { name: 'pull_request_read' }]
            : [{ name: scenario === 'missing-publisher' ? 'noop' : 'publish_primer_analysis' }] };
        if (scenario === 'no-tools') result = {};
    } else {
        process.exit(12);
    }
    emit({ jsonrpc: '2.0', id: request.id, result });
});
`;

describe('mypy_primer native MCP preflight', () => {
    let directory: string;
    let configPath: string;
    let cliPath: string;
    let tracePath: string;

    const config = () => ({
        mcpServers: Object.fromEntries(
            ['github', 'safeoutputs'].map((name) => [
                name,
                {
                    type: 'http',
                    url: `http://awmg-mcpg:8080/mcp/${name}`,
                    headers: { Authorization: 'gateway-test-key' },
                    tools: ['*'],
                },
            ])
        ),
    });
    const run = (scenario = 'success') =>
        verifyMcpTools(configPath, 8080, { file: process.execPath, args: [cliPath, scenario, tracePath] });

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'primer-mcp-test-'));
        configPath = join(directory, 'mcp.json');
        cliPath = join(directory, 'cli.cjs');
        tracePath = join(directory, 'requests.jsonl');
        writeFileSync(configPath, JSON.stringify(config()));
        writeFileSync(cliPath, mockCli);
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    test('uses native discovery without inference or tool calls, preserving gateway authentication', async () => {
        await expect(run()).resolves.toEqual({ github: 2, safeoutputs: 1 });
        const requests = readFileSync(tracePath, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(requests.map((request) => request.method)).toEqual([
            'session.create',
            'session.tools.initializeAndValidate',
            'session.mcp.listTools',
            'session.mcp.listTools',
        ]);
        expect(requests[0].params.mcpServers).toEqual({
            github: {
                type: 'http',
                url: 'http://awmg-mcpg:8080/mcp/github',
                headers: { Authorization: 'gateway-test-key' },
                tools: ['*'],
            },
            safeoutputs: {
                type: 'http',
                url: 'http://awmg-mcpg:8080/mcp/safeoutputs',
                headers: { Authorization: 'gateway-test-key' },
                tools: ['*'],
            },
        });
    });

    test.each([
        ['protocol-error', 'protocol version "2025-11-25" is not supported'],
        ['missing-publisher', 'Required MCP tool is unavailable: safeoutputs/publish_primer_analysis'],
        ['no-tools', 'Missing MCP tool list for github'],
        ['no-session', 'Copilot MCP preflight did not create a session'],
        ['exit', 'Copilot MCP preflight exited with code 7'],
        ['malformed', 'Invalid Copilot MCP preflight message length'],
    ])('fails closed for %s', async (scenario, error) => {
        await expect(run(scenario)).rejects.toThrow(error);
    });

    test('reports an unavailable CLI rather than succeeding without discovery', async () => {
        await expect(
            verifyMcpTools(configPath, 8080, { file: join(directory, 'missing-cli'), args: [] })
        ).rejects.toThrow('ENOENT');
    });

    test.each(['https://example.com:8080/mcp/github', 'http://awmg-mcpg:8080/mcp/unexpected'])(
        'rejects an unexpected gateway endpoint: %s',
        async (url) => {
            const value = config();
            value.mcpServers.github.url = url;
            writeFileSync(configPath, JSON.stringify(value));
            await expect(run()).rejects.toThrow('Unexpected gateway endpoint for github');
        }
    );

    test('requires both gateway configurations', async () => {
        writeFileSync(configPath, JSON.stringify({ mcpServers: { github: config().mcpServers.github } }));
        await expect(run()).rejects.toThrow('Expected an object');
    });

    test.each([0, 65536, NaN])('rejects invalid gateway port %s', async (port) => {
        await expect(verifyMcpTools(configPath, port)).rejects.toThrow('Invalid MCP gateway port');
    });

    test.each([false, true])('gates the standard harness on discovery (failure: %s)', (fail) => {
        const wrapper = join(directory, 'mypyPrimerCopilotHarness.cjs');
        const marker = join(directory, 'standard-harness.json');
        copyFileSync(join(__dirname, '../../../../build/ci/mypyPrimerCopilotHarness.cjs'), wrapper);
        writeFileSync(
            join(directory, 'mypyPrimerMcp.ts'),
            `exports.verifyMcpTools = async (config, port, command, temporaryRoot) => {
                if (config !== process.env.GH_AW_MCP_CONFIG || port !== 8080 || command.file !== 'installed-copilot') {
                    throw new Error('Incorrect preflight configuration');
                }
                if (temporaryRoot !== '/tmp/gh-aw') throw new Error('Preflight must use the writable sandbox mount');
                if (${fail}) throw new Error('Required MCP tool is unavailable');
                return { github: 2, safeoutputs: 1 };
            };`
        );
        writeFileSync(
            join(directory, 'copilot_harness.cjs'),
            `require('fs').writeFileSync(process.env.PRIMER_TEST_MARKER, JSON.stringify({
                args: process.argv.slice(2), env: process.env.PRIMER_TEST_ENV
            }));
            process.exitCode = 17;`
        );
        const result = spawnSync(process.execPath, [wrapper, 'installed-copilot', '--unchanged-argument'], {
            env: {
                ...process.env,
                GH_AW_MCP_CONFIG: configPath,
                PRIMER_TEST_MARKER: marker,
                PRIMER_TEST_ENV: 'unchanged',
            },
            encoding: 'utf8',
            timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(fail ? 1 : 17);
        expect(existsSync(marker)).toBe(!fail);
        if (fail) {
            expect(result.stderr).toContain('Required MCP tool is unavailable');
        } else {
            expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
                args: ['installed-copilot', '--unchanged-argument'],
                env: 'unchanged',
            });
        }
    });
});
