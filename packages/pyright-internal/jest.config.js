/*
 * jest.config.js
 *
 * Configuration for jest tests.
 */

// When PYLANCE_JEST_TRANSPILE_ONLY=1 (set by pyrx CI), switch ts-jest into transpile-only
// mode via `isolatedModules: true` (uses `tsc.transpileModule`, no type checking — much
// faster). Tests are still type-checked by the dedicated `Typecheck` CI job. When unset
// (default / local dev), ts-jest runs with full type-checking so type errors still surface.
//
// We intentionally stay on ts-jest in both modes so the emitted JS is byte-identical to the
// local-dev configuration. Alternative transformers like @swc/jest can break edge cases the
// rest of the test suite relies on (e.g. `jest.spyOn` on namespace exports — SWC emits
// non-configurable getters — or `override readonly field!:` subclass fields, which SWC
// re-defines after `super()` returns and so wipes the parent's assignment).
const useTranspileOnly = process.env.PYLANCE_JEST_TRANSPILE_ONLY === '1';

// In transpile-only mode we pass an inline compilerOptions object so we can force
// `module: 'commonjs'`. The parent tsconfig chain sets `module: 'node16'`, which would
// otherwise leave dynamic `import()` calls untransformed — those then require
// `--experimental-vm-modules` under Jest. The set of options below mirrors the bits of
// `tsconfig.jest.json` that matter for `tsc.transpileModule`.
const transpileOnlyTsconfig = {
    target: 'es2019',
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    experimentalDecorators: true,
    resolveJsonModule: true,
    isolatedModules: true,
    preserveConstEnums: false,
    baseUrl: '.',
    paths: {
        'vscode-languageserver': ['./node_modules/vscode-languageserver/lib/common/api'],
        'vscode-languageserver/node': ['./node_modules/vscode-languageserver/lib/node/main'],
        'vscode-languageserver-protocol': ['./node_modules/vscode-languageserver-protocol/lib/common/api'],
        'vscode-languageserver-textdocument': ['./node_modules/vscode-languageserver-textdocument/lib/umd/main'],
        'vscode-languageserver-types': ['./node_modules/vscode-languageserver-types/lib/umd/main'],
        'vscode-jsonrpc': ['./node_modules/vscode-jsonrpc/lib/common/api'],
        'vscode-jsonrpc/node': ['./node_modules/vscode-jsonrpc/lib/node/main'],
    },
};

const transform = {
    '^.+\\.tsx?$': [
        'ts-jest',
        useTranspileOnly
            ? {
                  tsconfig: transpileOnlyTsconfig,
                  isolatedModules: true,
                  diagnostics: false,
              }
            : {
                  tsconfig: 'tsconfig.jest.json',
                  diagnostics: {
                      ignoreCodes: [151002],
                  },
              },
    ],
};

module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src/tests'],
    transform,
    // Place jest's transform cache inside node_modules so the existing node_modules CI cache
    // preserves it across runs.
    cacheDirectory: '<rootDir>/node_modules/.cache/jest',
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
