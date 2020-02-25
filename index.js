#!/usr/bin/env node

// Stash the base directory into a global variable.
global.__rootDirectory = __dirname + '/dist/';

require('./dist/pyright');
