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
        pyright: './src/pyright.ts',
        'pyright-langserver': './src/langserver.ts',
    },
    target: 'node',
    output: {
        filename: '[name].js',
        path: outPath,
        devtoolModuleFilenameTemplate:
            process.env.NODE_ENV === 'development' ? '../[resource-path]' : monorepoResourceNameMapper('pyright'),
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
export default config;
