/*
 * jest.config.js
 *
 * Configuration for jest tests.
 */

module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src/tests'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    target: 'es2019',

                    // Needed because jest calls tsc in a way that doesn't
                    // inline const enums.
                    preserveConstEnums: false,
                },
            },
        ],
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
