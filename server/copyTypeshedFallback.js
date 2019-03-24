#!/usr/bin/env node

// This script helps build the command-line version of pyright
// by copying the typeshed-fallback directory to the dist directory.

var fsExtra = require('fs-extra');

// Clean the dist directory
fsExtra.emptyDirSync('../dist');

fsExtra.mkdirSync('../dist/typeshed-fallback');
fsExtra.copySync('../client/typeshed-fallback', '../dist/typeshed-fallback');

