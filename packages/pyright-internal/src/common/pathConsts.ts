/*
 * pathConsts.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Path-related constants.
 */

export const typeshedFallback = 'typeshed-fallback';
export const lib = 'lib';
export const libAlternate = 'Lib';
export const lib64 = 'lib64';
export const sitePackages = 'site-packages';
export const distPackages = 'dist-packages';
export const src = 'src';
export const stubsSuffix = '-stubs';
export const defaultStubsDirectory = 'typings';
export const requirementsFileName = 'requirements.txt';
export const pyprojectTomlName = 'pyproject.toml';
export const dotPythonVersionName = '.python-version';
export const configFileName = 'pyrightconfig.json';

// Default exclude glob patterns applied when the user has not specified any
// `exclude` entries. These skip directories that commonly hold dependencies or
// build artifacts, avoiding long scan times.
// Frozen (`as const`) so this shared cross-package constant can't be mutated by a consumer.
export const defaultExcludes = [
    '**/node_modules', // Node.js dependencies
    '**/__pycache__', // Python bytecode cache
    '**/.*', // hidden files/directories (dotfiles)
    '**/__editable__.*', // PEP 660 strict editable-install shadow tree (a build artifact)
] as const;
