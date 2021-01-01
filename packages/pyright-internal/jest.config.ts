/*
 * jest.config.ts
 *
 * Configuration for jest tests.
 */
import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
    roots: ['<rootDir>/src/tests'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    globals: {
        'ts-jest': {
            tsconfig: {
                target: 'es6',

                // Needed because jest calls tsc in a way that doesn't
                // inline const enums.
                preserveConstEnums: false,
            },
        },
    },
};
export default config;
