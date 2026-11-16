const path = require('path');
const { createRequire } = require('module');

const rspack = createRequire(__filename)('@rspack/core');
const internal = path.resolve(__dirname, '../pyright-internal');

/** @type {import('@rspack/core', { with: { 'resolution-mode': 'import' } }).Configuration} */
module.exports = {
    context: __dirname,
    mode: 'production',
    target: 'webworker',
    entry: {
        worker: '../pyright-internal/src/browser/worker.ts',
        client: './src/browser/client.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist/playground'),
        filename: '[name].js',
        publicPath: 'auto',
        clean: true,
    },
    resolve: {
        extensions: ['.ts', '.js'],
        mainFields: ['browser', 'module', 'main'],
        alias: { 'process/browser': require.resolve('process/browser') },
        fallback: {
            path: require.resolve('path-browserify'),
            buffer: require.resolve('buffer/'),
            crypto: false,
            v8: false,
            os: false,
            worker_threads: false,
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                options: {
                    configFile: path.resolve(__dirname, 'tsconfig.browser.json'),
                    onlyCompileBundledFiles: true,
                },
            },
        ],
    },
    plugins: [
        new rspack.ProvidePlugin({
            process: path.join(internal, 'src/browser/browserProcess.ts'),
            Buffer: ['buffer', 'Buffer'],
        }),
        new rspack.CopyRspackPlugin({
            patterns: [
                { from: path.join(internal, 'typeshed-fallback/stdlib'), to: 'typeshed-fallback/stdlib' },
                { from: path.join(internal, 'typeshed-fallback/LICENSE'), to: 'typeshed-fallback/LICENSE' },
                { from: path.resolve(__dirname, '../../LICENSE.txt'), to: 'LICENSE.txt' },
                { from: 'src/browser/index.html', to: 'index.html' },
            ],
        }),
        {
            /** @param {import('@rspack/core', { with: { 'resolution-mode': 'import' } }).Compiler} compiler */
            apply(compiler) {
                compiler.hooks.thisCompilation.tap('BrowserStubManifest', (compilation) => {
                    compilation.hooks.processAssets.tap(
                        {
                            name: 'BrowserStubManifest',
                            stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                        },
                        (assets) => {
                            const files = Object.keys(assets).filter((file) => file.startsWith('typeshed-fallback/'));
                            compilation.emitAsset(
                                'folderIndex.json',
                                new rspack.sources.RawSource(JSON.stringify({ files }))
                            );
                        }
                    );
                });
            },
        },
    ],
    optimization: { minimize: true },
    stats: { all: false, errors: true, warnings: true, timings: true },
};
