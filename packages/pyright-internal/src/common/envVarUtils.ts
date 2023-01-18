import * as os from 'os';

/*
 * envVarUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utils functions that handles environment variables.
 */

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
export function expandPathVariables(rootPath: string, value: string): string {
    const regexp = /(\$\{.*?\}|~)/g;
    return value.replace(regexp, (match: string, name: string) => {
        const trimmedName = name.trim();
        if (trimmedName === '${workspaceFolder}') {
            return rootPath;
        }
        if (trimmedName === '${env:HOME}' && process.env.HOME !== undefined) {
            return process.env.HOME;
        }
        if (trimmedName === '${env:USERNAME}' && process.env.USERNAME !== undefined) {
            return process.env.USERNAME;
        }
        if (trimmedName === '${env:VIRTUAL_ENV}' && process.env.VIRTUAL_ENV !== undefined) {
            return process.env.VIRTUAL_ENV;
        }
        if (trimmedName === '~' && os.homedir) {
            return os.homedir() || process.env.HOME || process.env.USERPROFILE || '~';
        }
        return match;
    });
}
