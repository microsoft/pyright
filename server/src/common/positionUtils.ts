/*
* positionUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for converting between file offsets and
* line/column positions.
*/

import { assert } from './debug';
import { Position, Range, TextRange } from './textRange';
import { TextRangeCollection } from './textRangeCollection';

// Translates a file offset into a line/column pair.
export function convertOffsetToPosition(offset: number, lines: TextRangeCollection<TextRange>): Position {
    // Handle the case where the file is empty.
    if (lines.end === 0) {
        return {
            line: 0,
            character: 0
        };
    }

    // Handle the case where we're pointing to the last line of the file.
    if (offset >= lines.end) {
        offset = lines.end - 1;
    }

    const itemIndex = lines.getItemContaining(offset);
    assert(itemIndex >= 0 && itemIndex <= lines.length);
    const lineRange = lines.getItemAt(itemIndex);
    assert(lineRange !== undefined);
    return {
        line: itemIndex,
        character: offset - lineRange.start
    };
}

// Translates a start/end file offset into a pair of line/column positions.
export function convertOffsetsToRange(startOffset: number, endOffset: number,
    lines: TextRangeCollection<TextRange>): Range {
    const start = convertOffsetToPosition(startOffset, lines);
    const end = convertOffsetToPosition(endOffset, lines);
    return { start, end };
}

// Translates a position (line and col) into a file offset.
export function convertPositionToOffset(position: Position,
    lines: TextRangeCollection<TextRange>): number | undefined {
    if (position.line >= lines.count) {
        return undefined;
    }

    return lines.getItemAt(position.line).start + position.character;
}
