const fs = require('fs');
const path = require('path');
const glob = require('glob');

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
 */
function cacheConfig(dirname, filename) {
    return {
        type: /** @type {'filesystem'} */ ('filesystem'),
        cacheDirectory: path.resolve(dirname, '.webpack_cache'),
        buildDependencies: {
            config: [filename],
        },
        managedPaths: managedPaths(path.resolve(dirname, '..', '..')),
    };
}

module.exports = {
    monorepoResourceNameMapper,
    cacheConfig,
};
