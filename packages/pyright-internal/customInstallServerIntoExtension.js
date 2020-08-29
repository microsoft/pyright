#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

// This file is based on the "installServerIntoExtension" that ships with the
// vscode-languagserver node package. We needed to modify it because the original
// version does not copy the package-lock.json file, and it uses npm update
// rather than npm install.

const path = require('path');
const fs = require('fs');
const cp = require('child_process');

let extensionDirectory = process.argv[2];
if (!extensionDirectory) {
    console.error('No extension directory provided.');
    process.exit(1);
}
extensionDirectory = path.resolve(extensionDirectory);
if (!fs.existsSync(extensionDirectory)) {
    console.error('Extension directory ' + extensionDirectory + " doesn't exist on disk.");
    process.exit(1);
}

let packageFile = process.argv[3];
if (!packageFile) {
    console.error('No package.json file provided.');
    process.exit(1);
}
packageFile = path.resolve(packageFile);
if (!fs.existsSync(packageFile)) {
    console.error('Package file ' + packageFile + " doesn't exist on disk.");
    process.exit(1);
}
let tsconfigFile = process.argv[4];
if (!tsconfigFile) {
    console.error('No tsconfig.json file provided');
    process.exit(1);
}
tsconfigFile = path.resolve(tsconfigFile);
if (!fs.existsSync(tsconfigFile)) {
    console.error('tsconfig file ' + tsconfigFile + " doesn't exist on disk.");
    process.exit(1);
}

const extensionServerDirectory = path.join(extensionDirectory, 'server');

const json = require(tsconfigFile);
const compilerOptions = json.compilerOptions;
if (compilerOptions) {
    const outDir = compilerOptions.outDir;
    if (!outDir || path.join(path.dirname(tsconfigFile), outDir) !== extensionServerDirectory) {
        console.error(
            'outDir in ' +
                process.argv[4] +
                ' must point to ' +
                extensionServerDirectory +
                ' but it points to ' +
                path.join(path.dirname(tsconfigFile), outDir)
        );
        console.error(
            'Please change outDir in ' +
                process.argv[4] +
                ' to ' +
                path.relative(path.dirname(tsconfigFile), extensionServerDirectory).replace(/\\/g, '/')
        );
        process.exit(1);
    }
}

if (!fs.existsSync(extensionServerDirectory)) {
    fs.mkdirSync(extensionServerDirectory);
}

const dest = path.join(extensionServerDirectory, 'package.json');
console.log("Copying package.json to extension's server location...");
fs.writeFileSync(dest, fs.readFileSync(packageFile));

let packageLockFile = process.argv[5];
if (fs.existsSync(packageLockFile)) {
    const packageLockFileDest = path.join(extensionServerDirectory, 'package-lock.json');
    packageLockFile = path.resolve(packageLockFile);
    console.log("Copying package-lock.json to extension's server location...");
    fs.writeFileSync(packageLockFileDest, fs.readFileSync(packageLockFile));
}

console.log("Installing server npm modules into extension's server location...");
process.chdir(extensionServerDirectory);
cp.execSync('npm install --production --prefix');
