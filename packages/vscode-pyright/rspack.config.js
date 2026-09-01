const path = require('path');
const { createRequire } = require('module');
const { monorepoResourceNameMapper, tsconfigResolveAliases } = require('../../build/lib/webpack');

const rspack = createRequire(__filename)('@rspack/core');
const outPath = path.resolve(__dirname, 'dist');
const typeshedFallback = path.resolve(__dirname, '..', 'pyright-internal', 'typeshed-fallback');

/** @type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => any} */
module.exports = (_, { mode }) => {
    return {
        context: __dirname,
        entry: {
            extension: './src/extension.ts',
            server: './src/server.ts',
        },
        target: 'node',
        output: {
            filename: '[name].js',
            path: outPath,
            library: {
                type: 'commonjs2',
            },
            devtoolModuleFilenameTemplate:
                mode === 'development' ? '../[resource-path]' : monorepoResourceNameMapper('vscode-pyright'),
            clean: true,
        },
        devtool: mode === 'development' ? 'source-map' : 'nosources-source-map',
        cache: mode === 'development',
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
            vscode: 'commonjs vscode',
            fsevents: 'commonjs2 fsevents',
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                    },
                },
            ],
        },
        plugins: [new rspack.CopyRspackPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] })],
    };
};
