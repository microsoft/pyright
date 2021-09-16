const fs = require('fs');
const path = require('path');
const glob = require('glob');
const JSONC = require('jsonc-parser');
const assert = require('assert');

/**
 * Builds a faked resource path for production source maps in webpack.
 *
 * @param {string} packageName The name of the package where webpack is running.
 */
function monorepoResourceNameMapper(packageName) {
    /**@type {(info: {resourcePath: string}) => string} */
    const mapper = (info) => {
        const parts = [];

        // Walk backwards looking for the monorepo
        for (const part of info.resourcePath.split('/').reverse()) {
            if (part === '..' || part === 'packages') {
                break;
            }

            if (part === '.') {
                parts.push(packageName);
                break;
            }

            parts.push(part);
        }

        return parts.reverse().join('/');
    };
    return mapper;
}

/**
 * Returns the list of node_modules folders for the entire monorepo.
 *
 * @param {string} workspaceRoot
 */
function managedPaths(workspaceRoot) {
    const contents = fs.readFileSync(path.join(workspaceRoot, 'lerna.json'), 'utf-8');
    /** @type {{ packages: string[] }} */
    const data = JSON.parse(contents);
    const patterns = data.packages;

    const paths = [path.resolve(workspaceRoot, 'node_modules')];
    paths.push(
        ...patterns
            .flatMap((p) => glob.sync(p, { cwd: workspaceRoot }))
            .map((p) => path.resolve(workspaceRoot, p, 'node_modules'))
    );

    return paths;
}

/**
 * Builds a webpack caching config, given the calling module's __dirname and __filename.
 * @param {string} dirname __dirname
 * @param {string} filename __filename
 * @param {string | undefined} name name of the webpack instance, if using multiple configs
 */
function cacheConfig(dirname, filename, name = undefined) {
    // Temporarily disabled: caching breaks when switching branches,
    // after typescript compilation errors, and so on.
    if (true) {
        return undefined;
    }
    return {
        type: /** @type {'filesystem'} */ ('filesystem'),
        cacheDirectory: path.resolve(dirname, '.webpack_cache'),
        buildDependencies: {
            config: [filename],
        },
        managedPaths: managedPaths(path.resolve(dirname, '..', '..')),
        name,
    };
}

/**
 * Builds a webpack resolve alias configuration from a tsconfig.json file.
 * This is an alternative to using tsconfig-paths-webpack-plugin, which
 * has a number of unfixed bugs.
 *
 * https://github.com/dividab/tsconfig-paths/issues/143
 * https://github.com/dividab/tsconfig-paths-webpack-plugin/issues/59
 * https://github.com/dividab/tsconfig-paths-webpack-plugin/issues/60
 * @param {string} tsconfigPath Path to tsconfig
 */
function tsconfigResolveAliases(tsconfigPath) {
    tsconfigPath = path.resolve(tsconfigPath);
    const tsconfigDir = path.dirname(tsconfigPath);

    const tsconfig = JSONC.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    const baseUrl = tsconfig.baseUrl;
    assert(typeof baseUrl === 'string' || baseUrl === undefined);
    const baseDir = baseUrl ? path.resolve(tsconfigDir, baseUrl) : tsconfigDir;

    const paths = tsconfig['compilerOptions']['paths'];
    assert(typeof paths === 'object');

    const endWildcard = /\/\*$/;

    return Object.fromEntries(
        Object.entries(paths).map(([from, toArr]) => {
            assert(typeof from === 'string', typeof from);
            assert(Array.isArray(toArr) && toArr.length === 1);
            let to = toArr[0];
            assert(typeof to === 'string');
            assert(endWildcard.test(from));
            assert(endWildcard.test(to));

            from = from.replace(endWildcard, '');
            to = to.replace(endWildcard, '');

            return [from, path.resolve(baseDir, to)];
        })
    );
}

module.exports = {
    monorepoResourceNameMapper,
    cacheConfig,
    tsconfigResolveAliases,
};
