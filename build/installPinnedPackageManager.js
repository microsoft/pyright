const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const { packageManager } = require(path.join(repoRoot, 'package.json'));

if (!/^pnpm@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageManager)) {
    throw new Error(`Unsupported packageManager value: ${packageManager}`);
}

console.log(`Installing pinned package manager: ${packageManager}`);

const result = spawnSync(`npm install --global ${packageManager}`, {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
});

if (result.error) {
    throw result.error;
}
if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
} else {
    const versionResult = spawnSync('pnpm --version', {
        cwd: repoRoot,
        shell: true,
        encoding: 'utf8',
    });

    if (versionResult.error) {
        throw versionResult.error;
    }
    if (versionResult.status !== 0) {
        process.stderr.write(versionResult.stderr);
        process.exitCode = versionResult.status ?? 1;
    } else {
        console.log(`Installed pnpm version: ${versionResult.stdout.trim()}`);
    }
}
