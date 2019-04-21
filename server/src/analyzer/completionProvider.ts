/*
* completionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a list of zero or more text completions that apply in the context.
*/

import { CompletionItem, CompletionList } from 'vscode-languageserver';

import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { ParseResults } from '../parser/parser';
import { ParseTreeUtils } from './parseTreeUtils';

export class CompletionProvider {
    static getCompletionsForPosition(parseResults: ParseResults, fileContents: string,
            position: DiagnosticTextPosition): CompletionList | undefined {

        let offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        // const lineTextRange = parseResults.lines.getItemAt(position.line);
        // const textOnLine = fileContents.substr(lineTextRange.start, lineTextRange.length);
        // const textOnLineBeforePosition = textOnLine.substr(0, position.column);

        let completionList = CompletionList.create();

        // TODO - need to finish

        return completionList;
    }
}
