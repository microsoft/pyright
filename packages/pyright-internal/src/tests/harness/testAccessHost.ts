/*
 * testAccessHost.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * NoAccessHost variation for test environment
 */

import { PythonPathResult } from '../../analyzer/pythonPathUtils';
import { NoAccessHost } from '../../common/host';
import { Uri } from '../../common/uri/uri';

export class TestAccessHost extends NoAccessHost {
    constructor(private _modulePath = Uri.empty(), private _searchPaths: Uri[] = []) {
        super();
    }

    override getPythonSearchPaths(pythonPath?: Uri, logInfo?: string[]): PythonPathResult {
        return {
            paths: this._searchPaths,
            prefix: this._modulePath,
        };
    }
}
