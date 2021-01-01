/**
 * webpack.config.ts
 * Copyright: Microsoft 2018
 */

import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import path from 'path';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import webpack from 'webpack';

import monorepoResourceNameMapper from '../../build/lib/webpack';

const outPath = path.resolve(__dirname, 'dist');
const typeshedFallback = path.resolve(__dirname, '..', 'pyright-internal', 'typeshed-fallback');

const config: webpack.Configuration = {
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
        devtoolModuleFilenameTemplate:
            process.env.NODE_ENV === 'development'
                ? '../[resource-path]'
                : monorepoResourceNameMapper('vscode-pyright'),
    },
    devtool: process.env.NODE_ENV === 'development' ? 'source-map' : 'nosources-source-map',
    stats: {
        all: false,
        errors: true,
        warnings: true,
    },
    resolve: {
        extensions: ['.ts', '.js'],
        plugins: [
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            new TsconfigPathsPlugin({
                configFile: 'tsconfig.withBaseUrl.json', // TODO: Remove once the plugin understands TS 4.1's implicit baseUrl.
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

export default config;
