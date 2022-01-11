module.exports = {
    extends: '@sourcegraph/eslint-config',
    env: {
        browser: true,
        node: true,
    },
    parserOptions: {
        project: 'tsconfig.json',
    },
    ignorePatterns: ['temp', 'lsif.ts', 'snapshots'],
    rules: {},
};
