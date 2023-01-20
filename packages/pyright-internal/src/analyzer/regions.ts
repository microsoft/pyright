/*
 * regions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Erik De Bonte
 *
 * Helper functions related to #region/#endregion comments.
 */

import { convertOffsetToPosition } from '../common/positionUtils';
import { ParseResults } from '../parser/parser';
import { Comment } from '../parser/tokenizerTypes';

export const enum RegionCommentType {
    Region,
    EndRegion,
}

export interface RegionComment {
    readonly type: RegionCommentType;
    readonly comment: Comment;
}

export function getRegionComments(parseResults: ParseResults): RegionComment[] {
    const comments = [];

    for (let i = 0; i < parseResults.tokenizerOutput.tokens.count; i++) {
        const token = parseResults.tokenizerOutput.tokens.getItemAt(i);
        if (token.comments) {
            for (const comment of token.comments) {
                const regionCommentType = getRegionCommentType(comment, parseResults);
                if (regionCommentType !== undefined) {
                    comments.push({ type: regionCommentType, comment });
                }
            }
        }
    }

    return comments;
}

// A comment starting with "region" is only treated as a region if it is not followed by an identifier character.
// So these are regions:
// #region
// # region
// #region: foo
//
// And these are not:
// #region_name
const StartRegionRegx = /^\s*region[^\w]/;
const EndRegionRegex = /^\s*endregion[^\w]/;

function getRegionCommentType(comment: Comment, parseResults: ParseResults): RegionCommentType | undefined {
    const hashOffset = comment.start - 1;
    const hashPosition = convertOffsetToPosition(hashOffset, parseResults.tokenizerOutput.lines);

    // If anything other than whitespace is found before the #region (ex. a statement)
    // it's treated as a normal comment.
    if (hashPosition.character !== 0) {
        const lineStartOffset = hashOffset - hashPosition.character;
        const textBeforeCommentOnLine = parseResults.text.slice(lineStartOffset, hashOffset);
        if (textBeforeCommentOnLine.trimStart().length > 0) {
            return undefined;
        }
    }

    const startRegionMatch = StartRegionRegx.exec(comment.value);
    const endRegionMatch = EndRegionRegex.exec(comment.value);

    if (startRegionMatch) {
        return RegionCommentType.Region;
    } else if (endRegionMatch) {
        return RegionCommentType.EndRegion;
    } else {
        return undefined;
    }
}
