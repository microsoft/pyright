/*
 * serverUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Small server-side helpers ported from Pylance's `server/common`. Only the pieces the
 * type-server core references live here.
 */

import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';
import { Uri } from '../common/uri/uri';

import { INotebookUriMapper, NotebookUriMapper } from './notebookUriMapper';

export function convertLspUriStringToUri(uri: string, caseDetector: CaseSensitivityDetector, mapper?: INotebookUriMapper) {
    const parsed = Uri.parse(uri, caseDetector);
    if (mapper && NotebookUriMapper.isNotebookCell(parsed)) {
        return mapper.getMappedCellUri(parsed);
    }
    return parsed;
}
