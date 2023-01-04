// This script exits with a "failure" if this SKIP_LERNA_BOOTSTRAP is set.
// This can be used to write npm script like:
//     node ./build/skipBootstrap.js || lerna bootstrap
// Which means "skip lerna bootstrap if SKIP_LERNA_BOOTSTRAP is set".
// This prevents spurious bootstraps in nested lerna repos.

if (!process.env.SKIP_LERNA_BOOTSTRAP) {
    process.exit(1);
}
