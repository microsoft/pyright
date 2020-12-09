//@ts-check

/**
 * Builds a faked resource path for production source maps in webpack.
 *
 * @param package {string} The name of the package where webpack is running.
 */
function monorepoResourceNameMapper(package) {
    /**@type {(info: {resourcePath: string}) => string} */
    const mapper = (info) => {
        const parts = [];

        // Walk backwards looking for the monorepo
        for (const part of info.resourcePath.split('/').reverse()) {
            if (part === '..' || part === 'packages') {
                break;
            }

            if (part === '.') {
                parts.push(package);
                break;
            }

            parts.push(part);
        }

        return parts.reverse().join('/');
    };
    return mapper;
}

module.exports = {
    monorepoResourceNameMapper,
};
