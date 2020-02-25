/**
 * webpack.config-pyright.js
 * Copyright: Microsoft 2018
 *
 * Configuration for webpack to bundle the javascript into a single file
 * for the pyright command-line tool.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path');

module.exports = {
    entry: './src/pyright.ts',
    mode: 'development',
    target: 'node',
    output: {
        filename: 'pyright.js',
        path: path.resolve(__dirname, '../dist')
    },
    resolve: {
        modules: [path.resolve(__dirname, '.'), 'node_modules'],
        extensions: ['.js', '.ts']
    },

    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                options: {
                    configFile: 'tsconfig.json'
                }
            },
            {
                test: /\.node$/,
                loader: 'node-loader'
            }
        ]
    },

    node: {
        fs: 'empty'
    }
};
