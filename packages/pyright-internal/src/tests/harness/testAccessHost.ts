/*
 * testAccessHost.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * NoAccessHost variation for test environment
 */

import { PythonPathResult } from '../../analyzer/pythonPathUtils';
import { NoAccessHost } from '../../common/host';

export class TestAccessHost extends NoAccessHost {
    constructor(private _modulePath = '', private _searchPaths: string[] = []) {
        super();
    }

    override getPythonSearchPaths(pythonPath?: string, logInfo?: string[]): PythonPathResult {
        return {
            paths: this._searchPaths,
            prefix: this._modulePath,
        };
    }
}
