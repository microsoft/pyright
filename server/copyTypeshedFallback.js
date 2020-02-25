#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

// This script helps build the command-line version of pyright
// by copying the typeshed-fallback directory to the dist directory.

const fsExtra = require('fs-extra');

// Clean the dist directory
fsExtra.emptyDirSync('../dist');

fsExtra.mkdirSync('../dist/typeshed-fallback');
fsExtra.copySync('../client/typeshed-fallback', '../dist/typeshed-fallback');
