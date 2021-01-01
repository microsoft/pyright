/**
 * Builds a faked resource path for production source maps in webpack.
 *
 * @param package_ {string} The name of the package where webpack is running.
 */
function monorepoResourceNameMapper(package_: string) {
    const mapper = (info: { resourcePath: string }) => {
        const parts = [];

        // Walk backwards looking for the monorepo
        for (const part of info.resourcePath.split('/').reverse()) {
            if (part === '..' || part === 'packages') {
                break;
            }

            if (part === '.') {
                parts.push(package_);
                break;
            }

            parts.push(part);
        }

        return parts.reverse().join('/');
    };
    return mapper;
}

export default monorepoResourceNameMapper;
