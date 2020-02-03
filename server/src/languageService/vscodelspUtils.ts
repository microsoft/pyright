/*
 * vscodelspUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * this converts types from vscode lsp to pyright's own types. we do this so that
 * dependency to vscode lsp don't spead all over the pyright code base. 
 *
 * only code inside of `languageService` folder and main entry points such as program.ts, service.ts, sourceFile.ts 
 * should have dependency to vscode lsp
 */
import * as lsp from 'vscode-languageserver';
import { Range, Position } from '../common/textRange';

export function convertRange(range?: Range): lsp.Range {
    if (!range) {
        return lsp.Range.create(convertPosition(), convertPosition());
    }
    return lsp.Range.create(convertPosition(range.start), convertPosition(range.end));
}

export function convertPosition(position?: Position): lsp.Position {
    return !position ? lsp.Position.create(0, 0) : lsp.Position.create(position.line, position.character);
}