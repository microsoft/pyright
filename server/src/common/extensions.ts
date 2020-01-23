// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { URI } from 'vscode-uri';
import { normalizePath } from './pathUtils';

String.prototype.uriToPath = function(this: string): string {
    const uri = URI.parse(this);
    let convertedPath = normalizePath(uri.path);
    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
        convertedPath = convertedPath.substr(1);
    }
    return convertedPath;
};

String.prototype.pathToUri = function(this: string): string {
  return URI.file(this).toString();
};
