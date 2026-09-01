const path = require('path');
const { createRequire } = require('module');
const { tsconfigResolveAliases } = require('../../../../../build/lib/webpack');

const rspack = createRequire(__filename)('@rspack/core');
const outPath = path.resolve(__dirname, '..', '..', '..', 'out');
const tsconfigPath = path.resolve(__dirname, '..', '..', '..', 'tsconfig.json');
const typeshedFallback = path.resolve(__dirname, '..', '..', '..', 'typeshed-fallback');

/** @type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => any} */
module.exports = (_, { mode }) => {
    return {
        context: __dirname,
        entry: {
            testServer: './main.ts',
        },
        target: 'node',
        output: {
            filename: '[name].bundle.js',
            path: outPath,
            library: {
                type: 'commonjs2',
            },
            devtoolModuleFilenameTemplate: '[absolute-resource-path]',
        },
        devtool: 'source-map',
        stats: {
            all: false,
            errors: true,
            warnings: true,
            publicPath: true,
            timings: true,
        },
        resolve: {
            extensions: ['.ts', '.js'],
            alias: tsconfigResolveAliases('tsconfig.json'),
        },
        externals: {
            fsevents: 'commonjs2 fsevents',
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        configFile: tsconfigPath,
                    },
                },
                {
                    test: /\.js$/,
                    loader: 'esbuild-loader',
                    options: {
                        target: 'node12',
                    },
                },
            ],
        },
        plugins: [new rspack.CopyRspackPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] })],
    };
};
