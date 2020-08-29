/**
 * webpack.config-cli.js
 * Copyright: Microsoft 2018
 */

/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const { TsconfigPathsPlugin } = require('tsconfig-paths-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const outPath = path.resolve(__dirname, 'dist');
const typeshedFallback = path.resolve(__dirname, '..', 'pyright-internal', 'typeshed-fallback');

/**@type {import('webpack').Configuration}*/
module.exports = {
    context: __dirname,
    entry: {
        pyright: './src/pyright.ts',
        'pyright-langserver': './src/langserver.ts',
    },
    target: 'node',
    output: {
        filename: '[name].js',
        path: outPath,
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    devtool: 'source-map',
    stats: {
        all: false,
        errors: true,
        warnings: true,
    },
    resolve: {
        extensions: ['.ts', '.js'],
        plugins: [
            new TsconfigPathsPlugin({
                extensions: ['.ts', '.js'],
            }),
        ],
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
        ],
    },
    plugins: [
        new CleanWebpackPlugin(),
        new CopyPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] }),
    ],
    optimization: {
        splitChunks: {
            cacheGroups: {
                defaultVendors: {
                    name: 'vendor',
                    test: /[\\/]node_modules[\\/]/,
                    chunks: 'all',
                    priority: -10,
                },
                pyright: {
                    name: 'pyright-internal',
                    chunks: 'all',
                    test: /[\\/]pyright-internal[\\/]/,
                    priority: -20,
                },
            },
        },
    },
};
