const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

module.exports = [
    {
        ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/tests/fourslash/**', '**/.*'],
    },
    // Share rule definitions with Pyrx without depending on its workspace.
    ...compat.extends('./.eslintrc.json'),
    {
        files: ['**/*.{js,ts,tsx,cjs,mjs}'],
        // Keep the existing rule set rather than enabling additional ESLint 10 checks.
        rules: {
            'no-unassigned-vars': 'off',
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off',
        },
        linterOptions: { reportUnusedDisableDirectives: false },
    },
];
