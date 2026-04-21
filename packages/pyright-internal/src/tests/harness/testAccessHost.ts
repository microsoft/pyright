/*
 * testAccessHost.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * NoAccessHost variation for test environment
 */

import { ImportLogger } from '../../analyzer/importLogger';
import { PythonPathResult } from '../../analyzer/pythonPathUtils';
import { FileSystem } from '../../common/fileSystem';
import { NoAccessHost } from '../../common/host';
import { Uri } from '../../common/uri/uri';
import { isDirectory } from '../../common/uri/uriUtils';

export class TestAccessHost extends NoAccessHost {
    constructor(private _modulePath = Uri.empty(), private _searchPaths: Uri[] = [], private _fs?: FileSystem) {
        super();
    }

    override getPythonSearchPaths(pythonPath?: Uri, importLogger?: ImportLogger): PythonPathResult {
        // Filter out non-directory paths if filesystem is available
        const filteredPaths = this._fs ? this._searchPaths.filter((p) => isDirectory(this._fs!, p)) : this._searchPaths;

        return {
            paths: filteredPaths,
            prefix: this._modulePath,
        };
    }
}
