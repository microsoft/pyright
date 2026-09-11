const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../packages/pyright-internal');
const tsJest = require(require.resolve('ts-jest', { paths: [root] }));
const transformer = tsJest.default.createTransformer({
    tsconfig: path.join(root, 'tsconfig.jest.json'),
    diagnostics: { ignoreCodes: [151002] },
});

function instrument(source, filename) {
    if (filename === path.join(root, 'src/analyzer/protocols.ts') && process.env.STATE_AUDIT_DISABLED === '1') {
        const anchor = '!checkState?.isUniversalCompatibilityCheck &&';
        assert.equal(source.split(anchor).length, 2);
        source = source.replace(anchor, 'Boolean(false) && ' + anchor);
    }
    if (filename === path.join(root, 'src/tests/protocolRequirementState.test.ts')) {
        const anchor = 'return results;';
        assert.equal(source.split(anchor).length, 2);
        source = source.replace(
            anchor,
            "require('fs').appendFileSync(process.env.STATE_AUDIT_OUTPUT!, " +
                "JSON.stringify({ element, member, concrete, seed, diagnostics, results }) + '\\n'); " +
                anchor
        );
    }
    return source;
}

module.exports = {
    getCacheKey(source, filename, options) {
        return transformer.getCacheKey(instrument(source, filename), filename, options);
    },
    process(source, filename, options) {
        return transformer.process(instrument(source, filename), filename, options);
    },
};
