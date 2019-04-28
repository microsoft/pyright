/*
* commentUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility functions that parse comments and extract commands
* or other directives from them.
*/

import { TextRangeCollection } from '../common/textRangeCollection';
import { Token } from '../parser/tokenizerTypes';

export interface FileLevelDirectives {
    useStrictMode: boolean;
}

export class CommentUtils {
    static getFileLevelDirectives(tokens: TextRangeCollection<Token>): FileLevelDirectives {
        let directives: FileLevelDirectives = {
            useStrictMode: false
        };

        for (let i = 0; i < tokens.count; i++) {
            const token = tokens.getItemAt(i);
            if (token.comments) {
                for (const comment of token.comments) {
                    const value = comment.value.trim();

                    // Is this a pyright-specific comment?
                    const pyrightPrefix = 'pyright:';
                    if (value.startsWith(pyrightPrefix)) {
                        const operand = value.substr(pyrightPrefix.length).trim();

                        if (operand === 'strict') {
                            directives.useStrictMode = true;
                        }
                    }
                }
            }
        }

        return directives;
    }
}
