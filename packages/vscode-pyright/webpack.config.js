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
        extension: './src/extension.ts',
        server: './src/server.ts',
    },
    target: 'node',
    output: {
        filename: '[name].js',
        path: outPath,
        libraryTarget: 'commonjs2',
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
        vscode: 'commonjs vscode',
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
};
