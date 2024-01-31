/**
 * webpack.config-cli.js
 * Copyright: Microsoft 2018
 */

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const { tsconfigResolveAliases } = require('../../../../../build/lib/webpack');

const outPath = path.resolve(__dirname, '..', '..', '..', 'out');
const typeshedFallback = path.resolve(__dirname, '..', '..', '..', 'typeshed-fallback');

/**@type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => import('webpack').Configuration}*/
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
            libraryTarget: 'commonjs2',
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
                        configFile: 'tsconfig.json',
                    },
                },
                {
                    // Transform pre-compiled JS files to use syntax available in Node 12+.
                    // esbuild is fast, so let it run on all JS files rather than matching
                    // only known-bad libs.
                    test: /\.js$/,
                    loader: 'esbuild-loader',
                    options: {
                        target: 'node12',
                    },
                },
            ],
        },
        plugins: [new CopyPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] })],
    };
};
