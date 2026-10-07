const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const internal = path.join(root, 'packages/pyright-internal');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-state-continuation-'));
const transform = path.join(__dirname, 'protocolRequirementStateTransform.cjs');
const inputs = [
    path.join(internal, 'src/analyzer/protocols.ts'),
    path.join(internal, 'src/tests/protocolRequirementState.test.ts'),
    transform,
    __filename,
];
const hashes = Object.fromEntries(
    inputs.map((file) => [
        path.relative(root, file),
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ])
);
fs.writeFileSync(
    path.join(directory, 'provenance.json'),
    JSON.stringify({ node: process.version, root, hashes }, null, 2)
);
console.log('ARTIFACTS ' + directory);
const traces = {};
for (const mode of ['structural', 'candidate']) {
    const output = path.join(directory, mode + '.jsonl');
    const result = spawnSync(
        process.execPath,
        [
            require.resolve('jest/bin/jest', { paths: [internal] }),
            '--testPathPatterns=protocolRequirementState.test',
            '--runInBand',
            '--forceExit',
            '--no-cache',
            '--transform=' + JSON.stringify({ '^.+\\.tsx?$': transform }),
        ],
        {
            cwd: internal,
            env: {
                ...process.env,
                STATE_AUDIT_OUTPUT: output,
                STATE_AUDIT_DISABLED: mode === 'structural' ? '1' : '0',
            },
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        }
    );
    fs.writeFileSync(path.join(directory, mode + '.log'), result.stdout + result.stderr);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    traces[mode] = fs
        .readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    assert.equal(traces[mode].length, 64);
    console.log(mode + ': 32 tests passed, 64 diagnostic/non-diagnostic traces captured');
}
assert.deepEqual(traces.candidate, traces.structural);
const observations = traces.candidate.reduce((total, trace) => total + trace.results.length, 0);
console.log(JSON.stringify({ exactTraceParity: true, traces: 64, observations }));
