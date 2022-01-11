/*
 * jest.config.js
 *
 * Configuration for jest tests.
 */

// jest.config.js
const { pathsToModuleNameMapper } = require('ts-jest');
// In the following statement, replace `./tsconfig` with the path to your `tsconfig` file
// which contains the path mapping (ie the `compilerOptions.paths` option):
const { compilerOptions } = require('./tsconfig');

module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src/tests'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>' }),
    globals: {
        'ts-jest': {
            tsconfig: {
                baseUrl: '.',
                target: 'es6',

                // Needed because jest calls tsc in a way that doesn't
                // inline const enums.
                preserveConstEnums: false,
            },
        },
    },
};
