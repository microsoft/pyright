const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const { values } = parseArgs({
    options: {
        python: { type: 'string' },
        'baseline-root': { type: 'string' },
        output: { type: 'string', default: path.join(__dirname, 'results/numpy-canary') },
        'max-seconds': { type: 'string', default: '10' },
        'timeout-seconds': { type: 'string', default: '30' },
    },
});
assert.ok(values.python, '--python must identify a dedicated Python 3.12 environment with numpy==2.4.6');
assert.equal(process.version, 'v24.15.0', 'Use the pinned Node version');
const maxSeconds = Number(values['max-seconds']);
const timeoutSeconds = Number(values['timeout-seconds']);
assert.ok(Number.isFinite(maxSeconds) && maxSeconds > 0);
assert.ok(Number.isFinite(timeoutSeconds) && timeoutSeconds > maxSeconds);
const directory = path.resolve(values.output);
fs.mkdirSync(directory, { recursive: true });
const environment = spawnSync(
    values.python,
    [
        '-I',
        '-c',
        'import json, sys, numpy; print(json.dumps({"python": sys.version, "version": list(sys.version_info[:2]), "numpy": numpy.__version__, "numpyPath": numpy.__file__}))',
    ],
    { encoding: 'utf8', timeout: 30000 }
);
assert.ifError(environment.error);
assert.equal(environment.status, 0, environment.stderr);
const python = JSON.parse(environment.stdout);
assert.deepEqual(python.version, [3, 12]);
assert.equal(python.numpy, '2.4.6');
const roots = { candidate: path.resolve(__dirname, '../..') };
if (values['baseline-root']) roots.baseline = path.resolve(values['baseline-root']);
const fixtures = path.join(__dirname, 'canaries/numpy');
const hash = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const provenance = { node: process.version, python, maxSeconds, timeoutSeconds, roots, hashes: {} };
for (const [name, root] of Object.entries(roots)) {
    const dist = path.join(root, 'packages/pyright/dist');
    provenance.hashes[name] = Object.fromEntries(
        fs
            .readdirSync(dist)
            .filter((file) => file.endsWith('.js'))
            .map((file) => [file, hash(path.join(dist, file))])
    );
    const diff = spawnSync('git', ['-C', root, 'diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.ifError(diff.error);
    assert.equal(diff.status, 0, diff.stderr);
    fs.writeFileSync(path.join(directory, name + '.patch'), diff.stdout);
    const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    assert.equal(revision.status, 0, revision.stderr);
    provenance[name + 'Commit'] = revision.stdout.trim();
}
provenance.fixtures = Object.fromEntries(
    ['exact.py', 'controls.py', 'pyrightconfig.json'].map((file) => [file, hash(path.join(fixtures, file))])
);
provenance.runner = hash(__filename);
fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2));
const records = [];
for (let repetition = 0; repetition < 3; repetition++) {
    const names = Object.keys(roots);
    if (repetition % 2) names.reverse();
    for (const name of names) {
        for (const fixture of ['exact.py', 'controls.py']) {
            const root = roots[name];
            const start = performance.now();
            const result = spawnSync(
                process.execPath,
                [
                    path.join(root, 'packages/pyright/index.js'),
                    '--pythonpath',
                    values.python,
                    '--pythonversion',
                    '3.12',
                    '--typeshedpath',
                    path.join(root, 'packages/pyright-internal/typeshed-fallback'),
                    '--project',
                    path.join(fixtures, 'pyrightconfig.json'),
                    '--outputjson',
                    path.join(fixtures, fixture),
                ],
                {
                    encoding: 'utf8',
                    timeout: timeoutSeconds * 1000,
                    maxBuffer: 32 * 1024 * 1024,
                    env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: '' },
                }
            );
            const seconds = (performance.now() - start) / 1000;
            const prefix = path.join(directory, `${repetition}-${name}-${fixture}`);
            fs.writeFileSync(prefix + '.stdout', result.stdout || '');
            fs.writeFileSync(prefix + '.stderr', result.stderr || '');
            assert.ifError(result.error);
            const output = JSON.parse(result.stdout);
            const diagnostics = output.generalDiagnostics;
            if (fixture === 'exact.py') {
                assert.equal(result.status, 0);
                assert.equal(diagnostics.length, 1);
                assert.equal(diagnostics[0].severity, 'information');
                assert.equal(diagnostics[0].message, 'Type of "result" is "ndarray[tuple[Any, ...], dtype[Any]]"');
            } else {
                assert.equal(result.status, 1);
                assert.equal(
                    diagnostics.length,
                    1,
                    'Positive dtype assertions must pass and negative control must fail'
                );
                assert.equal(diagnostics[0].rule, 'reportArgumentType');
                assert.equal(diagnostics[0].range.start.line, 16);
            }
            records.push({ name, fixture, repetition, seconds, output });
            fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(records, null, 2));
            console.log(JSON.stringify({ name, fixture, repetition, seconds }));
        }
    }
}
for (const fixture of ['exact.py', 'controls.py']) {
    const matching = records.filter((record) => record.fixture === fixture);
    for (const record of matching)
        assert.deepEqual(record.output.generalDiagnostics, matching[0].output.generalDiagnostics);
}
const times = records
    .filter((record) => record.name === 'candidate' && record.fixture === 'exact.py')
    .map((record) => record.seconds)
    .sort((left, right) => left - right);
assert.ok(times[1] <= maxSeconds, `NumPy canary median ${times[1]}s exceeds ${maxSeconds}s`);
console.log(JSON.stringify({ candidateMedianSeconds: times[1], maxSeconds, artifacts: directory }));
