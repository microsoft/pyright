/**
* webpack.config-pyright.js
* Copyright: Microsoft 2018
*
* Configuration for webpack to bundle the javascript into a single file
* for the pyright command-line tool.
*/

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
        modules: [
            path.resolve(__dirname, '.'),
            'node_modules'
        ],
        // Add '.ts' and '.tsx' as resolvable extensions.
        extensions: ['.webpack.js', '.web.js', '.ts', '.tsx', '.js']
    },

    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                options: {
                    configFile: 'tsconfig.json'
                }
            }
        ]
    },

    node: {
        fs: 'empty'
    }
};
