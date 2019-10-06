/**
* webpack.config-server.js
* Copyright: Microsoft 2018
*
* Configuration for webpack to bundle the javascript into a single file
* for the VS Code Extension language server.
*/

const path = require('path');

module.exports = {
    entry: './src/server.ts',
    mode: 'development',
    target: 'node',
    output: {
        filename: 'server.js',
        path: path.resolve(__dirname, '../client/server')
    },
    resolve: {
        modules: [
            path.resolve(__dirname, '.'),
            'node_modules'
        ],
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
            }
        ]
    },
    node: {
        fs: 'empty'
    }
};
